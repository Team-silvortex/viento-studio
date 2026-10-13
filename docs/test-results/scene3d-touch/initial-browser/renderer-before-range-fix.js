import { multiply4, lookAt4, cameraProjection4, objectMatrix4, rotationXYZ4, normalize3, color3, orbitCamera, frameCamera, sceneBounds, frameSceneCamera, standardViewCamera, panCamera, touchCamera } from './scene3d-math.js';
import { pickScene3DObject } from './scene3d-picking.js';

const vertex = `#version 300 es
layout(location=0) in vec3 position;
layout(location=1) in vec3 normal;
uniform mat4 model;
uniform mat4 rotation;
uniform mat4 viewProjection;
out vec3 worldNormal;
out vec3 localPosition;
flat out vec3 localNormal;
void main(){ worldNormal=mat3(rotation)*normal; localPosition=position; localNormal=normal;
  gl_Position=viewProjection*model*vec4(position,1.0); }`;
const fragment = `#version 300 es
precision highp float;
in vec3 worldNormal;
in vec3 localPosition;
flat in vec3 localNormal;
uniform vec3 color;
uniform vec3 lightDirection;
uniform vec3 lightColor;
uniform float lightEnergy;
uniform bool selected;
out vec4 pixel;
void main(){ float diffuse=max(dot(normalize(worldNormal),-lightDirection),0.0);
  vec3 shaded=color*(vec3(0.20)+lightColor*diffuse*lightEnergy);
  if(selected){
    // Face coordinates mark the box's physical edges, never triangle diagonals.
    vec2 facePosition=abs(localNormal.x)>0.5?localPosition.yz:
      (abs(localNormal.y)>0.5?localPosition.xz:localPosition.xy);
    vec2 pixelWidth=max(fwidth(facePosition),vec2(0.000001));
    vec2 interior=smoothstep(pixelWidth*0.6,pixelWidth*1.6,vec2(0.5)-abs(facePosition));
    float edge=1.0-min(interior.x,interior.y);
    vec2 innerInterior=smoothstep(pixelWidth*1.6,pixelWidth*2.6,vec2(0.5)-abs(facePosition));
    float innerEdge=1.0-min(innerInterior.x,innerInterior.y);
    shaded=mix(shaded,vec3(0.07,0.09,0.13),innerEdge);
    shaded=mix(shaded,vec3(1.0,0.96,0.75),edge);
  }
  pixel=vec4(shaded,1.0); }`;
// One flat-normal unit box, 36 vertices. Positive size is applied in the model
// matrix; rotation alone transforms its axial normals under nonuniform scale.
function boxVertices() {
  const data = [], faces = [
    [[1, 0, 0], [[.5, -.5, -.5], [.5, .5, -.5], [.5, .5, .5], [.5, -.5, .5]]],
    [[-1, 0, 0], [[-.5, -.5, .5], [-.5, .5, .5], [-.5, .5, -.5], [-.5, -.5, -.5]]],
    [[0, 1, 0], [[-.5, .5, -.5], [-.5, .5, .5], [.5, .5, .5], [.5, .5, -.5]]],
    [[0, -1, 0], [[-.5, -.5, .5], [-.5, -.5, -.5], [.5, -.5, -.5], [.5, -.5, .5]]],
    [[0, 0, 1], [[-.5, -.5, .5], [.5, -.5, .5], [.5, .5, .5], [-.5, .5, .5]]],
    [[0, 0, -1], [[.5, -.5, -.5], [-.5, -.5, -.5], [-.5, .5, -.5], [.5, .5, -.5]]],
  ];
  for (const [normal, corners] of faces) for (const index of [0, 1, 2, 0, 2, 3]) data.push(...corners[index], ...normal);
  return new Float32Array(data);
}

const cloneCamera = camera => ({ ...camera, position: [...camera.position], target: [...camera.target],
  ...(camera.up === undefined ? {} : { up: [...camera.up] }) });

