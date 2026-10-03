import {
  API_PATHS,
  API_METHODS,
  API_RESPONSE,
  API_RESPONSE_DEFAULTS,
  makeCapabilitiesPayload,
  makeRebuildResponse,
} from './doc-api-contract.mjs';
import { appendFile } from 'node:fs/promises';
import { timingSafeEqual } from 'node:crypto';
import { WORLD_API_PATH } from '../../engine/world-query.mjs';
import { WORLD_COMMAND_API_PATH } from '../../engine/world-command-contract.mjs';
import { PROJECT_BUILD_API_PATH } from '../../engine/build-plan.mjs';
import { SCENE_PREVIEW_API_PATH } from '../../engine/scene-preview-contract.mjs';
import { RESOURCE_PACKAGE_API, PACKAGE_LIMITS } from '../../engine/resource-package.mjs';
import {
  readRequestJsonBody,
  sendApiResponse,
  sendApiError,
  sendFile,
  getMime,
} from './doc-server.mjs';

const RATE_LIMIT_WINDOW_MS = normalizeNumericConfigValue('DOC_API_RATE_WINDOW_MS', 60 * 1000);
const RATE_LIMIT_MAX_REQUESTS = normalizeNumericConfigValue('DOC_API_RATE_LIMIT_MAX_REQUESTS', 120);
const RATE_LIMIT_BUCKET_MAX = normalizeNumericConfigValue('DOC_API_RATE_BUCKET_MAX', 2048, 1);
const WRITE_TOKENS = extractTokenList(process.env.DOC_API_TOKEN || process.env.DOC_API_WRITE_TOKEN);
const SECURITY_AUDIT_LOG_FILE = process?.env?.DOC_API_SECURITY_AUDIT_LOG_FILE || '';
const TRUST_PROXY_IP = process?.env?.DOC_API_TRUST_PROXY === '1';
const REQUIRE_WRITE_AUTH = process?.env?.DOC_API_REQUIRE_WRITE_AUTH === '1'
  || (process?.env?.NODE_ENV === 'production' && process?.env?.DOC_API_REQUIRE_WRITE_AUTH !== '0');
const API_RATE_BUCKETS = new Map();
const SECURITY_AUDIT_ENABLED = process?.env?.DOC_API_SECURITY_AUDIT === '1';
const WRITE_METHODS = new Set([API_METHODS.POST, API_METHODS.PUT]);
const REBUILD_METHODS = new Set([API_METHODS.POST]);

// Build can launch a native process; ordinary web editing does not otherwise
// require loopback or an Origin header. Validate the socket, never proxy headers.
export function isLocalBuildRequest(request) {
  const loopback = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);
  if (!loopback.has(request.socket?.remoteAddress)) return false;
  const host = request.headers?.host, port = request.socket?.localPort;
  if (![`127.0.0.1:${port}`, `localhost:${port}`, `[::1]:${port}`].includes(host)) return false;
  if (request.headers.origin && request.headers.origin !== `http://${host}`) return false;
  return !['cross-site'].includes(request.headers['sec-fetch-site']);
}

function sanitizeClientIdentity(rawIdentity = '') {
  if (typeof rawIdentity !== 'string') {
    return 'unknown';
  }

  const normalized = rawIdentity.toString().trim();
  if (!normalized) {
    return 'unknown';
  }

  const rawClient = normalized.split(',')[0].trim();
  return rawClient ? rawClient.slice(0, 128) : 'unknown';
}

function isAuthTokenMatch(rawInput = '', candidate = '') {
  if (typeof rawInput !== 'string' || typeof candidate !== 'string') {
    return false;
  }

  if (!rawInput.length || !candidate.length) {
    return false;
  }

  const a = Buffer.from(rawInput);
  const b = Buffer.from(candidate);
  if (a.length !== b.length) {
    return false;
  }

  return timingSafeEqual(a, b);
}

function normalizeToken(rawToken = '') {
  if (typeof rawToken !== 'string') {
    return '';
  }

  return rawToken.trim().toLowerCase();
}

function normalizeRequestMethod(rawMethod = '') {
  return typeof rawMethod === 'string'
    ? rawMethod.trim().toUpperCase()
    : '';
}

function getContentType(request) {
  const headers = request?.headers || {};
  return (headers['content-type'] || headers['Content-Type'] || '').toString();
}

