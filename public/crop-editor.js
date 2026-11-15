// Optional Crop and resize editor. Nothing is cropped unless the person opens this and presses Apply.

const CROP_PRESETS = [
  { id: "custom", label: "Custom size", width: null, height: null },
  { id: "passport-35x45", label: "Passport 35 x 45 mm (413 x 531 px)", width: 413, height: 531 },
  { id: "us-2x2", label: "US passport or visa 2 x 2 in (600 x 600 px)", width: 600, height: 600 },
  { id: "square", label: "Square 1:1 (1080 x 1080 px)", width: 1080, height: 1080 },
  { id: "portrait", label: "Portrait 4:5 (1080 x 1350 px)", width: 1080, height: 1350 },
  { id: "landscape", label: "Landscape 4:3 (1200 x 900 px)", width: 1200, height: 900 },
  { id: "widescreen", label: "Widescreen 16:9 (1280 x 720 px)", width: 1280, height: 720 },
];
const MINIMUM_OUTPUT_SIDE_IN_PIXELS = 16;
const MAXIMUM_OUTPUT_SIDE_IN_PIXELS = 4096;
const CROP_PREVIEW_MAXIMUM_SIDE_IN_PIXELS = 480;
const WHEEL_ZOOM_STEP = 1.08;

const cropDialog = document.getElementById("crop-dialog");
const cropCanvas = document.getElementById("crop-canvas");
const cropPresetSelect = document.getElementById("crop-preset");
const cropWidthInput = document.getElementById("crop-width");
const cropHeightInput = document.getElementById("crop-height");
const cropZoomSlider = document.getElementById("crop-zoom");
const cropRemoveButton = document.getElementById("crop-remove");

let cropEditorState = null;

CROP_PRESETS.forEach((preset) => cropPresetSelect.append(new Option(preset.label, preset.id)));

function applyAutoFraming() {
  const { cutoutBitmap, subjectBounds, crop } = cropEditorState;
  Object.assign(crop, getAutoFraming(subjectBounds, cutoutBitmap.width, cutoutBitmap.height, crop.outputWidth, crop.outputHeight));
  cropZoomSlider.value = crop.zoom;
}

function showCropFormValues() {
  const { crop } = cropEditorState;
  cropWidthInput.value = crop.outputWidth;
  cropHeightInput.value = crop.outputHeight;
  cropZoomSlider.value = crop.zoom;
  const matchingPreset = CROP_PRESETS.find((preset) => preset.width === crop.outputWidth && preset.height === crop.outputHeight);
  cropPresetSelect.value = matchingPreset ? matchingPreset.id : "custom";
}

function drawCropPreview() {
  const { cutoutBitmap, crop } = cropEditorState;
  const previewScale = Math.min(1, CROP_PREVIEW_MAXIMUM_SIDE_IN_PIXELS / Math.max(crop.outputWidth, crop.outputHeight));
  cropCanvas.width = Math.max(1, Math.round(crop.outputWidth * previewScale));
  cropCanvas.height = Math.max(1, Math.round(crop.outputHeight * previewScale));
  drawCrop(cropCanvas.getContext("2d"), cutoutBitmap, cutoutBitmap.width, cutoutBitmap.height, crop,
    cropCanvas.width, cropCanvas.height, getExportBackgroundColor());
}

async function openCropEditor(item) {
  const cutoutBitmap = await createImageBitmap(item.cutoutBlob);
  const crop = item.crop
    ? { ...item.crop }
    : { outputWidth: 1080, outputHeight: 1080, centerX: 0.5, centerY: 0.5, zoom: 1 };

  cropEditorState = { item, cutoutBitmap, subjectBounds: findSubjectBounds(cutoutBitmap), crop, dragStart: null };
  if (!item.crop) applyAutoFraming();
  showCropFormValues();
  cropRemoveButton.hidden = !item.crop;
  drawCropPreview();
  cropDialog.showModal();
}

/* ---------- Size controls ---------- */

cropPresetSelect.addEventListener("change", () => {
  const preset = CROP_PRESETS.find((candidate) => candidate.id === cropPresetSelect.value);
  if (!preset || !preset.width) return;
  cropEditorState.crop.outputWidth = preset.width;
  cropEditorState.crop.outputHeight = preset.height;
  applyAutoFraming();
  showCropFormValues();
  drawCropPreview();
});