/** A view-only GPU adapter. No author source, HTTP, filesystem or save ports. */
export function createScene3DRenderer(canvas, { onError = () => {}, onPick, onViewChange, pixelRatio = () => globalThis.devicePixelRatio || 1,
  observe = callback => typeof ResizeObserver === 'function' ? new ResizeObserver(callback) : null } = {}) {
  const gl = canvas.getContext('webgl2', { alpha: false, antialias: true, preserveDrawingBuffer: true });
  if (!gl) return null;
  let program, buffer, array, observer, disposed = false, model = null, camera = null, drag = null, focus = null, draws = 0, frame = null, tap = null, selectedInstanceId = null, dragMode = 'orbit', projectionMode = 'perspective', lastViewReceipt;
  function publishView(available) {
    if (typeof onViewChange !== 'function') return;
    if (!available || disposed || !frame || !camera) {
      if (lastViewReceipt === null) return;
      lastViewReceipt = null;
      try { onViewChange(null); } catch { /* View consumers cannot interfere with GPU or gesture state. */ }
      return;
    }
    const previous = lastViewReceipt?.camera;
    const sameVector = (first, second) => first === undefined ? second === undefined
      : second !== undefined && first.length === second.length && first.every((value, axis) => value === second[axis]);
    if (previous && lastViewReceipt.projectionMode === projectionMode
      && ['fovDegrees', 'near', 'far'].every(field => previous[field] === camera[field])
      && ['position', 'target', 'up'].every(field => sameVector(previous[field], camera[field]))) return;
    // A narrow immutable view receipt carries no model, source or host state.
    const view = Object.freeze({ position: Object.freeze([...camera.position]), target: Object.freeze([...camera.target]),
      fovDegrees: camera.fovDegrees, near: camera.near, far: camera.far,
      ...(camera.up === undefined ? {} : { up: Object.freeze([...camera.up]) }) });
    lastViewReceipt = Object.freeze({ camera: view, projectionMode });
    try { onViewChange(lastViewReceipt); } catch { /* Successful drawing remains successful if a consumer fails. */ }
  }
  function contextLost() {
    if (!gl.isContextLost()) return false;
    frame = null; publishView(false); return true;
  }
  const expectedCaptureLoss = new Set();
  const shaders = [], listeners = [];
  const listen = (event, callback, options, target = canvas) => {
    if (!target?.addEventListener) return;
    target.addEventListener(event, callback, options); listeners.push([target, event, callback, options]);
  };
  function release() {
    if (disposed) return; cancelGesture(); disposed = true; model = camera = drag = focus = frame = selectedInstanceId = null;
    expectedCaptureLoss.clear(); publishView(false);
    observer?.disconnect(); for (const [target, ...args] of listeners) target.removeEventListener(...args);
    if (buffer) gl.deleteBuffer(buffer); if (array) gl.deleteVertexArray(array); if (program) gl.deleteProgram(program);
    shaders.forEach(shader => gl.deleteShader(shader));
    gl.getExtension('WEBGL_lose_context')?.loseContext();
  }
  function shader(type, source) {
    const result = gl.createShader(type); if (!result) throw new Error('WebGL2 shader allocation failed.');
    shaders.push(result); gl.shaderSource(result, source); gl.compileShader(result);
    if (!gl.getShaderParameter(result, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(result) || 'WebGL2 shader compilation failed.');
    return result;
  }
  function dimensions() {
    const bounds = canvas.getBoundingClientRect(), dpr = Math.max(1, Math.min(2, Number(pixelRatio()) || 1));
    const limit = Math.min(1, 2048 / Math.max(bounds.width * dpr, bounds.height * dpr, 1));
    const width = Math.max(1, Math.round(bounds.width * dpr * limit)), height = Math.max(1, Math.round(bounds.height * dpr * limit));
    return { width, height, rect: { left: bounds.left ?? 0, top: bounds.top ?? 0, width: bounds.width, height: bounds.height } };
  }
  function stopDrag() {
    const previous = drag;
    drag = null;
    // Clear the session before releasing either capture: browsers may deliver
    // lostpointercapture synchronously, including while releasing the first.
    const ids = previous?.mode === 'touch' ? previous.ids : previous ? [previous.id] : [];
    for (const id of ids) {
      try {
        if (canvas.hasPointerCapture?.(id)) { expectedCaptureLoss.add(id); canvas.releasePointerCapture?.(id); }
      } catch { expectedCaptureLoss.delete(id); /* An ended pointer may no longer own capture. */ }
    }
  }
  function cancelGesture() { stopDrag(); tap = null; }
  function capturePointer(id) {
    expectedCaptureLoss.delete(id);
    try { canvas.setPointerCapture?.(id); return true; }
    catch { cancelGesture(); return false; }
  }
  const sameRect = (a, b) => ['left', 'top', 'width', 'height'].every(key => a[key] === b[key]);
  function sameGestureViewport(gesture, current) {
    return sameRect(gesture.rect, current.rect) && gesture.width === current.width && gesture.height === current.height
      && canvas.width === gesture.width && canvas.height === gesture.height;
  }
  function hitTest(clientX, clientY) {
    if (disposed || !model || !frame || contextLost()) return null;
    const current = dimensions();
    if (current.width !== frame.width || current.height !== frame.height || canvas.width !== frame.width || canvas.height !== frame.height
      || current.rect.width !== frame.rect.width || current.rect.height !== frame.rect.height) return null;
    // Scrolling moves the CSS rectangle without changing the drawn matrices.
    // Use its current position, while stale size or buffer changes need a draw.
    return pickScene3DObject({ ...frame, rect: current.rect }, clientX, clientY);
  }
  const eventTime = event => Number.isFinite(event.timeStamp) ? event.timeStamp : Date.now();
  function notify(instanceId, focusView) {
    if (typeof onPick !== 'function') return;
    // UI approval remains outside the renderer. A failing view consumer cannot
    // leave a live gesture or turn a selection callback into a GPU failure.
    try { onPick(instanceId, Object.freeze({ focus: focusView })); } catch { /* Consumer owns its own diagnostics. */ }
  }
  function moveView(yaw, pitch, scale = 1) {
    const next = orbitCamera(camera, yaw, pitch, scale, focus?.distanceLimit, focus?.distanceMinimum);
    if (!next) return false;
    camera = cloneCamera(next);
    if (focus) {
      const distance = Math.hypot(...camera.position.map((value, index) => value - camera.target[index]));
      camera.near = Math.max(1e-7, (distance - focus.radius) / 2);
      camera.far = Math.max(camera.near * 2, distance + focus.radius * 2);
    }
    return true;
  }
  const sameMatrix = (a, b) => a.length === b.length && a.every((value, index) => Object.is(value, b[index]));
  function draw(selectionOnly = false) {
    let completed;
    try { completed = drawFrame(selectionOnly); }
    catch (error) { frame = null; publishView(false); throw error; }
    publishView(completed); return completed;
  }
  function drawFrame(selectionOnly) {
    if (disposed || !model || contextLost()) return false;
    const { width, height, rect } = dimensions();
    const viewProjection = cameraViewProjection(camera, width / height);
    if (!viewProjection) { frame = null; return false; }
    const sameBuffer = canvas.width === width && canvas.height === height;
    if (canvas.width !== width) canvas.width = width; if (canvas.height !== height) canvas.height = height;
    gl.viewport(0, 0, width, height); gl.enable(gl.DEPTH_TEST); gl.depthFunc(gl.LEQUAL); gl.disable(gl.CULL_FACE);
    gl.clearColor(...color3(model.background), 1); gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.useProgram(program); gl.bindVertexArray(array);
    // A view-local origin keeps millimetre boxes at large author coordinates
    // visible in float32 GPU matrices. Snapshot/model keep author coordinates.
    const origin = camera.target;
    gl.uniformMatrix4fv(uniforms.viewProjection, false, viewProjection);
    gl.uniform3fv(uniforms.lightDirection, normalize3(model.light.direction)); gl.uniform3fv(uniforms.lightColor, color3(model.light.color)); gl.uniform1f(uniforms.lightEnergy, model.light.energy);
    const objects = [];
    for (const object of model.objects) {
      const objectMatrix = new Float32Array(objectMatrix4({ ...object, position: object.position.map((value, index) => value - origin[index]) }));
      gl.uniformMatrix4fv(uniforms.model, false, objectMatrix);
      gl.uniformMatrix4fv(uniforms.rotation, false, new Float32Array(rotationXYZ4(object.rotationDegrees)));
      gl.uniform1i(uniforms.selected, object.instanceId === selectedInstanceId ? 1 : 0);
      gl.uniform3fv(uniforms.color, color3(object.color)); gl.drawArrays(gl.TRIANGLES, 0, 36);
      objects.push({ instanceId: object.instanceId, model: objectMatrix });
    }
    gl.bindVertexArray(null);
    if (contextLost()) { frame = null; return false; }
    // A selection-only repaint may preserve a qualified tap on the same drawn
    // geometry. Public render, model, camera or size changes retain the normal
    // new-frame identity and cannot borrow this exception.
    const sameGeometry = selectionOnly && sameBuffer && frame && frame.width === width && frame.height === height
      && frame.rect.width === rect.width && frame.rect.height === rect.height && sameMatrix(frame.viewProjection, viewProjection)
      && frame.objects.length === objects.length && objects.every((object, index) => object.instanceId === frame.objects[index].instanceId
        && sameMatrix(object.model, frame.objects[index].model));
    if (!sameGeometry) frame = { width, height, rect, viewProjection, objects };
    draws++; return true;
  }
  function render() { return draw(); }
  function cameraViewProjection(view, aspect, mode = projectionMode) {
    const projection = cameraProjection4(view, aspect, mode); if (!projection) return null;
    const eye = view.position.map((value, axis) => value - view.target[axis]);
    const uploaded = new Float32Array(multiply4(projection, lookAt4(eye, [0, 0, 0], view.up)));
    return uploaded.every(Number.isFinite) ? uploaded : null;
  }
  function finiteViewUploads(view, aspect, mode = projectionMode) {
    return Boolean(cameraViewProjection(view, aspect, mode)) && model.objects.every(object => new Float32Array(objectMatrix4({ ...object,
      position: object.position.map((value, axis) => value - view.target[axis]) })).every(Number.isFinite));
  }
  function setProjectionMode(mode) {
    if (disposed || !model) return false;
    cancelGesture();
    if (!['perspective', 'orthographic'].includes(mode) || contextLost()) return false;
    if (mode === projectionMode) return true;
    const previousMode = projectionMode, previousFrame = frame;
    let attemptedDraw = false, failure = null;
    try {
      const { width, height } = dimensions();
      if (!finiteViewUploads(camera, width / height, mode)) return false;
      projectionMode = mode; frame = null;
      attemptedDraw = true; if (render()) return true;
      failure = new Error('WebGL2 projection change draw did not complete.');
    } catch (error) { failure = error; }
    projectionMode = previousMode; frame = attemptedDraw ? null : previousFrame;
    if (attemptedDraw) {
      try { onError(failure); } catch { /* The consumer cannot prevent mode rollback. */ }
    }
    return false;
  }
  function panView(dx, dy, dimensions) {
    const previousCamera = camera, previousFrame = frame;
    let attemptedDraw = false, failure = null;
    try {
      const { width, height, rect } = dimensions;
      const next = panCamera(camera, dx, dy, { width: rect.width, height: rect.height, aspect: width / height });
      if (!next || !finiteViewUploads(next, width / height)) { cancelGesture(); return false; }
      camera = cloneCamera(next); frame = null;
      attemptedDraw = true; if (render()) return true;
      failure = new Error('WebGL2 camera pan draw did not complete.');
    } catch (error) { failure = error; }
    camera = previousCamera; frame = attemptedDraw ? null : previousFrame; cancelGesture();
    if (attemptedDraw) {
      try { onError(failure); } catch { /* The consumer cannot prevent camera rollback. */ }
    }
    return false;
  }
  // Both fingers describe one view transition. Never commit a zoom separately
  // from its anchored translation, or publish a partially drawn camera.
  function touchView(gesture, points, dimensions) {
    const previousCamera = camera, previousFrame = frame;
    let attemptedDraw = false, failure = null;
    try {
      const { width, height, rect } = dimensions;
      const local = values => values.map(([x, y]) => [x - rect.left, y - rect.top]);
      const next = touchCamera(camera, local(gesture.referencePoints), local(points),
        { width: rect.width, height: rect.height, aspect: width / height }, focus?.distanceLimit, focus?.distanceMinimum);
      if (!next) { cancelGesture(); return false; }
      const proposed = cloneCamera(next);
      if (focus) {
        const distance = Math.hypot(...proposed.position.map((value, axis) => value - proposed.target[axis]));
        proposed.near = Math.max(1e-7, (distance - focus.radius) / 2);
        proposed.far = Math.max(proposed.near * 2, distance + focus.radius * 2);
      }
      if (!finiteViewUploads(proposed, width / height)) { cancelGesture(); return false; }
      camera = proposed; frame = null;
      attemptedDraw = true; if (render()) return true;
      failure = new Error('WebGL2 touch navigation draw did not complete.');
    } catch (error) { failure = error; }
    if (disposed) return false;
    camera = previousCamera; frame = attemptedDraw ? null : previousFrame; cancelGesture();
    if (attemptedDraw) {
      try { onError(failure); } catch { /* The consumer cannot prevent camera rollback. */ }
    }
    return false;
  }
  // Camera presets and whole-scene focus share one atomic view transition.
  function frameSceneView(direction) {
    if (disposed || !model) return false;
    const previousCamera = camera, previousFocus = focus, previousFrame = frame;
    let attemptedDraw = false, failure = null;
    try {
      cancelGesture(); if (contextLost()) return false;
      const { width, height } = dimensions(), bounds = sceneBounds(model.objects);
      const view = direction === undefined ? camera : standardViewCamera(camera, direction);
      const next = view && frameSceneCamera(view, model.objects, width / height, projectionMode);
      if (!bounds || !next) return false;
      const distance = Math.hypot(...next.position.map((value, axis) => value - next.target[axis]));
      const distanceLimit = distance * 4, distanceMinimum = distance / 4;
      if (![distance, distanceLimit, distanceMinimum].every(Number.isFinite) || distanceMinimum <= 0) return false;
      if (!finiteViewUploads(next, width / height)) return false;
      camera = cloneCamera(next);
      focus = { radius: bounds.radius, distanceLimit, distanceMinimum }; frame = null;
      attemptedDraw = true; if (render()) return true;
      failure = new Error('WebGL2 scene framing draw did not complete.');
    } catch (error) { failure = error; }
    camera = previousCamera; focus = previousFocus;
    // A partially failed GPU draw cannot retain a qualified picking frame.
    frame = attemptedDraw ? null : previousFrame;
    if (attemptedDraw) {
      try { onError(failure); } catch { /* The consumer cannot prevent camera rollback. */ }
    }
    return false;
  }
  let uniforms;
  try {
    program = gl.createProgram(); if (!program) throw new Error('WebGL2 program allocation failed.');
    gl.attachShader(program, shader(gl.VERTEX_SHADER, vertex)); gl.attachShader(program, shader(gl.FRAGMENT_SHADER, fragment)); gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program) || 'WebGL2 program linking failed.');
    uniforms = Object.fromEntries(['model', 'rotation', 'viewProjection', 'color', 'lightDirection', 'lightColor', 'lightEnergy', 'selected'].map(name => [name, gl.getUniformLocation(program, name)]));
    array = gl.createVertexArray(); buffer = gl.createBuffer(); if (!array || !buffer) throw new Error('WebGL2 geometry allocation failed.');
    gl.bindVertexArray(array); gl.bindBuffer(gl.ARRAY_BUFFER, buffer); gl.bufferData(gl.ARRAY_BUFFER, boxVertices(), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 24, 0); gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1, 3, gl.FLOAT, false, 24, 12);
    gl.bindVertexArray(null);
    observer = observe(() => { cancelGesture(); frame = null; render(); }); observer?.observe(canvas);
    // Capture scroll from any ancestor without coupling to a particular UI shell.
    if (canvas.ownerDocument) listen('scroll', cancelGesture, true, canvas.ownerDocument);
    listen('pointerdown', event => {
      if (disposed) return;
      // Only a second explicit touch may promote the current primary touch.
      // Other pointers/buttons end the session instead of masquerading as a tap.
      if (drag) {
        const previous = drag;
        if (previous.mode === 'touch' || previous.pointerType !== 'touch' || event.pointerType !== 'touch'
          || previous.button !== 0 || event.button !== 0 || event.pointerId === previous.id
          || event.buttons !== undefined && event.buttons !== 1
          || ![event.clientX, event.clientY].every(Number.isFinite) || !model || !frame || contextLost()) { cancelGesture(); return; }
        const current = dimensions();
        if (!sameGestureViewport(previous, current)) { cancelGesture(); return; }
        const points = [[previous.touchX, previous.touchY], [event.clientX, event.clientY]];
        const span = Math.hypot(points[1][0] - points[0][0], points[1][1] - points[0][1]);
        if (!Number.isFinite(span) || span < 4) { cancelGesture(); return; }
        tap = null; event.preventDefault?.();
        drag = { mode: 'touch', ids: [previous.id, event.pointerId], points,
          referencePoints: points, moved: false, frame, rect: current.rect, width: current.width, height: current.height };
        capturePointer(event.pointerId); return;
      }
      // After a pair ends, its remaining fingers cannot resume or turn into a
      // click. A fresh primary down starts the next session, without a blacklist.
      if (![0, 1].includes(event.button) || event.isPrimary === false
        || event.pointerType === 'touch' && (event.button !== 0 || event.isPrimary !== true)) { cancelGesture(); return; }
      if (!model || contextLost()
        || ![event.clientX, event.clientY].every(Number.isFinite) || !frame) return;
      const mode = event.button === 1 || event.shiftKey ? 'pan' : dragMode;
      if (mode === 'pan') { tap = null; event.preventDefault?.(); }
      const current = dimensions();
      drag = { id: event.pointerId, button: event.button, pointerType: event.pointerType, mode,
        x: event.clientX, y: event.clientY, touchX: event.clientX, touchY: event.clientY, startX: event.clientX, startY: event.clientY,
        moved: false, frame, rect: current.rect, width: current.width, height: current.height };
      capturePointer(event.pointerId);
    });
    listen('pointermove', event => {
      if (!drag || disposed) return;
      if (drag.mode === 'touch') {
        const gesture = drag, index = gesture.ids.indexOf(event.pointerId); if (index < 0) return;
        if (contextLost() || !frame || event.pointerType !== 'touch' || ![event.clientX, event.clientY].every(Number.isFinite)
          || event.buttons !== undefined && event.buttons !== 1) { cancelGesture(); return; }
        const current = dimensions();
        if (gesture.frame !== frame || !sameGestureViewport(gesture, current)) { cancelGesture(); return; }
        event.preventDefault?.();
        if (gesture.points[index][0] === event.clientX && gesture.points[index][1] === event.clientY) return;
        const points = gesture.points.map(point => [...point]); points[index] = [event.clientX, event.clientY];
        const span = Math.hypot(points[1][0] - points[0][0], points[1][1] - points[0][1]);
        if (!Number.isFinite(span) || span < 4) { cancelGesture(); return; }
        gesture.points = points;
        if (points.some((point, i) => Math.hypot(point[0] - gesture.referencePoints[i][0], point[1] - gesture.referencePoints[i][1]) > 4)) gesture.moved = true;
        if (!gesture.moved) return;
        tap = null;
        if (touchView(gesture, points, current) && drag === gesture) {
          // Rebase after every successful frame, including a clamped zoom, so
          // reversing the fingers responds immediately without accumulated debt.
          gesture.referencePoints = points; gesture.frame = frame;
        }
        return;
      }
      if (event.pointerId !== drag.id) return;
      if (contextLost() || event.isPrimary === false || drag.pointerType === 'touch' && event.pointerType !== 'touch'
        || ![event.clientX, event.clientY].every(Number.isFinite)
        || event.buttons !== undefined && event.buttons !== (drag.button === 1 ? 4 : 1)) { cancelGesture(); return; }
      const current = dimensions();
      if (!sameGestureViewport(drag, current)) { cancelGesture(); return; }
      drag.touchX = event.clientX; drag.touchY = event.clientY;
      if (Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY) > 4) drag.moved = true;
      if (!drag.moved) return;
      tap = null;
      if (drag.mode === 'pan') panView(event.clientX - drag.x, event.clientY - drag.y, current);
      else if (moveView(-(event.clientX - drag.x) * .008, (event.clientY - drag.y) * .008)) render();
      if (drag) { drag.x = event.clientX; drag.y = event.clientY; }
    });
    listen('pointerup', event => {
      if (drag?.mode === 'touch') { if (drag.ids.includes(event.pointerId)) cancelGesture(); return; }
      if (!drag || event.pointerId !== drag.id) return;
      const previous = drag; stopDrag(); tap = null;
      if (disposed || contextLost() || previous.mode !== 'orbit' || previous.button !== 0 || previous.moved || previous.frame !== frame || event.button !== previous.button || event.isPrimary === false
        || previous.pointerType === 'touch' && event.pointerType !== 'touch'
        || !sameRect(previous.rect, dimensions().rect)
        || ![event.clientX, event.clientY].every(Number.isFinite)
        || Math.hypot(event.clientX - previous.startX, event.clientY - previous.startY) > 4) return;
      const instanceId = hitTest(event.clientX, event.clientY); if (!instanceId) return;
      tap = { instanceId, x: event.clientX, y: event.clientY, time: eventTime(event), frame, rect: dimensions().rect };
      notify(instanceId, false);
    });
    listen('pointercancel', event => {
      if (!drag || (drag.mode === 'touch' ? drag.ids.includes(event.pointerId) : drag.id === event.pointerId)) cancelGesture();
    });
    listen('lostpointercapture', event => {
      if (expectedCaptureLoss.delete(event.pointerId)) return;
      if (drag && (drag.mode === 'touch' ? drag.ids.includes(event.pointerId) : drag.id === event.pointerId)) cancelGesture(); else tap = null;
    });
    listen('dblclick', event => {
      const previous = tap; tap = null;
      if (!previous || drag || disposed || contextLost() || event.button !== 0 || event.isPrimary === false
        || previous.frame !== frame || ![event.clientX, event.clientY].every(Number.isFinite)
        || !sameRect(previous.rect, dimensions().rect)
        || eventTime(event) - previous.time < 0 || eventTime(event) - previous.time > 1000
        || Math.hypot(event.clientX - previous.x, event.clientY - previous.y) > 4) return;
      if (hitTest(event.clientX, event.clientY) === previous.instanceId) notify(previous.instanceId, true);
    });
    listen('wheel', event => {
      if (!model || disposed || contextLost()) return;
      cancelGesture(); event.preventDefault(); if (moveView(0, 0, Math.exp(Math.max(-1000, Math.min(1000, event.deltaY)) * .001))) render();
    }, { passive: false });
    listen('webglcontextlost', event => { event.preventDefault(); cancelGesture(); frame = null; publishView(false); if (!disposed) onError(new Error('WebGL2 context lost.')); });
  } catch (error) { release(); throw error; }
  return Object.freeze({
    supportsTouchNavigation: true,
    setModel(next) { if (disposed) return false; cancelGesture(); frame = null; focus = selectedInstanceId = null; model = next; camera = cloneCamera(next.camera); return render(); },
    render,
    hitTest,
    setProjectionMode,
    setDragMode(mode) {
      if (disposed || !['orbit', 'pan'].includes(mode)) return false;
      cancelGesture(); dragMode = mode; return true;
    },
    setSelectedObject(instanceId) {
      if (disposed || !model || contextLost() || !(instanceId === null || typeof instanceId === 'string'
        && model.objects.some(object => object.instanceId === instanceId))) return false;
      if (instanceId === selectedInstanceId) return true;
      const previous = selectedInstanceId; selectedInstanceId = instanceId;
      if (draw(true)) return true;
      selectedInstanceId = previous; return false;
    },
    focusObject(instanceId) {
      if (disposed || !model || contextLost() || typeof instanceId !== 'string') return false;
      const object = model.objects.find(value => value.instanceId === instanceId);
      if (!object) return false;
      const { width, height } = dimensions(), next = frameCamera(camera, object, width / height, projectionMode);
      if (!next) return false;
      cancelGesture(); frame = null; camera = cloneCamera(next);
      const distance = Math.hypot(...camera.position.map((value, index) => value - camera.target[index]));
      focus = { radius: Math.hypot(...object.size) / 2,
        distanceLimit: Math.max(200000, distance) * 4, distanceMinimum: Math.min(.01, distance / 4) };
      return render();
    },
    focusAll() { return frameSceneView(); },
    setViewDirection(direction) {
      // Invalid requests still revoke a gesture qualified for the old view.
      if (typeof direction !== 'string') { cancelGesture(); return false; }
      return frameSceneView(direction);
    },
    resetView() { if (disposed || !model) return false; cancelGesture(); frame = null; focus = null; camera = cloneCamera(model.camera); return render(); },
    snapshot: () => ({ disposed, draws, dragMode, projectionMode, objectCount: model?.objects.length || 0, width: canvas.width, height: canvas.height, selectedInstanceId, camera: camera ? cloneCamera(camera) : null }),
    dispose: release,
  });
}
