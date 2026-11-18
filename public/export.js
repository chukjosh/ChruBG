// Export features: full resolution output, backgrounds (colour, blurred photo, your own image), shadow,
// PNG, JPG or WebP with an optional file size limit, edge controls, trimming and ZIP download.
// The server only returns a mask at up to 1024 px. Here the mask is applied to the original photo,
// so downloads keep the full original quality.

const MAXIMUM_EXPORT_SIDE_IN_PIXELS = 4096;
const SUBJECT_PADDING_RATIO = 0.06;
const ALPHA_THRESHOLD_FOR_SUBJECT = 16;
const BLUR_REDUCTION_DIVISOR = 40;
const SIZE_LIMIT_SHRINK_FACTOR = 0.85;
const MAXIMUM_SIZE_LIMIT_ATTEMPTS = 8;
const JSZIP_URL = "https://cdn.jsdelivr.net/npm/jszip@3.10.1/dist/jszip.min.js";
const FORMAT_MIME_TYPES = { png: "image/png", jpeg: "image/jpeg", webp: "image/webp" };
const FILE_EXTENSIONS = { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp" };

// background is "transparent", "blur", "image" or a colour such as "#ffffff"
const exportSettings = { background: "transparent", backgroundImage: null, shadow: false, format: "png", size: "full", maximumKilobytes: 0 };
const edgeSettings = { shift: 0, feather: 0 };

const previewGrid = document.getElementById("results-grid");
const customColorInput = document.getElementById("custom-color");
const swatchButtons = document.querySelectorAll(".swatch");
const backgroundImageInput = document.getElementById("background-image-input");
let backgroundImagePreviewUrl = null;

function makeCanvas(width, height) {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

/** A flat fill colour for exports and previews. Null means no flat colour (transparent, blurred photo or your own image). */
function getExportBackgroundColor() {
  if (exportSettings.background.startsWith("#")) return exportSettings.background;
  return exportSettings.format === "jpeg" ? "#ffffff" : null; // JPG cannot be transparent
}

/* ---------- Controls ---------- */

function chooseBackground(value, selectedSwatch, previewCss = null) {
  exportSettings.background = value;
  swatchButtons.forEach((button) => button.classList.toggle("is-selected", button === selectedSwatch));
  previewGrid.dataset.background = value;
  if (value === "transparent" || value === "blur") previewGrid.style.removeProperty("--card-background");
  else previewGrid.style.setProperty("--card-background", previewCss || value);
}

swatchButtons.forEach((button) =>
  button.addEventListener("click", () => {
    if (button.dataset.color === "image") backgroundImageInput.click();
    else chooseBackground(button.dataset.color, button);
  })
);

backgroundImageInput.addEventListener("change", async () => {
  const file = backgroundImageInput.files[0];
  backgroundImageInput.value = "";
  if (!file) return;
  try {
    exportSettings.backgroundImage = await createImageBitmap(file);
  } catch (ignoredDecodeError) {
    showNotice("That file could not be used as a background image.");
    return;
  }
  if (backgroundImagePreviewUrl) URL.revokeObjectURL(backgroundImagePreviewUrl);
  backgroundImagePreviewUrl = URL.createObjectURL(file);
  chooseBackground("image", document.querySelector('.swatch[data-color="image"]'), `url("${backgroundImagePreviewUrl}") center / cover`);
});

customColorInput.addEventListener("input", () => chooseBackground(customColorInput.value, null));
document.getElementById("shadow-toggle").addEventListener("change", (event) => {
  exportSettings.shadow = event.target.checked;
  previewGrid.dataset.shadow = event.target.checked ? "on" : "off";
});
document.getElementById("format-select").addEventListener("change", (event) => (exportSettings.format = event.target.value));
document.getElementById("size-select").addEventListener("change", (event) => (exportSettings.size = event.target.value));
document.getElementById("max-size-select").addEventListener("change", (event) => (exportSettings.maximumKilobytes = Number(event.target.value)));

const featherSlider = document.getElementById("edge-feather");
const shiftSlider = document.getElementById("edge-shift");
[featherSlider, shiftSlider].forEach((slider) =>
  slider.addEventListener("input", () => {
    edgeSettings.feather = Number(featherSlider.value);
    edgeSettings.shift = Number(shiftSlider.value);
    scheduleEdgePreviewRefresh();
  })
);
document.getElementById("edge-reset").addEventListener("click", () => {
  featherSlider.value = shiftSlider.value = 0;
  edgeSettings.feather = edgeSettings.shift = 0;
  scheduleEdgePreviewRefresh();
});

/* ---------- Edge controls ---------- */

/** The cutout with the edge settings applied. The photo supplies the colours, so grown edges get real pixels. */
async function getAdjustedCutoutBlob(item) {
  if (edgeSettings.shift === 0 && edgeSettings.feather === 0) return item.cutoutBlob;

  const [photoBitmap, cutoutBitmap] = await Promise.all([createImageBitmap(item.jpegBlob), createImageBitmap(item.cutoutBlob)]);
  const { width, height } = photoBitmap;
  const maskCanvas = makeCanvas(width, height);
  const maskContext = maskCanvas.getContext("2d", { willReadFrequently: true });
  maskContext.drawImage(cutoutBitmap, 0, 0, width, height);
  const maskPixels = maskContext.getImageData(0, 0, width, height);

  const alpha = new Uint8ClampedArray(width * height);
  for (let index = 0; index < alpha.length; index++) alpha[index] = maskPixels.data[index * 4 + 3];
  const adjustedAlpha = adjustEdge(alpha, width, height, edgeSettings.shift, edgeSettings.feather);
  for (let index = 0; index < alpha.length; index++) maskPixels.data[index * 4 + 3] = adjustedAlpha[index];
  maskContext.putImageData(maskPixels, 0, 0);

  const resultCanvas = makeCanvas(width, height);
  const resultContext = resultCanvas.getContext("2d");
  resultContext.drawImage(photoBitmap, 0, 0);
  resultContext.globalCompositeOperation = "destination-in";
  resultContext.drawImage(maskCanvas, 0, 0);
  return new Promise((resolve) => resultCanvas.toBlob(resolve, "image/png"));
}

let edgePreviewTimer = null;
function scheduleEdgePreviewRefresh() {
  clearTimeout(edgePreviewTimer);
  edgePreviewTimer = setTimeout(refreshEdgePreviews, 150);
}

/** Shows the edge settings on every finished card as they change. */
async function refreshEdgePreviews() {
  for (const item of imageItems) {
    if (item.status !== "done" || item.wasRemoved) continue;
    const adjustedBlob = await getAdjustedCutoutBlob(item);
    if (item.previewUrl) URL.revokeObjectURL(item.previewUrl);
    item.previewUrl = adjustedBlob === item.cutoutBlob ? null : URL.createObjectURL(adjustedBlob);
    updateCard(item);
  }
}

/* ---------- Subject bounds ---------- */

/** Finds the box around the visible subject, in the mask's own pixel coordinates. */
function findSubjectBounds(maskBitmap) {
  const canvas = makeCanvas(maskBitmap.width, maskBitmap.height);
  const context = canvas.getContext("2d", { willReadFrequently: true });
  context.drawImage(maskBitmap, 0, 0);
  const { data } = context.getImageData(0, 0, canvas.width, canvas.height);

  let left = canvas.width, top = canvas.height, right = -1, bottom = -1;
  for (let y = 0; y < canvas.height; y++) {
    for (let x = 0; x < canvas.width; x++) {
      if (data[(y * canvas.width + x) * 4 + 3] > ALPHA_THRESHOLD_FOR_SUBJECT) {
        if (x < left) left = x;
        if (x > right) right = x;
        if (y < top) top = y;
        if (y > bottom) bottom = y;
      }
    }
  }
  return right < 0 ? null : { left, top, right: right + 1, bottom: bottom + 1 };
}

/* ---------- Building the export ---------- */

/** The full size background picture for the blur and image choices. Null when there is none. */
function buildBackgroundLayer(originalBitmap, width, height) {
  const layer = makeCanvas(width, height);
  const context = layer.getContext("2d");
  context.imageSmoothingQuality = "high";

  if (exportSettings.background === "blur") {
    // Shrinking the photo and stretching it back gives a smooth blur in every browser
    const reduction = Math.max(8, Math.round(Math.max(width, height) / BLUR_REDUCTION_DIVISOR));
    const small = makeCanvas(Math.max(1, Math.round(width / reduction)), Math.max(1, Math.round(height / reduction)));
    const smallContext = small.getContext("2d");
    smallContext.imageSmoothingQuality = "high";
    smallContext.drawImage(originalBitmap, 0, 0, small.width, small.height);
    context.drawImage(small, 0, 0, width, height);
    return layer;
  }
  if (exportSettings.background === "image" && exportSettings.backgroundImage) {
    const image = exportSettings.backgroundImage;
    const coverScale = Math.max(width / image.width, height / image.height);
    context.drawImage(image, (width - image.width * coverScale) / 2, (height - image.height * coverScale) / 2, image.width * coverScale, image.height * coverScale);
    return layer;
  }
  return null;
}

function applyShadow(context, width, height) {
  if (!exportSettings.shadow) return;
  const base = Math.min(width, height);
  context.shadowColor = "rgba(0, 0, 0, 0.38)";
  context.shadowBlur = base * 0.035;
  context.shadowOffsetY = base * 0.018;
}

function clearShadow(context) {
  context.shadowColor = "transparent";
}

function canvasToBlob(canvas, mimeType, quality) {
  return new Promise((resolve) => canvas.toBlob(resolve, mimeType, quality));
}

/** Saves the canvas in the chosen format. With a size limit it lowers the quality, then the size, until the file fits. */
async function encodeCanvas(canvas) {
  const mimeType = FORMAT_MIME_TYPES[exportSettings.format];
  const limitInBytes = exportSettings.maximumKilobytes * 1000;
  let workingCanvas = canvas;

  for (let attempt = 0; attempt < MAXIMUM_SIZE_LIMIT_ATTEMPTS; attempt++) {
    if (mimeType === "image/png") {
      const blob = await canvasToBlob(workingCanvas, mimeType);
      if (!limitInBytes || blob.size <= limitInBytes) return blob;
    } else {
      const best = await canvasToBlob(workingCanvas, mimeType, 0.95);
      if (!limitInBytes || best.size <= limitInBytes) return best;

      let lowestQuality = 0.2, highestQuality = 0.95, fittingBlob = null;
      for (let step = 0; step < 7; step++) {
        const quality = (lowestQuality + highestQuality) / 2;
        const blob = await canvasToBlob(workingCanvas, mimeType, quality);
        if (blob.size <= limitInBytes) {
          fittingBlob = blob;
          lowestQuality = quality;
        } else {
          highestQuality = quality;
        }
      }
      if (fittingBlob) return fittingBlob;
    }

    // Still too big, so make the picture smaller and try again
    const smaller = makeCanvas(Math.max(1, Math.round(workingCanvas.width * SIZE_LIMIT_SHRINK_FACTOR)), Math.max(1, Math.round(workingCanvas.height * SIZE_LIMIT_SHRINK_FACTOR)));
    const smallerContext = smaller.getContext("2d");
    smallerContext.imageSmoothingQuality = "high";
    smallerContext.drawImage(workingCanvas, 0, 0, smaller.width, smaller.height);
    workingCanvas = smaller;
  }
  return canvasToBlob(workingCanvas, mimeType, 0.2);
}

async function buildExportBlob(item) {
  const originalBitmap = await createImageBitmap(item.originalFile, { imageOrientation: "from-image" });
  const cutoutBitmap = await createImageBitmap(await getAdjustedCutoutBlob(item));

  const shrinkFactor = Math.min(1, MAXIMUM_EXPORT_SIDE_IN_PIXELS / Math.max(originalBitmap.width, originalBitmap.height));
  const fullWidth = Math.round(originalBitmap.width * shrinkFactor);
  const fullHeight = Math.round(originalBitmap.height * shrinkFactor);

  // Keep the original pixels only where the mask says "subject"
  const subjectCanvas = makeCanvas(fullWidth, fullHeight);
  const subjectContext = subjectCanvas.getContext("2d");
  subjectContext.drawImage(originalBitmap, 0, 0, fullWidth, fullHeight);
  subjectContext.globalCompositeOperation = "destination-in";
  subjectContext.drawImage(cutoutBitmap, 0, 0, fullWidth, fullHeight);

  const backgroundLayer = buildBackgroundLayer(originalBitmap, fullWidth, fullHeight);
  const backgroundColor = getExportBackgroundColor();

  // A manual crop, if the person made one, replaces the Size setting for this image
  if (item.crop) {
    const { outputWidth, outputHeight } = item.crop;
    const croppedCanvas = makeCanvas(outputWidth, outputHeight);
    const croppedContext = croppedCanvas.getContext("2d");
    if (backgroundColor) {
      croppedContext.fillStyle = backgroundColor;
      croppedContext.fillRect(0, 0, outputWidth, outputHeight);
    }
    if (backgroundLayer) drawCrop(croppedContext, backgroundLayer, fullWidth, fullHeight, item.crop, outputWidth, outputHeight, null, true);
    applyShadow(croppedContext, outputWidth, outputHeight);
    drawCrop(croppedContext, subjectCanvas, fullWidth, fullHeight, item.crop, outputWidth, outputHeight, null, true);
    return encodeCanvas(croppedCanvas);
  }

  let cropArea = { left: 0, top: 0, width: fullWidth, height: fullHeight };
  const subjectBounds = exportSettings.size === "full" ? null : findSubjectBounds(cutoutBitmap);
  if (subjectBounds) {
    const maskToFullScale = fullWidth / cutoutBitmap.width;
    const padding = Math.round(
      Math.max(subjectBounds.right - subjectBounds.left, subjectBounds.bottom - subjectBounds.top) * maskToFullScale * SUBJECT_PADDING_RATIO
    );
    const left = Math.max(0, Math.round(subjectBounds.left * maskToFullScale) - padding);
    const top = Math.max(0, Math.round(subjectBounds.top * maskToFullScale) - padding);
    const right = Math.min(fullWidth, Math.round(subjectBounds.right * maskToFullScale) + padding);
    const bottom = Math.min(fullHeight, Math.round(subjectBounds.bottom * maskToFullScale) + padding);
    cropArea = { left, top, width: right - left, height: bottom - top };
  }

  const isSquare = exportSettings.size === "square";
  const outputWidth = isSquare ? Math.max(cropArea.width, cropArea.height) : cropArea.width;
  const outputHeight = isSquare ? outputWidth : cropArea.height;
  const offsetX = Math.round((outputWidth - cropArea.width) / 2);
  const offsetY = Math.round((outputHeight - cropArea.height) / 2);

  const outputCanvas = makeCanvas(outputWidth, outputHeight);
  const outputContext = outputCanvas.getContext("2d");
  if (backgroundColor) {
    outputContext.fillStyle = backgroundColor;
    outputContext.fillRect(0, 0, outputWidth, outputHeight);
  }
  if (backgroundLayer) {
    if (isSquare) {
      // The square is bigger than the trimmed area, so the background covers all of it
      const coverScale = Math.max(outputWidth / fullWidth, outputHeight / fullHeight);
      outputContext.drawImage(backgroundLayer, (outputWidth - fullWidth * coverScale) / 2, (outputHeight - fullHeight * coverScale) / 2, fullWidth * coverScale, fullHeight * coverScale);
    } else {
      outputContext.drawImage(backgroundLayer, cropArea.left, cropArea.top, cropArea.width, cropArea.height, 0, 0, outputWidth, outputHeight);
    }
  }
  applyShadow(outputContext, outputWidth, outputHeight);
  outputContext.drawImage(subjectCanvas, cropArea.left, cropArea.top, cropArea.width, cropArea.height, offsetX, offsetY, cropArea.width, cropArea.height);
  clearShadow(outputContext);
  return encodeCanvas(outputCanvas);
}

/* ---------- Saving ---------- */

function buildExportFileName(item, blobType, usedNames = new Set()) {
  const extension = FILE_EXTENSIONS[blobType] || "png";
  const baseName = item.fileName.replace(/\.[^.]+$/, "") || "image";
  let candidate = `${baseName}-chrubg.${extension}`;
  for (let copyNumber = 2; usedNames.has(candidate); copyNumber++) {
    candidate = `${baseName}-chrubg-${copyNumber}.${extension}`;
  }
  usedNames.add(candidate);
  return candidate;
}

function saveBlobAsFile(blob, fileName) {
  const temporaryUrl = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = temporaryUrl;
  link.download = fileName;
  link.click();
  setTimeout(() => URL.revokeObjectURL(temporaryUrl), 10000);
}

function describeFormatFallback(blob) {
  return blob.type !== FORMAT_MIME_TYPES[exportSettings.format]
    ? `This browser cannot save ${exportSettings.format.toUpperCase()}, so a ${FILE_EXTENSIONS[blob.type] || "PNG"} file was saved instead.`
    : "";
}

async function downloadItem(item) {
  const downloadButton = item.card.querySelector(".download-link");
  downloadButton.disabled = true;
  try {
    const blob = await buildExportBlob(item);
    saveBlobAsFile(blob, buildExportFileName(item, blob.type));
    showNotice(describeFormatFallback(blob));
  } catch (ignoredExportError) {
    showNotice("This image could not be exported. Try again, or pick a smaller size.");
  } finally {
    downloadButton.disabled = false;
  }
}

let jsZipLoadingPromise = null;
function loadJsZip() {
  if (window.JSZip) return Promise.resolve();
  jsZipLoadingPromise ??= new Promise((resolve, reject) => {
    const scriptElement = document.createElement("script");
    scriptElement.src = JSZIP_URL;
    scriptElement.onload = resolve;
    scriptElement.onerror = () => reject(new Error("The ZIP library could not be loaded."));
    document.head.append(scriptElement);
  });
  return jsZipLoadingPromise;
}

async function downloadAllAsZip(finishedItems) {
  if (finishedItems.length === 0) {
    showNotice("There are no finished images to download yet.");
    return;
  }
  try {
    await loadJsZip();
    const zipArchive = new JSZip();
    const usedNames = new Set();
    for (const item of finishedItems) {
      const blob = await buildExportBlob(item);
      zipArchive.file(buildExportFileName(item, blob.type, usedNames), blob);
    }
    saveBlobAsFile(await zipArchive.generateAsync({ type: "blob" }), "chrubg-images.zip");
  } catch (error) {
    showNotice(error.message || "The ZIP file could not be created.");
  }
}
