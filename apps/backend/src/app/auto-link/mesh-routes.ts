/**
 * Actual mesh routes, read from what each protocol's controller reports.
 * Pure functions over the raw payloads so they can be tested; the service
 * does the fetching. Every result is "child → parent" in Home Assistant
 * device ids, where parent null means "straight to its controller".
 */

export type MeshProtocol = 'zigbee' | 'zwave' | 'thread';

export interface MeshHop {
  protocol: MeshProtocol;
  child: string;
  /** HA device id of the next hop toward the controller; null = direct. */
  parent: string | null;
  /** Protocol-native link quality: Zigbee LQI 0–255, Thread LQI 0–3. */
  lqi: number | null;
  /** dBm where the protocol reports it. */
  rssi: number | null;
  /** 'good' | 'fair' | 'poor', comparable across protocols. */
  quality: 'good' | 'fair' | 'poor' | null;
  /** When the next hop isn't a device Home Assistant knows (e.g. an Apple
   *  Thread router), a short description of it. */
  viaUnknown?: string;
}

const num = (v: unknown): number | null => {
  const n = typeof v === 'string' ? Number(v) : typeof v === 'number' ? v : NaN;
  return Number.isFinite(n) ? n : null;
};

function qualityFromLqi(lqi: number | null, max: number): MeshHop['quality'] {
  if (lqi === null) return null;
  const f = lqi / max;
  return f >= 0.66 ? 'good' : f >= 0.4 ? 'fair' : 'poor';
}

function qualityFromRssi(rssi: number | null): MeshHop['quality'] {
  if (rssi === null || rssi >= 127 || rssi <= -127) return null; // 127 = not available
  return rssi >= -70 ? 'good' : rssi >= -85 ? 'fair' : 'poor';
}

// ---------------------------------------------------------------------------
// Zigbee (ZHA: zha/devices)
// ---------------------------------------------------------------------------

interface ZhaNeighbor {
  ieee?: string;
  nwk?: string;
  lqi?: string | number;
  relationship?: string;
}
interface ZhaRoute {
  dest_nwk?: string;
  next_hop?: string;
  route_status?: string;
}
export interface ZhaDevice {
  ieee: string;
  nwk?: string;
  device_type?: string;
  device_reg_id?: string;
  lqi?: number | string | null;
  rssi?: number | string | null;
  neighbors?: ZhaNeighbor[];
  routes?: ZhaRoute[];
}

const normNwk = (v: string | undefined) => (v ? `0x${v.replace(/^0x/i, '').toUpperCase().padStart(4, '0')}` : '');

export function zigbeeHops(devices: ZhaDevice[]): MeshHop[] {
  const byNwk = new Map(devices.map((d) => [normNwk(d.nwk), d]));
  const byIeee = new Map(devices.map((d) => [d.ieee.toLowerCase(), d]));
  const coordinator = devices.find((d) => d.device_type === 'Coordinator' || normNwk(d.nwk) === '0x0000');
  // Routers list their children (end devices) in their neighbour tables.
  const childOf = new Map<string, { router: ZhaDevice; lqi: number | null }>();
  for (const r of devices) {
    for (const n of r.neighbors ?? []) {
      if (n.relationship === 'Child' && n.ieee) childOf.set(n.ieee.toLowerCase(), { router: r, lqi: num(n.lqi) });
    }
  }
  const hops: MeshHop[] = [];
  for (const d of devices) {
    if (d === coordinator || !d.device_reg_id) continue;
    const toCoord = (d.routes ?? []).filter((r) => normNwk(r.dest_nwk) === '0x0000' && r.next_hop);
    const route =
      toCoord.find((r) => r.route_status === 'Active') ??
      toCoord.find((r) => r.route_status !== 'Inactive' && r.route_status !== 'Validation_Underway');
    let parent: ZhaDevice | null | undefined;
    let lqi: number | null = null;
    if (route) {
      const next = normNwk(route.next_hop);
      parent = next === '0x0000' ? null : byNwk.get(next);
      if (parent === undefined) continue; // next hop unknown to ZHA
    } else {
      const p = (d.neighbors ?? []).find((n) => n.relationship === 'Parent');
      if (p?.ieee) parent = byIeee.get(p.ieee.toLowerCase()) ?? undefined;
      else if (childOf.has(d.ieee.toLowerCase())) parent = childOf.get(d.ieee.toLowerCase())?.router;
      if (parent === undefined) continue;
      if (parent === coordinator) parent = null;
    }
    if (parent === coordinator) parent = null;
    const parentIeee = (parent ?? coordinator)?.ieee.toLowerCase();
    const nb = (d.neighbors ?? []).find((n) => n.ieee?.toLowerCase() === parentIeee);
    lqi = num(nb?.lqi) ?? childOf.get(d.ieee.toLowerCase())?.lqi ?? (parent === null ? num(d.lqi) : null);
    hops.push({
      protocol: 'zigbee',
      child: d.device_reg_id,
      parent: parent?.device_reg_id ?? null,
      lqi,
      rssi: num(d.rssi),
      quality: qualityFromLqi(lqi, 255),
    });
  }
  return hops;
}

// ---------------------------------------------------------------------------
// Z-Wave (Z-Wave JS: zwave_js/subscribe_node_statistics, first event)
// ---------------------------------------------------------------------------

export interface ZwaveStats {
  lwr?: { repeaters?: Array<string | number>; rssi?: number | null } | null;
  rssi?: number | null;
}

