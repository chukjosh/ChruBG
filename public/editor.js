// Touch up editor: paint over a cutout to erase leftovers or restore parts removed by mistake.
// Edits change the mask only, so the full resolution download picks them up too.

const editorDialog = document.getElementById("editor-dialog");
const editorCanvas = document.getElementById("editor-canvas");
const brushSizeSlider = document.getElementById("brush-size");
const MAXIMUM_UNDO_STEPS = 15;
const REMOVED_AREA_GHOST_OPACITY = 0.25;

let editorState = null;

function createCanvas(width, height) {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

async function openEditor(item) {
  const [photoBitmap, cutoutBitmap] = await Promise.all([
    createImageBitmap(item.jpegBlob),
    createImageBitmap(item.cutoutBlob),
  ]);
  const maskCanvas = createCanvas(photoBitmap.width, photoBitmap.height);
  const maskContext = maskCanvas.getContext("2d", { willReadFrequently: true });
  maskContext.drawImage(cutoutBitmap, 0, 0, photoBitmap.width, photoBitmap.height);

  editorCanvas.width = photoBitmap.width;
  editorCanvas.height = photoBitmap.height;
  editorState = {
    item,
    photoBitmap,
    maskCanvas,
    maskContext,
    subjectCanvas: createCanvas(photoBitmap.width, photoBitmap.height),
    originalMask: maskContext.getImageData(0, 0, photoBitmap.width, photoBitmap.height),
    undoSnapshots: [],
    lastPoint: null,
  };
  drawEditorView();
  editorDialog.showModal();
}

function drawEditorView() {
  const { photoBitmap, maskCanvas, subjectCanvas } = editorState;
  const subjectContext = subjectCanvas.getContext("2d");
  subjectContext.globalCompositeOperation = "source-over";
  subjectContext.clearRect(0, 0, subjectCanvas.width, subjectCanvas.height);
  subjectContext.drawImage(photoBitmap, 0, 0);
  subjectContext.globalCompositeOperation = "destination-in";
  subjectContext.drawImage(maskCanvas, 0, 0);

  const viewContext = editorCanvas.getContext("2d");
  viewContext.clearRect(0, 0, editorCanvas.width, editorCanvas.height);
  viewContext.globalAlpha = REMOVED_AREA_GHOST_OPACITY; // removed parts show faded so they are easy to restore
  viewContext.drawImage(photoBitmap, 0, 0);
  viewContext.globalAlpha = 1;
  viewContext.drawImage(subjectCanvas, 0, 0);
}

function getCanvasPoint(event) {
  const bounds = editorCanvas.getBoundingClientRect();
  const scale = editorCanvas.width / bounds.width;
  return { x: (event.clientX - bounds.left) * scale, y: (event.clientY - bounds.top) * scale, scale };
}

function saveUndoSnapshot() {
  const { maskContext, maskCanvas, undoSnapshots } = editorState;
  undoSnapshots.push(maskContext.getImageData(0, 0, maskCanvas.width, maskCanvas.height));
  if (undoSnapshots.length > MAXIMUM_UNDO_STEPS) undoSnapshots.shift();
}

function paintStroke(fromPoint, toPoint) {
  const { maskContext } = editorState;
  const isErasing = document.querySelector('input[name="brush-mode"]:checked').value === "erase";
  maskContext.globalCompositeOperation = isErasing ? "destination-out" : "source-over";
  maskContext.strokeStyle = "#000";
  maskContext.lineWidth = Number(brushSizeSlider.value) * toPoint.scale;
  maskContext.lineCap = "round";
  maskContext.lineJoin = "round";
  maskContext.beginPath();
  maskContext.moveTo(fromPoint.x, fromPoint.y);
  maskContext.lineTo(toPoint.x + 0.01, toPoint.y);
  maskContext.stroke();
  drawEditorView();
}

function undoLastStroke() {
  if (!editorState || editorState.undoSnapshots.length === 0) return;
  editorState.maskContext.putImageData(editorState.undoSnapshots.pop(), 0, 0);
  drawEditorView();
}

async function applyEditorChanges() {
  const { item, photoBitmap, maskCanvas } = editorState;
  if (!item.wasRemoved) {
    const resultCanvas = createCanvas(photoBitmap.width, photoBitmap.height);
    const resultContext = resultCanvas.getContext("2d");
    resultContext.drawImage(photoBitmap, 0, 0);
    resultContext.globalCompositeOperation = "destination-in";
    resultContext.drawImage(maskCanvas, 0, 0);

    const editedBlob = await new Promise((resolve) => resultCanvas.toBlob(resolve, "image/png"));
    if (item.cutoutUrl) URL.revokeObjectURL(item.cutoutUrl);
    item.cutoutBlob = editedBlob;
    item.cutoutUrl = URL.createObjectURL(editedBlob);
    updateCard(item);
  }
  editorDialog.close();
}

editorCanvas.addEventListener("pointerdown", (event) => {
  editorCanvas.setPointerCapture(event.pointerId);
  saveUndoSnapshot();
  editorState.lastPoint = getCanvasPoint(event);
  paintStroke(editorState.lastPoint, editorState.lastPoint);
});
editorCanvas.addEventListener("pointermove", (event) => {
  if (!editorState || !editorState.lastPoint) return;
  const currentPoint = getCanvasPoint(event);
  paintStroke(editorState.lastPoint, currentPoint);
  editorState.lastPoint = currentPoint;
});
["pointerup", "pointercancel"].forEach((eventName) =>
  editorCanvas.addEventListener(eventName, () => editorState && (editorState.lastPoint = null))
);

document.getElementById("editor-undo").addEventListener("click", undoLastStroke);
document.getElementById("editor-reset").addEventListener("click", () => {
  saveUndoSnapshot();
  editorState.maskContext.putImageData(editorState.originalMask, 0, 0);
  drawEditorView();
});
document.getElementById("editor-done").addEventListener("click", applyEditorChanges);
document.getElementById("editor-cancel").addEventListener("click", () => editorDialog.close());
editorDialog.addEventListener("close", () => (editorState = null));
editorDialog.addEventListener("keydown", (event) => {
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "z") {
    event.preventDefault();
    undoLastStroke();
  }
});
