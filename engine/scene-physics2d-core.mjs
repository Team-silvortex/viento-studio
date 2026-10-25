// Native declaration rules only. Engines own simulation and hosts own source IO.
import { dispatchStudioCoreScenePhysics2D, dispatchStudioCoreScenePhysics2DResponse, STUDIO_CORE_PROTOCOL_VERSION } from './studio-core.mjs';
const freeze = value => {
  if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); }
  return value;
};
export function inspectScenePhysics2D(document) {
  // Inspect only a data descriptor before the bridge safely captures the full input.
  const response = document !== null && typeof document === 'object'
    && Object.getOwnPropertyDescriptor(document, 'schemaVersion')?.value === 2;
  const dispatch = response ? dispatchStudioCoreScenePhysics2DResponse : dispatchStudioCoreScenePhysics2D;
  return freeze(dispatch({ protocolVersion: STUDIO_CORE_PROTOCOL_VERSION,
    operation: response ? 'scenePhysics2D.inspectResponse' : 'scenePhysics2D.inspect', document }));
}
