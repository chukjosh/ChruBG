// Video background removal (beta).
// Two engines: the visitor's browser (always offered when the model file exists), and a local server
// (only offered when this page is served by local_server.py or Docker with ffmpeg and a video model).

const MAXIMUM_BROWSER_VIDEO_SECONDS = 15;
const PROCESSING_FRAMES_PER_SECOND = 15;
const MAXIMUM_PROCESSING_SIDE_IN_PIXELS = 640;
const BROWSER_VIDEO_MODEL = { label: "Flow", url: "/models/flow.onnx" };
const LOCAL_VIDEO_ENDPOINT = "/api/video_local";
const JSZIP_URL = "https://cdn.jsdelivr.net/npm/jszip@3.10.1/dist/jszip.min.js";

const OUTPUT_CHOICES = {
  browser: [
    { id: "video", label: "Video with a solid background" },
    { id: "frames", label: "Transparent PNG frames (ZIP)" },
  ],
  local: [
    { id: "mp4", label: "Video with a solid background (MP4)" },
    { id: "webm", label: "Transparent video (WebM)" },
  ],
};
const TRANSPARENT_OUTPUTS = ["frames", "webm"];

const dropzone = document.getElementById("video-dropzone");
const dropzoneHint = document.getElementById("video-dropzone-hint");
const fileInput = document.getElementById("video-input");
const settings = document.getElementById("video-settings");
const engineSelect = document.getElementById("video-engine");
const outputSelect = document.getElementById("video-output");
const backgroundRow = document.getElementById("video-background-row");
const backgroundInput = document.getElementById("video-background");
const engineNote = document.getElementById("video-engine-note");
const notice = document.getElementById("video-notice");
const jobPanel = document.getElementById("video-job");
const statusText = document.getElementById("video-status");
const progressBar = document.getElementById("video-progress");
const resultVideo = document.getElementById("video-result");
const cancelButton = document.getElementById("video-cancel");
const downloadButton = document.getElementById("video-download");
const restartButton = document.getElementById("video-restart");

let engines = [];
let currentJob = null;
let resultUrl = null;
let resultBlob = null;
let resultFileName = "";

function showNotice(message) {
  notice.textContent = message;
}

function setStatus(text, percent = null) {
  statusText.textContent = text;
  if (percent === null) progressBar.removeAttribute("value");
  else progressBar.value = percent;
}

function formatSeconds(totalSeconds) {
  const seconds = Math.max(0, Math.round(totalSeconds));
  return seconds >= 60 ? `${Math.floor(seconds / 60)} min ${seconds % 60} s` : `${seconds} s`;
}

/* ---------- Which engines are available ---------- */

async function detectEngines() {
  const detected = [];
  try {
    if ((await fetch(BROWSER_VIDEO_MODEL.url, { method: "HEAD" })).ok) {
      detected.push({ id: "browser", label: `In your browser (${BROWSER_VIDEO_MODEL.label})` });
    }
  } catch (ignoredNetworkError) {}
  try {
    const response = await fetch(LOCAL_VIDEO_ENDPOINT);
    const status = response.ok ? await response.json() : null;
    if (status && status.available) {
      detected.push({ id: "local", label: `Local server (${status.models[0].label})`, maximumSeconds: status.maximum_seconds });
    }
  } catch (ignoredNetworkError) {}
  return detected;
}

function showEngineChoices() {
  const engine = engines.find((candidate) => candidate.id === engineSelect.value);
  outputSelect.replaceChildren(...OUTPUT_CHOICES[engine.id].map((choice) => new Option(choice.label, choice.id)));
  backgroundRow.hidden = TRANSPARENT_OUTPUTS.includes(outputSelect.value);
  engineNote.textContent = engine.id === "browser"
    ? `Runs on your device and nothing is uploaded. The model downloads the first time, and phones can be slow. Clips up to ${MAXIMUM_BROWSER_VIDEO_SECONDS} seconds.`
    : `Runs on the computer hosting this app, so it is faster and handles clips up to ${engine.maximumSeconds} seconds. The video is saved to a temporary folder while it is processed, then deleted.`;
}

