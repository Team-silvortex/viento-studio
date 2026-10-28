// Synthetic metadata for host-only tests; native clock evidence uses Godot.
export function createProjectFrameEncoder() {
  let index = 0;
  return (frame, clock = { idleFrame: 0, physicsFrame: 0 }) => 'VIENTO_EXECUTION_FRAME:' + JSON.stringify({ protocol: 1, index: ++index, clock, frame }) + '\n';
}
export function projectFramesFromStdout(stdout) {
  return stdout.split('\n').flatMap(line => line.startsWith('VIENTO_EXECUTION_FRAME:')
    ? [JSON.parse(line.slice('VIENTO_EXECUTION_FRAME:'.length)).frame]
    : line.startsWith('VIENTO_PROJECT:') ? [JSON.parse(line.slice('VIENTO_PROJECT:'.length))] : []);
}
