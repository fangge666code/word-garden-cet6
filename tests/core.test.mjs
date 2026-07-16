import assert from "node:assert/strict";
import test from "node:test";
import {
  applyRating,
  buildProgressCsv,
  calculateStats,
  createDefaultData,
  makeSession,
  orderWords,
  rateCurrent,
  validateData,
} from "../src/lib/core.js";

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

test("new words appear before due reviews", () => {
  const data = createDefaultData();
  data.settings.dailyGoal = 2;
  data.settings.shuffleSeed = "learner-a";
  data.progress.w3 = { nextReviewAt: "2026-07-14T08:00:00.000Z" };
  const session = makeSession(words, data, now);
  assert.deepEqual(session.queue.map((entry) => entry.source), ["new", "new", "review"]);
  assert.equal(session.queue.filter((entry) => entry.source === "new").length, 2);
});

test("personal shuffle is stable for one user and differs between users", () => {
  const first = orderWords(words, "learner-a").map((word) => word.id);
  const repeated = orderWords(words, "learner-a").map((word) => word.id);
  const second = orderWords(words, "learner-b").map((word) => word.id);
  assert.deepEqual(first, repeated);
  assert.notDeepEqual(first, second);
});

test("new-word order stays stable across different days", () => {
  const data = createDefaultData();
  data.settings.dailyGoal = 5;
  data.settings.shuffleSeed = "learner-a";
  const first = makeSession(words, data, now).queue.map((entry) => entry.id);
  const nextDay = makeSession(words, { ...data, session: null }, new Date("2026-07-16T08:00:00.000Z")).queue.map((entry) => entry.id);
  assert.deepEqual(first, nextDay);
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

test("old backups remain valid and new backups preserve the shuffle seed", () => {
  const oldData = validateData({ version: 1, settings: { dailyGoal: 20 }, progress: {}, daily: {} });
  assert.equal(oldData.settings.shuffleSeed, "");
  const restored = validateData({
    version: 1,
    settings: { dailyGoal: 20, shuffleSeed: "saved-order" },
    progress: {},
    daily: {},
  });
  assert.equal(restored.settings.shuffleSeed, "saved-order");
});

test("CSV exports only touched words with readable learning states", () => {
  const exportWords = [
    { id: "w1", word: "alpha", pos: "n.", meaning: "开端, 起点" },
    { id: "w2", word: "beta", pos: "adj.", meaning: "含\"引号\"的释义" },
    { id: "w3", word: "gamma", pos: "v.", meaning: "未接触" },
  ];
  const data = createDefaultData();
  data.progress = {
    w1: {
      status: "mastered",
      lastRating: "known",
      lastReviewedAt: "2026-07-15T08:00:00.000Z",
      nextReviewAt: "2026-07-29T08:00:00.000Z",
      totalRatings: 3,
    },
    w2: {
      status: "learning",
      lastRating: "forgot",
      lastReviewedAt: "2026-07-15T09:00:00.000Z",
      nextReviewAt: "2026-07-16T09:00:00.000Z",
      totalRatings: 1,
    },
  };
  const csv = buildProgressCsv(exportWords, data, (value) => `本地:${value}`);
  const lines = csv.slice(1).trimEnd().split("\r\n");
  assert.equal(csv.charCodeAt(0), 0xfeff);
  assert.equal(lines.length, 3);
  assert.equal(lines[0], "单词,词性,中文释义,学习状态,最近复习时间,下次复习时间,累计评分次数");
  assert.match(lines[1], /^alpha,n\.,"开端, 起点",已掌握,/);
  assert.match(lines[2], /^beta,adj\.,"含""引号""的释义",未了解,/);
  assert.doesNotMatch(csv, /gamma|未接触/);
});