async function startUp() {
  engines = await detectEngines();
  if (engines.length === 0) {
    dropzoneHint.textContent = "Video background removal is not set up on this site.";
    return;
  }
  engineSelect.replaceChildren(...engines.map((engine) => new Option(engine.label, engine.id)));
  engineSelect.hidden = engines.length < 2;
  document.querySelector('label[for="video-engine"]').hidden = engines.length < 2;
  settings.hidden = false;
  dropzone.disabled = false;
  dropzoneHint.textContent = "Or click to choose. MP4, WebM or MOV.";
  showEngineChoices();
}

/* ---------- Browser engine ---------- */

let videoSessionPromise = null;

function getVideoSession() {
  videoSessionPromise ??= (async () => {
    await loadOnnxRuntime();
    const response = await fetch(BROWSER_VIDEO_MODEL.url);
    if (!response.ok) throw new Error("The video model could not be downloaded.");
    const totalBytes = Number(response.headers.get("Content-Length")) || 0;
    const reader = response.body.getReader();
    const chunks = [];
    let receivedBytes = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      receivedBytes += value.length;
      setStatus(`Downloading the model, first time only... ${totalBytes ? Math.round((receivedBytes / totalBytes) * 100) + "%" : ""}`, null);
    }
    const modelBytes = new Uint8Array(receivedBytes);
    let offset = 0;
    for (const chunk of chunks) {
      modelBytes.set(chunk, offset);
      offset += chunk.length;
    }
    return ort.InferenceSession.create(modelBytes, { executionProviders: ["wasm"] });
  })().catch((error) => {
    videoSessionPromise = null;
    throw error;
  });
  return videoSessionPromise;
}

function waitForEvent(target, eventName) {
  return new Promise((resolve, reject) => {
    target.addEventListener(eventName, resolve, { once: true });
    target.addEventListener("error", () => reject(new Error("This file could not be read as a video.")), { once: true });
  });
}

async function seekVideo(video, seconds) {
  const seeked = waitForEvent(video, "seeked");
  video.currentTime = Math.max(seconds, 0.001);
  await seeked;
}

/** Removes the background from every frame. The model keeps a memory between frames, which steadies the edges. */
async function processInBrowser(file, job) {
  await loadOnnxRuntime();
  const session = await getVideoSession();

  const video = document.createElement("video");
  video.muted = true;
  video.playsInline = true;
  video.src = URL.createObjectURL(file);
  try {
    await waitForEvent(video, "loadedmetadata");
    if (video.duration > MAXIMUM_BROWSER_VIDEO_SECONDS) {
      throw new Error(`This video is ${Math.round(video.duration)} seconds long. In the browser, the limit is ${MAXIMUM_BROWSER_VIDEO_SECONDS} seconds. Trim it, or use a local server if one is offered.`);
    }

    const shrinkFactor = Math.min(1, MAXIMUM_PROCESSING_SIDE_IN_PIXELS / Math.max(video.videoWidth, video.videoHeight));
    const width = Math.max(2, Math.round((video.videoWidth * shrinkFactor) / 2) * 2);
    const height = Math.max(2, Math.round((video.videoHeight * shrinkFactor) / 2) * 2);
    const planeSize = width * height;
    const frameCount = Math.max(1, Math.floor(video.duration * PROCESSING_FRAMES_PER_SECOND));

    const sourceCanvas = Object.assign(document.createElement("canvas"), { width, height });
    const sourceContext = sourceCanvas.getContext("2d", { willReadFrequently: true });
    const frameCanvas = Object.assign(document.createElement("canvas"), { width, height });
    const frameContext = frameCanvas.getContext("2d");

    const downsampleRatio = new ort.Tensor("float32", Float32Array.of(Math.max(0.25, Math.min(1, 512 / Math.max(width, height)))), [1]);
    let recurrentStates = Array.from({ length: 4 }, () => new ort.Tensor("float32", new Float32Array(1), [1, 1, 1, 1]));
    const frames = [];
    const startedAt = Date.now();

    for (let index = 0; index < frameCount; index++) {
      if (job.cancelled) throw new Error("Cancelled.");
      await seekVideo(video, index / PROCESSING_FRAMES_PER_SECOND);
      sourceContext.drawImage(video, 0, 0, width, height);
      const pixels = sourceContext.getImageData(0, 0, width, height).data;

      const inputValues = new Float32Array(3 * planeSize);
      for (let pixelIndex = 0; pixelIndex < planeSize; pixelIndex++) {
        for (let channel = 0; channel < 3; channel++) {
          inputValues[channel * planeSize + pixelIndex] = pixels[pixelIndex * 4 + channel] / 255;
        }
      }

      const outputs = await session.run({
        src: new ort.Tensor("float32", inputValues, [1, 3, height, width]),
        r1i: recurrentStates[0], r2i: recurrentStates[1], r3i: recurrentStates[2], r4i: recurrentStates[3],
        downsample_ratio: downsampleRatio,
      });
      recurrentStates = [outputs.r1o, outputs.r2o, outputs.r3o, outputs.r4o];
      const alpha = outputs.pha.data;

      const frameImage = new ImageData(width, height);
      for (let pixelIndex = 0; pixelIndex < planeSize; pixelIndex++) {
        frameImage.data[pixelIndex * 4] = pixels[pixelIndex * 4];
        frameImage.data[pixelIndex * 4 + 1] = pixels[pixelIndex * 4 + 1];
        frameImage.data[pixelIndex * 4 + 2] = pixels[pixelIndex * 4 + 2];
        frameImage.data[pixelIndex * 4 + 3] = Math.round(Math.min(1, Math.max(0, alpha[pixelIndex])) * 255);
      }
      frameContext.putImageData(frameImage, 0, 0);
      frames.push(await createImageBitmap(frameCanvas));

      const secondsPerFrame = (Date.now() - startedAt) / 1000 / (index + 1);
      setStatus(`Frame ${index + 1} of ${frameCount}, about ${formatSeconds(secondsPerFrame * (frameCount - index - 1))} left`, ((index + 1) / frameCount) * 100);
    }
    return { frames, width, height };
  } finally {
    URL.revokeObjectURL(video.src);
  }
}

