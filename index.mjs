#!/usr/bin/env node
/**
 * Stdio MCP → readfetch.com/mcp with automatic x402 payment on 402.
 *
 * Env:
 *   EVM_PRIVATE_KEY or X402_BUYER_KEY — hex key with USDC on Base (required before first paid tools/call)
 *   READFETCH_MCP_URL — default https://readfetch.com/mcp (https, path /mcp, readfetch.com / www only, or localhost with READFETCH_DEV=1)
 *   READFETCH_MAX_PAYMENT_USD — spend cap per authorization, 0–100 (default 1)
 *   READFETCH_EXPECTED_PAYTO — optional; default readfetch catalog payee when upstream is production readfetch.com
 *   READFETCH_DEV=1 — required to use http(s)://localhost / 127.0.0.1 / [::1]; also enables Sepolia (eip155:84532) for that upstream only
 *
 * tools/list → POST /mcp (JSON-RPC). tools/call → POST /v1/{endpoint} on the same origin so HTTP 402 triggers x402 payment.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { wrapFetchWithPaymentFromConfig } from "@x402/fetch";
import { ExactEvmScheme } from "@x402/evm";
import { isHex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import {
  ALLOWED_RPC_METHODS,
  filterCatalogTools,
  isDevHost,
  resolveUpstreamUrl,
  restUrlForTool,
  sanitizeErrorMessage,
  validateToolName,
} from "./url-policy.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(
  readFileSync(join(__dirname, "package.json"), "utf8"),
);
const PACKAGE_VERSION = pkg.version;

const ACCEPT = "application/json, text/event-stream";
const UPSTREAM_TIMEOUT_MS = 120_000;
const MAX_UPSTREAM_BODY_BYTES = 10 * 1024 * 1024;
const MAX_RPC_REQUEST_BYTES = 1024 * 1024;
const DEFAULT_PAYTO = "0x26C2308aDC8fe5FFE6d4183588DD2DD22ed86071";
const MISSING_KEY =
  "readfetch MCP: set EVM_PRIVATE_KEY (or X402_BUYER_KEY) in the MCP server env — a Base wallet with USDC. " +
  "The proxy signs x402 payments on your behalf when a tool call returns 402.";

function assertNoRedirect(response, expectedUrl) {
  if (response.status >= 300 && response.status < 400) {
    throw new Error(
      `upstream redirect not allowed (HTTP ${response.status}); use the canonical MCP URL`,
    );
  }
  const expected = new URL(expectedUrl);
  const final = new URL(response.url || expectedUrl);
  if (final.origin !== expected.origin) {
    throw new Error(
      `upstream response origin mismatch (expected ${expected.origin}, got ${final.origin})`,
    );
  }
}

async function readResponseTextLimited(response, maxBytes) {
  const contentLength = response.headers.get("content-length");
  if (contentLength !== null) {
    const n = Number(contentLength);
    if (!Number.isFinite(n) || n < 0) {
      throw new Error("upstream Content-Length header is invalid");
    }
    if (n > maxBytes) {
      throw new Error(
        `upstream Content-Length ${n} exceeds limit (${maxBytes} bytes)`,
      );
    }
  }
  if (!response.body) {
    const text = await response.text();
    if (Buffer.byteLength(text, "utf8") > maxBytes) {
      throw new Error(`upstream response too large (>${maxBytes} bytes)`);
    }
    return text;
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let total = 0;
  let text = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel();
        throw new Error(`upstream response too large (>${maxBytes} bytes)`);
      }
      text += decoder.decode(value, { stream: true });
    }
    text += decoder.decode();
    return text;
  } finally {
    reader.releaseLock();
  }
}

function parseMaxPaymentUsd() {
  const raw = process.env.READFETCH_MAX_PAYMENT_USD?.trim() || "1";
  if (!/^\d+(\.\d{1,6})?$/.test(raw)) {
    throw new Error(
      "READFETCH_MAX_PAYMENT_USD must be a decimal amount (e.g. 1 or 0.05)",
    );
  }
  const amount = Number(raw);
  if (!Number.isFinite(amount) || amount <= 0 || amount > 100) {
    throw new Error(
      "READFETCH_MAX_PAYMENT_USD must be greater than 0 and at most 100",
    );
  }
  return raw;
}

function parsePrivateKeyHex() {
  const raw =
    process.env.EVM_PRIVATE_KEY?.trim() ||
    process.env.X402_BUYER_KEY?.trim() ||
    "";
  if (!raw) {
    throw new Error(MISSING_KEY);
  }
  const hex = raw.startsWith("0x") ? raw : `0x${raw}`;
  if (!isHex(hex) || hex.length !== 66) {
    throw new Error(
      "EVM_PRIVATE_KEY must be 32 bytes of hex (64 characters, optional 0x prefix)",
    );
  }
  return privateKeyToAccount(hex);
}

function expectedPayTo() {
  const raw = process.env.READFETCH_EXPECTED_PAYTO?.trim() || DEFAULT_PAYTO;
  if (!/^0x[0-9a-fA-F]{40}$/.test(raw)) {
    throw new Error(
      "READFETCH_EXPECTED_PAYTO must be a 20-byte hex address (0x + 40 hex digits)",
    );
  }
  return raw.toLowerCase();
}

function payToMatchesReadfetch(_version, requirements) {
  if (upstreamIsDevHost) {
    return requirements;
  }
  const payTo = expectedPayTo();
  const filtered = requirements.filter((req) => {
    const candidate = String(req.payTo ?? "").toLowerCase();
    return candidate === payTo;
  });
  if (filtered.length === 0 && requirements.length > 0) {
    throw new Error(
      "payment requirements payTo does not match READFETCH_EXPECTED_PAYTO",
    );
  }
  return filtered;
}

function paymentSchemes(account) {
  const schemes = [
    { network: "eip155:8453", client: new ExactEvmScheme(account) },
  ];
  if (upstreamIsDevHost && process.env.READFETCH_DEV === "1") {
    schemes.push({
      network: "eip155:84532",
      client: new ExactEvmScheme(account),
    });
  }
  return schemes;
}

/** @param {RequestInfo | URL} input @param {RequestInit} [init] */
function fetchNoRedirect(input, init) {
  return fetch(input, { ...init, redirect: "manual" });
}