function isJsonRequest(request) {
  const contentType = getContentType(request).toLowerCase();
  if (!contentType) {
    return false;
  }

  return contentType.includes('application/json')
    || contentType.includes('+json')
    || contentType.includes('text/json');
}

function logSecurityEvent(eventType = '', request = null, details = {}) {
  if (!SECURITY_AUDIT_ENABLED) {
    return;
  }

  const payload = {
    t: new Date().toISOString(),
    event: eventType,
    method: typeof details.method === 'string' ? details.method : (typeof request?.method === 'string' ? request.method.toUpperCase() : ''),
    path: typeof details.path === 'string' ? details.path : '',
    client: getClientIdentity(request),
    status: Number.isFinite(details.status) ? details.status : 0,
    reason: typeof details.reason === 'string' ? details.reason : '',
  };

  if (details.requestId) {
    payload.requestId = details.requestId;
  }
  if (typeof details.errorCode === 'string') {
    payload.errorCode = details.errorCode;
  }

  console.warn('[doc-security]', JSON.stringify(payload));
  if (typeof SECURITY_AUDIT_LOG_FILE === 'string' && SECURITY_AUDIT_LOG_FILE.trim()) {
    appendFile(SECURITY_AUDIT_LOG_FILE, `${JSON.stringify(payload)}\n`).catch(() => {});
  }
}

function normalizeNumericConfigValue(name, fallback, min = 1) {
  const raw = process.env[name];
  if (!raw) {
    return fallback;
  }

  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < min) {
    return fallback;
  }

  return parsed;
}

function extractTokenList(rawValue) {
  if (!rawValue || typeof rawValue !== 'string') {
    return [];
  }

  return rawValue
    .split(',')
    .map((token) => token.trim())
    .filter(Boolean)
    .map((token) => token.toLowerCase());
}

function getClientIdentity(request) {
  if (!request || !request.socket) {
    return 'unknown';
  }

  const forwardedHeader = TRUST_PROXY_IP ? request.headers?.['x-forwarded-for'] : '';
  const remoteAddress = forwardedHeader
    ? request.headers['x-forwarded-for'].split(',')[0].trim()
    : request.socket.remoteAddress;

  return sanitizeClientIdentity(remoteAddress);
}

function pruneRateLimitBuckets(now = Date.now()) {
  if (!Number.isInteger(RATE_LIMIT_BUCKET_MAX) || RATE_LIMIT_BUCKET_MAX <= 0) {
    return;
  }

  if (API_RATE_BUCKETS.size <= RATE_LIMIT_BUCKET_MAX) {
    return;
  }

  for (const [key, state] of API_RATE_BUCKETS.entries()) {
    if (now - state.windowStartAt > RATE_LIMIT_WINDOW_MS) {
      API_RATE_BUCKETS.delete(key);
    }
    if (API_RATE_BUCKETS.size <= RATE_LIMIT_BUCKET_MAX) {
      return;
    }
  }

  if (API_RATE_BUCKETS.size <= RATE_LIMIT_BUCKET_MAX) {
    return;
  }

  const sortedEntries = Array.from(API_RATE_BUCKETS.entries())
    .filter((entry) => entry?.[1] && typeof entry[1].windowStartAt === 'number')
    .sort((a, b) => a[1].windowStartAt - b[1].windowStartAt);
  for (const [key] of sortedEntries) {
    if (API_RATE_BUCKETS.size <= RATE_LIMIT_BUCKET_MAX) {
      return;
    }
    API_RATE_BUCKETS.delete(key);
  }
}

function getRateLimitState(clientId, now = Date.now()) {
  const existing = API_RATE_BUCKETS.get(clientId);
  if (!existing) {
    const next = {
      windowStartAt: now,
      count: 0,
    };
    API_RATE_BUCKETS.set(clientId, next);
    return next;
  }

  if (now - existing.windowStartAt >= RATE_LIMIT_WINDOW_MS) {
    existing.windowStartAt = now;
    existing.count = 0;
  }

  return existing;
}

function getRetryAfterSeconds(state, now = Date.now()) {
  const elapsed = now - state.windowStartAt;
  const remaining = Math.max(0, RATE_LIMIT_WINDOW_MS - elapsed);
  return Math.max(1, Math.ceil(remaining / 1000));
}

