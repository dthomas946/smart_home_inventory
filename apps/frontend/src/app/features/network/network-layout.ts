import { NetworkGraphDto, NetworkGraphEdgeDto, NetworkGraphNodeDto } from '@smart-home-inventory/shared';

/**
 * Hub-and-spoke layout for the network map. Pure functions, no DOM.
 *
 * The graph is a forest in practice (device → controller → router), so each
 * root (a controller nobody links *up* to) becomes a radial tree: root at
 * the centre, direct children on ring 1, their children on ring 2, with
 * angular space allocated by subtree size so dense hubs don't overlap.
 * Trees are then packed on a grid sized by their radius. Devices with no
 * connections at all are left out (the page offers a list for them).
 */

export interface LaidOutNode {
  node: NetworkGraphNodeDto;
  x: number;
  y: number;
  depth: number;
  rootId: string;
  childCount: number;
}

export interface LaidOutEdge {
  edge: NetworkGraphEdgeDto;
  from: LaidOutNode;
  to: LaidOutNode;
}

export interface Layout {
  nodes: LaidOutNode[];
  edges: LaidOutEdge[];
  width: number;
  height: number;
  unlinked: NetworkGraphNodeDto[];
}

const RING = 110; // px between depth rings
const MIN_ARC = 34; // px of ring circumference per leaf
const PAD = 60;

export function layoutGraph(graph: NetworkGraphDto, visibleTypes: Set<string>): Layout {
  const nodesById = new Map(graph.nodes.map((n) => [n.id, n]));
  const edges = graph.edges.filter(
    (e) => visibleTypes.has(e.type) && nodesById.has(e.fromDeviceId) && nodesById.has(e.toDeviceId)
  );

  const children = new Map<string, string[]>();
  const hasParent = new Set<string>();
  const linked = new Set<string>();
  for (const e of edges) {
    linked.add(e.fromDeviceId);
    linked.add(e.toDeviceId);
    // One parent per node for the tree; extra edges still draw as lines.
    if (!hasParent.has(e.toDeviceId) && e.toDeviceId !== e.fromDeviceId) {
      hasParent.add(e.toDeviceId);
      const list = children.get(e.fromDeviceId) ?? [];
      list.push(e.toDeviceId);
      children.set(e.fromDeviceId, list);
    }
  }

  // Roots: linked nodes with no parent. Cycles (a↔b) would leave none, so
  // fall back to the node with the most children.
  let roots = [...linked].filter((id) => !hasParent.has(id));
  const placed = new Set<string>();
  if (roots.length === 0 && linked.size > 0) {
    roots = [[...linked].sort((a, b) => (children.get(b)?.length ?? 0) - (children.get(a)?.length ?? 0))[0]];
  }
  roots.sort((a, b) => subtreeLeaves(b, children, new Set()) - subtreeLeaves(a, children, new Set()));

  // Lay out each tree in its own local coordinates, then pack.
  const trees: Array<{ nodes: LaidOutNode[]; radius: number }> = [];
  for (const rootId of roots) {
    if (placed.has(rootId)) continue;
    const local: LaidOutNode[] = [];
    const visited = new Set<string>();
    const depthOf = new Map<string, number>();
    radial(rootId, rootId, 0, 0, Math.PI * 2, 0, children, nodesById, local, visited, depthOf);
    for (const n of local) placed.add(n.node.id);
    const maxDepth = Math.max(0, ...local.map((n) => n.depth));
    trees.push({ nodes: local, radius: Math.max(RING * maxDepth, RING * 0.6) + PAD });
  }
  // Nodes reachable only through a cycle not covered by a root.
  for (const id of linked) {
    if (placed.has(id)) continue;
    const local: LaidOutNode[] = [];
    radial(id, id, 0, 0, Math.PI * 2, 0, children, nodesById, local, new Set(), new Map());
    for (const n of local) placed.add(n.node.id);
    const maxDepth = Math.max(0, ...local.map((n) => n.depth));
    trees.push({ nodes: local, radius: Math.max(RING * maxDepth, RING * 0.6) + PAD });
  }

  // Shelf packing: rows of trees, each row as tall as its tallest tree.
  const maxRowWidth = Math.max(1400, ...trees.map((t) => t.radius * 2));
  let x = 0;
  let y = 0;
  let rowH = 0;
  let width = 0;
  const out: LaidOutNode[] = [];
  for (const t of trees) {
    const d = t.radius * 2;
    if (x > 0 && x + d > maxRowWidth) {
      x = 0;
      y += rowH;
      rowH = 0;
    }
    const cx = x + t.radius;
    const cy = y + t.radius;
    for (const n of t.nodes) out.push({ ...n, x: n.x + cx, y: n.y + cy });
    x += d;
    rowH = Math.max(rowH, d);
    width = Math.max(width, x);
  }
  const height = y + rowH;

  const byId = new Map(out.map((n) => [n.node.id, n]));
  const laidEdges: LaidOutEdge[] = [];
  for (const e of edges) {
    const from = byId.get(e.fromDeviceId);
    const to = byId.get(e.toDeviceId);
    if (from && to) laidEdges.push({ edge: e, from, to });
  }

  return {
    nodes: out,
    edges: laidEdges,
    width: Math.max(width, 1),
    height: Math.max(height, 1),
    unlinked: graph.nodes.filter((n) => !linked.has(n.id)),
  };
}

