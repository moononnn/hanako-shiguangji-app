// 拾光记 · 对外契约 greetings（节日问候完成台账）
//
// 回答一个问题：某位伙伴在某一天，有没有把当天那个重大节日的问候真正说出口。
// 消费方（闲不住等）经 ctx.publicData 授权后读这一份，只取自己关心的那条。
//
// App 对外契约：shiguangji-app / greetings，schemaVersion 1，与 today 同一条发布通道
// （public-today.js 的 publisher + 队列），两个 key 各自判重，谁也不盖谁。
// 契约文档见仓库根目录 PUBLIC-GREETINGS.md。
//
// 三条纪律，跟 today 那份快照同源：
//   1. **只摊事实，不重新判定**。问候是否说出口由 extensions/inject.js 用现成的
//      didMentionFestival 判完（只认助手可见正文，思考块不算），这里只负责存与发。
//   2. **格式冻结在 schemaVersion 上**。内部台账怎么存都不影响这份门面。
//   3. **绝不反噬主流程**。没有 publicData 通道、发布失败、台账读不出来，一律安静收场。

import { dateKey, festivalGreetingWindowStart, pad2, FESTIVAL_GREETING_RETENTION_DAYS } from "./data.js";
import { enqueuePublicPublish } from "./public-today.js";

export const PUBLIC_GREETINGS_KEY = "greetings";
export const PUBLIC_GREETINGS_SCHEMA_VERSION = 1;
/** 只留最近 7 天（含今天）。消费方只关心今天，旧记录清掉。写入口与这里同一档。 */
export const GREETINGS_RETENTION_DAYS = FESTIVAL_GREETING_RETENTION_DAYS;
/** 去抖窗口：短时间内的多次完成确认合成一次发布。跟 public-today 的写盘去抖同一档。 */
const SCHEDULE_DEBOUNCE_MS = 2000;

/** 本地偏移量的 ISO 串（2026-10-25T09:12:00+08:00）。契约样例长这样，就照着给。 */
function localIso(value) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const offsetMinutes = -date.getTimezoneOffset();
  const sign = offsetMinutes >= 0 ? "+" : "-";
  const absolute = Math.abs(offsetMinutes);
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`
    + `T${pad2(date.getHours())}:${pad2(date.getMinutes())}:${pad2(date.getSeconds())}`
    + `${sign}${pad2(Math.floor(absolute / 60))}:${pad2(absolute % 60)}`;
}

/** 窗口起点（含）。7 天窗口 = 今天往前 6 天。 */
export function greetingsWindowStart(now = new Date(), retentionDays = GREETINGS_RETENTION_DAYS) {
  return festivalGreetingWindowStart(dateKey(now), retentionDays);
}

function cleanRow(row) {
  const agentId = String(row?.agentId || "").trim();
  const date = String(row?.date || "").trim();
  const festival = String(row?.festival || "").trim();
  const completedAt = localIso(row?.ts);
  if (!agentId || !festival || !completedAt) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  return { agentId, date, festival, completedAt };
}

/**
 * 组一份对外契约。纯组装：台账从 data 上读，窗口外的直接不摊（连读都不用读到它们）。
 * @returns {{schemaVersion: number, updatedAt: string, entries: object[]}}
 */
export function buildPublicGreetings({ data, now = new Date(), retentionDays = GREETINGS_RETENTION_DAYS } = {}) {
  const today = dateKey(now);
  const from = greetingsWindowStart(now, retentionDays);
  let rows = [];
  try {
    rows = typeof data?.listFestivalGreetings === "function" ? data.listFestivalGreetings() : [];
  } catch {
    rows = [];
  }
  const entries = (Array.isArray(rows) ? rows : [])
    .map(cleanRow)
    .filter((row) => row && row.date >= from && row.date <= today)
    .sort((a, b) => (a.date === b.date ? b.completedAt.localeCompare(a.completedAt) : b.date.localeCompare(a.date)));
  return {
    schemaVersion: PUBLIC_GREETINGS_SCHEMA_VERSION,
    updatedAt: localIso(now) || new Date(now.getTime() ?? Date.now()).toISOString(),
    entries,
  };
}

let channelBound = false;
let channelTarget = null;
let channelLogger = null;
let lastFingerprint = "";

/**
 * 绑定对外通道。每次进程装载都重绑并清掉判重记忆：宿主共享数据不是持久存储，
 * 上次发过不代表这次还挂着。
 */
export function configurePublicGreetingsPublisher(ctx) {
  channelTarget = typeof ctx?.publicData?.publish === "function" ? ctx.publicData : null;
  channelBound = !!channelTarget;
  channelLogger = ctx?.logger || ctx?.log || null;
  lastFingerprint = "";
}

/** 仅供测试：清掉判重记忆。 */
export function __resetGreetingsPublishCache() {
  lastFingerprint = "";
}

/**
 * 发一份 greetings。同步入队（跟 today 共用一条队列），没绑通道就安静返回。
 * 内容指纹没变不重复发；宿主那份被撤权清掉后即使内容没变也会补发回来。
 */
export function publishPublicGreetings({ data, now = new Date(), force = false } = {}) {
  if (!channelBound || !data) return null;
  const snapshot = buildPublicGreetings({ data, now });
  const fingerprint = JSON.stringify(snapshot.entries);
  enqueuePublicPublish(async (target) => {
    if (!force && fingerprint === lastFingerprint) {
      if (typeof target.list !== "function") return true;
      let visible = false;
      try {
        // 仅查自己发布的元数据，不需要额外的跨 App 读取权限。
        const current = await target.list({ appId: "shiguangji-app", limit: 100 });
        visible = !!current?.entries?.some((entry) => entry?.key === PUBLIC_GREETINGS_KEY);
      } catch { /* 查不到就当没发过，走 publish 的真实授权检查 */ }
      if (visible) return true;
      lastFingerprint = "";
    }
    await target.publish({
      key: PUBLIC_GREETINGS_KEY,
      schemaVersion: PUBLIC_GREETINGS_SCHEMA_VERSION,
      title: "拾光记 · 节日问候",
      data: snapshot,
    });
    lastFingerprint = fingerprint;
    return true;
  }, channelTarget, channelLogger);
  return snapshot;
}

let debounceTimer = null;
let pendingJob = null;

/** 去抖发布：短时间内的多次完成确认合成一次；失败静默。 */
export function schedulePublicGreetings(job) {
  pendingJob = job;
  if (debounceTimer) return;
  debounceTimer = setTimeout(() => {
    debounceTimer = null;
    const current = pendingJob;
    pendingJob = null;
    try {
      publishPublicGreetings(current);
    } catch {
      // 对外契约刷新失败不反噬主流程
    }
  }, SCHEDULE_DEBOUNCE_MS);
  debounceTimer.unref?.();
}

/** 仅供测试：清掉挂着的去抖任务。 */
export function __clearGreetingsTimer() {
  if (debounceTimer) clearTimeout(debounceTimer);
  debounceTimer = null;
  pendingJob = null;
}