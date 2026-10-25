// Native declaration rules only. Engines own simulation and hosts own source IO.
import { dispatchStudioCoreScenePhysics2D, dispatchStudioCoreScenePhysics2DResponse, dispatchStudioCoreScenePhysics2DMotion, dispatchStudioCoreScenePhysics2DOneWay, STUDIO_CORE_PROTOCOL_VERSION } from './studio-core.mjs';
const freeze = value => {
  if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); }
  return value;
};
export function inspectScenePhysics2D(document) {
  // Inspect only a data descriptor before the bridge safely captures the full input.
  const version = document !== null && typeof document === 'object'
    ? Object.getOwnPropertyDescriptor(document, 'schemaVersion')?.value : undefined;
  const dispatch = version === 4 ? dispatchStudioCoreScenePhysics2DOneWay : version === 3 ? dispatchStudioCoreScenePhysics2DMotion
    : version === 2 ? dispatchStudioCoreScenePhysics2DResponse : dispatchStudioCoreScenePhysics2D;
  return freeze(dispatch({ protocolVersion: STUDIO_CORE_PROTOCOL_VERSION,
    operation: version === 4 ? 'scenePhysics2D.inspectOneWay' : version === 3 ? 'scenePhysics2D.inspectMotion' : version === 2 ? 'scenePhysics2D.inspectResponse' : 'scenePhysics2D.inspect', document }));
}
