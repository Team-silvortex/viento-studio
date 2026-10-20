// A schematic renderer of sampled 2D properties. It has no scene/document I/O.
export function renderSceneAnimationSample(container, sample, { label = id => id, frameLabel = index => String(index) } = {}) {
  container.replaceChildren();
  const instances = new Map();
  for (const row of sample?.values || []) {
    if (!instances.has(row.instanceId)) instances.set(row.instanceId, { offset2d: [0, 0], rotation2d: 0, scale2d: [1, 1], opacity: 1 });
    instances.get(row.instanceId)[row.property] = row.value;
  }
  let index = 0;
  for (const [id, value] of instances) {
    const node = container.ownerDocument.createElement('div'); node.className = 'scene-animation-shape'; node.dataset.instanceId = id;
    index++;
    const hasFrame = Number.isInteger(value.spriteFrame2d), title = hasFrame ? `${label(id)} · ${frameLabel(value.spriteFrame2d)}` : label(id);
    node.textContent = String(hasFrame ? value.spriteFrame2d : index); node.title = title; node.setAttribute('aria-label', title);
    if (hasFrame) node.dataset.frameIndex = String(value.spriteFrame2d);
    // Fit offsets into the demonstration plane only. Inspector values below
    // retain the actual sampled units; this is deliberately not a game camera.
    node.style.transform = `translate(${value.offset2d[0] * 0.12}px, ${value.offset2d[1] * 0.12}px) rotate(${value.rotation2d}deg) scale(${value.scale2d[0]}, ${value.scale2d[1]})`;
    node.style.opacity = String(value.opacity); node.style.background = `hsl(${(index * 83) % 360} 65% 62%)`; container.append(node);
  }
}
