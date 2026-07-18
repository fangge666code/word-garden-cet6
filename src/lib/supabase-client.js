const USER_DOMAIN = "users.word-garden.invalid";

const BASE_TABLES = {
  UserProfile: {
    name: "user_profiles",
    conflict: "user_id",
    fromRow: (row) => ({
      objectId: row.user_id,
      profileKey: "main",
      dailyGoal: row.daily_goal,
      reduceMotion: row.reduce_motion,
      shuffleSeed: row.shuffle_seed,
      settingsUpdatedAt: row.settings_updated_at,
      dataVersion: row.data_version,
      updatedAt: row.updated_at,
    }),
    toRow: (value) => ({
      daily_goal: value.dailyGoal,
      reduce_motion: value.reduceMotion,
      shuffle_seed: value.shuffleSeed,
      settings_updated_at: value.settingsUpdatedAt,
      data_version: value.dataVersion,
    }),
  },
  WordProgress: {
    name: "word_progress",
    conflict: "user_id,word_id",
    fromRow: (row) => ({
      objectId: row.id,
      wordId: row.word_id,
      status: row.status,
      firstLearnedAt: row.first_learned_at,
      lastReviewedAt: row.last_reviewed_at,
      nextReviewAt: row.next_review_at,
      consecutiveKnown: row.consecutive_known,
      totalRatings: row.total_ratings,
      lastRating: row.last_rating,
      updatedAt: row.updated_at,
    }),
    toRow: (value) => ({
      word_id: value.wordId,
      status: value.status,
      first_learned_at: value.firstLearnedAt,
      last_reviewed_at: value.lastReviewedAt,
      next_review_at: value.nextReviewAt,
      consecutive_known: value.consecutiveKnown,
      total_ratings: value.totalRatings,
      last_rating: value.lastRating,
    }),
  },
  DailyRecord: {
    name: "daily_records",
    conflict: "user_id,date",
    fromRow: (row) => ({
      objectId: row.id,
      date: row.date,
      newIds: row.new_ids ?? [],
      reviewIds: row.review_ids ?? [],
      ratings: row.ratings,
      completed: row.completed,
      updatedAt: row.updated_at,
    }),
    toRow: (value) => ({
      date: value.date,
      new_ids: value.newIds,
      review_ids: value.reviewIds,
      ratings: value.ratings,
      completed: value.completed,
    }),
  },
};

const TABLES = Object.freeze({
  ...BASE_TABLES,
  KaoyanUserProfile: { ...BASE_TABLES.UserProfile, name: "ky_user_profiles" },
  KaoyanWordProgress: { ...BASE_TABLES.WordProgress, name: "ky_word_progress" },
  KaoyanDailyRecord: { ...BASE_TABLES.DailyRecord, name: "ky_daily_records" },
});

export function usernameToEmail(username) {
  return `${String(username ?? "").trim().toLowerCase()}@${USER_DOMAIN}`;
}

function safeError(payload, status) {
  const message = String(payload?.msg ?? payload?.message ?? payload?.error_description ?? payload?.error ?? "").toLowerCase();
  if (status === 429) return new Error("操作过于频繁，请稍后再试");
  if (message.includes("already registered") || message.includes("already been registered") || message.includes("user already exists")) {
    return new Error("该用户名已被使用");
  }
  if (status === 400 && (message.includes("invalid login") || message.includes("invalid credentials"))) {
    return new Error("用户名或密码不正确");
  }
  if (status === 403 && message.includes("permission denied")) {
    const error = new Error("云端数据权限未配置完整");
    error.code = "DATA_PERMISSION";
    return error;
  }
  const expiredSession = [
    "invalid refresh token",
    "refresh token not found",
    "refresh token already used",
    "refresh token has already been used",
    "session not found",
    "jwt expired",
    "jwt is expired",
    "invalid jwt",
  ].some((indicator) => message.includes(indicator));
  if (expiredSession) return authExpiredError();
  if (status === 401 || status === 403) {
    return authExpiredError();
  }
  return new Error("云端服务暂时不可用，学习记录已保存在本机");
}

function authExpiredError() {
  const error = new Error("登录状态已失效，请重新登录");
  error.code = "AUTH_EXPIRED";
  return error;
}

