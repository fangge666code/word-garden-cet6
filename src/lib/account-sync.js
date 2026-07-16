import { createDefaultData } from "./core.js";

export function validateCredentials(username, password, confirmation) {
  const normalizedUsername = String(username ?? "").trim();
  if (!/^[A-Za-z0-9_]{3,20}$/u.test(normalizedUsername)) {
    throw new Error("用户名需为 3–20 位字母、数字或下划线");
  }
  const normalizedPassword = String(password ?? "");
  if (normalizedPassword.length < 8) throw new Error("密码至少 8 位");
  if (confirmation !== undefined && normalizedPassword !== String(confirmation)) {
    throw new Error("两次输入的密码不一致");
  }
  return { username: normalizedUsername, password: normalizedPassword };
}

function timeValue(value) {
  const parsed = Date.parse(value ?? "");
  return Number.isFinite(parsed) ? parsed : 0;
}

function chooseProgress(localValue, remoteValue) {
  if (!localValue) return structuredClone(remoteValue);
  if (!remoteValue) return structuredClone(localValue);
  const localTime = timeValue(localValue.lastReviewedAt);
  const remoteTime = timeValue(remoteValue.lastReviewedAt);
  if (localTime !== remoteTime) return structuredClone(localTime > remoteTime ? localValue : remoteValue);
  return structuredClone((localValue.totalRatings ?? 0) >= (remoteValue.totalRatings ?? 0) ? localValue : remoteValue);
}

function mergeDailyRecord(localValue = {}, remoteValue = {}) {
  return {
    ...structuredClone(remoteValue),
    ...structuredClone(localValue),
    newIds: [...new Set([...(localValue.newIds ?? []), ...(remoteValue.newIds ?? [])])],
    reviewIds: [...new Set([...(localValue.reviewIds ?? []), ...(remoteValue.reviewIds ?? [])])],
    ratings: Math.max(localValue.ratings ?? 0, remoteValue.ratings ?? 0),
    completed: Boolean(localValue.completed || remoteValue.completed),
  };
}

export function mergeLearningData(localData, remoteData) {
  const local = structuredClone(localData ?? createDefaultData());
  const remote = structuredClone(remoteData ?? createDefaultData());
  const localSettingsTime = timeValue(local.settingsUpdatedAt);
  const remoteSettingsTime = timeValue(remote.settingsUpdatedAt);
  const newestSettings = localSettingsTime > remoteSettingsTime ? local.settings : remote.settings;
  const progress = {};
  for (const id of new Set([...Object.keys(local.progress ?? {}), ...Object.keys(remote.progress ?? {})])) {
    progress[id] = chooseProgress(local.progress?.[id], remote.progress?.[id]);
  }
  const daily = {};
  for (const date of new Set([...Object.keys(local.daily ?? {}), ...Object.keys(remote.daily ?? {})])) {
    daily[date] = mergeDailyRecord(local.daily?.[date], remote.daily?.[date]);
  }
  return {
    version: Math.max(local.version ?? 1, remote.version ?? 1),
    settings: {
      ...structuredClone(newestSettings),
      shuffleSeed: remote.settings?.shuffleSeed || local.settings?.shuffleSeed || "",
    },
    settingsUpdatedAt: localSettingsTime > remoteSettingsTime ? local.settingsUpdatedAt : remote.settingsUpdatedAt,
    progress,
    daily,
    session: null,
  };
}
