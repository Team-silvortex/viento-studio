import { multiply4, lookAt4, perspective4, objectMatrix4, rotationXYZ4, normalize3, color3, orbitCamera } from './scene3d-math.js';

const vertex = `#version 300 es
layout(location=0) in vec3 position;
layout(location=1) in vec3 normal;
uniform mat4 model;
uniform mat4 rotation;
uniform mat4 viewProjection;
out vec3 worldNormal;
void main(){ worldNormal=mat3(rotation)*normal; gl_Position=viewProjection*model*vec4(position,1.0); }`;
const fragment = `#version 300 es
precision highp float;
in vec3 worldNormal;
uniform vec3 color;
uniform vec3 lightDirection;
uniform vec3 lightColor;
uniform float lightEnergy;
out vec4 pixel;
void main(){ float diffuse=max(dot(normalize(worldNormal),-lightDirection),0.0);
  pixel=vec4(color*(vec3(0.20)+lightColor*diffuse*lightEnergy),1.0); }`;
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
export function createScene3DRenderer(canvas, { onError = () => {}, pixelRatio = () => globalThis.devicePixelRatio || 1,
  observe = callback => typeof ResizeObserver === 'function' ? new ResizeObserver(callback) : null } = {}) {
  const gl = canvas.getContext('webgl2', { alpha: false, antialias: true, preserveDrawingBuffer: true });
  if (!gl) return null;
  let program, buffer, array, observer, disposed = false, model = null, camera = null, drag = null, draws = 0;
  const shaders = [], listeners = [];
  const listen = (event, callback, options) => { canvas.addEventListener(event, callback, options); listeners.push([event, callback, options]); };
  function release() {
    if (disposed) return; disposed = true; model = camera = drag = null;
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
  function render() {
    if (disposed || !model || gl.isContextLost()) return false;
    const bounds = canvas.getBoundingClientRect(), dpr = Math.max(1, Math.min(2, Number(pixelRatio()) || 1));
    const limit = Math.min(1, 2048 / Math.max(bounds.width * dpr, bounds.height * dpr, 1));
    const width = Math.max(1, Math.round(bounds.width * dpr * limit)), height = Math.max(1, Math.round(bounds.height * dpr * limit));
    if (canvas.width !== width) canvas.width = width; if (canvas.height !== height) canvas.height = height;
    gl.viewport(0, 0, width, height); gl.enable(gl.DEPTH_TEST); gl.depthFunc(gl.LEQUAL); gl.disable(gl.CULL_FACE);
    gl.clearColor(...color3(model.background), 1); gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.useProgram(program); gl.bindVertexArray(array);
    gl.uniformMatrix4fv(uniforms.viewProjection, false, new Float32Array(multiply4(perspective4(camera.fovDegrees, width / height, camera.near, camera.far), lookAt4(camera.position, camera.target))));
    gl.uniform3fv(uniforms.lightDirection, normalize3(model.light.direction)); gl.uniform3fv(uniforms.lightColor, color3(model.light.color)); gl.uniform1f(uniforms.lightEnergy, model.light.energy);
    for (const object of model.objects) {
      gl.uniformMatrix4fv(uniforms.model, false, new Float32Array(objectMatrix4(object)));
      gl.uniformMatrix4fv(uniforms.rotation, false, new Float32Array(rotationXYZ4(object.rotationDegrees)));
      gl.uniform3fv(uniforms.color, color3(object.color)); gl.drawArrays(gl.TRIANGLES, 0, 36);
    }
    gl.bindVertexArray(null); draws++; return true;
  }
  let uniforms;
  try {
    program = gl.createProgram(); if (!program) throw new Error('WebGL2 program allocation failed.');
    gl.attachShader(program, shader(gl.VERTEX_SHADER, vertex)); gl.attachShader(program, shader(gl.FRAGMENT_SHADER, fragment)); gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program) || 'WebGL2 program linking failed.');
    uniforms = Object.fromEntries(['model', 'rotation', 'viewProjection', 'color', 'lightDirection', 'lightColor', 'lightEnergy'].map(name => [name, gl.getUniformLocation(program, name)]));
    array = gl.createVertexArray(); buffer = gl.createBuffer(); if (!array || !buffer) throw new Error('WebGL2 geometry allocation failed.');
    gl.bindVertexArray(array); gl.bindBuffer(gl.ARRAY_BUFFER, buffer); gl.bufferData(gl.ARRAY_BUFFER, boxVertices(), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 24, 0); gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1, 3, gl.FLOAT, false, 24, 12);
    gl.bindVertexArray(null);
    observer = observe(() => render()); observer?.observe(canvas);
    listen('pointerdown', event => { if (event.button !== 0 || !model || disposed) return; drag = { id: event.pointerId, x: event.clientX, y: event.clientY }; canvas.setPointerCapture?.(event.pointerId); });
    listen('pointermove', event => { if (!drag || event.pointerId !== drag.id || disposed) return;
      camera = orbitCamera(camera, -(event.clientX - drag.x) * .008, (event.clientY - drag.y) * .008); drag.x = event.clientX; drag.y = event.clientY; render(); });
    const stop = event => { if (drag?.id === event.pointerId) { if (canvas.hasPointerCapture?.(event.pointerId)) canvas.releasePointerCapture(event.pointerId); drag = null; } };
    listen('pointerup', stop); listen('pointercancel', stop);
    listen('wheel', event => { if (!model || disposed) return; event.preventDefault(); camera = orbitCamera(camera, 0, 0, Math.exp(Math.max(-1000, Math.min(1000, event.deltaY)) * .001)); render(); }, { passive: false });
    listen('webglcontextlost', event => { event.preventDefault(); if (!disposed) onError(new Error('WebGL2 context lost.')); });
  } catch (error) { release(); throw error; }
  return Object.freeze({
    setModel(next) { if (disposed) return false; model = next; camera = { ...next.camera, position: [...next.camera.position], target: [...next.camera.target] }; return render(); },
    render,
    resetView() { if (disposed || !model) return false; camera = { ...model.camera, position: [...model.camera.position], target: [...model.camera.target] }; return render(); },
    snapshot: () => ({ disposed, draws, objectCount: model?.objects.length || 0, width: canvas.width, height: canvas.height, camera: camera ? { ...camera, position: [...camera.position], target: [...camera.target] } : null }),
    dispose: release,
  });
}
