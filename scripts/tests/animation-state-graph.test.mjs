import '../adapters/node-studio-core.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createAnimationStateGraph, isAnimationStateGraph, layoutAnimationStateGraph } from '../../engine/animation-state-graph.mjs';

const table = () => ({ initialState: 'action', states: [{ key: 'idle' }, { key: 'action' }, { key: 'isolated' }], transitions: [
  { from: 'idle', to: 'action', trigger: { kind: 'event', name: 'attack' } },
  { from: 'action', to: 'idle', trigger: { kind: 'completed' } },
  { from: 'action', to: 'action', trigger: { kind: 'event', name: 'again' } },
  { from: 'idle', to: 'action', trigger: { kind: 'event', name: 'completed' } },
  { from: 'idle', to: 'action', trigger: { kind: 'completed' } },
] });
const clone = value => structuredClone(value);
function deeplyFrozen(value) {
  if (value && typeof value === 'object') {
    assert.equal(Object.isFrozen(value), true);
    Object.values(value).forEach(deeplyFrozen);
  }
}
function assertGeometry(graph, layout) {
  assert.deepEqual(Object.keys(layout), ['width', 'height', 'nodes', 'routes']);
  assert.ok(Number.isFinite(layout.width) && layout.width > 0 && layout.width <= 1368);
  assert.ok(Number.isFinite(layout.height) && layout.height > 0 && layout.height <= 832);
  assert.equal(layout.nodes.length, graph.nodes.length);
  for (const [index, node] of layout.nodes.entries()) {
    assert.deepEqual(Object.keys(node), ['index', 'x', 'y', 'width', 'height']);
    assert.equal(node.index, index);
    assert.ok(Object.values(node).every(Number.isFinite));
    assert.ok(node.x >= 0 && node.y >= 0 && node.width > 0 && node.height > 0);
    assert.ok(node.x + node.width <= layout.width && node.y + node.height <= layout.height);
    for (const other of layout.nodes.slice(index + 1)) assert.ok(node.x + node.width < other.x || other.x + other.width < node.x
      || node.y + node.height < other.y || other.y + other.height < node.y, 'node rectangles must not overlap');
  }
  const all = [];
  for (const route of layout.routes) {
    assert.deepEqual(Object.keys(route), ['fromIndex', 'toIndex', 'transitionIndices', 'path']);
    assert.ok(route.transitionIndices.length > 0);
    assert.deepEqual(route.transitionIndices, [...route.transitionIndices].sort((a, b) => a - b));
    for (const index of route.transitionIndices) {
      all.push(index); const edge = graph.edges[index];
      assert.equal(edge.fromIndex, route.fromIndex); assert.equal(edge.toIndex, route.toIndex);
    }
    assert.match(route.path, /^M [-0-9. ]+(?: [LC] [-0-9. ]+)+$/);
    const coordinates = route.path.match(/-?\d+(?:\.\d+)?/g).map(Number);
    assert.equal(coordinates.length % 2, 0);
    for (let at = 0; at < coordinates.length; at += 2) {
      assert.ok(coordinates[at] >= 0 && coordinates[at] <= layout.width, route.path);
      assert.ok(coordinates[at + 1] >= 0 && coordinates[at + 1] <= layout.height, route.path);
    }
    const start = coordinates.slice(0, 2), end = coordinates.slice(-2);
    const onBorder = ([x, y], node) => ((x === node.x || x === node.x + node.width) && y >= node.y && y <= node.y + node.height)
      || ((y === node.y || y === node.y + node.height) && x >= node.x && x <= node.x + node.width);
    assert.ok(onBorder(start, layout.nodes[route.fromIndex]), route.path);
    assert.ok(onBorder(end, layout.nodes[route.toIndex]), route.path);
    if (route.fromIndex === route.toIndex) assert.notDeepEqual(start, end, 'self loops use different directional ports');
  }
  assert.deepEqual(all.sort((a, b) => a - b), graph.edges.map(edge => edge.index), 'no transition may be omitted or duplicated');
  deeplyFrozen(layout);
}

test('graph projection preserves author indices initial choice isolated nodes and every distinct trigger without mutating the table', () => {
  const input = table(), before = clone(input), graph = createAnimationStateGraph(input);
  assert.equal(isAnimationStateGraph(graph), true);
  assert.deepEqual(Object.keys(graph), ['initialIndex', 'nodes', 'edges']);
  assert.equal(graph.initialIndex, 1);
  assert.deepEqual(graph.nodes, [{ index: 0, key: 'idle', initial: false }, { index: 1, key: 'action', initial: true }, { index: 2, key: 'isolated', initial: false }]);
  assert.deepEqual(graph.edges.map(({ index, fromIndex, toIndex, trigger }) => ({ index, fromIndex, toIndex, trigger })), [
    { index: 0, fromIndex: 0, toIndex: 1, trigger: { kind: 'event', name: 'attack' } },
    { index: 1, fromIndex: 1, toIndex: 0, trigger: { kind: 'completed' } },
    { index: 2, fromIndex: 1, toIndex: 1, trigger: { kind: 'event', name: 'again' } },
    { index: 3, fromIndex: 0, toIndex: 1, trigger: { kind: 'event', name: 'completed' } },
    { index: 4, fromIndex: 0, toIndex: 1, trigger: { kind: 'completed' } },
  ]);
  assert.deepEqual(input, before); deeplyFrozen(graph);
  input.states[0].key = 'changed'; input.transitions[0].trigger.name = 'different';
  assert.equal(graph.nodes[0].key, 'idle'); assert.equal(graph.edges[0].trigger.name, 'attack');
  assert.throws(() => graph.edges.push({}), TypeError);
});

