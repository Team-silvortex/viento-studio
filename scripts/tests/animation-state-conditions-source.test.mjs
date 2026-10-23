import '../adapters/node-studio-core.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { DEFAULT_ANIMATION_STATE_TABLE, DEFAULT_GODOT_ANIMATION_STATE_SCRIPT, generateGodotAnimationStateScript } from '../../engine/godot-animation-state-script.mjs';
import { generateGodotAnimationStateConditionsScript } from '../../engine/godot-animation-state-conditions-script.mjs';
import { generateEditableGodotAnimationStateScript, readAnimationStateScriptSource, DEFAULT_EDITABLE_GODOT_ANIMATION_STATE_SCRIPT } from '../../engine/animation-state-script-source.mjs';
import { discoverScriptParameterContract } from '../../engine/script-parameter-discovery.mjs';
import { createAnimationStateScriptProposal, prepareAnimationStateScriptApply } from '../../engine/animation-state-script-edit.mjs';
const hash = value => createHash('sha256').update(value).digest('hex');
const prefix = '# Viento animation state script\n#@viento-animation-state-script ';
const table = (condition = { type: 'boolean', operator: 'eq', value: true }) => {
  const value = structuredClone(DEFAULT_ANIMATION_STATE_TABLE); value.transitions[0].trigger.condition = condition; return value;
};
const rewrite = (content, update) => { const end = content.indexOf('\n', prefix.length), value = JSON.parse(content.slice(prefix.length, end)); update(value); return prefix + JSON.stringify(value) + content.slice(end); };
const rejects = (content, code) => assert.throws(() => readAnimationStateScriptSource(content), { errorCode: 'animation_state_script_source_' + code });
const source = content => ({ sourcePath: 'documents/scripts/controller.txt', token: 'conditions:1', content, baseSourceRevision: 'sha256:' + hash(content), sourceRevision: 'sha256:' + hash(content) });

test('v1 emitter file and default editable source are byte-stable; legacy public generation cannot ignore a condition', async () => {
  assert.equal(hash(await fs.readFile(new URL('../../engine/godot-animation-state-script.mjs', import.meta.url))), 'a9fb4687b3b9e9573770a3f2dacc4d78e5540acfcc37cce05db2f6a8bc88f2d5');
  for (const input of [DEFAULT_ANIMATION_STATE_TABLE, { initialState: 'only', states: [{ key: 'only' }], transitions: [] }]) {
    const generated = generateEditableGodotAnimationStateScript(input), body = generateGodotAnimationStateScript(input).content;
    assert.equal(generated.content.slice(generated.content.indexOf('\n', prefix.length) + 1), body);
    assert.equal(JSON.parse(generated.content.split('\n')[1].slice('#@viento-animation-state-script '.length)).generator, 'godot-gdscript-v1');
    assert.deepEqual(readAnimationStateScriptSource(generated.content).table, input);
  }
  assert.equal(generateGodotAnimationStateScript(DEFAULT_ANIMATION_STATE_TABLE).content, DEFAULT_GODOT_ANIMATION_STATE_SCRIPT);
  assert.equal(generateEditableGodotAnimationStateScript(DEFAULT_ANIMATION_STATE_TABLE).content, DEFAULT_EDITABLE_GODOT_ANIMATION_STATE_SCRIPT);
  assert.throws(() => generateGodotAnimationStateScript(table()), { errorCode: 'animation_state_table_invalid' });
  assert.throws(() => generateGodotAnimationStateConditionsScript(DEFAULT_ANIMATION_STATE_TABLE), { errorCode: 'animation_state_table_invalid' });
  const code = `import assert from 'node:assert/strict';import {getStudioCoreMetadata} from ${JSON.stringify(new URL('../../engine/studio-core.mjs',import.meta.url).href)};import {DEFAULT_EDITABLE_GODOT_ANIMATION_STATE_SCRIPT} from ${JSON.stringify(new URL('../../engine/animation-state-script-source.mjs',import.meta.url).href)};assert.equal(getStudioCoreMetadata().ready,false);assert.ok(DEFAULT_EDITABLE_GODOT_ANIMATION_STATE_SCRIPT.includes('godot-gdscript-v1'));`;
  await promisify(execFile)(process.execPath, ['--input-type=module', '-e', code]);
});

test('v2 conditional source roundtrips every scalar category with BOM and LF/CRLF while parameters remain unchanged', () => {
  for (const condition of [{ type:'boolean', operator:'ne', value:false }, { type:'number', operator:'gte', value:2 ** -53 },
    { type:'string', operator:'eq', value:'"\\\n\r\t\b\f\u0000日本語🎮' }]) {
    const value = table(condition), generated = generateEditableGodotAnimationStateScript(value);
    assert.match(generated.content, /"generator":"godot-gdscript-v2"/);
    assert.deepEqual(generated.parameters, generateEditableGodotAnimationStateScript(DEFAULT_ANIMATION_STATE_TABLE).parameters);
    for (const bom of ['', '\uFEFF']) for (const newline of ['\n', '\r\n']) {
      const content = bom + generated.content.replaceAll('\n', newline), read = readAnimationStateScriptSource(content);
      assert.deepEqual(read.table, value); assert.equal(read.bom, bom); assert.equal(read.newline, newline);
      assert.equal(bom + generateEditableGodotAnimationStateScript(read.table).content.replaceAll('\n', newline), content);
    }
    assert.ok(Object.isFrozen(generated) && Object.isFrozen(generated.parameters[0]));
  }
});

