import { Logger } from '@nestjs/common';
import WebSocket from 'ws';
import {
  HaArea,
  HaBatchRequest,
  HaBatchResult,
  HaConfigEntry,
  HaCoreConfig,
  HaDevice,
  HaEntity,
  HaFloor,
  HaRegistryClient,
} from './ha-registry.types';

interface HaWsResultMessage {
  id: number;
  type: 'result';
  success: boolean;
  result?: unknown;
  error?: { code: string; message: string };
}

/**
 * Commands that only read state from Home Assistant. In read-only mode
 * (the default) anything not on this list is refused at the transport layer —
 * a future write feature cannot bypass the toggle by accident.
 */
const READ_ONLY_COMMANDS = new Set([
  'config/area_registry/list',
  'config/device_registry/list',
  'config/floor_registry/list',
  'config/entity_registry/list',
  'config_entries/get',
  'get_config',
  'get_states',
  'ping',
  // Mesh route snapshots (Network map → Actual routes). All read-only:
  'zha/devices',
  'matter/node_diagnostics',
  // A subscription, but only its first (current-state) event is read and the
  // connection is then closed.
  'zwave_js/subscribe_node_statistics',
]);

export function assertCommandAllowed(type: string, readOnly: boolean): void {
  if (readOnly && !READ_ONLY_COMMANDS.has(type)) {
    throw new Error(
      `HA command "${type}" blocked: the connection is in read-only mode ` +
        `(set HA_READ_ONLY=false or the add-on's read_only option to allow writes)`
    );
  }
}

/**
 * Minimal Home Assistant WebSocket API client. Connects per call burst and
 * closes again — a sync is 2–3 commands, so no persistent connection or
 * reconnect logic is needed.
 */
export class WsHaRegistryClient implements HaRegistryClient {
  private readonly logger = new Logger(WsHaRegistryClient.name);

  constructor(
    private readonly wsUrl: string,
    private readonly token: string,
    private readonly readOnly = true,
    private readonly timeoutMs = 10000
  ) {}

  async listAreas(): Promise<HaArea[]> {
    const result = await this.command('config/area_registry/list');
    return (result as HaArea[]).map((a) => ({
      area_id: a.area_id,
      name: a.name,
      floor_id: a.floor_id ?? null,
    }));
  }

  async listFloors(): Promise<HaFloor[]> {
    const result = await this.command('config/floor_registry/list');
    return (result as HaFloor[]).map((f) => ({
      floor_id: f.floor_id,
      name: f.name,
      level: f.level ?? null,
    }));
  }

  async listDevices(): Promise<HaDevice[]> {
    const result = await this.command('config/device_registry/list');
    return (result as HaDevice[]).map((d) => ({
      id: d.id,
      name: d.name ?? null,
      name_by_user: d.name_by_user ?? null,
      manufacturer: d.manufacturer ?? null,
      model: d.model ?? null,
      area_id: d.area_id ?? null,
      entry_type: d.entry_type ?? null,
      via_device_id: d.via_device_id ?? null,
      config_entries: Array.isArray(d.config_entries) ? d.config_entries : [],
      identifiers: Array.isArray(d.identifiers) ? d.identifiers : [],
      connections: Array.isArray(d.connections) ? d.connections : [],
    }));
  }

  async listStatesByDomain(domain: string): Promise<Array<{ entity_id: string; name: string | null }>> {
    const states = (await this.command('get_states')) as Array<{
      entity_id: string;
      attributes?: { friendly_name?: string };
    }>;
    return states
      .filter((s) => s.entity_id.startsWith(`${domain}.`))
      .map((s) => ({ entity_id: s.entity_id, name: s.attributes?.friendly_name ?? null }));
  }

