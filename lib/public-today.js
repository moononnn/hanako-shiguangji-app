// 拾光记 · 对外快照（public-today.json）
//
// 给别的消费方（聊天类 App 等）读的只读快照：今天是什么日子、窗外什么样、
// 以及每位伙伴自己那段已收好的生活日。
//
// App 对外契约：shiguangji-app / today，经 ctx.publicData 发布给获授权的消费方。
// dataDir 内 public-today.json 仍保留作本地快照；消费方不再猜旧插件的磁盘路径。
//
// 三条纪律，跟表情包那份对外索引同源：
//   1. **不做选择、不做裁剪之外的加工**。快照只摊平事实；谁看得到哪一段由消费方按契约取。
//   2. **不改动任何现有注入逻辑**。这是纯新增的一条出口，坏了也只坏这一条。
//   3. 格式冻结在 schemaVersion 上，内部账本怎么改都不影响这份门面。
//      契约文档见仓库根目录 PUBLIC-TODAY.md。
//
// 隐私边界（要紧的一条）：做册是「谁的归谁」。快照里按 agentId 分组各存一份，
// 消费方只许取自己那一份，不许把别人的档案当自己的记忆用。

import fs from "node:fs";
import path from "node:path";
import { getBuiltinFestivals, isWorkday } from "./festivals.js";
import { dateKey, filterDueTodos, todoClockMinutesLeft } from "./data.js";
import { selectRecentSummaries } from "./recent-summaries.js";
import { weatherCacheIsFresh, weatherCacheMatches, normalizeWeatherResult } from "./weather.js";

export const PUBLIC_TODAY_FILE_NAME = "public-today.json";
export const PUBLIC_TODAY_SCHEMA_VERSION = 1;
/** 每位伙伴最多带几段生活日回顾（按结束的生活日，一般 3 段就够）。 */
export const SUMMARY_MAX_ENTRIES = 6;
/** 每位伙伴的回顾总字数上限，跟主对话注入同一档。 */
export const SUMMARY_CHAR_BUDGET = 1800;
/**
 * 到点那份提前多久摊给聊天类消费方（分钟）。
 * 对方要跑模型想措辞，落在钟点准发一定晚；提前这么几分钟，误差就只剩模型那一点。
 * 不用卡得死：早一点晚一点都在这个量级里。
 */
export const TODO_DUE_LEAD_MINUTES = 6;
/** 未完成待办最多摊几条给消费方认领，多了认不准反而会勾错。 */
export const PENDING_LIMIT = 12;
/** 单条标题/地名的截断长度，防脏数据把快照撑爆。 */
const TEXT_LIMIT = 60;
/** 今天到期待办最多列几条。 */
const TODO_LIMIT = 20;
/** 去抖窗口：短时间内的多次刷新请求合成一次写盘。 */
const SCHEDULE_DEBOUNCE_MS = 2000;

const WEEKDAYS = ["日", "一", "二", "三", "四", "五", "六"];

function cleanText(value, maxLength = TEXT_LIMIT) {
  return String(value ?? "").replace(/[\u0000-\u001F\u007F]/g, "").trim().slice(0, maxLength);
}

function cleanList(values, limit = 20) {
  return (Array.isArray(values) ? values : [])
    .map((item) => cleanText(item))
    .filter(Boolean)
    .slice(0, limit);
}

export function publicTodayPath(dataDir) {
  return path.join(String(dataDir || "."), PUBLIC_TODAY_FILE_NAME);
}

/** 读一份天气缓存；没开天气、地点不符或缓存过期都当没有。 */
export function readSnapshotWeather(data, settings = {}, now = new Date()) {
  if (settings.weatherEnabled === false) return null;
  try {
    const cache = data.getWeatherCache();
    if (!weatherCacheMatches(cache, settings)) return null;
    if (!weatherCacheIsFresh(cache, settings, now)) return null;
    const normalized = normalizeWeatherResult(cache.result);
    if (!normalized || !String(normalized.line || "").trim()) return null;
    const temp = Number(normalized.temp);
    return {
      place: cleanText(normalized.place || cache.location || "", 40),
      line: cleanText(normalized.line, 120),
      temp: Number.isFinite(temp) ? temp : null,
    };
  } catch {
    return null;
  }
}

