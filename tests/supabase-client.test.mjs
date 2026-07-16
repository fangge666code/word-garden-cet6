import assert from "node:assert/strict";
import test from "node:test";
import { SupabaseClient, usernameToEmail } from "../src/lib/supabase-client.js";

function response(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

test("usernames map to stable private authentication addresses", () => {
  assert.equal(usernameToEmail(" Learner_01 "), "learner_01@users.word-garden.invalid");
});

test("registration and login use only the public anon key", async () => {
  const calls = [];
  const client = new SupabaseClient({ projectURL: "https://project.supabase.co", anonKey: "anon-key" }, async (url, options) => {
    calls.push({ url, options });
    return response({
      access_token: "access",
      refresh_token: "refresh",
      expires_in: 3600,
      user: { id: "user-1", user_metadata: { username: "learner" } },
    });
  });
  const registered = await client.register("learner", "password8");
  await client.login("learner", "password8");
  assert.equal(calls[0].url, "https://project.supabase.co/auth/v1/signup");
  assert.match(calls[1].url, /grant_type=password/u);
  assert.equal(calls[0].options.headers.apikey, "anon-key");
  assert.equal(registered.objectId, "user-1");
  assert.equal(registered.refreshToken, "refresh");
  assert.doesNotMatch(JSON.stringify(calls), /service.role|master/i);
});

test("expired sessions are refreshed", async () => {
  let requestedUrl = "";
  const client = new SupabaseClient({ projectURL: "https://project.supabase.co", anonKey: "anon-key" }, async (url) => {
    requestedUrl = url;
    return response({ access_token: "new-access", refresh_token: "new-refresh", expires_in: 3600, user: { id: "user-1" } });
  });
  const restored = await client.restoreSession({ objectId: "user-1", username: "learner", sessionToken: "old", refreshToken: "refresh", expiresAt: 0 });
  assert.match(requestedUrl, /grant_type=refresh_token/u);
  assert.equal(restored.sessionToken, "new-access");
  assert.equal(restored.username, "learner");
});

test("owned records are filtered by user and upserted with the same user id", async () => {
  const calls = [];
  const client = new SupabaseClient({ projectURL: "https://project.supabase.co", anonKey: "anon-key" }, async (url, options) => {
    calls.push({ url, options });
    if (options.method === "GET") return response([]);
    return response([{ id: "record-1", user_id: "user-2", word_id: "w1", status: "learning" }], 201);
  });
  const user = { objectId: "user-2", sessionToken: "access" };
  await client.listOwned("WordProgress", user);
  await client.saveOwned("WordProgress", { wordId: "w1", status: "learning" }, user);
  const listUrl = new URL(calls[0].url);
  assert.equal(listUrl.searchParams.get("user_id"), "eq.user-2");
  const body = JSON.parse(calls[1].options.body);
  assert.equal(body.user_id, "user-2");
  assert.equal(body.word_id, "w1");
  assert.equal(calls[1].options.headers.Authorization, "Bearer access");
  assert.match(calls[1].options.headers.Prefer, /merge-duplicates/u);
});

test("Supabase authentication errors become safe Chinese messages", async () => {
  const client = new SupabaseClient({ projectURL: "https://project.supabase.co", anonKey: "anon-key" }, async () => (
    response({ error_description: "Invalid login credentials" }, 400)
  ));
  await assert.rejects(() => client.login("learner", "wrong-pass"), /用户名或密码不正确/);
});
