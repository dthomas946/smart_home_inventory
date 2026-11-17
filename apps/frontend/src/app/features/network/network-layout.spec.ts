import { NetworkGraphDto } from '@smart-home-inventory/shared';
import { reflowPositions, branchType, withTypeBranches, downstreamOf, H_WRAP, layoutGraph, layoutHierarchy, snapToGrid } from './network-layout';

const node = (id: string, isController = false): NetworkGraphDto['nodes'][number] => ({
  id,
  name: id,
  category: null,
  areaName: null,
  brand: null,
  manufacturer: null,
  model: null,
  source: 'ha',
  isController,
});
const edge = (from: string, to: string, type = 'zigbee_network'): NetworkGraphDto['edges'][number] => ({
  id: `${from}-${to}`,
  type: type as never,
  fromDeviceId: from,
  toDeviceId: to,
  auto: true,
  label: null,
});

const graph: NetworkGraphDto = {
  nodes: [node('router', true), node('coord', true), node('a'), node('b'), node('c'), node('lonely')],
  edges: [edge('router', 'coord', 'ethernet'), edge('coord', 'a'), edge('coord', 'b'), edge('coord', 'c')],
  types: [],
};

describe('layoutGraph', () => {
  it('places the root at depth 0 and children on increasing rings', () => {
    const l = layoutGraph(graph, new Set(['zigbee_network', 'ethernet']));
    const by = new Map(l.nodes.map((n) => [n.node.id, n]));
    expect(by.get('router')?.depth).toBe(0);
    expect(by.get('coord')?.depth).toBe(1);
    expect(by.get('a')?.depth).toBe(2);
    expect(l.edges).toHaveLength(4);
  });

  it('keeps unlinked devices out of the drawing but reports them', () => {
    const l = layoutGraph(graph, new Set(['zigbee_network', 'ethernet']));
    expect(l.nodes.some((n) => n.node.id === 'lonely')).toBe(false);
    expect(l.unlinked.map((n) => n.id)).toEqual(['lonely']);
  });

  it('hiding a type removes its edges and re-roots the remaining tree', () => {
    const l = layoutGraph(graph, new Set(['zigbee_network']));
    const by = new Map(l.nodes.map((n) => [n.node.id, n]));
    expect(by.has('router')).toBe(false);
    expect(by.get('coord')?.depth).toBe(0);
  });

  it('does not stack siblings on the same point', () => {
    const l = layoutGraph(graph, new Set(['zigbee_network', 'ethernet']));
    const leaves = l.nodes.filter((n) => n.depth === 2);
    const keys = new Set(leaves.map((n) => `${Math.round(n.x)},${Math.round(n.y)}`));
    expect(keys.size).toBe(leaves.length);
  });

  it('survives a cycle', () => {
    const cyc: NetworkGraphDto = {
      nodes: [node('x'), node('y')],
      edges: [edge('x', 'y'), edge('y', 'x')],
      types: [],
    };
    const l = layoutGraph(cyc, new Set(['zigbee_network']));
    expect(l.nodes).toHaveLength(2);
    expect(l.edges).toHaveLength(2);
  });
});

