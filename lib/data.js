// 拾光记 · 用户数据层（加密存储）
// 存储内容：自定义日子（纪念日/待办/生理期/自定义）、每日总结档案、注入配置与会话节流状态。
// 所有用户自定义数据走 EncryptedStore（AES-256-GCM + 随机密钥自包含），防乱扫。
// 内置节假日是公开数据，走明文文件（festivals.js 内嵌，不落盘）。
// 文件预算豁免：加密数据层统一维护同一份版本化存储与迁移边界，拆分会放大一致性风险。

import path from "node:path";
import crypto from "node:crypto";
import { EncryptedStore } from "./crypto-store.js";
import { normalizeTodoReminderWindow } from "./todo-time.js";
import { normalizeEntryKind } from "./xingji.js";
import {
  buildTodoOccurrence,
  isRecurringTodo,
  nextTodoOccurrenceDate,
  normalizeTodoRepeatRule,
  occurrenceDates,
  occurrenceMatches,
  parseTodoOccurrenceId,
} from "./todo-repeat.js";

const VALID_INJECT_INTERVAL_HOURS = new Set([0.5, 1, 4, 8]);
const VALID_MOOD_DISCOVERY_MODES = new Set(["off", "economical", "detailed"]);
const VALID_FOCUS_MINUTES = new Set([15, 25, 30, 45]);
const MIN_FOCUS_BREAK_MINUTES = 1;
const MAX_FOCUS_BREAK_MINUTES = 60;
const MAX_FOCUS_ROUNDS = 20;
const DEFAULT_FOCUS_CONFIG = Object.freeze({
  focusMinutes: 25,
  totalRounds: 4,
  shortBreakMinutes: 5,
  longBreakEnabled: true,
  longBreakEvery: 4,
  longBreakMinutes: 15,
});

function focusGoalConfigKey(value) {
  const title = String(value || "").trim().toLocaleLowerCase();
  return title ? `goal:${title}` : "";
}

function normalizeFocusConfig(value) {
  const source = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  const focusMinutes = Number(source.focusMinutes);
  const totalRounds = Number(source.totalRounds);
  const shortBreakMinutes = Number(source.shortBreakMinutes ?? source.breakMinutes);
  const longBreakEvery = Number(source.longBreakEvery);
  const longBreakMinutes = Number(source.longBreakMinutes);
  return {
    focusMinutes: VALID_FOCUS_MINUTES.has(focusMinutes) ? focusMinutes : DEFAULT_FOCUS_CONFIG.focusMinutes,
    totalRounds: Number.isInteger(totalRounds) && totalRounds >= 1 && totalRounds <= MAX_FOCUS_ROUNDS ? totalRounds : DEFAULT_FOCUS_CONFIG.totalRounds,
    shortBreakMinutes: Number.isInteger(shortBreakMinutes) && shortBreakMinutes >= MIN_FOCUS_BREAK_MINUTES && shortBreakMinutes <= MAX_FOCUS_BREAK_MINUTES ? shortBreakMinutes : DEFAULT_FOCUS_CONFIG.shortBreakMinutes,
    longBreakEnabled: typeof source.longBreakEnabled === "boolean" ? source.longBreakEnabled : (Number.isInteger(longBreakEvery) && longBreakEvery > 0),
    longBreakEvery: Number.isInteger(longBreakEvery) && longBreakEvery >= 1 && longBreakEvery <= MAX_FOCUS_ROUNDS ? longBreakEvery : DEFAULT_FOCUS_CONFIG.longBreakEvery,
    longBreakMinutes: Number.isInteger(longBreakMinutes) && longBreakMinutes >= MIN_FOCUS_BREAK_MINUTES && longBreakMinutes <= MAX_FOCUS_BREAK_MINUTES ? longBreakMinutes : DEFAULT_FOCUS_CONFIG.longBreakMinutes,
  };
}

function validateFocusConfig(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("专注配置格式不正确");
  const config = normalizeFocusConfig(value);
  if (Number(value.focusMinutes) !== config.focusMinutes) throw new Error("请选择 15、25、30 或 45 分钟的专注时长");
  if (!Number.isInteger(Number(value.totalRounds)) || Number(value.totalRounds) < 1 || Number(value.totalRounds) > MAX_FOCUS_ROUNDS) throw new Error("轮数请选择 1 到 20 轮");
  if (!Number.isInteger(Number(value.shortBreakMinutes ?? value.breakMinutes)) || Number(value.shortBreakMinutes ?? value.breakMinutes) < MIN_FOCUS_BREAK_MINUTES || Number(value.shortBreakMinutes ?? value.breakMinutes) > MAX_FOCUS_BREAK_MINUTES) throw new Error("短休息请选择 1 到 60 分钟");
  if (typeof value.longBreakEnabled !== "boolean") throw new Error("长休开关配置不正确");
  if (!Number.isInteger(Number(value.longBreakEvery)) || Number(value.longBreakEvery) < 1 || Number(value.longBreakEvery) > MAX_FOCUS_ROUNDS) throw new Error("长休间隔请选择 1 到 20 轮");
  if (!Number.isInteger(Number(value.longBreakMinutes)) || Number(value.longBreakMinutes) < MIN_FOCUS_BREAK_MINUTES || Number(value.longBreakMinutes) > MAX_FOCUS_BREAK_MINUTES) throw new Error("长休息请选择 1 到 60 分钟");
  return config;
}

function focusDate(value = new Date()) {
  const date = value instanceof Date ? new Date(value.getTime()) : new Date(value);
  if (Number.isNaN(date.getTime())) throw new Error("计时日期无效");
  return date;
}

function focusRecord(active, { status, endedAt, durationMs, planStatus = status === "completed" ? "completed" : "interrupted", breakKindAfter = "" }) {
  const started = focusDate(active.startedAt);
  return {
    id: String(active.id),
    setId: String(active.setId || active.id),
    setDate: String(active.setDate || dateKey(started)),
    roundIndex: Math.max(1, Number(active.roundIndex) || 1),
    totalRounds: Math.max(1, Number(active.totalRounds) || 1),
    planStatus,
    breakKindAfter: breakKindAfter || "",
    date: dateKey(started),
    startedAt: started.toISOString(),
    endedAt: focusDate(endedAt).toISOString(),
    durationMs: Math.max(0, Math.min(Number(active.plannedMinutes) * 60_000, Math.floor(Number(durationMs) || 0))),
    plannedMinutes: Number(active.plannedMinutes),
    shortBreakMinutes: Number(active.shortBreakMinutes ?? active.breakMinutes ?? 5),
    longBreakEvery: Math.max(0, Number(active.longBreakEvery) || 0),
    longBreakMinutes: Number(active.longBreakMinutes || 15),
    status,
    taskId: String(active.taskId || ""),
    taskTitle: String(active.taskTitle || "").slice(0, 120),
    companionId: String(active.companionId || "").slice(0, 200),
    companionName: String(active.companionName || "").slice(0, 120),
  };
}

function setFocusPlanStatus(state, setId, status) {
  if (!setId || !Array.isArray(state.sessions)) return;
  for (const row of state.sessions) {
    if (row && String(row.setId || row.id) === String(setId)) row.planStatus = status;
  }
}

export function normalizeInjectIntervalHours(value) {
  const hours = Number(value);
  return VALID_INJECT_INTERVAL_HOURS.has(hours) ? hours : 4;
}

export function normalizeMoodDiscoveryMode(value) {
  const mode = String(value || "").trim().toLowerCase();
  return VALID_MOOD_DISCOVERY_MODES.has(mode) ? mode : "economical";
}

// ── 日期工具 ──

export function pad2(n) {
  return String(n).padStart(2, "0");
}

