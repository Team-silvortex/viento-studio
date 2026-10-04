import { sceneActorIdentity } from '../../engine/scene-identity.mjs';
import './app-studio-core.js';
// Engine-neutral Scene2D layout. Gestures never mutate the supplied scene.
import { moveSceneSelection } from '../../engine/scene-layout.mjs';

const MIN_SCALE = 0.02, MAX_SCALE = 16;
const clampScale = value => Math.max(MIN_SCALE, Math.min(MAX_SCALE, value));
// Compatibility entry point; all authored position rules live in Rust.
export function moveScenePosition(position, delta, snap = 0) {
  return moveSceneSelection([{ objectId: 'position-preview', position, size: [1, 1] }], ['position-preview'], delta, snap)[0].position;
}
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
    if (Math.abs(x - actor.position[0]) <= actor.size[0] / 2 && Math.abs(y - actor.position[1]) <= actor.size[1] / 2) return sceneActorIdentity(actor);
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
export function createScenePreviewCanvas({ canvas, onSelect = () => {}, onViewChange = () => {}, onMove = () => {}, onMoveMany = () => {} }) {
  const context = canvas.getContext?.('2d');
  let model = null, images = new Map(), selected = null, visible = false, grid = false, view = { scale: 1, offsetX: 0, offsetY: 0 };
  let width = 0, height = 0, fitted = true, drag = null, disposed = false, lastSceneKey = '';
  let editing = false, snap = 0, space = false, multiSelect = false, selectedIds = [];
  const tiles = new Map(), listeners = [];
  let tileBytes = 0;
  const clearTiles = () => { for (const tile of tiles.values()) { tile.width = 0; tile.height = 0; } tiles.clear(); tileBytes = 0; };
  const notify = () => onViewChange({ ...view });
  function cancelDrag() {
    if (!drag) return;
    const id = drag.id; drag = null;
    try { canvas.releasePointerCapture?.(id); } catch { /* Capture may already have been lost. */ }
    draw();
  }
  const positionOf = actor => drag?.kind === 'move' ? drag.positions.get(sceneActorIdentity(actor)) || actor.position : actor.position;
  function selection(ids, primary = selected) {
    const valid = new Set(model?.actors.map(sceneActorIdentity) || []);
    const next = [...new Set(ids)].filter(id => valid.has(id)).slice(0, multiSelect ? undefined : 1);
    if (next.length !== selectedIds.length || next.some((id, index) => id !== selectedIds[index])) cancelDrag();
    selectedIds = next; selected = next.includes(primary) ? primary : next[0] || null;
  }
  function selectAt(id, toggle = false) {
    if (!id) selection([]);
    else if (!multiSelect) selection([id]);
    else if (toggle && selectedIds.includes(id)) selection(selectedIds.filter(value => value !== id));
    else if (toggle) selection([...selectedIds, id], id);
    else if (selectedIds.includes(id)) selection(selectedIds, id);
    else selection([id]);
    onSelect(selected, { ids: selectedIds.slice() });
  }
  function commit(changes, ids) {
    const original = new Map(model.actors.map(actor => [sceneActorIdentity(actor), actor.position]));
    if (!changes.some(change => change.position.some((value, index) => value !== original.get(change.objectId)?.[index]))) return;
    if (ids.length > 1) onMoveMany(changes.map(change => ({ objectId: change.objectId, position: change.position.slice() })), { commit: true });
    else if (changes.length) onMove(changes[0].objectId, changes[0].position.slice(), { commit: true });
  }
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
      const [x, y] = positionOf(actor), [w, h] = actor.size;
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
    const highlighted = new Set(selectedIds);
    for (const actor of actors.filter(item => highlighted.has(sceneActorIdentity(item)))) {
      const [x, y] = positionOf(actor);
      context.lineWidth = 3 / view.scale; context.strokeStyle = '#ffe575';
      context.strokeRect(x - actor.size[0] / 2, y - actor.size[1] / 2, ...actor.size);
      context.beginPath(); const radius = 5 / view.scale;
      context.moveTo(x - radius, y); context.lineTo(x + radius, y);
      context.moveTo(x, y - radius); context.lineTo(x, y + radius); context.stroke();
    }
    context.restore(); context.lineWidth = 1 / view.scale; context.strokeStyle = '#537061'; context.strokeRect(0, 0, sceneWidth, sceneHeight);
  }
  function resize() {
    const bounds = canvas.getBoundingClientRect?.(); if (!bounds || !bounds.width || !bounds.height) return;
    if (width && height && (width !== bounds.width || height !== bounds.height)) cancelDrag();
    const oldWidth = width, oldHeight = height; width = bounds.width; height = bounds.height;
    if (model && fitted) view = fitSceneView(model.scene.viewport, width, height);
    else if (oldWidth && oldHeight) view = { ...view, offsetX: view.offsetX + (width - oldWidth) / 2, offsetY: view.offsetY + (height - oldHeight) / 2 };
    notify(); draw();
  }
  function fit() { cancelDrag(); fitted = true; resize(); }
  function zoom(factor, x = width / 2, y = height / 2) { if (!model) return; cancelDrag(); fitted = false; view = zoomSceneView(view, factor, x, y); notify(); draw(); }
  const point = event => { const bounds = canvas.getBoundingClientRect(); return [event.clientX - bounds.left, event.clientY - bounds.top]; };
  const listen = (name, callback, options) => { canvas.addEventListener(name, callback, options); listeners.push([name, callback, options]); };
  listen('wheel', event => { if (!model || !visible) return; event.preventDefault(); zoom(Math.exp(-Math.max(-100, Math.min(100, event.deltaY)) * 0.01), ...point(event)); }, { passive: false });
  listen('pointerdown', event => {
    if (!model || !visible || disposed || ![0, 1].includes(event.button) || drag) return;
    event.preventDefault?.(); canvas.focus({ preventScroll: true });
    const [x, y] = point(event), panOnly = event.button === 1 || space;
    const actorId = !panOnly && editing ? hitTestScene(model.scene, model.actors, ...canvasToScene(view, x, y)) : null;
    const toggle = multiSelect && Boolean(event.shiftKey || event.ctrlKey || event.metaKey), original = model;
    if (actorId) selectAt(actorId, toggle);
    if (model !== original || disposed || !visible) return;
    const ids = actorId && selectedIds.includes(actorId) ? [actorId, ...selectedIds.filter(id => id !== actorId)] : [];
    const kind = actorId ? (ids.length && editing ? 'move' : 'select') : 'pan';
    drag = { id: event.pointerId, kind, ids, positions: new Map(model.actors.filter(actor => ids.includes(sceneActorIdentity(actor))).map(actor => [sceneActorIdentity(actor), actor.position.slice()])),
      x, y, lastX: x, lastY: y, moved: false, panOnly, toggle };
    try { canvas.setPointerCapture?.(event.pointerId); } catch { /* Detached canvases cannot capture a pointer. */ }
    if (actorId) draw();
  });
  listen('pointermove', event => {
    if (!drag || drag.id !== event.pointerId) return;
    const [x, y] = point(event), wasMoved = drag.moved;
    drag.moved ||= Math.hypot(x - drag.x, y - drag.y) > 4;
    if (drag.moved) {
      if (drag.kind === 'move') {
        const changes = moveSceneSelection(model.actors, drag.ids, [(x - drag.x) / view.scale, (y - drag.y) / view.scale], snap);
        drag.positions = new Map(changes.map(change => [change.objectId, change.position]));
      } else if (drag.kind === 'pan') {
        fitted = false; view.offsetX += x - (wasMoved ? drag.lastX : drag.x); view.offsetY += y - (wasMoved ? drag.lastY : drag.y); notify();
      }
      draw();
    }
    drag.lastX = x; drag.lastY = y;
  });
  listen('pointerup', event => {
    if (!drag || drag.id !== event.pointerId) return;
    const completed = drag; drag = null;
    try { canvas.releasePointerCapture?.(event.pointerId); } catch { /* Capture may already have been lost. */ }
    if (completed.kind === 'move') {
      if (completed.moved) commit(completed.ids.map(objectId => ({ objectId, position: completed.positions.get(objectId) })), completed.ids);
    } else if (completed.kind === 'pan' && !completed.moved && !completed.panOnly) {
      selectAt(hitTestScene(model.scene, model.actors, ...canvasToScene(view, ...point(event))), completed.toggle);
    }
    draw();
  });
  const cancelPointer = event => { if (drag && (event.pointerId === undefined || event.pointerId === drag.id)) cancelDrag(); };
  listen('pointercancel', cancelPointer); listen('lostpointercapture', cancelPointer);
  listen('blur', () => { space = false; cancelDrag(); });
  listen('keydown', event => {
    if (!model || !visible || event.altKey) return;
    if (multiSelect && (event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'a') {
      event.preventDefault(); event.stopPropagation(); cancelDrag(); selection(model.actors.map(sceneActorIdentity));
      onSelect(selected, { ids: selectedIds.slice() }); draw(); return;
    }
    if (event.ctrlKey || event.metaKey) return;
    if (event.key === 'Escape' && drag?.kind === 'move') { event.preventDefault(); event.stopPropagation(); cancelDrag(); return; }
    if (event.key === ' ' || event.code === 'Space') { space = true; event.preventDefault(); event.stopPropagation(); return; }
    if (['+', '=', '-', '0', 'Home', 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) { event.preventDefault(); event.stopPropagation(); }
    if (['+', '='].includes(event.key)) zoom(1.25); else if (event.key === '-') zoom(0.8); else if (['0', 'Home'].includes(event.key)) fit();
    else if (event.key.startsWith('Arrow')) {
      if (editing && selectedIds.length && !space) {
        cancelDrag();
        const amount = event.shiftKey ? 10 : 1;
        const changes = moveSceneSelection(model.actors, selectedIds, [event.key === 'ArrowLeft' ? -amount : event.key === 'ArrowRight' ? amount : 0,
          event.key === 'ArrowUp' ? -amount : event.key === 'ArrowDown' ? amount : 0]);
        commit(changes, selectedIds);
        draw(); return;
      }
      fitted = false; view.offsetX += event.key === 'ArrowLeft' ? 32 : event.key === 'ArrowRight' ? -32 : 0;
      view.offsetY += event.key === 'ArrowUp' ? 32 : event.key === 'ArrowDown' ? -32 : 0; notify(); draw();
    }
  });
  listen('keyup', event => { if (event.key === ' ' || event.code === 'Space') space = false; });
  const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(resize) : null; observer?.observe(canvas);
  return {
    setScene(value) {
      if (model === value) { draw(); return; }
      cancelDrag();
      const key = value ? JSON.stringify([value.scene.objectId, value.scene.viewport]) : lastSceneKey;
      if (key !== lastSceneKey) fitted = true;
      lastSceneKey = key; model = value;
      selection(selectedIds);
      clearTiles(); resize(); draw();
    },
    setImages(value) { images = value; clearTiles(); draw(); },
    setVisible(value) { if (visible !== value || !value) { space = false; cancelDrag(); } visible = value; if (visible) resize(); },
    setEditing(value) { if (editing !== Boolean(value)) { space = false; cancelDrag(); } editing = Boolean(value); },
    setMultiSelect(value) { const next = Boolean(value); if (multiSelect !== next) cancelDrag(); multiSelect = next; selection(selectedIds); draw(); },
    setSnap(value) { const next = Number.isSafeInteger(value) && value > 0 && value <= 100000 ? value : 0; if (snap !== next) cancelDrag(); snap = next; },
    setGrid(value) { grid = value; draw(); }, select(id) { selection(id ? [id] : []); draw(); },
    selectMany(ids) { selection(Array.isArray(ids) ? ids : []); draw(); }, fit, zoom,
    getView() { return { ...view }; },
    destroy() { disposed = true; cancelDrag(); observer?.disconnect(); listeners.forEach(args => canvas.removeEventListener(...args)); clearTiles(); images = new Map(); model = null; canvas.width = 0; canvas.height = 0; },
  };
}
