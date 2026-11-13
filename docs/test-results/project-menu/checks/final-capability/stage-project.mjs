import fs from 'node:fs/promises';
import { generateGodotPhysicsPlanarIntentProject } from '/home/chiharukiryu/cdev/viento-studio/scripts/backends/godot4-physics-planar-intent.mjs';
import { applyGodotSceneRetryProject } from '/home/chiharukiryu/cdev/viento-studio/scripts/backends/godot4-scene-retry.mjs';
import { applyGodotSceneRestartProject } from '/home/chiharukiryu/cdev/viento-studio/scripts/backends/godot4-scene-restart.mjs';
import { applyGodotProjectPause } from '/home/chiharukiryu/cdev/viento-studio/scripts/backends/godot4-project-pause.mjs';
import { applyGodotProjectMenu } from '/home/chiharukiryu/cdev/viento-studio/scripts/backends/godot4-project-menu.mjs';
import { cameraProject } from '/home/chiharukiryu/cdev/viento-studio/scripts/tests/helpers/godot-camera2d-fixture.mjs';
const g=await applyGodotProjectMenu(await applyGodotProjectPause(await applyGodotSceneRestartProject(await applyGodotSceneRetryProject(await generateGodotPhysicsPlanarIntentProject(cameraProject())))));
await fs.mkdir('/tmp/viento-menu-parse-probe',{recursive:true});
for(const [name,bytes] of g.files){await fs.mkdir('/tmp/viento-menu-parse-probe/'+name.split('/').slice(0,-1).join('/'),{recursive:true});await fs.writeFile('/tmp/viento-menu-parse-probe/'+name,bytes);}
console.log(g.backend.version,g.files.size);
