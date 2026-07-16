function ownerPointer(userId) {
  return { __type: "Pointer", className: "_User", objectId: userId };
}

function ownerAcl(userId) {
  return { [userId]: { read: true, write: true } };
}

function safeError(payload, status) {
  if ([210, 211].includes(payload?.code) || status === 401) return new Error("用户名或密码不正确");
  if (payload?.code === 202) return new Error("该用户名已经被注册");
  if (payload?.code === 219 || status === 429) return new Error("操作过于频繁，请稍后再试");
  return new Error("云端服务暂时不可用，请稍后再试");
}

export class LeanCloudClient {
  constructor(config, fetchImplementation = globalThis.fetch) {
    this.appId = config.appId;
    this.appKey = config.appKey;
    this.serverURL = String(config.serverURL ?? "").replace(/\/+$/u, "");
    this.fetch = fetchImplementation;
  }

  async request(path, { method = "GET", body, sessionToken } = {}) {
    const headers = {
      "Content-Type": "application/json",
      "X-LC-Id": this.appId,
      "X-LC-Key": this.appKey,
    };
    if (sessionToken) headers["X-LC-Session"] = sessionToken;
    let response;
    try {
      response = await this.fetch(`${this.serverURL}/1.1${path}`, {
        method,
        headers,
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
    } catch {
      throw new Error("网络连接失败，学习记录已保存在本机");
    }
    let payload = {};
    try {
      payload = await response.json();
    } catch {
      payload = {};
    }
    if (!response.ok) throw safeError(payload, response.status);
    return payload;
  }

  register(username, password) {
    return this.request("/users", { method: "POST", body: { username, password } });
  }

  login(username, password) {
    return this.request("/login", { method: "POST", body: { username, password } });
  }

  currentUser(sessionToken) {
    return this.request("/users/me", { sessionToken });
  }

  async listOwned(className, user, extraWhere = {}) {
    const results = [];
    let skip = 0;
    while (true) {
      const where = { owner: ownerPointer(user.objectId), ...extraWhere };
      const query = new URLSearchParams({ where: JSON.stringify(where), limit: "1000", skip: String(skip) });
      const page = await this.request(`/classes/${encodeURIComponent(className)}?${query}`, { sessionToken: user.sessionToken });
      results.push(...(page.results ?? []));
      if ((page.results?.length ?? 0) < 1000) break;
      skip += 1000;
    }
    return results;
  }

  async upsertOwned(className, uniqueField, uniqueValue, values, user) {
    const matches = await this.listOwned(className, user, { [uniqueField]: uniqueValue });
    const body = {
      ...values,
      owner: ownerPointer(user.objectId),
      ACL: ownerAcl(user.objectId),
    };
    if (matches[0]?.objectId) {
      return this.request(`/classes/${encodeURIComponent(className)}/${matches[0].objectId}`, {
        method: "PUT",
        body,
        sessionToken: user.sessionToken,
      });
    }
    return this.request(`/classes/${encodeURIComponent(className)}`, {
      method: "POST",
      body,
      sessionToken: user.sessionToken,
    });
  }

  saveOwned(className, values, user, objectId = null) {
    const body = {
      ...values,
      owner: ownerPointer(user.objectId),
      ACL: ownerAcl(user.objectId),
    };
    return this.request(`/classes/${encodeURIComponent(className)}${objectId ? `/${objectId}` : ""}`, {
      method: objectId ? "PUT" : "POST",
      body,
      sessionToken: user.sessionToken,
    });
  }
}

export { ownerAcl, ownerPointer };
