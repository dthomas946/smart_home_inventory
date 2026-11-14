import { HaDevice, HaEntity } from '../ha/ha-registry.types';
import { autoKeyFor, plan, PlannerInput } from './auto-link.planner';

function haDev(id: string, extra: Partial<HaDevice> = {}): HaDevice {
  return {
    id,
    name: id,
    name_by_user: null,
    manufacturer: null,
    model: null,
    area_id: null,
    entry_type: null,
    via_device_id: null,
    config_entries: [],
    identifiers: [],
    connections: [],
    ...extra,
  };
}
function ent(device_id: string, platform: string): HaEntity {
  return { entity_id: `${platform}.${device_id}`, device_id, platform, device_class: null };
}

const base = (): PlannerInput => ({
  localDevices: [
    { id: 'L-coord', name: 'Zigbee Coordinator', haDeviceId: 'ha-coord', category: 'network' },
    { id: 'L-bulb', name: 'Kitchen Bulb', haDeviceId: 'ha-bulb', category: 'light' },
    { id: 'L-zstick', name: 'Z-Stick', haDeviceId: 'ha-zstick', category: null },
    { id: 'L-lock', name: 'Front Lock', haDeviceId: 'ha-lock', category: 'lock' },
    { id: 'L-esp', name: 'BLE Proxy', haDeviceId: 'ha-esp', category: null },
    { id: 'L-router', name: 'Orbi', haDeviceId: null, category: 'network' },
    { id: 'L-fridge', name: 'Fridge', haDeviceId: null, category: 'appliance' },
  ],
  haDevices: [
    haDev('ha-coord', { name: 'Zigbee2MQTT Bridge', identifiers: [['mqtt', 'zigbee2mqtt_bridge']] }),
    haDev('ha-bulb', { via_device_id: 'ha-coord' }),
    haDev('ha-zstick', { name: 'Z-Stick 7' }),
    haDev('ha-lock', { via_device_id: 'ha-zstick' }),
    haDev('ha-esp'),
  ],
  haEntities: [
    ent('ha-bulb', 'mqtt'),
    ent('ha-zstick', 'zwave_js'),
    ent('ha-lock', 'zwave_js'),
    ent('ha-esp', 'esphome'),
  ],
  configEntries: [],
  rules: {},
  existing: [],
  suppressedKeys: new Set(),
});

