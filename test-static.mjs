/**
 * Static checks for URL policy (no network, no keys). Run: node test-static.mjs
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  TOOL_NAME_RE,
  filterCatalogTools,
  isProductionHost,
  redactUrlForError,
  resolveUpstreamUrl,
  restPathForTool,
  restUrlForTool,
  endpointSpecForTool,
  sanitizeErrorMessage,
  validateToolName,
} from "./url-policy.mjs";

assert.equal(resolveUpstreamUrl({}), "https://readfetch.com/mcp");
assert.throws(() =>
  resolveUpstreamUrl({ READFETCH_MCP_URL: "http://readfetch.com/mcp" }),
);
assert.throws(() =>
  resolveUpstreamUrl({ READFETCH_MCP_URL: "https://evil.com/mcp" }),
);
assert.equal(
  resolveUpstreamUrl({
    READFETCH_DEV: "1",
    READFETCH_MCP_URL: "http://127.0.0.1:8080/mcp",
  }),
  "http://127.0.0.1:8080/mcp",
);
assert.equal(
  resolveUpstreamUrl({
    READFETCH_DEV: "1",
    READFETCH_MCP_URL: "https://readfetch.com/mcp",
  }),
  "https://readfetch.com/mcp",
);
assert.throws(() =>
  resolveUpstreamUrl({ READFETCH_MCP_URL: "file:///etc/passwd" }),
);
assert.ok(isProductionHost("readfetch.com."));
assert.throws(() =>
  resolveUpstreamUrl({
    READFETCH_MCP_URL: "https://user:pass@readfetch.com/mcp",
  }),
);
assert.throws(() =>
  resolveUpstreamUrl({ READFETCH_MCP_URL: "https://readfetch.com/v1/text" }),
);

assert.ok(TOOL_NAME_RE.test("readfetch_probe"));
assert.ok(TOOL_NAME_RE.test("readfetch_crawl_status"));
assert.ok(!TOOL_NAME_RE.test("readfetch_"));
assert.throws(() => validateToolName("other_tool"));

const filtered = filterCatalogTools([
  { name: "readfetch_text" },
  { name: "evil_tool" },
  null,
]);
assert.equal(filtered.length, 1);
assert.equal(filtered[0].name, "readfetch_text");

assert.equal(sanitizeErrorMessage("ok"), "ok");
assert.equal(sanitizeErrorMessage("a\x07b"), "ab");
assert.equal(
  redactUrlForError("https://readfetch.com/mcp?token=secret"),
  "readfetch.com/mcp",
);

assert.equal(restPathForTool("readfetch_text"), "/v1/text");
assert.equal(
  restPathForTool("readfetch_crawl_status", { id: "job_ab12" }),
  "/v1/crawl/job_ab12",
);
assert.equal(
  restUrlForTool("https://readfetch.com/mcp", "readfetch_text"),
  "https://readfetch.com/v1/text",
);
assert.throws(() => restPathForTool("readfetch_crawl_status", {}));
assert.equal(endpointSpecForTool("readfetch_probe").free, true);
assert.equal(endpointSpecForTool("readfetch_text").free, false);

const proxy = readFileSync(new URL("./index.mjs", import.meta.url), "utf8");
assert.match(proxy, /instructions: INSTRUCTIONS/);
assert.match(proxy, /readfetch-mcp-x402-proxy\/\$\{PACKAGE_VERSION\}/);
assert.match(proxy, /async function upstreamRestTool\(toolName, args\) \{\n  resolveUpstreamContext\(\)/);

const smoke = readFileSync(new URL("./smoke-mcp.mjs", import.meta.url), "utf8");
assert.match(smoke, /READFETCH_MAX_PAYMENT_USD/);

console.log("test-static.mjs: ok");

// No-wallet fallback: an installed proxy with no key answers a page-read tool from the free
// probe instead of failing with an error about EVM_PRIVATE_KEY.
import { shouldUseFreeProbe } from "./url-policy.mjs";

assert.equal(shouldUseFreeProbe("readfetch_text", {}), true);
assert.equal(shouldUseFreeProbe("readfetch_scrape", {}), true);
assert.equal(shouldUseFreeProbe("readfetch_section", {}), true);
assert.equal(shouldUseFreeProbe("readfetch_diff", {}), true);
// Probe cannot stand in for these.
assert.equal(shouldUseFreeProbe("readfetch_screenshot", {}), false);
assert.equal(shouldUseFreeProbe("readfetch_pdf", {}), false);
assert.equal(shouldUseFreeProbe("readfetch_batch", {}), false);
assert.equal(shouldUseFreeProbe("readfetch_crawl", {}), false);
assert.equal(shouldUseFreeProbe("readfetch_fetch", {}), false);
// A configured key — either env name — means the paid route runs.
assert.equal(shouldUseFreeProbe("readfetch_text", { EVM_PRIVATE_KEY: "ab" }), false);
assert.equal(shouldUseFreeProbe("readfetch_text", { X402_BUYER_KEY: "ab" }), false);
// Whitespace is not a configured key.
assert.equal(shouldUseFreeProbe("readfetch_text", { EVM_PRIVATE_KEY: "  " }), true);
console.log("test-static.mjs: free-probe fallback ok");