function subtreeLeaves(id: string, children: Map<string, string[]>, seen: Set<string>): number {
  if (seen.has(id)) return 0;
  seen.add(id);
  const kids = children.get(id) ?? [];
  if (kids.length === 0) return 1;
  let n = 0;
  for (const k of kids) n += subtreeLeaves(k, children, seen);
  return Math.max(n, 1);
}

function radial(
  id: string,
  rootId: string,
  depth: number,
  a0: number,
  a1: number,
  parentAngle: number,
  children: Map<string, string[]>,
  nodesById: Map<string, NetworkGraphNodeDto>,
  out: LaidOutNode[],
  visited: Set<string>,
  depthOf: Map<string, number>
): void {
  if (visited.has(id)) return;
  visited.add(id);
  depthOf.set(id, depth);
  const node = nodesById.get(id);
  if (!node) return;
  const kids = (children.get(id) ?? []).filter((k) => !visited.has(k));
  const r = RING * depth;
  const angle = depth === 0 ? 0 : (a0 + a1) / 2;
  out.push({
    node,
    x: depth === 0 ? 0 : Math.cos(angle) * r,
    y: depth === 0 ? 0 : Math.sin(angle) * r,
    depth,
    rootId,
    childCount: kids.length,
  });
  if (kids.length === 0) return;

  // Ring 1 may need to be wider than the arc allows: widen by bumping the
  // effective radius is not possible per-node, so instead we accept crowding
  // and rely on label de-clutter in the view (labels only on hover for deep
  // rings). Allocate angle by leaf weight.
  const seen = new Set(visited);
  const weights = kids.map((k) => subtreeLeaves(k, children, seen));
  const total = weights.reduce((s, w) => s + w, 0) || 1;
  // Children of the root use the full circle; deeper nodes fan outward
  // around their own angle but may borrow up to the full span if the ring
  // is crowded (MIN_ARC per leaf on the next ring).
  const nextR = RING * (depth + 1);
  const needed = (total * MIN_ARC) / nextR; // radians needed
  let span = depth === 0 ? Math.PI * 2 : a1 - a0;
  let start = depth === 0 ? -Math.PI / 2 : a0;
  if (depth > 0 && needed > span) {
    span = Math.min(needed, Math.PI * 1.5);
    start = angle - span / 2;
  }
  let cursor = start;
  kids.forEach((k, i) => {
    const slice = (span * weights[i]) / total;
    radial(k, rootId, depth + 1, cursor, cursor + slice, angle, children, nodesById, out, visited, depthOf);
    cursor += slice;
  });
}