  async getCoreConfig(): Promise<HaCoreConfig> {
    const c = (await this.command('get_config')) as Record<string, unknown>;
    const units = c['unit_system'] as Record<string, unknown> | undefined;
    // unit_system is an object of units; identify US customary by its length unit
    const unitSystem =
      units && typeof units === 'object' ? (units['length'] === 'mi' ? 'us_customary' : 'metric') : null;
    const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : null);
    return {
      currency: str(c['currency']),
      country: str(c['country']),
      language: str(c['language']),
      time_zone: str(c['time_zone']),
      unit_system: unitSystem,
    };
  }

  async listConfigEntries(): Promise<HaConfigEntry[]> {
    const result = await this.command('config_entries/get');
    return (result as HaConfigEntry[]).map((e) => ({
      entry_id: e.entry_id,
      domain: e.domain,
      title: e.title ?? '',
    }));
  }

  async listEntities(): Promise<HaEntity[]> {
    const result = await this.command('config/entity_registry/list');
    return (
      result as Array<{
        entity_id: string;
        device_id: string | null;
        platform: string;
        device_class: string | null;
        original_device_class: string | null;
      }>
    ).map((e) => ({
      entity_id: e.entity_id,
      device_id: e.device_id ?? null,
      platform: e.platform,
      device_class: e.device_class ?? e.original_device_class ?? null,
    }));
  }

  /**
   * Run several read commands over one connection. Each request resolves on
   * its own: a failed or unanswered request gives `{ ok: false }` without
   * failing the others. With `snapshot`, the request is a subscription and
   * the first event after its result is returned; the connection is closed
   * afterwards, which ends the subscription.
   */
  async batch(requests: HaBatchRequest[], timeoutMs = 20000): Promise<HaBatchResult[]> {
    for (const r of requests) assertCommandAllowed(r.type, this.readOnly);
    if (requests.length === 0) return [];
    return new Promise((resolve, reject) => {
      const results: Array<HaBatchResult | undefined> = requests.map(() => undefined);
      const ws = new WebSocket(this.wsUrl);
      let settled = false;
      const finish = () => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        try {
          ws.close();
        } catch {
          // ignore
        }
        resolve(results.map((r) => r ?? { ok: false, error: 'no answer before timeout' }));
      };
      const timer = setTimeout(finish, timeoutMs);
      const check = () => {
        if (results.every((r) => r !== undefined)) finish();
      };

      ws.on('error', (err) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        reject(err);
      });
      ws.on('message', (raw) => {
        let msg: { type: string; id?: number; success?: boolean; result?: unknown; event?: unknown; error?: { message?: string } };
        try {
          msg = JSON.parse(raw.toString());
        } catch {
          return;
        }
        if (msg.type === 'auth_required') {
          ws.send(JSON.stringify({ type: 'auth', access_token: this.token }));
        } else if (msg.type === 'auth_invalid') {
          settled = true;
          clearTimeout(timer);
          reject(new Error('HA WebSocket authentication failed'));
        } else if (msg.type === 'auth_ok') {
          requests.forEach((r, i) => ws.send(JSON.stringify({ ...(r.data ?? {}), id: i + 1, type: r.type })));
        } else if (msg.type === 'result' && typeof msg.id === 'number') {
          const i = msg.id - 1;
          const req = requests[i];
          if (!req || results[i]) return;
          if (!msg.success) results[i] = { ok: false, error: msg.error?.message ?? 'failed' };
          else if (!req.snapshot) results[i] = { ok: true, result: msg.result };
          check();
        } else if (msg.type === 'event' && typeof msg.id === 'number') {
          const i = msg.id - 1;
          if (requests[i]?.snapshot && !results[i]) {
            results[i] = { ok: true, result: msg.event };
            check();
          }
        }
      });
    });
  }

  async ping(): Promise<boolean> {
    try {
      await this.command('config/area_registry/list');
      return true;
    } catch {
      return false;
    }
  }

  private command(type: string): Promise<unknown> {
    assertCommandAllowed(type, this.readOnly);
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(this.wsUrl);
      const timer = setTimeout(() => {
        ws.terminate();
        reject(new Error(`HA WebSocket timeout after ${this.timeoutMs}ms (${type})`));
      }, this.timeoutMs);
      const done = (fn: () => void) => {
        clearTimeout(timer);
        try {
          ws.close();
        } catch {
          // ignore
        }
        fn();
      };

      ws.on('error', (err) => done(() => reject(err)));
      ws.on('message', (raw) => {
        let msg: { type: string };
        try {
          msg = JSON.parse(raw.toString());
        } catch (err) {
          return done(() => reject(new Error(`Invalid HA WS message: ${err}`)));
        }
        switch (msg.type) {
          case 'auth_required':
            ws.send(JSON.stringify({ type: 'auth', access_token: this.token }));
            break;
          case 'auth_ok':
            ws.send(JSON.stringify({ id: 1, type }));
            break;
          case 'auth_invalid':
            done(() => reject(new Error('HA WebSocket authentication failed')));
            break;
          case 'result': {
            const result = msg as unknown as HaWsResultMessage;
            if (result.success) {
              done(() => resolve(result.result));
            } else {
              done(() =>
                reject(
                  new Error(
                    `HA command "${type}" failed: ${result.error?.message ?? 'unknown'}`
                  )
                )
              );
            }
            break;
          }
          default:
            // ignore events/pongs
            break;
        }
      });
    });
  }
}
