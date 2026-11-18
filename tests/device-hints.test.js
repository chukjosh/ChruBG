const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const hints = {};
vm.createContext(hints);
vm.runInContext(fs.readFileSync(path.join(__dirname, "..", "public", "device-hints.js"), "utf8"), hints);

const phone = { isTouchDevice: true, deviceMemory: 8, hardwareConcurrency: 8, hasWebGpu: true };

test("desktops and laptops are never flagged, even with weak hardware", () => {
  assert.strictEqual(hints.deviceLooksSlow({ isTouchDevice: false, deviceMemory: 2, hardwareConcurrency: 2, hasWebGpu: false }), false);
});

test("a capable phone is not flagged", () => {
  assert.strictEqual(hints.deviceLooksSlow(phone), false);
});

test("a phone with little memory is flagged", () => {
  assert.strictEqual(hints.deviceLooksSlow({ ...phone, deviceMemory: 4 }), true);
});

test("a phone with few processor cores is flagged", () => {
  assert.strictEqual(hints.deviceLooksSlow({ ...phone, hardwareConcurrency: 4 }), true);
});

test("a phone without graphics acceleration is flagged", () => {
  assert.strictEqual(hints.deviceLooksSlow({ ...phone, hasWebGpu: false }), true);
});

test("browsers that do not report memory or cores are not flagged on that basis alone", () => {
  assert.strictEqual(hints.deviceLooksSlow({ isTouchDevice: true, deviceMemory: undefined, hardwareConcurrency: undefined, hasWebGpu: true }), false);
});