function applyRateLimit(response, request, pathname = '') {
  if (!Number.isInteger(RATE_LIMIT_MAX_REQUESTS) || RATE_LIMIT_MAX_REQUESTS <= 0) {
    return false;
  }

  const now = Date.now();
  pruneRateLimitBuckets(now);
  // Draft previews are frequent read-only work. They must not consume the
  // request allowance used for saving or navigating the user's documents.
  const previewImage = pathname === SCENE_PREVIEW_API_PATH && request.method === API_METHODS.GET;
  const clientId = `${getClientIdentity(request)}${previewImage ? ':scene-preview-images'
    : pathname === SCENE_PREVIEW_API_PATH ? ':scene-preview'
    : pathname === API_PATHS.MEDIA_INSERT ? ':media-preview'
    : pathname === PROJECT_BUILD_API_PATH && request.method === API_METHODS.GET ? ':build-status' : ''}`;
  const state = getRateLimitState(clientId, now);
  state.count += 1;

  // A scene permits 128 distinct images; two retained previews must be able to
  // load in one window without spending the document-write request allowance.
  const requestAllowance = previewImage ? Math.max(256, RATE_LIMIT_MAX_REQUESTS) : RATE_LIMIT_MAX_REQUESTS;
  if (state.count <= requestAllowance) {
    return false;
  }

  const retryAfter = getRetryAfterSeconds(state, now);
  response.setHeader('Retry-After', String(retryAfter));
  logSecurityEvent('rate_limit', request, {
    method: request?.method,
    path: pathname,
    status: 429,
    reason: 'request_rate_limited',
    errorCode: API_RESPONSE_DEFAULTS.rateLimitErrorPrefix,
    requestId: requestIdFromRequest(request),
  });
  sendApiError(response, 429, 'too many requests', {
    [API_RESPONSE.errorCode]: API_RESPONSE_DEFAULTS.rateLimitErrorPrefix,
    retryAfterSeconds: retryAfter,
  }, requestIdFromRequest(request));
  return true;
}

function requestIdFromRequest(request) {
  return typeof request?.url === 'string' ? `${request.url}-${Date.now()}` : '';
}

function extractAuthToken(request) {
  const headers = request?.headers || {};
  const rawAuth = headers.authorization || headers.Authorization || headers['x-api-token'] || headers['X-API-TOKEN'];
  if (!rawAuth || typeof rawAuth !== 'string') {
    return '';
  }

  const bearerMatch = rawAuth.match(/^Bearer\s+(.+)$/i);
  if (bearerMatch && bearerMatch[1]) {
    return normalizeToken(bearerMatch[1]);
  }

  return normalizeToken(rawAuth);
}

function isAuthEnabled() {
  return REQUIRE_WRITE_AUTH || WRITE_TOKENS.length > 0;
}

if (REQUIRE_WRITE_AUTH && !WRITE_TOKENS.length) {
  console.warn('[doc-security] write APIs are configured to require auth, but no token is configured');
}

function isTokenAllowed(rawToken) {
  if (!isAuthEnabled()) {
    return true;
  }
  const normalized = normalizeToken(rawToken);
  if (!normalized) {
    return false;
  }

  return WRITE_TOKENS.some((token) => isAuthTokenMatch(normalized, token));
}

function isMutatingWriteRequest(pathname, method = '') {
  if (pathname === SCENE_PREVIEW_API_PATH && ['POST', 'DELETE'].includes(method)) return true;
  if (pathname === PROJECT_BUILD_API_PATH && method === API_METHODS.POST) return true;
  if (pathname === RESOURCE_PACKAGE_API && method === API_METHODS.POST) return true;
  if (pathname === WORLD_COMMAND_API_PATH && method === API_METHODS.POST) return true;
  if (pathname === API_PATHS.EXPORT && method === API_METHODS.POST) return true;
  return pathname === API_PATHS.DOC && WRITE_METHODS.has(method)
    || pathname === API_PATHS.REBUILD && REBUILD_METHODS.has(method)
    || [API_PATHS.ASSETS, API_PATHS.MEDIA_INSERT, API_PATHS.FIELDS, API_PATHS.PROJECT, API_PATHS.PROJECT_PREVIEW].includes(pathname) && method === API_METHODS.POST;
}

