import { WORDS } from "./data/cet6-words.js";
import { CLOUD_CONFIG, cloudConfigured } from "./cloud-config.js";
import { mergeLearningData, validateCredentials } from "./lib/account-sync.js";
import {
  activateWaitingWorker,
  checkForUpdate,
  detectRuntime,
  snoozeUpdate,
} from "./lib/app-update.js";
import { syncLearningData } from "./lib/cloud-sync.js";
import {
  buildProgressCsv,
  calculateStats,
  createDefaultData,
  localDateKey,
  makeSession,
  orderWords,
  rateCurrent,
  validateData,
} from "./lib/core.js";
import { speakWord, speechSupported } from "./lib/pronunciation.js?v=2";
import { SupabaseClient } from "./lib/supabase-client.js?v=5";

const STORAGE_KEY = "word-garden-data-v1";
const AUTH_KEY = "word-garden-auth-v1";
const USER_DATA_PREFIX = "word-garden-user-data-v1";
const SYNC_PENDING_PREFIX = "word-garden-sync-pending-v1";
const PROTECTED_ROUTES = new Set(["study", "library", "settings"]);
const main = document.querySelector("#main-content");
const toast = document.querySelector("#toast");
const modalRoot = document.querySelector("#modal-root");
const wordMap = new Map(WORDS.map((word) => [word.id, word]));
const wordIds = new Set(wordMap.keys());
const cloudEnabled = cloudConfigured(CLOUD_CONFIG);
const cloudClient = cloudEnabled ? new SupabaseClient(CLOUD_CONFIG) : null;
let libraryFilter = "all";
let libraryQuery = "";
let flipped = false;
let toastTimer;
let corruptRaw = null;
let needsDataSave = false;
let deferredInstallPrompt = null;
let currentUser = loadStoredUser();
let syncStatus = currentUser ? "waiting" : "anonymous";
let lastSyncedAt = "";
let syncError = "";
let syncTimer = null;
let localRevision = 0;
let serviceWorkerRegistration = null;
let updateCheckPending = false;
let updateReloadRequested = false;

