// Export features: full resolution output, background colours, JPG or PNG, trimming and ZIP download.
// The server only returns a mask at up to 1024 px. Here the mask is applied to the original photo,
// so downloads keep the full original quality.

const MAXIMUM_EXPORT_SIDE_IN_PIXELS = 4096;
const SUBJECT_PADDING_RATIO = 0.06;
const ALPHA_THRESHOLD_FOR_SUBJECT = 16;
const JSZIP_URL = "https://cdn.jsdelivr.net/npm/jszip@3.10.1/dist/jszip.min.js";

const exportSettings = { background: "transparent", format: "png", size: "full" };

/** The fill colour for exports and previews. Null means keep the background transparent. */
function getExportBackgroundColor() {
  if (exportSettings.background !== "transparent") return exportSettings.background;
  return exportSettings.format === "jpeg" ? "#ffffff" : null; // JPG cannot be transparent
}
const previewGrid = document.getElementById("results-grid");
const customColorInput = document.getElementById("custom-color");
const swatchButtons = document.querySelectorAll(".swatch");

function chooseBackground(color, selectedSwatch) {
  exportSettings.background = color;
  swatchButtons.forEach((button) => button.classList.toggle("is-selected", button === selectedSwatch));
  if (color === "transparent") previewGrid.style.removeProperty("--card-background");
  else previewGrid.style.setProperty("--card-background", color);
}

swatchButtons.forEach((button) =>
  button.addEventListener("click", () => chooseBackground(button.dataset.color, button))
);
customColorInput.addEventListener("input", () => chooseBackground(customColorInput.value, null));
document.getElementById("format-select").addEventListener("change", (event) => (exportSettings.format = event.target.value));
document.getElementById("size-select").addEventListener("change", (event) => (exportSettings.size = event.target.value));

/** Finds the box around the visible subject, in the mask's own pixel coordinates. */
function findSubjectBounds(maskBitmap) {
  const canvas = document.createElement("canvas");
  canvas.width = maskBitmap.width;
  canvas.height = maskBitmap.height;
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

async function buildExportBlob(item) {
  const originalBitmap = await createImageBitmap(item.originalFile, { imageOrientation: "from-image" });
  const cutoutBitmap = await createImageBitmap(item.cutoutBlob);

  const shrinkFactor = Math.min(1, MAXIMUM_EXPORT_SIDE_IN_PIXELS / Math.max(originalBitmap.width, originalBitmap.height));
  const fullWidth = Math.round(originalBitmap.width * shrinkFactor);
  const fullHeight = Math.round(originalBitmap.height * shrinkFactor);

  // Keep the original pixels only where the mask says "subject"
  const fullCanvas = document.createElement("canvas");
  fullCanvas.width = fullWidth;
  fullCanvas.height = fullHeight;
  const fullContext = fullCanvas.getContext("2d");
  fullContext.drawImage(originalBitmap, 0, 0, fullWidth, fullHeight);
  fullContext.globalCompositeOperation = "destination-in";
  fullContext.drawImage(cutoutBitmap, 0, 0, fullWidth, fullHeight);

  // A manual crop, if the person made one, replaces the Size setting for this image
  if (item.crop) {
    const croppedCanvas = document.createElement("canvas");
    croppedCanvas.width = item.crop.outputWidth;
    croppedCanvas.height = item.crop.outputHeight;
    drawCrop(croppedCanvas.getContext("2d"), fullCanvas, fullWidth, fullHeight, item.crop,
      croppedCanvas.width, croppedCanvas.height, getExportBackgroundColor());
    return new Promise((resolve) => croppedCanvas.toBlob(resolve, `image/${exportSettings.format}`, 0.95));
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

  const outputCanvas = document.createElement("canvas");
  outputCanvas.width = outputWidth;
  outputCanvas.height = outputHeight;
  const outputContext = outputCanvas.getContext("2d");

  // JPG cannot be transparent, so it falls back to white
  const backgroundColor = getExportBackgroundColor();
  if (backgroundColor) {
    outputContext.fillStyle = backgroundColor;
    outputContext.fillRect(0, 0, outputWidth, outputHeight);
  }

  outputContext.drawImage(
    fullCanvas, cropArea.left, cropArea.top, cropArea.width, cropArea.height,
    Math.round((outputWidth - cropArea.width) / 2), Math.round((outputHeight - cropArea.height) / 2),
    cropArea.width, cropArea.height
  );

  return new Promise((resolve) => outputCanvas.toBlob(resolve, `image/${exportSettings.format}`, 0.95));
}

function buildExportFileName(item, usedNames = new Set()) {
  const extension = exportSettings.format === "jpeg" ? "jpg" : "png";
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

async function downloadItem(item) {
  const downloadButton = item.card.querySelector(".download-link");
  downloadButton.disabled = true;
  try {
    saveBlobAsFile(await buildExportBlob(item), buildExportFileName(item));
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
      zipArchive.file(buildExportFileName(item, usedNames), await buildExportBlob(item));
    }
    saveBlobAsFile(await zipArchive.generateAsync({ type: "blob" }), "chrubg-images.zip");
  } catch (error) {
    showNotice(error.message || "The ZIP file could not be created.");
  }
}