test('parallel transitions group only by exact ordered endpoints while opposite routes and self loops remain distinct', () => {
  const graph = createAnimationStateGraph(table()), layout = layoutAnimationStateGraph(graph);
  assert.deepEqual(layout.routes.map(({ fromIndex, toIndex, transitionIndices }) => ({ fromIndex, toIndex, transitionIndices })), [
    { fromIndex: 0, toIndex: 1, transitionIndices: [0, 3, 4] },
    { fromIndex: 1, toIndex: 0, transitionIndices: [1] },
    { fromIndex: 1, toIndex: 1, transitionIndices: [2] },
  ]);
  assert.notEqual(layout.routes[0].path, layout.routes[1].path);
  assert.match(layout.routes[2].path, / C /);
  assertGeometry(graph, layout);
  assert.deepEqual(layoutAnimationStateGraph(graph), layout);
  assert.deepEqual(layoutAnimationStateGraph(createAnimationStateGraph(table())), layout);
});

test('single-state empty and self-loop tables are complete valid graphs with bounded geometry', () => {
  for (const transitions of [[], [{ from: 'only', to: 'only', trigger: { kind: 'completed' } }]]) {
    const graph = createAnimationStateGraph({ initialState: 'only', states: [{ key: 'only' }], transitions });
    const layout = layoutAnimationStateGraph(graph);
    assert.equal(graph.nodes[0].initial, true); assert.equal(graph.initialIndex, 0);
    assert.equal(layout.routes.length, transitions.length); assertGeometry(graph, layout);
  }
});

test('all author orders from one to sixteen states and cross-row cycles retain finite deterministic nonoverlapping geometry', () => {
  for (let count = 1; count <= 16; count++) {
    const input = { initialState: `s${count - 1}`, states: Array.from({ length: count }, (_, index) => ({ key: `s${index}` })), transitions: [] };
    for (let index = 0; index < count; index++) {
      const next = (index + 1) % count;
      input.transitions.push({ from: `s${index}`, to: `s${next}`, trigger: { kind: 'event', name: 'forward' } },
        { from: `s${index}`, to: `s${(index + count - 1) % count}`, trigger: { kind: 'completed' } });
    }
    const graph = createAnimationStateGraph(input), layout = layoutAnimationStateGraph(graph);
    assert.equal(graph.initialIndex, count - 1); assertGeometry(graph, layout);
    assert.deepEqual(layoutAnimationStateGraph(createAnimationStateGraph(input)), layout);
  }
});

test('maximum sixteen states and sixty-four transitions preserve every event and route', () => {
  const input = { initialState: 's15', states: Array.from({ length: 16 }, (_, index) => ({ key: `s${index}` })),
    transitions: Array.from({ length: 64 }, (_, index) => ({ from: `s${Math.floor(index / 4)}`, to: `s${index % 4}`,
      trigger: { kind: 'event', name: `Event${index % 4}` } })) };
  const graph = createAnimationStateGraph(input), layout = layoutAnimationStateGraph(graph);
  assert.equal(graph.nodes.length, 16); assert.equal(graph.edges.length, 64); assert.equal(layout.routes.length, 64);
  assertGeometry(graph, layout);
  const events = { initialState: 's1', states: [{ key: 's0' }, { key: 's1' }], transitions: Array.from({ length: 64 }, (_, index) => ({
    from: `s${Math.floor(index / 32)}`, to: 's1', trigger: { kind: 'event', name: `Event${index % 32}` },
  })) };
  assert.equal(createAnimationStateGraph(events).edges.length, 64);
  events.transitions[63].trigger.name = 'Event32';
  assert.throws(() => createAnimationStateGraph(events), { errorCode: 'animation_state_table_invalid' });
});

