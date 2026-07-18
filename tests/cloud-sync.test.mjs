import assert from "node:assert/strict";
import test from "node:test";
import { createDefaultData } from "../src/lib/core.js";
import { syncLearningData } from "../src/lib/cloud-sync.js";

test("cloud synchronization merges records, preserves the session and uploads changes", async () => {
  const local = createDefaultData();
  local.settings.shuffleSeed = "local-seed";
  local.settingsUpdatedAt = "2026-07-16T09:00:00.000Z";
  local.progress.w1 = { lastReviewedAt: "2026-07-16T09:00:00.000Z", totalRatings: 2, lastRating: "known" };
  local.progress.w2 = { lastReviewedAt: "2026-07-16T08:00:00.000Z", totalRatings: 1, lastRating: "fuzzy" };
  local.session = { date: "2026-07-16", position: 1, queue: [{ id: "w2", source: "new" }] };
  const saved = [];
  const client = {
    async listOwned(className) {
      if (className === "UserProfile") return [{ objectId: "profile-1", shuffleSeed: "cloud-seed", dailyGoal: 20, settingsUpdatedAt: "2026-07-16T08:00:00.000Z" }];
      if (className === "WordProgress") return [{ objectId: "progress-1", wordId: "w1", lastReviewedAt: "2026-07-15T09:00:00.000Z", totalRatings: 8, lastRating: "forgot" }];
      return [{ objectId: "daily-1", date: "2026-07-16", newIds: ["w3"], reviewIds: [], ratings: 1, completed: false }];
    },
    async saveOwned(className, values, user, objectId) {
      saved.push({ className, values, user, objectId });
      return { objectId: objectId ?? "new-record" };
    },
  };
  const user = { objectId: "user-1", sessionToken: "session" };
  const result = await syncLearningData(client, user, local);
  assert.equal(result.data.settings.shuffleSeed, "cloud-seed");
  assert.equal(result.data.progress.w1.lastRating, "known");
  assert.equal(result.data.progress.w2.lastRating, "fuzzy");
  assert.deepEqual(result.data.session, local.session);
  assert.ok(saved.some((record) => record.className === "WordProgress" && record.values.wordId === "w2"));
  assert.ok(saved.every((record) => record.user.objectId === "user-1"));
});

test("Kaoyan synchronization uses only the separate Kaoyan tables", async () => {
  const classes = [];
  const client = {
    async listOwned(className) { classes.push(className); return []; },
    async saveOwned(className) { classes.push(className); return {}; },
  };
  const local = createDefaultData();
  local.settings.shuffleSeed = "kaoyan-seed";
  local.progress["ky-0001"] = { status: "learning", totalRatings: 1, lastRating: "fuzzy" };
  local.daily["2026-07-18"] = { newIds: ["ky-0001"], reviewIds: [], ratings: 1, completed: false };
  await syncLearningData(client, { objectId: "u2" }, local, "kaoyan");
  assert.ok(classes.includes("KaoyanUserProfile"));
  assert.ok(classes.includes("KaoyanWordProgress"));
  assert.ok(classes.includes("KaoyanDailyRecord"));
  assert.ok(classes.every((name) => name.startsWith("Kaoyan")));
});
