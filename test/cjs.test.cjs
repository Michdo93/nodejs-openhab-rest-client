// CommonJS build: same exports as the ES module.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const cjs = require("../dist/cjs/index.js");

test("require() exposes all classes and SSE helpers", async () => {
  const esm = await import("../dist/esm/index.js");
  assert.deepEqual(Object.keys(cjs).sort(), Object.keys(esm).sort());
  for (const name of ["OpenHABClient", "Items", "ItemEvents", "Persistence", "iterSSEEvents", "OpenHABHTTPError"]) {
    assert.equal(typeof cjs[name], "function", name);
  }
});
