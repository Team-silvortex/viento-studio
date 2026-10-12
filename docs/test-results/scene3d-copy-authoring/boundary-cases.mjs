// Import-free portable cases. Native-backed APIs and a same-realm DTO/digest
// bridge are supplied by the proof host; no product parser, DOM or I/O is added.
export async function runCopyCases(api) {
  const check = (value, message = 'Copy portable assertion failed') => { if (!value) throw Error(message); };
  const equal = (a, b) => { if (a === b) return true; if (!a || !b || typeof a !== 'object' || typeof b !== 'object' || Array.isArray(a) !== Array.isArray(b)) return false;
    const keys = Object.keys(a); return keys.length === Object.keys(b).length && keys.every(key => Object.hasOwn(b, key) && equal(a[key], b[key])); };
  const same = (a, b) => check(equal(a, b), 'Copy portable value mismatch');
  const throws = (action, code) => { let caught = false; try { action(); } catch (error) { caught = true; if (code) check(error.errorCode === code, `Expected ${code}, received ${error.errorCode}`); } check(caught, 'Expected copy rejection'); };
  const rejects = async (action, code) => { let caught = false; try { await action(); } catch (error) { caught = true; if (code) check(error.errorCode === code, `Expected ${code}, received ${error.errorCode}`); } check(caught, 'Expected copy apply rejection'); };
  const dto = value => api.realmJson ? api.realmJson(JSON.stringify(value)) : value, plain = value => JSON.parse(JSON.stringify(value));
  const id = n => `${n.toString(16).padStart(8, '0')}-1111-4111-8111-111111111111`;
  const pair = (n, fresh = 100 + n) => ({ sourceInstanceId: id(n), newInstanceId: id(fresh) });
  const value = { format: 'viento-scene3d', schemaVersion: 1, name: '复制 / copy / 複製 🦊', viewport: [800, 600], background: '#0d1829',
    camera: { position: [8, 6, 8], target: [0, 0, 0], fovDegrees: 60, near: .05, far: 1000 }, light: { direction: [-1, -2, -1], color: '#ffffff', energy: 1 },
    objects: [[1, 2, 3], [2, -7, 5], [7, 0, 0]].map((position, index) => ({ instanceId: id(index + 1), name: `Box 箱${index}🦊`, primitive: 'box', position,
      rotationDegrees: [23, -41, 67], size: [1.5, 3, 1.5], color: '#aB89Cd' })) };
  const text = model => '\uFEFF' + JSON.stringify(model, null, '\t').replaceAll('\n', '\r\n') + '\r\n \t';
  const snapshot = (content, overrides = {}) => dto({ sourcePath: 'documents/scenes/copy.json', token: 'prepared-copy', content,
    baseSourceRevision: `sha256:${api.digest(content)}`, sourceRevision: `sha256:${api.digest(content)}`, ...overrides });
  const edit = (copies = [pair(3, 102), pair(1, 103)], offset = [1, 0, -2]) => dto({ copies, offset });
  const patch = (content, copies, offset = [0, 0, 0]) => api.dispatchStudioCoreScene3DCopyPatch(dto({ protocolVersion: 1, operation: 'scene3d.copyObjects', content, copies, offset }));
  const range = (content, path) => { const found = api.locateJsonSource(api.parseJsonSource(content), path); check(found.exact); return plain(found); };
  const replace = (content, path, token) => { const found = range(content, path); return content.slice(0, found.start) + token + content.slice(found.end); };
  function expected(content, copies, offset) {
    const original = JSON.parse(content.replace(/^\uFEFF/, '')), array = range(content, '/objects'), first = range(content, '/objects/0'), last = range(content, `/objects/${original.objects.length - 1}`);
    const padding = content.slice(array.start + 1, first.start), mapping = new Map(copies.map(item => [item.sourceInstanceId, item.newInstanceId])), canonical = [], clones = [];
    for (const [index, object] of original.objects.entries()) {
      if (!mapping.has(object.instanceId)) continue;
      const whole = range(content, `/objects/${index}`), identity = range(content, `/objects/${index}/instanceId`);
      const changes = [{ start: identity.start - whole.start, end: identity.end - whole.start, text: JSON.stringify(mapping.get(object.instanceId)) }];
      for (let axis = 0; axis < 3; axis++) {
        const next = object.position[axis] + offset[axis];
        if (next !== object.position[axis]) { const coordinate = range(content, `/objects/${index}/position/${axis}`); changes.push({ start: coordinate.start - whole.start, end: coordinate.end - whole.start, text: JSON.stringify(next) }); }
      }
      let raw = content.slice(whole.start, whole.end);
      for (const change of changes.sort((a, b) => b.start - a.start)) raw = raw.slice(0, change.start) + change.text + raw.slice(change.end);
      clones.push(raw); canonical.push({ sourceInstanceId: object.instanceId, newInstanceId: mapping.get(object.instanceId) });
    }
    return { after: content.slice(0, last.end) + clones.map(raw => ',' + padding + raw).join('') + content.slice(last.end),
      copies: canonical, paths: clones.map((_, rank) => `/objects/${original.objects.length + rank}`), point: last.end, clones };
  }
  const checks = [];
  {
    let raw = text(value).replaceAll('"position"', '"posi\\u0074ion"').replace('"objects"', '"objec\\u0074s"').replaceAll('"instanceId"', '"instanc\\u0065Id"');
    raw = replace(raw, '/objects/0/position/0', '1.000e0'); raw = replace(raw, '/objects/0/position/1', '2.000e0'); raw = replace(raw, '/objects/2/position/1', '-0e0');
    for (const dirty of [false, true]) { const content = raw + (dirty ? ' \r\n' : ''), source = snapshot(content, { baseSourceRevision: `sha256:${api.digest(raw)}` }), before = plain(source), intent = edit();
      const proposal = api.createScene3DCopyProposal(source, intent), want = expected(content, plain(intent.copies), plain(intent.offset));
      same(plain(proposal.copies), [pair(1, 103), pair(3, 102)]); check(proposal.afterContent === want.after); same(plain(proposal.changedPaths), ['/objects/3', '/objects/4']);
      same(plain(proposal.beforeObjects).map(object => object.instanceId), [id(1), id(3)]); same(plain(proposal.afterObjects).map(object => object.instanceId), [id(103), id(102)]);
      same(plain(await api.prepareScene3DCopyApply(source, proposal, { digest: api.digest })), { afterContent: proposal.afterContent, sourcePath: source.sourcePath, changedPaths: want.paths }); same(plain(source), before);
    }
    checks.push({ id: 'saved-dirty-BOM-CRLF-escaped-keys-original-fullbytes-and-sourceordered-pair-clones-exact-one-insertion', ok: true, modes: 2 });
  }
  {
    let raw = text(value); raw = replace(raw, '/objects/0/position/0', '1.000e0'); raw = replace(raw, '/objects/2/position/0', '7.000e0');
    for (const offset of [[0, 0, 0], [5e-324, 0, 0]]) { const source = snapshot(raw), intent = edit(undefined, offset), proposal = api.createScene3DCopyProposal(source, intent);
      check(proposal.afterContent !== raw); same(plain(proposal.changedPaths), ['/objects/3', '/objects/4']); check(proposal.afterContent === expected(raw, plain(intent.copies), offset).after);
      check(api.isScene3DCopyProposal(proposal)); await api.prepareScene3DCopyApply(source, proposal, { digest: api.digest });
      for (let i = 0; i < proposal.afterObjects.length; i++) { const before = plain(proposal.beforeObjects[i]), after = plain(proposal.afterObjects[i]); after.instanceId = before.instanceId; same(after, before); }
    }
    const named = plain(value); named.objects[0].name = named.objects[0].instanceId; named.objects[0].rotationDegrees = [...named.objects[0].position]; named.objects[0].size = [...named.objects[0].position];
    const content = text(named), intent = edit([pair(1)], [1, 0, 0]), proposal = api.createScene3DCopyProposal(snapshot(content), intent);
    check(proposal.afterObjects[0].name === named.objects[0].name); check(proposal.afterContent === expected(content, plain(intent.copies), plain(intent.offset)).after);
    checks.push({ id: 'zero-and-rounded-no-net-offset-still-authorized-structure-identity-copy-with-name-and-all-unchanged-lexemes-retained', ok: true });
  }
  {
    for (const sign of [-1, 1]) { const model = plain(value); model.objects[0].position = [-sign * 100000, 0, 0];
      const proposal = api.createScene3DCopyProposal(snapshot(text(model)), edit([pair(1)], [sign * 200000, 0, 0])); check(proposal.afterObjects[0].position[0] === sign * 100000);
      const original = JSON.parse(proposal.beforeContent.slice(1)), after = JSON.parse(proposal.afterContent.slice(1)); same(after.objects.slice(0, 3), original.objects);
      throws(() => api.createScene3DCopyProposal(snapshot(text(model)), edit([pair(1), pair(2)], [sign * 200000, 0, 0])));
    }
    const source = snapshot(text(value)), before = plain(source);
    for (const intent of [edit([]), edit([pair(1), pair(1, 104)]), edit([pair(1), pair(2, 101)]), edit([pair(1, 2)]), edit([pair(99)]), edit([pair(1)], [200001, 0, 0]), edit([pair(1)], [0, 0]),
      dto({ copies: [{ ...pair(1), extra: true }], offset: [0, 0, 0] })]) throws(() => api.createScene3DCopyProposal(source, intent)); same(plain(source), before);
    checks.push({ id: 'common-world-offset-extremes-and-any-target-bounds-identity-capacity-intent-failure-refuse-whole-structure', ok: true });
  }
  {
    const model = plain(value); model.objects = Array.from({ length: 64 }, (_, i) => ({ ...plain(value.objects[0]), instanceId: id(i + 1), position: [i - 32, i / 4, 0] }));
    const canonical = model.objects.map((object, index) => ({ sourceInstanceId: object.instanceId, newInstanceId: id(300 - index) })), source = snapshot(text(model));
    const proposal = api.createScene3DCopyProposal(source, edit([...canonical].reverse(), [1, 2, 3])); same(plain(proposal.copies), canonical);
    check(proposal.beforeObjects.length === 64 && proposal.afterObjects.length === 64 && proposal.changedPaths.length === 64); check(JSON.parse(proposal.afterContent.slice(1)).objects.length === 128);
    check(proposal.afterContent === expected(source.content, canonical, [1, 2, 3]).after); await api.prepareScene3DCopyApply(source, proposal, { digest: api.digest });
    model.objects.push({ ...plain(value.objects[0]), instanceId: id(65) }); throws(() => api.createScene3DCopyProposal(snapshot(text(model)), edit(canonical, [0, 0, 0])));
    model.objects = Array.from({ length: 128 }, (_, i) => ({ ...plain(value.objects[0]), instanceId: id(i + 1) })); throws(() => api.createScene3DCopyProposal(snapshot(text(model)), edit([pair(1, 200)])));
    checks.push({ id: 'maximum64-original-plus64-copy-success-two128-capacity-overflows-and-non-reassigned-canonical-UUIDmapping', ok: true, copies: 64 });
  }
  {
    const model = plain(value); model.objects = model.objects.slice(0, 1); const raw = text(model), pairs = [pair(1)], wanted = expected(raw, pairs, [0, 0, 0]);
    const fits = raw + ' '.repeat(131072 - new TextEncoder().encode(wanted.after).length), source = snapshot(fits), proposal = api.createScene3DCopyProposal(source, edit(pairs, [0, 0, 0]));
    check(new TextEncoder().encode(proposal.afterContent).length === 131072); check(proposal.afterContent === expected(fits, pairs, [0, 0, 0]).after);
    await api.prepareScene3DCopyApply(source, proposal, { digest: api.digest }); throws(() => api.createScene3DCopyProposal(snapshot(fits + ' '), edit(pairs, [0, 0, 0])), 'scene3d_limit');
    check(patch(raw, pairs).afterContent === wanted.after);
    checks.push({ id: 'final-full128KiB-exact-copy-fit-and-one-byte-final-overflow-no-partial-object-insertion', ok: true });
  }
  {
    check(api.supportsStudioCoreScene3DCopyPatch());
    for (const supports of [api.supportsStudioCoreScene3DPatch, api.supportsStudioCoreScene3DObjectsPatch, api.supportsStudioCoreScene3DEnvironmentPatch, api.supportsStudioCoreScene3DPropertiesPatch, api.supportsStudioCoreScene3DTranslationPatch, api.supportsStudioCoreScene3DAlignmentPatch, api.supportsStudioCoreScene3DDistributionPatch]) check(supports());
    const source = snapshot(text(value)), proposal = api.createScene3DCopyProposal(source, edit());
    check(Object.isFrozen(proposal) && Object.isFrozen(proposal.copies) && Object.isFrozen(proposal.copies[0]) && Object.isFrozen(proposal.offset) && Object.isFrozen(proposal.afterObjects[0].position));
    const copy = dto(plain(proposal)); check(!api.isScene3DCopyProposal(copy)); await rejects(() => api.prepareScene3DCopyApply(source, copy, { digest: api.digest }), 'scene3d_copy_conflict');
    throws(() => api.dispatchStudioCoreScene3DObjectsPatch(dto({ protocolVersion: 1, operation: 'scene3d.copyObjects', content: source.content, copies: [pair(1)], offset: [0, 0, 0] })), 'studio_core_request_invalid');
    checks.push({ id: 'independent-eighth-probe-private-deepfrozen-brand-cannot-transfer-through-clone-or-single-object-op', ok: true });
  }
  {
    const source = snapshot(text(value)), proposal = api.createScene3DCopyProposal(source, edit());
    const others = [api.createScene3DTransformProposal(source, dto({ instanceId: id(1), values: { position: [4, 5, 6] } })), api.createScene3DObjectsProposal(source, dto({ action: 'remove', instanceId: id(1) })),
      api.createScene3DEnvironmentProposal(source, dto({ values: { background: '#123456' } })), api.createScene3DPropertiesProposal(source, dto({ instanceId: id(1), values: { name: 'Changed' } })),
      api.createScene3DTranslationProposal(source, dto({ instanceIds: [id(1)], offset: [1, 0, 0] })), api.createScene3DAlignmentProposal(source, dto({ instanceIds: [id(1), id(3)], anchorInstanceId: id(1), axis: 'x' })),
      api.createScene3DDistributionProposal(source, dto({ instanceIds: [id(1), id(2), id(3)], axis: 'x' }))];
    for (const other of others) { check(!api.isScene3DCopyProposal(other)); await rejects(() => api.prepareScene3DCopyApply(source, other, { digest: api.digest }), 'scene3d_copy_conflict'); }
    for (const prepare of [api.prepareScene3DTransformApply, api.prepareScene3DObjectsApply, api.prepareScene3DEnvironmentApply, api.prepareScene3DPropertiesApply, api.prepareScene3DTranslationApply, api.prepareScene3DAlignmentApply, api.prepareScene3DDistributionApply]) await rejects(() => prepare(source, proposal, { digest: api.digest }));
    checks.push({ id: 'seven-sibling-authoring-brands-and-copy-reject-all14-directed-cross-domain-application-attempts', ok: true, directions: 14 });
  }
  {
    const source = snapshot(text(value)), intent = edit(), proposal = api.createScene3DCopyProposal(source, intent); intent.copies.reverse(); intent.copies[0].newInstanceId = id(999); intent.offset[0] = 99;
    same(plain(proposal.copies), [pair(1, 103), pair(3, 102)]); same(plain(proposal.offset), [1, 0, -2]);
    let release; const pending = api.prepareScene3DCopyApply(source, proposal, { digest: async content => { await new Promise(resolve => { release = resolve; }); return api.digest(content); } });
    source.content = 'late caller mutation'; source.token = 'late token'; release(); check((await pending).afterContent === proposal.afterContent);
    for (const change of [{ sourcePath: 'documents/other.json' }, { token: 'other-session' }, { content: proposal.beforeContent + ' ' }, { baseSourceRevision: `sha256:${'0'.repeat(64)}` }, { sourceRevision: `sha256:${'1'.repeat(64)}` }])
      await rejects(() => api.prepareScene3DCopyApply(snapshot(proposal.beforeContent, change), proposal, { digest: api.digest }), 'scene3d_copy_conflict');
    await rejects(() => api.prepareScene3DCopyApply(snapshot(proposal.beforeContent), proposal, { digest: () => '0'.repeat(64) }), 'scene3d_copy_conflict');
    checks.push({ id: 'preawait-complete-source-detachment-canonical-pairs-offset-and-five-owner-field-digest-conflicts', ok: true });
  }
  return checks;
}