/**
 * `repeaters` is the last working route, controller side first. HA gives
 * device ids; older versions gave node ids, which `nodeToDevice` resolves.
 */
export function zwaveHop(
  deviceId: string,
  stats: ZwaveStats | null | undefined,
  nodeToDevice: Map<number, string>
): MeshHop | null {
  const lwr = stats?.lwr;
  if (!lwr) return null;
  const reps = (lwr.repeaters ?? [])
    .map((r) => (typeof r === 'number' ? nodeToDevice.get(r) ?? null : r))
    .filter((r): r is string => !!r);
  const rssi = num(lwr.rssi ?? stats?.rssi);
  return {
    protocol: 'zwave',
    child: deviceId,
    parent: reps.length ? reps[reps.length - 1] : null,
    lqi: null,
    rssi: rssi !== null && Math.abs(rssi) < 127 ? rssi : null,
    quality: qualityFromRssi(rssi),
  };
}

const approxKey = (hex: string) => Number(BigInt('0x' + hex));

/** JSON.parse that keeps integers too big for a JS number as strings. */
export function parseLosslessJson(text: string): unknown {
  return JSON.parse(text.replace(/([:\[,]\s*)(-?\d{16,})(?=\s*[,\]}])/g, '$1"$2"'));
}

// ---------------------------------------------------------------------------
// Thread (Matter server get_nodes + HA matter/node_diagnostics + OTBR /node)
// ---------------------------------------------------------------------------

export interface MatterNode {
  node_id: number;
  attributes?: Record<string, unknown>;
}

/** Matter ThreadNetworkDiagnostics (cluster 53) neighbour entry fields. */
const NB_EXT = '0';
const NB_RLOC16 = '2';
const NB_LQI = '5';
const NB_AVG_RSSI = '6';
const NB_IS_CHILD = '13';
/** RoutingRole: 2 sleepy end device, 3 end device (they have one parent). */
const END_DEVICE_ROLES = new Set([2, 3]);

/**
 * 64-bit ext addresses don't fit a JS number. The service keeps them as
 * strings when parsing (see `parseLosslessJson`); a number that slipped
 * through is matched by its rounded value instead (`approxKey`).
 */
export const extToHex = (v: unknown): string | null => {
  if (typeof v === 'bigint') return v.toString(16).padStart(16, '0');
  if (typeof v === 'number') return null;
  if (typeof v === 'string') {
    // Plain digits = the decimal value from the Matter server; anything else
    // (e.g. "6e:c7:…" from HA, or OTBR's "ea57bf…") = hex.
    if (/^\d+$/.test(v)) return BigInt(v).toString(16).padStart(16, '0');
    const s = v.replace(/[^0-9a-f]/gi, '').toLowerCase();
    if (s.length === 16) return s;
  }
  return null;
};

/**
 * @param nodes        Matter server nodes (raw attributes)
 * @param diagnostics  HA device id → { node id, Thread MAC (ext address) }
 * @param borderRouterExt the OTBR's extended address (its children are "direct")
 */
export function threadHops(
  nodes: MatterNode[],
  diagnostics: Map<string, { nodeId: number; mac: string | null }>,
  borderRouterExt: string | null
): MeshHop[] {
  const deviceByNode = new Map<number, string>();
  const deviceByExt = new Map<string, string>();
  const deviceByApprox = new Map<number, string>();
  for (const [deviceId, d] of diagnostics) {
    deviceByNode.set(d.nodeId, deviceId);
    const ext = extToHex(d.mac);
    if (ext) {
      deviceByExt.set(ext, deviceId);
      deviceByApprox.set(approxKey(ext), deviceId);
    }
  }
  const brApprox = borderRouterExt && extToHex(borderRouterExt) ? approxKey(extToHex(borderRouterExt) as string) : null;
  const lookup = (raw: unknown): { device?: string; isBr: boolean; ext: string | null } => {
    const ext = extToHex(raw);
    if (ext) return { device: deviceByExt.get(ext), isBr: !!br && ext === br, ext };
    if (typeof raw === 'number') return { device: deviceByApprox.get(raw), isBr: raw === brApprox, ext: null };
    return { isBr: false, ext: null };
  };
  const br = borderRouterExt ? extToHex(borderRouterExt) : null;
  const hops: MeshHop[] = [];
  for (const n of nodes) {
    const child = deviceByNode.get(n.node_id);
    const a = n.attributes ?? {};
    const role = num(a['0/53/1']);
    const table = a['0/53/7'];
    if (!child || role === null || !END_DEVICE_ROLES.has(role) || !Array.isArray(table)) continue;
    // An end device's neighbour table holds its parent router.
    const entry = (table as Array<Record<string, unknown>>).find((e) => e[NB_IS_CHILD] !== true) ?? table[0];
    if (!entry) continue;
    const { device, isBr, ext } = lookup(entry[NB_EXT]);
    const lqi = num(entry[NB_LQI]);
    const rssi = num(entry[NB_AVG_RSSI]);
    const base = { protocol: 'thread' as const, child, lqi, rssi, quality: qualityFromLqi(lqi, 3) ?? qualityFromRssi(rssi) };
    if (isBr) hops.push({ ...base, parent: null });
    else if (device) hops.push({ ...base, parent: device });
    else {
      const rloc = num(entry[NB_RLOC16]);
      hops.push({
        ...base,
        parent: null,
        viaUnknown: `Thread router ${rloc !== null ? '0x' + rloc.toString(16).padStart(4, '0') : ext ?? '?'} (not in Home Assistant)`,
      });
    }
  }
  return hops;
}