function methodNotAllowed(response, allow = 'GET', requestId = '') {
  response.statusCode = 405;
  response.setHeader('Allow', allow);
  sendApiError(response, response.statusCode, 'method not allowed', {
    [API_RESPONSE.errorCode]: API_RESPONSE_DEFAULTS.methodErrorPrefix,
  }, requestId);
  return 405;
}

function isHttpStatus(value, fallback = 500) {
  return Number.isInteger(value) && value >= 100 && value < 600
    ? value
    : fallback;
}

function mapServiceErrorToHttp(error, response, requestId = '') {
  if (error?.statusCode) {
    const statusCode = isHttpStatus(error.statusCode, 400);
    const isServerError = statusCode >= 500;
    const normalizedErrorCode = typeof error.errorCode === 'string' && error.errorCode.trim()
      ? error.errorCode.trim()
      : '';
    sendApiError(response, statusCode, isServerError ? 'internal error' : (error.message || 'request rejected'), {
      ...(error.payload && typeof error.payload === 'object' ? error.payload : {}),
      ...(normalizedErrorCode ? { [API_RESPONSE.errorCode]: normalizedErrorCode } : {}),
    }, requestId);
    return statusCode;
  }

  const statusCode = 500;
  sendApiError(response, statusCode, error?.message || 'internal error', {
    [API_RESPONSE.errorCode]: API_RESPONSE_DEFAULTS.internalErrorPrefix,
  }, requestId);
  return statusCode;
}

async function handleApiAssets(response, request, requestUrl, service, requestId = '') {
  try {
    const data = request.method === API_METHODS.POST
      ? await service.importMediaAsset(request, requestUrl.searchParams.get('name'))
      : await service.getMediaAssets();
    sendApiResponse(response, data, requestId);
    return 200;
  } catch (error) { return mapServiceErrorToHttp(error, response, requestId); }
}

