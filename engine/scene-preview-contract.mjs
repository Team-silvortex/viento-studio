// Transport identity only; safe for native browser module loading.
export const SCENE_PREVIEW_API_PATH = '/api/scene-preview';

// Leaves room for worst-case JSON escaping and the envelope inside the existing
// 1 MiB HTTP request limit. This bounds source bytes, not UTF-16 code units.
export const MAX_SCENE_DRAFT_BYTES = 128 * 1024;
