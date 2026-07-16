import assert from "node:assert/strict";
import test from "node:test";
import { LeanCloudClient } from "../src/lib/leancloud-client.js";

function response(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

test("registration and login send only public client headers", async () => {
  const calls = [];
  const client = new LeanCloudClient({ appId: "app-id", appKey: "client-key", serverURL: "https://example.test" }, async (url, options) => {
    calls.push({ url, options });
    return response({ objectId: "user-1", username: "learner", sessionToken: "session" });
  });
  await client.register("learner", "password8");
  await client.login("learner", "password8");
  assert.equal(calls[0].url, "https://example.test/1.1/users");
  assert.equal(calls[1].url, "https://example.test/1.1/login");
  assert.equal(calls[0].options.headers["X-LC-Id"], "app-id");
  assert.equal(calls[0].options.headers["X-LC-Key"], "client-key");
  assert.doesNotMatch(JSON.stringify(calls), /master/i);
});

test("owned records are created with owner pointer and private ACL", async () => {
  const calls = [];
  const client = new LeanCloudClient({ appId: "app-id", appKey: "client-key", serverURL: "https://example.test" }, async (url, options) => {
    calls.push({ url, options });
    if (options.method === "GET") return response({ results: [] });
    return response({ objectId: "record-1" }, 201);
  });
  const user = { objectId: "user-1", sessionToken: "session" };
  await client.upsertOwned("WordProgress", "wordId", "w1", { wordId: "w1", status: "learning" }, user);
  const create = calls.find((call) => call.options.method === "POST");
  const body = JSON.parse(create.options.body);
  assert.deepEqual(body.owner, { __type: "Pointer", className: "_User", objectId: "user-1" });
  assert.deepEqual(body.ACL, { "user-1": { read: true, write: true } });
  assert.equal(create.options.headers["X-LC-Session"], "session");
});

test("owned queries always include the current user pointer", async () => {
  let requestedUrl = "";
  const client = new LeanCloudClient({ appId: "app-id", appKey: "client-key", serverURL: "https://example.test" }, async (url) => {
    requestedUrl = url;
    return response({ results: [] });
  });
  await client.listOwned("DailyRecord", { objectId: "user-2", sessionToken: "session" });
  const where = JSON.parse(new URL(requestedUrl).searchParams.get("where"));
  assert.deepEqual(where.owner, { __type: "Pointer", className: "_User", objectId: "user-2" });
});

test("LeanCloud errors become safe Chinese messages", async () => {
  const client = new LeanCloudClient({ appId: "app-id", appKey: "client-key", serverURL: "https://example.test" }, async () => (
    response({ code: 210, error: "The username and password mismatch." }, 401)
  ));
  await assert.rejects(() => client.login("learner", "wrong-pass"), /用户名或密码不正确/);
});