async function handleExport(response, request, requestUrl, service, requestId = '') {
  const controller = new AbortController();
  const cancel = () => { if (!response.writableEnded) controller.abort(new Error('导出已取消')); };
  response.on('close', cancel);
  try {
    if (request.method === API_METHODS.GET) {
      await service.exports.download(requestUrl.searchParams.get('id'), async (job) => {
        const fallback = job.kind === 'asset' ? job.fileName.replace(/[^a-zA-Z0-9._-]/g, '_') : 'viento-export.zip';
        const encodedName = encodeURIComponent(job.fileName).replace(/['()*]/g, ch => `%${ch.charCodeAt(0).toString(16).toUpperCase()}`);
        response.setHeader('Content-Disposition', `attachment; filename="${fallback}"; filename*=UTF-8''${encodedName}`);
        response.setHeader('Cache-Control', 'no-store');
        await sendFile(job.file, response, request, { contentType: job.kind === 'asset' ? getMime(job.fileName) : 'application/zip' });
        if (!response.writableFinished) return false;
        if (response.statusCode === 200) return true;
        if (response.statusCode !== 206) return false;
        // Use the actual response bounds: suffix/open ranges and overlong ends
        // are normalized by sendFile. Only a completed response proves a range.
        const range = /^bytes (\d+)-(\d+)\/(\d+)$/.exec(response.getHeader('Content-Range') || '');
        return range ? { start: Number(range[1]), end: Number(range[2]), total: Number(range[3]) } : false;
      });
    } else {
      const payload = await readRequestJsonBody(request);
      const result = payload?.action === 'release'
        ? await service.exports.release(payload.id).then(() => ({ released: true }))
        : await service.exports.create(payload, controller.signal);
      sendApiResponse(response, result, requestId);
    }
    return response.destroyed && !response.writableFinished ? 499 : response.statusCode;
  } catch (error) {
    if (response.destroyed) return 499;
    if (response.headersSent) { response.destroy(); return 500; }
    return mapServiceErrorToHttp(error, response, requestId);
  } finally { response.removeListener('close', cancel); }
}

async function handleResourcePackage(response, request, requestUrl, service, requestId = '') {
  const controller = new AbortController();
  const cancel = () => { if (!response.writableEnded) controller.abort(new Error('Resource package request cancelled')); };
  response.on('close', cancel);
  try {
    let result;
    if (request.method === API_METHODS.GET) result = requestUrl.searchParams.get('status') === '1'
      ? await service.resourcePackages.status() : await service.resourcePackages.catalog(controller.signal);
    else if (getContentType(request) === 'application/octet-stream') {
      if (Number(request.headers['content-length']) > PACKAGE_LIMITS.fileBytes) {
        request.resume(); sendApiError(response, 413, 'resource package too large', {}, requestId); return 413;
      }
      result = await service.resourcePackages.inspect(request, controller.signal);
    } else result = await service.resourcePackages.command(await readRequestJsonBody(request), controller.signal);
    if (!response.destroyed) sendApiResponse(response, result, requestId);
    return response.destroyed && !response.writableFinished ? 499 : 200;
  } catch (error) {
    if (response.destroyed) return 499;
    if (error instanceof SyntaxError) { sendApiError(response, 400, 'Invalid JSON', {}, requestId); return 400; }
    return mapServiceErrorToHttp(error, response, requestId);
  } finally { response.removeListener('close', cancel); }
}

async function handleMediaInsertion(response, request, service, requestId = '') {
  try {
    const data = await service.prepareMediaInsertion(await readRequestJsonBody(request));
    sendApiResponse(response, data, requestId);
    return 200;
  } catch (error) { return mapServiceErrorToHttp(error, response, requestId); }
}

async function handleDocumentFields(response, request, service, requestId = '') {
  try {
    const data = await service.prepareDocumentFields(await readRequestJsonBody(request));
    sendApiResponse(response, data, requestId);
    return 200;
  } catch (error) { return mapServiceErrorToHttp(error, response, requestId); }
}

async function handleProject(response, request, service, preview, requestId = '') {
  try {
    const data = request.method === 'GET' ? await service.getProject()
      : await service[preview ? 'previewProject' : 'saveProject'](await readRequestJsonBody(request));
    sendApiResponse(response, data, requestId);
    return 200;
  } catch (error) { return mapServiceErrorToHttp(error, response, requestId); }
}

async function handleApiIndex(response, service, requestId = '') {
  try {
    const indexData = await service.getDocIndex();
    sendApiResponse(response, indexData, requestId);
    return isHttpStatus(response.statusCode, 200);
  } catch (error) {
    return mapServiceErrorToHttp(error, response, requestId);
  }
}

async function handleApiCapabilities(response, service, requestId = '') {
  try {
    const { editablePrefixes, backstoryMergeMode } = service.getRuntimeConfig();
    const capabilities = service.getCapabilities ? await service.getCapabilities() : makeCapabilitiesPayload(editablePrefixes, backstoryMergeMode);
    sendApiResponse(response, capabilities, requestId);
    return isHttpStatus(response.statusCode, 200);
  } catch (error) {
    return mapServiceErrorToHttp(error, response, requestId);
  }
}

async function handleApiDocGet(response, requestUrl, service, requestId = '') {
  const rawPath = requestUrl.searchParams.get('path') || '';
  try {
    const data = await service.getDocByPath(rawPath);
    sendApiResponse(response, data, requestId);
    return isHttpStatus(response.statusCode, 200);
  } catch (error) {
    return mapServiceErrorToHttp(error, response, requestId);
  }
}

async function handleApiDocWrite(response, request, service, requestId = '') {
  try {
    const payload = await readRequestJsonBody(request);
    const data = await service.writeDoc(payload);
    sendApiResponse(response, data, requestId);
    return isHttpStatus(response.statusCode, 200);
  } catch (error) {
    if (error instanceof SyntaxError) {
      const statusCode = 400;
      sendApiError(response, statusCode, `invalid json: ${error?.message || 'parse error'}`, {
        [API_RESPONSE.errorCode]: API_RESPONSE_DEFAULTS.invalidJsonErrorPrefix,
      }, requestId);
      return statusCode;
    }
    return mapServiceErrorToHttp(error, response, requestId);
  }
}

async function handleApiRebuild(response, request, service, requestId = '') {
  try {
    const payload = await readRequestJsonBody(request);
    const { result, sourceFilter } = await service.runRebuild(payload);
    sendApiResponse(response, makeRebuildResponse(result, sourceFilter), requestId);
    return isHttpStatus(response.statusCode, 200);
  } catch (error) {
    if (error instanceof SyntaxError) {
      const statusCode = 400;
      sendApiError(response, statusCode, `invalid json: ${error?.message || 'parse error'}`, {
        [API_RESPONSE.errorCode]: API_RESPONSE_DEFAULTS.invalidJsonErrorPrefix,
      }, requestId);
      return statusCode;
    }
    return mapServiceErrorToHttp(error, response, requestId);
  }
}

async function handleApiHealth(response, service, requestId = '') {
  try {
    const health = typeof service.getHealth === 'function'
      ? service.getHealth()
      : {
        ok: false,
        status: 'unavailable',
        timestamp: new Date().toISOString(),
      };
    sendApiResponse(response, health, requestId);
    return isHttpStatus(response.statusCode, 200);
  } catch (error) {
    return mapServiceErrorToHttp(error, response, requestId);
  }
}

async function handleApiMetrics(response, service, requestId = '') {
  try {
    const metrics = typeof service.getRequestMetricsSnapshot === 'function'
      ? service.getRequestMetricsSnapshot()
      : {};
    sendApiResponse(response, metrics, requestId);
    return isHttpStatus(response.statusCode, 200);
  } catch (error) {
    return mapServiceErrorToHttp(error, response, requestId);
  }
}

async function handleApiRequest({
  pathname,
  request,
  response,
  requestUrl,
  service,
}) {
  const method = normalizeRequestMethod(request?.method);
  let trace = null;
  let requestId = '';

  const route = {
    [SCENE_PREVIEW_API_PATH]: {
      [API_METHODS.POST]: async () => {
        const controller = new AbortController();
        const disconnected = () => { if (!response.writableFinished) controller.abort(); };
        response.once('close', disconnected);
        try {
          if (requestUrl.search) throw Object.assign(new Error('Invalid preview query'), { statusCode: 400, errorCode: 'scene_preview_request_invalid' });
          response.setHeader('Cache-Control', 'no-store');
          sendApiResponse(response, await service.scenePreview.create(await readRequestJsonBody(request), { signal: controller.signal }), requestId); return 200;
        } catch (error) {
          if (response.destroyed || response.writableEnded) return 499;
          if (error instanceof SyntaxError) { sendApiError(response, 400, 'Invalid scene preview JSON', { errorCode: 'scene_preview_request_invalid' }, requestId); return 400; }
          return mapServiceErrorToHttp(error, response, requestId);
        } finally { response.removeListener('close', disconnected); }
      },
      [API_METHODS.GET]: async () => {
        try {
          const query = requestUrl.searchParams;
          if ([...query.keys()].length !== 2 || query.getAll('previewId').length !== 1 || query.getAll('resourceId').length !== 1) {
            throw Object.assign(new Error('Invalid preview query'), { statusCode: 400, errorCode: 'scene_preview_request_invalid' });
          }
          const resource = service.scenePreview.resource(query.get('previewId'), query.get('resourceId'));
          response.setHeader('Cache-Control', 'no-store');
          response.setHeader('Content-Type', resource.contentType);
          response.setHeader('Content-Length', String(resource.bytes.length));
          response.setHeader('X-Content-Type-Options', 'nosniff');
          response.setHeader('Content-Security-Policy', "sandbox; default-src 'none'; style-src 'unsafe-inline'; img-src data:; frame-ancestors 'none'");
          response.statusCode = 200; response.end(resource.bytes); return 200;
        } catch (error) { return mapServiceErrorToHttp(error, response, requestId); }
      },
      DELETE: async () => {
        try {
          const query = requestUrl.searchParams;
          if ([...query.keys()].length !== 1 || query.getAll('previewId').length !== 1) {
            throw Object.assign(new Error('Invalid preview query'), { statusCode: 400, errorCode: 'scene_preview_request_invalid' });
          }
          response.setHeader('Cache-Control', 'no-store');
          sendApiResponse(response, service.scenePreview.release(query.get('previewId')), requestId); return 200;
        } catch (error) { return mapServiceErrorToHttp(error, response, requestId); }
      },
    },
    [PROJECT_BUILD_API_PATH]: {
      [API_METHODS.GET]: async () => {
        try {
          if ([...requestUrl.searchParams.keys()].some(key => key !== 'refresh') || requestUrl.searchParams.getAll('refresh').length > 1
            || requestUrl.searchParams.has('refresh') && requestUrl.searchParams.get('refresh') !== '1') throw Object.assign(new Error('Invalid build query'), { statusCode: 400, errorCode: 'build_request_invalid' });
          response.setHeader('Cache-Control', 'no-store');
          sendApiResponse(response, await service.projectBuild.status({ refresh: requestUrl.searchParams.get('refresh') === '1' }), requestId); return 200;
        } catch (error) { return mapServiceErrorToHttp(error, response, requestId); }
      },
      [API_METHODS.POST]: async () => {
        try {
          response.setHeader('Cache-Control', 'no-store');
          sendApiResponse(response, await service.projectBuild.command(await readRequestJsonBody(request)), requestId); return 200;
        } catch (error) {
          if (error instanceof SyntaxError) { sendApiError(response, 400, 'Invalid build JSON', { errorCode: 'build_request_invalid' }, requestId); return 400; }
          return mapServiceErrorToHttp(error, response, requestId);
        }
      },
    },
    [RESOURCE_PACKAGE_API]: {
      [API_METHODS.GET]: () => handleResourcePackage(response, request, requestUrl, service, requestId),
      [API_METHODS.POST]: () => handleResourcePackage(response, request, requestUrl, service, requestId),
    },
    '/api/world/transaction': {
      [API_METHODS.GET]: async () => {
        try { sendApiResponse(response, await service.transactionStatus(), requestId); return 200; }
        catch (error) { return mapServiceErrorToHttp(error, response, requestId); }
      },
    },
    [WORLD_COMMAND_API_PATH]: {
      [API_METHODS.POST]: async () => {
        try {
          sendApiResponse(response, await service.executeWorldCommand(await readRequestJsonBody(request)), requestId);
          return 200;
        } catch (error) {
          if (error instanceof SyntaxError) {
            sendApiError(response, 400, 'Invalid command JSON', { errorCode: 'world_command_invalid' }, requestId);
            return 400;
          }
          return mapServiceErrorToHttp(error, response, requestId);
        }
      },
    },
    [WORLD_API_PATH]: {
      [API_METHODS.GET]: async () => {
        try {
          const query = Object.fromEntries(requestUrl.searchParams);
          if (Object.keys(query).length !== [...requestUrl.searchParams].length) {
            sendApiError(response, 400, 'Duplicate world query parameter', { errorCode: 'world_query_invalid' }, requestId);
            return 400;
          }
          sendApiResponse(response, await service.queryWorld(query), requestId);
          return 200;
        } catch (error) { return mapServiceErrorToHttp(error, response, requestId); }
      },
    },
    [API_PATHS.PROJECT]: {
      [API_METHODS.GET]: () => handleProject(response, request, service, false, requestId),
      [API_METHODS.POST]: () => handleProject(response, request, service, false, requestId),
    },
    [API_PATHS.PROJECT_PREVIEW]: {
      [API_METHODS.POST]: () => handleProject(response, request, service, true, requestId),
    },
    [API_PATHS.EXPORT]: {
      [API_METHODS.GET]: () => handleExport(response, request, requestUrl, service, requestId),
      [API_METHODS.POST]: () => handleExport(response, request, requestUrl, service, requestId),
    },
    [API_PATHS.MEDIA_INSERT]: {
      [API_METHODS.POST]: () => handleMediaInsertion(response, request, service, requestId),
    },
    [API_PATHS.FIELDS]: {
      [API_METHODS.POST]: () => handleDocumentFields(response, request, service, requestId),
    },
    [API_PATHS.ASSETS]: {
      [API_METHODS.GET]: () => handleApiAssets(response, request, requestUrl, service, requestId),
      [API_METHODS.POST]: () => handleApiAssets(response, request, requestUrl, service, requestId),
    },
    [API_PATHS.INDEX]: {
      [API_METHODS.GET]: () => handleApiIndex(response, service, requestId),
    },
    [API_PATHS.CAPABILITIES]: {
      [API_METHODS.GET]: () => handleApiCapabilities(response, service, requestId),
    },
    [API_PATHS.HEALTH]: {
      [API_METHODS.GET]: () => handleApiHealth(response, service, requestId),
    },
    [API_PATHS.METRICS]: {
      [API_METHODS.GET]: () => handleApiMetrics(response, service, requestId),
    },
    [API_PATHS.DOC]: {
      [API_METHODS.GET]: () => handleApiDocGet(response, requestUrl, service, requestId),
      [API_METHODS.POST]: () => handleApiDocWrite(response, request, service, requestId),
      [API_METHODS.PUT]: () => handleApiDocWrite(response, request, service, requestId),
    },
    [API_PATHS.REBUILD]: {
      [API_METHODS.POST]: () => handleApiRebuild(response, request, service, requestId),
    },
  };

  const handlers = route[pathname];
  if (!handlers) {
    return false;
  }
  if (pathname === PROJECT_BUILD_API_PATH && (!service.projectBuild || !isLocalBuildRequest(request))) {
    sendApiError(response, 403, 'Project builds require a local editor session.', { errorCode: 'build_local_only' });
    return true;
  }
  if (pathname === SCENE_PREVIEW_API_PATH && (!service.scenePreview || !isLocalBuildRequest(request))) {
    sendApiError(response, 403, 'Scene previews require a local editor session.', { errorCode: 'scene_preview_local_only' });
    return true;
  }
  if (applyRateLimit(response, request, pathname)) {
    return true;
  }
  trace = (service && typeof service.startRequest === 'function')
    ? service.startRequest(pathname, method)
    : null;
  requestId = trace?.requestId || '';

  let statusCode = 200;
  try {
    const methodHandler = handlers[method];
    if (!methodHandler) {
      const allow = Object.keys(handlers).join(', ');
      statusCode = methodNotAllowed(response, allow, requestId);
      logSecurityEvent('method_not_allowed', request, {
        method,
        path: pathname,
        status: statusCode,
        reason: 'method_not_allowed',
        errorCode: API_RESPONSE_DEFAULTS.methodErrorPrefix,
      });
      return true;
    }

    const validWriteType = pathname === API_PATHS.ASSETS
      ? getContentType(request) === 'application/octet-stream'
      : pathname === RESOURCE_PACKAGE_API ? isJsonRequest(request) || getContentType(request) === 'application/octet-stream' : isJsonRequest(request);
    if (isMutatingWriteRequest(pathname, method) && !validWriteType) {
      statusCode = 415;
      logSecurityEvent('unsupported_media_type', request, {
        method,
        path: pathname,
        status: 415,
        reason: 'content_type_not_json',
        errorCode: API_RESPONSE_DEFAULTS.unsupportedMediaTypeErrorPrefix,
      });
      sendApiError(response, 415, 'unsupported media type', {
        [API_RESPONSE.errorCode]: API_RESPONSE_DEFAULTS.unsupportedMediaTypeErrorPrefix,
      }, requestId);
      return true;
    }

    const needsAuth = isMutatingWriteRequest(pathname, method);
    const tokenFromRequest = needsAuth ? extractAuthToken(request) : '';
    if (needsAuth && !isTokenAllowed(tokenFromRequest)) {
      if (!tokenFromRequest) {
        response.setHeader('WWW-Authenticate', 'Bearer');
        statusCode = 401;
        logSecurityEvent('auth_required', request, {
          method,
          path: pathname,
          status: statusCode,
          reason: 'missing_token',
          errorCode: API_RESPONSE_DEFAULTS.authRequiredErrorPrefix,
        });
        sendApiError(response, statusCode, 'authentication required', {
          [API_RESPONSE.errorCode]: API_RESPONSE_DEFAULTS.authRequiredErrorPrefix,
        }, requestId);
      } else {
        statusCode = 403;
        logSecurityEvent('forbidden', request, {
          method,
          path: pathname,
          status: statusCode,
          reason: tokenFromRequest ? 'invalid_token' : 'missing_token',
          errorCode: API_RESPONSE_DEFAULTS.forbiddenErrorPrefix,
        });
        sendApiError(response, statusCode, 'forbidden', {
          [API_RESPONSE.errorCode]: API_RESPONSE_DEFAULTS.forbiddenErrorPrefix,
        }, requestId);
      }
      return true;
    }

    statusCode = await methodHandler();
  } catch (error) {
    if (!response.writableEnded) {
      statusCode = 500;
      sendApiError(response, 500, 'internal error', {
        [API_RESPONSE.errorCode]: API_RESPONSE_DEFAULTS.internalErrorPrefix,
      }, requestId);
    } else {
      statusCode = isHttpStatus(response.statusCode, 500);
    }
  } finally {
    if (service && typeof service.finishRequest === 'function') {
      service.finishRequest(trace, isHttpStatus(statusCode, response.statusCode));
    }
  }

  return true;
}

export {
  handleApiRequest,
  methodNotAllowed,
};