/**
 * 按伙伴分组收集已收好的生活日。
 *
 * 每位伙伴单独跑一次选择器（currentAgentId 固定成 ta 自己、shared=false），
 * 这样每个人拿到的都是「自己的近 3 个结束生活日 + 自己的字符预算」，
 * 不会因为别人档案多就把自己的挤掉。
 *
 * @returns {Record<string, Array<{date: string, text: string}>>}
 */
export function collectSnapshotSummaries(data, { now = new Date(), boundaryHour = 4 } = {}) {
  let entries = [];
  try {
    entries = data.listSummaryEntries();
  } catch {
    return {};
  }
  const agentIds = [...new Set(
    (Array.isArray(entries) ? entries : [])
      .map((entry) => String(entry?.agentId || "").trim())
      .filter(Boolean)
  )];
  const out = {};
  for (const agentId of agentIds) {
    const picked = selectRecentSummaries(entries, {
      now,
      boundaryHour,
      currentAgentId: agentId,
      shared: false,
      maxEntries: SUMMARY_MAX_ENTRIES,
      maxChars: SUMMARY_CHAR_BUDGET,
    });
    const rows = (picked.entries || [])
      .map((entry) => ({ date: cleanText(entry.date, 10), text: cleanText(entry.text, SUMMARY_CHAR_BUDGET) }))
      .filter((row) => row.date && row.text);
    if (rows.length) out[agentId] = rows;
  }
  return out;
}

/**
 * 组一份快照。纯组装，数据从传进来的 data 上读（测试传假对象即可）。
 * @returns {object} 快照对象
 */
export function buildPublicToday({ now = new Date(), data, settings = null } = {}) {
  const resolved = settings || (data && typeof data.getSettings === "function" ? data.getSettings() : {});
  const builtin = getBuiltinFestivals(now);
  // 待办不混进「今天是什么日子」：快照里另有 todos / todosDue / todosPending 三条出口，
  // 那几条才带完成状态；只按日期捞会把已经勾掉的待办也当成今天的事摊给消费方。
  // 年度重复的待办进不了到期待办线，仍留在这里当日程。
  const userEvents = data.eventsOnDate(now).filter((e) => e.type !== "period" && !(e.type === "todo" && !e.repeatYearly));
  const showPeriod = resolved.showPeriod !== false;
  const period = showPeriod && data.periodsWithDayOn(now).some((p) => !p.predicted);
  const todos = filterDueTodos(data.listEvents(), now).filter((t) => !t.done);
  // 今天过了钟点、又还没勾掉的：另摊一份带钟点的，给聊天类消费方当「到点提醒」的由头。
  // 只加字段、不改 todos 的口径，旧消费方照旧当标题串读。
  //
  // 提前摊出来：聊天类消费方拿到待办还要跑模型想措辞、组织语言，落在钟点准发一定晚几分钟。
  // 这里先把钟点前几分钟的那几条也摊给它，好让它准点前后就能开口，误差就只剩模型那一点。
  // soon = 离钟点还差几分钟（0 就是已经过点了），给消费方判措辞用，不影响旧消费方。
  // id 让消费方能把"她说做完了"准确定位回这一条，不必靠标题猜。
  const todosDue = todos
    .map((t) => ({ id: cleanText(t.id, 64), title: cleanText(t.title), at: cleanText(t.reminderStart, 5), left: todoClockMinutesLeft(t, now) }))
    .filter((row) => row.title && row.left !== null && row.left <= TODO_DUE_LEAD_MINUTES)
    .map((row) => ({ id: row.id, title: row.title, at: row.at, soon: row.left > 0 ? row.left : 0 }))
    .slice(0, TODO_LIMIT);

  let dataRev = 0;
  try {
    dataRev = Number(data.getDataRev?.()) || 0;
  } catch {
    dataRev = 0;
  }

  // 今天及以前所有还没勾掉的待办：给消费方认领「她说做完了」的那一条。
  // todosDue 只管到点提醒，这条管「这句完成对应哪一条」，口径不一样，别混用。
  const todosPending = todos
    .map((t) => ({
      id: cleanText(t.id, 64),
      title: cleanText(t.title),
      date: cleanText(t.date, 10),
      at: cleanText(t.reminderStart, 5),
    }))
    .filter((row) => row.title)
    .slice(0, PENDING_LIMIT);

  return {
    schemaVersion: PUBLIC_TODAY_SCHEMA_VERSION,
    generatedAt: now.toISOString(),
    dataRev,
    today: {
      date: dateKey(now),
      weekday: WEEKDAYS[now.getDay()],
      festivals: cleanList(builtin.map((f) => f && f.name), 10),
      events: cleanList(userEvents.map((e) => e && e.title), 10),
      workday: !!isWorkday(now),
      todos: cleanList(todos.map((t) => t && t.title), TODO_LIMIT),
      todosDue,
      todosPending,
      period: !!period,
    },
    weather: readSnapshotWeather(data, resolved, now),
    summaries: collectSnapshotSummaries(data, { now, boundaryHour: resolved.dayBoundaryHour }),
  };
}

