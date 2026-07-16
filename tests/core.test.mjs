import assert from "node:assert/strict";
import test from "node:test";
import { applyRating, calculateStats, createDefaultData, makeSession, rateCurrent, validateData } from "../src/lib/core.js";

const words = [
  { id: "w1", word: "alpha" }, { id: "w2", word: "beta" }, { id: "w3", word: "gamma" },
  { id: "w4", word: "delta" }, { id: "w5", word: "epsilon" },
];
const now = new Date("2026-07-15T08:00:00.000Z");

test("known ratings follow the 3, 7 and 14 day intervals", () => {
  const first = applyRating({}, "known", now);
  const second = applyRating(first, "known", now);
  const third = applyRating(second, "known", now);
  assert.equal((new Date(first.nextReviewAt) - now) / 86400000, 3);
  assert.equal((new Date(second.nextReviewAt) - now) / 86400000, 7);
  assert.equal((new Date(third.nextReviewAt) - now) / 86400000, 14);
  assert.equal(third.status, "mastered");
});

test("forgot resets mastery and schedules tomorrow", () => {
  const result = applyRating({ status: "mastered", consecutiveKnown: 4 }, "forgot", now);
  assert.equal(result.status, "learning");
  assert.equal(result.consecutiveKnown, 0);
  assert.equal((new Date(result.nextReviewAt) - now) / 86400000, 1);
});

test("due reviews appear before new words", () => {
  const data = createDefaultData();
  data.settings.dailyGoal = 2;
  data.progress.w3 = { nextReviewAt: "2026-07-14T08:00:00.000Z" };
  const session = makeSession(words, data, now);
  assert.deepEqual(session.queue[0], { id: "w3", source: "review" });
  assert.equal(session.queue.filter((entry) => entry.source === "new").length, 2);
});

test("new-word order is deterministic for the same day", () => {
  const data = createDefaultData();
  data.settings.dailyGoal = 5;
  const first = makeSession(words, data, now).queue;
  const second = makeSession(words, data, now).queue;
  assert.deepEqual(first, second);
  assert.notDeepEqual(first.map((entry) => entry.id), words.map((word) => word.id));
});

test("forgot word is reinserted after at least three cards", () => {
  const data = createDefaultData();
  data.settings.dailyGoal = 5;
  data.session = makeSession(words, data, now);
  const currentId = data.session.queue[0].id;
  const result = rateCurrent(data, "forgot", now);
  assert.deepEqual(result.session.queue[4], { id: currentId, source: "retry" });
  assert.equal(result.session.forgetCounts[currentId], 1);
});

test("a completed session remains available for the result view on the same day", () => {
  const data = createDefaultData();
  data.settings.dailyGoal = 1;
  data.session = makeSession(words, data, now);
  const completed = rateCurrent(data, "known", now);
  assert.equal(completed.session.position, completed.session.queue.length);
  assert.equal(makeSession(words, completed, now), completed.session);
});

test("daily counts are unique while ratings count every attempt", () => {
  let data = createDefaultData();
  data.settings.dailyGoal = 1;
  data.session = makeSession(words, data, now);
  const currentId = data.session.queue[0].id;
  data = rateCurrent(data, "forgot", now);
  data.session.position = data.session.queue.findIndex((entry, index) => index > 0 && entry.id === currentId);
  data = rateCurrent(data, "known", now);
  const record = data.daily[Object.keys(data.daily)[0]];
  assert.equal(record.newIds.length, 1);
  assert.equal(record.ratings, 2);
});

test("streak includes consecutive active days ending today", () => {
  const data = createDefaultData();
  data.daily["2026-07-13"] = { ratings: 2, newIds: [], reviewIds: [] };
  data.daily["2026-07-14"] = { ratings: 2, newIds: [], reviewIds: [] };
  data.daily["2026-07-15"] = { ratings: 1, newIds: [], reviewIds: [] };
  assert.equal(calculateStats(words, data, new Date(2026, 6, 15, 10)).streak, 3);
});

test("invalid import is rejected", () => {
  assert.throws(() => validateData({ version: 1, settings: { dailyGoal: 0 }, progress: {}, daily: {} }), /每日新词/);
  assert.throws(() => validateData({ version: 99, settings: { dailyGoal: 2 }, progress: {}, daily: {} }), /版本/);
});