describe('auto-link planner', () => {
  it('links via_device children to their hub with the right protocol', () => {
    const out = plan(base());
    const bulb = out.create.find((c) => c.toDeviceId === 'L-bulb');
    expect(bulb).toMatchObject({ fromDeviceId: 'L-coord', type: 'zigbee_network', reason: 'via_device' });
    const lock = out.create.find((c) => c.toDeviceId === 'L-lock');
    expect(lock).toMatchObject({ fromDeviceId: 'L-zstick', type: 'zwave_network' });
  });

  it('skips devices with no hub and no rule, and reports which rule would fix it', () => {
    const out = plan(base());
    const esp = out.skipped.find((s) => s.deviceId === 'L-esp');
    expect(esp).toMatchObject({ reason: 'no_controller', type: 'wifi' });
    expect(out.create.some((c) => c.toDeviceId === 'L-esp')).toBe(false);
  });

  it('uses the default-controller rule when HA has no via_device', () => {
    const input = base();
    input.rules = { wifi: 'L-router' };
    const out = plan(input);
    const esp = out.create.find((c) => c.toDeviceId === 'L-esp');
    expect(esp).toMatchObject({ fromDeviceId: 'L-router', reason: 'default_controller' });
  });

  it('never links a controller to itself', () => {
    const input = base();
    input.rules = { zwave_network: 'L-zstick' };
    const out = plan(input);
    expect(out.create.some((c) => c.toDeviceId === 'L-zstick')).toBe(false);
    expect(out.skipped.find((s) => s.deviceId === 'L-zstick')?.reason).toBe('self');
  });

  it('leaves manual network links alone (manual_override)', () => {
    const input = base();
    input.existing = [
      { id: 'c1', type: 'ethernet', fromDeviceId: 'L-router', toDeviceId: 'L-esp', metadata: null },
    ];
    input.rules = { wifi: 'L-router' };
    const out = plan(input);
    expect(out.skipped.find((s) => s.deviceId === 'L-esp')?.reason).toBe('manual_override');
  });

  it('does not treat a manual power link as a network override', () => {
    const input = base();
    input.existing = [
      { id: 'c1', type: 'mains_230v', fromDeviceId: 'L-router', toDeviceId: 'L-bulb', metadata: null },
    ];
    const out = plan(input);
    expect(out.create.some((c) => c.toDeviceId === 'L-bulb')).toBe(true);
  });

  it('honours caller-supplied override types (e.g. a custom proprietary radio)', () => {
    const input = base();
    input.rules = { wifi: 'L-router' };
    input.existing = [
      { id: 'c1', type: 'arlo_wireless', fromDeviceId: 'L-coord', toDeviceId: 'L-esp', metadata: null },
    ];
    expect(plan(input).create.some((c) => c.toDeviceId === 'L-esp')).toBe(true);
    input.overrideTypes = new Set(['arlo_wireless']);
    const out = plan(input);
    expect(out.create.some((c) => c.toDeviceId === 'L-esp')).toBe(false);
    expect(out.skipped.find((s) => s.deviceId === 'L-esp')?.reason).toBe('manual_override');
  });

  it('respects suppressions and removes the stale managed link', () => {
    const input = base();
    const key = autoKeyFor('ha-bulb');
    input.suppressedKeys = new Set([key]);
    input.existing = [
      {
        id: 'c1',
        type: 'zigbee_network',
        fromDeviceId: 'L-coord',
        toDeviceId: 'L-bulb',
        metadata: { auto: true, autoKey: key, reason: 'via_device', platforms: ['mqtt'] },
      },
    ];
    const out = plan(input);
    expect(out.skipped.find((s) => s.deviceId === 'L-bulb')?.reason).toBe('suppressed');
    expect(out.remove.map((r) => r.autoKey)).toEqual([key]);
  });

  it('reports unchanged when the managed link already matches, update when the hub moved', () => {
    const input = base();
    const key = autoKeyFor('ha-bulb');
    input.existing = [
      {
        id: 'c1',
        type: 'zigbee_network',
        fromDeviceId: 'L-coord',
        toDeviceId: 'L-bulb',
        metadata: { auto: true, autoKey: key, reason: 'via_device', platforms: ['mqtt'] },
      },
    ];
    expect(plan(input).unchanged).toBe(1);

    input.existing[0].fromDeviceId = 'L-router'; // stale: hub changed
    const out = plan(input);
    expect(out.update).toHaveLength(1);
    expect(out.update[0].previous?.fromDeviceId).toBe('L-router');
  });

  it('suggests hubs by child count and network gear for wifi/ethernet', () => {
    const out = plan(base());
    expect(out.controllerSuggestions['zigbee_network'][0]).toMatchObject({
      deviceId: 'L-coord',
      childCount: 1,
    });
    expect(out.controllerSuggestions['wifi'].some((c) => c.deviceId === 'L-router')).toBe(true);
  });

  it('ignores HA service entries (integration accounts, not hardware)', () => {
    const input = base();
    input.rules = { wifi: 'L-router' };
    input.haDevices.push(haDev('ha-acct', { entry_type: 'service' }));
    input.localDevices.push({ id: 'L-acct', name: 'Cloud account', haDeviceId: 'ha-acct', category: null });
    input.haEntities.push(ent('ha-acct', 'esphome'));
    const out = plan(input);
    expect(out.create.some((c) => c.toDeviceId === 'L-acct')).toBe(false);
    expect(out.skipped.some((s) => s.deviceId === 'L-acct')).toBe(false);
  });

  it('ignores account pseudo-devices named after an email address', () => {
    const input = base();
    input.rules = { wifi: 'L-router' };
    input.haDevices.push(haDev('ha-acct2', { name: 'Aarlo for someone@example.com', model: null }));
    input.localDevices.push({ id: 'L-acct2', name: 'Aarlo acct', haDeviceId: 'ha-acct2', category: null });
    input.haEntities.push(ent('ha-acct2', 'aarlo'));
    expect(plan(input).create.some((c) => c.toDeviceId === 'L-acct2')).toBe(false);
  });

  it('surfaces platforms it cannot classify instead of guessing', () => {
    const input = base();
    input.haDevices.push(haDev('ha-mystery'));
    input.localDevices.push({ id: 'L-m', name: 'Mystery', haDeviceId: 'ha-mystery', category: null });
    input.haEntities.push(ent('ha-mystery', 'some_new_integration'));
    const out = plan(input);
    expect(out.unmappedPlatforms).toContain('some_new_integration');
    expect(out.skipped.find((s) => s.deviceId === 'L-m')?.reason).toBe('unknown_protocol');
  });
});
