// Optional in-browser processing. Used only when the person chooses "In your browser".
// The model runs locally with onnxruntime-web, so the image never leaves the device.

// The WebGPU build can use the graphics card and still falls back to the processor
const ONNX_RUNTIME_WEB_URL = "https://cdn.jsdelivr.net/npm/onnxruntime-web@1.20.1/dist/ort.webgpu.min.js";
let usingWebGpu = false;
const browserSessionsByModelId = new Map();
let onnxRuntimeLoadingPromise = null;

function loadOnnxRuntime() {
  if (window.ort) return Promise.resolve();
  onnxRuntimeLoadingPromise ??= new Promise((resolve, reject) => {
    const scriptElement = document.createElement("script");
    scriptElement.src = ONNX_RUNTIME_WEB_URL;
    scriptElement.onload = () => {
      ort.env.wasm.wasmPaths = "https://cdn.jsdelivr.net/npm/onnxruntime-web@1.20.1/dist/";
      usingWebGpu = Boolean(navigator.gpu);
      // Proxy worker requires cross-origin isolation (SharedArrayBuffer)
      ort.env.wasm.proxy = Boolean(window.crossOriginIsolated) && !usingWebGpu;
      resolve();
    };
    scriptElement.onerror = () => reject(new Error("The in-browser engine could not be loaded. Check your connection or use the server."));
    document.head.append(scriptElement);
  });
  return onnxRuntimeLoadingPromise;
}

function showStatusDetail(item, text) {
  item.statusDetail = text;
  updateCard(item);
}

async function downloadModelBytes(model, item) {
  const response = await fetch(model.url);
  if (!response.ok) throw new Error("The in-browser model could not be downloaded.");

  const totalBytes = Number(response.headers.get("Content-Length")) || 0;
  const reader = response.body.getReader();
  const chunks = [];
  let receivedBytes = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    receivedBytes += value.length;
    const progress = totalBytes ? `${Math.round((receivedBytes / totalBytes) * 100)}%` : `${Math.round(receivedBytes / 1e6)} MB`;
    showStatusDetail(item, `Downloading model, first time only... ${progress}`);
  }

  const modelBytes = new Uint8Array(receivedBytes);
  let offset = 0;
  for (const chunk of chunks) {
    modelBytes.set(chunk, offset);
    offset += chunk.length;
  }
  return modelBytes;
}

/** Creates a model session on the graphics card when possible, and falls back to the processor. */
async function createBrowserSession(modelBytes) {
  const providerChoices = usingWebGpu ? [["webgpu", "wasm"], ["wasm"]] : [["wasm"]];
  let lastError = null;
  for (const executionProviders of providerChoices) {
    try {
      return await ort.InferenceSession.create(modelBytes, { executionProviders });
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError;
}

async function getBrowserSession(model, item) {
  if (!browserSessionsByModelId.has(model.id)) {
    const modelBytes = await downloadModelBytes(model, item);
    showStatusDetail(item, "Starting the model...");
    browserSessionsByModelId.set(model.id, await createBrowserSession(modelBytes));
  }
  return browserSessionsByModelId.get(model.id);
}

/** Same steps as the server: resize, normalise, run, then turn the output into a mask. */
async function runModelInBrowser(item, model = item.model) {
  showStatusDetail(item, "Loading the in-browser engine...");
  await loadOnnxRuntime();
  const session = await getBrowserSession(model, item);
  showStatusDetail(item, "Removing background in your browser...");

  const photoBitmap = await createImageBitmap(item.jpegBlob);
  const inputSize = model.input_size;
  const planeSize = inputSize * inputSize;

  const inputCanvas = document.createElement("canvas");
  inputCanvas.width = inputSize;
  inputCanvas.height = inputSize;
  const inputContext = inputCanvas.getContext("2d", { willReadFrequently: true });
  inputContext.drawImage(photoBitmap, 0, 0, inputSize, inputSize);
  const pixels = inputContext.getImageData(0, 0, inputSize, inputSize).data;

  let largestValue = 1e-6;
  for (let index = 0; index < pixels.length; index++) {
    if (index % 4 !== 3 && pixels[index] > largestValue) largestValue = pixels[index];
  }

  const inputValues = new Float32Array(3 * planeSize);
  for (let pixelIndex = 0; pixelIndex < planeSize; pixelIndex++) {
    for (let channel = 0; channel < 3; channel++) {
      inputValues[channel * planeSize + pixelIndex] =
        (pixels[pixelIndex * 4 + channel] / largestValue - model.mean[channel]) / model.standard_deviation[channel];
    }
  }

  const outputs = await session.run({
    [session.inputNames[0]]: new ort.Tensor("float32", inputValues, [1, 3, inputSize, inputSize]),
  });
  const predictions = outputs[session.outputNames[0]].data;

  let lowestPrediction = Infinity, highestPrediction = -Infinity;
  for (let index = 0; index < planeSize; index++) {
    if (predictions[index] < lowestPrediction) lowestPrediction = predictions[index];
    if (predictions[index] > highestPrediction) highestPrediction = predictions[index];
  }
  const predictionRange = Math.max(highestPrediction - lowestPrediction, 1e-6);

  const maskImage = new ImageData(inputSize, inputSize);
  for (let index = 0; index < planeSize; index++) {
    maskImage.data[index * 4 + 3] = Math.round(((predictions[index] - lowestPrediction) / predictionRange) * 255);
  }
  const maskCanvas = document.createElement("canvas");
  maskCanvas.width = inputSize;
  maskCanvas.height = inputSize;
  maskCanvas.getContext("2d").putImageData(maskImage, 0, 0);

  const resultCanvas = document.createElement("canvas");
  resultCanvas.width = photoBitmap.width;
  resultCanvas.height = photoBitmap.height;
  const resultContext = resultCanvas.getContext("2d");
  resultContext.drawImage(photoBitmap, 0, 0);
  resultContext.globalCompositeOperation = "destination-in";
  resultContext.drawImage(maskCanvas, 0, 0, photoBitmap.width, photoBitmap.height);

  return new Promise((resolve) => resultCanvas.toBlob(resolve, "image/png"));
}
