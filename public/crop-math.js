// Geometry for the Crop and resize editor. Nothing here reads the page, so it can be tested in Node.

const MINIMUM_ZOOM = 0.5;
const MAXIMUM_ZOOM = 4;
const AUTO_FRAME_PADDING_RATIO = 0.08;

function clampNumber(value, lowest, highest) {
  return Math.min(highest, Math.max(lowest, value));
}

/**
 * The crop frame measured in source image pixels.
 * Zoom 1 is the largest frame of the chosen shape that fits inside the image.
 * Zoom below 1 lets the frame reach past the image edges, which adds background around the picture.
 */
function getFrameInSource(crop, sourceWidth, sourceHeight) {
  const aspectRatio = crop.outputWidth / crop.outputHeight;
  const frameWidth = Math.min(sourceWidth, sourceHeight * aspectRatio) / crop.zoom;
  const frameHeight = frameWidth / aspectRatio;
  return {
    left: crop.centerX * sourceWidth - frameWidth / 2,
    top: crop.centerY * sourceHeight - frameHeight / 2,
    width: frameWidth,
    height: frameHeight,
  };
}

/** Centres the frame on the subject and zooms so the whole subject fits with some padding. */
function getAutoFraming(subjectBounds, sourceWidth, sourceHeight, outputWidth, outputHeight) {
  if (!subjectBounds) return { centerX: 0.5, centerY: 0.5, zoom: 1 };

  const aspectRatio = outputWidth / outputHeight;
  const subjectWidth = subjectBounds.right - subjectBounds.left;
  const subjectHeight = subjectBounds.bottom - subjectBounds.top;
  const requiredFrameWidth = Math.max(subjectWidth, subjectHeight * aspectRatio) * (1 + 2 * AUTO_FRAME_PADDING_RATIO);
  const fittingFrameWidth = Math.min(sourceWidth, sourceHeight * aspectRatio);

  return {
    centerX: (subjectBounds.left + subjectBounds.right) / 2 / sourceWidth,
    centerY: (subjectBounds.top + subjectBounds.bottom) / 2 / sourceHeight,
    zoom: clampNumber(fittingFrameWidth / requiredFrameWidth, MINIMUM_ZOOM, MAXIMUM_ZOOM),
  };
}

/** Draws the cropped view of an image onto a canvas context of the output size. */
function drawCrop(context, image, sourceWidth, sourceHeight, crop, targetWidth, targetHeight, backgroundColor, keepExisting = false) {
  context.save();
  if (!keepExisting) {
    context.clearRect(0, 0, targetWidth, targetHeight);
    if (backgroundColor) {
      context.fillStyle = backgroundColor;
      context.fillRect(0, 0, targetWidth, targetHeight);
    }
  }

  const frame = getFrameInSource(crop, sourceWidth, sourceHeight);
  const scale = targetWidth / frame.width;
  context.imageSmoothingQuality = "high";
  context.setTransform(scale, 0, 0, scale, -frame.left * scale, -frame.top * scale);
  context.drawImage(image, 0, 0, sourceWidth, sourceHeight);
  context.restore();
}
