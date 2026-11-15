const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const cropMath = {};
vm.createContext(cropMath);
vm.runInContext(fs.readFileSync(path.join(__dirname, "..", "public", "crop-math.js"), "utf8"), cropMath);

const squareCrop = { outputWidth: 1, outputHeight: 1, centerX: 0.5, centerY: 0.5, zoom: 1 };

test("zoom 1 gives the largest frame that fits inside the image", () => {
  const frame = cropMath.getFrameInSource(squareCrop, 1000, 500);
  assert.deepStrictEqual([frame.left, frame.top, frame.width, frame.height], [250, 0, 500, 500]);
});

test("zooming in makes the frame smaller and zooming out makes it larger", () => {
  assert.strictEqual(cropMath.getFrameInSource({ ...squareCrop, zoom: 2 }, 1000, 500).width, 250);
  assert.strictEqual(cropMath.getFrameInSource({ ...squareCrop, zoom: 0.5 }, 1000, 500).width, 1000);
});

test("auto framing centres on the subject and fits it with padding", () => {
  const bounds = { left: 400, top: 100, right: 600, bottom: 400 };
  const framing = cropMath.getAutoFraming(bounds, 1000, 500, 1, 1);
  assert.strictEqual(framing.centerX, 0.5);
  assert.strictEqual(framing.centerY, 0.5);
  assert.ok(Math.abs(framing.zoom - 500 / (300 * 1.16)) < 0.0001);
});

test("auto framing falls back to the centre when there is no subject", () => {
  assert.deepStrictEqual({ ...cropMath.getAutoFraming(null, 1000, 500, 1, 1) }, { centerX: 0.5, centerY: 0.5, zoom: 1 });
});

test("auto framing never zooms past the limits", () => {
  const tinySubject = { left: 500, top: 250, right: 502, bottom: 252 };
  assert.strictEqual(cropMath.getAutoFraming(tinySubject, 1000, 500, 1, 1).zoom, 4);
});