[cropWidthInput, cropHeightInput].forEach((sizeInput) =>
  sizeInput.addEventListener("input", () => {
    const readSide = (input, fallback) =>
      clampNumber(Math.round(Number(input.value)) || fallback, MINIMUM_OUTPUT_SIDE_IN_PIXELS, MAXIMUM_OUTPUT_SIDE_IN_PIXELS);
    cropEditorState.crop.outputWidth = readSide(cropWidthInput, cropEditorState.crop.outputWidth);
    cropEditorState.crop.outputHeight = readSide(cropHeightInput, cropEditorState.crop.outputHeight);
    cropPresetSelect.value = "custom";
    drawCropPreview();
  })
);

cropZoomSlider.addEventListener("input", () => {
  cropEditorState.crop.zoom = Number(cropZoomSlider.value);
  drawCropPreview();
});

/* ---------- Dragging and zooming the image inside the frame ---------- */

cropCanvas.addEventListener("pointerdown", (event) => {
  cropCanvas.setPointerCapture(event.pointerId);
  const { crop } = cropEditorState;
  cropEditorState.dragStart = { x: event.clientX, y: event.clientY, centerX: crop.centerX, centerY: crop.centerY };
  cropCanvas.style.cursor = "grabbing";
});

cropCanvas.addEventListener("pointermove", (event) => {
  if (!cropEditorState || !cropEditorState.dragStart) return;
  const { cutoutBitmap, crop, dragStart } = cropEditorState;
  const frame = getFrameInSource(crop, cutoutBitmap.width, cutoutBitmap.height);
  const sourcePixelsPerScreenPixel = frame.width / cropCanvas.getBoundingClientRect().width;

  // Dragging the picture right moves the frame left over the source
  crop.centerX = clampNumber(dragStart.centerX - ((event.clientX - dragStart.x) * sourcePixelsPerScreenPixel) / cutoutBitmap.width, 0, 1);
  crop.centerY = clampNumber(dragStart.centerY - ((event.clientY - dragStart.y) * sourcePixelsPerScreenPixel) / cutoutBitmap.height, 0, 1);
  drawCropPreview();
});

["pointerup", "pointercancel"].forEach((eventName) =>
  cropCanvas.addEventListener(eventName, () => {
    if (cropEditorState) cropEditorState.dragStart = null;
    cropCanvas.style.cursor = "grab";
  })
);

cropCanvas.addEventListener("wheel", (event) => {
  event.preventDefault();
  const { crop } = cropEditorState;
  crop.zoom = clampNumber(crop.zoom * (event.deltaY < 0 ? WHEEL_ZOOM_STEP : 1 / WHEEL_ZOOM_STEP), MINIMUM_ZOOM, MAXIMUM_ZOOM);
  cropZoomSlider.value = crop.zoom;
  drawCropPreview();
}, { passive: false });

/* ---------- Buttons ---------- */

document.getElementById("crop-reset").addEventListener("click", () => {
  applyAutoFraming();
  drawCropPreview();
});

document.getElementById("crop-done").addEventListener("click", () => {
  const { item, crop } = cropEditorState;
  if (!item.wasRemoved) {
    item.crop = { ...crop };
    updateCard(item);
  }
  cropDialog.close();
});

cropRemoveButton.addEventListener("click", () => {
  const { item } = cropEditorState;
  item.crop = null;
  updateCard(item);
  cropDialog.close();
});

/** Gives every finished image the same output size, each framed around its own subject. */
document.getElementById("crop-apply-all").addEventListener("click", async () => {
  const { item, crop } = cropEditorState;
  item.crop = { ...crop };
  for (const otherItem of imageItems) {
    if (otherItem === item || otherItem.status !== "done") continue;
    const otherBitmap = await createImageBitmap(otherItem.cutoutBlob);
    otherItem.crop = {
      outputWidth: crop.outputWidth,
      outputHeight: crop.outputHeight,
      ...getAutoFraming(findSubjectBounds(otherBitmap), otherBitmap.width, otherBitmap.height, crop.outputWidth, crop.outputHeight),
    };
  }
  imageItems.forEach((imageItem) => updateCard(imageItem));
  cropDialog.close();
});

document.getElementById("crop-cancel").addEventListener("click", () => cropDialog.close());
cropDialog.addEventListener("close", () => (cropEditorState = null));
