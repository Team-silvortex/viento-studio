// Tool selection is trusted local-host configuration, never HTTP author data.
import { DEFAULT_EXECUTION_BACKEND } from './node-execution-backends.mjs';
import { buildError } from './node-build-snapshot.mjs';

const toolEnvironments = Object.freeze({
  'org.viento.godot4': 'VIENTO_GODOT_BIN',
  'org.viento.bevy': 'VIENTO_BEVY_BIN',
});

export function executionHostConfiguration({ env = process.env, backendId, tool } = {}) {
  const selected = backendId ?? env.VIENTO_EXECUTION_BACKEND ?? DEFAULT_EXECUTION_BACKEND;
  if (typeof selected !== 'string' || !Object.hasOwn(toolEnvironments, selected)) {
    throw buildError('build_backend_missing', 'The configured execution backend is not registered on this host.');
  }
  return { backendId: selected, tool: tool ?? env[toolEnvironments[selected]] };
}
