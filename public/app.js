const MAXIMUM_IMAGE_SIDE_IN_PIXELS = 1024;
const REMOVE_BACKGROUND_ENDPOINT = "/api/remove_background";
const SUPPORTED_IMAGE_TYPES = ["image/png", "image/jpeg", "image/webp"];
const WAITING_MESSAGES = {
  preparing: "Preparing...",
  queued: "Waiting in line...",
  working: "Removing background...",
};

const dropzoneButton = document.getElementById("dropzone");
const fileInput = document.getElementById("file-input");
const modelPicker = document.getElementById("model-picker");
const modelSelect = document.getElementById("model-select");
const modelDescription = document.getElementById("model-description");
const noticeElement = document.getElementById("notice");
const resultsSection = document.getElementById("results");
const resultsTitle = document.getElementById("results-title");
const resultsGrid = document.getElementById("results-grid");
const clearAllButton = document.getElementById("clear-all-button");
const cardTemplate = document.getElementById("card-template");

// Everything lives in memory only. Closing or refreshing the tab clears it.
const imageItems = [];
const waitingItems = [];
let availableModels = [];
let isProcessingQueue = false;

function showNotice(message) {
  noticeElement.textContent = message;
}

/* ---------- Models ---------- */

const BROWSER_PROCESSING_NOTE =
  "Private: your image never leaves this device. The model downloads the first time you use it, and processing can be slower.";
const locationRadios = document.querySelectorAll('input[name="processing-location"]');
const locationChoice = document.getElementById("location-choice");
const modelRow = document.getElementById("model-row");

let serverModels = [];
let browserModels = [];
let processingLocation = "server"; // the server is the default; the browser is used only when the person picks it

async function loadAvailableModels() {
  try {
    const serverInfo = await (await fetch(REMOVE_BACKGROUND_ENDPOINT)).json();
    serverModels = serverInfo.models || [];
    browserModels = serverInfo.browser_models || [];
  } catch (ignoredNetworkError) {}

  if (serverModels.length === 0 && browserModels.length > 0) processingLocation = "browser";
  showModelChoices();
}

function getModelsForLocation() {
  return processingLocation === "browser" ? browserModels : serverModels;
}

function showModelChoices() {
  const models = getModelsForLocation();
  const canChooseLocation = serverModels.length > 0 && browserModels.length > 0;

  modelSelect.replaceChildren(...models.map((model) => new Option(model.label, model.id)));
  locationRadios.forEach((radio) => (radio.checked = radio.value === processingLocation));
  locationChoice.hidden = !canChooseLocation;
  modelRow.hidden = models.length < 2;
  // In-browser only setups still show the picker, so people see the privacy and download note
  modelPicker.hidden = !canChooseLocation && models.length < 2 && processingLocation !== "browser";
  showSelectedModelDescription();
}

function getSelectedModel() {
  return getModelsForLocation().find((model) => model.id === modelSelect.value) || null;
}

function showSelectedModelDescription() {
  const selectedModel = getSelectedModel();
  const locationNote = processingLocation === "browser" ? ` ${BROWSER_PROCESSING_NOTE}` : "";
  modelDescription.textContent = selectedModel
    ? `${selectedModel.description}${locationNote} Applies to images you add next.`
    : "";
}

locationRadios.forEach((radio) =>
  radio.addEventListener("change", () => {
    processingLocation = radio.value;
    showModelChoices();
  })
);

/* ---------- Cards ---------- */

function createItem(file) {
  const selectedModel = getSelectedModel();
  const item = {
    fileName: file.name || "pasted-image",
    status: "preparing",
    errorMessage: "",
    modelId: selectedModel ? selectedModel.id : null,
    model: selectedModel,
    location: processingLocation,
    statusDetail: "",
    modelLabel: selectedModel
      ? `${selectedModel.label}${processingLocation === "browser" ? ", in your browser" : ""}`
      : "",
    jpegBlob: null,
    originalFile: file,
    cutoutBlob: null,
    crop: null, // set only if the person uses Crop and resize
    originalUrl: null,
    cutoutUrl: null,
    abortController: new AbortController(),
    wasRemoved: false,
    card: cardTemplate.content.firstElementChild.cloneNode(true),
  };

  const slider = item.card.querySelector(".compare-slider");
  slider.addEventListener("input", () => {
    item.card.querySelector(".compare").style.setProperty("--split", `${slider.value}%`);
  });
  item.card.querySelector(".remove-button").addEventListener("click", () => removeItem(item));
  item.card.querySelector(".retry-button").addEventListener("click", () => queueItem(item));
  item.card.querySelector(".download-link").addEventListener("click", () => downloadItem(item));
  item.card.querySelector(".edit-button").addEventListener("click", () => openEditor(item));
  item.card.querySelector(".crop-button").addEventListener("click", () => openCropEditor(item));

  item.card.querySelector(".card-name").textContent = item.fileName;
  item.card.querySelector(".card-name").title = item.fileName;
  item.card.querySelector(".card-model").textContent = item.modelLabel;

  imageItems.push(item);
  resultsGrid.append(item.card);
  updateCard(item);
  updateResultsHeader();
  return item;
}

