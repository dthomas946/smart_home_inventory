import { computeDuplicates, DuplicateInput, normaliseName } from './device-duplicates';

const d = (id: string, name: string, ints: string | null, macs: string | null = null, source = 'ha'): DuplicateInput => ({
  id,
  name,
  haIntegrations: ints,
  haMacs: macs,
  source,
});

describe('computeDuplicates', () => {
  it('flags devices sharing a MAC as near-certain duplicates (both directions)', () => {
    const m = computeDuplicates([
      d('a', 'Downstairs-Thermostat', 'netgear', 'aa:bb:cc:00:11:22'),
      d('b', 'Downstairs Thermostat', 'honeywell', 'aa:bb:cc:00:11:22'),
      d('c', 'Fridge', 'smarthq', 'ff:ff:ff:ff:ff:ff'),
    ]);
    expect(m.get('a')).toEqual([{ id: 'b', name: 'Downstairs Thermostat', integrations: ['honeywell'], reason: 'mac' }]);
    expect(m.get('b')?.[0].id).toBe('a');
    expect(m.has('c')).toBe(false);
  });

  it('flags same-name devices in different integrations, including hand-entered ones', () => {
    const m = computeDuplicates([
      d('a', 'Apple TV', 'apple_tv'),
      d('b', 'apple-tv', 'netgear'),
      d('c', 'Apple TV', null, null, 'manual'),
    ]);
    expect(m.get('a')?.map((h) => h.id).sort()).toEqual(['b', 'c']);
    expect(m.get('c')?.every((h) => h.reason === 'name')).toBe(true);
  });

  it('ignores same-name devices within one integration (two real BLE proxies)', () => {
    const m = computeDuplicates([d('a', 'BLE-Proxy', 'esphome'), d('b', 'BLE-Proxy', 'esphome')]);
    expect(m.size).toBe(0);
  });

  it('prefers the mac reason when both match', () => {
    const m = computeDuplicates([
      d('a', 'Hue Bridge', 'hue', 'aa:aa:aa:aa:aa:aa'),
      d('b', 'Hue Bridge', 'netgear', 'aa:aa:aa:aa:aa:aa'),
    ]);
    expect(m.get('a')).toHaveLength(1);
    expect(m.get('a')?.[0].reason).toBe('mac');
  });

  it('normalises names: case, punctuation, parenthesised suffixes', () => {
    expect(normaliseName('BLE-Proxy (14:2B:2F:9F:87:FE)')).toBe('bleproxy');
    expect(normaliseName("D's Lamp")).toBe('dslamp');
  });

  it('skips very short names to avoid noise', () => {
    expect(computeDuplicates([d('a', 'TV', 'cast'), d('b', 'TV', 'netgear')]).size).toBe(0);
  });
});
