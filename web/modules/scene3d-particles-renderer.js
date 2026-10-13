import { color3, normalize3 } from './scene3d-math.js';

const vertex = `#version 300 es
precision highp float;
layout(location=0) in vec3 position;
layout(location=1) in vec3 normal;
layout(location=2) in vec3 phase;
uniform mat4 particleViewProjection;
uniform vec3 particleCenterRelative;
uniform vec3 particleExtent;
uniform vec3 particleSize;
uniform vec3 particleOffset;
uniform vec3 particleCameraRelative;
out vec3 particleNormal;
out vec3 particleEyeOffset;
void main(){
  vec3 wrapped=fract(phase+particleOffset);
  vec3 relativePosition=particleCenterRelative+particleExtent*(wrapped-vec3(0.5))+particleSize*position;
  particleNormal=normal;
  particleEyeOffset=relativePosition-particleCameraRelative;
  gl_Position=particleViewProjection*vec4(relativePosition,1.0);
}`;
const fragment = `#version 300 es
precision highp float;
in vec3 particleNormal;
in vec3 particleEyeOffset;
uniform vec3 particleColor;
uniform vec3 particleLightDirection;
uniform vec3 particleLightColor;
uniform float particleLightEnergy;
uniform vec3 particleFogColor;
uniform float particleFogDensity;
out vec4 pixel;
void main(){
  float diffuse=max(dot(normalize(particleNormal),-particleLightDirection),0.0);
  vec3 shaded=particleColor*(vec3(0.20)+particleLightColor*diffuse*particleLightEnergy);
  if(particleFogDensity>0.0){
    float amount=1.0-exp(-length(particleEyeOffset)*particleFogDensity);
    shaded=mix(shaded,particleFogColor,amount);
  }
  pixel=vec4(shaded,1.0);
}`;

const fail = () => { throw new TypeError('A matching native-prepared particle field and float32 phases are required.'); };
function values(record, names) {
  if (!record || typeof record !== 'object' || Array.isArray(record)) fail();
  const descriptors = Object.getOwnPropertyDescriptors(record);
  if (Reflect.ownKeys(descriptors).length !== names.length || names.some(name => !Object.hasOwn(descriptors, name)
    || !Object.hasOwn(descriptors[name], 'value') || !descriptors[name].enumerable)) fail();
  return Object.fromEntries(names.map(name => [name, descriptors[name].value]));
}
function triple(value, min, max) {
  if (!Array.isArray(value) || value.length !== 3 || Reflect.ownKeys(value).length !== 4) fail();
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const result = [0, 1, 2].map(index => {
    const item = descriptors[index]; if (!item || !Object.hasOwn(item, 'value') || !item.enumerable
      || typeof item.value !== 'number' || !Number.isFinite(item.value) || item.value < min || item.value > max) fail();
    return item.value;
  });
  return Object.freeze(result);
}
/** Capture explicit periodic offsets without invoking caller accessors. */
export function captureScene3DParticleOffset(value) {
  const result = triple(value, 0, 1);
  if (result.some(component => component >= 1)) fail();
  return result;
}
function field(value) {
  const result = values(value, ['center', 'extent', 'velocity', 'size', 'color', 'count', 'seed']);
  result.center = triple(result.center, -100000, 100000); result.extent = triple(result.extent, .01, 10000);
  result.velocity = triple(result.velocity, -1000, 1000); result.size = triple(result.size, .001, 1000);
  if (result.size.some((size, axis) => size > result.extent[axis]) || typeof result.color !== 'string' || !/^#[0-9a-fA-F]{6}$/.test(result.color)
    || !Number.isInteger(result.count) || result.count < 0 || result.count > 4096 || !Number.isInteger(result.seed) || result.seed < 0 || result.seed > 4294967295) fail();
  return Object.freeze(result);
}
/** Detach the narrow GPU packet without executing accessors or serializers.
 * Rust alone prepares phases; this check protects the renderer's buffer bounds. */
