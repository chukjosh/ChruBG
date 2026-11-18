// Edge controls: grow, shrink and soften the cutout edge.
// These work on a plain array of alpha values, so they can be tested in Node.

function clampIndex(value, lowest, highest) {
  return Math.min(highest, Math.max(lowest, value));
}

/** Grows (positive shift) or shrinks (negative shift) the subject by that many pixels. */
function growOrShrinkAlpha(alpha, width, height, shift) {
  if (shift === 0) return alpha;
  const radius = Math.abs(shift);
  const isGrowing = shift > 0;
  const pickValue = (current, candidate) => (isGrowing ? Math.max(current, candidate) : Math.min(current, candidate));

  const sweep = (source, lineCount, lineLength, lineStep, itemStep) => {
    const result = new Uint8ClampedArray(source.length);
    for (let line = 0; line < lineCount; line++) {
      for (let position = 0; position < lineLength; position++) {
        let value = isGrowing ? 0 : 255;
        for (let offset = -radius; offset <= radius; offset++) {
          value = pickValue(value, source[line * lineStep + clampIndex(position + offset, 0, lineLength - 1) * itemStep]);
        }
        result[line * lineStep + position * itemStep] = value;
      }
    }
    return result;
  };
  return sweep(sweep(alpha, height, width, width, 1), width, height, 1, width);
}

/** One box blur pass along lines of the image, using a running sum so it stays fast on large masks. */
function blurLines(source, lineCount, lineLength, lineStep, itemStep, radius) {
  const result = new Uint8ClampedArray(source.length);
  const windowSize = 2 * radius + 1;
  for (let line = 0; line < lineCount; line++) {
    const start = line * lineStep;
    const valueAt = (position) => source[start + clampIndex(position, 0, lineLength - 1) * itemStep];
    let sum = 0;
    for (let offset = -radius; offset <= radius; offset++) sum += valueAt(offset);
    for (let position = 0; position < lineLength; position++) {
      result[start + position * itemStep] = Math.round(sum / windowSize);
      sum += valueAt(position + radius + 1) - valueAt(position - radius);
    }
  }
  return result;
}

/** Softens the edge by roughly `feather` pixels. */
function softenAlpha(alpha, width, height, feather) {
  if (feather <= 0) return alpha;
  const radius = Math.max(1, Math.ceil(feather / 2));
  let result = alpha;
  for (let pass = 0; pass < 2; pass++) {
    result = blurLines(blurLines(result, height, width, width, 1, radius), width, height, 1, width, radius);
  }
  return result;
}

function adjustEdge(alpha, width, height, shift, feather) {
  return softenAlpha(growOrShrinkAlpha(alpha, width, height, shift), width, height, feather);
}
