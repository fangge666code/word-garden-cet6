import assert from "node:assert/strict";
import test from "node:test";
import { createDefaultData } from "../src/lib/core.js";
import { mergeLearningData, validateCredentials } from "../src/lib/account-sync.js";

test("username and password validation follows the account design", () => {
  assert.deepEqual(validateCredentials("learner_01", "password8", "password8"), { username: "learner_01", password: "password8" });
  assert.throws(() => validateCredentials("ab", "password8", "password8"), /用户名/);
  assert.throws(() => validateCredentials("中文名", "password8", "password8"), /用户名/);
  assert.throws(() => validateCredentials("learner", "short", "short"), /至少 8 位/);
  assert.throws(() => validateCredentials("learner", "password8", "different"), /两次输入/);
});

test("word progress merges by review time and then rating count", () => {
  const local = createDefaultData();
  const remote = createDefaultData();
  local.progress = {
    w1: { lastReviewedAt: "2026-07-16T08:00:00.000Z", totalRatings: 2, lastRating: "known" },
    w3: { lastReviewedAt: "2026-07-15T08:00:00.000Z", totalRatings: 4, lastRating: "fuzzy" },
  };
  remote.progress = {
    w1: { lastReviewedAt: "2026-07-15T08:00:00.000Z", totalRatings: 8, lastRating: "forgot" },
    w2: { lastReviewedAt: "2026-07-14T08:00:00.000Z", totalRatings: 1, lastRating: "known" },
    w3: { lastReviewedAt: "2026-07-15T08:00:00.000Z", totalRatings: 3, lastRating: "known" },
  };
  const merged = mergeLearningData(local, remote);
  assert.equal(merged.progress.w1.lastRating, "known");
  assert.equal(merged.progress.w2.lastRating, "known");
  assert.equal(merged.progress.w3.lastRating, "fuzzy");
  assert.equal(merged.session, null);
});

test("daily records merge sets, maximum ratings and completion", () => {
  const local = createDefaultData();
  const remote = createDefaultData();
  local.daily["2026-07-16"] = { newIds: ["w1", "w2"], reviewIds: ["w8"], ratings: 3, completed: false };
  remote.daily["2026-07-16"] = { newIds: ["w2", "w3"], reviewIds: ["w9"], ratings: 5, completed: true };
  const record = mergeLearningData(local, remote).daily["2026-07-16"];
  assert.deepEqual(record.newIds.sort(), ["w1", "w2", "w3"]);
  assert.deepEqual(record.reviewIds.sort(), ["w8", "w9"]);
  assert.equal(record.ratings, 5);
  assert.equal(record.completed, true);
});

test("cloud shuffle seed wins and the newest settings are retained", () => {
  const local = createDefaultData();
  const remote = createDefaultData();
  local.settings = { dailyGoal: 10, reduceMotion: true, shuffleSeed: "local-seed" };
  local.settingsUpdatedAt = "2026-07-16T09:00:00.000Z";
  remote.settings = { dailyGoal: 30, reduceMotion: false, shuffleSeed: "cloud-seed" };
  remote.settingsUpdatedAt = "2026-07-16T08:00:00.000Z";
  const merged = mergeLearningData(local, remote);
  assert.equal(merged.settings.shuffleSeed, "cloud-seed");
  assert.equal(merged.settings.dailyGoal, 10);
  assert.equal(merged.settings.reduceMotion, true);
  assert.equal(merged.settingsUpdatedAt, local.settingsUpdatedAt);
});

test("merge does not mutate either input", () => {
  const local = createDefaultData();
  const remote = createDefaultData();
  local.progress.w1 = { lastReviewedAt: "2026-07-16T08:00:00.000Z" };
  const localSnapshot = structuredClone(local);
  const remoteSnapshot = structuredClone(remote);
  mergeLearningData(local, remote);
  assert.deepEqual(local, localSnapshot);
  assert.deepEqual(remote, remoteSnapshot);
});
