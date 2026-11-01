/**
 * Upstream URL and tool-name policy (shared by index.mjs and test-static.mjs).
 */

export const TOOL_NAME_RE = /^readfetch_[a-z0-9_]+$/;
export const ALLOWED_RPC_METHODS = new Set(["tools/list"]);

const ALLOWED_HOSTS = new Set(["readfetch.com", "www.readfetch.com"]);
const DEV_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

export function normalizeHostname(hostname) {
  return hostname.replace(/\.+$/, "").toLowerCase();
}

export function isDevHost(hostname) {
  return DEV_HOSTS.has(normalizeHostname(hostname));
}

export function isProductionHost(hostname) {
  return ALLOWED_HOSTS.has(normalizeHostname(hostname));
}

export function sanitizeErrorMessage(message) {
  const text = typeof message === "string" ? message : String(message);
  return text.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, "");
}

/** Host + path only — never echo query, userinfo, or fragment in errors. */
export function redactUrlForError(urlString) {
  try {
    const url = new URL(urlString);
    return `${url.hostname}${url.pathname}`;
  } catch {
    return "(invalid URL)";
  }
}

/**
 * @param {NodeJS.ProcessEnv} env
 */
export function resolveUpstreamUrl(env) {
  const raw = env.READFETCH_MCP_URL?.trim() || "https://readfetch.com/mcp";
  let url;
  try {
    url = new URL(raw);
  } catch {
    throw new Error("READFETCH_MCP_URL is not a valid URL");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error(
      `READFETCH_MCP_URL must use http or https (got ${url.protocol})`,
    );
  }
  if (url.username || url.password) {
    throw new Error(
      "READFETCH_MCP_URL must not include embedded credentials (user:pass@)",
    );
  }
  if (isProductionHost(url.hostname)) {
    if (url.protocol !== "https:") {
      throw new Error(
        `READFETCH_MCP_URL must use https for ${url.hostname} (got ${url.protocol})`,
      );
    }
    const path = url.pathname.replace(/\/+$/, "") || "/";
    if (path !== "/mcp") {
      throw new Error(
        "READFETCH_MCP_URL for readfetch.com must use path /mcp",
      );
    }
    return url.toString();
  }
  if (env.READFETCH_DEV === "1" && isDevHost(url.hostname)) {
    return url.toString();
  }
  throw new Error(
    `READFETCH_MCP_URL must point at readfetch.com (got ${redactUrlForError(url.toString())}). ` +
      "Use READFETCH_DEV=1 only for localhost testing.",
  );
}

export function validateToolName(name) {
  if (typeof name !== "string" || name.length === 0 || name.length > 128) {
    throw new Error("invalid tool name");
  }
  if (!TOOL_NAME_RE.test(name)) {
    throw new Error("tool name must be a readfetch catalog tool (readfetch_…)");
  }
}

/** Catalog MCP tool → REST path (`readfetch_text` → `/v1/text`). */
export function restPathForTool(toolName) {
  validateToolName(toolName);
  const path = `/v1/${toolName.slice("readfetch_".length)}`;
  if (!/^\/v1\/[a-z0-9_]+$/.test(path)) {
    throw new Error("invalid REST path for tool");
  }
  return path;
}

/** Same origin as MCP upstream; path constrained to catalog `/v1/{name}`. */
export function restUrlForTool(upstreamOrigin, toolName) {
  const path = restPathForTool(toolName);
  const base = new URL(upstreamOrigin);
  const url = new URL(path, base.origin);
  if (url.origin !== base.origin) {
    throw new Error("REST URL must stay on the readfetch upstream origin");
  }
  if (url.pathname !== path) {
    throw new Error("REST URL path must match catalog endpoint");
  }
  return url.toString();
}

/** @param {unknown} tools */
export function filterCatalogTools(tools) {
  if (!Array.isArray(tools)) {
    return [];
  }
  return tools.filter(
    (tool) =>
      tool &&
      typeof tool === "object" &&
      typeof tool.name === "string" &&
      TOOL_NAME_RE.test(tool.name),
  );
}
