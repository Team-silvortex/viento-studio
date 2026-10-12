// Import-free portable cases. The host supplies native-backed module APIs,
// same-realm JSON DTOs and a bare digest. No DOM, Node or execution authority.
export async function runDistributionCases(api) {
  const check = (value, message = 'Distribution portable assertion failed') => { if (!value) throw Error(message); };
  const equal = (a, b) => { if (a === b) return true; if (!a || !b || typeof a !== 'object' || typeof b !== 'object' || Array.isArray(a) !== Array.isArray(b)) return false;
    const keys = Object.keys(a); return keys.length === Object.keys(b).length && keys.every(key => Object.hasOwn(b, key) && equal(a[key], b[key])); };
  const same = (a, b) => check(equal(a, b), 'Distribution portable value mismatch');
  const throws = (action, code) => { let caught = false; try { action(); } catch (error) { caught = true; if (code) check(error.errorCode === code, `Expected ${code}, received ${error.errorCode}`); } check(caught, 'Expected distribution rejection'); };
  const rejects = async (action, code) => { let caught = false; try { await action(); } catch (error) { caught = true; if (code) check(error.errorCode === code, `Expected ${code}, received ${error.errorCode}`); } check(caught, 'Expected distribution apply rejection'); };
  const dto = value => api.realmJson ? api.realmJson(JSON.stringify(value)) : value, plain = value => JSON.parse(JSON.stringify(value));
  const id = n => `${n.toString(16).padStart(8, '0')}-1111-4111-8111-111111111111`;
  const value = { format: 'viento-scene3d', schemaVersion: 1, name: '分布 / distribute / 分配 🦊', viewport: [800, 600], background: '#0d1829',
    camera: { position: [8, 6, 8], target: [0, 0, 0], fovDegrees: 60, near: .05, far: 1000 }, light: { direction: [-1, -2, -1], color: '#ffffff', energy: 1 },
    objects: [[0, 1.5, 0], [-20.125, 20, 30], [9.125, 0, 0]].map((position, index) => ({ instanceId: id(index + 1), name: `Box 箱${index}🦊`, primitive: 'box', position,
      rotationDegrees: [23, -41, 67], size: [1.5, 3, 1.5], color: '#87d8b9' })) };
  const text = model => '\uFEFF' + JSON.stringify(model, null, '\t').replaceAll('\n', '\r\n') + '\r\n \t';
  const snapshot = (content, overrides = {}) => dto({ sourcePath: 'documents/scenes/distribution.json', token: 'prepared-distribution', content,
    baseSourceRevision: `sha256:${api.digest(content)}`, sourceRevision: `sha256:${api.digest(content)}`, ...overrides });
  const edit = (instanceIds = [id(3), id(1), id(2)], axis = 'x') => dto({ instanceIds, axis });
  const patch = (content, instanceIds, axis = 'x') => api.dispatchStudioCoreScene3DDistributionPatch(dto({ protocolVersion: 1, operation: 'scene3d.distributeObjects', content, instanceIds, axis }));
  const replace = (content, path, token) => { const range = api.locateJsonSource(api.parseJsonSource(content), path); check(range.exact); return content.slice(0, range.start) + token + content.slice(range.end); };
  function expected(content, selected, axisName) {
    const original = JSON.parse(content.replace(/^\uFEFF/, '')), axis = ['x', 'y', 'z'].indexOf(axisName);
    const ordered = original.objects.map((object, index) => ({ object, index, coordinate: object.position[axis] })).filter(row => selected.includes(row.object.instanceId))
      .sort((a, b) => a.coordinate === b.coordinate ? a.index - b.index : a.coordinate < b.coordinate ? -1 : 1);
    const start = ordered[0].coordinate, end = ordered.at(-1).coordinate, indexed = api.parseJsonSource(content), edits = [], paths = [];
    for (const [rank, row] of ordered.entries()) {
      const next = rank === 0 || rank === ordered.length - 1 || start === end ? row.coordinate : start + (end - start) * (rank / (ordered.length - 1));
      if (next !== row.coordinate) { const path = `/objects/${row.index}/position/${axis}`, range = api.locateJsonSource(indexed, path); check(range.exact); edits.push({ ...plain(range), text: JSON.stringify(next), index: row.index, path }); }
    }
    let after = content; for (const range of [...edits].sort((a, b) => b.start - a.start)) after = after.slice(0, range.start) + range.text + after.slice(range.end);
    for (const range of edits.sort((a, b) => a.index - b.index)) paths.push(range.path);
    return { after, paths, orderedInstanceIds: ordered.map(row => row.object.instanceId), instanceIds: original.objects.filter(object => selected.includes(object.instanceId)).map(object => object.instanceId) };
  }
  const checks = [];
  {
    let raw = text(value).replaceAll('"position"', '"posi\\u0074ion"').replace('"objects"', '"objec\\u0074s"').replace('1000', '1.000e3');
    raw = replace(raw, '/objects/1/position/0', '-20.125e0'); raw = replace(raw, '/objects/2/position/0', '9.125e0');
    for (const dirty of [false, true]) { const content = raw + (dirty ? ' \r\n' : ''), source = snapshot(content, { baseSourceRevision: `sha256:${api.digest(raw)}` }), before = plain(source);
      const proposal = api.createScene3DDistributionProposal(source, edit()), want = expected(content, [id(1), id(2), id(3)], 'x');
      same(plain(proposal.instanceIds), [id(1), id(2), id(3)]); same(plain(proposal.orderedInstanceIds), [id(2), id(1), id(3)]);
      check(proposal.afterContent === want.after); same(plain(proposal.changedPaths), want.paths); check(proposal.afterContent.includes('-20.125e0') && proposal.afterContent.includes('9.125e0'));
      same(plain(await api.prepareScene3DDistributionApply(source, proposal, { digest: api.digest })), { afterContent: proposal.afterContent, sourcePath: source.sourcePath, changedPaths: want.paths }); same(plain(source), before);
    }
    checks.push({ id: 'saved-dirty-BOM-CRLF-escaped-keys-fixed-endpoint-lexemes-and-complete-exact-candidate', ok: true, modes: 2 });
  }
  {
    for (const axis of ['x', 'y', 'z']) { const axisIndex = ['x', 'y', 'z'].indexOf(axis), model = plain(value); [9, -7, 0].forEach((coordinate, i) => { model.objects[i].position[axisIndex] = coordinate; });
      const content = text(model), proposal = api.createScene3DDistributionProposal(snapshot(content), edit([id(3), id(2), id(1)], axis)), wanted = plain(model); wanted.objects[2].position[axisIndex] = 1;
      same(JSON.parse(proposal.afterContent.slice(1)), wanted); same(plain(proposal.instanceIds), [id(1), id(2), id(3)]); same(plain(proposal.orderedInstanceIds), [id(2), id(3), id(1)]);
      same(plain(proposal.beforeObjects[0]), plain(proposal.afterObjects[0])); same(plain(proposal.beforeObjects[1]), plain(proposal.afterObjects[1]));
    }
    const tied = plain(value); tied.objects = [0, 0, 10, 10].map((coordinate, i) => ({ ...plain(value.objects[0]), instanceId: id(i + 1), position: [coordinate, i, 0] }));
    let raw = text(tied); raw = replace(raw, '/objects/1/position/0', '-0e0');
    const proposal = api.createScene3DDistributionProposal(snapshot(raw), edit([id(4), id(2), id(1), id(3)])); same(plain(proposal.orderedInstanceIds), [id(1), id(2), id(3), id(4)]);
    check(proposal.afterContent === expected(raw, [id(1), id(2), id(3), id(4)], 'x').after);
    checks.push({ id: 'three-author-axes-preserve-geometry-and-numeric-plus-minus-zero-ties-use-declaration-order', ok: true, axes: 3 });
  }
  {
    for (const coordinates of [[-4, 0, 4], [0, 0, 0]]) { const model = plain(value); model.objects.forEach((object, i) => { object.position[0] = coordinates[i]; });
      let raw = text(model); raw = replace(raw, '/objects/1/position/0', '-0e0'); const result = patch(raw, [id(3), id(2), id(1)]);
      check(result.afterContent === raw); same(plain(result.changedPaths), []); throws(() => api.createScene3DDistributionProposal(snapshot(raw), edit()), 'scene3d_distribution_unchanged');
    }
    for (const coordinates of [[0, 0, 5e-324], [-5e-324, 0, 0], [99999.99999999999, 100000, 100000]]) { const model = plain(value); model.objects.forEach((object, i) => { object.position[0] = coordinates[i]; });
      throws(() => api.createScene3DDistributionProposal(snapshot(text(model)), edit()), 'scene3d_distribution_invalid');
    }
    const small = plain(value); [0, 0, 1e-323].forEach((coordinate, i) => { small.objects[i].position[0] = coordinate; });
    const proposal = api.createScene3DDistributionProposal(snapshot(text(small)), edit()); check(proposal.afterObjects[1].position[0] === 5e-324); same(plain(proposal.changedPaths), ['/objects/1/position/0']);
    checks.push({ id: 'already-even-and-zero-span-exact-noop-nonzero-collapsed-interval-refusal-and-representable-subnormal', ok: true });
  }
  {
    const model = plain(value); model.objects = Array.from({ length: 128 }, (_, i) => ({ ...plain(value.objects[0]), instanceId: id(i + 1), position: [i * i, -100000, 100000] }));
    const ids = model.objects.map(object => object.instanceId), content = text(model), source = snapshot(content), proposal = api.createScene3DDistributionProposal(source, edit([...ids].reverse()));
    same(plain(proposal.instanceIds), ids); same(plain(proposal.orderedInstanceIds), ids); check(proposal.beforeObjects.length === 128 && proposal.afterObjects.length === 128 && proposal.changedPaths.length === 126);
    check(proposal.afterContent === expected(content, ids, 'x').after); await api.prepareScene3DDistributionApply(source, proposal, { digest: api.digest });
    const bounded = plain(value); bounded.objects = [-100000, 100000, 0, 1].map((coordinate, i) => ({ ...plain(value.objects[0]), instanceId: id(i + 1), position: [coordinate, i, 0] }));
    const p = api.createScene3DDistributionProposal(snapshot(text(bounded)), edit([id(4), id(3), id(2), id(1)])); check(p.afterObjects[0].position[0] === -100000 && p.afterObjects[1].position[0] === 100000);
    same(plain(p.changedPaths), ['/objects/2/position/0', '/objects/3/position/0']);
    checks.push({ id: 'all128-reverse-requested-targets-two-canonical-orders126-net-paths-and-author-coordinate-boundaries', ok: true, targets: 128 });
  }
  {
    const model = plain(value); model.objects = [0, -100000, 1e-15, 100000].map((coordinate, i) => ({ ...plain(value.objects[0]), instanceId: id(i + 1), position: [coordinate, i, 0] }));
    let raw = text(model); raw = replace(raw, '/objects/2/position/0', '1e-000000000000000000000000000000015'); raw += ' '.repeat(131072 - new TextEncoder().encode(raw).length);
    const ids = [id(4), id(3), id(2), id(1)], proposal = api.createScene3DDistributionProposal(snapshot(raw), edit(ids));
    check(new TextEncoder().encode(proposal.afterContent).length < 131072); check(proposal.afterContent === expected(raw, ids, 'x').after); await api.prepareScene3DDistributionApply(snapshot(raw), proposal, { digest: api.digest });
    model.objects[1].position[0] = 0; model.objects[2].position[0] = 0; model.objects[0].position[0] = -100000;
    let overflow = text(model); overflow += ' '.repeat(131072 - new TextEncoder().encode(overflow).length); throws(() => api.createScene3DDistributionProposal(snapshot(overflow), edit(ids)), 'scene3d_limit');
    throws(() => patch(raw + ' ', ids), 'scene3d_limit');
    checks.push({ id: 'final-whole128KiB-budget-accepts-early-growth-later-long-exponent-shrink-and-rejects-final-overflow', ok: true });
  }
  {
    const source = snapshot(text(value)), before = plain(source);
    for (const intent of [edit([]), edit([id(1), id(2)]), edit([id(1), id(1), id(3)]), edit([id(1), id(2), id(99)]), edit(undefined, 'X')]) throws(() => api.createScene3DDistributionProposal(source, intent));
    same(plain(source), before); check(api.supportsStudioCoreScene3DDistributionPatch());
    for (const supports of [api.supportsStudioCoreScene3DPatch, api.supportsStudioCoreScene3DObjectsPatch, api.supportsStudioCoreScene3DEnvironmentPatch, api.supportsStudioCoreScene3DPropertiesPatch, api.supportsStudioCoreScene3DTranslationPatch, api.supportsStudioCoreScene3DAlignmentPatch]) check(supports());
    throws(() => api.dispatchStudioCoreScene3DAlignmentPatch(dto({ protocolVersion: 1, operation: 'scene3d.distributeObjects', content: source.content, instanceIds: [id(1), id(2), id(3)], axis: 'x' })), 'studio_core_request_invalid');
    check(api.getStudioCoreMetadata().ready);
    checks.push({ id: 'invalid-identity-count-membership-axis-refuse-whole-operation-and-six-predecessor-capabilities-remain-independent', ok: true });
  }
  {
    const source = snapshot(text(value)), proposal = api.createScene3DDistributionProposal(source, edit()), copy = dto(plain(proposal));
    check(Object.isFrozen(proposal) && Object.isFrozen(proposal.instanceIds) && Object.isFrozen(proposal.orderedInstanceIds) && Object.isFrozen(proposal.beforeObjects) && Object.isFrozen(proposal.afterObjects[0].position));
    check(!api.isScene3DDistributionProposal(copy)); await rejects(() => api.prepareScene3DDistributionApply(source, copy, { digest: api.digest }), 'scene3d_distribution_conflict');
    const others = [api.createScene3DTransformProposal(source, dto({ instanceId: id(1), values: { position: [4, 5, 6] } })),
      api.createScene3DObjectsProposal(source, dto({ action: 'remove', instanceId: id(1) })), api.createScene3DEnvironmentProposal(source, dto({ values: { background: '#123456' } })),
      api.createScene3DPropertiesProposal(source, dto({ instanceId: id(1), values: { name: 'Changed' } })), api.createScene3DTranslationProposal(source, dto({ instanceIds: [id(1)], offset: [1, 0, 0] })),
      api.createScene3DAlignmentProposal(source, dto({ instanceIds: [id(1), id(3)], anchorInstanceId: id(1), axis: 'x' }))];
    for (const other of others) { check(!api.isScene3DDistributionProposal(other)); await rejects(() => api.prepareScene3DDistributionApply(source, other, { digest: api.digest }), 'scene3d_distribution_conflict'); }
    for (const prepare of [api.prepareScene3DTransformApply, api.prepareScene3DObjectsApply, api.prepareScene3DEnvironmentApply, api.prepareScene3DPropertiesApply, api.prepareScene3DTranslationApply, api.prepareScene3DAlignmentApply]) await rejects(() => prepare(source, proposal, { digest: api.digest }));
    checks.push({ id: 'seventh-deepfrozen-private-brand-clones-and-all12-directed-six-predecessor-brand-applications-refuse', ok: true, directions: 12 });
  }
  {
    const source = snapshot(text(value)), intent = edit(), proposal = api.createScene3DDistributionProposal(source, intent); intent.instanceIds.reverse(); intent.axis = 'z';
    same(plain(proposal.instanceIds), [id(1), id(2), id(3)]); same(plain(proposal.orderedInstanceIds), [id(2), id(1), id(3)]); check(proposal.axis === 'x');
    let release; const pending = api.prepareScene3DDistributionApply(source, proposal, { digest: async content => { await new Promise(resolve => { release = resolve; }); return api.digest(content); } });
    source.content = 'late caller mutation'; source.token = 'late token'; release(); check((await pending).afterContent === proposal.afterContent);
    for (const change of [{ sourcePath: 'documents/other.json' }, { token: 'other-session' }, { content: proposal.beforeContent + ' ' }, { baseSourceRevision: `sha256:${'0'.repeat(64)}` }, { sourceRevision: `sha256:${'1'.repeat(64)}` }])
      await rejects(() => api.prepareScene3DDistributionApply(snapshot(proposal.beforeContent, change), proposal, { digest: api.digest }), 'scene3d_distribution_conflict');
    await rejects(() => api.prepareScene3DDistributionApply(snapshot(proposal.beforeContent), proposal, { digest: () => '0'.repeat(64) }), 'scene3d_distribution_conflict');
    checks.push({ id: 'preawait-source-and-intent-detachment-full-five-field-ownership-and-digest-conflicts', ok: true });
  }
  return checks;
}
