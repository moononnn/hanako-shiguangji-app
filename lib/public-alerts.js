// 拾光记 · 对外契约 alerts（天气提醒事件）
//
// 回答一个问题：**接下来有哪些天气变化值得她留意。**
//
// 只摊事实——哪一类变化、落在哪一天哪一段、具体数值是多少；
// 不替消费方决定「谁来说、什么时候说、说几次」。那三件事归聊天类 App 自己管。
//
// 三条纪律，跟 today / greetings 同源：
//   1. 不做选择，也不改写判定口径：事件由 lib/weather-alert.js 挑，这里只摊平。
//   2. 不改动现有注入逻辑。主对话那条天气提醒照旧走自己的会话状态。
//   3. 格式冻在 schemaVersion 上；内部判定怎么改都不影响这份门面。
//
// 契约文档见仓库根目录 PUBLIC-ALERTS.md。
//
// 与主对话那条的区别（要紧）：那边按会话记「这个会话说没说过」，是消费侧的事。
// 这里一律不带会话状态，同一个事件对谁都一样，谁提过由消费方各自的账本管。

import { collectWeatherEvents, KIND_LABELS } from "./weather-alert.js";
import { enqueuePublicPublish, readSnapshotWeather } from "./public-today.js";
import { weatherForecastCacheIsFresh, weatherForecastCacheMatches } from "./weather.js";

export const PUBLIC_ALERTS_KEY = "alerts";
export const PUBLIC_ALERTS_SCHEMA_VERSION = 1;
/** 最多摊几件事：天气提醒本来就要克制，摊多了消费方更难挑。 */
export const PUBLIC_ALERTS_MAX_EVENTS = 6;
const TEXT_LIMIT = 40;
const FACTS_LIMIT = 4;
const KEYWORDS_LIMIT = 8;

function cleanText(value, maxLength = TEXT_LIMIT) {
  return String(value ?? "").replace(/[\u0000-\u001F\u007F]/g, "").trim().slice(0, maxLength);
}

function pad2(value) {
  return String(value).padStart(2, "0");
}