function atomicWriteJson(file, value) {
  const tmp = `${file}.tmp`;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(tmp, JSON.stringify(value, null, 2), "utf-8");
  fs.renameSync(tmp, file);
}

/** 上次真正写下那份快照的内容指纹（去掉时间戳后比对），内容没变就不重写。 */
let lastWrittenKey = "";
let publisher = null;
let publisherLogger = null;
let publishQueue = Promise.resolve();
let lastPublishedKey = "";
let publisherGeneration = 0;

// 每次进程装载都重新发布，宿主共享快照不是持久存储。
export function configurePublicTodayPublisher(ctx) {
  publisher = typeof ctx?.publicData?.publish === "function" ? ctx.publicData : null;
  publisherLogger = ctx?.logger || ctx?.log || null;
  lastPublishedKey = "";
  publisherGeneration += 1;
}

export const PUBLIC_TODAY_MAX_BYTES = 64 * 1024;
const jsonBytes = value => Buffer.byteLength(JSON.stringify(value), "utf8");

function clipJsonText(text, budget) {
  const points = Array.from(String(text || ""));
  let low = 0, high = points.length;
  while (low < high) {
    const mid = Math.ceil((low + high) / 2);
    if (jsonBytes(points.slice(0, mid).join("")) - 2 <= budget) low = mid;
    else high = mid - 1;
  }
  return points.slice(0, low).join("");
}

// 宿主限制的是整份 JSON 的 UTF-8 字节，不是每位伙伴的字符数。
// 超限时公平分配伙伴预算，优先保留各自最近的回顾；本地档案不裁剪。
export function fitPublicTodayBudget(snapshot, maxBytes = PUBLIC_TODAY_MAX_BYTES) {
  if (jsonBytes(snapshot) <= maxBytes) return snapshot;
  const base = { ...snapshot, summaries: {} };
  const available = maxBytes - jsonBytes(base);
  if (available < 0) throw new RangeError("共享情境基础字段超过宿主字节预算");
  const groups = Object.entries(snapshot.summaries || {});
  const groupBudget = Math.floor(available / Math.max(1, groups.length));
  const trimmed = [];
  for (const [id, original] of groups) {
    const rows = [...original].sort((a, b) => String(b.date).localeCompare(String(a.date)))
      .map(row => ({ date: row.date, text: "" }));
    while (rows.length && jsonBytes({ [id]: rows }) + 1 > groupBudget) rows.pop();
    if (!rows.length) continue;
    let budget = groupBudget - jsonBytes({ [id]: rows }) - 1;
    for (const row of rows) {
      const source = original.find(item => item.date === row.date);
      row.text = clipJsonText(source?.text, budget);
      budget -= jsonBytes(row.text) - 2;
    }
    trimmed.push([id, rows.filter(row => row.text)]);
  }
  return { ...base, summaries: Object.fromEntries(trimmed) };
}

