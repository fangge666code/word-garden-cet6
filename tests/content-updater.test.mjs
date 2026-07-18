import assert from "node:assert/strict";
import test from "node:test";
import { reconcileContentCache } from "../src/lib/content-updater.js";

test("content reconciliation keeps unchanged hashes and removes only stale chunks", async () => {
  const deleted = [];
  const requests = [
    new Request("https://example.test/app/src/assets/pronunciation/chunk-001.wav?v=aaaaaaaaaaaaaaaa"),
    new Request("https://example.test/app/src/assets/pronunciation/chunk-002.wav?v=old"),
    new Request("https://example.test/app/other.bin"),
  ];
  const cache = {
    keys: async () => requests,
    delete: async (request) => { deleted.push(request.url); return true; },
  };
  const scope = {
    location: { href: "https://example.test/app/" },
    fetch: async () => new Response(JSON.stringify({
      schemaVersion: 1,
      resources: [{ path: "src/assets/pronunciation/chunk-001.wav", sha256: "aaaaaaaaaaaaaaaa0000", size: 10 }],
    })),
    caches: { open: async () => cache },
  };
  const result = await reconcileContentCache({ scope, manifestUrl: "https://example.test/app/src/data/content-manifest.json" });
  assert.equal(result.removed, 1);
  assert.deepEqual(deleted, ["https://example.test/app/src/assets/pronunciation/chunk-002.wav?v=old"]);
});
