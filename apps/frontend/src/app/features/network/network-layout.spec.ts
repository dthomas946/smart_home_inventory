import { NetworkGraphDto } from '@smart-home-inventory/shared';
import { layoutGraph } from './network-layout';

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
