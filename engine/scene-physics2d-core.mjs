// Native declaration rules only. Engines own simulation and hosts own source IO.
import { dispatchStudioCoreScenePhysics2D, STUDIO_CORE_PROTOCOL_VERSION } from './studio-core.mjs';
const freeze = value => {
  if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); }
  return value;
};
export function inspectScenePhysics2D(document) {
  return freeze(dispatchStudioCoreScenePhysics2D({ protocolVersion: STUDIO_CORE_PROTOCOL_VERSION,
    operation: 'scenePhysics2D.inspect', document }));
}
