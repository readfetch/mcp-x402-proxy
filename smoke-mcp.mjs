#!/usr/bin/env node
/**
 * Local smoke: stdio MCP client → proxy → readfetch.com/mcp, one tool call.
 * Uses ~/.readfetch-buyer.key or EVM_PRIVATE_KEY (key is never printed).
 *
 * Env:
 *   SMOKE_TOOL — default readfetch_probe; e.g. readfetch_text (paid, needs Base USDC)
 *   SMOKE_PROBE_URL — default https://example.com/
 */
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { TOOL_NAME_RE, endpointSpecForTool, validateToolName } from "./url-policy.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SMOKE_URL = process.env.SMOKE_PROBE_URL?.trim() || "https://example.com/";
const SMOKE_TOOL =
  process.env.SMOKE_TOOL?.trim() || "readfetch_probe";

function loadBuyerKey() {
  const fromEnv =
    process.env.EVM_PRIVATE_KEY?.trim() ||
    process.env.X402_BUYER_KEY?.trim() ||
    "";
  if (fromEnv) {
    return fromEnv.startsWith("0x") ? fromEnv : `0x${fromEnv}`;
  }
  const path = join(homedir(), ".readfetch-buyer.key");
  const raw = readFileSync(path, "utf8").trim();
  return raw.startsWith("0x") ? raw : `0x${raw}`;
}

validateToolName(SMOKE_TOOL);

const needsKey = !endpointSpecForTool(SMOKE_TOOL).free;
const key = needsKey ? loadBuyerKey() : "";
const transport = new StdioClientTransport({
  command: process.execPath,
  args: [join(__dirname, "index.mjs")],
  cwd: __dirname,
  env: {
    ...(needsKey ? { EVM_PRIVATE_KEY: key } : {}),
    ...(process.env.READFETCH_MAX_PAYMENT_USD?.trim()
      ? { READFETCH_MAX_PAYMENT_USD: process.env.READFETCH_MAX_PAYMENT_USD.trim() }
      : {}),
    READFETCH_MCP_URL:
      process.env.READFETCH_MCP_URL?.trim() || "https://readfetch.com/mcp",
  },
  stderr: "pipe",
});

const client = new Client({ name: "smoke", version: "0.0.0" });

try {
  await client.connect(transport);
  const tools = await client.listTools();
  const names = tools.tools.map((t) => t.name);
  if (!names.includes(SMOKE_TOOL)) {
    throw new Error(
      `${SMOKE_TOOL} missing; got: ${names.slice(0, 8).join(", ")}…`,
    );
  }
  const result = await client.callTool({
    name: SMOKE_TOOL,
    arguments: { url: SMOKE_URL },
  });
  const text = (result.content ?? [])
    .filter((c) => c.type === "text")
    .map((c) => c.text)
    .join("\n");
  console.log(`smoke ok: ${SMOKE_TOOL}`);
  console.log(text.slice(0, 1200) || JSON.stringify(result).slice(0, 1200));
  if (result.isError) {
    process.exitCode = 1;
    console.error("tool returned isError=true");
  } else {
    const structured = result.structuredContent;
    if (
      structured &&
      typeof structured === "object" &&
      "billed" in structured
    ) {
      console.log(`billed: ${structured.billed}`);
    } else {
      try {
        const body = JSON.parse(text);
        if (body.billed !== undefined) {
          console.log(`billed: ${body.billed}`);
        }
      } catch {
        /* non-JSON snippet */
      }
    }
  }
} catch (err) {
  console.error("smoke failed:", err instanceof Error ? err.message : err);
  process.exitCode = 1;
} finally {
  await client.close().catch(() => {});
}