function updateCard(item) {
  item.card.dataset.status = item.status;
  item.card.querySelector(".card-model").textContent =
    item.modelLabel + (item.crop ? `, cropped to ${item.crop.outputWidth} x ${item.crop.outputHeight} px` : "");
  item.card.querySelector(".card-overlay-text").textContent =
    item.status === "error"
      ? item.errorMessage
      : (item.status === "working" && item.statusDetail) || WAITING_MESSAGES[item.status] || "";

  if (item.originalUrl) item.card.querySelector(".compare-original").src = item.originalUrl;
  if (item.cutoutUrl) item.card.querySelector(".compare-cutout").src = item.cutoutUrl;
}

function updateResultsHeader() {
  resultsSection.hidden = imageItems.length === 0;
  resultsTitle.textContent = `Your images (${imageItems.length})`;
}

function removeItem(item) {
  item.wasRemoved = true;
  item.abortController.abort();
  if (item.originalUrl) URL.revokeObjectURL(item.originalUrl);
  if (item.cutoutUrl) URL.revokeObjectURL(item.cutoutUrl);
  item.card.remove();
  item.originalFile = null;
  item.cutoutBlob = null;
  imageItems.splice(imageItems.indexOf(item), 1);
  updateResultsHeader();
}

/* ---------- Image preparation and processing ---------- */

/** Shrinks the image so the upload stays small and CPU inference stays fast. */
async function shrinkImageToJpeg(file) {
  const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  const shrinkFactor = Math.min(1, MAXIMUM_IMAGE_SIDE_IN_PIXELS / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * shrinkFactor);
  canvas.height = Math.round(bitmap.height * shrinkFactor);

  const drawingContext = canvas.getContext("2d");
  drawingContext.fillStyle = "#ffffff"; // JPEG has no transparency, so flatten onto white
  drawingContext.fillRect(0, 0, canvas.width, canvas.height);
  drawingContext.drawImage(bitmap, 0, 0, canvas.width, canvas.height);

  return new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.92));
}

async function prepareItem(item, file) {
  try {
    item.jpegBlob = await shrinkImageToJpeg(file);
    if (item.wasRemoved) return;
    item.originalUrl = URL.createObjectURL(item.jpegBlob);
    queueItem(item);
  } catch (ignoredDecodeError) {
    item.status = "error";
    item.errorMessage = "This file could not be read as an image.";
    updateCard(item);
  }
}

function queueItem(item) {
  item.status = "queued";
  updateCard(item);
  waitingItems.push(item);
  processWaitingItems();
}

async function requestCutout(item) {
  const modelQuery = item.modelId ? `?model=${encodeURIComponent(item.modelId)}` : "";
  const response = await fetch(REMOVE_BACKGROUND_ENDPOINT + modelQuery, {
    method: "POST",
    headers: { "Content-Type": "image/jpeg" },
    body: item.jpegBlob,
    signal: item.abortController.signal,
  });

  if (!response.ok) {
    let serverMessage = "Something went wrong while removing the background. Try again in a moment.";
    try {
      serverMessage = (await response.json()).error || serverMessage;
    } catch (ignoredParseError) {}
    throw new Error(serverMessage);
  }
  return response.blob();
}

/** Processes one image at a time so a CPU server is never overloaded. */
async function processWaitingItems() {
  if (isProcessingQueue) return;
  isProcessingQueue = true;

  while (waitingItems.length > 0) {
    const item = waitingItems.shift();
    if (item.wasRemoved) continue;

    item.status = "working";
    updateCard(item);
    try {
      const cutoutBlob = item.location === "browser" ? await runModelInBrowser(item) : await requestCutout(item);
      if (item.wasRemoved) continue;
      item.cutoutBlob = cutoutBlob;
      item.cutoutUrl = URL.createObjectURL(cutoutBlob);
      item.status = "done";
    } catch (error) {
      if (item.wasRemoved) continue;
      item.status = "error";
      item.errorMessage = error.message || "The image could not be processed.";
    }
    updateCard(item);
  }

  isProcessingQueue = false;
}

/* ---------- Adding files ---------- */

function addFiles(fileList) {
  const files = Array.from(fileList || []);
  const supportedFiles = files.filter((file) => SUPPORTED_IMAGE_TYPES.includes(file.type));
  const skippedCount = files.length - supportedFiles.length;

  showNotice(
    skippedCount > 0
      ? `${skippedCount} file${skippedCount === 1 ? " was" : "s were"} skipped. Use PNG, JPG or WebP images.`
      : ""
  );

  const newItems = supportedFiles.map(createItem);
  newItems.forEach((item, index) => prepareItem(item, supportedFiles[index]));
}

dropzoneButton.addEventListener("click", () => fileInput.click());
fileInput.addEventListener("change", () => {
  addFiles(fileInput.files);
  fileInput.value = "";
});
clearAllButton.addEventListener("click", () => [...imageItems].forEach(removeItem));
document.getElementById("download-all-button").addEventListener("click", () =>
  downloadAllAsZip(imageItems.filter((item) => item.status === "done"))
);
modelSelect.addEventListener("change", showSelectedModelDescription);

// Dropping anywhere on the page adds images
window.addEventListener("dragover", (event) => {
  event.preventDefault();
  dropzoneButton.classList.add("is-dragging");
});
window.addEventListener("dragleave", (event) => {
  if (!event.relatedTarget) dropzoneButton.classList.remove("is-dragging");
});
window.addEventListener("drop", (event) => {
  event.preventDefault();
  dropzoneButton.classList.remove("is-dragging");
  addFiles(event.dataTransfer.files);
});

document.addEventListener("paste", (event) => {
  if (event.clipboardData && event.clipboardData.files.length > 0) addFiles(event.clipboardData.files);
});

loadAvailableModels();
