import test from 'node:test';
import assert from 'node:assert/strict';
import { GODOT_ACTION_SCENE_SWITCH_SCRIPT, GODOT_EVENT_SCENE_SWITCH_SCRIPT } from '../../engine/godot-scene-navigation-scripts.mjs';
import { listScriptStarters, prepareScriptDraft, prepareScriptDraftApply, isScriptDraftProposal } from '../../engine/script-authoring.mjs';

const context = () => ({ sourceToken: 'editor:session:1', documentRoot: 'documents', documentTypes: [{ id: 'character', label: 'Character' }] });
for (const [starterId, content] of [['godot-action-scene-switch', GODOT_ACTION_SCENE_SWITCH_SCRIPT], ['godot-event-scene-switch', GODOT_EVENT_SCENE_SWITCH_SCRIPT]]) {
  test(`${starterId} is an exact immutable ordinary script draft without registration authority`, () => {
    const all = listScriptStarters(), starter = all.find(row => row.id === starterId), owner = context();
    assert.equal(all.filter(row => row.id === starterId).length, 1);
    assert.equal(starter.content, content); assert.equal(starter.languageId, 'gdscript');
    assert.equal(starter.backendId, 'org.viento.godot4'); assert.equal(Object.isFrozen(starter), true);
    const selection = {starterId, documentType:'character', sourcePath:`documents/scripts/${starterId}.txt`};
    const before = structuredClone({owner,selection}), draft = prepareScriptDraft(owner,selection);
    assert.equal(isScriptDraftProposal(draft),true); assert.equal(draft.content,content);
    assert.deepEqual({owner,selection},before); assert.equal(prepareScriptDraftApply(owner,draft).content,content);
    for (const key of ['objectId','instanceId','bindingId','parameters','relations','sceneId','inputMap']) assert.equal(Object.hasOwn(draft,key),false,key);
    assert.throws(() => prepareScriptDraftApply({...owner,sourceToken:'editor:another-session'},draft), error => error.errorCode === 'script_authoring_conflict');
    assert.throws(() => prepareScriptDraftApply(owner,{...draft}), error => error.errorCode === 'script_authoring_conflict');
  });
}
