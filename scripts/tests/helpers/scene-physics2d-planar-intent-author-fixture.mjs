import { scenePhysics2DPlatformControlAuthor } from './scene-physics2d-platform-control-author-fixture.mjs';
import { GODOT_PLANAR_INTENT_SCRIPT } from '../../../engine/godot-planar-intent-script.mjs';
import { GODOT_CHARACTER_INTENT_SCRIPT } from '../../../engine/godot-character-intent-script.mjs';
import { GODOT_CHARACTER_DROP_THROUGH_SCRIPT } from '../../../engine/godot-character-drop-through-script.mjs';

const id = n => `96969696-9696-4696-8696-${String(n).padStart(12,'0')}`;
// Independent, disposable saved author scene. Two free-planar bodies share one
// actor definition and one starter source. A third platformer retains gravity;
// the scene also retains a moving platform, sensor, and old drop-through intent.
export async function scenePhysics2DPlanarIntentAuthor(t) {
  const f = await scenePhysics2DPlatformControlAuthor(t, { consumers:false });
  const gravityInstanceId=id(1),gravityBodyId=id(2),starterScriptId=id(3),firstBindingId=id(4),secondBindingId=id(5),legacyScriptId=id(6),legacyBindingId=id(7),motorScriptId=id(8),motorBindingId=id(9),inputMapId=id(10);
  await f.edit('documents/scenes/demo.json', scene=>{
    const first=scene.actors.find(row=>row.instanceId===f.instanceId),second=scene.actors.find(row=>row.instanceId===f.otherInstanceId);
    Object.assign(first,{position:[100,100],controls:'none',speed:240});Object.assign(second,{position:[100,300],controls:'none',speed:240});
    scene.actors.push({...structuredClone(first),instanceId:gravityInstanceId,position:[500,100],controls:'none'});
    Object.assign(scene.actors.find(row=>row.instanceId===f.wallInstanceId),{position:[145,200],size:[10,700],controls:'none'});
    Object.assign(scene.actors.find(row=>row.instanceId===f.sensorInstanceId),{position:[500,100],controls:'none'});
    Object.assign(scene.actors.find(row=>row.instanceId===f.platformInstanceId),{position:[800,400],controls:'none'});
    Object.assign(scene.actors.find(row=>row.instanceId===f.stationaryInstanceId),{position:[1000,400],controls:'none'});
  });
  await f.edit(f.physicsPath, physics=>{
    const first=physics.bodies.find(row=>row.instanceId===f.instanceId),second=physics.bodies.find(row=>row.instanceId===f.otherInstanceId);
    const gravity=structuredClone(first);Object.assign(gravity,{id:gravityBodyId,instanceId:gravityInstanceId,characterMotion:{kind:'platformer',gravity:980,jumpSpeed:120,maxFallSpeed:1200}});
    delete first.characterMotion;delete second.characterMotion;first.collisionResponse='stop';second.collisionResponse='slide';
    physics.bodies.push(gravity);physics.bodies.find(row=>row.instanceId===f.wallInstanceId).shape.size=[10,700];
  });
  await f.edit(f.manifestPath, manifest=>{manifest.bindings=manifest.bindings.filter(row=>[f.driverBindingId,f.sensorBindingId].includes(row.bindingId));});
  await f.write('documents/projects/planar-controls.json',{format:'viento-input-map',schemaVersion:1,actions:[{name:'p2_left',keys:['KeyH']},{name:'p2_right',keys:['KeyL']},{name:'p2_up',keys:['KeyK']},{name:'p2_down',keys:['KeyJ']}]});
  const assemblyRecord=await f.read(`metadata/documents/${f.assemblyId}.json`);
  await f.write(`metadata/documents/${inputMapId}.json`,{...assemblyRecord,id:inputMapId,sourcePath:'documents/projects/planar-controls.json',relations:[],assetBindings:[]});
  await f.edit('documents/projects/demo.json',project=>{project.schemaVersion=2;project.inputMapId=inputMapId;});
  const firstParameters={left_action:'ui_left',right_action:'ui_right',up_action:'ui_up',down_action:'ui_down'};
  const secondParameters={left_action:'p2_left',right_action:'p2_right',up_action:'p2_up',down_action:'p2_down'};
  await f.addBehavior(starterScriptId,firstBindingId,'planar-intent',GODOT_PLANAR_INTENT_SCRIPT,firstParameters,f.instanceId);
  await f.edit(f.manifestPath, manifest=>{const first=manifest.bindings.find(row=>row.bindingId===firstBindingId);manifest.bindings.push({...structuredClone(first),bindingId:secondBindingId,instanceId:f.otherInstanceId,parameters:secondParameters});});
  await f.addBehavior(motorScriptId,motorBindingId,'legacy-character-intent',GODOT_CHARACTER_INTENT_SCRIPT,{left_action:'ui_left',right_action:'ui_right',jump_action:'ui_accept'},gravityInstanceId);
  await f.addBehavior(legacyScriptId,legacyBindingId,'legacy-drop-intent',GODOT_CHARACTER_DROP_THROUGH_SCRIPT,{drop_action:'ui_down'},gravityInstanceId);
  await f.script('motion-input', `extends Node
var ticks := -1
func _ready() -> void:
	Input.action_press("ui_right")
	Input.action_press("ui_down")
	Input.action_press("p2_right")
	Input.action_press("p2_down")
func _physics_process(_delta: float) -> void:
	var step: int = get_parent().get_parent().get("physics_observation_step")
	if step == ticks:
		return
	ticks = step
	if ticks == 20:
		Input.action_release("ui_right")
		Input.action_release("ui_down")
	if ticks == 25:
		Input.action_release("p2_right")
		Input.action_release("p2_down")
func _exit_tree() -> void:
	for action in ["ui_right", "ui_down", "p2_right", "p2_down"]:
		Input.action_release(action)
`);
  return {...f,gravityInstanceId,gravityBodyId,starterScriptId,firstBindingId,secondBindingId,legacyScriptId,legacyBindingId,motorScriptId,motorBindingId,inputMapId,firstParameters,secondParameters};
}
