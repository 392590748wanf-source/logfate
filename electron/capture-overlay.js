(() => {
  const image = document.querySelector('#image');
  const selection = document.querySelector('#selection');
  const veil = document.querySelector('#veil');
  let start = null;
  const point = event => ({ x: Math.max(0, Math.min(innerWidth, event.clientX)), y: Math.max(0, Math.min(innerHeight, event.clientY)) });
  const rectangle = (left, right) => ({ x: Math.min(left.x, right.x), y: Math.min(left.y, right.y), width: Math.abs(right.x - left.x), height: Math.abs(right.y - left.y) });
  window.purchaseCapture.onImage(dataUrl => { image.src = dataUrl; });
  document.addEventListener('pointerdown', event => {
    if (event.button !== 0) return;
    start = point(event);
    veil.style.display = 'none';
    selection.style.display = 'block';
    document.body.setPointerCapture?.(event.pointerId);
  });
  document.addEventListener('pointermove', event => {
    if (!start) return;
    const rect = rectangle(start, point(event));
    Object.assign(selection.style, { left: `${rect.x}px`, top: `${rect.y}px`, width: `${rect.width}px`, height: `${rect.height}px` });
  });
  document.addEventListener('pointerup', event => {
    if (!start) return;
    const rect = rectangle(start, point(event));
    start = null;
    if (rect.width < 16 || rect.height < 16) {
      selection.style.display = 'none';
      veil.style.display = 'block';
      return;
    }
    window.purchaseCapture.complete({ ...rect, viewportWidth: innerWidth, viewportHeight: innerHeight });
  });
  document.addEventListener('pointercancel', () => {
    start = null;
    selection.style.display = 'none';
    veil.style.display = 'block';
  });
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape') window.purchaseCapture.complete(null);
  });
})();