test('missing duplicate malformed and over-limit drafts fail admission instead of producing a partial graph', () => {
  for (const mutate of [v => v.initialState = 'missing', v => v.states = [], v => v.states[1].key = 'idle', v => v.states[0].key = '',
    v => v.states[0].key = 'idle\n', v => v.transitions[0].from = '', v => v.transitions[0].to = 'missing',
    v => v.transitions.push(clone(v.transitions[0])), v => v.transitions.push({ from: 'action', to: 'isolated', trigger: { kind: 'completed' } }),
    v => v.transitions[0].trigger = { kind: 'unknown' }, v => v.transitions[0].trigger.name = 'attack\n',
    v => v.states = Array.from({ length: 17 }, (_, index) => ({ key: `s${index}` })),
    v => v.transitions = Array.from({ length: 65 }, (_, index) => ({ from: 'idle', to: 'action', trigger: { kind: 'event', name: `e${index}` } })),
    v => v.extra = true]) {
    const input = table(); mutate(input); const before = clone(input);
    assert.throws(() => createAnimationStateGraph(input), { errorCode: 'animation_state_table_invalid' }); assert.deepEqual(input, before);
  }
  const valid = createAnimationStateGraph(table()); assertGeometry(valid, layoutAnimationStateGraph(valid));
});

test('accessors and serializer functions are never invoked during strict core admission', () => {
  let calls = 0;
  for (const mutate of [v => Object.defineProperty(v, 'initialState', { enumerable: true, get() { calls++; return 'idle'; } }),
    v => Object.defineProperty(v.states[0], 'key', { enumerable: true, get() { calls++; return 'idle'; } }),
    v => v.toJSON = () => { calls++; return table(); }, v => delete v.states[0]]) {
    const input = table(); mutate(input);
    assert.throws(() => createAnimationStateGraph(input), { errorCode: 'studio_core_request_invalid' });
  }
  assert.equal(calls, 0);
});

test('layout only accepts its private admitted graph, not mutable or serialized lookalikes', () => {
  const graph = createAnimationStateGraph(table());
  for (const value of [null, undefined, false, 0, '', [], {}, clone(graph), Object.freeze(clone(graph)), new Proxy(graph, {})]) {
    assert.equal(isAnimationStateGraph(value), false);
    assert.throws(() => layoutAnimationStateGraph(value), { errorCode: 'animation_state_graph_invalid' });
  }
  assert.equal(isAnimationStateGraph(graph), true); assertGeometry(graph, layoutAnimationStateGraph(graph));
});

test('a fresh host without the core cannot infer a ready graph from a valid draft', () => {
  const url = new URL('../../engine/animation-state-graph.mjs', import.meta.url).href;
  const source = `import assert from 'node:assert/strict'; import {createAnimationStateGraph} from ${JSON.stringify(url)};
    assert.throws(() => createAnimationStateGraph(${JSON.stringify(table())}), {errorCode:'studio_core_unavailable'});`;
  const result = spawnSync(process.execPath, ['--input-type=module', '-e', source], { encoding: 'utf8', timeout: 10000 });
  assert.equal(result.error, undefined); assert.equal(result.signal, null); assert.equal(result.status, 0, result.stderr);
});


test('all ordered endpoint pairs route through gutters without crossing state rectangles', () => {
  const states = Array.from({ length: 16 }, (_, index) => ({ key: `s${index}` }));
  for (const first of [0, 4, 8, 12]) {
    const transitions = Array.from({ length: 64 }, (_, index) => ({ from: `s${first + Math.floor(index / 16)}`, to: `s${index % 16}`,
      trigger: { kind: 'event', name: `event${index % 16}` } }));
    const graph = createAnimationStateGraph({ initialState: 's13', states, transitions }), layout = layoutAnimationStateGraph(graph);
    assertGeometry(graph, layout);
    for (const route of layout.routes) {
      let point;
      for (const command of route.path.match(/[MLC][^MLC]*/g)) {
        const kind = command[0], values = command.slice(1).trim().split(/ +/).map(Number), end = values.slice(-2);
        if (kind === 'L') {
          const [x1, y1] = point, [x2, y2] = end;
          assert.ok(x1 === x2 || y1 === y2, 'line segments remain orthogonal');
          for (const node of layout.nodes) {
            const crosses = y1 === y2
              ? y1 > node.y && y1 < node.y + node.height && Math.max(x1, x2) > node.x && Math.min(x1, x2) < node.x + node.width
              : x1 > node.x && x1 < node.x + node.width && Math.max(y1, y2) > node.y && Math.min(y1, y2) < node.y + node.height;
            assert.equal(crosses, false, `route ${route.fromIndex}->${route.toIndex} crosses state ${node.index}`);
          }
        } else if (kind === 'C') {
          for (let step = 1; step <= 64; step++) {
            const t = step / 64, u = 1 - t;
            const x = u ** 3 * point[0] + 3 * u ** 2 * t * values[0] + 3 * u * t ** 2 * values[2] + t ** 3 * values[4];
            const y = u ** 3 * point[1] + 3 * u ** 2 * t * values[1] + 3 * u * t ** 2 * values[3] + t ** 3 * values[5];
            for (const node of layout.nodes) assert.equal(x > node.x && x < node.x + node.width && y > node.y && y < node.y + node.height,
              false, `self-loop enters state ${node.index}`);
          }
        }
        point = end;
      }
    }
  }
});
