import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  LinkQuality,
  MeshHopDto,
  MeshProtocolKey,
  MeshSnapshotDto,
  MeshSourceStatusDto,
  WifiLinkDto,
} from '@smart-home-inventory/shared';
import WebSocket from 'ws';
import { AppConfig } from '../config/app-config';
import { HA_REGISTRY_CLIENT, HaBatchRequest, HaDevice, HaRegistryClient } from '../ha/ha-registry.types';
import { PrismaService } from '../prisma/prisma.service';
import {
  MatterNode,
  MeshHop,
  parseLosslessJson,
  threadHops,
  zigbeeHops,
  ZhaDevice,
  zwaveHop,
  ZwaveStats,
} from './mesh-routes';

const CACHE_MS = 5 * 60 * 1000;

/**
 * Reads the routes each mesh actually uses — Zigbee (ZHA), Z-Wave (Z-Wave
 * JS), Thread (Matter server + OpenThread Border Router) — plus Wi-Fi band and
 * signal from the router integration. Read-only, on demand, cached for a few
 * minutes; nothing polls in the background.
 */
@Injectable()
export class MeshRoutesService {
  private readonly logger = new Logger(MeshRoutesService.name);
  private cache: { at: number; data: MeshSnapshotDto } | null = null;
  private inFlight: Promise<MeshSnapshotDto> | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: AppConfig,
    @Inject(HA_REGISTRY_CLIENT) private readonly client: HaRegistryClient
  ) {}

  async snapshot(refresh = false): Promise<MeshSnapshotDto> {
    if (!refresh && this.cache && Date.now() - this.cache.at < CACHE_MS) return this.cache.data;
    if (!this.inFlight) {
      this.inFlight = this.read()
        .then((data) => {
          this.cache = { at: Date.now(), data };
          return data;
        })
        .finally(() => (this.inFlight = null));
    }
    return this.inFlight;
  }

  private async read(): Promise<MeshSnapshotDto> {
    const sources: MeshSnapshotDto['sources'] = {
      zigbee: { status: 'unavailable', devices: 0 },
      zwave: { status: 'unavailable', devices: 0 },
      thread: { status: 'unavailable', devices: 0 },
      wifi: { status: 'unavailable', devices: 0 },
    };
    const empty = (message: string): MeshSnapshotDto => {
      for (const k of Object.keys(sources) as Array<keyof typeof sources>) sources[k].message = message;
      return { fetchedAt: new Date().toISOString(), hops: [], wifi: [], sources };
    };
    if (!this.client.batch) return empty('Not connected to Home Assistant');

    const devices = await this.client.listDevices();
    const zwave = devices.filter((d) => (d.identifiers ?? []).some((i) => i[0] === 'zwave_js' && /^\d+-\d+$/.test(i[1] ?? '')));
    const matter = devices.filter((d) => (d.identifiers ?? []).some((i) => i[0] === 'matter'));
    const nodeToDevice = new Map<number, string>();
    for (const d of zwave) {
      const id = (d.identifiers ?? []).find((i) => i[0] === 'zwave_js')?.[1] ?? '';
      nodeToDevice.set(Number(id.split('-')[1]), d.id);
    }

    const requests: HaBatchRequest[] = [
      { type: 'zha/devices' },
      { type: 'config/entity_registry/list' },
      { type: 'get_states' },
      ...zwave.map((d) => ({ type: 'zwave_js/subscribe_node_statistics', data: { device_id: d.id }, snapshot: true })),
      ...matter.map((d) => ({ type: 'matter/node_diagnostics', data: { device_id: d.id } })),
    ];
    let results;
    try {
      results = await this.client.batch(requests, 25000);
    } catch (err) {
      return empty(`Home Assistant: ${(err as Error).message}`);
    }
    const [zha, entities, states] = results;
    const zwaveResults = results.slice(3, 3 + zwave.length);
    const matterResults = results.slice(3 + zwave.length);
    const hops: MeshHop[] = [];

    // Zigbee
    if (zha.ok && Array.isArray(zha.result)) {
      const z = zigbeeHops(zha.result as ZhaDevice[]);
      hops.push(...z);
      sources.zigbee = { status: 'ok', devices: z.length };
    } else if (!zha.ok && !/unknown command/i.test(zha.error)) {
      sources.zigbee = { status: 'error', devices: 0, message: zha.error };
    }

    // Z-Wave
    if (zwave.length) {
      let n = 0;
      zwaveResults.forEach((r, i) => {
        if (!r.ok) return;
        const h = zwaveHop(zwave[i].id, r.result as ZwaveStats, nodeToDevice);
        if (h && h.child !== h.parent) {
          hops.push(h);
          n++;
        }
      });
      const failed = zwaveResults.filter((r) => !r.ok).length;
      sources.zwave = { status: n || !failed ? 'ok' : 'error', devices: n, ...(failed ? { message: `${failed} device(s) gave no statistics` } : {}) };
    }

    // Thread (Matter-over-Thread)
    if (matter.length) {
      const diag = new Map<string, { nodeId: number; mac: string | null }>();
      matterResults.forEach((r, i) => {
        if (!r.ok) return;
        const d = r.result as { node_id?: number; network_type?: string; mac_address?: string | null };
        if (d.network_type === 'thread' && typeof d.node_id === 'number') {
          diag.set(matter[i].id, { nodeId: d.node_id, mac: d.mac_address ?? null });
        }
      });
      if (diag.size) {
        try {
          const [nodes, brExt] = await Promise.all([this.matterNodes(), this.borderRouterExt()]);
          const t = threadHops(nodes, diag, brExt);
          hops.push(...t);
          sources.thread = { status: 'ok', devices: t.length };
        } catch (err) {
          sources.thread = { status: 'error', devices: 0, message: (err as Error).message };
        }
      }
    }

    // Wi-Fi band / signal (router integrations that expose link sensors)
    const wifi: Array<{ haId: string; band: string | null; signal: number | null }> = [];
    if (entities.ok && states.ok) {
      const stateOf = new Map(
        (states.result as Array<{ entity_id: string; state: string }>).map((s) => [s.entity_id, s.state])
      );
      const byDevice = new Map<string, { band: string | null; signal: number | null }>();
      for (const e of entities.result as Array<{ entity_id: string; device_id: string | null; platform: string }>) {
        if (!e.device_id || e.platform !== 'netgear') continue;
        const cur = byDevice.get(e.device_id) ?? { band: null, signal: null };
        const v = stateOf.get(e.entity_id);
        if (v === undefined || v === 'unknown' || v === 'unavailable') continue;
        if (e.entity_id.endsWith('_link_type')) cur.band = v;
        else if (e.entity_id.endsWith('_signal_strength')) cur.signal = Number.isFinite(Number(v)) ? Number(v) : null;
        else continue;
        byDevice.set(e.device_id, cur);
      }
      for (const [haId, v] of byDevice) wifi.push({ haId, ...v });
      sources.wifi = { status: wifi.length ? 'ok' : 'unavailable', devices: wifi.length };
    }

    return this.toInventory(hops, wifi, devices, sources);
  }

  /** Map HA device ids to inventory devices. */
  private async toInventory(
    hops: MeshHop[],
    wifi: Array<{ haId: string; band: string | null; signal: number | null }>,
    devices: HaDevice[],
    sources: MeshSnapshotDto['sources']
  ): Promise<MeshSnapshotDto> {
    const haIds = new Set<string>();
    for (const h of hops) {
      haIds.add(h.child);
      if (h.parent) haIds.add(h.parent);
    }
    for (const w of wifi) haIds.add(w.haId);
    const rows = await this.prisma.device.findMany({
      where: { haDeviceId: { in: [...haIds] } },
      select: { id: true, haDeviceId: true },
    });
    const inv = new Map(rows.map((r) => [r.haDeviceId as string, r.id]));
    // The router integration keeps its own copy of each client device; when
    // that copy was excluded, find the device you kept by its MAC address.
    const missingWifi = wifi.filter((w) => !inv.has(w.haId));
    if (missingWifi.length) {
      const macOf = new Map(
        devices.map((d) => [
          d.id,
          (d.connections ?? []).filter(([k]) => k === 'mac').map(([, v]) => v.toLowerCase().replace(/-/g, ':')),
        ])
      );
      const withMacs = await this.prisma.device.findMany({
        where: { haMacs: { not: null } },
        select: { id: true, haMacs: true },
      });
      const byMac = new Map<string, string>();
      for (const r of withMacs) for (const m of (r.haMacs ?? '').split(',')) if (m) byMac.set(m, r.id);
      for (const w of missingWifi) {
        const hit = (macOf.get(w.haId) ?? []).map((m) => byMac.get(m)).find(Boolean);
        if (hit) inv.set(w.haId, hit);
      }
    }
    const haName = new Map(devices.map((d) => [d.id, d.name_by_user ?? d.name ?? d.id]));

    const outHops: MeshHopDto[] = [];
    for (const h of hops) {
      const deviceId = inv.get(h.child);
      if (!deviceId) continue;
      const parentId = h.parent ? inv.get(h.parent) ?? null : null;
      outHops.push({
        protocol: h.protocol,
        deviceId,
        parentId,
        lqi: h.lqi,
        rssi: h.rssi,
        quality: h.quality,
        viaUnknown:
          h.viaUnknown ?? (h.parent && !parentId ? `${haName.get(h.parent) ?? 'a device'} (not in the inventory)` : null),
      });
    }
    const outWifi: WifiLinkDto[] = [];
    for (const w of wifi) {
      const deviceId = inv.get(w.haId);
      if (deviceId) outWifi.push({ deviceId, band: w.band, signal: w.signal, quality: wifiQuality(w.band, w.signal) });
    }
    const count = (p: MeshProtocolKey) => outHops.filter((h) => h.protocol === p).length;
    for (const p of ['zigbee', 'zwave', 'thread'] as MeshProtocolKey[]) {
      if (sources[p].status === 'ok') sources[p] = { ...sources[p], devices: count(p) } as MeshSourceStatusDto;
    }
    if (sources.wifi.status === 'ok') sources.wifi = { ...sources.wifi, devices: outWifi.length };
    this.logger.log(
      `Mesh routes: zigbee ${count('zigbee')}, zwave ${count('zwave')}, thread ${count('thread')}, wifi ${outWifi.length}`
    );
    return { fetchedAt: new Date().toISOString(), hops: outHops, wifi: outWifi, sources };
  }

  private matterServerUrl(): string | null {
    return process.env['MATTER_SERVER_URL'] || (this.config.haMode === 'supervisor' ? 'ws://core-matter-server:5580/ws' : null);
  }

  private otbrUrl(): string | null {
    return process.env['OTBR_URL'] || (this.config.haMode === 'supervisor' ? 'http://core-openthread-border-router:8081' : null);
  }

  /** Matter server `get_nodes` (read-only), with 64-bit values kept exact. */
  private matterNodes(timeoutMs = 10000): Promise<MatterNode[]> {
    const url = this.matterServerUrl();
    if (!url) return Promise.reject(new Error('Matter server address unknown (set MATTER_SERVER_URL)'));
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(url);
      const timer = setTimeout(() => {
        ws.terminate();
        reject(new Error('Matter server did not answer'));
      }, timeoutMs);
      let sent = false;
      ws.on('error', (e) => {
        clearTimeout(timer);
        reject(new Error(`Matter server: ${e.message}`));
      });
      ws.on('message', (raw) => {
        const text = raw.toString();
        if (!sent) {
          sent = true; // first message is server info
          ws.send(JSON.stringify({ message_id: 'shi-nodes', command: 'get_nodes' }));
          return;
        }
        let msg: { message_id?: string; result?: unknown; error_code?: number; details?: string };
        try {
          msg = parseLosslessJson(text) as typeof msg;
        } catch {
          return;
        }
        if (msg.message_id !== 'shi-nodes') return;
        clearTimeout(timer);
        ws.close();
        if (Array.isArray(msg.result)) resolve(msg.result as MatterNode[]);
        else reject(new Error(`Matter server: ${msg.details ?? 'no nodes'}`));
      });
    });
  }

  /** The OpenThread Border Router's own address (children of it are direct). */
  private async borderRouterExt(): Promise<string | null> {
    const base = this.otbrUrl();
    if (!base) return null;
    try {
      const res = await fetch(`${base}/node`, { signal: AbortSignal.timeout(5000) });
      if (!res.ok) return null;
      const body = (await res.json()) as { extAddress?: string };
      return body.extAddress ?? null;
    } catch {
      return null;
    }
  }
}

function wifiQuality(band: string | null, signal: number | null): LinkQuality | null {
  if (band && /wired/i.test(band)) return null;
  if (signal === null) return null;
  return signal >= 60 ? 'good' : signal >= 40 ? 'fair' : 'poor';
}
