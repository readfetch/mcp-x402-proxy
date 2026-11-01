import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { CATALOG_ENDPOINTS, INTEGRATOR_ENDPOINTS } from "./endpoints.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");
const catalogPath = join(root, "catalog.json");

try {
  const catalog = JSON.parse(readFileSync(catalogPath, "utf8"));
  const published = catalog.endpoints.filter((e) => e.published);
  assert.equal(
    CATALOG_ENDPOINTS.length,
    published.length,
    "mcp-x402-proxy CATALOG_ENDPOINTS out of sync with catalog.json",
  );
  for (const spec of published) {
    const ours = CATALOG_ENDPOINTS.find((e) => e.name === spec.name);
    assert.ok(ours, `missing ${spec.name}`);
    assert.equal(ours.path, spec.path);
    assert.equal(ours.method, spec.method || "POST");
    assert.equal(ours.free, Boolean(spec.free));
  }
  assert.equal(INTEGRATOR_ENDPOINTS.length, 2);
} catch (error) {
  if (error.code !== "ENOENT") throw error;
  console.log("mcp-x402-proxy: catalog sync skipped (no catalog.json)");
}

console.log("mcp-x402-proxy: catalog ok");
