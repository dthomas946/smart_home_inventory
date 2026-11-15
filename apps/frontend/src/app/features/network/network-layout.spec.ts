import { NetworkGraphDto } from '@smart-home-inventory/shared';
import { H_WRAP, layoutGraph, layoutHierarchy } from './network-layout';

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

  it('wraps mixed children (controllers + end devices) at 5 too', () => {
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

  it('packs many separate trees 5 per row', () => {
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
    expect(perRow.size).toBe(3);
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
