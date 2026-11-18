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
  // Transparent comes first, so it is the default. Browsers cannot save a transparent video file, so they give PNG frames.
  browser: [
    { id: "frames", label: "Transparent (PNG frames in a ZIP)" },
    { id: "video", label: "Video with a background (colour, image or blur)" },
  ],
  local: [
    { id: "webm", label: "Transparent video (WebM)" },
    { id: "mp4", label: "Video with a background (MP4)" },
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
const backgroundTypeSelect = document.getElementById("video-background-type");
const backgroundImageInput = document.getElementById("video-background-image");
const backgroundImageButton = document.getElementById("video-background-image-button");
const backgroundImageName = document.getElementById("video-background-image-name");
const audioRow = document.getElementById("video-audio-row");
const keepAudioInput = document.getElementById("video-keep-audio");
let backgroundImageFile = null;
const trimPanel = document.getElementById("video-trim");
const previewVideo = document.getElementById("video-preview");
const trimInfo = document.getElementById("video-trim-info");
const startInput = document.getElementById("video-start");
const endInput = document.getElementById("video-end");
const framePreview = document.getElementById("video-frame-preview");
const videoHintBox = document.getElementById("device-hint");
const BLUR_FRAME_DIVISOR = 14;
let pendingVideo = null; // the chosen clip, waiting for Start, End and Remove background
let videoHintShownThisVisit = false;
let framePreviewUrl = null;

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

/** Shows only the controls that matter for the chosen output. */
function updateOutputControls() {
  backgroundRow.hidden = TRANSPARENT_OUTPUTS.includes(outputSelect.value);
  audioRow.hidden = outputSelect.value === "frames";
  const usesImage = backgroundTypeSelect.value === "image";
  backgroundInput.hidden = backgroundTypeSelect.value !== "color";
  backgroundImageButton.hidden = !usesImage;
  backgroundImageName.textContent = usesImage ? (backgroundImageFile ? backgroundImageFile.name : "No image chosen") : "";
}

function showEngineChoices() {
  const engine = engines.find((candidate) => candidate.id === engineSelect.value);
  outputSelect.replaceChildren(...OUTPUT_CHOICES[engine.id].map((choice) => new Option(choice.label, choice.id)));
  updateOutputControls();
  updateTrimInfo();
  maybeShowVideoHint();
  engineNote.textContent = engine.id === "browser"
    ? `Runs on your device and nothing is uploaded. The model downloads the first time. It uses your graphics card when the browser supports that, and phones can be slow. Clips up to ${MAXIMUM_BROWSER_VIDEO_SECONDS} seconds. Audio is recorded in real time, which works in most desktop browsers.`
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
    return createBrowserSession(modelBytes);
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

/** Removes the background from every frame in the chosen section. The model keeps a memory between frames, which steadies the edges. */
async function processInBrowser(file, job, range, wantsBlurredBackground) {
  await loadOnnxRuntime();
  const session = await getVideoSession();

  const video = document.createElement("video");
  video.muted = true;
  video.playsInline = true;
  video.src = URL.createObjectURL(file);
  try {
    await waitForEvent(video, "loadedmetadata");
    const clipSeconds = range.end - range.start;
    if (clipSeconds > MAXIMUM_BROWSER_VIDEO_SECONDS + 0.05) {
      throw new Error(`This section is ${Math.round(clipSeconds)} seconds long. In the browser, the limit is ${MAXIMUM_BROWSER_VIDEO_SECONDS} seconds. Shorten it with Start and End.`);
    }

    const shrinkFactor = Math.min(1, MAXIMUM_PROCESSING_SIDE_IN_PIXELS / Math.max(video.videoWidth, video.videoHeight));
    const width = Math.max(2, Math.round((video.videoWidth * shrinkFactor) / 2) * 2);
    const height = Math.max(2, Math.round((video.videoHeight * shrinkFactor) / 2) * 2);
    const planeSize = width * height;
    const frameCount = Math.max(1, Math.floor(clipSeconds * PROCESSING_FRAMES_PER_SECOND));

    const sourceCanvas = Object.assign(document.createElement("canvas"), { width, height });
    const sourceContext = sourceCanvas.getContext("2d", { willReadFrequently: true });
    const frameCanvas = Object.assign(document.createElement("canvas"), { width, height });
    const frameContext = frameCanvas.getContext("2d");
    // A tiny copy of each frame is enough for a blurred background, and costs very little memory
    const blurCanvas = Object.assign(document.createElement("canvas"), {
      width: Math.max(1, Math.round(width / BLUR_FRAME_DIVISOR)),
      height: Math.max(1, Math.round(height / BLUR_FRAME_DIVISOR)),
    });
    const blurContext = blurCanvas.getContext("2d");
    blurContext.imageSmoothingQuality = "high";

    const downsampleRatio = new ort.Tensor("float32", Float32Array.of(Math.max(0.25, Math.min(1, 512 / Math.max(width, height)))), [1]);
    let recurrentStates = Array.from({ length: 4 }, () => new ort.Tensor("float32", new Float32Array(1), [1, 1, 1, 1]));
    const frames = [];
    const blurs = [];
    const startedAt = Date.now();

    for (let index = 0; index < frameCount; index++) {
      if (job.cancelled) throw new Error("Cancelled.");
      await seekVideo(video, range.start + index / PROCESSING_FRAMES_PER_SECOND);
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
      if (wantsBlurredBackground) {
        blurContext.drawImage(sourceCanvas, 0, 0, blurCanvas.width, blurCanvas.height);
        blurs.push(await createImageBitmap(blurCanvas));
      }

      const secondsPerFrame = (Date.now() - startedAt) / 1000 / (index + 1);
      setStatus(`Frame ${index + 1} of ${frameCount}, about ${formatSeconds(secondsPerFrame * (frameCount - index - 1))} left`, ((index + 1) / frameCount) * 100);
    }
    return { frames, blurs, width, height };
  } finally {
    URL.revokeObjectURL(video.src);
  }
}

function paintBackground(context, width, height, background, blurredFrame) {
  if (background.kind === "blur" && blurredFrame) {
    context.imageSmoothingQuality = "high";
    context.drawImage(blurredFrame, 0, 0, width, height); // stretching the tiny copy back up gives the blur
  } else if (background.kind === "image" && background.bitmap) {
    const coverScale = Math.max(width / background.bitmap.width, height / background.bitmap.height);
    const drawWidth = background.bitmap.width * coverScale;
    const drawHeight = background.bitmap.height * coverScale;
    context.drawImage(background.bitmap, (width - drawWidth) / 2, (height - drawHeight) / 2, drawWidth, drawHeight);
  } else {
    context.fillStyle = background.color;
    context.fillRect(0, 0, width, height);
  }
}

/**
 * Best effort audio: the original clip plays silently into the recording, so its sound ends up in the file.
 * It is created right when the person clicks Remove background, because browsers only allow audio after a click or drop.
 */
function prepareAudioRecording(file, startSeconds = 0) {
  try {
    const audioContext = new AudioContext();
    audioContext.resume();
    const audioElement = Object.assign(document.createElement("video"), { src: URL.createObjectURL(file), playsInline: true });
    audioElement.currentTime = startSeconds;
    const destination = audioContext.createMediaStreamDestination();
    audioContext.createMediaElementSource(audioElement).connect(destination); // not connected to the speakers
    return {
      tracks: destination.stream.getAudioTracks(),
      start: () => audioElement.play().catch(() => {}),
      stop: () => {
        audioElement.pause();
        URL.revokeObjectURL(audioElement.src);
        audioContext.close().catch(() => {});
      },
    };
  } catch (ignoredAudioError) {
    return { tracks: [], start() {}, stop() {} };
  }
}

/** Plays the finished frames at the right speed while recording them, which gives a normal video file. */
async function recordFramesAsVideo(frames, blurs, width, height, background, job, audio) {
  const mimeType = ["video/webm;codecs=vp9,opus", "video/webm;codecs=vp8,opus", "video/webm", "video/mp4"].find((type) => MediaRecorder.isTypeSupported(type));
  if (!mimeType) throw new Error("This browser cannot record video. Choose the transparent PNG frames output instead.");

  const canvas = Object.assign(document.createElement("canvas"), { width, height });
  const context = canvas.getContext("2d");
  const stream = new MediaStream([...canvas.captureStream(PROCESSING_FRAMES_PER_SECOND).getVideoTracks(), ...(audio ? audio.tracks : [])]);
  const recorder = new MediaRecorder(stream, { mimeType, videoBitsPerSecond: 6_000_000 });
  const chunks = [];
  recorder.ondataavailable = (event) => event.data.size && chunks.push(event.data);
  const finished = new Promise((resolve) => (recorder.onstop = resolve));

  recorder.start();
  if (audio) audio.start();
  for (let index = 0; index < frames.length; index++) {
    if (job.cancelled) {
      recorder.stop();
      throw new Error("Cancelled.");
    }
    paintBackground(context, width, height, background, blurs[index]);
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

async function readErrorMessage(response, fallback) {
  try {
    return (await response.json()).error || fallback;
  } catch (ignoredParseError) {
    return fallback;
  }
}

async function processOnLocalServer(file, output, background, keepAudio, range, job) {
  const startedAt = Date.now();
  const timer = setInterval(() => setStatus(`Processing on the local server... ${formatSeconds((Date.now() - startedAt) / 1000)}`), 1000);
  setStatus("Processing on the local server...");
  try {
    let backgroundQuery = `&background=${encodeURIComponent(background.color)}`;
    if (background.kind === "blur") backgroundQuery += "&blur=1";
    if (background.kind === "image") {
      const upload = await fetch(`${LOCAL_VIDEO_ENDPOINT}/background`, {
        method: "POST",
        headers: { "Content-Type": background.file.type || "image/png" },
        body: background.file,
        signal: job.abortController.signal,
      });
      if (!upload.ok) throw new Error(await readErrorMessage(upload, "The background image could not be used."));
      backgroundQuery += `&background_token=${encodeURIComponent((await upload.json()).token)}`;
    }

    const response = await fetch(`${LOCAL_VIDEO_ENDPOINT}?output=${output}${backgroundQuery}&audio=${keepAudio ? 1 : 0}&start=${range.start}&end=${range.end}`, {
      method: "POST",
      headers: { "Content-Type": file.type || "application/octet-stream" },
      body: file,
      signal: job.abortController.signal,
    });
    if (!response.ok) throw new Error(await readErrorMessage(response, "The local server could not process this video."));
    return await response.blob();
  } finally {
    clearInterval(timer);
  }
}

/* ---------- Choosing the section to process ---------- */

function currentEngineLimit() {
  const engine = engines.find((candidate) => candidate.id === engineSelect.value);
  return engine && engine.id === "local" ? engine.maximumSeconds : MAXIMUM_BROWSER_VIDEO_SECONDS;
}

function readTrimValues() {
  return { start: Number(startInput.value) || 0, end: Number(endInput.value) };
}

function updateTrimInfo() {
  if (!pendingVideo) return;
  const { start, end } = readTrimValues();
  trimInfo.textContent = `Clip length ${pendingVideo.duration.toFixed(1)} s. Selected: ${Math.max(0, end - start).toFixed(1)} s. This engine handles up to ${currentEngineLimit()} s at a time, so use Start and End to pick the part you want.`;
}

/** Returns the chosen section, or null (with an explanation) when it cannot be used. */
function validateTrimRange() {
  const { start, end } = readTrimValues();
  const range = { start: Math.max(0, start), end: Math.min(end, pendingVideo.duration) };
  if (!(range.end > range.start)) {
    showNotice("The end has to come after the start.");
    return null;
  }
  if (range.end - range.start > currentEngineLimit() + 0.05) {
    showNotice(`This section is ${(range.end - range.start).toFixed(1)} s. This engine handles up to ${currentEngineLimit()} s, so shorten it with Start and End.`);
    return null;
  }
  return range;
}

async function prepareVideo(file) {
  if (!file || !file.type.startsWith("video/")) {
    showNotice("That file is not a video. Use MP4, WebM or MOV.");
    return;
  }
  showNotice("");
  clearPreviousResult();
  jobPanel.hidden = true;
  videoHintBox.hidden = true;
  if (pendingVideo) URL.revokeObjectURL(pendingVideo.previewUrl);

  const previewUrl = URL.createObjectURL(file);
  previewVideo.src = previewUrl;
  try {
    await waitForEvent(previewVideo, "loadedmetadata");
    if (!Number.isFinite(previewVideo.duration)) throw new Error("The length of this video could not be read.");
  } catch (error) {
    URL.revokeObjectURL(previewUrl);
    pendingVideo = null;
    trimPanel.hidden = true;
    showNotice(error.message);
    return;
  }
  pendingVideo = { file, duration: previewVideo.duration, previewUrl };
  startInput.value = "0";
  endInput.value = String(Math.round(Math.min(pendingVideo.duration, currentEngineLimit()) * 10) / 10);
  trimPanel.hidden = false;
  updateTrimInfo();
  maybeShowVideoHint();
}

function forgetPendingVideo() {
  if (pendingVideo) URL.revokeObjectURL(pendingVideo.previewUrl);
  pendingVideo = null;
  previewVideo.removeAttribute("src");
  trimPanel.hidden = true;
  videoHintBox.hidden = true;
}

/* ---------- Device hint ---------- */

// A suggestion, never a blocker. Shown at most once per visit, only for a longer clip, only on a device that looks slow,
// only when the browser engine is selected, and it can be dismissed for good.
function maybeShowVideoHint() {
  videoHintBox.hidden = true;
  if (!pendingVideo || engineSelect.value !== "browser" || videoHintShownThisVisit || isHintDismissed("video-browser")) return;
  const { start, end } = readTrimValues();
  if (end - start <= 5 || !deviceLooksSlow(readDeviceFacts())) return;

  const localIsAvailable = engines.some((engine) => engine.id === "local");
  document.getElementById("device-hint-text").textContent = localIsAvailable
    ? "Heads up: a clip this long can take several minutes on this device in the browser. The local server is usually faster, and you can also shorten the clip with Start and End. You can use either."
    : "Heads up: a clip this long can take several minutes on this device. You can shorten it with Start and End if you would rather not wait.";
  document.getElementById("device-hint-switch").hidden = !localIsAvailable;
  videoHintBox.hidden = false;
  videoHintShownThisVisit = true;
}

/* ---------- Running a job ---------- */

function clearPreviousResult() {
  if (resultUrl) URL.revokeObjectURL(resultUrl);
  if (framePreviewUrl) URL.revokeObjectURL(framePreviewUrl);
  resultUrl = null;
  framePreviewUrl = null;
  resultBlob = null;
  resultVideo.removeAttribute("src");
  resultVideo.hidden = true;
  framePreview.removeAttribute("src");
  framePreview.hidden = true;
  downloadButton.hidden = true;
  restartButton.hidden = true;
}

function showResult(blob, fileName, kind, previewUrl = null, message = "Done.") {
  resultBlob = blob;
  resultFileName = fileName;
  resultUrl = URL.createObjectURL(blob);
  if (kind === "video") {
    resultVideo.src = resultUrl;
    resultVideo.hidden = false;
  } else if (previewUrl) {
    framePreviewUrl = previewUrl;
    framePreview.src = previewUrl;
    framePreview.hidden = false;
  }
  setStatus(message, 100);
  cancelButton.hidden = true;
  downloadButton.hidden = false;
  restartButton.hidden = false;
}

async function frameToPreviewUrl(frame, width, height) {
  const canvas = Object.assign(document.createElement("canvas"), { width, height });
  canvas.getContext("2d").drawImage(frame, 0, 0);
  return URL.createObjectURL(await new Promise((resolve) => canvas.toBlob(resolve, "image/png")));
}

async function startProcessing() {
  if (!pendingVideo) return;
  const range = validateTrimRange();
  if (!range) return;

  const { file } = pendingVideo;
  const engineId = engineSelect.value;
  const output = outputSelect.value;
  const isTransparent = TRANSPARENT_OUTPUTS.includes(output);
  const keepAudio = keepAudioInput.checked && output !== "frames";
  const baseName = file.name.replace(/\.[^.]+$/, "") || "video";

  // Browser audio has to be set up right now, while the click still counts as a user action
  const audio = keepAudio && engineId === "browser" ? prepareAudioRecording(file, range.start) : null;

  const background = { kind: isTransparent ? "color" : backgroundTypeSelect.value, color: backgroundInput.value, bitmap: null, file: null };
  if (background.kind === "image") {
    if (!backgroundImageFile) {
      if (audio) audio.stop();
      showNotice("Choose a background image first, or pick another background.");
      return;
    }
    try {
      background.file = backgroundImageFile;
      background.bitmap = await createImageBitmap(backgroundImageFile);
    } catch (ignoredDecodeError) {
      if (audio) audio.stop();
      showNotice("That file could not be used as a background image.");
      return;
    }
  }

  showNotice("");
  clearPreviousResult();
  currentJob = { cancelled: false, abortController: new AbortController() };
  trimPanel.hidden = true;
  jobPanel.hidden = false;
  cancelButton.hidden = false;
  setStatus("Starting...");

  try {
    if (engineId === "local") {
      const blob = await processOnLocalServer(file, output, background, keepAudio, range, currentJob);
      showResult(blob, `${baseName}-chrubg.${output}`, "video");
    } else {
      const { frames, blurs, width, height } = await processInBrowser(file, currentJob, range, background.kind === "blur" && !isTransparent);
      if (output === "frames") {
        const zip = await buildFramesZip(frames, width, height, currentJob);
        const preview = await frameToPreviewUrl(frames[0], width, height);
        showResult(zip, `${baseName}-frames.zip`, "frames", preview, `Done. Transparent result: ${frames.length} PNG frames in a ZIP. The first frame is shown below.`);
      } else {
        const recorded = await recordFramesAsVideo(frames, blurs, width, height, background, currentJob, audio);
        showResult(recorded.blob, `${baseName}-chrubg.${recorded.mimeType.includes("mp4") ? "mp4" : "webm"}`, "video");
      }
    }
  } catch (error) {
    jobPanel.hidden = true;
    trimPanel.hidden = false;
    showNotice(currentJob.cancelled ? "Cancelled." : error.message || "This video could not be processed.");
  } finally {
    if (audio) audio.stop();
  }
}

function saveResult() {
  const link = Object.assign(document.createElement("a"), { href: resultUrl, download: resultFileName });
  link.click();
}

/* ---------- Wiring ---------- */

dropzone.addEventListener("click", () => fileInput.click());
fileInput.addEventListener("change", () => {
  prepareVideo(fileInput.files[0]);
  fileInput.value = "";
});
engineSelect.addEventListener("change", showEngineChoices);
outputSelect.addEventListener("change", updateOutputControls);
backgroundTypeSelect.addEventListener("change", updateOutputControls);
backgroundImageButton.addEventListener("click", () => backgroundImageInput.click());
backgroundImageInput.addEventListener("change", () => {
  backgroundImageFile = backgroundImageInput.files[0] || backgroundImageFile;
  backgroundImageInput.value = "";
  updateOutputControls();
});
cancelButton.addEventListener("click", () => {
  currentJob.cancelled = true;
  currentJob.abortController.abort();
});
downloadButton.addEventListener("click", saveResult);
restartButton.addEventListener("click", () => {
  clearPreviousResult();
  jobPanel.hidden = true;
  trimPanel.hidden = !pendingVideo; // back to the same clip, so the settings can be changed and run again
});
document.getElementById("video-process").addEventListener("click", startProcessing);
document.getElementById("video-trim-cancel").addEventListener("click", forgetPendingVideo);
[startInput, endInput].forEach((input) => input.addEventListener("input", () => {
  updateTrimInfo();
  maybeShowVideoHint();
}));
document.getElementById("video-set-start").addEventListener("click", () => {
  startInput.value = previewVideo.currentTime.toFixed(1);
  updateTrimInfo();
});
document.getElementById("video-set-end").addEventListener("click", () => {
  endInput.value = previewVideo.currentTime.toFixed(1);
  updateTrimInfo();
  maybeShowVideoHint();
});
document.getElementById("device-hint-switch").addEventListener("click", () => {
  engineSelect.value = "local";
  showEngineChoices();
  videoHintBox.hidden = true;
});
document.getElementById("device-hint-dismiss").addEventListener("click", () => (videoHintBox.hidden = true));
document.getElementById("device-hint-never").addEventListener("click", () => {
  dismissHintForGood("video-browser");
  videoHintBox.hidden = true;
});

window.addEventListener("dragover", (event) => event.preventDefault());
window.addEventListener("drop", (event) => {
  event.preventDefault();
  if (!dropzone.disabled) prepareVideo(event.dataTransfer.files[0]);
});

startUp();
