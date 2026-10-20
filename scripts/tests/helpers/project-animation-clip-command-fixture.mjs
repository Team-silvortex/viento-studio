import { animationProject, animationReady, animationCommand } from './project-animation-command-fixture.mjs';
import { runtimeId, enterScene, readyScene, exitScene } from './project-runtime-fixture.mjs';
export const clipFrame = frame => ({ ...frame, protocol: 6 });
export function clipProject() {
  const plan = animationProject(), animation = plan.scenes[0].animation;
  animation.schemaVersion = 2; animation.document.schemaVersion = 3; animation.document.loop = true;
  animation.document.clips = [
    { id: runtimeId(210), name: '待机 / 待機 🌬️', startSeconds: .2, endSeconds: .6, loop: false },
    { id: runtimeId(211), name: 'Move', startSeconds: .4, endSeconds: 1, loop: true },
  ];
  animation.locations.clips = animation.document.clips.map((clip, i) => ({ id: clip.id,
    declaration: { ...animation.manifest, propertyPath: `/clips/${i}` } }));
  plan.scenes[0].requiredCapabilities.push('animation.clips2d');
  plan.requiredCapabilities = [...new Set(['project.scenes', ...plan.scenes.flatMap(scene => scene.requiredCapabilities)])].sort();
  return plan;
}
export function clipCommand(scene, visit, sequence, command, seconds, position, phase, clipId = null) {
  const frame = clipFrame(animationCommand(scene, visit, sequence, 'pause', seconds, position, phase));
  frame.command = command; frame.state.clipId = clipId; return frame;
}
export function clipReturnTrip(plan) {
  const [a,b] = plan.scenes, [one,two] = a.animation.document.clips, end = one.endSeconds - one.startSeconds;
  return [clipFrame(animationReady(plan)), clipFrame(enterScene(a, 1)), clipFrame(readyScene(a, 1)),
    clipCommand(a,1,1,{action:'select',clipId:one.id},.1,0,'paused',one.id),
    clipCommand(a,1,2,{action:'play'},.1,0,'playing',one.id),
    clipCommand(a,1,3,{action:'pause'},.35,.25,'paused',one.id),
    clipCommand(a,1,4,{action:'seek',positionSeconds:end},.35,end,'paused',one.id),
    clipCommand(a,1,5,{action:'play'},.35,0,'playing',one.id),
    clipCommand(a,1,6,{action:'select',clipId:two.id},.4,0,'paused',two.id),
    clipCommand(a,1,7,{action:'seek',positionSeconds:.25},.4,.25,'paused',two.id),
    clipCommand(a,1,8,{action:'play'},.4,.25,'playing',two.id),
    clipCommand(a,1,9,{action:'pause'},.55,.4,'paused',two.id),
    clipCommand(a,1,10,{action:'select',clipId:null},.55,0,'paused'),
    clipCommand(a,1,11,{action:'play'},.55,0,'playing'),
    clipFrame(exitScene(a,1,.6,b)),clipFrame(enterScene(b,2)),clipFrame(readyScene(b,2)),
    clipCommand(b,2,12,{action:'select',clipId:null},0,0,'paused'),
    clipCommand(b,2,13,{action:'play'},0,0,'playing'),clipFrame(exitScene(b,2,.1,a)),
    clipFrame(enterScene(a,3)),clipFrame(readyScene(a,3)),clipCommand(a,3,14,{action:'pause'},.1,.1,'paused'),
    clipFrame(exitScene(a,3,.1)), {protocol:6,event:'finished',assemblyId:plan.assembly.objectId,visitCount:3,totalSeconds:.8,
      stateRevision:0,eventSequence:0,audioCommandSequence:0,animationCommandSequence:14}];
}
