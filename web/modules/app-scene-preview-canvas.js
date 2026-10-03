// Engine-neutral saved Scene2D layout. View gestures never mutate the scene.
const MIN_SCALE = 0.02, MAX_SCALE = 16;
const clampScale = value => Math.max(MIN_SCALE, Math.min(MAX_SCALE, value));
export function fitSceneView(viewport, width, height, padding = 24) {
  const scale = clampScale(Math.min(Math.max(1, width - padding * 2) / viewport[0], Math.max(1, height - padding * 2) / viewport[1]));
  return { scale, offsetX: (width - viewport[0] * scale) / 2, offsetY: (height - viewport[1] * scale) / 2 };
}
export function canvasToScene(view, x, y) { return [(x - view.offsetX) / view.scale, (y - view.offsetY) / view.scale]; }
export function sceneToCanvas(view, x, y) { return [view.offsetX + x * view.scale, view.offsetY + y * view.scale]; }
export function zoomSceneView(view, factor, x, y) {
  const point = canvasToScene(view, x, y), scale = clampScale(view.scale * factor);
  return { scale, offsetX: x - point[0] * scale, offsetY: y - point[1] * scale };
}
export function hitTestScene(scene, actors, x, y) {
  if (x < 0 || y < 0 || x > scene.viewport[0] || y > scene.viewport[1]) return null;
  for (let index = actors.length - 1; index >= 0; index--) {
    const actor = actors[index];
    if (Math.abs(x - actor.position[0]) <= actor.size[0] / 2 && Math.abs(y - actor.position[1]) <= actor.size[1] / 2) return actor.objectId;
  }
  return null;
}
export function tintPixels(pixels, color) {
  const rgba = color.slice(1).match(/../g).map(value => parseInt(value, 16));
  if (rgba.length === 3) rgba.push(255);
  for (let index = 0; index < pixels.length; index += 4) {
    for (let channel = 0; channel < 4; channel++) pixels[index + channel] = Math.round(pixels[index + channel] * rgba[channel] / 255);
  }
  return pixels;
}
export function createScenePreviewCanvas({ canvas, onSelect = () => {}, onViewChange = () => {} }) {
  const context = canvas.getContext?.('2d');
  let model = null, images = new Map(), selected = null, visible = false, grid = false, view = { scale: 1, offsetX: 0, offsetY: 0 };
  let width = 0, height = 0, fitted = true, drag = null, disposed = false, lastSceneKey = '';
  const tiles = new Map(), listeners = [];
  let tileBytes = 0;
  const clearTiles = () => { for (const tile of tiles.values()) { tile.width = 0; tile.height = 0; } tiles.clear(); tileBytes = 0; };
  const notify = () => onViewChange({ ...view });
  function tinted(actor, image) {
    if (/^#ffffff(?:ff)?$/i.test(actor.color)) return image;
    const key = `${actor.imageResourceId}:${actor.color}`;
    if (tiles.has(key)) { const tile = tiles.get(key); tiles.delete(key); tiles.set(key, tile); return tile; }
    const tile = canvas.ownerDocument.createElement('canvas');
    tile.width = image.width; tile.height = image.height;
    const ctx = tile.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(image, 0, 0); const data = ctx.getImageData(0, 0, tile.width, tile.height);
    tintPixels(data.data, actor.color); ctx.putImageData(data, 0, 0);
    const bytes = tile.width * tile.height * 4;
    while (tileBytes + bytes > 32 * 1024 * 1024 && tiles.size) {
      const first = tiles.keys().next().value, old = tiles.get(first); tileBytes -= old.width * old.height * 4;
      old.width = 0; old.height = 0; tiles.delete(first);
    }
    tiles.set(key, tile); tileBytes += bytes; return tile;
  }
  function draw() {
    if (!visible || disposed || !context || !width || !height) return;
    const ratio = Math.min(3, Math.max(1, globalThis.devicePixelRatio || 1));
    const pixelWidth = Math.round(width * ratio), pixelHeight = Math.round(height * ratio);
    if (canvas.width !== pixelWidth) canvas.width = pixelWidth;
    if (canvas.height !== pixelHeight) canvas.height = pixelHeight;
    context.setTransform(ratio, 0, 0, ratio, 0, 0); context.clearRect(0, 0, width, height);
    context.fillStyle = '#dbe4df'; context.fillRect(0, 0, width, height);
    if (!model) return;
    const { scene, actors } = model, [sceneWidth, sceneHeight] = scene.viewport;
    context.translate(view.offsetX, view.offsetY); context.scale(view.scale, view.scale);
    context.save(); context.beginPath(); context.rect(0, 0, sceneWidth, sceneHeight); context.clip();
    context.clearRect(0, 0, sceneWidth, sceneHeight);
    context.fillStyle = scene.background; context.fillRect(0, 0, sceneWidth, sceneHeight);
    if (grid) {
      context.beginPath();
      for (let x = 0; x <= sceneWidth; x += 32) { context.moveTo(x, 0); context.lineTo(x, sceneHeight); }
      for (let y = 0; y <= sceneHeight; y += 32) { context.moveTo(0, y); context.lineTo(sceneWidth, y); }
      context.strokeStyle = '#8ca49966'; context.lineWidth = 1 / view.scale; context.stroke();
    }
    for (const actor of actors) {
      const [x, y] = actor.position, [w, h] = actor.size;
      if (actor.imageResourceId) {
        const image = images.get(actor.imageResourceId);
        if (image) context.drawImage(tinted(actor, image), x - w / 2, y - h / 2, w, h);
        else {
          context.fillStyle = '#733d60'; context.fillRect(x - w / 2, y - h / 2, w, h);
          context.beginPath(); context.moveTo(x - w / 2, y - h / 2); context.lineTo(x + w / 2, y + h / 2);
          context.moveTo(x + w / 2, y - h / 2); context.lineTo(x - w / 2, y + h / 2);
          context.strokeStyle = '#ffd4ef'; context.lineWidth = 2 / view.scale; context.stroke();
        }
      } else { context.fillStyle = actor.color; context.fillRect(x - w / 2, y - h / 2, w, h); }
      context.font = '16px sans-serif'; context.textBaseline = 'top'; context.fillStyle = '#ffffff';
      context.fillText(actor.name, x - w / 2, y + h / 2 + 4);
    }
    const actor = actors.find(item => item.objectId === selected);
    if (actor) {
      context.lineWidth = 3 / view.scale; context.strokeStyle = '#ffe575';
      context.strokeRect(actor.position[0] - actor.size[0] / 2, actor.position[1] - actor.size[1] / 2, ...actor.size);
      context.beginPath(); const radius = 5 / view.scale;
      context.moveTo(actor.position[0] - radius, actor.position[1]); context.lineTo(actor.position[0] + radius, actor.position[1]);
      context.moveTo(actor.position[0], actor.position[1] - radius); context.lineTo(actor.position[0], actor.position[1] + radius); context.stroke();
    }
    context.restore(); context.lineWidth = 1 / view.scale; context.strokeStyle = '#537061'; context.strokeRect(0, 0, sceneWidth, sceneHeight);
  }
  function resize() {
    const bounds = canvas.getBoundingClientRect?.(); if (!bounds || !bounds.width || !bounds.height) return;
    const oldWidth = width, oldHeight = height; width = bounds.width; height = bounds.height;
    if (model && fitted) view = fitSceneView(model.scene.viewport, width, height);
    else if (oldWidth && oldHeight) view = { ...view, offsetX: view.offsetX + (width - oldWidth) / 2, offsetY: view.offsetY + (height - oldHeight) / 2 };
    notify(); draw();
  }
  function fit() { fitted = true; resize(); }
  function zoom(factor, x = width / 2, y = height / 2) { if (!model) return; fitted = false; view = zoomSceneView(view, factor, x, y); notify(); draw(); }
  const point = event => { const bounds = canvas.getBoundingClientRect(); return [event.clientX - bounds.left, event.clientY - bounds.top]; };
  const listen = (name, callback, options) => { canvas.addEventListener(name, callback, options); listeners.push([name, callback, options]); };
  listen('wheel', event => { if (!model || !visible) return; event.preventDefault(); zoom(Math.exp(-Math.max(-100, Math.min(100, event.deltaY)) * 0.01), ...point(event)); }, { passive: false });
  listen('pointerdown', event => {
    if (!model || !visible || event.button > 0 || drag) return;
    canvas.focus({ preventScroll: true }); const [x, y] = point(event); drag = { id: event.pointerId, x, y, lastX: x, lastY: y, moved: false };
    canvas.setPointerCapture?.(event.pointerId);
  });
  listen('pointermove', event => {
    if (!drag || drag.id !== event.pointerId) return;
    const [x, y] = point(event); drag.moved ||= Math.hypot(x - drag.x, y - drag.y) > 4;
    if (drag.moved) { fitted = false; view.offsetX += x - drag.lastX; view.offsetY += y - drag.lastY; notify(); draw(); }
    drag.lastX = x; drag.lastY = y;
  });
  listen('pointerup', event => {
    if (!drag || drag.id !== event.pointerId) return;
    if (!drag.moved) { selected = hitTestScene(model.scene, model.actors, ...canvasToScene(view, ...point(event))); onSelect(selected); draw(); }
    drag = null; canvas.releasePointerCapture?.(event.pointerId);
  });
  listen('pointercancel', () => { drag = null; }); listen('lostpointercapture', () => { drag = null; });
  listen('keydown', event => {
    if (!model || event.ctrlKey || event.metaKey || event.altKey) return;
    if (['+', '=', '-', '0', 'Home', 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) { event.preventDefault(); event.stopPropagation(); }
    if (['+', '='].includes(event.key)) zoom(1.25); else if (event.key === '-') zoom(0.8); else if (['0', 'Home'].includes(event.key)) fit();
    else if (event.key.startsWith('Arrow')) {
      fitted = false; view.offsetX += event.key === 'ArrowLeft' ? 32 : event.key === 'ArrowRight' ? -32 : 0;
      view.offsetY += event.key === 'ArrowUp' ? 32 : event.key === 'ArrowDown' ? -32 : 0; notify(); draw();
    }
  });
  const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(resize) : null; observer?.observe(canvas);
  return {
    setScene(value) {
      const key = value ? JSON.stringify([value.scene.objectId, value.scene.viewport]) : lastSceneKey;
      if (key !== lastSceneKey) fitted = true;
      lastSceneKey = key; model = value;
      if (!value?.actors.some(actor => actor.objectId === selected)) selected = null;
      clearTiles(); resize(); draw();
    },
    setImages(value) { images = value; clearTiles(); draw(); },
    setVisible(value) { visible = value; drag = null; if (visible) resize(); },
    setGrid(value) { grid = value; draw(); }, select(id) { selected = id; draw(); }, fit, zoom,
    getView() { return { ...view }; },
    destroy() { disposed = true; observer?.disconnect(); listeners.forEach(args => canvas.removeEventListener(...args)); clearTiles(); images = new Map(); model = null; canvas.width = 0; canvas.height = 0; },
  };
}