describe('layoutHierarchy', () => {
  const all = new Set(['zigbee_network', 'ethernet', 'wifi']);

  it('puts controllers above the devices they serve', () => {
    const l = layoutHierarchy(graph, all);
    const by = new Map(l.nodes.map((n) => [n.node.id, n]));
    expect(by.get('router')!.y).toBeLessThan(by.get('coord')!.y);
    expect(by.get('coord')!.y).toBeLessThan(by.get('a')!.y);
    // parent is centred over its children
    const kidsX = ['a', 'b', 'c'].map((id) => by.get(id)!.x);
    const mid = (Math.min(...kidsX) + Math.max(...kidsX)) / 2;
    expect(Math.abs(by.get('coord')!.x - mid)).toBeLessThan(1);
  });

  it('wraps a hub with many leaf clients into rows instead of one wide row', () => {
    const many: NetworkGraphDto = {
      nodes: [node('orbi', true), ...Array.from({ length: 30 }, (_, i) => node(`c${i}`))],
      edges: Array.from({ length: 30 }, (_, i) => edge('orbi', `c${i}`, 'wifi')),
      types: [],
    };
    const l = layoutHierarchy(many, all);
    const leaves = l.nodes.filter((n) => n.node.id !== 'orbi');
    const rows = new Set(leaves.map((n) => n.y));
    expect(rows.size).toBeGreaterThan(1);
    const keys = new Set(leaves.map((n) => `${n.x},${n.y}`));
    expect(keys.size).toBe(30);
    expect(l.width).toBeLessThan(30 * 140);
    // never more than H_WRAP (5) in any row
    const perRow = new Map<number, number>();
    for (const n of leaves) perRow.set(n.y, (perRow.get(n.y) ?? 0) + 1);
    expect(Math.max(...perRow.values())).toBeLessThanOrEqual(H_WRAP);
  });

  it('wraps mixed children (controllers + end devices) too', () => {
    const kids = Array.from({ length: 12 }, (_, i) => node(`k${i}`, i < 3));
    const grand = [0, 1, 2].flatMap((i) => [node(`g${i}a`), node(`g${i}b`)]);
    const g: NetworkGraphDto = {
      nodes: [node('root', true), ...kids, ...grand],
      edges: [
        ...kids.map((k) => edge('root', k.id, 'wifi')),
        ...[0, 1, 2].flatMap((i) => [edge(`k${i}`, `g${i}a`), edge(`k${i}`, `g${i}b`)]),
      ],
      types: [],
    };
    const l = layoutHierarchy(g, all);
    const depth1 = l.nodes.filter((n) => n.depth === 1);
    const perRow = new Map<number, number>();
    for (const n of depth1) perRow.set(n.y, (perRow.get(n.y) ?? 0) + 1);
    expect(perRow.size).toBeGreaterThan(1);
    expect(Math.max(...perRow.values())).toBeLessThanOrEqual(H_WRAP);
    const keys = new Set(l.nodes.map((n) => `${Math.round(n.x)},${Math.round(n.y)}`));
    expect(keys.size).toBe(l.nodes.length);
  });

  it('honours a custom wrap width', () => {
    const kids = Array.from({ length: 10 }, (_, i) => node(`k${i}`));
    const g: NetworkGraphDto = {
      nodes: [node('hub', true), ...kids],
      edges: kids.map((k) => edge('hub', k.id)),
      types: [],
    };
    const perRow = (wrap: number) => {
      const rows = new Map<number, number>();
      for (const n of layoutHierarchy(g, new Set(['zigbee_network']), wrap).nodes) {
        if (n.id !== 'hub') rows.set(n.y, (rows.get(n.y) ?? 0) + 1);
      }
      return Math.max(...rows.values());
    };
    expect(perRow(5)).toBe(5);
    expect(perRow(2)).toBe(2);
  });

  it('packs many separate trees H_WRAP per row', () => {
    const nodes = Array.from({ length: 12 }, (_, i) => [node(`r${i}`, true), node(`c${i}`)]).flat();
    const g: NetworkGraphDto = {
      nodes,
      edges: Array.from({ length: 12 }, (_, i) => edge(`r${i}`, `c${i}`)),
      types: [],
    };
    const l = layoutHierarchy(g, all);
    const roots = l.nodes.filter((n) => n.depth === 0);
    const perRow = new Map<number, number>();
    for (const n of roots) perRow.set(n.y, (perRow.get(n.y) ?? 0) + 1);
    expect(perRow.size).toBe(Math.ceil(12 / H_WRAP));
    expect(Math.max(...perRow.values())).toBe(H_WRAP);
  });

  it('places separate trees side by side without overlap', () => {
    const two: NetworkGraphDto = {
      nodes: [node('r1', true), node('a'), node('r2', true), node('b')],
      edges: [edge('r1', 'a'), edge('r2', 'b')],
      types: [],
    };
    const l = layoutHierarchy(two, all);
    const by = new Map(l.nodes.map((n) => [n.node.id, n]));
    expect(by.get('r1')!.x).not.toBe(by.get('r2')!.x);
    expect(l.unlinked).toEqual([]);
  });

  it('survives a cycle', () => {
    const cyc: NetworkGraphDto = {
      nodes: [node('x'), node('y')],
      edges: [edge('x', 'y'), edge('y', 'x')],
      types: [],
    };
    const l = layoutHierarchy(cyc, all);
    expect(l.nodes).toHaveLength(2);
  });
});

describe('downstreamOf', () => {
  const edges = [
    { fromId: 'panel', toId: 'b1' },
    { fromId: 'panel', toId: 'b2' },
    { fromId: 'b1', toId: 'lamp' },
    { fromId: 'lamp', toId: 'panel' }, // cycle
  ];
  it('collects every device below, cycle-safe', () => {
    expect(downstreamOf(edges, 'panel').sort()).toEqual(['b1', 'b2', 'lamp']);
  });
  it('is empty for the lowest level', () => {
    expect(downstreamOf(edges, 'b2')).toEqual([]);
  });
});

describe('snapToGrid', () => {
  it('rounds to the nearest grid line', () => {
    expect(snapToGrid(29)).toBe(20);
    expect(snapToGrid(31)).toBe(40);
    expect(snapToGrid(-11)).toBe(-20);
  });
});

