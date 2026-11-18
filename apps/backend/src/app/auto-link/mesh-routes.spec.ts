import { parseLosslessJson, threadHops, zigbeeHops, zwaveHop, ZhaDevice } from './mesh-routes';

describe('zigbeeHops', () => {
  const coord: ZhaDevice = {
    ieee: '00:00:00:00:00:00:00:01',
    nwk: '0x0000',
    device_type: 'Coordinator',
    device_reg_id: 'coord',
    neighbors: [{ ieee: 'aa:aa', lqi: '250', relationship: 'NoneOfTheAbove' }],
  };
  const a: ZhaDevice = {
    ieee: 'aa:aa',
    nwk: '0x18E2',
    device_type: 'Router',
    device_reg_id: 'A',
    neighbors: [{ ieee: '00:00:00:00:00:00:00:01', lqi: '240' }, { ieee: 'bb:bb', lqi: '90', relationship: 'Child' }],
    routes: [{ dest_nwk: '0x0000', next_hop: '0x0000', route_status: 'Active' }],
  };
  const b: ZhaDevice = {
    ieee: 'cc:cc',
    nwk: '0x6ADD',
    device_type: 'Router',
    device_reg_id: 'B',
    neighbors: [{ ieee: 'aa:aa', lqi: '80' }],
    routes: [
      { dest_nwk: '0x0000', next_hop: '0x344F', route_status: 'Discovery_Underway' },
      { dest_nwk: '0x0000', next_hop: '0x18e2', route_status: 'Active' },
    ],
  };
  const endDevice: ZhaDevice = { ieee: 'bb:bb', nwk: '0x1234', device_type: 'EndDevice', device_reg_id: 'E' };

  it('follows the active route toward the coordinator', () => {
    const hops = zigbeeHops([coord, a, b, endDevice]);
    const by = (id: string) => hops.find((h) => h.child === id);
    expect(by('A')?.parent).toBeNull();
    expect(by('A')?.lqi).toBe(240);
    expect(by('B')?.parent).toBe('A');
    expect(by('B')?.quality).toBe('poor'); // LQI 80
  });

  it('places end devices under the router that lists them as a child', () => {
    expect(zigbeeHops([coord, a, b, endDevice]).find((h) => h.child === 'E')?.parent).toBe('A');
  });
});

describe('zwaveHop', () => {
  it('uses the last repeater of the last working route', () => {
    const h = zwaveHop('D', { lwr: { repeaters: ['R1', 'R2'], rssi: -60 } }, new Map());
    expect(h?.parent).toBe('R2');
    expect(h?.quality).toBe('good');
  });
  it('is direct with no repeaters and resolves node ids', () => {
    expect(zwaveHop('D', { lwr: { repeaters: [], rssi: 127 } }, new Map())?.parent).toBeNull();
    expect(zwaveHop('D', { lwr: { repeaters: [7] } }, new Map([[7, 'R7']]))?.parent).toBe('R7');
  });
  it('skips devices with no route yet', () => {
    expect(zwaveHop('D', { lwr: null }, new Map())).toBeNull();
  });
});

describe('threadHops', () => {
  // Shapes as returned by the Matter server on a real install.
  const lock = {
    node_id: 47,
    attributes: {
      '0/53/1': 2,
      '0/53/7': [{ '0': 7982397072333285214, '2': 62464, '5': 3, '6': -40, '13': false }],
    },
  };
  const lock2 = {
    node_id: 3,
    attributes: { '0/53/1': 2, '0/53/7': [{ '0': 3895800706570844868, '2': 60416, '5': 1, '6': -88, '13': false }] },
  };
  const diag = new Map([
    ['plug', { nodeId: 43, mac: '6e:c7:2b:d8:40:8b:27:5e' }],
    ['lock', { nodeId: 47, mac: null }],
    ['lock2', { nodeId: 3, mac: null }],
  ]);

  it('maps an end device to the router whose ext address matches', () => {
    const hops = threadHops([lock, lock2], diag, 'ea57bf7f2f494a98');
    expect(hops.find((h) => h.child === 'lock')).toMatchObject({ parent: 'plug', quality: 'good' });
  });

  it('names routers Home Assistant does not know', () => {
    const h = threadHops([lock2], diag, 'ea57bf7f2f494a98')[0];
    expect(h.parent).toBeNull();
    expect(h.viaUnknown).toContain('0xec00');
    expect(h.quality).toBe('poor');
  });

  it('treats the border router as direct', () => {
    const h = threadHops([lock], diag, '6ec72bd8408b275e')[0];
    expect(h.parent).toBeNull();
    expect(h.viaUnknown).toBeUndefined();
  });
});

describe('parseLosslessJson', () => {
  it('keeps 64-bit integers exact so Thread addresses match', () => {
    const raw = '{"0/53/1":2,"0/53/7":[{"0":7982397072333285214,"2":62464,"5":3,"13":false}]}';
    const attrs = parseLosslessJson(raw) as Record<string, unknown>;
    const nb = (attrs['0/53/7'] as Array<Record<string, unknown>>)[0];
    expect(nb['0']).toBe('7982397072333285214');
    expect(nb['2']).toBe(62464);
    const hops = threadHops([{ node_id: 47, attributes: attrs }], new Map([
      ['plug', { nodeId: 43, mac: '6e:c7:2b:d8:40:8b:27:5e' }],
      ['lock', { nodeId: 47, mac: null }],
    ]), null);
    expect(hops[0].parent).toBe('plug');
  });
});
