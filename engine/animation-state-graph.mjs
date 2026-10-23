// A read-only projection of the Rust-admitted current table. Neither the graph
// nor its geometry grants source editing, script generation or runtime authority.
import { inspectAnimationStateDeclarationWithCombinations as inspectAnimationStateTable } from './animation-state-conditions-core.mjs';

const graphs = new WeakSet();
const freeze = value => {
  if (value && typeof value === 'object') {
    Object.values(value).forEach(freeze);
    Object.freeze(value);
  }
  return value;
};

export function createAnimationStateGraph(table) {
  const inspected = inspectAnimationStateTable(table);
  const graph = freeze({
    initialIndex: inspected.initialIndex,
    nodes: inspected.states.map(({ index, key }) => ({ index, key, initial: index === inspected.initialIndex })),
    edges: inspected.transitions.map(({ fromIndex, toIndex, trigger }, index) => ({ index, fromIndex, toIndex, trigger: { ...trigger } })),
  });
  graphs.add(graph);
  return graph;
}

export const isAnimationStateGraph = value => Boolean(value && typeof value === 'object' && graphs.has(value));

export function layoutAnimationStateGraph(graph) {
  if (!isAnimationStateGraph(graph)) throw Object.assign(new TypeError('Expected an admitted animation state graph.'), {
    errorCode: 'animation_state_graph_invalid',
  });
  // Node coordinates are top-left corners. Fixed spacing bounds the 16-state
  // canvas without font measurements, browser state, random values or IO.
  const nodeWidth = 224, nodeHeight = 72, gapX = 104, gapY = 128, margin = 80;
  const columns = Math.min(4, graph.nodes.length), rows = Math.ceil(graph.nodes.length / columns);
  const width = margin * 2 + columns * nodeWidth + (columns - 1) * gapX;
  const height = margin * 2 + rows * nodeHeight + (rows - 1) * gapY;
  const nodes = graph.nodes.map(({ index }) => ({ index,
    x: margin + (index % columns) * (nodeWidth + gapX),
    y: margin + Math.floor(index / columns) * (nodeHeight + gapY),
    width: nodeWidth, height: nodeHeight,
  }));
  const groups = new Map();
  for (const edge of graph.edges) {
    const key = `${edge.fromIndex}:${edge.toIndex}`;
    if (!groups.has(key)) groups.set(key, { fromIndex: edge.fromIndex, toIndex: edge.toIndex, transitionIndices: [] });
    groups.get(key).transitionIndices.push(edge.index);
  }
  const routes = [...groups.values()].map((group, ordinal) => {
    const from = nodes[group.fromIndex], to = nodes[group.toIndex];
    const sx = from.x + from.width / 2, tx = to.x + to.width / 2;
    const offset = 48 + (ordinal % 4) * 4;
    let path;
    if (group.fromIndex === group.toIndex) {
      // An outward loop stays in the node's surrounding gutters and enters a
      // different port, so even a one-state table shows a directional edge.
      const startX = from.x + from.width * 3 / 4, endX = from.x + from.width;
      const endY = from.y + from.height / 4, outsideX = endX + 48;
      path = `M ${startX} ${from.y} C ${startX} ${from.y - 48} ${outsideX} ${from.y - 48} ${outsideX} ${endY} C ${outsideX} ${endY} ${endX + 24} ${endY} ${endX} ${endY}`;
    } else if (from.y === to.y) {
      // Opposite directions use opposite row gutters. Keep all intervening
      // nodes clear instead of drawing a line through their rectangles.
      const forward = group.fromIndex < group.toIndex;
      const sy = forward ? from.y : from.y + from.height;
      const ty = forward ? to.y : to.y + to.height;
      const laneY = forward ? sy - offset : sy + offset;
      path = `M ${sx} ${sy} L ${sx} ${laneY} L ${tx} ${laneY} L ${tx} ${ty}`;
    } else {
      // Cross-row routes travel through row gutters and an exterior rail;
      // descending edges use the right rail, ascending edges the left rail.
      const down = from.y < to.y;
      const sy = down ? from.y + from.height : from.y;
      const ty = down ? to.y : to.y + to.height;
      const fromLaneY = sy + (down ? offset : -offset);
      const toLaneY = ty + (down ? -offset : offset);
      const railX = down ? width - margin + offset : margin - offset;
      path = `M ${sx} ${sy} L ${sx} ${fromLaneY} L ${railX} ${fromLaneY} L ${railX} ${toLaneY} L ${tx} ${toLaneY} L ${tx} ${ty}`;
    }
    // Only indices from the admitted graph and internal finite geometry enter
    // the SVG path. State keys and trigger names remain plain text in the UI.
    return { ...group, path };
  });
  return freeze({ width, height, nodes, routes });
}