/** Plays the finished frames at the right speed while recording them, which gives a normal video file. */
async function recordFramesAsVideo(frames, width, height, backgroundColor, job) {
  const mimeType = ["video/webm;codecs=vp9", "video/webm;codecs=vp8", "video/webm", "video/mp4"].find((type) => MediaRecorder.isTypeSupported(type));
  if (!mimeType) throw new Error("This browser cannot record video. Choose the PNG frames output instead.");

  const canvas = Object.assign(document.createElement("canvas"), { width, height });
  const context = canvas.getContext("2d");
  const recorder = new MediaRecorder(canvas.captureStream(PROCESSING_FRAMES_PER_SECOND), { mimeType, videoBitsPerSecond: 6_000_000 });
  const chunks = [];
  recorder.ondataavailable = (event) => event.data.size && chunks.push(event.data);
  const finished = new Promise((resolve) => (recorder.onstop = resolve));

  recorder.start();
  for (let index = 0; index < frames.length; index++) {
    if (job.cancelled) {
      recorder.stop();
      throw new Error("Cancelled.");
    }
    context.fillStyle = backgroundColor;
    context.fillRect(0, 0, width, height);
    context.drawImage(frames[index], 0, 0);
    setStatus(`Saving the video, frame ${index + 1} of ${frames.length}`, ((index + 1) / frames.length) * 100);
    await new Promise((resolve) => setTimeout(resolve, 1000 / PROCESSING_FRAMES_PER_SECOND));
  }
  await new Promise((resolve) => setTimeout(resolve, 150));
  recorder.stop();
  await finished;
  return { blob: new Blob(chunks, { type: mimeType }), mimeType };
}