function mapUser(payload, fallbackUsername = "") {
  const user = payload.user ?? payload;
  const username = user.user_metadata?.username ?? fallbackUsername;
  const expiresIn = Number(payload.expires_in ?? 3600);
  return {
    objectId: user.id,
    username,
    sessionToken: payload.access_token,
    refreshToken: payload.refresh_token,
    expiresAt: Date.now() + expiresIn * 1000,
  };
}

export class SupabaseClient {
  constructor(config, fetchImplementation = globalThis.fetch, xhrFactory = () => new globalThis.XMLHttpRequest()) {
    this.projectURL = String(config.projectURL ?? "").replace(/\/+$/u, "");
    this.anonKey = config.anonKey;
    this.fetch = fetchImplementation.bind(globalThis);
    this.xhrFactory = xhrFactory;
  }

  requestWithXhr(url, { method, body, headers }) {
    return new Promise((resolve, reject) => {
      let xhr;
      try { xhr = this.xhrFactory(); } catch { reject(new Error("XHR unavailable")); return; }
      xhr.open(method, url, true);
      xhr.timeout = 15_000;
      Object.entries(headers).forEach(([name, value]) => xhr.setRequestHeader(name, value));
      xhr.onload = () => resolve({
        ok: xhr.status >= 200 && xhr.status < 300,
        status: xhr.status,
        json: async () => JSON.parse(xhr.responseText || "{}"),
      });
      xhr.onerror = () => reject(new Error("XHR network error"));
      xhr.ontimeout = () => reject(new Error("XHR timeout"));
      xhr.send(body === undefined ? null : JSON.stringify(body));
    });
  }

  async request(path, { method = "GET", body, token, prefer } = {}) {
    const headers = {
      apikey: this.anonKey,
      "Content-Type": "application/json",
    };
    if (token) headers.Authorization = `Bearer ${token}`;
    if (prefer) headers.Prefer = prefer;
    let response;
    const url = `${this.projectURL}${path}`;
    const options = {
      method,
      headers,
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    };
    try {
      response = await this.fetch(url, options);
    } catch {
      try {
        response = await this.requestWithXhr(url, { method, body, headers });
      } catch {
        throw new Error("网络连接失败，学习记录已保存在本机");
      }
    }
    let payload = {};
    try { payload = await response.json(); } catch { payload = {}; }
    if (!response.ok) throw safeError(payload, response.status);
    return payload;
  }

  async register(username, password) {
    const payload = await this.request("/auth/v1/signup", {
      method: "POST",
      body: { email: usernameToEmail(username), password, data: { username } },
    });
    if (!payload.access_token) throw new Error("账号已创建，但云端尚未开放免验证登录");
    return mapUser(payload, username);
  }

  async login(username, password) {
    const payload = await this.request("/auth/v1/token?grant_type=password", {
      method: "POST",
      body: { email: usernameToEmail(username), password },
    });
    return mapUser(payload, username);
  }

  async restoreSession(user, { force = false } = {}) {
    if (!force && user.sessionToken && user.expiresAt > Date.now() + 60_000) return user;
    if (!user.refreshToken) throw authExpiredError();
    const payload = await this.request("/auth/v1/token?grant_type=refresh_token", {
      method: "POST",
      body: { refresh_token: user.refreshToken },
    });
    return mapUser(payload, user.username);
  }

  logout(user) {
    return this.request("/auth/v1/logout", { method: "POST", token: user.sessionToken });
  }

  async listOwned(className, user) {
    const table = TABLES[className];
    if (!table) throw new Error("未知的云端数据类型");
    const query = new URLSearchParams({ user_id: `eq.${user.objectId}`, select: "*" });
    const rows = await this.request(`/rest/v1/${table.name}?${query}`, { token: user.sessionToken });
    return rows.map(table.fromRow);
  }

  async saveOwned(className, values, user) {
    const table = TABLES[className];
    if (!table) throw new Error("未知的云端数据类型");
    const query = new URLSearchParams({ on_conflict: table.conflict });
    const payload = await this.request(`/rest/v1/${table.name}?${query}`, {
      method: "POST",
      token: user.sessionToken,
      prefer: "resolution=merge-duplicates,return=representation",
      body: { user_id: user.objectId, ...table.toRow(values) },
    });
    return payload[0] ? table.fromRow(payload[0]) : {};
  }
}

export { TABLES };