let upstreamUrl;
/** @type {boolean} */
let upstreamIsDevHost = false;
let fetchWithPayment;
/** @type {Promise<typeof fetchWithPayment> | null} */
let clientInit = null;

function resolveUpstreamContext() {
  if (upstreamUrl) {
    return;
  }
  upstreamUrl = resolveUpstreamUrl(process.env);
  upstreamIsDevHost = isDevHost(new URL(upstreamUrl).hostname);
}

async function ensurePaidFetch() {
  resolveUpstreamContext();
  if (fetchWithPayment) {
    return fetchWithPayment;
  }
  if (!clientInit) {
    clientInit = (async () => {
      try {
        const account = parsePrivateKeyHex();
        const maxUsd = parseMaxPaymentUsd();
        if (!upstreamIsDevHost) {
          expectedPayTo();
        }
        fetchWithPayment = wrapFetchWithPaymentFromConfig(fetchNoRedirect, {
          schemes: paymentSchemes(account),
          spendControls: { maxAmountPerPayment: `$${maxUsd}` },
          policies: [payToMatchesReadfetch],
        });
        return fetchWithPayment;
      } catch (err) {
        clientInit = null;
        throw err;
      }
    })();
  }
  return clientInit;
}

let rpcId = 1;

function assertRpcEnvelope(body, id) {
  if (body?.jsonrpc !== "2.0") {
    throw new Error("upstream JSON-RPC version mismatch");
  }
  if (body.id !== id) {
    throw new Error("upstream JSON-RPC id mismatch");
  }
}

function assertPlainObject(value, label) {
  if (
    value === null ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.getPrototypeOf(value) !== Object.prototype
  ) {
    throw new Error(`${label} must be a JSON object`);
  }
}