let jsZipLoadingPromise = null;
function loadJsZipLibrary() {
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

async function buildFramesZip(frames, width, height, job) {
  await loadJsZipLibrary();
  const archive = new JSZip();
  const canvas = Object.assign(document.createElement("canvas"), { width, height });
  const context = canvas.getContext("2d");
  for (let index = 0; index < frames.length; index++) {
    if (job.cancelled) throw new Error("Cancelled.");
    context.clearRect(0, 0, width, height);
    context.drawImage(frames[index], 0, 0);
    const pngBlob = await new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
    archive.file(`frame-${String(index + 1).padStart(4, "0")}.png`, pngBlob);
    setStatus(`Packing frame ${index + 1} of ${frames.length}`, ((index + 1) / frames.length) * 100);
  }
  return archive.generateAsync({ type: "blob" });
}

/* ---------- Local server engine ---------- */

async function processOnLocalServer(file, output, color, job) {
  const startedAt = Date.now();
  const timer = setInterval(() => setStatus(`Processing on the local server... ${formatSeconds((Date.now() - startedAt) / 1000)}`), 1000);
  setStatus("Processing on the local server...");
  try {
    const response = await fetch(`${LOCAL_VIDEO_ENDPOINT}?output=${output}&background=${encodeURIComponent(color)}`, {
      method: "POST",
      headers: { "Content-Type": file.type || "application/octet-stream" },
      body: file,
      signal: job.abortController.signal,
    });
    if (!response.ok) {
      let message = "The local server could not process this video.";
      try {
        message = (await response.json()).error || message;
      } catch (ignoredParseError) {}
      throw new Error(message);
    }
    return await response.blob();
  } finally {
    clearInterval(timer);
  }
}

/* ---------- Running a job ---------- */

function clearPreviousResult() {
  if (resultUrl) URL.revokeObjectURL(resultUrl);
  resultUrl = null;
  resultBlob = null;
  resultVideo.removeAttribute("src");
  resultVideo.hidden = true;
  downloadButton.hidden = true;
  restartButton.hidden = true;
}

function showResult(blob, fileName, isVideo) {
  resultBlob = blob;
  resultFileName = fileName;
  resultUrl = URL.createObjectURL(blob);
  if (isVideo) {
    resultVideo.src = resultUrl;
    resultVideo.hidden = false;
  }
  setStatus("Done.", 100);
  cancelButton.hidden = true;
  downloadButton.hidden = false;
  restartButton.hidden = false;
}

async function handleVideoFile(file) {
  if (!file || !file.type.startsWith("video/")) {
    showNotice("That file is not a video. Use MP4, WebM or MOV.");
    return;
  }
  showNotice("");
  clearPreviousResult();

  const engineId = engineSelect.value;
  const output = outputSelect.value;
  const backgroundColor = backgroundInput.value;
  const baseName = file.name.replace(/\.[^.]+$/, "") || "video";
  currentJob = { cancelled: false, abortController: new AbortController() };
  jobPanel.hidden = false;
  cancelButton.hidden = false;
  setStatus("Starting...");

  try {
    if (engineId === "local") {
      const blob = await processOnLocalServer(file, output, backgroundColor, currentJob);
      showResult(blob, `${baseName}-chrubg.${output}`, true);
    } else {
      const { frames, width, height } = await processInBrowser(file, currentJob);
      if (output === "frames") {
        showResult(await buildFramesZip(frames, width, height, currentJob), `${baseName}-frames.zip`, false);
      } else {
        const recorded = await recordFramesAsVideo(frames, width, height, backgroundColor, currentJob);
        showResult(recorded.blob, `${baseName}-chrubg.${recorded.mimeType.includes("mp4") ? "mp4" : "webm"}`, true);
      }
    }
  } catch (error) {
    jobPanel.hidden = true;
    showNotice(currentJob.cancelled ? "Cancelled." : error.message || "This video could not be processed.");
  }
}

function saveResult() {
  const link = Object.assign(document.createElement("a"), { href: resultUrl, download: resultFileName });
  link.click();
}

/* ---------- Wiring ---------- */

dropzone.addEventListener("click", () => fileInput.click());
fileInput.addEventListener("change", () => {
  handleVideoFile(fileInput.files[0]);
  fileInput.value = "";
});
engineSelect.addEventListener("change", showEngineChoices);
outputSelect.addEventListener("change", () => (backgroundRow.hidden = TRANSPARENT_OUTPUTS.includes(outputSelect.value)));
cancelButton.addEventListener("click", () => {
  currentJob.cancelled = true;
  currentJob.abortController.abort();
});
downloadButton.addEventListener("click", saveResult);
restartButton.addEventListener("click", () => {
  clearPreviousResult();
  jobPanel.hidden = true;
});

window.addEventListener("dragover", (event) => event.preventDefault());
window.addEventListener("drop", (event) => {
  event.preventDefault();
  if (!dropzone.disabled) handleVideoFile(event.dataTransfer.files[0]);
});

startUp();