test('v2 constants retain exact IEEE doubles and UTF8 text without author text in executable literals', () => {
  for (const value of [Number.MIN_VALUE, 2 ** -53, .1, 1e9, -1e9]) {
    const emitted = generateGodotAnimationStateConditionsScript(table({ type:'number', operator:'eq', value })).content;
    const edges = JSON.parse(emitted.match(/^const _TRANSITIONS: Array = (.*)$/m)[1]);
    const bytes = new Uint8Array(edges[0].trigger.condition.valueBytes);
    assert.equal(new DataView(bytes.buffer).getFloat64(0,true), value);
    assert.match(emitted, /PackedByteArray\(condition\["valueBytes"\]\)\.decode_double\(0\)/);
  }
  for (const value of ['', '\u0000', '\\"\n\r\t\b\f', '日本語🎮', 'a'.repeat(4096)]) {
    const emitted = generateGodotAnimationStateConditionsScript(table({ type:'string', operator:'eq', value })).content;
    const edges = JSON.parse(emitted.match(/^const _TRANSITIONS: Array = (.*)$/m)[1]);
    assert.equal(Buffer.from(edges[0].trigger.condition.valueBase64,'base64').toString('utf8'),value);
  }
});

test('generator versions and condition presence cannot claim a different executable body', () => {
  const conditional = generateEditableGodotAnimationStateScript(table()).content, plain = DEFAULT_EDITABLE_GODOT_ANIMATION_STATE_SCRIPT;
  rejects(rewrite(conditional, value => { value.generator = 'godot-gdscript-v1'; }), 'invalid');
  rejects(rewrite(plain, value => { value.generator = 'godot-gdscript-v2'; }), 'invalid');
  rejects(rewrite(conditional, value => { value.generator = 'godot-gdscript-v99'; }), 'unsupported');
  rejects(rewrite(conditional, value => { value.table.transitions[0].trigger.condition.value = false; }), 'modified');
  rejects(conditional.replace('return actual == expected', 'return true'), 'modified');
  rejects(conditional + '# custom\n', 'modified');
  rejects(rewrite(conditional, value => { value.table.transitions[1].trigger.condition = { type:'boolean', operator:'eq', value:true }; }), 'invalid');
  rejects(conditional.replace('"operator":"eq"','"operator":"eq","operator":"ne"'), 'invalid');
});

test('ordinary source proposals add conditions and remove the last condition without changing representation or parameter names', async () => {
  const initial = '\uFEFF' + DEFAULT_EDITABLE_GODOT_ANIMATION_STATE_SCRIPT.replaceAll('\n','\r\n');
  const captured = source(initial), proposal = await createAnimationStateScriptProposal(captured, table());
  assert.match(proposal.afterContent,/godot-gdscript-v2/); assert.ok(proposal.afterContent.startsWith('\uFEFF'));
  assert.equal(proposal.afterContent.replaceAll('\r\n','').includes('\n'),false);
  assert.deepEqual(proposal.beforeParameters,proposal.afterParameters);
  const prepared = await prepareAnimationStateScriptApply(captured,proposal,{digest:async value=>hash(value)});
  assert.equal(prepared.afterContent,proposal.afterContent);
  const remove = await createAnimationStateScriptProposal(source(proposal.afterContent),DEFAULT_ANIMATION_STATE_TABLE);
  assert.equal(remove.afterContent,initial); assert.deepEqual(remove.beforeParameters,remove.afterParameters);
  await assert.rejects(()=>createAnimationStateScriptProposal(source(proposal.afterContent),table()),{errorCode:'animation_state_script_authoring_unchanged'});
});

test('conditional complete-source budget includes the declaration, BOM and CRLF expansion', () => {
  const sized = count => ({ initialState:'idle',states:[{key:'idle'}],transitions:Array.from({length:7},(_,index)=>({from:'idle',to:'idle',trigger:{kind:'event',name:'event'+index,condition:{type:'string',operator:'eq',value:'x'.repeat(count)}}})) });
  assert.throws(()=>generateEditableGodotAnimationStateScript(sized(4096)),{errorCode:'animation_state_script_source_limit'});
  let low=0,high=4096;
  while(low<high){const mid=Math.ceil((low+high)/2);try{generateEditableGodotAnimationStateScript(sized(mid));low=mid;}catch(error){assert.equal(error.errorCode,'animation_state_script_source_limit');high=mid-1;}}
  const generated=generateEditableGodotAnimationStateScript(sized(low)).content;
  assert.ok(Buffer.byteLength(generated)<=65536); assert.deepEqual(readAnimationStateScriptSource(generated).table,sized(low));
  rejects('\uFEFF'+generated.replaceAll('\n','\r\n'),'limit');
  assert.equal(readAnimationStateScriptSource(DEFAULT_EDITABLE_GODOT_ANIMATION_STATE_SCRIPT).table.states.length,2);
});


test('optional parameter discovery admits v2 but oversized conditional source is non-actionable instead of throwing', () => {
  const content=generateEditableGodotAnimationStateScript(table()).content;
  const ready=discoverScriptParameterContract(content); assert.equal(ready.status,'ready');
  assert.deepEqual(ready.parameters.map(row=>row.name),['clip_idle','clip_action']);
  const over=content+'#'+ 'x'.repeat(65537-Buffer.byteLength(content));
  rejects(over,'limit'); const found=discoverScriptParameterContract(over);
  assert.equal(found.status,'modified'); assert.deepEqual(found.parameters,[]);
});
