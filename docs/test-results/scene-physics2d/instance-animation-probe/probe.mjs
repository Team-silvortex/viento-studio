import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {scenePhysics2DAuthor} from '/home/chiharukiryu/cdev/viento-studio/scripts/tests/helpers/scene-physics2d-author-fixture.mjs';
import {buildProject,runProjectBuild} from '/home/chiharukiryu/cdev/viento-studio/scripts/adapters/node-project-build.mjs';
const evidence='/tmp/viento-physics-instance-probe',cleanup=[];
const report={format:'viento-physics-instance-probe',schemaVersion:1,success:false,assertions:[]};
try {
 const f=await scenePhysics2DAuthor({after:fn=>cleanup.push(fn)});
 await f.edit('documents/animations/scene-0.json',document=>{document.schemaVersion=4;document.playbackScope='instance';});
 const tool='/home/chiharukiryu/.cache/io.viento.studio/toolchains/godot/4.7.2-stable/linux-x86_64/Godot_v4.7.2-stable_linux.x86_64',output=path.join(f.temporary,'instance-build');
 const built=await buildProject({root:f.author,targetId:f.assemblyId,tool,output});
 await fs.writeFile(path.join(evidence,'build.json'),JSON.stringify(built,null,2)+'\n');
 assert.equal(built.ok,true,JSON.stringify(built.record?.diagnostics||built));
 const run=await runProjectBuild({buildDirectory:output,tool,headless:true,smoke:true});
 await fs.writeFile(path.join(evidence,'run.json'),JSON.stringify(run,null,2)+'\n');
 assert.equal(run.ok,true,JSON.stringify(run.record?.diagnostics||run));
 const project=run.record.runtime.project,frames=run.record.events,target={kind:'instance',instanceId:f.instanceId};
 assert.equal(project.protocolVersion,11);
 assert.deepEqual(project.events.entries.map(row=>row.name),['physics.entered','physics.exited']);
 assert.ok(project.events.entries.every(row=>row.origin.bindingId===f.sensorBindingId&&row.origin.instanceId===f.sensorInstanceId&&row.value===f.instanceId));
 assert.deepEqual(project.animationStateEntries.entries.map(row=>row.stateKey),['idle','action','idle']);
 assert.deepEqual(project.animationStateEntries.entries.map(row=>row.trigger.kind),['initial','event','completed']);
 for(const row of frames.filter(row=>['animation-command','animation-completed'].includes(row.event)))assert.deepEqual(row.target,target);
 for(const row of frames.filter(row=>row.event==='animation-state-entered'))assert.equal(row.instanceId,f.instanceId);
 const character=frames.find(row=>row.event==='scene-exit').actors.find(actor=>actor.instanceId===f.instanceId);
 assert.ok(Math.abs(character.position[0]-135)<.1);
 assert.equal(project.animationCompletions.sequence,1);
 report.assertions=['physics-enabled generated project keeps protocol11', 'native sensor emits two events with genuine sensor binding identity', 'recognized instance controller completes idle/action/idle', 'all animation command/completion frames explicitly target the character instance; state entries retain that same instance identity', 'native wall still blocks logical root near x135'];
 report.protocolVersion=project.protocolVersion;report.target=target;report.events=project.events;report.stateEntries=project.animationStateEntries;report.character=character;
 report.backend=built.record.backend;
 report.sourceHashes={};for(const name of ['scripts/backends/godot4-adapter.mjs','scripts/backends/godot4-physics.mjs','scripts/backends/godot4/physics-runtime.gd','scripts/backends/godot4/project-physics-runtime.gd'])report.sourceHashes[name]=createHash('sha256').update(await fs.readFile('/home/chiharukiryu/cdev/viento-studio/'+name)).digest('hex');
 report.success=true; console.log('PASS physics + instance animation protocol11; native enter/exit -> idle/action/idle; target',JSON.stringify(target));
} catch(error){report.error={name:error.name,message:error.message,stack:error.stack};process.exitCode=1;console.error(error);} finally {
 for(const fn of cleanup.reverse())await fn();
 report.cleanup='temporary author/build fixture removed';await fs.writeFile(path.join(evidence,'report.json'),JSON.stringify(report,null,2)+'\n');
}
