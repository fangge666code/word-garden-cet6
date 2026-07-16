export const DATA_VERSION = 1;

export function localDateKey(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function createDefaultData() {
  return {
    version: DATA_VERSION,
    settings: { dailyGoal: 20, reduceMotion: false, shuffleSeed: "" },
    settingsUpdatedAt: "",
    progress: {},
    daily: {},
    session: null,
  };
}

export function validateData(value, wordIds = null) {
  if (!value || typeof value !== "object") throw new Error("文件内容不是有效的数据对象");
  if (value.version !== DATA_VERSION) throw new Error(`数据版本不兼容，需要版本 ${DATA_VERSION}`);
  if (!value.settings || !Number.isInteger(value.settings.dailyGoal) || value.settings.dailyGoal < 1) {
    throw new Error("每日新词数量无效");
  }
  if (!value.progress || typeof value.progress !== "object" || Array.isArray(value.progress)) {
    throw new Error("单词进度格式无效");
  }
  if (!value.daily || typeof value.daily !== "object" || Array.isArray(value.daily)) {
    throw new Error("每日记录格式无效");
  }
  if (wordIds) {
    for (const id of Object.keys(value.progress)) {
      if (!wordIds.has(id)) throw new Error(`发现未知单词标识：${id}`);
    }
  }
  return {
    version: DATA_VERSION,
    settings: {
      dailyGoal: value.settings.dailyGoal,
      reduceMotion: Boolean(value.settings.reduceMotion),
      shuffleSeed: typeof value.settings.shuffleSeed === "string" ? value.settings.shuffleSeed : "",
    },
    settingsUpdatedAt: typeof value.settingsUpdatedAt === "string" ? value.settingsUpdatedAt : "",
    progress: value.progress,
    daily: value.daily,
    session: value.session ?? null,
  };
}

const DAY = 24 * 60 * 60 * 1000;

export function applyRating(previous = {}, rating, now = new Date()) {
  const current = {
    status: "learning",
    firstLearnedAt: previous.firstLearnedAt ?? now.toISOString(),
    lastReviewedAt: now.toISOString(),
    nextReviewAt: now.toISOString(),
    consecutiveKnown: previous.consecutiveKnown ?? 0,
    totalRatings: previous.totalRatings ?? 0,
    lastRating: rating,
  };
  current.totalRatings += 1;

  if (rating === "forgot") {
    current.consecutiveKnown = 0;
    current.status = "learning";
    current.nextReviewAt = new Date(now.getTime() + DAY).toISOString();
  } else if (rating === "fuzzy") {
    current.status = previous.status === "mastered" ? "mastered" : "learning";
    current.nextReviewAt = new Date(now.getTime() + 2 * DAY).toISOString();
  } else if (rating === "known") {
    current.consecutiveKnown += 1;
    const intervals = [3, 7, 14, 30, 60];
    const index = Math.min(current.consecutiveKnown - 1, intervals.length - 1);
    current.nextReviewAt = new Date(now.getTime() + intervals[index] * DAY).toISOString();
    current.status = current.consecutiveKnown >= 3 ? "mastered" : "learning";
  } else {
    throw new Error("未知评分");
  }
  return current;
}

function freshDailyRecord() {
  return { newIds: [], reviewIds: [], ratings: 0, completed: false };
}

function stableRank(value) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  hash ^= hash >>> 16;
  hash = Math.imul(hash, 2246822507);
  hash ^= hash >>> 13;
  return hash >>> 0;
}

export function orderWords(words, shuffleSeed = "") {
  return [...words].sort((a, b) => (
    stableRank(`${shuffleSeed}:${a.id}`) - stableRank(`${shuffleSeed}:${b.id}`)
    || a.id.localeCompare(b.id)
  ));
}

