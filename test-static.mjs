/**
 * Static checks for URL policy (no network, no keys). Run: node test-static.mjs
 */
import assert from "node:assert/strict";
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

console.log("test-static.mjs: ok");
