import test from 'node:test';import assert from 'node:assert/strict';import{createHash}from'node:crypto';
import{sceneMenuCapabilities,PROJECT_MENU_CAPABILITY as capability}from'../../engine/scene-menu-capability.mjs';
import{GODOT_PROJECT_MENU_SCRIPT as script}from'../../engine/godot-project-menu-script.mjs';
import{GODOT_ACTION_PROJECT_PAUSE_SCRIPT}from'../../engine/godot-project-pause-script.mjs';
import{validateProjectAssemblyPlan}from'../../engine/project-assembly-plan-contract.mjs';
import{checkExecutionBackendSupport}from'../../engine/backend-capabilities.mjs';
import{GODOT4_EXECUTION_ADAPTER as adapter}from'../backends/godot4-adapter.mjs';
import{validateGeneratedExecutionProject}from'../adapters/node-execution-backends.mjs';
import{runtimeProject}from'./helpers/project-runtime-fixture.mjs';
const required=[capability,'project.pause'];
const revision=source=>'sha256:'+createHash('sha256').update(source).digest('hex');
function fixture(){const plan=runtimeProject({behavior:true}),scene=plan.scenes[0];scene.behaviors.sources[0].content=script;scene.behaviors.sources[0].sourceRevision=revision(script);scene.behaviors.bindings[0].events=[];scene.requiredCapabilities=[...new Set([...scene.requiredCapabilities,'behavior.bindings','behavior.gdscript',...required])].sort();plan.requiredCapabilities=[...new Set(['project.scenes',...plan.scenes.flatMap(s=>s.requiredCapabilities)])].sort();return{plan,scene,behaviors:scene.behaviors};}
function omit(plan,flag,level){const p=structuredClone(plan);if(level!=='aggregate')p.scenes[0].requiredCapabilities=p.scenes[0].requiredCapabilities.filter(c=>c!==flag);if(level!=='member')p.requiredCapabilities=p.requiredCapabilities.filter(c=>c!==flag);return p;}
test('only exact uniquely identified bound menu source declares menu and pause dependencies',()=>{
 const{behaviors}=fixture(),before=structuredClone(behaviors);assert.deepEqual(sceneMenuCapabilities(behaviors),required);assert.deepEqual(behaviors,before);
 for(const change of [b=>b.bindings=[],b=>b.sources[0].content+='\n',b=>b.sources.push(structuredClone(b.sources[0])),b=>b.language='rust',b=>b.backendId='org.viento.custom',b=>{delete b.sources[0].objectId;delete b.bindings[0].implementation.sourceObjectId;},b=>{b.sources[0].objectId='invalid';b.bindings[0].implementation.sourceObjectId='invalid';}]){const copy=structuredClone(before);change(copy);assert.deepEqual(sceneMenuCapabilities(copy),[]);}
});
test('menu capability discovery avoids accessors and rejects overlarge source and binding collections',()=>{
 let reads=0;for(const key of ['sources','bindings','backendId','language']){const{behaviors}=fixture();Object.defineProperty(behaviors,key,{get(){reads++;return[];}});assert.deepEqual(sceneMenuCapabilities(behaviors),[]);}for(const key of ['sources','bindings']){const{behaviors}=fixture();behaviors[key]=Array(key==='sources'?9:33).fill(behaviors[key][0]);assert.deepEqual(sceneMenuCapabilities(behaviors),[]);}assert.equal(reads,0);
});
test('frozen member and aggregate menu and pause declarations cannot be independently stripped',()=>{
 const{plan}=fixture();assert.deepEqual(validateProjectAssemblyPlan(plan),plan);assert.deepEqual(checkExecutionBackendSupport(adapter.descriptor,{operation:'build',plan}),[]);
 for(const flag of required){const unsupported={...adapter.descriptor,capabilities:adapter.descriptor.capabilities.filter(c=>c!==flag)};for(const level of ['member','aggregate','both']){const bad=omit(plan,flag,level);assert.throws(()=>validateProjectAssemblyPlan(bad),{errorCode:'build_assembly_invalid'});assert.ok(checkExecutionBackendSupport(unsupported,{operation:'build',plan:bad}).some(d=>d.code==='build_capability_missing'&&d.capability===flag));}}
});
test('a standalone menu cannot silently lose its project host',async()=>{const{scene}=fixture();await assert.rejects(adapter.generate(scene),{errorCode:'build_project_menu_requires_project'});});
test('generated admission verifies descriptor, output and both dependencies before staging',async()=>{
 const{plan}=fixture(),before=structuredClone(plan),generated=await adapter.generate(plan);assert.equal(generated.backend.version,'0.49.0');assert.doesNotThrow(()=>validateGeneratedExecutionProject(adapter,plan,generated));
 for(const flag of required){const unsupported={...adapter,descriptor:{...adapter.descriptor,capabilities:adapter.descriptor.capabilities.filter(c=>c!==flag)}},missing={...generated,backend:{...generated.backend,capabilities:generated.backend.capabilities.filter(c=>c!==flag)}};assert.throws(()=>validateGeneratedExecutionProject(unsupported,plan,generated),{errorCode:'build_backend_invalid'});assert.throws(()=>validateGeneratedExecutionProject(adapter,plan,missing),{errorCode:'build_backend_invalid'});for(const level of ['member','aggregate','both']){const bad=omit(plan,flag,level);assert.throws(()=>validateGeneratedExecutionProject(adapter,bad,generated),{errorCode:'build_backend_invalid'});assert.throws(()=>validateGeneratedExecutionProject(unsupported,bad,missing),{errorCode:'build_backend_invalid'});}}
 assert.throws(()=>validateGeneratedExecutionProject(adapter,plan.scenes[0],generated),{errorCode:'build_backend_invalid'});assert.deepEqual(plan,before);
});
test('ordinary and pause-only projects preserve earlier generation while custom menu source stays ordinary',async()=>{
 const plain=runtimeProject(),ordinary=await adapter.generate(plain);assert.equal(ordinary.backend.version,'0.47.0');assert.equal([...ordinary.files.keys()].some(p=>p.startsWith('project-menu')),false);
 const{plan}=fixture();plan.scenes[0].behaviors.sources[0].content=GODOT_ACTION_PROJECT_PAUSE_SCRIPT;plan.scenes[0].behaviors.sources[0].sourceRevision=revision(GODOT_ACTION_PROJECT_PAUSE_SCRIPT);plan.scenes[0].requiredCapabilities=plan.scenes[0].requiredCapabilities.filter(c=>c!==capability);plan.requiredCapabilities=plan.requiredCapabilities.filter(c=>c!==capability);const paused=await adapter.generate(plan);assert.equal(paused.backend.version,'0.48.0');assert.equal([...paused.files.keys()].some(p=>p.startsWith('project-menu')),false);
 for(const mode of ['custom','unbound']){const{plan}=fixture();const scene=plan.scenes[0],source=scene.behaviors.sources[0];if(mode==='unbound'){scene.behaviors.sources.push({...source,objectId:'abababab-abab-4bab-8bab-abababababab',sourcePath:'documents/unbound-menu.txt'});source.content='extends Node\n';}else source.content+='\n# Custom menu';source.sourceRevision=revision(source.content);scene.requiredCapabilities=scene.requiredCapabilities.filter(c=>!required.includes(c));plan.requiredCapabilities=plan.requiredCapabilities.filter(c=>!required.includes(c));const output=await adapter.generate(plan);assert.equal(output.backend.version,'0.47.0');assert.deepEqual(sceneMenuCapabilities(scene.behaviors),[]);assert.doesNotThrow(()=>validateGeneratedExecutionProject(adapter,plan,output));}
});
