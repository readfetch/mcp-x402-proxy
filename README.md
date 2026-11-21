# readfetch MCP + x402 signing proxy

Most MCP hosts (Cursor, Claude Desktop, etc.) cannot attach `PAYMENT-SIGNATURE` on `tools/call`.
This **stdio MCP server** lists tools from `https://readfetch.com/mcp`, executes **`tools/call` against `/v1/{endpoint}`** on the same host (so HTTP **402** triggers [`@x402/fetch`](https://www.npmjs.com/package/@x402/fetch) payment), and signs retries automatically.

## Requirements

- Node.js 20+
- A wallet on **Base mainnet** with a little **USDC** for paid tools (`readfetch_text`, …). **`tools/list` does not load your key**; the first **`tools/call`** does.
- Private key in env — **never commit it**

## Cursor / Claude MCP config

```json
{
  "mcpServers": {
    "readfetch": {
      "command": "npx",
      "args": ["-y", "@readfetch/mcp-x402-proxy@latest"],
      "env": {
        "EVM_PRIVATE_KEY": "0xYOUR_KEY"
      }
    }
  }
}
```

From a checkout:

```json
{
  "mcpServers": {
    "readfetch": {
      "command": "node",
      "args": ["/absolute/path/to/readfetch/tools/mcp-x402-proxy/index.mjs"],
      "env": {
        "EVM_PRIVATE_KEY": "0xYOUR_KEY"
      }
    }
  }
}
```

Optional: `READFETCH_MCP_URL` (default `https://readfetch.com/mcp`; **https** only for `readfetch.com` / `www.readfetch.com`, or `localhost` / `127.0.0.1` / `[::1]` with `READFETCH_DEV=1`). Upstream **redirects are rejected**. `READFETCH_MAX_PAYMENT_USD` (default `1`, max `100`) caps each x402 authorization. On **readfetch.com** upstream, payments must match **`READFETCH_EXPECTED_PAYTO`** (default catalog payee). **`READFETCH_DEV=1`** is only for local MCP URLs and enables Sepolia there — never set it when `READFETCH_MCP_URL` points at production.

**Wallet risk:** any tool the model invokes (`readfetch_crawl`, batch, …) can spend USDC from your key until the wallet is empty (subject to the per-payment cap). Use a dedicated low-balance wallet.

Install from a checkout:

```bash
cd tools/mcp-x402-proxy
npm ci
```

`npm ci` in a **git checkout** uses the committed **`package-lock.json`**. **`npx @readfetch/mcp-x402-proxy`** installs exact dependency versions pinned in `package.json` (npm does not ship the lockfile in the published tarball).

## Local smoke (checkout)

```bash
npm ci && npm test
npm run smoke                                    # readfetch_probe (free)
SMOKE_TOOL=readfetch_text npm run smoke          # paid REST path; needs Base USDC
```


From this directory — **not** the repo root:

```bash
cd tools/mcp-x402-proxy
npm login                    # user must own or belong to npm org @readfetch
npm publish --access public  # first publish of a scoped package
```

Wrong: `npm publish @readfetch/mcp-x402-proxy` from `ReadFetch/` (404 — nothing to publish there).

If the `@readfetch` org does not exist on [npmjs.com](https://www.npmjs.com/), create it or temporarily change `name` in `package.json` to an unscoped name you control.

## Default tool path

1. `readfetch_probe` with `{ "url": "…" }` (free; returns the full extracted text for the first 3 probes per IP per day, a `preview` of ~400 chars after that)
2. `readfetch_text` with the same `url`
3. If probe reports `challenge: true`, use `readfetch_scrape` (then `readfetch_scrape_residential` if needed)

## No wallet yet?

`readfetch_text`, `readfetch_scrape`, `readfetch_section` and `readfetch_diff` **fall back to the free
probe** when neither `EVM_PRIVATE_KEY` nor `X402_BUYER_KEY` is set. The result carries the same
content plus a leading note and `_meta.free_trial: true`, so an installed-but-unfunded host still
gets a page instead of an error about a private key. The fallback does not exist for
`screenshot`, `pdf`, `batch`, `crawl` or `fetch` — a probe cannot produce those — and a *malformed*
key still errors rather than silently downgrading.

## Feedback (integration issues)

After a confusing 402, MCP result, or doc mismatch, call **`readfetch_feedback`** (free — no `EVM_PRIVATE_KEY`) with:

```json
{ "request_id": "<X-Request-Id from that call>", "category": "integration", "message": "…" }
```

Paid delivery disputes use **`POST /v1/claims`**, not feedback. Details: [readfetch.com/docs#feedback](https://readfetch.com/docs#feedback).

## Without this proxy

- **REST:** `awal x402 pay https://readfetch.com/v1/text -d '{"url":"…"}'` or `@x402/fetch` in your app
- **Direct MCP URL:** only works if your host can set payment headers on the HTTP request to `/mcp`

See also [readfetch integrations](https://readfetch.com/integrations) and [SKILL.md](https://readfetch.com/SKILL.md).

**Directory:** Official MCP Registry `com.readfetch/mcp-x402-proxy` · Glama listing steps in [readfetch/readfetch `docs/GLAMA.md`](https://github.com/readfetch/readfetch/blob/main/docs/GLAMA.md) (operator).

## Policies

- Privacy policy — https://readfetch.com/privacy (what one call records, body caps, 30-day body / 400-day call retention, removal route)
- Terms of service — https://readfetch.com/terms (the 402 quote is the contract, delivery-gated billing, no SLA, claim route)

Both are required by the Claude and ChatGPT MCP directories; the Official Registry entry carries the same links in `/.well-known/mcp.json` and `service.json`.
