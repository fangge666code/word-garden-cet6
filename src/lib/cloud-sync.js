import { mergeLearningData } from "./account-sync.js";
import { createDefaultData } from "./core.js";

const WORD_FIELDS = ["status", "firstLearnedAt", "lastReviewedAt", "nextReviewAt", "consecutiveKnown", "totalRatings", "lastRating"];

function selectFields(source, fields) {
  return Object.fromEntries(fields.filter((field) => source?.[field] !== undefined).map((field) => [field, source[field]]));
}

function wordFromCloud(record) {
  return selectFields(record, WORD_FIELDS);
}

function dailyFromCloud(record) {
  return {
    newIds: [...new Set(record.newIds ?? [])],
    reviewIds: [...new Set(record.reviewIds ?? [])],
    ratings: record.ratings ?? 0,
    completed: Boolean(record.completed),
  };
}

function comparable(value) {
  return JSON.stringify(value, Object.keys(value).sort());
}

function equalWord(localValue, remoteRecord) {
  return comparable(selectFields(localValue, WORD_FIELDS)) === comparable(wordFromCloud(remoteRecord));
}

function equalDaily(localValue, remoteRecord) {
  const normalize = (record) => ({
    ...dailyFromCloud(record),
    newIds: [...new Set(record.newIds ?? [])].sort(),
    reviewIds: [...new Set(record.reviewIds ?? [])].sort(),
  });
  return JSON.stringify(normalize(localValue)) === JSON.stringify(normalize(remoteRecord));
}

function remoteData(profileRecords, wordRecords, dailyRecords) {
  const data = createDefaultData();
  const profile = profileRecords[0];
  if (profile) {
    data.settings = {
      dailyGoal: profile.dailyGoal ?? data.settings.dailyGoal,
      reduceMotion: Boolean(profile.reduceMotion),
      shuffleSeed: profile.shuffleSeed ?? "",
    };
    data.settingsUpdatedAt = profile.settingsUpdatedAt ?? profile.updatedAt ?? "";
  }
  for (const record of wordRecords) {
    if (record.wordId) data.progress[record.wordId] = wordFromCloud(record);
  }
  for (const record of dailyRecords) {
    if (record.date) data.daily[record.date] = dailyFromCloud(record);
  }
  return data;
}

async function runLimited(tasks, limit = 4) {
  const queue = [...tasks];
  const workers = Array.from({ length: Math.min(limit, queue.length) }, async () => {
    while (queue.length) await queue.shift()();
  });
  await Promise.all(workers);
}

export async function syncLearningData(client, user, localData, bookId = "cet6") {
  const names = bookId === "kaoyan"
    ? { profile: "KaoyanUserProfile", word: "KaoyanWordProgress", daily: "KaoyanDailyRecord" }
    : { profile: "UserProfile", word: "WordProgress", daily: "DailyRecord" };
  const [profiles, words, dailyRecords] = await Promise.all([
    client.listOwned(names.profile, user),
    client.listOwned(names.word, user),
    client.listOwned(names.daily, user),
  ]);
  const merged = mergeLearningData(localData, remoteData(profiles, words, dailyRecords));
  merged.session = structuredClone(localData.session ?? null);
  const profile = profiles[0];
  const profileValues = {
    profileKey: "main",
    dailyGoal: merged.settings.dailyGoal,
    reduceMotion: merged.settings.reduceMotion,
    shuffleSeed: merged.settings.shuffleSeed,
    settingsUpdatedAt: merged.settingsUpdatedAt || new Date().toISOString(),
    dataVersion: merged.version,
  };
  const tasks = [() => client.saveOwned(names.profile, profileValues, user, profile?.objectId)];
  const wordMap = new Map(words.map((record) => [record.wordId, record]));
  for (const [wordId, value] of Object.entries(merged.progress)) {
    const remote = wordMap.get(wordId);
    if (!remote || !equalWord(value, remote)) {
      tasks.push(() => client.saveOwned(names.word, { wordId, ...selectFields(value, WORD_FIELDS) }, user, remote?.objectId));
    }
  }
  const dailyMap = new Map(dailyRecords.map((record) => [record.date, record]));
  for (const [date, value] of Object.entries(merged.daily)) {
    const remote = dailyMap.get(date);
    if (!remote || !equalDaily(value, remote)) {
      tasks.push(() => client.saveOwned(names.daily, { date, ...dailyFromCloud(value) }, user, remote?.objectId));
    }
  }
  await runLimited(tasks);
  return { data: merged, uploaded: Math.max(0, tasks.length - 1), syncedAt: new Date().toISOString() };
}