describe('withTypeBranches', () => {
  const g: NetworkGraphDto = {
    nodes: [node('router', true), node('pc'), node('tv'), node('phone'), node('printer'), node('hub', true), node('lamp')],
    edges: [
      edge('router', 'pc', 'ethernet'),
      edge('router', 'tv', 'ethernet'),
      edge('router', 'phone', 'wifi'),
      edge('router', 'printer', 'usb'),
      edge('hub', 'lamp', 'zigbee_network'),
    ],
    types: [],
  };
  const all = new Set(['ethernet', 'wifi', 'usb', 'zigbee_network']);

  it('gives each connection type its own branch under a multi-type device', () => {
    const out = withTypeBranches(g, all);
    const branches = out.nodes.filter((n) => branchType(n.id)).map((n) => branchType(n.id)).sort();
    expect(branches).toEqual(['ethernet', 'usb', 'wifi']);
    expect(out.edges.find((e) => e.toDeviceId === 'pc')?.fromDeviceId).toBe('branch:router:ethernet');
    expect(out.edges.find((e) => e.toDeviceId === 'branch:router:wifi')?.fromDeviceId).toBe('router');
  });

  it('leaves single-type devices alone and respects hidden types', () => {
    const out = withTypeBranches(g, new Set(['ethernet', 'zigbee_network']));
    expect(out.nodes.some((n) => branchType(n.id))).toBe(false);
    expect(out.edges.find((e) => e.toDeviceId === 'lamp')?.fromDeviceId).toBe('hub');
  });

  it('lays out the branches between the device and its clients', () => {
    const l = layoutHierarchy(withTypeBranches(g, all), all);
    const y = (id: string) => l.nodes.find((n) => n.node.id === id)?.y ?? NaN;
    expect(y('branch:router:ethernet')).toBeGreaterThan(y('router'));
    expect(y('pc')).toBeGreaterThan(y('branch:router:ethernet'));
  });
});

describe('per-parent wrap', () => {
  it('applies a parent\'s wrap to its whole tree, leaving others on the default', () => {
    const kidsA = Array.from({ length: 6 }, (_, i) => node(`a${i}`));
    const kidsB = Array.from({ length: 6 }, (_, i) => node(`b${i}`));
    const g: NetworkGraphDto = {
      nodes: [node('A', true), node('B', true), ...kidsA, ...kidsB],
      edges: [...kidsA.map((k) => edge('A', k.id)), ...kidsB.map((k) => edge('B', k.id))],
      types: [],
    };
    const l = layoutHierarchy(g, new Set(['zigbee_network']), 3, new Map([['A', 6]]));
    const rows = (prefix: string) => new Set(l.nodes.filter((n) => n.node.id.startsWith(prefix) && n.node.id.length > 1).map((n) => n.y)).size;
    expect(rows('a')).toBe(1); // 6 wide
    expect(rows('b')).toBe(2); // default 3 wide
  });
});

describe('reflowPositions', () => {
  // router → [wifi branch] → w0..w5 ; hub → h0 (untouched tree)
  const wifi = Array.from({ length: 6 }, (_, i) => node(`w${i}`));
  const g: NetworkGraphDto = {
    nodes: [node('router', true), node('lan'), ...wifi, node('hub', true), node('h0')],
    edges: [...wifi.map((w) => edge('router', w.id, 'wifi')), edge('router', 'lan', 'ethernet'), edge('hub', 'h0')],
    types: [],
  };
  const types = new Set(['wifi', 'ethernet', 'zigbee_network']);
  const b = withTypeBranches(g, types);

  it('keeps the dragged top device and re-wraps everything under it, branch lines included', () => {
    const old = layoutHierarchy(b, types, 3);
    const at = (id: string) => old.nodes.find((n) => n.node.id === id) as { x: number; y: number };
    // whole router tree dragged +500,+200 (devices saved, branch pill not)
    const current: Record<string, { x: number; y: number }> = {};
    for (const id of ['router', 'lan', ...wifi.map((w) => w.id)]) current[id] = { x: at(id).x + 500, y: at(id).y + 200 };
    const base = layoutHierarchy(b, types, 6);
    const next = reflowPositions(base, current);
    const nb = (id: string) => base.nodes.find((n) => n.node.id === id) as { x: number; y: number };
    expect(next['router']).toEqual(current['router']);
    const off = { x: current['router'].x - nb('router').x, y: current['router'].y - nb('router').y };
    for (const id of ['branch:router:wifi', 'w0', 'w5']) {
      expect(next[id]).toEqual({ x: Math.round(nb(id).x + off.x), y: Math.round(nb(id).y + off.y) });
    }
    expect(new Set(wifi.map((w) => next[w.id].y)).size).toBe(1); // now one row of 6
    expect(next['h0']).toBeUndefined();
  });

  it('with a scope, re-flows only that device\'s tree around it', () => {
    const current = { hub: { x: 10, y: 10 }, h0: { x: 999, y: 999 }, w0: { x: 1, y: 1 } };
    const base = layoutHierarchy(b, types, 3);
    const next = reflowPositions(base, current, 'hub');
    expect(next['hub']).toEqual({ x: 10, y: 10 });
    expect(next['h0']).not.toEqual({ x: 999, y: 999 });
    expect(next['w0']).toEqual({ x: 1, y: 1 }); // outside the scope
  });
});