export function captureScene3DParticleField(modelField, prepared) {
  const packet = values(prepared, ['field', 'phases']), source = field(modelField), captured = field(packet.field);
  if (Object.keys(source).some(name => Array.isArray(source[name]) ? source[name].some((value, axis) => value !== captured[name][axis]) : source[name] !== captured[name])) fail();
  if (!Array.isArray(packet.phases) || packet.phases.length !== captured.count || Reflect.ownKeys(packet.phases).length !== captured.count + 1) fail();
  const descriptors = Object.getOwnPropertyDescriptors(packet.phases), phases = [];
  for (let index = 0; index < captured.count; index++) {
    const entry = descriptors[index]; if (!entry || !Object.hasOwn(entry, 'value') || !entry.enumerable) fail();
    const phase = triple(entry.value, 0, 1);
    if (phase.some(value => value >= 1 || Math.fround(value) !== value)) fail();
    phases.push(phase);
  }
  return Object.freeze({ field: captured, phases: Object.freeze(phases) });
}
function box() {
  const faces = [
    [[1,0,0], [[.5,-.5,-.5],[.5,.5,-.5],[.5,.5,.5],[.5,-.5,.5]]],
    [[-1,0,0], [[-.5,-.5,.5],[-.5,.5,.5],[-.5,.5,-.5],[-.5,-.5,-.5]]],
    [[0,1,0], [[-.5,.5,-.5],[-.5,.5,.5],[.5,.5,.5],[.5,.5,-.5]]],
    [[0,-1,0], [[-.5,-.5,.5],[-.5,-.5,-.5],[.5,-.5,-.5],[.5,-.5,.5]]],
    [[0,0,1], [[-.5,-.5,.5],[.5,-.5,.5],[.5,.5,.5],[-.5,.5,.5]]],
    [[0,0,-1], [[.5,-.5,-.5],[-.5,-.5,-.5],[-.5,.5,-.5],[.5,.5,-.5]]],
  ];
  return new Float32Array(faces.flatMap(([normal, corners]) => [0,1,2,0,2,3].flatMap(index => [...corners[index], ...normal])));
}
/** Independent opaque instanced-box adapter; no clock, source, core or picker. */
export function createScene3DParticlesRenderer(gl, packet) {
  let disposed = false, program, vao, geometry, phases; const shaders = [];
  const field = packet.field;
  function dispose() {
    if (disposed) return; disposed = true;
    if (geometry) gl.deleteBuffer(geometry); if (phases) gl.deleteBuffer(phases);
    if (vao) gl.deleteVertexArray(vao); if (program) gl.deleteProgram(program);
    shaders.forEach(shader => gl.deleteShader(shader));
  }
  if (field.count === 0) return Object.freeze({ draw: () => !disposed, dispose });
  let uniforms;
  try {
    if (typeof gl.drawArraysInstanced !== 'function' || typeof gl.vertexAttribDivisor !== 'function') throw new Error('WebGL2 particle instancing is unavailable.');
    program = gl.createProgram(); if (!program) throw new Error('Particle program allocation failed.');
    for (const [type, text] of [[gl.VERTEX_SHADER, vertex], [gl.FRAGMENT_SHADER, fragment]]) {
      const shader = gl.createShader(type); if (!shader) throw new Error('Particle shader allocation failed.'); shaders.push(shader);
      gl.shaderSource(shader, text); gl.compileShader(shader);
      if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(shader) || 'Particle shader compilation failed.');
      gl.attachShader(program, shader);
    }
    gl.linkProgram(program); if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program) || 'Particle shader linking failed.');
    vao = gl.createVertexArray(); geometry = gl.createBuffer(); phases = gl.createBuffer();
    if (!vao || !geometry || !phases) throw new Error('Particle buffer allocation failed.');
    gl.bindVertexArray(vao); gl.bindBuffer(gl.ARRAY_BUFFER, geometry); gl.bufferData(gl.ARRAY_BUFFER, box(), gl.STATIC_DRAW);
    for (const [location, offset] of [[0,0],[1,12]]) { gl.enableVertexAttribArray(location); gl.vertexAttribPointer(location,3,gl.FLOAT,false,24,offset); }
    gl.bindBuffer(gl.ARRAY_BUFFER, phases); gl.bufferData(gl.ARRAY_BUFFER,new Float32Array(packet.phases.flat()),gl.STATIC_DRAW);
    gl.enableVertexAttribArray(2); gl.vertexAttribPointer(2,3,gl.FLOAT,false,12,0); gl.vertexAttribDivisor(2,1); gl.bindVertexArray(null);
    uniforms = Object.fromEntries(['particleViewProjection','particleCenterRelative','particleExtent','particleSize','particleOffset','particleCameraRelative','particleColor',
      'particleLightDirection','particleLightColor','particleLightEnergy','particleFogColor','particleFogDensity'].map(name => [name,gl.getUniformLocation(program,name)]));
  } catch (error) { dispose(); throw error; }
  return Object.freeze({
    draw({ viewProjection, origin, camera, light, fog, background, offset }) {
      if (disposed || gl.isContextLost()) return false;
      gl.useProgram(program); gl.bindVertexArray(vao);
      gl.uniformMatrix4fv(uniforms.particleViewProjection,false,viewProjection);
      gl.uniform3fv(uniforms.particleCenterRelative,field.center.map((value,axis)=>value-origin[axis]));
      gl.uniform3fv(uniforms.particleExtent,field.extent); gl.uniform3fv(uniforms.particleSize,field.size); gl.uniform3fv(uniforms.particleOffset,offset);
      gl.uniform3fv(uniforms.particleCameraRelative,camera.position.map((value,axis)=>value-origin[axis]));
      gl.uniform3fv(uniforms.particleColor,color3(field.color)); gl.uniform3fv(uniforms.particleLightDirection,normalize3(light.direction));
      gl.uniform3fv(uniforms.particleLightColor,color3(light.color)); gl.uniform1f(uniforms.particleLightEnergy,light.energy);
      gl.uniform3fv(uniforms.particleFogColor,color3(fog?.color??background)); gl.uniform1f(uniforms.particleFogDensity,fog?.density??0);
      gl.drawArraysInstanced(gl.TRIANGLES,0,36,field.count); gl.bindVertexArray(null); return !gl.isContextLost();
    }, dispose,
  });
}