export function dateKey(d) {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

export function mmddKey(d) {
  return `${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

/** 节日问候台账只留多少天（含当天）；消费方只关心今天。 */
export const FESTIVAL_GREETING_RETENTION_DAYS = 7;

/** 某个日历日往前数 7 天（含当天）的窗口起点 YYYY-MM-DD。 */
export function festivalGreetingWindowStart(dayKey, days = FESTIVAL_GREETING_RETENTION_DAYS) {
  const parts = String(dayKey || "").split("-").map(Number);
  if (parts.length !== 3 || !parts.every((value) => Number.isInteger(value))) return "";
  const [year, month, day] = parts;
  return dateKey(new Date(year, month - 1, day - (Math.max(1, days) - 1)));
}

export function todayKey() {
  return dateKey(new Date());
}

function isValidCalendarDate(year, month, day) {
  if (![year, month, day].every(Number.isInteger) || year < 0 || month < 1 || month > 12 || day < 1) return false;
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const daysInMonth = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1];
  return day <= daysInMonth;
}

// 解析 "YYYY-MM-DD" 或 "MM-DD"（每年重复）→ { key, repeatYearly }
export function parseDateInput(input, now = new Date()) {
  const s = String(input || "").trim();
  const yyyy = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (yyyy) {
    const year = Number(yyyy[1]);
    const month = Number(yyyy[2]);
    const day = Number(yyyy[3]);
    if (!isValidCalendarDate(year, month, day)) return null;
    return {
      key: `${String(year).padStart(4, "0")}-${pad2(month)}-${pad2(day)}`,
      repeatYearly: false,
      month,
      day,
      year,
    };
  }
  const mm = /^(\d{2})-(\d{2})$/.exec(s);
  if (mm) {
    const year = now.getFullYear();
    const month = Number(mm[1]);
    const day = Number(mm[2]);
    if (!isValidCalendarDate(year, month, day)) return null;
    return {
      key: `${String(year).padStart(4, "0")}-${pad2(month)}-${pad2(day)}`,
      repeatYearly: true,
      month,
      day,
      year,
    };
  }
  return null;
}

// 统一把事件里可能遗留的 YYYY-MM-DD / MM-DD 日期转成可比较的完整日期键。
// 非法或非规范日期返回空串，调用方必须按“不可判断”处理，不能直接做字符串比较。
export function normalizeDateKey(input, now = new Date()) {
  return parseDateInput(input, now)?.key || "";
}

export function eventDateKey(event, now = new Date()) {
  return normalizeDateKey(event?.date, now);
}

// 情境注入、今日工具和预览共用这组待办到期判断，避免 MM-DD 被字符串比较误当成已到期。
export function isTodoDue(event, now = new Date()) {
  if (!event || event.type !== "todo" || event.done || event.repeatYearly) return false;
  // 周期规则本身不是某一天的待办；filterDueTodos 会先展开成带 occurrenceDate 的实例。
  if (isRecurringTodo(event) && !event.occurrenceDate) return false;
  const dueDate = eventDateKey(event, now);
  return !!dueDate && dueDate <= dateKey(now);
}

export function isTodoOverdue(event, now = new Date()) {
  if (!isTodoDue(event, now)) return false;
  return eventDateKey(event, now) < dateKey(now);
}

export function filterDueTodos(events, now = new Date()) {
  const today = dateKey(now);
  const rows = [];
  for (const event of Array.isArray(events) ? events : []) {
    if (isRecurringTodo(event) && !event.occurrenceDate) {
      for (const date of occurrenceDates(event, event.date, today)) {
        const occurrence = buildTodoOccurrence(event, date);
        if (occurrence && isTodoDue(occurrence, now)) rows.push(occurrence);
      }
    } else if (isTodoDue(event, now)) {
      rows.push(event);
    }
  }
  return rows;
}

/**
 * 今天的钟点离现在还差几分钟。负数=已经过去，0=正好到点。
 * 判不出来（不是今天到期、没写钟点、钟点不合法）一律 null。
 * 想要「过没过」用 todoClockPassed，想要「离到点还有多久」用这个。
 */
export function todoClockMinutesLeft(event, now = new Date()) {
  if (!isTodoDue(event, now)) return null;
  if (eventDateKey(event, now) !== dateKey(now)) return null;
  const parts = String(event.reminderStart || "").split(":");
  if (parts.length !== 2) return null;
  const hour = Number(parts[0]);
  const minute = Number(parts[1]);
  if (!Number.isInteger(hour) || !Number.isInteger(minute)) return null;
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return null;
  return hour * 60 + minute - (now.getHours() * 60 + now.getMinutes());
}

/**
 * 这条待办的钟点过了没：只看今天的时刻，不管日期已经逾期几天。
 * 今天到期、写明了起始时间、且现在已过那个时刻，才算「到点了」。
 * 给注入和对外快照共用，免得两处各判一套。
 */
export function todoClockPassed(event, now = new Date()) {
  const left = todoClockMinutesLeft(event, now);
  return left !== null && left <= 0;
}

// 从「生理期第N天」里解析 N，支持阿拉伯数字和常见中文数字。
// 返回 0 表示识别不了。
const CN_NUMS = {
  "一": 1, "二": 2, "两": 2, "三": 3, "四": 4, "五": 5,
  "六": 6, "七": 7, "八": 8, "九": 9, "十": 10,
};
function parseChineseDay(title) {
  const s = String(title || "");
  // 阿拉伯数字
  const arab = /第\s*(\d{1,2})\s*天/.exec(s);
  if (arab) {
    const n = parseInt(arab[1], 10);
    if (n >= 1 && n <= 31) return n;
  }
  // 中文数字：第X天 / 第X天（X 可为 一..十 / 十一..十九 / 二十X / 二十 / 三十）
  const m = /第\s*(十[一二三四五六七八九]?|[一二三四五六七八九]|二十[一二三四五六七八九]?|三十)\s*天/.exec(s);
  if (m) {
    const numStr = m[1];
    if (numStr === "十") return 10;
    if (numStr === "二十") return 20;
    if (numStr === "三十") return 30;
    if (numStr.startsWith("十")) return 10 + (CN_NUMS[numStr[1]] || 0);
    if (numStr.startsWith("二十")) return 20 + (CN_NUMS[numStr[2]] || 0);
    if (numStr.startsWith("三十")) return 30 + (CN_NUMS[numStr[2]] || 0);
    return CN_NUMS[numStr] || 0;
  }
  return 0;
}

// ── 数据层 ──

export class UserData {
  /**
   * @param {string} dataDir 插件数据目录
   */
  constructor(dataDir) {
    this.dataDir = dataDir;
    // 用户自定义日子：events = { id: {id, title, type, date, repeatYearly, note, reminderStart, reminderEnd, createdAt} }
    this.events = new EncryptedStore({
      dataDir,
      fileName: "user-events.dat",
      defaults: { events: {} },
    });
    // 专注计时与记录独立加密保存，不进入伙伴情境注入或公开快照。
    this.focusStore = new EncryptedStore({
      dataDir,
      fileName: "focus-sessions.dat",
      defaults: { active: null, sessions: [], favoriteGoals: [], favoriteGoalConfigs: {}, lastFocusConfig: { ...DEFAULT_FOCUS_CONFIG } },
    });
    // 待办到点提醒状态：和事件分开保存，避免内部送达信息污染日历事件结构。
    // 每条状态按 eventId 索引，重启后仍能判断已送达/待重试，防止重复提醒。
    this.todoReminders = new EncryptedStore({
      dataDir,
      fileName: "todo-reminders.dat",
      defaults: { reminders: {} },
    });
    // 每日总结档案：按生活日保存；新档案为 { version: 2, byAgent, legacy }，旧版混合档案原样保留在 legacy。
    this.summaries = new EncryptedStore({
      dataDir,
      fileName: "daily-summaries.dat",
      defaults: { summaries: {} },
    });
    // 每日总结后台任务：状态也加密，切换页面或重启后可继续查看/恢复。
    this.summaryJobs = new EncryptedStore({
      dataDir,
      fileName: "summary-jobs.dat",
      defaults: { jobs: {} },
    });
    // 「记一笔当下的心情」：按日期存当天情绪条目。
    // 结构：{ moods: { "YYYY-MM-DD": [条目...] } }，条目见 lib/mood.js（source: manual|auto）。
    this.moods = new EncryptedStore({
      dataDir,
      fileName: "moods.dat",
      defaults: { moods: {} },
    });
    // 自动情绪发现的日级幂等状态：只记录是否检查/调用过，不把模型原始对话另存一份。
    this.moodHarvests = new EncryptedStore({
      dataDir,
      fileName: "mood-harvests.dat",
      defaults: { harvests: {} },
    });
    // 伙伴心情线：与用户的 moods.dat 完全隔离，独立加密文件（PR 试水，不对味可整体回退）。
    // 结构：{ partnerMoods: { "YYYY-MM-DD": { agentId: [条目...] } } }，条目形状同 mood 自动候选。
    this.partnerMoods = new EncryptedStore({
      dataDir,
      fileName: "partner-moods.dat",
      defaults: { partnerMoods: {} },
    });
    // 伙伴心情线的日级幂等状态：按 date|agentId 记录，避免重启重复调模型。
    this.partnerMoodHarvests = new EncryptedStore({
      dataDir,
      fileName: "partner-mood-harvests.dat",
      defaults: { harvests: {} },
    });
    // 伙伴心情历史补档后台任务：独立账本，只补际遇线，不碰做册总结。
    this.partnerMoodJobs = new EncryptedStore({
      dataDir,
      fileName: "partner-mood-jobs.dat",
      defaults: { jobs: {} },
    });
    // 拾性（性格补全）：日采观察 → 周归纳条目 → 证据入账。
    // 完全独立加密文件，且默认不注入任何地方；注入另有一个默认关闭的开关。
    // 结构：{ version, agents: { [agentId]: { entries, pending, lastRollupAt } }, harvests: {}, logs: [], job, scan }
    this.xingji = new EncryptedStore({
      dataDir,
      fileName: "xingji.dat",
      defaults: { version: 1, agents: {}, harvests: {}, logs: [], job: null, scan: null },
    });
    // 注入配置
    this.settings = new EncryptedStore({
      dataDir,
      fileName: "settings.dat",
      defaults: {
        injectMode: "balanced", // economical | balanced | always（用户界面：适时 | 相伴 | 常在）
        injectIntervalHours: 4, // balanced 模式下的注入间隔
        injectionEnabled: true, // 是否把今日情境带入助手对话；关闭不影响日历/时光册
        injectionDisabledAgentIds: [], // 单独关闭情境注入的伙伴；旧配置默认空数组，保持原行为
        autoSummary: false, // 每日自动总结开关
        moodDiscoveryMode: "economical", // 自动情绪发现：off | economical | detailed
        partnerMoodEnabled: false, // 伙伴心情线总开关（PR 试水功能，默认关，想要时在设置里打开）
        summaryHour: 23, // 旧版兼容字段（v0.1.7 起不再使用）
        dayBoundaryHour: 4, // 一天翻篇时刻：0 | 2 | 4
        summaryAgentId: "", // 旧版兼容字段（新版按伙伴多选）
        summaryAgentIds: null, // 总结范围：null=全部伙伴，数组=只总结选中的伙伴（可为空）
        showPeriod: true, // 生理期记录开关（关闭后 UI 与注入都不出现生理期，数据保留）
        summaryShared: false, // 近期总结默认只注入当前助手；开启后才共享其他助手的近期动态
        // 天气情境：旧版地点文字继续保留，新版额外保存区县与坐标。
        weatherLocation: "", // 如「成都 武侯区」或「四川省 成都市 武侯区」；空=不启用天气
        weatherArea: null, // { code, province, city, district, latitude, longitude }
        weatherEnabled: true, // 主页天气与天气查询开关；旧配置默认保持开启
        weatherIntervalHours: 3, // 天气刷新间隔（小时）
        weatherAlertEnabled: true, // 天气提醒（恶劣天气/大风/明显降温）独立开关；与天气播报互不影响
        weatherForecastIntervalHours: 1, // 预报刷新间隔（小时）；提醒要用未来几小时，刷新比当前天气快
        deepseekPeakEnabled: true, // DeepSeek 峰谷关照独立开关；关掉情境注入也能单独保留
        // 拾性：观察与注入彻底分开。观察只管记账，注入才是把档案接回伙伴，默认关。
        xingjiEnabled: false, // 后台观察总开关
        xingjiInjectionEnabled: false, // 把做法条目接回伙伴对话（默认关，与观察互不影响）
      },
    });
    // 数据版本号：记录用户数据（日子/总结）最近一次写操作，供注入引擎判断「数据变了→立即刷新」。
    // 独立 store，不侵入 events/summaries 结构，重启保留。
    this.dataRev = new EncryptedStore({
      dataDir,
      fileName: "data-rev.dat",
      defaults: { rev: 0 },
    });
    // 天气缓存（最近一次查询结果，防频繁请求）
    this.weatherCache = new EncryptedStore({
      dataDir,
      fileName: "weather-cache.dat",
      defaults: { weather: null },
    });
    // 节日氛围引导变体已用索引（随机不重复用；按节日名记录，重启保留）
    this.festivalHintState = new EncryptedStore({
      dataDir,
      fileName: "festival-hint-state.dat",
      defaults: { used: {} },
    });
    // 情境注入完整会话状态：与 DeepSeek 峰谷状态分开，重启后恢复节流、设置指纹和天气可见记录。
    this.injectionState = new EncryptedStore({
      dataDir,
      fileName: "injection-state.dat",
      defaults: { sessions: {} },
    });
    // 节日问候完成台账：对外 greetings 契约的数据源。按伙伴/日期/节日去重，只留最近 7 天。
    this.festivalGreetings = new EncryptedStore({
      dataDir,
      fileName: "festival-greetings.dat",
      defaults: { entries: [] },
    });
    // DeepSeek 峰谷关照的会话状态：按 sessionId 记录最近一次判定，重启后恢复，
    // 避免把「重启后的旧窗口」误判成新窗口而重复播报当前时段（与 todoReminders 同款重启保留语义）。
    this.deepseekPeak = new EncryptedStore({
      dataDir,
      fileName: "deepseek-peak.dat",
      defaults: { sessions: {} },
    });
    // 天气预报缓存：提醒要看未来几小时，单独存一份，刷新比当前天气快。
    this.weatherForecastCache = new EncryptedStore({
      dataDir,
      fileName: "weather-forecast-cache.dat",
      defaults: { forecast: null },
    });
    // 天气提醒的会话状态：记已提过哪几件事，避免同一件事反复扰民。
    this.weatherAlert = new EncryptedStore({
      dataDir,
      fileName: "weather-alert.dat",
      defaults: { sessions: {} },
    });
  }

  /**
   * 清掉所有加密存储的内存缓存，下次读时重新从磁盘解密。
   * 用在磁盘数据被外部改过之后（例如从插件版搬入），否则实例里还留着搬之前的空数据。
   * 注意：清缓存不等于重新读取，调用后第一次读才落盘。
   */
  invalidateAll() {
    for (const value of Object.values(this)) {
      if (value && typeof value.invalidate === "function") value.invalidate();
    }
  }

  /**
   * 数据版本号：用户数据（自定义日子/生理期/每日总结）每次写操作后 +1。
   * 注入引擎用它判断「数据是否变化」——变了就立即刷新一次，不用等间隔到期。
   */
  getDataRev() {
    return Number(this.dataRev.read().rev) || 0;
  }

  async bumpDataRev() {
    await this.dataRev.update((d) => {
      d.rev = (Number(d.rev) || 0) + 1;
    });
    // App 在自己的共享单例上接此回调；保存成功后才更新对外情境。
    try { this.onPublicContextChange?.(); } catch { /* 对外出口不能反噬已落盘的记录 */ }
  }

  // ── 事件（自定义日子）──

  listEvents() {
    const { events } = this.events.read();
    return Object.values(events);
  }

  getEvent(id) {
    const data = this.events.read();
    const occurrenceId = parseTodoOccurrenceId(id);
    if (occurrenceId) {
      const series = data.events[occurrenceId.seriesId];
      return series ? buildTodoOccurrence(series, occurrenceId.date) : null;
    }
    return data.events[id] || null;
  }

  getTodoOccurrence(id, date, { preserveId = false } = {}) {
    const series = this.events.read().events[String(id || "")];
    return series ? buildTodoOccurrence(series, String(date || ""), { preserveId }) : null;
  }

  /**
   * 添加事件。
   * @param {object} e { title, type, date, repeatYearly, note, reminderStart, reminderEnd }
   * @returns {object} 完整事件
   */
  async addEvent({ title, type = "event", date, repeatYearly, repeatRule, note = "", reminderStart, reminderEnd }) {
    const parsed = parseDateInput(date);
    if (!parsed) throw new Error("日期格式不对，要用 YYYY-MM-DD 或 MM-DD");
    if (repeatRule != null && type !== "todo") throw new Error("只有待办可以按天或按星期重复");
    const normalizedRepeat = type === "todo" ? normalizeTodoRepeatRule(repeatRule) : null;
    const id = crypto.randomUUID();
    const ev = {
      id,
      title: String(title || "").trim(),
      type, // event | todo | period | anniversary
      date: parsed.key,
      repeatYearly: parsed.repeatYearly && !normalizedRepeat,
      note: String(note || "").trim(),
      createdAt: new Date().toISOString(),
    };
    if (!ev.title) throw new Error("名称不能为空");
    if (type === "todo") Object.assign(ev, normalizeTodoReminderWindow(reminderStart, reminderEnd));
    if (normalizedRepeat) {
      ev.repeatRule = normalizedRepeat;
      ev.completedDates = [];
    }
    await this.events.update((d) => {
      d.events[id] = ev;
    });
    await this.bumpDataRev();
    return ev;
  }

  async updateEvent(id, patch) {
    const parsedOccurrence = parseTodoOccurrenceId(id);
    const eventId = parsedOccurrence?.seriesId || id;
    const data = this.events.read();
    if (!data.events[eventId]) throw new Error("找不到这个日子");
    const ev = data.events[eventId];
    const originalSeriesDate = ev.date;
    if (isRecurringTodo(ev)) {
      if (patch.type !== undefined && patch.type !== "todo") throw new Error("周期待办不能直接改成其他类型");
      if (patch.date !== undefined) {
        const requestedDate = parseDateInput(patch.date);
        if (!requestedDate) throw new Error("日期格式不对");
        if (requestedDate.key !== ev.date) throw new Error("周期待办的开始日期暂不支持修改");
      }
      if (patch.repeatRule !== undefined) {
        const requestedRule = normalizeTodoRepeatRule(patch.repeatRule);
        if (JSON.stringify(requestedRule) !== JSON.stringify(normalizeTodoRepeatRule(ev.repeatRule))) {
          throw new Error("周期规则暂不支持直接修改；请删除这组后重新设置");
        }
      }
    }
    const nextType = patch.type !== undefined ? patch.type : ev.type;
    const nextReminder = nextType === "todo"
      ? normalizeTodoReminderWindow(
        patch.reminderStart !== undefined ? patch.reminderStart : ev.reminderStart,
        patch.reminderEnd !== undefined ? patch.reminderEnd : ev.reminderEnd,
      )
      : null;
    if (patch.title !== undefined) ev.title = String(patch.title).trim();
    if (patch.type !== undefined) ev.type = patch.type;
    if (patch.note !== undefined) ev.note = String(patch.note).trim();
    if (patch.repeatRule !== undefined) {
      if (patch.repeatRule != null && nextType !== "todo") throw new Error("只有待办可以按天或按星期重复");
      const normalized = nextType === "todo" ? normalizeTodoRepeatRule(patch.repeatRule) : null;
      if (normalized) ev.repeatRule = normalized;
      else delete ev.repeatRule;
    }
    if (nextType !== "todo") delete ev.repeatRule;
    if (patch.date !== undefined) {
      const parsed = parseDateInput(patch.date);
      if (!parsed) throw new Error("日期格式不对");
      ev.date = parsed.key;
      ev.repeatYearly = patch.repeatYearly !== undefined ? !!patch.repeatYearly : parsed.repeatYearly;
    } else if (patch.repeatYearly !== undefined) {
      ev.repeatYearly = !!patch.repeatYearly;
    }
    if (isRecurringTodo(ev)) ev.repeatYearly = false;
    if (parsedOccurrence && patch.repeatRule === null && !isRecurringTodo(ev)) {
      const requestedDate = patch.date ? parseDateInput(patch.date)?.key : "";
      if (!requestedDate || requestedDate === originalSeriesDate) {
        ev.date = parsedOccurrence.date;
        ev.repeatYearly = false;
        ev.done = Array.isArray(ev.completedDates) && ev.completedDates.includes(parsedOccurrence.date);
      }
    }
    if (nextReminder) Object.assign(ev, nextReminder);
    else {
      delete ev.reminderStart;
      delete ev.reminderEnd;
    }
    if (!ev.title) throw new Error("名称不能为空");
    await this.events.save();
    await this.bumpDataRev();
    if (parsedOccurrence && isRecurringTodo(ev)) {
      return buildTodoOccurrence(ev, parsedOccurrence.date) || ev;
    }
    return ev;
  }

  async removeEvent(id) {
    const occurrence = parseTodoOccurrenceId(id);
    const eventId = occurrence?.seriesId || id;
    await this.events.update((d) => {
      delete d.events[eventId];
    });
    await this.todoReminders.update((d) => {
      delete d.reminders[eventId];
    });
    await this.bumpDataRev();
  }

  // ── 待办提醒状态（由到点调度器使用）──

  getTodoReminder(id) {
    const key = String(id || "").trim();
    if (!key) return null;
    const reminders = this.todoReminders.read().reminders;
    return reminders && typeof reminders === "object" && !Array.isArray(reminders)
      ? reminders[key] || null
      : null;
  }

  async saveTodoReminder(id, value) {
    const key = String(id || "").trim();
    if (!key) return null;
    await this.todoReminders.update((d) => {
      if (!d.reminders || typeof d.reminders !== "object" || Array.isArray(d.reminders)) d.reminders = {};
      d.reminders[key] = value && typeof value === "object" ? { ...value } : {};
    });
    return this.getTodoReminder(key);
  }

  async removeTodoReminder(id) {
    const key = String(id || "").trim();
    if (!key) return false;
    let removed = false;
    await this.todoReminders.update((d) => {
      if (d.reminders && Object.prototype.hasOwnProperty.call(d.reminders, key)) {
        delete d.reminders[key];
        removed = true;
      }
    });
    return removed;
  }

  /**
   * 切换待办完成状态。
   * @param {string} id 事件 id
   * @returns {object|null} 更新后的事件（找不到返回 null）
   */
  async toggleTodo(id) {
    const occurrenceId = parseTodoOccurrenceId(id);
    const eventId = occurrenceId?.seriesId || id;
    const data = this.events.read();
    const ev = data.events[eventId];
    if (!ev || ev.type !== "todo") return null;
    if (isRecurringTodo(ev)) {
      const date = occurrenceId?.date || ev.date;
      if (!occurrenceMatches(ev, date)) return null;
      const completed = new Set(Array.isArray(ev.completedDates) ? ev.completedDates : []);
      if (completed.has(date)) completed.delete(date);
      else completed.add(date);
      ev.completedDates = [...completed].sort();
    } else {
      ev.done = !ev.done;
    }
    await this.events.save();
    await this.bumpDataRev();
    return occurrenceId ? buildTodoOccurrence(ev, occurrenceId.date) : ev;
  }

  async completeRecurringOverdue(seriesId, now = new Date()) {
    const id = String(seriesId || "").trim();
    const data = this.events.read();
    const event = data.events[id];
    if (!isRecurringTodo(event)) throw new Error("找不到这组周期待办");
    const yesterday = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 12);
    yesterday.setDate(yesterday.getDate() - 1);
    const through = dateKey(yesterday);
    const completed = new Set(Array.isArray(event.completedDates) ? event.completedDates : []);
    const addedDates = occurrenceDates(event, event.date, through).filter(date => !completed.has(date));
    if (!addedDates.length) return { count: 0, occurrences: [] };
    for (const date of addedDates) completed.add(date);
    event.completedDates = [...completed].sort();
    await this.events.save();
    await this.bumpDataRev();
    return {
      count: addedDates.length,
      occurrences: addedDates.map(date => buildTodoOccurrence(event, date)).filter(Boolean),
    };
  }

  /**
   * 查某天的用户自定义日子（含周期重复的匹配）。
   * @param {Date} date
   * @returns {Array<object>}
   */
  eventsOnDate(date) {
    const dk = dateKey(date);
    const mk = mmddKey(date);
    const { events } = this.events.read();
    return Object.values(events).flatMap((event) => {
      if (isRecurringTodo(event)) {
        const occurrence = buildTodoOccurrence(event, dk);
        return occurrence ? [occurrence] : [];
      }
      if (event.repeatYearly) return event.date.slice(5) === mk ? [event] : [];
      return event.date === dk ? [event] : [];
    });
  }

  listFocusSessions(date = null) {
    const rows = this.focusStore.read().sessions;
    return (Array.isArray(rows) ? rows : [])
      .filter((row) => row && typeof row === "object" && (!date || row.date === date))
      .map((row) => ({ ...row }))
      .sort((a, b) => Date.parse(a.startedAt) - Date.parse(b.startedAt));
  }

  listFocusGroups(date = null) {
    const rows = this.listFocusSessions();
    const active = this.focusStore.read().active;
    const groups = new Map();
    for (const row of rows) {
      const id = String(row.setId || row.id);
      if (!groups.has(id)) groups.set(id, { id, setId: id, sessions: [] });
      groups.get(id).sessions.push(row);
    }
    return [...groups.values()].map((group) => {
      const sessions = group.sessions.sort((a, b) => Date.parse(a.startedAt) - Date.parse(b.startedAt));
      const first = sessions[0];
      const last = sessions[sessions.length - 1];
      const planStatus = sessions.some(row => row.planStatus === "interrupted") ? "interrupted"
        : sessions.some(row => row.planStatus === "completed") ? "completed"
          : active && String(active.setId || active.id) === group.id ? "active"
            : sessions.every(row => row.status === "completed") ? "completed" : "interrupted";
      return {
        ...group,
        date: String(first.setDate || first.date || ""),
        startedAt: first.startedAt,
        endedAt: last.endedAt,
        taskId: first.taskId || "",
        taskTitle: first.taskTitle || "",
        companionId: first.companionId || "",
        companionName: first.companionName || "",
        totalRounds: Math.max(1, ...sessions.map(row => Number(row.totalRounds) || 1)),
        focusMinutes: Number(first.plannedMinutes) || 0,
        completedRounds: sessions.filter(row => row.status === "completed").length,
        totalFocusMs: sessions.reduce((sum, row) => sum + Math.max(0, Number(row.durationMs) || 0), 0),
        partialFocusMs: sessions.filter(row => row.status !== "completed").reduce((sum, row) => sum + Math.max(0, Number(row.durationMs) || 0), 0),
        planStatus,
        sessions,
        active: !!(active && String(active.setId || active.id) === group.id),
      };
    }).filter(group => !date || group.date === date || group.sessions.some(row => row.date === date)
      || active && String(active.setId || active.id) === group.id)
      .sort((a, b) => Date.parse(b.startedAt) - Date.parse(a.startedAt));
  }

  getFocusSettings() {
    return normalizeFocusConfig(this.focusStore.read().lastFocusConfig);
  }

  listFavoriteFocusGoalConfigs() {
    const state = this.focusStore.read();
    const stored = state.favoriteGoalConfigs && typeof state.favoriteGoalConfigs === "object" && !Array.isArray(state.favoriteGoalConfigs)
      ? state.favoriteGoalConfigs : {};
    const result = {};
    for (const title of this.listFavoriteFocusGoals()) {
      const key = focusGoalConfigKey(title);
      if (Object.prototype.hasOwnProperty.call(stored, key) && stored[key] && typeof stored[key] === "object") {
        result[key] = normalizeFocusConfig(stored[key]);
      }
    }
    return result;
  }

  async saveFocusSettings(value, favoriteGoalTitle = "") {
    const config = validateFocusConfig(value);
    const key = focusGoalConfigKey(favoriteGoalTitle);
    await this.focusStore.update(state => {
      state.lastFocusConfig = config;
      if (!key) return;
      const favorite = (Array.isArray(state.favoriteGoals) ? state.favoriteGoals : [])
        .find(item => focusGoalConfigKey(item) === key);
      if (!favorite) return;
      if (!state.favoriteGoalConfigs || typeof state.favoriteGoalConfigs !== "object" || Array.isArray(state.favoriteGoalConfigs)) state.favoriteGoalConfigs = {};
      state.favoriteGoalConfigs[key] = config;
    });
    return { focusConfig: { ...config }, favoriteGoalConfigs: this.listFavoriteFocusGoalConfigs() };
  }

  async selectFavoriteFocusGoal(value) {
    const title = String(value || "").trim();
    const key = focusGoalConfigKey(title);
    if (!key) throw new Error("这个常用目标已经不可用");
    let config;
    await this.focusStore.update(state => {
      const favorite = (Array.isArray(state.favoriteGoals) ? state.favoriteGoals : [])
        .find(item => focusGoalConfigKey(item) === key);
      if (!favorite) throw new Error("这个常用目标已经移除");
      if (!state.favoriteGoalConfigs || typeof state.favoriteGoalConfigs !== "object" || Array.isArray(state.favoriteGoalConfigs)) state.favoriteGoalConfigs = {};
      const saved = state.favoriteGoalConfigs[key];
      config = saved && typeof saved === "object" ? normalizeFocusConfig(saved) : normalizeFocusConfig(state.lastFocusConfig);
      state.favoriteGoalConfigs[key] = config;
      state.lastFocusConfig = config;
    });
    return { focusConfig: { ...config }, favoriteGoalConfigs: this.listFavoriteFocusGoalConfigs() };
  }

  listFavoriteFocusGoals() {
    const rows = this.focusStore.read().favoriteGoals;
    return (Array.isArray(rows) ? rows : []).filter(value => typeof value === "string" && value.trim())
      .map(value => value.trim()).slice(0, 20);
  }

  async addFavoriteFocusGoal(value, settings = null) {
    const title = String(value || "").trim().slice(0, 120);
    if (!title) throw new Error("先写下想保存的目标");
    const config = settings ? validateFocusConfig(settings) : this.getFocusSettings();
    await this.focusStore.update(state => {
      if (!Array.isArray(state.favoriteGoals)) state.favoriteGoals = [];
      const existing = state.favoriteGoals.find(item => focusGoalConfigKey(item) === focusGoalConfigKey(title));
      if (!existing) {
        if (state.favoriteGoals.length >= 20) throw new Error("常用目标最多保存 20 个");
        state.favoriteGoals.unshift(title);
      }
      if (!state.favoriteGoalConfigs || typeof state.favoriteGoalConfigs !== "object" || Array.isArray(state.favoriteGoalConfigs)) state.favoriteGoalConfigs = {};
      state.lastFocusConfig = config;
      state.favoriteGoalConfigs[focusGoalConfigKey(existing || title)] = config;
    });
    return this.listFavoriteFocusGoals();
  }

  async removeFavoriteFocusGoal(value) {
    const title = String(value || "").trim();
    const key = focusGoalConfigKey(title);
    await this.focusStore.update(state => {
      if (!Array.isArray(state.favoriteGoals)) state.favoriteGoals = [];
      state.favoriteGoals = state.favoriteGoals.filter(item => String(item).trim() !== title);
      if (key && state.favoriteGoalConfigs && typeof state.favoriteGoalConfigs === "object") delete state.favoriteGoalConfigs[key];
    });
    return this.listFavoriteFocusGoals();
  }

  async claimFocusEndNotification(id) {
    let claimed = false;
    await this.focusStore.update((state) => {
      const row = (Array.isArray(state.sessions) ? state.sessions : []).find(item => item?.id === id);
      if (!row || row.status !== "completed" || ["sending", "confirmed", "unknown", "suppressed"].includes(row.notificationState)) return;
      row.notificationState = "sending";
      claimed = true;
    });
    return claimed;
  }

  async settleFocusEndNotification(id, status) {
    if (!["confirmed", "failed", "unknown", "suppressed"].includes(status)) return false;
    let updated = false;
    await this.focusStore.update((state) => {
      const row = (Array.isArray(state.sessions) ? state.sessions : []).find(item => item?.id === id);
      if (!row || row.notificationState !== "sending") return;
      row.notificationState = status;
      updated = true;
    });
    return updated;
  }

  async recoverFocusEndNotifications() {
    let recovered = 0;
    await this.focusStore.update((state) => {
      for (const row of Array.isArray(state.sessions) ? state.sessions : []) {
        if (row?.notificationState !== "sending") continue;
        row.notificationState = "unknown";
        recovered += 1;
      }
    });
    return recovered;
  }

  async claimFocusStartNotification(id) {
    let claimed = false;
    await this.focusStore.update(state => {
      const active = state.active;
      if (!active || String(active.id) !== String(id) || active.phase !== "focus" || active.pausedAt
        || ["sending", "confirmed", "unknown", "failed", "suppressed"].includes(active.startNotificationState)) return;
      active.startNotificationState = "sending";
      claimed = true;
    });
    return claimed;
  }

  async settleFocusStartNotification(id, status) {
    if (!["confirmed", "failed", "unknown", "suppressed"].includes(status)) return false;
    let updated = false;
    await this.focusStore.update(state => {
      const active = state.active;
      if (!active || String(active.id) !== String(id) || active.startNotificationState !== "sending") return;
      active.startNotificationState = status;
      updated = true;
    });
    return updated;
  }

  async recoverFocusStartNotifications() {
    let recovered = false;
    await this.focusStore.update(state => {
      if (state.active?.startNotificationState !== "sending") return;
      state.active.startNotificationState = "unknown";
      recovered = true;
    });
    return recovered ? 1 : 0;
  }

  getFocusStats(now = new Date()) {
    const at = focusDate(now);
    const first = new Date(at.getFullYear(), at.getMonth(), at.getDate());
    first.setDate(first.getDate() - 6);
    const groups = this.listFocusGroups();
    const days = [];
    let totalDurationMs = 0;
    let completedCount = 0;
    for (let i = 0; i < 7; i++) {
      const date = new Date(first);
      date.setDate(first.getDate() + i);
      const key = dateKey(date);
      const entries = groups.filter(group => group.date === key);
      const durationMs = entries.reduce((total, group) => total + group.totalFocusMs, 0);
      const done = entries.filter(group => group.planStatus === "completed").length;
      totalDurationMs += durationMs;
      completedCount += done;
      days.push({ date: key, durationMs, count: entries.length, completedCount: done });
    }
    return { days, totalDurationMs, count: days.reduce((sum, day) => sum + day.count, 0), completedCount };
  }

  async advanceFocusSession(now = new Date()) {
    const at = focusDate(now);
    const nowMs = at.getTime();
    const active = this.focusStore.read().active;
    if (!active) return null;
    const targetMs = Date.parse(String(active.targetAt || ""));
    const due = Number.isFinite(targetMs) && targetMs <= nowMs && !active.pausedAt;
    if (!due) return active;

    await this.focusStore.update((state) => {
      if (!Array.isArray(state.sessions)) state.sessions = [];
      const current = state.active;
      const currentTargetMs = Date.parse(String(current?.targetAt || ""));
      if (!current || current.pausedAt || !Number.isFinite(currentTargetMs) || currentTargetMs > nowMs) return;
      const setId = String(current.setId || current.id);
      const totalRounds = Math.max(1, Number(current.totalRounds) || 1);
      const roundIndex = Math.max(1, Number(current.roundIndex) || 1);
      const setDate = String(current.setDate || dateKey(focusDate(current.startedAt)));
      const shortBreakMinutes = Math.max(1, Number(current.shortBreakMinutes ?? current.breakMinutes) || 5);
      const longBreakEvery = Math.max(0, Number(current.longBreakEvery) || 0);
      const longBreakMinutes = Math.max(1, Number(current.longBreakMinutes) || 15);
      if (current.phase === "focus") {
        const endedAt = new Date(currentTargetMs);
        const hasNextRound = roundIndex < totalRounds;
        const breakKindAfter = !hasNextRound ? "" : longBreakEvery > 0 && roundIndex % longBreakEvery === 0 ? "long" : "short";
        const record = focusRecord(current, {
          status: "completed",
          endedAt,
          durationMs: Number(current.plannedMinutes) * 60_000,
          planStatus: hasNextRound ? "active" : "completed",
          breakKindAfter,
        });
        if (!state.sessions.some((row) => row && row.id === current.id)) state.sessions.push(record);
        if (!hasNextRound) {
          setFocusPlanStatus(state, setId, "completed");
          state.active = null;
          return;
        }
        const breakMinutes = breakKindAfter === "long" ? longBreakMinutes : shortBreakMinutes;
        state.active = {
          id: current.id,
          setId,
          setDate,
          roundIndex,
          totalRounds,
          phase: "break",
          breakKind: breakKindAfter,
          startedAt: endedAt.toISOString(),
          targetAt: new Date(currentTargetMs + breakMinutes * 60_000).toISOString(),
          plannedMinutes: Number(current.plannedMinutes),
          breakMinutes,
          shortBreakMinutes,
          longBreakEvery,
          longBreakMinutes,
          taskId: String(current.taskId || ""),
          taskTitle: String(current.taskTitle || "").slice(0, 120),
          companionId: String(current.companionId || ""),
          companionName: String(current.companionName || ""),
        };
      } else if (current.phase === "break") {
        if (roundIndex >= totalRounds) {
          state.active = null;
          return;
        }
        const startedAt = at.toISOString();
        const plannedMinutes = Math.max(1, Number(current.plannedMinutes) || 25);
        state.active = {
          id: crypto.randomUUID(),
          setId,
          setDate,
          roundIndex: roundIndex + 1,
          totalRounds,
          phase: "focus",
          startedAt,
          activeSince: startedAt,
          targetAt: new Date(nowMs + plannedMinutes * 60_000).toISOString(),
          elapsedMs: 0,
          plannedMinutes,
          startNotificationState: "",
          breakMinutes: shortBreakMinutes,
          shortBreakMinutes,
          longBreakEvery,
          longBreakMinutes,
          taskId: String(current.taskId || ""),
          taskTitle: String(current.taskTitle || "").slice(0, 120),
          companionId: String(current.companionId || ""),
          companionName: String(current.companionName || "").slice(0, 120),
        };
      }
    });
    return this.focusStore.read().active;
  }

  async getFocusSnapshot(now = new Date()) {
    const at = focusDate(now);
    const active = await this.advanceFocusSession(at);
    const nowMs = at.getTime();
    const visibleActive = active ? {
      ...active,
      remainingMs: active.pausedAt
        ? Math.max(0, Number(active.remainingMs) || 0)
        : Math.max(0, Date.parse(String(active.targetAt || "")) - nowMs),
    } : null;
    return {
      active: visibleActive,
      sessions: this.listFocusSessions(dateKey(at)),
      groups: this.listFocusGroups(dateKey(at)),
      favoriteGoals: this.listFavoriteFocusGoals(),
      favoriteGoalConfigs: this.listFavoriteFocusGoalConfigs(),
      focusConfig: this.getFocusSettings(),
      stats: this.getFocusStats(at),
    };
  }

  async startFocusSession({ taskId = "", taskTitle = "", companionId = "", companionName = "", focusMinutes = 25, breakMinutes = 5, shortBreakMinutes = breakMinutes, totalRounds = 1, longBreakEvery = 4, longBreakMinutes = 15, focusConfig = null, favoriteGoalTitle = "", skipAdvance = false } = {}, now = new Date()) {
    const at = focusDate(now);
    const focusLength = Number(focusMinutes);
    const shortBreak = Number(shortBreakMinutes);
    const rounds = Number(totalRounds);
    const longEvery = Number(longBreakEvery);
    const longBreak = Number(longBreakMinutes);
    if (!VALID_FOCUS_MINUTES.has(focusLength)) throw new Error("请选择 15、25、30 或 45 分钟的专注时长");
    if (!Number.isInteger(shortBreak) || shortBreak < MIN_FOCUS_BREAK_MINUTES || shortBreak > MAX_FOCUS_BREAK_MINUTES) throw new Error("短休息请选择 1 到 60 分钟");
    if (!Number.isInteger(rounds) || rounds < 1 || rounds > MAX_FOCUS_ROUNDS) throw new Error("轮数请选择 1 到 20 轮");
    if (!Number.isInteger(longEvery) || longEvery < 0 || longEvery > MAX_FOCUS_ROUNDS) throw new Error("长休间隔请选择 0 到 20 轮");
    if (!Number.isInteger(longBreak) || longBreak < MIN_FOCUS_BREAK_MINUTES || longBreak > MAX_FOCUS_BREAK_MINUTES) throw new Error("长休息请选择 1 到 60 分钟");
    const savedConfig = validateFocusConfig({
      ...(focusConfig && typeof focusConfig === "object" ? focusConfig : {}),
      focusMinutes: focusLength,
      totalRounds: rounds,
      shortBreakMinutes: shortBreak,
      longBreakEnabled: typeof focusConfig?.longBreakEnabled === "boolean" ? focusConfig.longBreakEnabled : longEvery > 0,
      longBreakEvery: Number(focusConfig?.longBreakEvery) || (longEvery > 0 ? longEvery : DEFAULT_FOCUS_CONFIG.longBreakEvery),
      longBreakMinutes: longBreak,
    });
    const effectiveLongBreakEvery = savedConfig.longBreakEnabled ? savedConfig.longBreakEvery : 0;
    if (!skipAdvance) await this.advanceFocusSession(at);

    const linkedId = String(taskId || "").trim().slice(0, 200);
    const linked = linkedId ? this.getEvent(linkedId) : null;
    if (linkedId && (!linked || linked.type !== "todo")) throw new Error("只能关联拾光记里的待办");
    if (linked?.done) throw new Error("这条待办已经完成，不能再关联");

    const setId = crypto.randomUUID();
    const active = {
      id: crypto.randomUUID(),
      setId,
      setDate: dateKey(at),
      roundIndex: 1,
      totalRounds: rounds,
      phase: "focus",
      startedAt: at.toISOString(),
      activeSince: at.toISOString(),
      targetAt: new Date(at.getTime() + focusLength * 60_000).toISOString(),
      elapsedMs: 0,
      plannedMinutes: focusLength,
      breakMinutes: shortBreak,
      shortBreakMinutes: shortBreak,
      longBreakEvery: effectiveLongBreakEvery,
      longBreakMinutes: longBreak,
      startNotificationState: "",
      taskId: linkedId,
      taskTitle: String(linked ? linked.title || "" : taskTitle || "").trim().slice(0, 120),
      companionId: String(companionId || "").trim().slice(0, 200),
      companionName: String(companionName || "").trim().slice(0, 120),
    };
    await this.focusStore.update((state) => {
      if (state.active) throw new Error("先结束当前这段专注或休息");
      if (!Array.isArray(state.sessions)) state.sessions = [];
      state.lastFocusConfig = savedConfig;
      const favoriteKey = focusGoalConfigKey(favoriteGoalTitle);
      if (favoriteKey && (Array.isArray(state.favoriteGoals) ? state.favoriteGoals : []).some(item => focusGoalConfigKey(item) === favoriteKey)) {
        if (!state.favoriteGoalConfigs || typeof state.favoriteGoalConfigs !== "object" || Array.isArray(state.favoriteGoalConfigs)) state.favoriteGoalConfigs = {};
        state.favoriteGoalConfigs[favoriteKey] = savedConfig;
      }
      state.active = active;
    });
    return { ...active, remainingMs: focusLength * 60_000 };
  }

  async pauseFocusSession(now = new Date()) {
    const at = focusDate(now);
    await this.advanceFocusSession(at);
    let result = null;
    await this.focusStore.update((state) => {
      const active = state.active;
      if (!active || active.phase !== "focus") throw new Error("当前没有正在进行的专注");
      if (active.pausedAt) throw new Error("这段专注已经暂停");
      const plannedMs = Number(active.plannedMinutes) * 60_000;
      const activeSince = Date.parse(String(active.activeSince || ""));
      const elapsed = Math.min(plannedMs, Math.max(0, Number(active.elapsedMs) || 0) + Math.max(0, at.getTime() - activeSince));
      active.elapsedMs = elapsed;
      active.remainingMs = Math.max(0, plannedMs - elapsed);
      active.pausedAt = at.toISOString();
      delete active.activeSince;
      delete active.targetAt;
      result = { ...active };
    });
    return result;
  }

  async resumeFocusSession(now = new Date()) {
    const at = focusDate(now);
    await this.advanceFocusSession(at);
    let result = null;
    await this.focusStore.update((state) => {
      const active = state.active;
      if (!active || active.phase !== "focus" || !active.pausedAt) throw new Error("当前没有已暂停的专注");
      const remainingMs = Math.max(0, Math.min(Number(active.plannedMinutes) * 60_000, Number(active.remainingMs) || 0));
      if (!remainingMs) throw new Error("剩余时间为零，请结束这段专注并记下");
      active.activeSince = at.toISOString();
      active.targetAt = new Date(at.getTime() + remainingMs).toISOString();
      delete active.pausedAt;
      result = { ...active, remainingMs };
    });
    return result;
  }

  async endFocusSession(now = new Date()) {
    const at = focusDate(now);
    const before = this.focusStore.read().active;
    const beforeTarget = Date.parse(String(before?.targetAt || ""));
    const focusAlreadyDue = before?.phase === "focus" && !before.pausedAt && Number.isFinite(beforeTarget) && beforeTarget <= at.getTime();
    const breakAlreadyDue = before?.phase === "break" && Number.isFinite(beforeTarget) && beforeTarget <= at.getTime();
    await this.advanceFocusSession(at);
    if (focusAlreadyDue) {
      let partialSession = null;
      const setId = String(before.setId || before.id);
      await this.focusStore.update((state) => {
        const active = state.active;
        if (!active || String(active.setId || active.id) !== setId) return;
        if (active.phase === "focus" && !state.sessions.some(row => row && row.id === active.id)) {
          const plannedMs = Number(active.plannedMinutes) * 60_000;
          const runningSince = active.pausedAt ? NaN : Date.parse(String(active.activeSince || ""));
          const elapsedMs = Math.min(plannedMs, Math.max(0, Number(active.elapsedMs) || 0)
            + (Number.isFinite(runningSince) ? Math.max(0, at.getTime() - runningSince) : 0));
          partialSession = elapsedMs > 0 ? focusRecord(active, { status: "interrupted", endedAt: at, durationMs: elapsedMs }) : null;
          if (partialSession && !state.sessions.some(row => row && row.id === partialSession.id)) state.sessions.push(partialSession);
        }
        setFocusPlanStatus(state, setId, "interrupted");
        state.active = null;
      });
      const session = this.listFocusSessions().find(row => row.id === before.id) || null;
      return { phase: "focus", session, partialSession };
    }
    let result = null;
    await this.focusStore.update((state) => {
      const active = state.active;
      const setId = String(before?.setId || before?.id || active?.setId || active?.id || "");
      if (!before || !active && !before) {
        result = { phase: "none", session: null, alreadyEnded: true };
        return;
      }
      if (breakAlreadyDue && before?.phase === "break") {
        if (active && String(active.setId || active.id) === setId) state.active = null;
        setFocusPlanStatus(state, setId, "interrupted");
        result = { phase: "break", session: null };
        return;
      }
      if (!active) {
        const existing = before?.id && Array.isArray(state.sessions) ? state.sessions.find(row => row?.id === before.id) : null;
        setFocusPlanStatus(state, setId, "interrupted");
        result = before.phase === "break" ? { phase: "break", session: null, alreadyEnded: true }
          : existing ? { phase: "focus", session: { ...existing }, alreadyEnded: true }
            : { phase: "none", session: null, alreadyEnded: true };
        return;
      }
      if (active.phase === "break") {
        setFocusPlanStatus(state, setId, "interrupted");
        state.active = null;
        result = { phase: "break", session: null };
        return;
      }
      const plannedMs = Number(active.plannedMinutes) * 60_000;
      const runningSince = active.pausedAt ? NaN : Date.parse(String(active.activeSince || ""));
      const elapsedMs = Math.min(plannedMs, Math.max(0, Number(active.elapsedMs) || 0) + (Number.isFinite(runningSince) ? Math.max(0, at.getTime() - runningSince) : 0));
      const session = elapsedMs > 0 ? focusRecord(active, { status: "interrupted", endedAt: at, durationMs: elapsedMs, planStatus: "interrupted" }) : null;
      if (session && !state.sessions.some(row => row && row.id === session.id)) state.sessions.push(session);
      setFocusPlanStatus(state, setId, "interrupted");
      state.active = null;
      result = { phase: "focus", session, durationMs: elapsedMs };
    });
    return result;
  }

  async cancelFocusSession(now = new Date()) {
    const result = await this.endFocusSession(now);
    if (result?.session?.status === "completed") return { cancelled: false, completed: true, session: result.session };
    if (result?.phase === "none" || result?.alreadyEnded) return { cancelled: false, completed: false };
    return { cancelled: true, completed: false, session: result?.session || null, phase: result?.phase || "focus" };
  }

  // 生理期：单独的类型，查询「某天是否在生理期内」
  // 生理期存的是「开始日 + 持续天数」，在 events 里 type=period，note 存持续天数（默认 5）
  periodsActiveOn(date) {
    const dk = dateKey(date);
    const { events } = this.events.read();
    return Object.values(events).filter((e) => {
      if (e.type !== "period") return false;
      const days = parseInt(e.note, 10) || 5;
      for (let i = 0; i < days; i++) {
        const d = new Date(date);
        d.setDate(d.getDate() - i);
        if (dateKey(d) === e.date || (e.repeatYearly && mmddKey(d) === e.date.slice(5))) {
          return true;
        }
      }
      return false;
    });
  }

  /**
   * 某天是某个生理期的第几天（从 1 开始）。
   * 用日期差（忽略时刻）计算，避免下午算整天时 round 错位。
   * @param {object} period 生理期事件
   * @param {Date} date 目标日期
   * @returns {number} 第几天；不在生理期内返回 0
   */
  periodDayOn(period, date) {
    const days = parseInt(period.note, 10) || 5;
    // 用日期键算整天差（忽略时刻，避免 round 错位）
    const startKey = dateKey(new Date(period.date + "T00:00:00"));
    const dateKeyStr = dateKey(date);
    const diff = Math.round(
      (new Date(dateKeyStr + "T00:00:00").getTime() - new Date(startKey + "T00:00:00").getTime()) / 86400000
    );
    if (diff < 0 || diff >= days) return 0;
    return diff + 1;
  }

  /**
   * 查询某天处于生理期内的记录，带第几天信息。
   * @param {Date} date
   * @returns {Array<{event: object, day: number}>}
   */
  periodsWithDayOn(date) {
    const dk = dateKey(date);
    return this.periodsActiveOn(date).map((p) => {
      // 老数据没有 confirmedThrough 时，已过去的范围视为事实；未来仍是预计。
      const confirmedThrough = p.confirmedThrough || dateKey(new Date());
      return { event: p, day: this.periodDayOn(p, date), predicted: dk > confirmedThrough };
    });
  }

  /**
   * 周期规律：把已记录的生理期整理成「历史周期 + 汇总 + 下次预计」。
   * 只做计算，不改数据；样本不够时只给历史，不给汇总和预测（宁缺毋假）。
   * 门槛：至少 3 次周期记录（2 段有效间隔）才开始呈现规律。
   * @param {Date} [now] 用来算「今天走到第几天」，测试可注入固定日期
   * @returns {object} 供页面与测试直接使用的纯数据
   */
  periodPattern(now = new Date()) {
    const MIN_INTERVAL_DAYS = 15; // 比这更短的间隔视为误标，不计入统计
    const SHOW_CYCLES = 6; // 卡片上最多回溯几次
    const MIN_SAMPLES = 2; // 至少两段间隔才够算规律

    const { events } = this.events.read();
    const sorted = Object.values(events)
      .filter((e) => e.type === "period" && typeof e.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(e.date))
      .map((e) => {
        const days = parseInt(e.note, 10) || 5;
        const startDate = new Date(e.date + "T00:00:00");
        const endDate = new Date(startDate);
        endDate.setDate(endDate.getDate() + days - 1);
        return {
          start: e.date,
          days,
          // 确认过的周期才是事实；没确认的只是记了开始日
          confirmed: !!e.confirmedThrough && e.confirmedThrough >= dateKey(endDate),
        };
      })
      .sort((a, b) => (a.start < b.start ? -1 : a.start > b.start ? 1 : 0));

    // 每段与上一次开始日之间隔了多少天
    for (let i = 1; i < sorted.length; i++) {
      const prev = new Date(sorted[i - 1].start + "T00:00:00");
      const cur = new Date(sorted[i].start + "T00:00:00");
      sorted[i].interval = Math.round((cur.getTime() - prev.getTime()) / 86400000);
    }
    const allIntervals = sorted
      .slice(1)
      .map((c) => c.interval)
      .filter((n) => Number.isFinite(n) && n >= MIN_INTERVAL_DAYS);
    const enough = allIntervals.length >= MIN_SAMPLES;

    const medianOf = (nums) => {
      const s = [...nums].sort((a, b) => a - b);
      const mid = Math.floor(s.length / 2);
      return s.length % 2 ? s[mid] : Math.round((s[mid - 1] + s[mid]) / 2);
    };
    const shift = (key, n) => {
      const d = new Date(key + "T00:00:00");
      d.setDate(d.getDate() + n);
      return dateKey(d);
    };

    const recent = sorted.slice(-SHOW_CYCLES);
    const last = sorted[sorted.length - 1] || null;

    let stats = null;
    let next = null;
    if (enough && last) {
      stats = {
        samples: allIntervals.length,
        medianInterval: medianOf(allIntervals),
        minInterval: Math.min(...allIntervals),
        maxInterval: Math.max(...allIntervals),
        medianDays: medianOf(recent.map((c) => c.days)),
      };
      next = {
        earliest: shift(last.start, stats.minInterval),
        likely: shift(last.start, stats.medianInterval),
        latest: shift(last.start, stats.maxInterval),
      };
    }

    let current = null;
    if (last) {
      const today = new Date(dateKey(now) + "T00:00:00");
      const day = Math.round((today.getTime() - new Date(last.start + "T00:00:00").getTime()) / 86400000) + 1;
      if (day >= 1) {
        current = { day, start: last.start };
        if (next) {
          const overdue = Math.round((today.getTime() - new Date(next.latest + "T00:00:00").getTime()) / 86400000);
          if (overdue > 0) current.overdueDays = overdue;
        }
      }
    }

    return {
      total: sorted.length,
      cycles: recent.map((c) => ({ ...c })),
      enough,
      needMore: enough ? 0 : Math.max(1, 3 - sorted.length),
      stats,
      next,
      current,
    };
  }

  /**
   * 快捷标记生理期：把某天标为生理期（点选语义）。
   * - 该天已在某个周期内 → 无变化
   * - 该天的前一天或后一天在某周期内 → 并入该周期（延伸或提前开始日）
   * - 否则 → 以该天为开始日新建周期（持续 duration 天，默认 5）
   * @param {Date} date 要标记的那天
   * @param {number} duration 全新开始时默认持续天数（默认 5）
   * @returns {object} { created: boolean, event: object }
   */
  async markPeriod(date, duration = 5) {
    const dk = dateKey(date);
    const { events } = this.events.read();
    const existing = Object.values(events).filter((e) => e.type === "period");
    // 1) 该天已在某周期内：无变化
    const inside = existing.find((e) => this.periodDayOn(e, date) > 0);
    if (inside) {
      let confirmed = false;
      if (!inside.confirmedThrough || dk > inside.confirmedThrough) {
        inside.confirmedThrough = dk;
        await this.events.save();
        confirmed = true;
        await this.bumpDataRev();
      }
      return { created: false, confirmed, event: inside };
    }
    // 2) 前一天在某周期内 → 延伸该周期
    const prev = new Date(date);
    prev.setDate(prev.getDate() - 1);
    const inPrev = existing.find((e) => this.periodDayOn(e, prev) > 0);
    if (inPrev) {
      const curEnd = new Date(inPrev.date + "T00:00:00");
      curEnd.setDate(curEnd.getDate() + (parseInt(inPrev.note, 10) || 5) - 1);
      if (date.getTime() > curEnd.getTime()) {
        const newDays = Math.round((date.getTime() - new Date(inPrev.date + "T00:00:00").getTime()) / 86400000) + 1;
        inPrev.note = String(newDays);
        inPrev.title = "生理期";
        inPrev.confirmedThrough = dk;
        await this.events.save();
        await this.bumpDataRev();
      }
      return { created: false, extended: true, event: inPrev };
    }
    // 3) 后一天在某周期内 → 提前开始日
    const next = new Date(date);
    next.setDate(next.getDate() + 1);
    const inNext = existing.find((e) => this.periodDayOn(e, next) > 0);
    if (inNext) {
      // 新周期 = 从 date 到原结束日
      const curEnd = new Date(inNext.date + "T00:00:00");
      curEnd.setDate(curEnd.getDate() + (parseInt(inNext.note, 10) || 5) - 1);
      const newDays = Math.round((curEnd.getTime() - date.getTime()) / 86400000) + 1;
      inNext.date = dk;
      inNext.note = String(newDays);
      inNext.title = "生理期";
      await this.events.save();
      await this.bumpDataRev();
      return { created: false, extended: true, event: inNext };
    }
    // 4) 全新开始
    const id = crypto.randomUUID();
    const ev = {
      id,
      title: "生理期",
      type: "period",
      date: dk,
      repeatYearly: false,
      note: String(Math.max(1, parseInt(duration, 10) || 5)),
      createdAt: new Date().toISOString(),
      confirmedThrough: dk,
    };
    await this.events.update((d) => {
      d.events[id] = ev;
    });
    await this.bumpDataRev();
    return { created: true, event: ev };
  }

  /**
   * 移除某天在生理期上的标记：
   * - 如果该天是开始日且周期只有 1 天 → 整条删除
   * - 如果该天是开始日但周期更长 → 开始日顺延一天，持续天数减一
   * - 如果该天在周期中间/末尾 → 缩短持续天数到该天前一天
   * @param {Date} date 要移除的那天
   * @returns {boolean} 是否有变动
   */
  async unmarkPeriodDay(date) {
    const dk = dateKey(date);
    const { events } = this.events.read();
    const period = Object.values(events).find((e) => e.type === "period" && this.periodDayOn(e, date) > 0);
    if (!period) return false;
    const dayIdx = this.periodDayOn(period, date); // 1-based
    const totalDays = parseInt(period.note, 10) || 5;
    const start = new Date(period.date + "T00:00:00");
    if (totalDays <= 1 || (dayIdx === 1 && totalDays === 1)) {
      // 只剩这一天：整条删除
      delete events[period.id];
      await this.events.save();
      await this.bumpDataRev();
      return true;
    }
    if (dayIdx === 1) {
      // 删除开始日：开始日 +1，持续天数 -1
      start.setDate(start.getDate() + 1);
      period.date = dateKey(start);
      period.note = String(totalDays - 1);
    } else {
      // 删除中间/末尾：持续天数缩到该天前一天
      period.note = String(dayIdx - 1);
    }
    await this.events.save();
    await this.bumpDataRev();
    return true;
  }

  /**
   * 确认一段生理期到此结束（「今天结束了」语义，不删任何已记的天）。
   * - 该日仍在某周期内 → 周期截断到该日（note = 该日 - 开始日 + 1），confirmedThrough 置为该日
   * - 该日不在周期内但前一天在（结束后第一天）→ 周期保持不动，仅 confirmedThrough 置为前一天，确认它已结束
   * - 都没有 → 无操作
   * @param {Date} date 结束确认日（通常是今天）
   * @returns {{ changed: boolean, period: object|null }} 是否有变动 + 涉及周期
   */
  async endPeriodOn(date) {
    const dk = dateKey(date);
    const { events } = this.events.read();
    const all = Object.values(events).filter((e) => e.type === "period");
    if (!all.length) return { changed: false, period: null };
    // 优先：当天在周期内 → 截断到今天
    const inside = all.find((e) => this.periodDayOn(e, date) > 0);
    if (inside) {
      const dayIdx = this.periodDayOn(inside, date);
      const totalDays = parseInt(inside.note, 10) || 5;
      if (dayIdx !== totalDays || (inside.confirmedThrough || "") !== dk) {
        inside.note = String(dayIdx);
        inside.title = "生理期";
        inside.confirmedThrough = dk;
        await this.events.save();
        await this.bumpDataRev();
      }
      return { changed: true, period: inside };
    }
    // 其次：前一天在周期内（今天已结束）→ 仅确认结束，不删任何天
    const prev = new Date(date);
    prev.setDate(prev.getDate() - 1);
    const inPrev = all.find((e) => this.periodDayOn(e, prev) > 0);
    if (inPrev) {
      const prevKey = dateKey(prev);
      if ((inPrev.confirmedThrough || "") !== prevKey) {
        inPrev.confirmedThrough = prevKey;
        await this.events.save();
        await this.bumpDataRev();
      }
      return { changed: true, period: inPrev };
    }
    return { changed: false, period: null };
  }

  /**
   * 旧数据迁移：识别标题里手写「生理期第 N 天」的记录，反推开始日，转成规范周期记录。
   * - 标题含「生理期」且匹配「第N天」→ date 反推为开始日，note=持续天数，title 归一为「生理期」
   * - 标题含「生理期」但无法识别第几天 → 视为开始日（第1天）
   * - 已规范的 period 记录不动
   * @returns {object} { migrated: number, uncertain: number, details: Array }
   */
  async migrateLegacyPeriods() {
    const { events } = this.events.read();
    const items = Object.values(events);
    const details = [];
    let migrated = 0;
    let uncertain = 0;
    for (const ev of items) {
      // 已规范：type=period 且标题就是「生理期」→ 跳过
      if (ev.type === "period") {
        if (ev.title === "生理期") continue;
        // 老数据可能 title 是「生理期第N天」但 type 已是 period：归一 title，保留 date/note 不动
        const n = parseChineseDay(ev.title || "");
        if (n > 0 && ev.date) {
          const start = new Date(ev.date + "T00:00:00");
          start.setDate(start.getDate() - (n - 1));
          const confirmedThrough = ev.date;
          ev.date = dateKey(start);
          ev.note = String(n);
          ev.confirmedThrough = confirmedThrough;
          ev.title = "生理期";
          migrated++;
          details.push({ id: ev.id, from: "period", to: "period", start: ev.date, days: n });
          continue;
        }
        ev.title = "生理期";
        uncertain++;
        details.push({ id: ev.id, from: "period", to: "period-normalized-title" });
        continue;
      }
      // 非 period 类型但标题含「生理期」→ 转为周期记录
      if ((ev.title || "").includes("生理期") || (ev.note || "").includes("生理期")) {
        const n = parseChineseDay(ev.title || "");
        if (n > 0) {
          // 标题是「生理期第N天」，date 是当天 → 反推开始日 = date - (N-1)
          const start = new Date(ev.date + "T00:00:00");
          start.setDate(start.getDate() - (n - 1));
          const confirmedThrough = ev.date;
          ev.type = "period";
          ev.date = dateKey(start);
          ev.note = String(n);
          ev.confirmedThrough = confirmedThrough;
          ev.repeatYearly = false;
          ev.title = "生理期";
          migrated++;
          details.push({ id: ev.id, from: "handwritten", to: "period", start: ev.date, days: n });
          continue;
        }
        // 无法识别第几天：视为开始日（第1天，默认持续天数）
        ev.type = "period";
        ev.repeatYearly = false;
        ev.note = String(parseInt(ev.note, 10) || 5);
        ev.title = "生理期";
        migrated++;
        details.push({ id: ev.id, from: "handwritten-uncertain", to: "period-start-only", start: ev.date });
      }
    }
    if (migrated > 0 || uncertain > 0) {
      await this.events.save();
    }
    return { migrated, uncertain, details };
  }

  // ── 每日总结 ──

  getSummary(key) {
    return this.summaries.read().summaries[key] || null;
  }

  getSummaryRecord(key) {
    const raw = this.getSummary(key);
    if (!raw || typeof raw !== "object") return null;
    if (raw.byAgent && typeof raw.byAgent === "object" && !Array.isArray(raw.byAgent)) {
      return {
        version: 2,
        byAgent: raw.byAgent,
        legacy: raw.legacy && typeof raw.legacy === "object" ? raw.legacy : null,
        updatedAt: raw.updatedAt || "",
      };
    }
    // 旧版只有一份混合总结，保留为未分类档案，不擅自猜归属。
    return { version: 1, byAgent: {}, legacy: raw, updatedAt: raw.updatedAt || "" };
  }

  static isUsableSummary(summary) {
    return !!summary && !summary.empty && !!String(summary.text || "").trim();
  }

  hasSummary(key, { includeEmpty = false } = {}) {
    const record = this.getSummaryRecord(key);
    if (!record) return false;
    const entries = Object.values(record.byAgent || {});
    if (entries.some((entry) => UserData.isUsableSummary(entry))) return true;
    return includeEmpty && !!record.legacy;
  }

  hasAgentSummary(key) {
    return this.listSummaryEntries(key).some((entry) => !entry.unclassified && UserData.isUsableSummary(entry));
  }

  listSummaryEntries(date = null, { includeEmpty = false } = {}) {
    const { summaries } = this.summaries.read();
    const entries = [];
    for (const [key, raw] of Object.entries(summaries || {})) {
      if (date && key !== date) continue;
      const record = this.getSummaryRecordFromRaw(raw);
      for (const [agentId, summary] of Object.entries(record.byAgent || {})) {
        if (!includeEmpty && !UserData.isUsableSummary(summary)) continue;
        entries.push({ date: key, ...summary, agentId, unclassified: false });
      }
      if (record.legacy && (includeEmpty || UserData.isUsableSummary(record.legacy))) {
        entries.push({ date: key, ...record.legacy, agentId: "", unclassified: true });
      }
    }
    return entries.sort((a, b) => {
      if (a.date !== b.date) return a.date < b.date ? 1 : -1;
      if (a.unclassified !== b.unclassified) return a.unclassified ? 1 : -1;
      return String(a.agentId).localeCompare(String(b.agentId));
    });
  }

  getSummaryRecordFromRaw(raw) {
    if (!raw || typeof raw !== "object") return { version: 1, byAgent: {}, legacy: null, updatedAt: "" };
    if (raw.byAgent && typeof raw.byAgent === "object" && !Array.isArray(raw.byAgent)) {
      return {
        version: 2,
        byAgent: raw.byAgent,
        legacy: raw.legacy && typeof raw.legacy === "object" ? raw.legacy : null,
        updatedAt: raw.updatedAt || "",
      };
    }
    return { version: 1, byAgent: {}, legacy: raw, updatedAt: raw.updatedAt || "" };
  }

  getAgentSummary(key, agentId) {
    const id = String(agentId || "").trim();
    if (!id) return null;
    const record = this.getSummaryRecord(key);
    return record?.byAgent?.[id] || null;
  }

  listSummaries() {
    // 兼容旧调用方：展开新档案，并把旧混合档案标成未分类。
    return this.listSummaryEntries();
  }

  async saveSummary(key, text, meta = {}) {
    // 保留旧 API 语义：没有 agentId 时写入未分类 legacy；不会覆盖已有按伙伴档案。
    const value = {
      ...meta,
      text: String(text || ""),
      updatedAt: new Date().toISOString(),
    };
    await this.summaries.update((d) => {
      const current = d.summaries[key];
      if (current?.byAgent && typeof current.byAgent === "object" && !Array.isArray(current.byAgent)) {
        d.summaries[key] = {
          ...current,
          legacy: value,
          updatedAt: value.updatedAt,
        };
      } else {
        d.summaries[key] = value;
      }
    });
    await this.bumpDataRev();
  }

  async saveAgentSummary(key, agentId, text, meta = {}) {
    const id = String(agentId || "").trim();
    if (!id) throw new Error("缺少伙伴身份，不能保存分类档案");
    const value = {
      ...meta,
      agentId: id,
      text: String(text || ""),
      updatedAt: new Date().toISOString(),
    };
    await this.summaries.update((d) => {
      const current = d.summaries[key];
      const record = this.getSummaryRecordFromRaw(current);
      record.byAgent[id] = value;
      d.summaries[key] = {
        version: 2,
        byAgent: record.byAgent,
        ...(record.legacy ? { legacy: record.legacy } : {}),
        updatedAt: value.updatedAt,
      };
    });
    await this.bumpDataRev();
    return value;
  }

  async removeAgentSummary(key, agentId) {
    const id = String(agentId || "").trim();
    if (!id) return this.removeLegacySummary(key);
    let removed = false;
    await this.summaries.update((d) => {
      const current = d.summaries[key];
      const record = this.getSummaryRecordFromRaw(current);
      if (!Object.prototype.hasOwnProperty.call(record.byAgent, id)) return;
      delete record.byAgent[id];
      removed = true;
      if (!Object.keys(record.byAgent).length && !record.legacy) {
        delete d.summaries[key];
        return;
      }
      d.summaries[key] = {
        version: 2,
        byAgent: record.byAgent,
        ...(record.legacy ? { legacy: record.legacy } : {}),
        updatedAt: new Date().toISOString(),
      };
    });
    if (removed) await this.bumpDataRev();
    return removed;
  }

  async removeLegacySummary(key) {
    let removed = false;
    await this.summaries.update((d) => {
      const current = d.summaries[key];
      if (!current) return;
      const record = this.getSummaryRecordFromRaw(current);
      if (!record.legacy) return;
      removed = true;
      if (!Object.keys(record.byAgent).length) {
        delete d.summaries[key];
        return;
      }
      d.summaries[key] = {
        version: 2,
        byAgent: record.byAgent,
        updatedAt: new Date().toISOString(),
      };
    });
    if (removed) await this.bumpDataRev();
    return removed;
  }

  async removeSummary(key) {
    await this.summaries.update((d) => {
      delete d.summaries[key];
    });
    await this.bumpDataRev();
  }

  // ── 每日总结后台任务 ──

  getSummaryJob(id) {
    const key = String(id || "").trim();
    const jobs = this.summaryJobs.read().jobs;
    return key && jobs && typeof jobs === "object" && !Array.isArray(jobs) ? jobs[key] || null : null;
  }

  listSummaryJobs(limit = 20) {
    const max = Math.max(1, Number(limit) || 20);
    const jobs = this.summaryJobs.read().jobs;
    const map = jobs && typeof jobs === "object" && !Array.isArray(jobs) ? jobs : {};
    const values = Object.values(map).filter((job) => job && typeof job === "object");
    // 只对外暴露主线任务：merged 的重试任务、以及「原任务已结束」的旧版重试残留，都不再展示。
    const visible = values.filter((job) => {
      if (job.status === "merged" || job.cancelledAt) return false;
      const retryOf = String(job.retryOf || "").trim();
      if (!retryOf) return true;
      // 重试任务还在跑（queued/running）时必须展示，用户要看进度。
      if (job.status === "queued" || job.status === "running") return true;
      const parent = map[retryOf];
      // 重试任务已结束：原任务已被确认收下、已合并完成或已是终态，重试残留不必再出现。
      if (!parent || parent.status === "merged" || parent.dismissedAt) return false;
      return !["completed", "completed_with_errors", "failed"].includes(parent.status);
    });
    return visible
      .sort((a, b) => String(b.updatedAt || b.createdAt || "").localeCompare(String(a.updatedAt || a.createdAt || "")))
      .slice(0, max);
  }

  async createSummaryJob(job) {
    const id = String(job?.id || "").trim();
    if (!id) throw new Error("缺少后台任务编号");
    const value = {
      ...job,
      id,
      dates: Array.isArray(job.dates) ? [...new Set(job.dates.map((date) => String(date)))] : [],
      outcomes: Array.isArray(job.outcomes) ? job.outcomes : [],
      createdAt: job.createdAt || new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    await this.summaryJobs.update((d) => {
      if (!d.jobs || typeof d.jobs !== "object" || Array.isArray(d.jobs)) d.jobs = {};
      d.jobs[id] = value;
    });
    return value;
  }

  async updateSummaryJob(id, patch = {}) {
    const key = String(id || "").trim();
    if (!key) return null;
    let value = null;
    await this.summaryJobs.update((d) => {
      if (!d.jobs || typeof d.jobs !== "object" || Array.isArray(d.jobs) || !d.jobs[key]) return;
      d.jobs[key] = { ...d.jobs[key], ...patch, updatedAt: new Date().toISOString() };
      value = d.jobs[key];
    });
    return value;
  }

  // ── 情绪（记一笔当下的心情）──

  listMoods(date = null) {
    const { moods } = this.moods.read();
    const map = moods && typeof moods === "object" && !Array.isArray(moods) ? moods : {};
    const days = date ? [String(date)] : Object.keys(map);
    const rows = [];
    for (const key of days) {
      const list = Array.isArray(map[key]) ? map[key] : [];
      for (const item of list) {
        if (!item || typeof item !== "object") continue;
        rows.push({ date: key, ...item });
      }
    }
    return rows.sort((a, b) => {
      if (a.date !== b.date) return a.date < b.date ? -1 : 1;
      return String(a.recordedAt || "").localeCompare(String(b.recordedAt || ""));
    });
  }

  getDayMoods(date) {
    const { moods } = this.moods.read();
    const map = moods && typeof moods === "object" && !Array.isArray(moods) ? moods : {};
    return Array.isArray(map[date]) ? map[date] : [];
  }

  /** 只取手动条目（合稿补空档与展示优先级用） */
  listManualMoods(date) {
    return this.getDayMoods(date).filter((m) => m && m.source === "manual");
  }

  getMoodHarvestState(date) {
    const key = String(date || "").trim();
    if (!key) return null;
    const { harvests } = this.moodHarvests.read();
    const map = harvests && typeof harvests === "object" && !Array.isArray(harvests) ? harvests : {};
    return map[key] && typeof map[key] === "object" ? { ...map[key] } : null;
  }

  /** 保存自动情绪发现的日级状态；状态独立于心情条目，避免重启重复调用模型。 */
  async updateMoodHarvestState(date, patch = {}) {
    const key = String(date || "").trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(key)) throw new Error("日期格式不对");
    let value = null;
    await this.moodHarvests.update((d) => {
      if (!d.harvests || typeof d.harvests !== "object" || Array.isArray(d.harvests)) d.harvests = {};
      const current = d.harvests[key] && typeof d.harvests[key] === "object" ? d.harvests[key] : {};
      d.harvests[key] = { ...current, ...(patch && typeof patch === "object" ? patch : {}), updatedAt: new Date().toISOString() };
      value = { ...d.harvests[key] };
    });
    return value;
  }

  async addMood(date, entry) {
    const key = String(date || "").trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(key)) throw new Error("日期格式不对");
    if (!entry || typeof entry !== "object" || !entry.id) throw new Error("这条心情不完整");
    await this.moods.update((d) => {
      if (!d.moods || typeof d.moods !== "object" || Array.isArray(d.moods)) d.moods = {};
      if (!Array.isArray(d.moods[key])) d.moods[key] = [];
      d.moods[key].push({ ...entry });
    });
    await this.bumpDataRev();
    return this.getDayMoods(key);
  }

  /** 替换某天整组条目（合稿结果落库用；手动条目原样保留由调用方保证） */
  async replaceDayMoods(date, entries) {
    const key = String(date || "").trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(key)) throw new Error("日期格式不对");
    const list = Array.isArray(entries) ? entries.filter((e) => e && typeof e === "object" && e.id) : [];
    await this.moods.update((d) => {
      if (!d.moods || typeof d.moods !== "object" || Array.isArray(d.moods)) d.moods = {};
      d.moods[key] = list.map((e) => ({ ...e }));
    });
    await this.bumpDataRev();
    return this.getDayMoods(key);
  }

  async updateMood(date, id, patch) {
    const key = String(date || "").trim();
    const moodId = String(id || "").trim();
    if (!key || !moodId) return null;
    let updated = null;
    await this.moods.update((d) => {
      const map = d.moods && typeof d.moods === "object" && !Array.isArray(d.moods) ? d.moods : (d.moods = {});
      const list = Array.isArray(map[key]) ? map[key] : [];
      const found = list.find((m) => m && m.id === moodId);
      if (!found) return;
      Object.assign(found, patch || {});
      updated = { ...found };
    });
    if (updated) await this.bumpDataRev();
    return updated;
  }

  async removeMood(date, id) {
    const key = String(date || "").trim();
    const moodId = String(id || "").trim();
    if (!key || !moodId) return false;
    let removed = false;
    await this.moods.update((d) => {
      const map = d.moods && typeof d.moods === "object" && !Array.isArray(d.moods) ? d.moods : (d.moods = {});
      const list = Array.isArray(map[key]) ? map[key] : [];
      const next = list.filter((m) => !(m && m.id === moodId));
      removed = next.length !== list.length;
      if (removed) {
        if (next.length) map[key] = next;
        else delete map[key];
      }
    });
    if (removed) await this.bumpDataRev();
    return removed;
  }

  /** 某天是否有情绪记录（日历角标/注入判断用） */
  hasMood(date) {
    return this.getDayMoods(date).length > 0;
  }

  // ── 伙伴心情线（独立于用户的 moods.dat，PR 试水功能）──

  /** 全部伙伴情绪记录；带 date=某天时只列那天。行含 date/agentId。 */
  listPartnerMoods(date = null) {
    const { partnerMoods } = this.partnerMoods.read();
    const map = partnerMoods && typeof partnerMoods === "object" && !Array.isArray(partnerMoods) ? partnerMoods : {};
    const days = date ? [String(date)] : Object.keys(map);
    const rows = [];
    for (const key of days) {
      const byAgent = map[key] && typeof map[key] === "object" && !Array.isArray(map[key]) ? map[key] : {};
      for (const agentId of Object.keys(byAgent)) {
        const list = Array.isArray(byAgent[agentId]) ? byAgent[agentId] : [];
        for (const item of list) {
          if (!item || typeof item !== "object") continue;
          rows.push({ date: key, agentId, ...item });
        }
      }
    }
    return rows.sort((a, b) => {
      if (a.date !== b.date) return a.date < b.date ? -1 : 1;
      return String(a.recordedAt || "").localeCompare(String(b.recordedAt || ""));
    });
  }

  /** 某天全部伙伴的情绪，按 agentId 分组。 */
  getPartnerDayMoods(date) {
    const { partnerMoods } = this.partnerMoods.read();
    const map = partnerMoods && typeof partnerMoods === "object" && !Array.isArray(partnerMoods) ? partnerMoods : {};
    const byAgent = map[date] && typeof map[date] === "object" && !Array.isArray(map[date]) ? map[date] : {};
    const out = {};
    for (const agentId of Object.keys(byAgent)) {
      const list = Array.isArray(byAgent[agentId]) ? byAgent[agentId] : [];
      if (list.length) out[agentId] = list;
    }
    return out;
  }

  /** 某天某伙伴的情绪条目。 */
  getPartnerMoods(date, agentId) {
    const { partnerMoods } = this.partnerMoods.read();
    const map = partnerMoods && typeof partnerMoods === "object" && !Array.isArray(partnerMoods) ? partnerMoods : {};
    const byAgent = map[date] && typeof map[date] === "object" && !Array.isArray(map[date]) ? map[date] : {};
    return Array.isArray(byAgent[agentId]) ? byAgent[agentId] : [];
  }

  /** 替换某天某伙伴整组条目（日终伙伴链合稿落库用）。 */
  async replacePartnerDayMoods(date, agentId, entries) {
    const key = String(date || "").trim();
    const agent = String(agentId || "").trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(key)) throw new Error("日期格式不对");
    if (!agent) throw new Error("伙伴不对");
    const list = Array.isArray(entries) ? entries.filter((e) => e && typeof e === "object" && e.id) : [];
    await this.partnerMoods.update((d) => {
      if (!d.partnerMoods || typeof d.partnerMoods !== "object" || Array.isArray(d.partnerMoods)) d.partnerMoods = {};
      if (!d.partnerMoods[key] || typeof d.partnerMoods[key] !== "object" || Array.isArray(d.partnerMoods[key])) d.partnerMoods[key] = {};
      d.partnerMoods[key][agent] = list.map((e) => ({ ...e }));
    });
    return this.getPartnerMoods(key, agent);
  }

  /** 某天某伙伴的伙伴链日级状态（幂等，防重启重复调模型）。 */
  getPartnerMoodHarvestState(date, agentId) {
    const key = `${String(date || "").trim()}|${String(agentId || "").trim()}`;
    if (!key.includes("|") || key.startsWith("|") || key.endsWith("|")) return null;
    const { harvests } = this.partnerMoodHarvests.read();
    const map = harvests && typeof harvests === "object" && !Array.isArray(harvests) ? harvests : {};
    return map[key] && typeof map[key] === "object" ? { ...map[key] } : null;
  }

  /** 列出伙伴链状态，用于自动重试判断；不返回原始对话。 */
  listPartnerMoodHarvestStates(date = null) {
    const { harvests } = this.partnerMoodHarvests.read();
    const map = harvests && typeof harvests === "object" && !Array.isArray(harvests) ? harvests : {};
    const wantedDate = date == null ? "" : String(date).trim();
    const rows = [];
    for (const [key, state] of Object.entries(map)) {
      if (!state || typeof state !== "object") continue;
      const separator = key.indexOf("|");
      if (separator <= 0) continue;
      const day = key.slice(0, separator);
      const agentId = key.slice(separator + 1);
      if (!agentId || (wantedDate && day !== wantedDate)) continue;
      rows.push({ date: day, agentId, ...state });
    }
    return rows.sort((a, b) => `${a.date}|${a.agentId}`.localeCompare(`${b.date}|${b.agentId}`));
  }

  /** 保存伙伴链的日级状态。 */
  async updatePartnerMoodHarvestState(date, agentId, patch = {}) {
    const key = `${String(date || "").trim()}|${String(agentId || "").trim()}`;
    if (!/^\d{4}-\d{2}-\d{2}\|/.test(key) || !String(agentId || "").trim()) throw new Error("日期或伙伴不对");
    let value = null;
    await this.partnerMoodHarvests.update((d) => {
      if (!d.harvests || typeof d.harvests !== "object" || Array.isArray(d.harvests)) d.harvests = {};
      const current = d.harvests[key] && typeof d.harvests[key] === "object" ? d.harvests[key] : {};
      d.harvests[key] = { ...current, ...(patch && typeof patch === "object" ? patch : {}), updatedAt: new Date().toISOString() };
      value = { ...d.harvests[key] };
    });
    return value;
  }

  // ── 伙伴心情历史补档任务 ──

  /** 新建补档任务；同一时刻只允许一个活跃任务。 */
  async createPartnerMoodJob({ dates }) {
    if (!Array.isArray(dates) || !dates.length) throw new Error("至少选一天");
    const active = this.listPartnerMoodJobs().find((job) => ["queued", "running"].includes(job.status));
    if (active) throw new Error("已经有一项伙伴心情补档在运行");
    const id = `partner-mood-job-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    const now = new Date().toISOString();
    const job = { id, dates: [...dates], outcomes: [], status: "queued", currentDate: "", createdAt: now, updatedAt: now };
    await this.partnerMoodJobs.update((d) => {
      if (!d.jobs || typeof d.jobs !== "object" || Array.isArray(d.jobs)) d.jobs = {};
      d.jobs[id] = { ...job };
    });
    return { ...job };
  }

  getPartnerMoodJob(id) {
    const key = String(id || "").trim();
    if (!key) return null;
    const { jobs } = this.partnerMoodJobs.read();
    const map = jobs && typeof jobs === "object" && !Array.isArray(jobs) ? jobs : {};
    return map[key] && typeof map[key] === "object" ? { ...map[key] } : null;
  }

  /** 补档任务清单，最新在前；可选只看活跃。 */
  listPartnerMoodJobs(activeOnly = false) {
    const { jobs } = this.partnerMoodJobs.read();
    const map = jobs && typeof jobs === "object" && !Array.isArray(jobs) ? jobs : {};
    const list = Object.values(map).filter((job) => job && typeof job === "object");
    const rows = (activeOnly ? list.filter((job) => ["queued", "running"].includes(job.status)) : list)
      .sort((a, b) => String(b.createdAt || "").localeCompare(String(a.createdAt || "")));
    return rows.map((job) => ({ ...job }));
  }

  /** 更新补档任务；找不到返回 null。 */
  async updatePartnerMoodJob(id, patch = {}) {
    const key = String(id || "").trim();
    if (!key) return null;
    let value = null;
    await this.partnerMoodJobs.update((d) => {
      const map = d.jobs && typeof d.jobs === "object" && !Array.isArray(d.jobs) ? d.jobs : (d.jobs = {});
      if (!map[key]) return;
      map[key] = { ...map[key], ...(patch && typeof patch === "object" ? patch : {}), updatedAt: new Date().toISOString() };
      value = { ...map[key] };
    });
    return value;
  }

  // ── 注入配置 ──

  getSettings() {
    const settings = this.settings.read();
    return {
      ...settings,
      // 升级兼容：旧版可能还留着已移除的 2 小时档，统一回到默认 4 小时。
      injectIntervalHours: normalizeInjectIntervalHours(settings.injectIntervalHours),
      moodDiscoveryMode: normalizeMoodDiscoveryMode(settings.moodDiscoveryMode),
      partnerMoodEnabled: settings.partnerMoodEnabled === true, // 伙伴心情线：旧配置没有该键时默认关
      deepseekPeakEnabled: settings.deepseekPeakEnabled !== false, // 峰谷关照：旧配置没有该键时默认开
      xingjiEnabled: settings.xingjiEnabled === true, // 拾性观察：旧配置没有该键时默认关
      xingjiInjectionEnabled: settings.xingjiInjectionEnabled === true, // 拾性注入：默认关，绝不悄悄接回伙伴
      // 按伙伴屏蔽复用注入总开关的 injectionDisabledAgentIds，不再单开一套（旧的
      // xingjiInjectionDisabledAgentIds 从未有界面入口，已删除）。
    };
  }

  async updateSettings(patch) {
    const before = this.getSettings();
    await this.settings.update((d) => {
      Object.assign(d, patch);
      d.injectIntervalHours = normalizeInjectIntervalHours(d.injectIntervalHours);
      d.moodDiscoveryMode = normalizeMoodDiscoveryMode(d.moodDiscoveryMode);
    });
    // 天气重新开启时强制下一次查询绕过旧缓存，但保留旧结果作为网络失败时的底稿。
    if (patch?.weatherEnabled === true && before.weatherEnabled === false) {
      const cache = this.getWeatherCache();
      if (cache) await this.setWeatherCache({ ...cache, fetchedAt: 0 });
    }
    try { this.onPublicContextChange?.(); } catch { /* 共享失败不影响设置保存 */ }
    return this.getSettings();
  }

  // ── 天气缓存 ──

  /**
   * 读天气缓存。
   * @returns {{ location: string, fetchedAt: number, data: object }|null} 没有缓存返回 null
   */
  getWeatherCache() {
    return this.weatherCache.read().weather;
  }

  // ── 节日氛围引导变体状态（随机不重复用）──

  /** 某节日的已用变体索引（数组） */
  getUsedFestivalHintIndexes(name) {
    const { used } = this.festivalHintState.read();
    const arr = used[name];
    return Array.isArray(arr) ? arr : [];
  }

  /** 保存某节日的已用变体索引（写入队列串行化，防并发写坏） */
  async setUsedFestivalHintIndexes(name, indexes) {
    await this.festivalHintState.update((d) => {
      d.used = d.used || {};
      d.used[name] = Array.isArray(indexes) ? indexes : [];
    });
  }

  /**
   * 写天气缓存。
   * @param {object} weather { location, fetchedAt, data }
   */
  async setWeatherCache(weather) {
    await this.weatherCache.update((d) => {
      d.weather = weather;
    });
    try { this.onPublicContextChange?.(); } catch { /* 共享失败不影响天气缓存 */ }
  }

  // ── 天气预报缓存（天气提醒用）──

  /**
   * 读预报缓存。
   * @returns {{ location: string, fetchedAt: number, forecast: object }|null}
   */
  getWeatherForecastCache() {
    return this.weatherForecastCache.read().forecast;
  }

  /**
   * 写预报缓存。
   * @param {object} payload { location, coordinates, fetchedAt, forecast }
   */
  async setWeatherForecastCache(payload) {
    await this.weatherForecastCache.update((d) => {
      d.forecast = payload || null;
    });
  }

  // ── 天气提醒会话状态（重启保留，防同一件事反复提）──

  /** 某会话的天气提醒状态（无记录返回 null） */
  getWeatherAlertState(sessionId) {
    const { sessions } = this.weatherAlert.read();
    return sessions?.[sessionId] || null;
  }

  /** 写入某会话的天气提醒状态 */
  async setWeatherAlertState(sessionId, state) {
    const limit = UserData.DEEPSEEK_PEAK_SESSION_LIMIT;
    await this.weatherAlert.update((d) => {
      d.sessions = d.sessions || {};
      const keys = Object.keys(d.sessions);
      if (!d.sessions[sessionId] && keys.length >= limit) {
        delete d.sessions[keys[0]];
      }
      d.sessions[sessionId] = state || null;
    });
  }

  // ── 情境注入会话状态（重启保留，独立于 DeepSeek 峰谷状态）──

  // 每个会话最多保留 500 条；满了删最早写入的（对象键序即插入序，粗 LRU 够用）。
  static get INJECTION_SESSION_LIMIT() {
    return 500;
  }

  /** 某会话的完整注入状态（无记录返回 null） */
  getInjectionState(sessionId) {
    const { sessions } = this.injectionState.read();
    return sessions?.[sessionId] || null;
  }

  /** 写入某会话的完整注入状态（写入队列串行化，防并发写坏） */
  async setInjectionState(sessionId, state) {
    const limit = UserData.INJECTION_SESSION_LIMIT;
    await this.injectionState.update((d) => {
      d.sessions = d.sessions || {};
      const keys = Object.keys(d.sessions);
      if (!d.sessions[sessionId] && keys.length >= limit) {
        delete d.sessions[keys[0]];
      }
      d.sessions[sessionId] = state || null;
    });
  }

  // ── 节日问候完成台账（对外 greetings 契约的数据源）──

  /** 台账最多留多少条；7 天窗口内正常只有个位数，这个上限只是防脏数据把文件撑爆。 */
  static get FESTIVAL_GREETING_LIMIT() {
    return 200;
  }

  /**
   * 已完成的节日问候记录，按完成时刻倒序。字段不合规矩的（没有伙伴、没有节日、日期不合法）
   * 在读的时候直接丢掉，不让脏数据流到对外契约里去。
   */
  listFestivalGreetings({ limit = UserData.FESTIVAL_GREETING_LIMIT } = {}) {
    const { entries } = this.festivalGreetings.read();
    return (Array.isArray(entries) ? entries : [])
      .filter(
        (entry) =>
          entry &&
          String(entry.agentId || "").trim() &&
          /^\d{4}-\d{2}-\d{2}$/.test(String(entry.date || "")) &&
          String(entry.festival || "").trim() &&
          Number.isFinite(Number(entry.ts)),
      )
      .sort((a, b) => Number(b.ts) - Number(a.ts))
      .slice(0, Math.max(0, Number(limit) || 0) || UserData.FESTIVAL_GREETING_LIMIT);
  }

  /**
   * 记一条「某位伙伴在某天完成了某个节日的问候」。
   *
   * 三条纪律：判不出伙伴（agentId 为空）就不记，绝不写空值或 unknown 占位；
   * 同一天同一个节日只记一条，重复确认不重复入账；跨天由 date 区分，是另一条。
   * @returns {object|null} 真正入账的那条；没入账返回 null
   */
  async recordFestivalGreeting({ agentId, date, festival, completedAt = new Date() } = {}) {
    const cleanAgentId = String(agentId || "").trim().slice(0, 64);
    const cleanFestival = String(festival || "").trim().slice(0, 40);
    const cleanDate = String(date || "").trim();
    if (!cleanAgentId || !cleanFestival || !/^\d{4}-\d{2}-\d{2}$/.test(cleanDate)) return null;
    const when = completedAt instanceof Date ? completedAt : new Date(completedAt);
    const entry = {
      agentId: cleanAgentId,
      date: cleanDate,
      festival: cleanFestival,
      ts: Number.isFinite(when.getTime()) ? when.getTime() : Date.now(),
    };
    // 窗口以这一条的日期为基准（正常就是今天）：旧记录顺手清掉，台账不留越窗的东西。
    const windowStart = festivalGreetingWindowStart(entry.date);
    await this.festivalGreetings.update((d) => {
      const list = (Array.isArray(d.entries) ? d.entries : []).filter(
        (row) =>
          row &&
          String(row.agentId || "").trim() &&
          /^\d{4}-\d{2}-\d{2}$/.test(String(row.date || "")) &&
          row.date >= windowStart &&
          String(row.festival || "").trim() &&
          Number.isFinite(Number(row.ts)),
      );
      const already = list.some(
        (row) => row.agentId === entry.agentId && row.date === entry.date && row.festival === entry.festival,
      );
      if (already) return;
      list.push(entry);
      list.sort((a, b) => Number(b.ts) - Number(a.ts));
      d.entries = list.slice(0, UserData.FESTIVAL_GREETING_LIMIT);
    });
    return entry;
  }

  // ── DeepSeek 峰谷关照会话状态（重启保留，防重复播报）──

  // 每个会话最多保留 100 条；满了删最早写入的（对象键序即插入序，粗 LRU 够用）。
  static get DEEPSEEK_PEAK_SESSION_LIMIT() {
    return 100;
  }

  /** 某会话的峰谷判定状态（无记录返回 null） */
  getDeepSeekPeakState(sessionId) {
    const { sessions } = this.deepseekPeak.read();
    return sessions?.[sessionId] || null;
  }

  /** 写入某会话的峰谷判定状态（写入队列串行化，防并发写坏） */
  async setDeepSeekPeakState(sessionId, dsState) {
    const limit = UserData.DEEPSEEK_PEAK_SESSION_LIMIT;
    await this.deepseekPeak.update((d) => {
      d.sessions = d.sessions || {};
      const keys = Object.keys(d.sessions);
      if (!d.sessions[sessionId] && keys.length >= limit) {
        delete d.sessions[keys[0]];
      }
      d.sessions[sessionId] = dsState || null;
    });
  }

  // ── 拾性（性格补全）──
  // 三层结构：观察（当天抽出来的碎片）→ 条目（周归纳后的「情境+做法」）→ 证据（正例/反例原文）。
  // 只有证据够门槛的条目才在界面上显示；不够的留在后台继续攒。

  static get XINGJI_PENDING_LIMIT() {
    return 400;
  }

  static get XINGJI_LOG_LIMIT() {
    return 500;
  }

  /** 某伙伴的拾性档案；没有档案时返回空壳。 */
  getXingjiProfile(agentId) {
    const id = String(agentId || "").trim();
    const empty = { agentId: id, entries: [], pending: [], lastRollupAt: "", baselineAt: "" };
    if (!id) return empty;
    const { agents } = this.xingji.read();
    const map = agents && typeof agents === "object" && !Array.isArray(agents) ? agents : {};
    const profile = map[id] && typeof map[id] === "object" ? map[id] : {};
    return {
      agentId: id,
      // 旧档案没有 kind 字段（2026-10-19 之前建的条目全是「一贯做法」），
      // 读取时统一补成 pattern，不做数据迁移改写。
      entries: Array.isArray(profile.entries) ? profile.entries.map((e) => ({ ...e, kind: normalizeEntryKind(e?.kind) })) : [],
      pending: Array.isArray(profile.pending) ? profile.pending.map((o) => ({ ...o })) : [],
      lastRollupAt: String(profile.lastRollupAt || ""),
      baselineAt: String(profile.baselineAt || ""),
    };
  }

  /** 已建档伙伴 id（有观察或有条目都算）。 */
  listXingjiAgentIds() {
    const { agents } = this.xingji.read();
    const map = agents && typeof agents === "object" && !Array.isArray(agents) ? agents : {};
    return Object.keys(map).filter((id) => {
      const profile = map[id];
      if (!profile || typeof profile !== "object") return false;
      return (Array.isArray(profile.entries) && profile.entries.length > 0)
        || (Array.isArray(profile.pending) && profile.pending.length > 0);
    });
  }

  /** 追加日采观察；同 id 不重复写。超过上限时丢最旧的。 */
  async addXingjiObservations(agentId, observations = []) {
    const id = String(agentId || "").trim();
    const incoming = (Array.isArray(observations) ? observations : []).filter((o) => o && typeof o === "object" && o.id);
    if (!id || !incoming.length) return this.getXingjiProfile(id);
    const limit = UserData.XINGJI_PENDING_LIMIT;
    await this.xingji.update((d) => {
      if (!d.agents || typeof d.agents !== "object" || Array.isArray(d.agents)) d.agents = {};
      const profile = d.agents[id] && typeof d.agents[id] === "object" ? d.agents[id] : (d.agents[id] = {});
      const list = Array.isArray(profile.pending) ? profile.pending.slice() : [];
      const seen = new Set(list.map((o) => String(o.id || "")));
      for (const item of incoming) {
        const key = String(item.id || "");
        if (!key || seen.has(key)) continue;
        seen.add(key);
        list.push({ ...item });
      }
      list.sort((a, b) => String(a.day || "").localeCompare(String(b.day || "")));
      profile.pending = list.slice(-limit);
      profile.updatedAt = new Date().toISOString();
    });
    return this.getXingjiProfile(id);
  }

  /** 写入周归纳结果，并清掉已消费的观察。 */
  async saveXingjiRollup(agentId, { entries = [], consumedIds = [], rolledAt = "" } = {}) {
    const id = String(agentId || "").trim();
    if (!id) throw new Error("伙伴不对");
    const consumed = new Set((Array.isArray(consumedIds) ? consumedIds : []).map((v) => String(v || "")).filter(Boolean));
    let saved = [];
    await this.xingji.update((d) => {
      if (!d.agents || typeof d.agents !== "object" || Array.isArray(d.agents)) d.agents = {};
      const profile = d.agents[id] && typeof d.agents[id] === "object" ? d.agents[id] : (d.agents[id] = {});
      profile.entries = (Array.isArray(entries) ? entries : []).filter((e) => e && e.id).map((e) => ({ ...e }));
      profile.pending = (Array.isArray(profile.pending) ? profile.pending : []).filter((o) => !consumed.has(String(o.id || "")));
      profile.lastRollupAt = String(rolledAt || new Date().toISOString());
      profile.updatedAt = profile.lastRollupAt;
      saved = profile.entries.map((e) => ({ ...e }));
    });
    return saved;
  }

  /**
   * 清空拾性自己的账：条目、待归纳观察、日采完成标记、事件卡、补档任务、日志。
   * 只动 xingji.dat 里的字段；settings、心情线、做册一概不碰。
   * 用在「筛选规则换了、旧档案作废」的场合。调用方必须先自行确认。
   */
  async resetXingji() {
    let stats = { entries: 0, pending: 0, scanDays: 0, harvests: 0 };
    await this.xingji.update((d) => {
      const agents = d.agents && typeof d.agents === "object" && !Array.isArray(d.agents) ? d.agents : {};
      for (const id of Object.keys(agents)) {
        const profile = agents[id];
        if (!profile || typeof profile !== "object") continue;
        stats.entries += Array.isArray(profile.entries) ? profile.entries.length : 0;
        stats.pending += Array.isArray(profile.pending) ? profile.pending.length : 0;
      }
      stats.scanDays = Object.keys(d.scan?.days && typeof d.scan.days === "object" ? d.scan.days : {}).length;
      stats.harvests = Object.keys(d.harvests && typeof d.harvests === "object" ? d.harvests : {}).length;
      d.agents = {};
      d.harvests = {};
      d.scan = null;
      d.job = null;
      d.logs = [];
    });
    return stats;
  }

  /** 用户对某条目的纠正：拉黑或改描述。 */
  async updateXingjiEntry(agentId, entryId, patch = {}) {
    const id = String(agentId || "").trim();
    const key = String(entryId || "").trim();
    if (!id || !key) return null;
    let updated = null;
    await this.xingji.update((d) => {
      const profile = d.agents?.[id];
      if (!profile || !Array.isArray(profile.entries)) return;
      const entry = profile.entries.find((e) => String(e.id || "") === key);
      if (!entry) return;
      Object.assign(entry, patch && typeof patch === "object" ? patch : {});
      entry.updatedAt = new Date().toISOString();
      updated = { ...entry };
    });
    return updated;
  }

  /** 日采幂等状态：重启或重跑做册不会重复调模型。 */
  getXingjiHarvestState(day, agentId) {
    const key = `${String(day || "").trim()}|${String(agentId || "").trim()}`;
    if (!/^\d{4}-\d{2}-\d{2}\|/.test(key) || key.endsWith("|")) return null;
    const { harvests } = this.xingji.read();
    const map = harvests && typeof harvests === "object" && !Array.isArray(harvests) ? harvests : {};
    return map[key] && typeof map[key] === "object" ? { ...map[key] } : null;
  }

  /** 写日采状态。 */
  async updateXingjiHarvestState(day, agentId, patch = {}) {
    const key = `${String(day || "").trim()}|${String(agentId || "").trim()}`;
    if (!/^\d{4}-\d{2}-\d{2}\|/.test(key) || key.endsWith("|")) throw new Error("日期或伙伴不对");
    let value = null;
    await this.xingji.update((d) => {
      if (!d.harvests || typeof d.harvests !== "object" || Array.isArray(d.harvests)) d.harvests = {};
      const current = d.harvests[key] && typeof d.harvests[key] === "object" ? d.harvests[key] : {};
      d.harvests[key] = { ...current, ...(patch && typeof patch === "object" ? patch : {}), updatedAt: new Date().toISOString() };
      value = { ...d.harvests[key] };
    });
    return value;
  }

  /** 记一条拾性日志（触发/纠错），最多留 XINGJI_LOG_LIMIT 条。 */
  async appendXingjiLog(item = {}) {
    const limit = UserData.XINGJI_LOG_LIMIT;
    await this.xingji.update((d) => {
      const list = Array.isArray(d.logs) ? d.logs.slice() : [];
      list.push({ at: new Date().toISOString(), ...(item && typeof item === "object" ? item : {}) });
      d.logs = list.slice(-limit);
    });
  }

  /** 读日志，最新在前；可按伙伴筛。 */
  listXingjiLogs(agentId = "", limit = 50) {
    const { logs } = this.xingji.read();
    const list = Array.isArray(logs) ? logs : [];
    const wanted = String(agentId || "").trim();
    const rows = (wanted ? list.filter((item) => String(item?.agentId || "") === wanted) : list.slice())
      .sort((a, b) => String(b.at || "").localeCompare(String(a.at || "")));
    return rows.slice(0, Math.max(1, Number(limit) || 50));
  }

  /** 历史补档任务：同时只允许一个，存单个 job 就够。 */
  getXingjiJob() {
    const { job } = this.xingji.read();
    return job && typeof job === "object" ? { ...job } : null;
  }

  /** 新建补档任务；已有活跃任务时报错。停滞超过 10 分钟视为旧任务已死，允许重开。 */
  async createXingjiJob({ dates = [], skipScan = false } = {}) {
    const list = (Array.isArray(dates) ? dates : []).filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(String(d || "")));
    if (!list.length) throw new Error("至少选一天");
    const active = this.getXingjiJob();
    if (active && ["queued", "running", "scanning"].includes(active.status)) {
      const stamp = Date.parse(active.updatedAt || active.createdAt || "");
      const age = Number.isFinite(stamp) ? Date.now() - stamp : Number.POSITIVE_INFINITY;
      // App 重载或 Hana 重启会把内存里的任务杀掉，但状态会留在盘上；
      // 不停滞就直接拒，免得两个任务同时跑同一批料。
      if (age < 10 * 60 * 1000) throw new Error("已经有一项拾性补档在跑");
    }
    const now = new Date().toISOString();
    const job = {
      id: `xingji-job-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      dates: list,
      done: [],
      failed: [],
      status: "queued",
      currentDate: "",
      skipScan: skipScan === true,
      createdAt: now,
      updatedAt: now,
    };
    await this.xingji.update((d) => {
      d.job = { ...job };
    });
    return { ...job };
  }

  /** 更新补档任务；没有任务时返回 null。 */
  async updateXingjiJob(patch = {}) {
    let value = null;
    await this.xingji.update((d) => {
      if (!d.job || typeof d.job !== "object") return;
      d.job = { ...d.job, ...(patch && typeof patch === "object" ? patch : {}), updatedAt: new Date().toISOString() };
      value = { ...d.job };
    });
    return value;
  }

  // ── 全量扫描结果（按天分桶的事件卡，不存原始对话）──

  /** 读某天的事件卡桶：{ [agentId]: [事件卡] }；没有就返回 {}。 */
  getXingjiScanDay(day) {
    const key = String(day || "").trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(key)) return {};
    const { scan } = this.xingji.read();
    const days = scan && typeof scan === "object" && scan.days && typeof scan.days === "object" ? scan.days : {};
    const bucket = days[key];
    if (!bucket || typeof bucket !== "object") return {};
    const out = {};
    for (const agentId of Object.keys(bucket)) {
      const list = Array.isArray(bucket[agentId]) ? bucket[agentId] : [];
      if (list.length) out[agentId] = list.map((item) => ({ ...item }));
    }
    return out;
  }

  /** 一次写入整份扫描结果；单次扫描的产物，旧结果直接覆盖。 */
  async saveXingjiScan({ days = {}, scannedAt = "", sessionCount = 0, eventCount = 0 } = {}) {
    const clean = {};
    for (const [day, byAgent] of Object.entries(days && typeof days === "object" ? days : {})) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || !byAgent || typeof byAgent !== "object") continue;
      const one = {};
      for (const [agentId, list] of Object.entries(byAgent)) {
        if (!Array.isArray(list) || !list.length) continue;
        one[agentId] = list.filter((item) => item && typeof item === "object");
      }
      if (Object.keys(one).length) clean[day] = one;
    }
    await this.xingji.update((d) => {
      d.scan = {
        version: 1,
        scannedAt: String(scannedAt || new Date().toISOString()),
        sessionCount: Number(sessionCount) || 0,
        eventCount: Number(eventCount) || 0,
        days: clean,
      };
    });
    return { dayCount: Object.keys(clean).length };
  }

  /** 扫描结果概览（不返回内容，只报范围）。 */
  getXingjiScanSummary() {
    const { scan } = this.xingji.read();
    if (!scan || typeof scan !== "object") return null;
    const days = Object.keys(scan.days && typeof scan.days === "object" ? scan.days : {}).sort();
    return {
      scannedAt: String(scan.scannedAt || ""),
      sessionCount: Number(scan.sessionCount) || 0,
      eventCount: Number(scan.eventCount) || 0,
      dayCount: days.length,
      firstDay: days[0] || "",
      lastDay: days[days.length - 1] || "",
    };
  }
}
