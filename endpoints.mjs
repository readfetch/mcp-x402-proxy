/** Published routes — keep in sync with `catalog.json` (published + integrator). */

/** @typedef {{ name: string, method: string, path: string, free: boolean, accept?: number[] }} EndpointSpec */

/** Max length for `{id}` and other path param substitutions. */
export const MAX_PATH_PARAM_LEN = 512;

/** @type {EndpointSpec[]} */
export const CATALOG_ENDPOINTS = [
  { name: "text", method: "POST", path: "/v1/text", free: false },
  { name: "map", method: "POST", path: "/v1/map", free: false },
  { name: "scrape", method: "POST", path: "/v1/scrape", free: false },
  { name: "residential", method: "POST", path: "/v1/scrape/residential", free: false },
  { name: "fetch", method: "POST", path: "/v1/fetch", free: false },
  { name: "batch", method: "POST", path: "/v1/batch", free: false },
  { name: "pdf", method: "POST", path: "/v1/pdf", free: false },
  { name: "section", method: "POST", path: "/v1/section", free: false },
  { name: "diff", method: "POST", path: "/v1/diff", free: false },
  { name: "screenshot", method: "POST", path: "/v1/screenshot", free: false },
  { name: "search", method: "POST", path: "/v1/search", free: false },
  { name: "crawl", method: "POST", path: "/v1/crawl", free: false },
  { name: "crawl_status", method: "GET", path: "/v1/crawl/{id}", free: true },
  { name: "probe", method: "POST", path: "/v1/probe", free: true },
];

/** @type {EndpointSpec[]} */
export const INTEGRATOR_ENDPOINTS = [
  { name: "feedback", method: "POST", path: "/v1/feedback", free: true, accept: [202] },
  { name: "claims", method: "POST", path: "/v1/claims", free: true },
];

/** @type {Map<string, EndpointSpec>} */
export const BY_NAME = new Map(
  [...CATALOG_ENDPOINTS, ...INTEGRATOR_ENDPOINTS].map((spec) => [spec.name, spec]),
);

/**
 * @param {string} name
 * @param {Record<string, string>} [pathParams]
 */
export function endpointPath(name, pathParams = {}) {
  const spec = BY_NAME.get(name);
  if (!spec) {
    throw new Error(`unknown endpoint \`${name}\`; known: ${[...BY_NAME.keys()].join(", ")}`);
  }
  let path = spec.path.replace(/\{(\w+)\}/g, (_, key) => {
    const value = pathParams[key];
    if (value === undefined || value === null) {
      throw new Error(`\`${name}\` requires pathParams.${key}`);
    }
    const trimmed = String(value).trim();
    if (!trimmed) {
      throw new Error(`\`${name}\` requires pathParams.${key}`);
    }
    if (trimmed.length > MAX_PATH_PARAM_LEN) {
      throw new Error(`\`${name}\` pathParams.${key} exceeds ${MAX_PATH_PARAM_LEN} characters`);
    }
    return encodeURIComponent(trimmed);
  });
  if (/\{/.test(path)) {
    throw new Error(`\`${name}\` has unresolved path template`);
  }
  return path;
}
