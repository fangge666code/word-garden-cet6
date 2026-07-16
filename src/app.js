import { WORDS } from "./data/cet6-words.js";
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

const STORAGE_KEY = "word-garden-data-v1";
const main = document.querySelector("#main-content");
const toast = document.querySelector("#toast");
const modalRoot = document.querySelector("#modal-root");
const wordMap = new Map(WORDS.map((word) => [word.id, word]));
const wordIds = new Set(wordMap.keys());
let libraryFilter = "all";
let libraryQuery = "";
let flipped = false;
let toastTimer;
let corruptRaw = null;
let needsDataSave = false;

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

function loadData() {
  const raw = localStorage.getItem(STORAGE_KEY);
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

function commit(next) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    data = next;
    applyPreferences();
    return true;
  } catch {
    showToast("保存失败，请先导出记录或释放浏览器空间");
    return false;
  }
}

if (needsDataSave) commit(data);

function applyPreferences() {
  document.body.classList.toggle("reduce-motion", Boolean(data.settings.reduceMotion));
}

function showToast(message) {
  clearTimeout(toastTimer);
  toast.textContent = message;
  toast.classList.add("show");
  toastTimer = setTimeout(() => toast.classList.remove("show"), 3200);
}

function route() {
  return (location.hash.replace("#", "") || "home").split("?")[0];
}

function updateNav(current) {
  document.querySelectorAll("[data-nav]").forEach((link) => {
    const active = link.dataset.nav === current;
    link.classList.toggle("active", active);
    if (active) link.setAttribute("aria-current", "page");
    else link.removeAttribute("aria-current");
  });
  const stats = calculateStats(WORDS, data);
  document.querySelector("#header-streak").textContent = stats.streak ? `已连续学习 ${stats.streak} 天` : "从今天开始";
}

function dateLabel() {
  return new Intl.DateTimeFormat("zh-CN", { month: "long", day: "numeric", weekday: "long" }).format(new Date());
}

function render() {
  const current = route();
  updateNav(current);
  flipped = false;
  if (current === "study") renderStudy();
  else if (current === "library") renderLibrary();
  else if (current === "settings") renderSettings();
  else renderHome();
  main.focus({ preventScroll: true });
}

function renderHome() {
  const stats = calculateStats(WORDS, data);
  const learned = Object.keys(data.progress).length;
  const totalProgress = Math.round((learned / WORDS.length) * 100);
  const todayProgress = Math.min(100, Math.round((stats.todayNew / data.settings.dailyGoal) * 100));
  const activeSession = data.session?.date === localDateKey() && data.session.position < data.session.queue.length;
  const taskDone = stats.today.completed && !stats.due;
  const remainingNew = Math.max(0, data.settings.dailyGoal - stats.todayNew);

  main.innerHTML = `
    <section class="page">
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
            <strong class="word">${escapeHtml(word.word)}</strong>
            <span class="phonetic">${escapeHtml(word.phonetic)}</span>
          </div>
          <div class="word-details" id="word-details" hidden>
            <div class="meaning-block">
              <span class="pos">${escapeHtml(word.pos)}</span>
              <span class="meaning-list">${renderMeaningItems(word.meaning)}</span>
            </div>
            <blockquote class="example">${escapeHtml(word.example)}</blockquote>
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
}

function filterChip(value, label) {
  return `<button class="filter-chip ${libraryFilter === value ? "active" : ""}" data-filter="${value}">${label}</button>`;
}

function wordRow(word) {
  const status = data.progress[word.id]?.status ?? "unseen";
  const labels = { unseen: "未学习", learning: "学习中", mastered: "已掌握" };
  return `<article class="word-row"><div><h3>${escapeHtml(word.word)} <span class="pos">${escapeHtml(word.pos)}</span></h3><p>${escapeHtml(word.meaning)}</p></div><span class="state-pill ${status}">${labels[status]}</span></article>`;
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
          <h2>学习数据</h2><p>数据只保存在当前浏览器。导出备份后，可以在另一台设备上导入。</p>
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
      </div>
    </section>`;
  document.querySelector("#settings-form").addEventListener("submit", saveSettings);
  document.querySelector("#motion-switch").addEventListener("click", toggleMotion);
  document.querySelector("#export-progress").addEventListener("click", exportProgressCsv);
  document.querySelector("#export-data").addEventListener("click", () => exportJson(data, `word-garden-${localDateKey()}.json`));
  document.querySelector("#import-data").addEventListener("change", importData);
  document.querySelector("#clear-data").addEventListener("click", confirmClear);
  document.querySelector("#export-corrupt")?.addEventListener("click", () => downloadText(corruptRaw, `word-garden-damaged-${localDateKey()}.json`));
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
  if (commit({ ...data, settings: { ...data.settings, dailyGoal: goal }, session: null })) showToast("学习设置已保存");
}

function toggleMotion() {
  const next = { ...data, settings: { ...data.settings, reduceMotion: !data.settings.reduceMotion } };
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

document.addEventListener("keydown", (event) => {
  if (route() !== "study") return;
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
applyPreferences();
render();
