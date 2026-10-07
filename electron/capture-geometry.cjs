const selectionToCrop = (selection, imageSize) => {
  if (!selection || !imageSize) return null;
  const { x, y, width, height, viewportWidth, viewportHeight } = selection;
  if (![x, y, width, height, viewportWidth, viewportHeight, imageSize.width, imageSize.height].every(Number.isFinite) ||
      width < 16 || height < 16 || viewportWidth < 1 || viewportHeight < 1 || imageSize.width < 1 || imageSize.height < 1) return null;
  const left = Math.max(0, Math.min(imageSize.width, Math.floor(x * imageSize.width / viewportWidth)));
  const top = Math.max(0, Math.min(imageSize.height, Math.floor(y * imageSize.height / viewportHeight)));
  const right = Math.max(left, Math.min(imageSize.width, Math.ceil((x + width) * imageSize.width / viewportWidth)));
  const bottom = Math.max(top, Math.min(imageSize.height, Math.ceil((y + height) * imageSize.height / viewportHeight)));
  return right > left && bottom > top ? { x: left, y: top, width: right - left, height: bottom - top } : null;
};

module.exports = { selectionToCrop };
