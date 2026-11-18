const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const edges = {};
vm.createContext(edges);
vm.runInContext(fs.readFileSync(path.join(__dirname, "..", "public", "edges.js"), "utf8"), edges);

function makeAlpha(width, height, filledPixels) {
  const alpha = new Uint8ClampedArray(width * height);
  filledPixels.forEach(([x, y]) => (alpha[y * width + x] = 255));
  return alpha;
}
const countFilled = (alpha) => alpha.filter((value) => value === 255).length;

test("zero shift and zero feather leave the mask unchanged", () => {
  const alpha = makeAlpha(9, 9, [[4, 4]]);
  assert.deepStrictEqual(Array.from(edges.adjustEdge(alpha, 9, 9, 0, 0)), Array.from(alpha));
});

test("a positive shift grows a single pixel into a 3 by 3 block", () => {
  const grown = edges.adjustEdge(makeAlpha(9, 9, [[4, 4]]), 9, 9, 1, 0);
  assert.strictEqual(countFilled(grown), 9);
});

test("a negative shift shrinks a 3 by 3 block back to one pixel", () => {
  const block = makeAlpha(9, 9, [[3, 3], [4, 3], [5, 3], [3, 4], [4, 4], [5, 4], [3, 5], [4, 5], [5, 5]]);
  const shrunk = edges.adjustEdge(block, 9, 9, -1, 0);
  assert.strictEqual(countFilled(shrunk), 1);
  assert.strictEqual(shrunk[4 * 9 + 4], 255);
});

test("feathering spreads the edge into soft values and stays inside 0 to 255", () => {
  const soft = edges.adjustEdge(makeAlpha(15, 15, [[7, 7]]), 15, 15, 0, 4);
  assert.ok(soft[7 * 15 + 7] < 255, "the centre should lose strength");
  assert.ok(soft[7 * 15 + 9] > 0, "neighbours should gain some strength");
  assert.ok(Array.from(soft).every((value) => value >= 0 && value <= 255));
});

test("the input array is never modified", () => {
  const alpha = makeAlpha(9, 9, [[4, 4]]);
  const copy = Array.from(alpha);
  edges.adjustEdge(alpha, 9, 9, 2, 3);
  assert.deepStrictEqual(Array.from(alpha), copy);
});
