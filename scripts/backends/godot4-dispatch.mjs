// Keep the original generator bytes and fingerprint available for frozen v1 builds.
import * as legacy from './godot4.mjs';
import * as instances from './godot4-instances.mjs';
import { buildError } from '../adapters/node-build-snapshot.mjs';

export const GODOT4_BACKEND = instances.GODOT4_BACKEND;
export const identifyGodot = legacy.identifyGodot;
const backendFor = plan => {
  if (plan?.schemaVersion === 1) return legacy;
  if (plan?.schemaVersion === 2) return instances;
  throw buildError('build_scene_version', 'Unsupported scene build plan version.');
};
export const generateGodotProject = plan => backendFor(plan).generateGodotProject(plan);
export const godotDiagnostics = (result, plan) => backendFor(plan).godotDiagnostics(result, plan);
export const createRuntimeEventReader = (plan, options) => backendFor(plan).createRuntimeEventReader(plan, options);
export const readRuntimeEvents = (result, plan) => backendFor(plan).readRuntimeEvents(result, plan);