/** 本地日历日 YYYY-MM-DD。 */
export function alertsDayKey(now = new Date()) {
  const d = now instanceof Date ? now : new Date(now);
  if (!Number.isFinite(d.getTime())) return "";
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

/** 带本地偏移量的 ISO 串（2026-10-24T07:20:00+08:00），跟 greetings 一个样子。 */
function isoWithOffset(now = new Date()) {
  const d = now instanceof Date ? now : new Date(now);
  if (!Number.isFinite(d.getTime())) return "";
  const offset = -d.getTimezoneOffset();
  const sign = offset >= 0 ? "+" : "-";
  const absolute = Math.abs(offset);
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`
    + `T${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`
    + `${sign}${pad2(Math.floor(absolute / 60))}:${pad2(absolute % 60)}`;
}

function trimEvent(event) {
  const facts = Array.isArray(event?.facts) ? event.facts : [];
  const keywords = Array.isArray(event?.keywords) ? event.keywords : [];
  return {
    key: cleanText(event?.key, 80),
    kind: cleanText(event?.kind, 20),
    label: cleanText(KIND_LABELS[event?.kind] || "天气有变化", 20),
    dayLabel: cleanText(event?.dayLabel, 20),
    slot: cleanText(event?.slot, 20),
    at: cleanText(event?.at, 20),
    facts: facts.map((row) => cleanText(row, 60)).filter(Boolean).slice(0, FACTS_LIMIT),
    keywords: keywords.map((row) => cleanText(row, 12)).filter(Boolean).slice(0, KEYWORDS_LIMIT),
  };
}

/**
 * 组一份对外契约。纯组装：读缓存、判新鲜、挑事件、摊平。
 * 任何一步失败都收成一份空契约，绝不反噬拾光记自己的主流程。
 *
 * @param {object} opts
 *   data 数据层（要 getSettings / getWeatherCache / getWeatherForecastCache）
 *   settings 可选，不传就读当前设置
 * @returns {{schemaVersion:number, updatedAt:string, day:string, place:string, reason:string, events:object[]}}
 */
export function buildPublicAlerts({ data, settings = null, now = new Date() } = {}) {
  const base = {
    schemaVersion: PUBLIC_ALERTS_SCHEMA_VERSION,
    updatedAt: isoWithOffset(now),
    day: alertsDayKey(now),
    place: "",
    reason: "ok",
    events: [],
  };
  if (!data) return { ...base, reason: "no-data" };
  let merged = settings;
  try {
    if (!merged) merged = data.getSettings ? data.getSettings() : {};
  } catch {
    merged = {};
  }
  // 天气本身关了、或提醒单独关了：这一条出口就是空的，消费方据此什么都不说。
  if (merged?.weatherEnabled === false) return { ...base, reason: "weather-off" };
  if (merged?.weatherAlertEnabled === false) return { ...base, reason: "alert-off" };
  try {
    const forecastCache = data.getWeatherForecastCache?.() || null;
    if (!weatherForecastCacheMatches(forecastCache, merged)) return { ...base, reason: "no-forecast" };
    if (!weatherForecastCacheIsFresh(forecastCache, merged, now)) return { ...base, reason: "stale" };
    const current = readSnapshotWeather(data, merged, now);
    const events = collectWeatherEvents({
      forecast: forecastCache.forecast,
      now,
      currentTemp: current ? current.temp : null,
      settings: merged,
    });
    return {
      ...base,
      place: cleanText(current?.place || forecastCache.location || "", TEXT_LIMIT),
      events: events.slice(0, PUBLIC_ALERTS_MAX_EVENTS).map(trimEvent),
    };
  } catch {
    return { ...base, reason: "error" };
  }
}

let channelTarget = null;
let channelBound = false;
let channelLogger = null;
let lastFingerprint = "";

/**
 * 绑定对外通道。每次进程装载都重绑并清掉判重记忆：
 * 宿主共享数据不是持久存储，上次发过不代表这次还挂着。
 */
export function configurePublicAlertsPublisher(ctx) {
  channelTarget = typeof ctx?.publicData?.publish === "function" ? ctx.publicData : null;
  channelBound = !!channelTarget;
  channelLogger = ctx?.logger || ctx?.log || null;
  lastFingerprint = "";
}

/**
 * 发一份 alerts。同步入队（跟 today / greetings 共用一条队列），没绑通道就安静返回。
 * 内容指纹没变不重复发；宿主那份被撤权清掉后即使内容没变也会补发回来。
 */
export function publishPublicAlerts({ data, settings = null, now = new Date(), force = false } = {}) {
  if (!channelBound || !data) return null;
  const snapshot = buildPublicAlerts({ data, settings, now });
  // 指纹只认「事件与状态」，别的字段变了不值得重发一遍。
  const fingerprint = JSON.stringify({ day: snapshot.day, reason: snapshot.reason, events: snapshot.events });
  enqueuePublicPublish(async (target) => {
    if (!force && fingerprint === lastFingerprint) {
      if (typeof target.list !== "function") return true;
      let visible = false;
      try {
        const current = await target.list({ appId: "shiguangji-app", limit: 100 });
        visible = !!current?.entries?.some((entry) => entry?.key === PUBLIC_ALERTS_KEY);
      } catch { /* 查不到就当没发过，走 publish 的真实授权检查 */ }
      if (visible) return true;
      lastFingerprint = "";
    }
    await target.publish({
      key: PUBLIC_ALERTS_KEY,
      schemaVersion: PUBLIC_ALERTS_SCHEMA_VERSION,
      title: "拾光记 · 天气提醒",
      data: snapshot,
    });
    lastFingerprint = fingerprint;
    return true;
  }, channelTarget, channelLogger);
  return snapshot;
}

/** 仅供测试：清掉判重记忆。 */
export function __resetAlertsPublishCache() {
  lastFingerprint = "";
}