export function makeSession(words, data, now = new Date()) {
  const date = localDateKey(now);
  if (data.session?.date === date) {
    return data.session;
  }
  const due = words
    .filter((word) => data.progress[word.id]?.nextReviewAt && new Date(data.progress[word.id].nextReviewAt) <= now)
    .sort((a, b) => new Date(data.progress[a.id].nextReviewAt) - new Date(data.progress[b.id].nextReviewAt));
  const today = data.daily[date] ?? freshDailyRecord();
  const remaining = Math.max(0, data.settings.dailyGoal - today.newIds.length);
  const unseen = orderWords(
    words.filter((word) => !data.progress[word.id]),
    data.settings.shuffleSeed,
  )
    .slice(0, remaining);
  return {
    date,
    position: 0,
    queue: [
      ...unseen.map((word) => ({ id: word.id, source: "new" })),
      ...due.map((word) => ({ id: word.id, source: "review" })),
    ],
    forgetCounts: {},
    results: { new: 0, review: 0, known: 0 },
  };
}

export function rateCurrent(data, rating, now = new Date()) {
  const session = structuredClone(data.session);
  const entry = session?.queue[session.position];
  if (!entry) throw new Error("当前没有可评分的单词");
  const date = session.date;
  const daily = structuredClone(data.daily[date] ?? freshDailyRecord());
  const nextProgress = applyRating(data.progress[entry.id], rating, now);

  if (entry.source === "new" && !daily.newIds.includes(entry.id)) {
    daily.newIds.push(entry.id);
    session.results.new += 1;
  }
  if (entry.source === "review" && !daily.reviewIds.includes(entry.id)) {
    daily.reviewIds.push(entry.id);
    session.results.review += 1;
  }
  if (rating === "known") session.results.known += 1;
  daily.ratings += 1;

  if (rating === "forgot") {
    const count = session.forgetCounts[entry.id] ?? 0;
    if (count < 2) {
      session.forgetCounts[entry.id] = count + 1;
      const insertAt = Math.min(session.position + 4, session.queue.length);
      session.queue.splice(insertAt, 0, { id: entry.id, source: "retry" });
    }
  }

  session.position += 1;
  if (session.position >= session.queue.length) daily.completed = true;
  return {
    ...data,
    progress: { ...data.progress, [entry.id]: nextProgress },
    daily: { ...data.daily, [date]: daily },
    session,
  };
}

export function calculateStats(words, data, now = new Date()) {
  const date = localDateKey(now);
  const today = data.daily[date] ?? freshDailyRecord();
  const due = words.filter((word) => {
    const next = data.progress[word.id]?.nextReviewAt;
    return next && new Date(next) <= now;
  }).length;
  const mastered = Object.values(data.progress).filter((item) => item.status === "mastered").length;
  const activeDays = Object.entries(data.daily)
    .filter(([, record]) => record.ratings > 0)
    .map(([key]) => key)
    .sort()
    .reverse();
  let streak = 0;
  const cursor = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  if (!activeDays.includes(localDateKey(cursor))) cursor.setDate(cursor.getDate() - 1);
  while (activeDays.includes(localDateKey(cursor))) {
    streak += 1;
    cursor.setDate(cursor.getDate() - 1);
  }
  return { todayNew: today.newIds.length, due, mastered, streak, today };
}

function csvCell(value) {
  const text = String(value ?? "");
  return /[",\r\n]/u.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function learningStatus(progress) {
  if (progress.status === "mastered") return "已掌握";
  if (progress.lastRating === "forgot") return "未了解";
  return "学习中";
}

export function buildProgressCsv(words, data, formatDate = (value) => new Date(value).toLocaleString("zh-CN")) {
  const headers = ["单词", "词性", "中文释义", "学习状态", "最近复习时间", "下次复习时间", "累计评分次数"];
  const rows = words
    .filter((word) => Boolean(data.progress[word.id]))
    .map((word) => {
      const progress = data.progress[word.id];
      return [
        word.word,
        word.pos,
        word.meaning,
        learningStatus(progress),
        progress.lastReviewedAt ? formatDate(progress.lastReviewedAt) : "",
        progress.nextReviewAt ? formatDate(progress.nextReviewAt) : "",
        progress.totalRatings ?? 0,
      ].map(csvCell).join(",");
    });
  return `\uFEFF${[headers.join(","), ...rows].join("\r\n")}\r\n`;
}
