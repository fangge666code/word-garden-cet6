export const CONTENT_CACHE_NAME = "word-garden-content-v1";
export const CONTENT_MANIFEST_PATH = "./src/data/content-manifest.json";

export async function reconcileContentCache({
  scope = globalThis,
  manifestUrl = CONTENT_MANIFEST_PATH,
  cacheName = CONTENT_CACHE_NAME,
} = {}) {
  if (!scope.fetch || !scope.caches?.open) return { checked: false, removed: 0 };
  const response = await scope.fetch(manifestUrl, { cache: "no-store" });
  if (!response.ok) throw new Error(`Content manifest HTTP ${response.status}`);
  const manifest = await response.json();
  if (manifest?.schemaVersion !== 1 || !Array.isArray(manifest.resources)) throw new Error("Invalid content manifest");
  const base = new URL(manifestUrl, scope.location?.href ?? "https://localhost/");
  const allowed = new Set(manifest.resources.map((resource) => (
    new URL(`../../${resource.path}?v=${resource.sha256.slice(0, 16)}`, base).href
  )));
  const cache = await scope.caches.open(cacheName);
  const keys = await cache.keys();
  let removed = 0;
  await Promise.all(keys.map(async (request) => {
    const url = new URL(request.url);
    if (!url.pathname.includes("/src/assets/pronunciation") || allowed.has(request.url)) return;
    if (await cache.delete(request)) removed += 1;
  }));
  return { checked: true, removed, resourceCount: manifest.resources.length };
}
