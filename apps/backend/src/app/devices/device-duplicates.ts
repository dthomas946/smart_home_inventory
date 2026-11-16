import { DuplicateHintDto } from '@smart-home-inventory/shared';

/**
 * Likely-the-same-hardware detection across integrations. Home Assistant
 * often registers one physical device several times: once by its own
 * integration (ESPHome, SmartHQ, Matter…) and again as a router client
 * (Netgear/UniFi device trackers), or a hand-entered device mirrors a synced
 * one. There's no safe automatic merge, so we only *hint*; the user decides
 * which copy to exclude.
 *
 * - mac:  two devices report the same MAC address — near-certain.
 * - name: same normalised name in different integrations (or one entered by
 *         hand) — likely. Same-integration name clashes are ignored: two
 *         "BLE-Proxy" ESPHome nodes are two real devices.
 */

export interface DuplicateInput {
  id: string;
  name: string;
  haIntegrations: string | null;
  haMacs: string | null;
  source: string;
}

export function normaliseName(name: string): string {
  return name
    .toLowerCase()
    .replace(/\([^)]*\)/g, ' ') // "(14:2B:…)" suffixes
    .replace(/[^a-z0-9]+/g, '');
}

const integrationsOf = (d: DuplicateInput) =>
  d.haIntegrations ? d.haIntegrations.split(',').filter(Boolean) : d.source === 'manual' ? ['manual'] : [];

export function computeDuplicates(devices: DuplicateInput[]): Map<string, DuplicateHintDto[]> {
  const out = new Map<string, DuplicateHintDto[]>();
  const add = (a: DuplicateInput, b: DuplicateInput, reason: 'mac' | 'name') => {
    const list = out.get(a.id) ?? [];
    const existing = list.find((h) => h.id === b.id);
    if (existing) {
      if (reason === 'mac') existing.reason = 'mac'; // mac outranks name
      return;
    }
    list.push({ id: b.id, name: b.name, integrations: integrationsOf(b), reason });
    out.set(a.id, list);
  };

  const byMac = new Map<string, DuplicateInput[]>();
  for (const d of devices) {
    for (const mac of (d.haMacs ?? '').split(',').filter(Boolean)) {
      const list = byMac.get(mac) ?? [];
      list.push(d);
      byMac.set(mac, list);
    }
  }
  for (const group of byMac.values()) {
    if (group.length < 2) continue;
    for (const a of group) for (const b of group) if (a.id !== b.id) add(a, b, 'mac');
  }

  const byName = new Map<string, DuplicateInput[]>();
  for (const d of devices) {
    const key = normaliseName(d.name);
    if (key.length < 4) continue;
    const list = byName.get(key) ?? [];
    list.push(d);
    byName.set(key, list);
  }
  for (const group of byName.values()) {
    if (group.length < 2) continue;
    for (const a of group) {
      for (const b of group) {
        if (a.id === b.id) continue;
        const ia = integrationsOf(a).join(',');
        const ib = integrationsOf(b).join(',');
        if (ia && ia === ib) continue;
        add(a, b, 'name');
      }
    }
  }
  for (const list of out.values()) list.sort((x, y) => (x.reason === y.reason ? 0 : x.reason === 'mac' ? -1 : 1));
  return out;
}