function publishSnapshot(snapshot, key) {
  if (!publisher) return;
  const generation = publisherGeneration;
  const target = publisher;
  const logger = publisherLogger;
  publishQueue = publishQueue.then(async () => {
    if (generation !== publisherGeneration) return;
    if (key === lastPublishedKey) {
      if (typeof target.list !== "function") return;
      try {
        // 仅查自己发布的元数据，不需要额外的跨 App 读取权限。
        // 撤权/停用会清宿主快照；不能凭本地成功缓存永远跳过重新发布。
        const current = await target.list({ appId: "shiguangji-app", limit: 100 });
        if (current?.entries?.some(entry => entry?.key === "today")) return;
      } catch { /* 查不到时重新经过 publish 的真实授权检查 */ }
      if (generation !== publisherGeneration) return;
      lastPublishedKey = "";
    }
    try {
      await target.publish({ key: "today", schemaVersion: PUBLIC_TODAY_SCHEMA_VERSION,
        title: "拾光记 · 今日情境", data: fitPublicTodayBudget(snapshot) });
      if (generation === publisherGeneration) lastPublishedKey = key;
    } catch (error) {
      // 共享失败不影响自己的账本；保留未发布状态，下一次刷新仍会尝试。
      try { await logger?.warn?.(`拾光记共享情境未发布：${error?.code || ""} ${error?.message || error}`); } catch {}
    }
  });
}

export function flushPublicTodayPublisher() { return publishQueue; }

/** 仅供测试：清掉「上次写过什么」的记忆，让下一次写入一定落盘。 */
export function __resetPublicTodayCache() {
  lastWrittenKey = "";
}

/**
 * 写一份快照。任何一步失败都安静收场——这是对外出口，绝不能反噬拾光记自己的主流程。
 * @returns {object|null} 真正构建出的快照（跳过写入时也返回内容）
 */
export function writePublicToday({ dataDir, data, settings = null, now = new Date(), force = false } = {}) {
  if (!dataDir || !data) return null;
  const snapshot = buildPublicToday({ now, data, settings });
  const file = publicTodayPath(dataDir);
  const key = JSON.stringify({ ...snapshot, generatedAt: "" });
  publishSnapshot(snapshot, key);
  if (!force && key === lastWrittenKey && fs.existsSync(file)) return snapshot;
  try {
    atomicWriteJson(file, snapshot);
    lastWrittenKey = key;
  } catch {
    lastWrittenKey = "";
  }
  return snapshot;
}

let debounceTimer = null;
let pendingJob = null;

/** 去抖刷新：短时间内的多次请求合成一次写盘；失败静默。 */
export function schedulePublicToday(job) {
  pendingJob = job;
  if (debounceTimer) return;
  debounceTimer = setTimeout(() => {
    debounceTimer = null;
    const current = pendingJob;
    pendingJob = null;
    try {
      writePublicToday(current);
    } catch {
      // 对外快照刷新失败不反噬主流程
    }
  }, SCHEDULE_DEBOUNCE_MS);
  debounceTimer.unref?.();
}

/** 仅供测试：清掉挂着的去抖任务。 */
export function __clearPublicTodayTimer() {
  if (debounceTimer) clearTimeout(debounceTimer);
  debounceTimer = null;
  pendingJob = null;
}