function escapeHtml(value) {
  return String(value).replace(/[&<>"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[char]);
}

function renderMeaningItems(value) {
  return String(value)
    .split(/[；;\n]+/u)
    .map((item) => item.trim())
    .filter(Boolean)
    .map((item) => `<span>${escapeHtml(item)}</span>`)
    .join("");
}

function createShuffleSeed() {
  return globalThis.crypto?.randomUUID?.()
    ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

function ensureShuffleSeed(value) {
  if (value.settings.shuffleSeed) return value;
  return {
    ...value,
    settings: { ...value.settings, shuffleSeed: createShuffleSeed() },
    session: null,
  };
}

function newPersonalData() {
  return ensureShuffleSeed(createDefaultData());
}

function loadStoredUser() {
  try {
    const value = JSON.parse(localStorage.getItem(AUTH_KEY) ?? "null");
    if (value?.objectId && value?.sessionToken && value?.username) return value;
  } catch {
    localStorage.removeItem(AUTH_KEY);
  }
  return null;
}

function activeStorageKey() {
  return currentUser ? `${USER_DATA_PREFIX}:${currentUser.objectId}` : STORAGE_KEY;
}

function pendingSyncKey(user = currentUser) {
  return user ? `${SYNC_PENDING_PREFIX}:${user.objectId}` : "";
}

function loadData() {
  const raw = localStorage.getItem(activeStorageKey());
  if (!raw) {
    needsDataSave = true;
    return newPersonalData();
  }
  try {
    const validated = validateData(JSON.parse(raw), wordIds);
    if (!validated.settings.shuffleSeed) needsDataSave = true;
    const value = ensureShuffleSeed(validated);
    if (value.settings.dailyGoal > WORDS.length) value.settings.dailyGoal = WORDS.length;
    return value;
  } catch (error) {
    corruptRaw = raw;
    queueMicrotask(() => showToast(`本地记录无法读取：${error.message}`));
    return newPersonalData();
  }
}

let data = loadData();

function commit(next, { skipSync = false } = {}) {
  try {
    localStorage.setItem(activeStorageKey(), JSON.stringify(next));
    data = next;
    localRevision += 1;
    applyPreferences();
    if (currentUser && !skipSync) {
      localStorage.setItem(pendingSyncKey(), "1");
      queueCloudSync();
    }
    return true;
  } catch {
    showToast("保存失败，请先导出记录或释放浏览器空间");
    return false;
  }
}

if (needsDataSave) commit(data, { skipSync: true });

function applyPreferences() {
  document.body.classList.toggle("reduce-motion", Boolean(data.settings.reduceMotion));
}

function showToast(message) {
  clearTimeout(toastTimer);
  toast.textContent = message;
  toast.classList.add("show");
  toastTimer = setTimeout(() => toast.classList.remove("show"), 3200);
}

function queueCloudSync() {
  if (!currentUser || !cloudEnabled) return;
  clearTimeout(syncTimer);
  syncTimer = setTimeout(() => syncNow({ silent: true }), 900);
}

function refreshAccountIfVisible() {
  if (route() === "home") renderHome();
}

async function syncNow({ silent = false } = {}) {
  if (!currentUser || !cloudClient) return false;
  if (!navigator.onLine) {
    syncStatus = "waiting";
    syncError = "等待网络连接";
    refreshAccountIfVisible();
    return false;
  }
  const userAtStart = currentUser;
  const revisionAtStart = localRevision;
  syncStatus = "syncing";
  syncError = "";
  refreshAccountIfVisible();
  try {
    let refreshedUser = await cloudClient.restoreSession(userAtStart);
    if (currentUser?.objectId !== userAtStart.objectId) return false;
    currentUser = refreshedUser;
    localStorage.setItem(AUTH_KEY, JSON.stringify(currentUser));
    let result;
    try {
      result = await syncLearningData(cloudClient, refreshedUser, data);
    } catch (error) {
      if (error.code !== "AUTH_EXPIRED" || !refreshedUser.refreshToken) throw error;
      refreshedUser = await cloudClient.restoreSession(refreshedUser, { force: true });
      if (currentUser?.objectId !== userAtStart.objectId) return false;
      currentUser = refreshedUser;
      localStorage.setItem(AUTH_KEY, JSON.stringify(currentUser));
      result = await syncLearningData(cloudClient, refreshedUser, data);
    }
    if (currentUser?.objectId !== userAtStart.objectId) return false;
    const changedDuringSync = revisionAtStart !== localRevision;
    const currentSession = data.session;
    data = changedDuringSync ? mergeLearningData(data, result.data) : result.data;
    data.session = currentSession ?? result.data.session;
    localStorage.setItem(activeStorageKey(), JSON.stringify(data));
    lastSyncedAt = result.syncedAt;
    syncStatus = changedDuringSync ? "waiting" : "synced";
    syncError = "";
    if (changedDuringSync) {
      localStorage.setItem(pendingSyncKey(), "1");
      queueCloudSync();
    } else {
      localStorage.removeItem(pendingSyncKey());
    }
    applyPreferences();
    refreshAccountIfVisible();
    if (!silent) showToast("学习进度已同步");
    return true;
  } catch (error) {
    syncStatus = "failed";
    syncError = error.message;
    localStorage.setItem(pendingSyncKey(), "1");
    refreshAccountIfVisible();
    if (!silent) showToast(error.message);
    return false;
  }
}

function route() {
  return (location.hash.replace("#", "") || "home").split("?")[0];
}

function updateNav(current) {
  document.querySelectorAll("[data-nav]").forEach((link) => {
    const active = link.dataset.nav === current;
    const locked = !currentUser && PROTECTED_ROUTES.has(link.dataset.nav);
    link.classList.toggle("active", active);
    link.classList.toggle("locked", locked);
    if (locked) {
      link.setAttribute("aria-disabled", "true");
      link.tabIndex = -1;
    } else {
      link.removeAttribute("aria-disabled");
      link.removeAttribute("tabindex");
    }
    if (active) link.setAttribute("aria-current", "page");
    else link.removeAttribute("aria-current");
  });
  if (!currentUser) {
    document.querySelector("#header-streak").textContent = "登录后开始学习";
    return;
  }
  const stats = calculateStats(WORDS, data);
  document.querySelector("#header-streak").textContent = stats.streak ? `已连续学习 ${stats.streak} 天` : "从今天开始";
}

function dateLabel() {
  return new Intl.DateTimeFormat("zh-CN", { month: "long", day: "numeric", weekday: "long" }).format(new Date());
}

function render() {
  const current = route();
  if (!currentUser && PROTECTED_ROUTES.has(current)) {
    history.replaceState(null, "", "#home");
    updateNav("home");
    flipped = false;
    renderHome();
    main.focus({ preventScroll: true });
    showToast("请先登录账号，再开始学习");
    return;
  }
  updateNav(current);
  flipped = false;
  if (current === "study") renderStudy();
  else if (current === "library") renderLibrary();
  else if (current === "settings") renderSettings();
  else renderHome();
  main.focus({ preventScroll: true });
}

function renderHome() {
  if (!currentUser) {
    renderSignedOutHome();
    return;
  }
  renderDashboardHome();
}

function renderSignedOutHome() {
  main.innerHTML = `
    <section class="page auth-home">
      <div class="auth-home-intro">
        <div class="date-chip"><span aria-hidden="true">●</span>${dateLabel()}</div>
        <p class="eyebrow">Personal English Routine</p>
        <h1>登录后，让每一次<br>学习自然衔接。</h1>
        <p class="lead">3000 个 CET-6 核心词，按你的专属乱序逐步学习。登录同一账号，手机和电脑都能继续上次的进度。</p>
        <div class="auth-feature-list" aria-label="账号学习功能">
          <span>✓ 新词优先与智能复习</span>
          <span>✓ 单词英式发音</span>
          <span>✓ 多设备云端同步</span>
        </div>
      </div>
      <div class="auth-home-panels">
        ${accountCard()}
        ${installAppCard()}
      </div>
    </section>`;
  bindAccountActions();
}

function renderDashboardHome() {
  const stats = calculateStats(WORDS, data);
  const learned = Object.keys(data.progress).length;
  const totalProgress = Math.round((learned / WORDS.length) * 100);
  const todayProgress = Math.min(100, Math.round((stats.todayNew / data.settings.dailyGoal) * 100));
  const activeSession = data.session?.date === localDateKey() && data.session.position < data.session.queue.length;
  const taskDone = stats.today.completed && !stats.due;
  const remainingNew = Math.max(0, data.settings.dailyGoal - stats.todayNew);

  main.innerHTML = `
    <section class="page">
      <div class="home-account-bar">
        ${accountCard()}
      </div>
      <div class="home-hero">
        <div>
          <div class="date-chip"><span aria-hidden="true">●</span>${dateLabel()}</div>
          <p class="eyebrow">Personal English Routine</p>
          <h1>今天，也让单词<br>生长一点。</h1>
          <p class="lead">先认识今天的新词，再巩固到期复习。每一次回忆，都会让记忆的根系更稳固。</p>
        </div>
        <aside class="task-card">
          <span class="label">TODAY'S SESSION</span>
          <h2>${taskDone ? "今日任务完成" : activeSession ? "继续今天的学习" : "准备好了吗？"}</h2>
          <p>${taskDone ? "很棒，明天再回来照料你的词汇花园。" : `还有 ${stats.due} 个复习词和 ${remainingNew} 个新词等待你。`}</p>
          <button class="primary-button" id="start-study">${taskDone ? "查看今日结果" : activeSession ? "继续学习 →" : "开始学习 →"}</button>
        </aside>
      </div>

      <div class="stat-grid" aria-label="今日学习统计">
        ${statCard("今日新词", stats.todayNew, "＋")}
        ${statCard("待复习", stats.due, "↻")}
        ${statCard("连续天数", stats.streak, "♢")}
        ${statCard("累计掌握", stats.mastered, "✓")}
      </div>

      <div class="progress-section">
        <section class="panel">
          <div class="panel-title"><h2>今日进度</h2><span class="muted">${stats.todayNew} / ${data.settings.dailyGoal}</span></div>
          <div class="progress-track"><div class="progress-fill" style="width:${todayProgress}%"></div></div>
          <div class="progress-meta"><span>每日目标</span><span>${todayProgress}%</span></div>
        </section>
        <section class="panel">
          <div class="panel-title"><h2>CET-6 词库</h2><span class="muted">${learned} / ${WORDS.length}</span></div>
          <div class="progress-track"><div class="progress-fill" style="width:${totalProgress}%"></div></div>
          <div class="progress-meta"><span>已接触词汇</span><span>${totalProgress}%</span></div>
        </section>
      </div>
    </section>`;

  document.querySelector("#start-study").addEventListener("click", () => {
    const next = { ...data, session: makeSession(WORDS, data) };
    if (commit(next)) location.hash = "study";
  });
  bindAccountActions();
}

function statCard(label, value, icon) {
  return `<article class="stat-card"><div class="stat-top"><span>${label}</span><span class="stat-icon" aria-hidden="true">${icon}</span></div><div class="stat-value">${value}</div></article>`;
}

function ensureSession() {
  const session = makeSession(WORDS, data);
  if (session !== data.session) commit({ ...data, session });
  return data.session;
}

function renderStudy() {
  const session = ensureSession();
  if (!session.queue.length || session.position >= session.queue.length) {
    renderCompletion(session.results);
    return;
  }
  const entry = session.queue[session.position];
  const word = wordMap.get(entry.id);
  if (!word) {
    showToast("学习队列包含未知单词，已重新生成");
    commit({ ...data, session: null });
    renderStudy();
    return;
  }
  const completed = session.position;
  const percentage = Math.round((completed / session.queue.length) * 100);
  main.innerHTML = `
    <section class="page study-page">
      <div class="study-wrap">
        <div class="study-top">
          <a class="icon-button" href="#home" aria-label="退出学习">×</a>
          <div class="progress-track" aria-label="本次学习进度"><div class="progress-fill" style="width:${percentage}%"></div></div>
          <span class="study-count">${session.position + 1} / ${session.queue.length}</span>
        </div>
        <article class="word-card" id="word-card" role="button" tabindex="0" aria-label="单词卡片，点击查看释义" aria-expanded="false">
          <span class="word-tag">${entry.source === "new" ? "NEW WORD" : entry.source === "retry" ? "TRY AGAIN" : "REVIEW"}</span>
          <div class="word-heading">
            <div class="spoken-word">
              <strong class="word">${escapeHtml(word.word)}</strong>
              <button class="speak-button" type="button" data-speak-word="${escapeHtml(word.word)}" aria-label="播放 ${escapeHtml(word.word)} 的英式发音">🔊</button>
            </div>
            <span class="phonetic">${escapeHtml(word.phonetic)}</span>
          </div>
          <div class="word-details" id="word-details" hidden>
            <div class="meaning-block">
              <span class="pos">${escapeHtml(word.pos)}</span>
              <span class="meaning-list">${renderMeaningItems(word.meaning)}</span>
            </div>
            <blockquote class="example">
              <span class="example-en">${escapeHtml(word.example)}</span>
              ${word.exampleZh ? `<span class="example-zh">${escapeHtml(word.exampleZh)}</span>` : ""}
            </blockquote>
            <p class="answer-hint">想好了吗？在下方评价你的记忆</p>
          </div>
          <p class="reveal-hint" id="reveal-hint">点击卡片查看释义 · 空格键展开</p>
        </article>
        <div class="rating-row" id="rating-row" hidden>
          <button class="rating-button forgot" data-rating="forgot">忘记了<small>1 · 稍后再见</small></button>
          <button class="rating-button fuzzy" data-rating="fuzzy">有点模糊<small>2 · 2 天后</small></button>
          <button class="rating-button known" data-rating="known">认识<small>3 · 延长间隔</small></button>
        </div>
      </div>
    </section>`;
  const card = document.querySelector("#word-card");
  const ratings = document.querySelector("#rating-row");
  card.addEventListener("click", () => flipCard(card, ratings));
  bindPronunciationButtons();
  ratings.querySelectorAll("[data-rating]").forEach((button) => {
    button.addEventListener("click", () => submitRating(button.dataset.rating));
  });
}

function flipCard(card, ratings) {
  if (flipped) return;
  flipped = true;
  card.classList.add("revealed");
  card.setAttribute("aria-expanded", "true");
  card.setAttribute("aria-label", "已显示单词释义");
  card.querySelector("#word-details").hidden = false;
  card.querySelector("#reveal-hint").hidden = true;
  ratings.hidden = false;
  ratings.querySelector("button").focus();
}

function submitRating(rating) {
  if (!flipped) return;
  try {
    const next = rateCurrent(data, rating);
    if (commit(next)) {
      flipped = false;
      renderStudy();
    }
  } catch (error) {
    showToast(error.message);
  }
}

function renderCompletion(results = { new: 0, review: 0, known: 0 }) {
  main.innerHTML = `
    <section class="page study-page">
      <div class="study-wrap completion">
        <div class="completion-mark">✓</div>
        <p class="eyebrow">Session Complete</p>
        <h1 style="font-size:42px">今天的记忆，已经种下。</h1>
        <p class="lead" style="margin-inline:auto">短暂而持续的练习，比偶尔的一次冲刺更有力量。</p>
        <div class="result-grid">
          <div><strong>${results.new}</strong><span>新学单词</span></div>
          <div><strong>${results.review}</strong><span>复习单词</span></div>
          <div><strong>${results.known}</strong><span>选择认识</span></div>
        </div>
        <a class="secondary-button" href="#home">返回今日首页</a>
      </div>
    </section>`;
}

function renderLibrary() {
  const filtered = orderWords(WORDS, data.settings.shuffleSeed).filter((word) => {
    const progress = data.progress[word.id];
    const state = progress?.status ?? "unseen";
    const matchesFilter = libraryFilter === "all" || libraryFilter === state;
    const query = libraryQuery.trim().toLowerCase();
    const matchesQuery = !query || word.word.includes(query) || word.meaning.includes(query);
    return matchesFilter && matchesQuery;
  });
  main.innerHTML = `
    <section class="page">
      <div class="page-head">
        <div><p class="eyebrow">CET-6 Library</p><h1>我的词库</h1><p class="muted">${WORDS.length} 个核心词条，慢慢认识，不必着急。</p></div>
        <label class="search-box"><span aria-hidden="true">⌕</span><input id="word-search" type="search" value="${escapeHtml(libraryQuery)}" placeholder="搜索英文或中文释义" aria-label="搜索词库"></label>
      </div>
      <div class="filter-row" aria-label="词汇状态筛选">
        ${filterChip("all", "全部")}${filterChip("unseen", "未学习")}${filterChip("learning", "学习中")}${filterChip("mastered", "已掌握")}
      </div>
      <div class="word-list" aria-live="polite">
        ${filtered.length ? filtered.map(wordRow).join("") : '<div class="empty">没有找到匹配的单词，换个关键词试试。</div>'}
      </div>
    </section>`;
  document.querySelector("#word-search").addEventListener("input", (event) => {
    libraryQuery = event.target.value;
    renderLibrary();
    const input = document.querySelector("#word-search");
    input.focus();
    input.setSelectionRange(input.value.length, input.value.length);
  });
  document.querySelectorAll("[data-filter]").forEach((button) => button.addEventListener("click", () => {
    libraryFilter = button.dataset.filter;
    renderLibrary();
  }));
  bindPronunciationButtons();
}

function filterChip(value, label) {
  return `<button class="filter-chip ${libraryFilter === value ? "active" : ""}" data-filter="${value}">${label}</button>`;
}

function wordRow(word) {
  const status = data.progress[word.id]?.status ?? "unseen";
  const labels = { unseen: "未学习", learning: "学习中", mastered: "已掌握" };
  return `<article class="word-row"><div class="word-row-copy"><h3>${escapeHtml(word.word)} <span class="pos">${escapeHtml(word.pos)}</span></h3><p>${escapeHtml(word.meaning)}</p></div><div class="word-row-actions"><button class="speak-button" type="button" data-speak-word="${escapeHtml(word.word)}" aria-label="播放 ${escapeHtml(word.word)} 的英式发音">🔊</button><span class="state-pill ${status}">${labels[status]}</span></div></article>`;
}

function bindPronunciationButtons(root = document) {
  root.querySelectorAll("[data-speak-word]").forEach((button) => {
    const supported = speechSupported(window);
    button.disabled = !supported;
    if (!supported) button.title = "当前设备暂不支持单词发音";
    button.addEventListener("click", async (event) => {
      event.stopPropagation();
      const result = await speakWord(button.dataset.speakWord);
      if (result.ok) return;
      const messages = {
        "missing-language": "手机缺少英文语音数据，请在系统设置中安装英文文字转语音语音包",
        "native-unavailable": "手机没有可用的文字转语音引擎，请先在系统设置中启用",
        "playback-failed": "手机未能播放这个单词，请检查媒体音量后重试",
      };
      showToast(messages[result.reason] ?? "当前设备暂不支持单词发音");
    });
  });
}

function renderSettings() {
  main.innerHTML = `
    <section class="page">
      <div class="page-head"><div><p class="eyebrow">Preferences & Data</p><h1>设置</h1><p class="muted">调整学习节奏，也别忘了偶尔备份记录。</p></div></div>
      <div class="settings-grid">
        <section class="settings-card">
          <h2>学习偏好</h2><p>选择一个能长期坚持的数量，比一开始学得很多更重要。</p>
          <form id="settings-form">
            <div class="field"><label for="daily-goal">每日新词数量</label><input id="daily-goal" name="dailyGoal" type="number" min="1" max="${WORDS.length}" step="1" value="${data.settings.dailyGoal}" required><div class="field-note">可设置 1–${WORDS.length} 个，默认建议 20 个</div></div>
            <div class="switch-line"><div><strong>减少动画</strong><div class="field-note">关闭卡片翻转等动态效果</div></div><button type="button" id="motion-switch" class="switch ${data.settings.reduceMotion ? "on" : ""}" role="switch" aria-checked="${data.settings.reduceMotion}" aria-label="减少动画"></button></div>
            <button class="secondary-button" type="submit">保存设置</button>
          </form>
        </section>
        <section class="settings-card">
          <h2>学习数据</h2><p>本地记录会在后台同步到你的账号，也可以继续手动备份。</p>
          <div class="data-note">当前已记录 ${Object.keys(data.progress).length} 个单词的学习进度。导入会整体替换现有记录。</div>
          <div class="divider"></div>
          <div class="button-row">
            <button class="secondary-button" id="export-progress">导出学习状态表格</button>
            <button class="secondary-button" id="export-data">导出完整备份</button>
            <label class="secondary-button file-label">导入记录<input id="import-data" type="file" accept="application/json,.json"></label>
            ${corruptRaw ? '<button class="secondary-button" id="export-corrupt">导出损坏数据</button>' : ""}
          </div>
          <div class="divider"></div>
          <button class="danger-button" id="clear-data">清空全部记录</button>
        </section>
        ${installAppCard()}
      </div>
    </section>`;
  document.querySelector("#settings-form").addEventListener("submit", saveSettings);
  document.querySelector("#motion-switch").addEventListener("click", toggleMotion);
  document.querySelector("#export-progress").addEventListener("click", exportProgressCsv);
  document.querySelector("#export-data").addEventListener("click", () => exportJson(data, `word-garden-${localDateKey()}.json`));
  document.querySelector("#import-data").addEventListener("change", importData);
  document.querySelector("#clear-data").addEventListener("click", confirmClear);
  document.querySelector("#export-corrupt")?.addEventListener("click", () => downloadText(corruptRaw, `word-garden-damaged-${localDateKey()}.json`));
  document.querySelector("#install-app")?.addEventListener("click", installApp);
  bindUpdateActions();
}

function bindAccountActions() {
  document.querySelector("#install-app")?.addEventListener("click", installApp);
  document.querySelector("#login-form")?.addEventListener("submit", loginAccount);
  document.querySelector("#register-form")?.addEventListener("submit", registerAccount);
  document.querySelector("#sync-now")?.addEventListener("click", () => syncNow());
  document.querySelector("#reauth-account")?.addEventListener("click", reauthAccount);
  document.querySelector("#logout-account")?.addEventListener("click", logoutAccount);
  bindUpdateActions();
}

function bindUpdateActions() {
  document.querySelectorAll("[data-check-update]").forEach((button) => {
    button.addEventListener("click", () => performUpdateCheck({ force: true }));
  });
}

function syncLabel() {
  if (syncStatus === "syncing") return "正在同步…";
  if (syncStatus === "synced") return lastSyncedAt ? `已同步 · ${formatLocalDate(lastSyncedAt)}` : "已同步";
  if (syncStatus === "failed") return `同步失败 · ${syncError}`;
  return syncError || "等待同步";
}

function accountCard() {
  if (!cloudEnabled) {
    return `
      <section class="settings-card account-card">
        <div><p class="eyebrow">Cloud account</p><h2>账号与多设备同步</h2><p>账号功能已经准备完成，连接云端应用后即可开放注册和跨设备同步。</p></div>
        <span class="sync-pill waiting">等待云服务配置</span>
      </section>`;
  }
  if (currentUser) {
    return `
      <section class="settings-card account-card">
        <div class="account-avatar" aria-hidden="true">${escapeHtml(currentUser.username.slice(0, 1).toUpperCase())}</div>
        <div><p class="eyebrow">Signed in</p><h2>${escapeHtml(currentUser.username)}</h2><p>此账号的学习记录会在手机和电脑之间同步。</p></div>
        <div class="account-actions">
          <span class="sync-pill ${syncStatus}">${escapeHtml(syncLabel())}</span>
          ${syncStatus === "failed" && syncError.includes("登录状态已失效")
            ? '<button class="secondary-button" id="reauth-account">重新登录</button>'
            : '<button class="secondary-button" id="sync-now">立即同步</button>'}
          <button class="secondary-button" type="button" data-check-update>检查更新</button>
          <button class="text-button" id="logout-account">退出账号</button>
        </div>
      </section>`;
  }
  return `
    <section class="settings-card account-auth-card">
      <div class="account-intro"><p class="eyebrow">Cloud account</p><h2>登录后开始学习</h2><p>使用自定义用户名和密码，在手机和电脑之间继续同一份学习进度。</p></div>
      <div class="auth-grid">
        <form id="login-form" class="auth-form">
          <h3>登录</h3>
          <label>用户名<input name="username" autocomplete="username" minlength="3" maxlength="20" required></label>
          <label>密码<input name="password" type="password" autocomplete="current-password" minlength="8" required></label>
          <button class="primary-button" type="submit">登录账号</button>
        </form>
        <form id="register-form" class="auth-form">
          <h3>注册</h3>
          <label>用户名<input name="username" autocomplete="username" minlength="3" maxlength="20" required></label>
          <label>密码<input name="password" type="password" autocomplete="new-password" minlength="8" required></label>
          <label>确认密码<input name="confirmation" type="password" autocomplete="new-password" minlength="8" required></label>
          <p class="auth-warning">请牢记密码：本版本不提供密码找回。</p>
          <button class="secondary-button" type="submit">创建账号</button>
        </form>
      </div>
    </section>`;
}

async function loginAccount(event) {
  event.preventDefault();
  const form = event.currentTarget;
  try {
    const credentials = validateCredentials(form.elements.username.value, form.elements.password.value);
    setFormBusy(form, true);
    const user = await cloudClient.login(credentials.username, credentials.password);
    showMigrationChoice(user, false);
  } catch (error) {
    showToast(error.message);
  } finally {
    setFormBusy(form, false);
  }
}

async function registerAccount(event) {
  event.preventDefault();
  const form = event.currentTarget;
  try {
    const credentials = validateCredentials(form.elements.username.value, form.elements.password.value, form.elements.confirmation.value);
    setFormBusy(form, true);
    const user = await cloudClient.register(credentials.username, credentials.password);
    showMigrationChoice(user, true);
  } catch (error) {
    showToast(error.message);
  } finally {
    setFormBusy(form, false);
  }
}

function setFormBusy(form, busy) {
  form.querySelectorAll("input, button").forEach((control) => { control.disabled = busy; });
}

function showMigrationChoice(user, isNewAccount) {
  modalRoot.innerHTML = `
    <div class="modal-backdrop" role="presentation">
      <section class="modal" role="dialog" aria-modal="true" aria-labelledby="migration-title">
        <h2 id="migration-title">${isNewAccount ? "账号创建成功" : "登录成功"}</h2>
        <p>是否把当前设备已有的 ${Object.keys(data.progress).length} 个单词记录合并到账号？</p>
        <div class="button-row"><button class="primary-button" id="merge-local-data">合并本机记录</button><button class="secondary-button" id="cloud-data-only">只使用账号记录</button></div>
      </section>
    </div>`;
  document.querySelector("#merge-local-data").addEventListener("click", () => activateAccount(user, true));
  document.querySelector("#cloud-data-only").addEventListener("click", () => activateAccount(user, false));
  document.querySelector("#merge-local-data").focus();
}

async function activateAccount(user, mergeAnonymous) {
  const anonymousData = structuredClone(data);
  currentUser = {
    objectId: user.objectId,
    username: user.username,
    sessionToken: user.sessionToken,
    refreshToken: user.refreshToken,
    expiresAt: user.expiresAt,
  };
  localStorage.setItem(AUTH_KEY, JSON.stringify(currentUser));
  const userKey = activeStorageKey();
  let userData = createDefaultData();
  const cached = localStorage.getItem(userKey);
  if (cached) {
    try { userData = validateData(JSON.parse(cached), wordIds); } catch { userData = createDefaultData(); }
  }
  data = ensureShuffleSeed(mergeAnonymous ? mergeLearningData(anonymousData, userData) : userData);
  data.session = null;
  syncStatus = "waiting";
  syncError = "";
  modalRoot.innerHTML = "";
  commit(data, { skipSync: true });
  localStorage.setItem(pendingSyncKey(), "1");
  render();
  const synced = await syncNow();
  if (synced && mergeAnonymous) localStorage.setItem(STORAGE_KEY, JSON.stringify(newPersonalData()));
}

async function logoutAccount() {
  if (!currentUser) return;
  const user = currentUser;
  const synced = await syncNow({ silent: true });
  if (!synced) {
    if (syncError.includes("登录状态已失效")) {
      reauthAccount();
      return;
    }
    showToast("仍有记录未同步，请联网同步后再退出");
    return;
  }
  try { await cloudClient.logout(user); } catch { /* Local logout still protects this device. */ }
  localStorage.removeItem(`${USER_DATA_PREFIX}:${user.objectId}`);
  localStorage.removeItem(`${SYNC_PENDING_PREFIX}:${user.objectId}`);
  localStorage.removeItem(AUTH_KEY);
  currentUser = null;
  syncStatus = "anonymous";
  lastSyncedAt = "";
  syncError = "";
  needsDataSave = false;
  data = loadData();
  if (needsDataSave) commit(data, { skipSync: true });
  showToast("已安全退出账号");
  render();
}

function reauthAccount() {
  if (!currentUser) return;
  let anonymousData = createDefaultData();
  const anonymousRaw = localStorage.getItem(STORAGE_KEY);
  if (anonymousRaw) {
    try { anonymousData = validateData(JSON.parse(anonymousRaw), wordIds); } catch { anonymousData = createDefaultData(); }
  }
  const preserved = ensureShuffleSeed(mergeLearningData(anonymousData, data));
  preserved.session = data.session;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(preserved));
  localStorage.removeItem(AUTH_KEY);
  currentUser = null;
  syncStatus = "anonymous";
  lastSyncedAt = "";
  syncError = "";
  data = preserved;
  showToast("本机记录已保留，请重新登录同一账号");
  render();
}

function isStandaloneApp() {
  return window.matchMedia("(display-mode: standalone)").matches || window.navigator.standalone === true;
}

function isAppleMobile() {
  return /iphone|ipad|ipod/iu.test(window.navigator.userAgent);
}

function isAndroidDevice() {
  return /android/iu.test(window.navigator.userAgent);
}

function isNativeApp() {
  return window.Capacitor?.isNativePlatform?.() === true;
}

function installAppCard() {
  let message = "在浏览器菜单中选择“安装应用”或“添加到主屏幕”，即可像普通 App 一样打开词间。";
  let action = "";
  if (isNativeApp()) {
    message = "你正在使用词间安卓版。登录同一账号后，手机和电脑会自动同步学习记录。";
    action = '<span class="installed-badge">✓ 安卓版已安装</span>';
  } else if (isAndroidDevice()) {
    message = "下载 APK 后按提示安装。华为手机如有安全提示，请允许浏览器安装外部来源应用。";
    action = '<a class="primary-button" href="https://github.com/fangge666code/word-garden-cet6/releases/latest/download/word-garden-android.apk">下载安卓版 APK</a>';
  } else if (isStandaloneApp()) {
    message = "词间已经以 App 模式运行。学习记录会继续保存在这台设备中。";
    action = '<span class="installed-badge">✓ 已安装</span>';
  } else if (deferredInstallPrompt) {
    message = "安装后会在桌面生成词间图标，并使用独立窗口打开。使用时需要连接网络。";
    action = '<button class="primary-button" id="install-app">安装词间 App</button>';
  } else if (isAppleMobile()) {
    message = "请使用 Safari 打开本网站，点击分享按钮，再选择“添加到主屏幕”。使用时需要连接网络。";
  }
  action += '<button class="secondary-button" type="button" data-check-update>检查更新</button>';
  return `
    <section class="settings-card install-app-card">
      <div class="install-mark" aria-hidden="true">W</div>
      <div><p class="eyebrow">Install on your phone</p><h2>安装词间 App</h2><p>${message}</p></div>
      <div class="install-action">${action}</div>
    </section>`;
}

async function installApp() {
  if (!deferredInstallPrompt) return;
  const promptEvent = deferredInstallPrompt;
  await promptEvent.prompt();
  const choice = await promptEvent.userChoice;
  if (choice.outcome === "accepted") {
    deferredInstallPrompt = null;
    showToast("安装请求已确认");
  }
  if (route() === "home") renderHome();
}

async function performUpdateCheck({ force = false } = {}) {
  if (updateCheckPending) return;
  updateCheckPending = true;
  const runtime = detectRuntime(window);
  try {
    const result = await checkForUpdate({
      force,
      runtime,
      registration: serviceWorkerRegistration,
    });
    if (result.action === "none") {
      if (force) {
        showToast(result.reason === "network" ? "暂时无法检查更新，请稍后再试" : "当前已是最新版本");
      }
      return;
    }
    if (!modalRoot.childElementCount) showUpdatePrompt(result, runtime);
  } finally {
    updateCheckPending = false;
  }
}

function showUpdatePrompt(result, runtime) {
  const labels = {
    android: "立即更新",
    pwa: "立即升级",
    web: "立即刷新",
  };
  const notes = result.manifest?.releaseNotes ?? ["新版本已经准备好，可以由你选择何时升级。"];
  const version = result.manifest?.versionName ? ` v${escapeHtml(result.manifest.versionName)}` : "";
  modalRoot.innerHTML = `
    <div class="modal-backdrop" role="presentation">
      <section class="modal update-modal" role="dialog" aria-modal="true" aria-labelledby="update-title">
        <p class="eyebrow">Update available</p>
        <h2 id="update-title">词间${version} 可以升级</h2>
        <ul class="update-notes">${notes.map((note) => `<li>${escapeHtml(note)}</li>`).join("")}</ul>
        <div class="button-row update-actions">
          <button class="primary-button" id="apply-update">${labels[runtime]}</button>
          <button class="secondary-button" id="snooze-update">稍后提醒</button>
        </div>
      </section>
    </div>`;
  document.querySelector("#apply-update").addEventListener("click", () => applyAvailableUpdate(result, runtime));
  document.querySelector("#snooze-update").addEventListener("click", () => {
    snoozeUpdate();
    modalRoot.innerHTML = "";
    showToast("已设置为 24 小时后提醒");
  });
  document.querySelector("#apply-update").focus();
}

async function applyAvailableUpdate(result, runtime) {
  if (runtime === "android") {
    const opened = window.open(result.manifest?.apkUrl, "_blank", "noopener,noreferrer");
    if (!opened) showToast("浏览器未能打开下载页，请允许弹出窗口后重试");
    modalRoot.innerHTML = "";
    return;
  }
  if (runtime === "web") {
    location.reload();
    return;
  }
  updateReloadRequested = true;
  await serviceWorkerRegistration?.update();
  if (serviceWorkerRegistration?.waiting) {
    activateWaitingWorker(serviceWorkerRegistration);
    return;
  }
  const installing = serviceWorkerRegistration?.installing;
  if (!installing) {
    updateReloadRequested = false;
    showToast("新版正在准备中，请稍后再次检查更新");
    modalRoot.innerHTML = "";
    return;
  }
  installing.addEventListener("statechange", () => {
    if (installing.state === "installed" && serviceWorkerRegistration?.waiting) {
      activateWaitingWorker(serviceWorkerRegistration);
    }
  });
}

function saveSettings(event) {
  event.preventDefault();
  const input = document.querySelector("#daily-goal");
  const goal = Number(input.value);
  if (!Number.isInteger(goal) || goal < 1 || goal > WORDS.length) {
    showToast(`请输入 1 到 ${WORDS.length} 之间的整数`);
    input.focus();
    return;
  }
  if (commit({ ...data, settings: { ...data.settings, dailyGoal: goal }, settingsUpdatedAt: new Date().toISOString(), session: null })) showToast("学习设置已保存");
}

function toggleMotion() {
  const next = { ...data, settings: { ...data.settings, reduceMotion: !data.settings.reduceMotion }, settingsUpdatedAt: new Date().toISOString() };
  if (commit(next)) renderSettings();
}

function exportJson(value, filename) {
  downloadText(JSON.stringify(value, null, 2), filename);
  showToast("学习记录已导出");
}

function formatLocalDate(value) {
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).format(new Date(value));
}

function exportProgressCsv() {
  const orderedWords = orderWords(WORDS, data.settings.shuffleSeed);
  if (!orderedWords.some((word) => data.progress[word.id])) {
    showToast("还没有接触过单词，暂时没有可导出的学习状态");
    return;
  }
  try {
    const csv = buildProgressCsv(orderedWords, data, formatLocalDate);
    downloadText(csv, `词间-学习状态-${localDateKey()}.csv`, "text/csv;charset=utf-8");
    showToast("学习状态表格已导出，可使用 Excel 或 WPS 打开");
  } catch {
    showToast("表格生成失败，学习记录没有受到影响");
  }
}

function downloadText(text, filename, type = "application/json;charset=utf-8") {
  const blob = new Blob([text], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

async function importData(event) {
  const file = event.target.files?.[0];
  if (!file) return;
  try {
    const imported = ensureShuffleSeed(validateData(JSON.parse(await file.text()), wordIds));
    if (imported.settings.dailyGoal > WORDS.length) throw new Error(`每日目标不能超过 ${WORDS.length}`);
    imported.session = null;
    if (commit(imported)) {
      corruptRaw = null;
      showToast("导入成功，学习记录已恢复");
      renderSettings();
    }
  } catch (error) {
    showToast(`导入失败：${error.message}`);
  } finally {
    event.target.value = "";
  }
}

function confirmClear() {
  modalRoot.innerHTML = `<div class="modal-backdrop" role="presentation"><section class="modal" role="dialog" aria-modal="true" aria-labelledby="clear-title"><h2 id="clear-title">确定清空全部记录？</h2><p>所有学习进度、连续天数和设置都会恢复初始状态。此操作无法撤销，建议先导出备份。</p><div class="button-row"><button class="danger-button" id="confirm-clear">确认清空</button><button class="secondary-button" id="cancel-clear">取消</button></div></section></div>`;
  document.querySelector("#confirm-clear").addEventListener("click", () => {
    if (commit(newPersonalData())) {
      modalRoot.innerHTML = "";
      showToast("学习记录已清空");
      renderSettings();
    }
  });
  document.querySelector("#cancel-clear").addEventListener("click", () => { modalRoot.innerHTML = ""; });
  document.querySelector("#cancel-clear").focus();
}

async function restoreAccountSession() {
  if (!currentUser || !cloudClient) return;
  if (localStorage.getItem(pendingSyncKey())) syncStatus = "waiting";
  await syncNow({ silent: true });
}

document.addEventListener("keydown", (event) => {
  if (route() !== "study") return;
  if (event.target.closest?.("[data-speak-word]")) return;
  const card = document.querySelector("#word-card");
  if (!card) return;
  if ((event.code === "Space" || event.code === "Enter") && !flipped) {
    event.preventDefault();
    flipCard(card, document.querySelector("#rating-row"));
  } else if (flipped && ["1", "2", "3"].includes(event.key)) {
    event.preventDefault();
    submitRating({ "1": "forgot", "2": "fuzzy", "3": "known" }[event.key]);
  }
});

window.addEventListener("hashchange", render);
window.addEventListener("beforeinstallprompt", (event) => {
  event.preventDefault();
  deferredInstallPrompt = event;
  if (route() === "home" || route() === "settings") render();
});
window.addEventListener("appinstalled", () => {
  deferredInstallPrompt = null;
  showToast("词间 App 已安装");
  if (route() === "home" || route() === "settings") render();
});
window.addEventListener("online", () => {
  if (currentUser) syncNow({ silent: true });
});
window.addEventListener("offline", () => {
  if (!currentUser) return;
  syncStatus = "waiting";
  syncError = "等待网络连接";
  refreshAccountIfVisible();
});
window.addEventListener("load", () => {
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.addEventListener("controllerchange", () => {
      if (!updateReloadRequested) return;
      updateReloadRequested = false;
      location.reload();
    });
    navigator.serviceWorker.register("./service-worker.js", { scope: "./", updateViaCache: "none" })
      .then((registration) => {
        serviceWorkerRegistration = registration;
        return performUpdateCheck();
      })
      .catch((error) => {
        console.warn("Service worker registration failed", error);
        return performUpdateCheck();
      });
  } else {
    performUpdateCheck();
  }
});
applyPreferences();
render();
restoreAccountSession();
