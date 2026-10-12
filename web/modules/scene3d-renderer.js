import { multiply4, lookAt4, perspective4, objectMatrix4, rotationXYZ4, normalize3, color3, orbitCamera, frameCamera, sceneBounds, frameSceneCamera } from './scene3d-math.js';
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

/** A view-only GPU adapter. No author source, HTTP, filesystem or save ports. */
export function createScene3DRenderer(canvas, { onError = () => {}, onPick, pixelRatio = () => globalThis.devicePixelRatio || 1,
  observe = callback => typeof ResizeObserver === 'function' ? new ResizeObserver(callback) : null } = {}) {
  const gl = canvas.getContext('webgl2', { alpha: false, antialias: true, preserveDrawingBuffer: true });
  if (!gl) return null;
  let program, buffer, array, observer, disposed = false, model = null, camera = null, drag = null, focus = null, draws = 0, frame = null, tap = null, selectedInstanceId = null;
  const expectedCaptureLoss = new Set();
  const shaders = [], listeners = [];
  const listen = (event, callback, options) => { canvas.addEventListener(event, callback, options); listeners.push([event, callback, options]); };
  function release() {
    if (disposed) return; cancelGesture(); disposed = true; model = camera = drag = focus = frame = selectedInstanceId = null;
    expectedCaptureLoss.clear();
    observer?.disconnect(); for (const args of listeners) canvas.removeEventListener(...args);
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
    if (previous && canvas.hasPointerCapture?.(previous.id)) {
      expectedCaptureLoss.add(previous.id); canvas.releasePointerCapture?.(previous.id);
    }
  }
  function cancelGesture() { stopDrag(); tap = null; }
  const sameRect = (a, b) => ['left', 'top', 'width', 'height'].every(key => a[key] === b[key]);
  function hitTest(clientX, clientY) {
    if (disposed || !model || !frame || gl.isContextLost()) return null;
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
    camera = orbitCamera(camera, yaw, pitch, scale, focus?.distanceLimit, focus?.distanceMinimum);
    if (focus) {
      const distance = Math.hypot(...camera.position.map((value, index) => value - camera.target[index]));
      camera.near = Math.max(1e-7, (distance - focus.radius) / 2);
      camera.far = Math.max(camera.near * 2, distance + focus.radius * 2);
    }
  }
  const sameMatrix = (a, b) => a.length === b.length && a.every((value, index) => Object.is(value, b[index]));
  function draw(selectionOnly = false) {
    if (disposed || !model || gl.isContextLost()) return false;
    const { width, height, rect } = dimensions();
    const sameBuffer = canvas.width === width && canvas.height === height;
    if (canvas.width !== width) canvas.width = width; if (canvas.height !== height) canvas.height = height;
    gl.viewport(0, 0, width, height); gl.enable(gl.DEPTH_TEST); gl.depthFunc(gl.LEQUAL); gl.disable(gl.CULL_FACE);
    gl.clearColor(...color3(model.background), 1); gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.useProgram(program); gl.bindVertexArray(array);
    // A view-local origin keeps millimetre boxes at large author coordinates
    // visible in float32 GPU matrices. Snapshot/model keep author coordinates.
    const origin = camera.target;
    const eye = camera.position.map((value, index) => value - origin[index]);
    const viewProjection = new Float32Array(multiply4(perspective4(camera.fovDegrees, width / height, camera.near, camera.far), lookAt4(eye, [0, 0, 0])));
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
    listen('pointerdown', event => {
      if (disposed) return;
      // A second pointer or another button ends tap/double-click eligibility;
      // ignoring it would let the first finger later masquerade as a click.
      if (event.button !== 0 || event.isPrimary === false || drag) { cancelGesture(); return; }
      if (!model || gl.isContextLost()
        || ![event.clientX, event.clientY].every(Number.isFinite) || !frame) return;
      expectedCaptureLoss.delete(event.pointerId);
      drag = { id: event.pointerId, x: event.clientX, y: event.clientY, startX: event.clientX, startY: event.clientY, moved: false, frame, rect: dimensions().rect };
      canvas.setPointerCapture?.(event.pointerId);
    });
    listen('pointermove', event => {
      if (!drag || event.pointerId !== drag.id || disposed || gl.isContextLost() || ![event.clientX, event.clientY].every(Number.isFinite)) return;
      if (!sameRect(drag.rect, dimensions().rect)) { cancelGesture(); return; }
      if (Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY) > 4) drag.moved = true;
      if (!drag.moved) return;
      tap = null; moveView(-(event.clientX - drag.x) * .008, (event.clientY - drag.y) * .008);
      drag.x = event.clientX; drag.y = event.clientY; render();
    });
    listen('pointerup', event => {
      if (!drag || event.pointerId !== drag.id) return;
      const previous = drag; stopDrag(); tap = null;
      if (disposed || gl.isContextLost() || previous.moved || previous.frame !== frame || event.button !== 0 || event.isPrimary === false
        || !sameRect(previous.rect, dimensions().rect)
        || ![event.clientX, event.clientY].every(Number.isFinite)
        || Math.hypot(event.clientX - previous.startX, event.clientY - previous.startY) > 4) return;
      const instanceId = hitTest(event.clientX, event.clientY); if (!instanceId) return;
      tap = { instanceId, x: event.clientX, y: event.clientY, time: eventTime(event), frame, rect: dimensions().rect };
      notify(instanceId, false);
    });
    listen('pointercancel', event => { if (!drag || drag.id === event.pointerId) cancelGesture(); });
    listen('lostpointercapture', event => {
      if (expectedCaptureLoss.delete(event.pointerId)) return;
      if (drag?.id === event.pointerId) cancelGesture(); else tap = null;
    });
    listen('dblclick', event => {
      const previous = tap; tap = null;
      if (!previous || drag || disposed || gl.isContextLost() || event.button !== 0 || event.isPrimary === false
        || previous.frame !== frame || ![event.clientX, event.clientY].every(Number.isFinite)
        || !sameRect(previous.rect, dimensions().rect)
        || eventTime(event) - previous.time < 0 || eventTime(event) - previous.time > 1000
        || Math.hypot(event.clientX - previous.x, event.clientY - previous.y) > 4) return;
      if (hitTest(event.clientX, event.clientY) === previous.instanceId) notify(previous.instanceId, true);
    });
    listen('wheel', event => {
      if (!model || disposed || gl.isContextLost()) return;
      cancelGesture(); event.preventDefault(); moveView(0, 0, Math.exp(Math.max(-1000, Math.min(1000, event.deltaY)) * .001)); render();
    }, { passive: false });
    listen('webglcontextlost', event => { event.preventDefault(); cancelGesture(); frame = null; if (!disposed) onError(new Error('WebGL2 context lost.')); });
  } catch (error) { release(); throw error; }
  return Object.freeze({
    setModel(next) { if (disposed) return false; cancelGesture(); frame = null; focus = selectedInstanceId = null; model = next; camera = { ...next.camera, position: [...next.camera.position], target: [...next.camera.target] }; return render(); },
    render,
    hitTest,
    setSelectedObject(instanceId) {
      if (disposed || !model || gl.isContextLost() || !(instanceId === null || typeof instanceId === 'string'
        && model.objects.some(object => object.instanceId === instanceId))) return false;
      if (instanceId === selectedInstanceId) return true;
      const previous = selectedInstanceId; selectedInstanceId = instanceId;
      if (draw(true)) return true;
      selectedInstanceId = previous; return false;
    },
    focusObject(instanceId) {
      if (disposed || !model || gl.isContextLost() || typeof instanceId !== 'string') return false;
      const object = model.objects.find(value => value.instanceId === instanceId);
      if (!object) return false;
      const { width, height } = dimensions(), next = frameCamera(camera, object, width / height);
      if (!next) return false;
      cancelGesture(); frame = null; camera = { ...next, position: [...next.position], target: [...next.target] };
      const distance = Math.hypot(...camera.position.map((value, index) => value - camera.target[index]));
      focus = { radius: Math.hypot(...object.size) / 2,
        distanceLimit: Math.max(200000, distance) * 4, distanceMinimum: Math.min(.01, distance / 4) };
      return render();
    },
    focusAll() {
      if (disposed || !model) return false;
      const previousCamera = camera, previousFocus = focus, previousFrame = frame;
      let attemptedDraw = false, failure = null;
      try {
        cancelGesture(); if (gl.isContextLost()) return false;
        const { width, height } = dimensions(), bounds = sceneBounds(model.objects);
        const next = frameSceneCamera(camera, model.objects, width / height);
        if (!bounds || !next) return false;
        const distance = Math.hypot(...next.position.map((value, axis) => value - next.target[axis]));
        const distanceLimit = distance * 4, distanceMinimum = distance / 4;
        if (![distance, distanceLimit, distanceMinimum].every(Number.isFinite) || distanceMinimum <= 0) return false;
        const eye = next.position.map((value, axis) => value - next.target[axis]);
        const viewProjection = new Float32Array(multiply4(perspective4(next.fovDegrees, width / height, next.near, next.far), lookAt4(eye, [0, 0, 0])));
        if (!viewProjection.every(Number.isFinite) || model.objects.some(object => !new Float32Array(objectMatrix4({ ...object,
          position: object.position.map((value, axis) => value - next.target[axis]) })).every(Number.isFinite))) return false;
        camera = { ...next, position: [...next.position], target: [...next.target] };
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
    },
    resetView() { if (disposed || !model) return false; cancelGesture(); frame = null; focus = null; camera = { ...model.camera, position: [...model.camera.position], target: [...model.camera.target] }; return render(); },
    snapshot: () => ({ disposed, draws, objectCount: model?.objects.length || 0, width: canvas.width, height: canvas.height, selectedInstanceId, camera: camera ? { ...camera, position: [...camera.position], target: [...camera.target] } : null }),
    dispose: release,
  });
}