async function upstream(method, params) {
  if (!ALLOWED_RPC_METHODS.has(method)) {
    throw new Error("internal RPC method not allowed");
  }
  const id = rpcId++;
  const payload = { jsonrpc: "2.0", id, method };
  if (params !== undefined) {
    assertPlainObject(params, "RPC params");
    payload.params = params;
  }

  const body = JSON.stringify(payload);
  if (Buffer.byteLength(body, "utf8") > MAX_RPC_REQUEST_BYTES) {
    throw new Error(
      `upstream RPC request too large (max ${MAX_RPC_REQUEST_BYTES} bytes)`,
    );
  }

  resolveUpstreamContext();
  const response = await fetchNoRedirect(upstreamUrl, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: ACCEPT,
    },
    body,
    redirect: "manual",
    signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
  });

  assertNoRedirect(response, upstreamUrl);

  if (response.status === 402) {
    throw new Error(
      "upstream returned 402 after payment attempt (wallet USDC on Base, spend cap, or payTo mismatch)",
    );
  }
  if (response.status !== 200) {
    throw new Error(`upstream HTTP ${response.status}`);
  }

  const text = await readResponseTextLimited(response, MAX_UPSTREAM_BODY_BYTES);
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error(
      `upstream returned non-JSON (HTTP ${response.status}, ${text.length} bytes)`,
    );
  }
  assertRpcEnvelope(parsed, id);
  if (parsed.error) {
    throw new Error(
      sanitizeErrorMessage(
        parsed.error.message || JSON.stringify(parsed.error),
      ),
    );
  }
  if (parsed.result === undefined || parsed.result === null) {
    throw new Error(
      `upstream JSON-RPC response missing result (HTTP ${response.status})`,
    );
  }
  return parsed.result;
}

async function upstreamRestTool(toolName, args) {
  const paid = await ensurePaidFetch();
  const restUrl = restUrlForTool(new URL(upstreamUrl).origin, toolName);

  const body = JSON.stringify(args);
  if (Buffer.byteLength(body, "utf8") > MAX_RPC_REQUEST_BYTES) {
    throw new Error(
      `tool request too large (max ${MAX_RPC_REQUEST_BYTES} bytes)`,
    );
  }

  const response = await paid(restUrl, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json",
    },
    body,
    redirect: "manual",
    signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
  });

  assertNoRedirect(response, restUrl);

  if (response.status === 402) {
    throw new Error(
      "upstream returned 402 after payment attempt (wallet USDC on Base, spend cap, or payTo mismatch)",
    );
  }

  const text = await readResponseTextLimited(response, MAX_UPSTREAM_BODY_BYTES);
  let structured;
  try {
    structured = JSON.parse(text);
  } catch {
    throw new Error(
      `upstream returned non-JSON (HTTP ${response.status}, ${text.length} bytes)`,
    );
  }

  const isError = response.status >= 400;
  const meta = {};
  const receipt = response.headers.get("RECEIPT");
  if (receipt) {
    meta.receipt = receipt;
  }
  const paymentResponse =
    response.headers.get("PAYMENT-RESPONSE") ||
    response.headers.get("X-PAYMENT-RESPONSE");
  if (paymentResponse) {
    meta.payment_response = paymentResponse;
  }

  return {
    content: [{ type: "text", text }],
    structuredContent: structured,
    isError,
    _meta: meta,
  };
}

const server = new Server(
  { name: "readfetch-x402", version: PACKAGE_VERSION },
  { capabilities: { tools: {} } },
);

server.setRequestHandler(ListToolsRequestSchema, async () => {
  const result = await upstream("tools/list", {});
  const tools = filterCatalogTools(result.tools);
  if (Array.isArray(result.tools) && result.tools.length > 0 && tools.length === 0) {
    throw new Error(
      "upstream tools/list returned no recognized readfetch catalog tools",
    );
  }
  return { tools };
});

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  validateToolName(request.params.name);
  const args = request.params.arguments ?? {};
  assertPlainObject(args, "tool arguments");
  // MCP /mcp returns HTTP 200 with 402 embedded; @x402/fetch needs real HTTP 402 on REST.
  return upstreamRestTool(request.params.name, args);
});

const transport = new StdioServerTransport();
try {
  await server.connect(transport);
} catch (err) {
  const msg = sanitizeErrorMessage(
    err instanceof Error ? err.message : String(err),
  );
  console.error(`readfetch MCP proxy failed to start: ${msg}`);
  process.exit(1);
}
