// 拾光记 · 情境注入扩展（before_agent_start）
// 每个模型请求前触发；按注入模式决定是否注入「今日时光」隐藏消息。
// display:false，用户不可见，不进历史，回合结束即消失。注入失败不影响对话。

import crypto from "node:crypto";
import os from "node:os";
import path from "node:path";
import { filterDueTodos } from "../lib/data.js";
import { configureSharedUserData, getSharedUserData } from "../lib/shared-data.js";
import {
  InjectionTracker,
  shouldInject,
  buildInjectionText,
  buildDeepSeekContext,
  buildWeatherAlertContext,
  decideWeatherMention,
  weatherFactKey,
} from "../lib/inject.js";
import { selectRecentSummaries } from "../lib/recent-summaries.js";
import { getBuiltinFestivals, isWorkday } from "../lib/festivals.js";
import { getFestivalHintPool, pickFestivalHint, didMentionFestival } from "../lib/festival-hints.js";
import { finishedLifeDayKey, lifeDayKey, resolveSummaryAgentId } from "../lib/day-summary.js";
import { readHanaUserName, resolveHanaUserName } from "../lib/user-name.js";
import { pickInjectableEntries } from "../lib/xingji.js";
import {
  ensureWeatherFresh,
  ensureWeatherForecastFresh,
  getConfiguredWeatherFetcher,
  getWeatherForInject,
  normalizeWeatherResult,
  resolveWeatherLocation,
  weatherCacheIsFresh,
  weatherCacheMatches,
  weatherForecastCacheIsFresh,
  weatherForecastCacheMatches,
} from "../lib/weather.js";
import {
  collectWeatherEvents,
  decideWeatherAlert,
  didMentionWeatherEvent,
  markWeatherEventReported,
} from "../lib/weather-alert.js";
import { configureDebugLog, logInfo, logWarn } from "../lib/debug-log.js";
import { decideDeepSeekNotice } from "../lib/deepseek-peak.js";
import {
  resolveCodeInjection,
} from "../lib/code-mode.js";
import { isCodeSession } from "../lib/session-kind.js";
import { readLatestModelChange, findSessionFile, getPrimedModel } from "../lib/session-model.js";
import { schedulePublicToday } from "../lib/public-today.js";
import { schedulePublicGreetings } from "../lib/public-greetings.js";

const tracker = new InjectionTracker();
// 峰谷单独注入时，注入状态里不夹带峰谷字段（两套 schema 不互相冒充），
// 所以峰谷的「本窗口已报过」得自己存一份内存态，否则关掉情境后会每轮重报。
const peakTracker = new Map();
let weatherTimer = null; // 天气惰性刷新定时器
let weatherPrefetchAt = 0; // 上一轮「顺手补一次」的发起时间（防止网络不通时每轮都去撞）
const WEATHER_PREFETCH_THROTTLE_MS = 60 * 1000;

// 缓存过期时的即时补查：静默、失败不重试轰炸，60 秒内最多发起一次。
function scheduleWeatherPrefetch(data, settings) {
  const nowTs = Date.now();
  if (nowTs - weatherPrefetchAt < WEATHER_PREFETCH_THROTTLE_MS) return;
  weatherPrefetchAt = nowTs;
  void ensureWeatherFresh({ data, settings, onError: () => {} }).catch(() => {});
}

// 预报缓存过期时的后台补查：预报刷新比当前天气频（默认 1 小时），
// 但也不每轮都去撞，5 分钟内最多发起一次。
let weatherForecastPrefetchAt = 0;
const WEATHER_FORECAST_PREFETCH_THROTTLE_MS = 5 * 60 * 1000;

function scheduleWeatherForecastPrefetch(data, settings) {
  const nowTs = Date.now();
  if (nowTs - weatherForecastPrefetchAt < WEATHER_FORECAST_PREFETCH_THROTTLE_MS) return;
  weatherForecastPrefetchAt = nowTs;
  void ensureWeatherForecastFresh({ data, settings, onError: () => {} }).catch(() => {});
}
let nowProvider = () => new Date(); // 可覆写的时钟（测试用），生产保持真实当前时间

// 对外快照（public-today.json）的刷新刻度：只在数据版本或生活日变过之后才排一次。
// 内容没变时写盘会被 writePublicToday 自己跳过，所以这里不必精细判重。
const snapshotMark = { rev: null, day: "" };

function refreshPublicTodayNow({ dataDir, data, settings, now = new Date() } = {}) {
  const dir = dataDir || data?.dataDir || null;
  if (!dir || !data || !settings) return;
  try {
    schedulePublicToday({ dataDir: dir, data, settings, now });
  } catch {
    // 对外快照刷新失败不影响主流程
  }
}

function maybeRefreshPublicToday({ dataDir, data, settings, now, dataRev }) {
  if (!dataDir || !data || !settings) return;
  let day = "";
  try {
    day = lifeDayKey(now, settings.dayBoundaryHour);
  } catch {
    day = "";
  }
  if (snapshotMark.rev === dataRev && snapshotMark.day === day) return;
  snapshotMark.rev = dataRev;
  snapshotMark.day = day;
  refreshPublicTodayNow({ dataDir, data, settings, now });
}

export function __setInjectNowForTest(provider) {
  nowProvider = provider || (() => new Date());
}

// 模拟进程重启：清空内存 tracker，但盘上注入状态和 deepseekPeak 状态保留，供重启恢复类测试使用。
export function __clearInjectTrackersForTest() {
  tracker.sessions.clear();
  peakTracker.clear();
}

export function __resetLazySummaryForTest() {
  // 兼容旧测试入口；总结已统一由路由层可靠定时器负责。
}

function contextDataDir(context) {
  return context?.dataDir || context?.pluginContext?.dataDir || context?.ctx?.dataDir || null;
}

// 宿主门面有时不给扩展工厂传 dataDir；这时回退到共享数据实例自己的目录。
// 少了这一步，依赖 dataDir 的对外快照会静默不写（聊天类 App 那侧于是永远读不到）。
function resolveExtensionDataDir(pi) {
  const fromContext = contextDataDir(pi);
  if (fromContext) return fromContext;
  try {
    return getSharedUserData()?.dataDir || null;
  } catch {
    return null;
  }
}

// 情境状态异步落盘（fire-and-forget，失败静默不影响对话）。
function persistInjectionState(data, sessionId, state) {
  if (!data || !sessionId || !state) return;
  data.setInjectionState(sessionId, state).catch(() => {});
}

function getAssistantVisibleText(message) {
  const content = message?.content;
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content.filter((part) => part?.type === "text").map((part) => part.text || "").join("\n");
}

function getActiveBranchAssistantTexts(context, afterTimestamp) {
  const cutoff = Number(afterTimestamp);
  if (!Number.isFinite(cutoff)) return [];
  const manager = context?.sessionManager;
  const entries = manager?.getEntries?.();
  let entryId = manager?.getLeafId?.();
  if (!Array.isArray(entries) || typeof entryId !== "string") return [];
  const byId = new Map(entries.map((entry) => [entry?.id, entry]));
  const texts = [];
  let remaining = entries.length;
  while (entryId && remaining-- > 0) {
    const entry = byId.get(entryId);
    if (!entry) break;
    if (entry.type === "message" && entry.message?.role === "assistant") {
      const timestamp = typeof entry.timestamp === "number" ? entry.timestamp : Date.parse(entry.timestamp);
      if (Number.isFinite(timestamp) && timestamp > cutoff) {
        texts.push(getAssistantVisibleText(entry.message));
      }
    }
    entryId = typeof entry.parentId === "string" ? entry.parentId : null;
  }
  return texts;
}

// 问候确认完成后入对外台账：判不出是谁就不入账（绝不写空值或 unknown 占位），
// 入账后排一次去抖发布。扩展侧没有 publicData 通道（那是 App 入口才有的），
// 排不进去就交给 App 自己的定时刷新按内容指纹补发，两边都不会把主流程带崩。
function recordFestivalGreetingCompletion({ data, event, ctx, festival, date, now } = {}) {
  try {
    const agentId = resolveAgentId(event, ctx);
    if (!data || !agentId || !festival || !date) return;
    void data
      .recordFestivalGreeting({ agentId, date, festival, completedAt: now || new Date() })
      .then(() => schedulePublicGreetings({ data, now: new Date() }))
      .catch(() => {});
  } catch {
    // 台账写不进去不影响会话
  }
}

function observeFestivalGreeting(pi) {
  pi.on("message_end", (event, ctx) => {
    try {
      const message = event?.message;
      // A generation can end on toolUse/aborted as well as final text; only normal or length-limited visible answers count.
      if (message?.role !== "assistant" || !["stop", "length"].includes(message.stopReason)) return;
      const sessionId = ctx?.sessionManager?.getSessionId?.() || null;
      if (!sessionId) return;
      const data = getData(ctx);
      // 天气提醒的确认与节日问候分开记账，但共用这一条 message_end 钩子。
      confirmWeatherAlertMention(data, sessionId, message);
      const state = tracker.get(sessionId) || data.getInjectionState(sessionId);
      const name = state?.festivalGreetingName;
      const date = state?.festivalGreetingPromptedDate;
      if (!name || !date || state.festivalGreetingCompleteDate === date) return;
      if (!didMentionFestival(getAssistantVisibleText(message), name)) return;
      const completed = { ...state, festivalGreetingCompleteDate: date };
      tracker.set(sessionId, completed);
      persistInjectionState(data, sessionId, completed);
      recordFestivalGreetingCompletion({ data, event, ctx, festival: name, date, now: nowProvider() });
    } catch {
      // 观察回复失败不影响会话；未确认时保持待提醒，下一轮再自然提示。
    }
  });
}

// 峰谷判定状态异步落盘（fire-and-forget，复用 EncryptedStore 串行写队列，失败静默不影响对话）。
function persistDeepSeekState(data, sessionId, dsState) {
  if (!data || !sessionId || !dsState) return;
  data.setDeepSeekPeakState(sessionId, dsState).catch(() => {});
}

// 峰谷「本窗口已报过」只有两份真身：内存 peakTracker → 盘上 deepseekPeak。
// 旧版本顺带把 ds 字段写进了情境注入状态，那份只在两处都空时当迁移来源读一次，
// 绝不能反过来用陈旧的情境状态盖挠新的峰谷状态（那是「关情境→预告→开情境重复预告」的根源）。
function peakStateFromInjectionState(state) {
  if (!state || state.dsActive === undefined) return null;
  return {
    dsActive: state.dsActive === true,
    dsModelKey: String(state.dsModelKey || ""),
    dsPeriod: state.dsPeriod || null,
    dsPreviewKey: String(state.dsPreviewKey || ""),
    dsPreviewKeys: Array.isArray(state.dsPreviewKeys) ? [...state.dsPreviewKeys] : [],
    dsLastSeenAt: Number(state.dsLastSeenAt) || 0,
  };
}

function resolvePeakLastState(sessionId, diskPeakState, injectionState) {
  return peakTracker.get(sessionId) || diskPeakState || peakStateFromInjectionState(injectionState);
}

// 每次峰谷判定后都回写两处：内存档防重启丢，盘上档防进程内清空。
function commitPeakState(data, sessionId, dsState) {
  if (!dsState) return;
  peakTracker.set(sessionId, dsState);
  persistDeepSeekState(data, sessionId, dsState);
}

// 天气提醒的会话状态落盘：同样 fire-and-forget，与峰谷/情境各自一份 schema。
function persistWeatherAlertState(data, sessionId, alertState) {
  if (!data || !sessionId || !alertState) return;
  data.setWeatherAlertState(sessionId, alertState).catch(() => {});
}

// 观察伙伴这一轮到底有没有把天气提醒说出口：说过了就记成已提，不再追着念。
// 与节日问候共用同一个 message_end 钩子：这里只做确认，不注册新钩子。
function confirmWeatherAlertMention(data, sessionId, message) {
  try {
    if (!data || !sessionId) return;
    const state = data.getWeatherAlertState?.(sessionId);
    const pending = state?.waPending;
    if (!pending || !pending.key) return;
    const text = getAssistantVisibleText(message);
    if (!didMentionWeatherEvent(text, { keywords: pending.keywords || [] })) return;
    persistWeatherAlertState(data, sessionId, markWeatherEventReported(state, { key: pending.key }));
  } catch {
    // 观察失败不影响会话；没确认提及时保留待补报，下一轮再试。
  }
}

function getData(context = null) {
  const dataDir = contextDataDir(context);
  if (dataDir) {
    configureSharedUserData(dataDir);
    configureDebugLog(dataDir);
  }
  return getSharedUserData();
}

export default function registerShiguangjiInject(pi) {
  const dataDir = resolveExtensionDataDir(pi);
  if (dataDir) {
    configureSharedUserData(dataDir);
    configureDebugLog(dataDir);
  }
  // 天气惰性刷新：每 15 分钟检查一次缓存是否过期，过期就后台查（不阻塞注入）
  startWeatherRefresher(dataDir);
  // 对外快照：启动先摆一份，之后由数据变动 / 跨天 / 天气刷新去抖刷新
  try {
    const bootData = getData();
    refreshPublicTodayNow({ dataDir, data: bootData, settings: bootData.getSettings() });
  } catch {
    // 启动写快照失败不影响插件加载
  }

  observeFestivalGreeting(pi);

  pi.on("before_agent_start", (event, ctx) => {
    try {
      const sessionId = ctx?.sessionManager?.getSessionId?.() || null;
      if (!sessionId) return undefined;

      const data = getData(ctx);
      const settings = data.getSettings();
      const now = nowProvider();
      const currentAgentId = resolveAgentId(event, ctx);
      const disabledAgentIds = new Set(Array.isArray(settings.injectionDisabledAgentIds)
        ? settings.injectionDisabledAgentIds.map((id) => String(id))
        : []);
      const partnerInjectionDisabled = !!currentAgentId && disabledAgentIds.has(currentAgentId);
      const injectionEnabled = settings.injectionEnabled !== false && !partnerInjectionDisabled;
      const currentModel = resolveCurrentModel(event, ctx, sessionId, currentAgentId);
      const dataRev = data.getDataRev();
      // Code 页是干活的地方：那边走另一套精简注入，别把日记、生理期和做好的回顾
      // 塞进改代码的那一轮。分区查不清时适配层已经跳过本轮（见 lib/session-kind.js），
      // 走到这里的分区只有 home / app / code 三种，这里只需分「是不是 Code」。
      const inCode = isCodeSession(ctx?.sessionNamespace);
      // 对外快照独立于「情境注入」开关：那个开关只管往 Hana 会话里注入，
      // 这份快照是给别的消费方读的，关掉注入也照常维护。
      maybeRefreshPublicToday({
        dataDir: dataDir || contextDataDir(ctx),
        data,
        settings,
        now,
        dataRev,
      });
      if (inCode) {
        // Code 页不听聊天那张屏蔽名单（partnerInjectionDisabled），只看它自己那套配置。
        return decideCodeModeInjection({
          data,
          settings,
          now,
          sessionId,
          currentAgentId,
          currentModel,
          diskPeakState: data.getDeepSeekPeakState(sessionId),
        });
      }
      // 拾性档案接回对话：独立开关，且跟随情境注入总开关与按伙伴屏蔽。
      // 全部默认关——观察归观察，注入归注入，后者必须由人显式打开。
      // （真正挑条目放到「确实要注入」之后，情境没到期就不白读一份档案。）
      const xingjiInjectionEnabled = settings.xingjiInjectionEnabled === true && injectionEnabled === true && !!currentAgentId;
      const contextKey = buildInjectionContextKey(settings);
      const trackedState = tracker.get(sessionId);
      const storedInjectionState = trackedState || data.getInjectionState(sessionId);
      const diskDs = data.getDeepSeekPeakState(sessionId);
      // 峰谷只看自己那两处状态；旧版写在情境状态里的 ds 字段只当迁移来源。
      const peakLastState = resolvePeakLastState(sessionId, diskDs, storedInjectionState);
      const legacyRecovery = !storedInjectionState && !!diskDs;
      // 普通注入状态与 DeepSeek 峰谷状态是两套 schema，不能互相冒充。
      // 没有完整注入状态的旧版本，只用当前时刻建立一次保守冷却，避免升级/重启首轮重复刷屏。
      let lastState = storedInjectionState;
      if (!lastState && legacyRecovery) {
        lastState = {
          lastInjectAt: now.getTime(),
          lastDateKey: lifeDayKey(now, settings.dayBoundaryHour),
          lastHash: "",
          contextKey,
          lastDataRev: dataRev,
          injectionEnabled: true,
        };
      }
      if (lastState && lastState.contextKey !== contextKey) {
        logContextKeyChange(sessionId, lastState.contextKey, contextKey);
      }

      const peakEnabled = settings.deepseekPeakEnabled !== false;

      // 全局关闭或当前伙伴单独关闭时，只阻断对话注入，不影响日历与时光册；
      // 峰谷关照有自己的开关，不跟着这个开关一起被关。
      if (!injectionEnabled) {
        const disabledDecision = shouldInject({
          sessionId,
          now,
          mode: settings.injectMode,
          intervalHours: settings.injectIntervalHours,
          lastState,
          hasSpecialDay: false,
          dayBoundaryHour: settings.dayBoundaryHour,
          contextKey,
          injectionEnabled: false,
        });
        const disabledState = {
          ...disabledDecision.newState,
          contextKey,
          lastDataRev: dataRev,
          injectionEnabled: false,
        };
        tracker.set(sessionId, disabledState);
        if (!trackedState || trackedState.injectionEnabled !== false) {
          persistInjectionState(data, sessionId, disabledState);
        }
        if (!peakEnabled) return undefined;
        const peakOnly = decideDeepSeekNotice({
          model: currentModel,
          now,
          lastState: peakLastState,
        });
        commitPeakState(data, sessionId, peakOnly.state);
        if (!peakOnly.should) return undefined;
        return {
          message: {
            customType: "shiguangji-deepseek-peak",
            content: buildDeepSeekContext(peakOnly.notice, readHanaUserName() || "对方"),
            display: false,
            details: {
              injector: "shiguangji",
              reason: `deepseek-${peakOnly.reason}`,
              deepseekNotice: true,
              summaryCount: 0,
            },
          },
        };
      }

      const deepseekDecision = peakEnabled
        ? decideDeepSeekNotice({
          model: currentModel,
          now,
          lastState: peakLastState,
        })
        : { should: false, reason: "peak-disabled", notice: null, state: null };
      // 判一次就回写一次：内存档和盘上档一起走，别让某一处独自陈旧下去。
      commitPeakState(data, sessionId, deepseekDecision.state);

      // 天气提醒：独立一路判定，跟「窗外天气」播报分开。
      // 只有真值得留意的才开口（恶劣天气、大风、明显降温/升温），说过的不再重复。
      const weatherAlertEnabled = settings.weatherAlertEnabled !== false && settings.weatherEnabled !== false;
      let weatherAlertDecision = { should: false, reason: "alert-disabled", notice: null, state: null };
      if (weatherAlertEnabled) {
        const alertState = data.getWeatherAlertState?.(sessionId) || null;
        const forecastCache = data.getWeatherForecastCache?.() || null;
        const forecastFresh = weatherForecastCacheMatches(forecastCache, settings) &&
          weatherForecastCacheIsFresh(forecastCache, settings, now);
        if (!forecastFresh) {
          // 预报过期/没有：后台补一次，本轮不拿旧数据硬判（免得拿早上那版预报说晚上有雨）。
          scheduleWeatherForecastPrefetch(data, settings);
        } else {
          const currentWeather = readFreshWeather(data, settings, now);
          const events = collectWeatherEvents({
            forecast: forecastCache.forecast,
            now,
            currentTemp: currentWeather ? currentWeather.temp : null,
            settings,
          });
          weatherAlertDecision = decideWeatherAlert({ events, lastState: alertState, now });
          persistWeatherAlertState(data, sessionId, weatherAlertDecision.state);
        }
      }

      // 收集当天情境。预计中的生理期不作为确定事实注入。
      const builtin = getBuiltinFestivals(now);
      const todayKey = dateKeyOf(now);
      let festivalGreetingCompleteToday = lastState?.festivalGreetingCompleteDate === todayKey;
      // v0.2.135 只记“提示已注入”，升级时回看当前会话的活动分支；仅真实助手正文提过节日才迁移为完成。
      const legacyPromptDate = lastState?.festivalGreetingDate;
      const legacyFestivalName = builtin.find((f) => !!getFestivalHintPool(f.name))?.name;
      if (!festivalGreetingCompleteToday && legacyPromptDate === todayKey && legacyFestivalName) {
        festivalGreetingCompleteToday = getActiveBranchAssistantTexts(ctx, lastState?.lastInjectAt)
          .some((text) => didMentionFestival(text, legacyFestivalName));
        if (festivalGreetingCompleteToday) {
          lastState = { ...lastState, festivalGreetingCompleteDate: todayKey };
          tracker.set(sessionId, lastState);
          persistInjectionState(data, sessionId, lastState);
        }
      }
      const hasPendingFestivalGreeting = builtin.some((f) => !!getFestivalHintPool(f.name)) && !festivalGreetingCompleteToday;
      // 只有从已完成回复中确认问候说出口后才从后续情境中收起节日信息。
      const builtinForInjection = festivalGreetingCompleteToday
        ? builtin.filter((f) => !getFestivalHintPool(f.name))
        : builtin;
      const userEvents = data.eventsOnDate(now).filter((e) => e.type !== "period");
      const periods = settings.showPeriod !== false
        ? data.periodsWithDayOn(now).filter((p) => !p.predicted).map((p) => p.event)
        : [];
      // 生理期结束后的第一天：今天不在周期内，但昨天在（且已确认结束）→ 注入好闺蜜式的高兴
      let periodEndedYesterday = false;
      if (settings.showPeriod !== false && periods.length === 0) {
        const prev = new Date(now);
        prev.setDate(prev.getDate() - 1);
        const prevPeriods = data.periodsWithDayOn(prev).filter((p) => !p.predicted);
        if (prevPeriods.length) {
          const yesterdayConfirmed = prevPeriods.some((p) => {
            const ct = p.event.confirmedThrough;
            return !ct || ct <= dateKeyOf(prev);
          });
          periodEndedYesterday = yesterdayConfirmed;
        }
      }
      const workday = isWorkday(now);
      // 待办：周期规则按实际日期展开成实例；先统一日期口径，避免旧 MM-DD 被字符串比较误判。
      const todos = filterDueTodos(data.listEvents(), now);

      const hasSpecialDay =
        builtin.length > 0 ||
        userEvents.length > 0 ||
        periods.length > 0 ||
        workday ||
        todos.length > 0;

      // 判定是否注入
      let decision = shouldInject({
        sessionId,
        now,
        mode: settings.injectMode,
        intervalHours: settings.injectIntervalHours,
        lastState,
        hasSpecialDay,
        hasPendingFestivalGreeting,
        dayBoundaryHour: settings.dayBoundaryHour,
        contextKey,
        injectionEnabled: true,
      });
      // 数据版本号变化（用户新增/改日子、确认生理期、生成/修改总结）→ 打破间隔，立即刷新一次。
      // 这样刚做的动作，下一条消息就能看到新情境，不用等间隔到期。
      if (!decision.should && lastState && lastState.lastDataRev !== undefined && lastState.lastDataRev !== dataRev) {
        decision = {
          should: true,
          reason: "data-changed",
          newState: { ...lastState, lastInjectAt: now.getTime(), lastDateKey: (decision.newState && decision.newState.lastDateKey) || lastState.lastDateKey },
        };
      }
      const scenarioDue = decision.should;
      const deepseekForced = deepseekDecision.should;
      const weatherAlertForced = weatherAlertDecision.should;

      // 峰谷/天气提醒自己到点触发，跟情境频率不共用一个计时器。
      // 情境没到期时它们各发一条通知：不读总结、不读天气、不碰情境的 lastInjectAt/lastHash，
      // 也不推进天气软提及冷却——否则一次换班预告就等于把当天那份情境往前推了 4 小时。
      if (!scenarioDue) {
        const state = { ...decision.newState, contextKey, lastDataRev: dataRev, injectionEnabled: true };
        if (legacyRecovery) {
          // 旧版只落了峰谷状态：第一次恢复时垫一次保守的天气冷却，避免升级后立刻重复刷屏。
          const legacyWeather = readFreshWeather(data, settings, now);
          if (legacyWeather) {
            state.weatherLastMentionAt = now.getTime();
            state.weatherLastFactKey = weatherFactKey(legacyWeather);
          }
        }
        tracker.set(sessionId, state);
        if (legacyRecovery || !trackedState) persistInjectionState(data, sessionId, state);
        const person = readHanaUserName() || "对方";
        const notices = [
          deepseekForced ? buildDeepSeekContext(deepseekDecision.notice, person) : "",
          weatherAlertForced ? buildWeatherAlertContext(weatherAlertDecision.notice, person, { standalone: true }) : "",
        ].filter(Boolean);
        if (!notices.length) return undefined;
        return {
          message: {
            customType: weatherAlertForced && !deepseekForced
              ? "shiguangji-weather-alert"
              : deepseekForced && !weatherAlertForced
                ? "shiguangji-deepseek-peak"
                : "shiguangji-notice",
            content: notices.join("\n\n"),
            display: false,
            details: {
              injector: "shiguangji",
              reason: [
                deepseekForced ? `deepseek-${deepseekDecision.reason}` : "",
                weatherAlertForced ? `weather-alert-${weatherAlertDecision.reason}` : "",
              ].filter(Boolean).join("+"),
              deepseekNotice: deepseekForced,
              weatherAlert: weatherAlertForced,
              summaryCount: 0,
              noticeOnly: true,
            },
          },
        };
      }

      // 情境自己到期：按原普通刷新计时，峰谷/天气提醒能带就并进来。
      const decisionState = { ...decision.newState, contextKey, lastDataRev: dataRev, injectionEnabled: true };
      const xingjiEntries = xingjiInjectionEnabled
        ? pickInjectableEntries(data.getXingjiProfile(currentAgentId))
        : [];
      // 节日引导变体：读已用索引，预先 pick 一个未用过的（随机不重复）；注入成功后才回写
      let festivalHint = null;
      for (const f of builtin) {
        if (hasPendingFestivalGreeting && !festivalHint && getFestivalHintPool(f.name)) {
          const used = data.getUsedFestivalHintIndexes(f.name);
          const picked = pickFestivalHint(f.name, used);
          if (picked) festivalHint = { name: f.name, text: picked.text, index: picked.index, nextUsed: picked.nextUsed, dayInfo: { baseName: f.baseName, holidayDay: f.holidayDay, holidayTotal: f.holidayTotal } };
          break;
        }
      }

      // 近期总结：先按当前伙伴身份做权限过滤，再取最近 3 个已结束生活日；
      // 更老档案只在当前话题有词汇关联时渐进式展开。没有可靠身份时默认不带任何总结。
      const summaryAgentId = resolveSummaryAgentId(getAgentsDir(), currentAgentId);
      // App 里碰不到 Hana 家目录，称呼要先走宿主资源接口取一次（内部带缓存）。
      // 这里不阻塞本轮注入：后台去读，读到了下一轮就是真名，读不到继续用「对方」。
      void resolveHanaUserName(ctx).catch(() => "");
      const userName = readHanaUserName() || "对方";
      const recent = selectRecentSummaries(data.listSummaryEntries(), {
        now,
        boundaryHour: settings.dayBoundaryHour,
        currentAgentId: summaryAgentId,
        shared: settings.summaryShared === true,
        userName,
        prompt: extractPrompt(event),
      });

      // 天气：同步读缓存（刷新由定时器/预热补，不阻塞注入）；没配置/没缓存就 null。
      const weather = readFreshWeather(data, settings, now);
      if (!weather && settings.weatherEnabled !== false) {
        // 缓存空或已过期：不干等那 15 分钟一轮，现在就补一次；本轮多半赶不上，下一轮就有。
        scheduleWeatherPrefetch(data, settings);
      }
      let weatherDecision = decideWeatherMention({ weather, lastState, now });
      // 旧版本只落盘 DeepSeek 状态，无法知道上次天气事实；升级后的第一次恢复保守跳过天气，避免立刻重复刷屏。
      if (legacyRecovery && weather && !storedInjectionState) {
        lastState = {
          ...lastState,
          weatherLastMentionAt: now.getTime(),
          weatherLastFactKey: weatherDecision.factKey,
        };
        weatherDecision = { ...weatherDecision, should: false };
      }
      if (weatherDecision.should || (legacyRecovery && weather && weatherDecision.factKey)) {
        decisionState.weatherLastMentionAt = now.getTime();
        decisionState.weatherLastFactKey = weatherDecision.factKey;
      }
      const weatherForInjection = weatherDecision.should ? weather : null;

      const scenarioText = buildInjectionText({
        now,
        builtinFestivals: builtinForInjection,
        userEvents,
        periods,
        isWorkday: workday,
        todosDue: todos,
        summary: null,
        recentSummaries: recent.entries,
        recentSummaryOptions: {
          currentAgentId: summaryAgentId,
          shared: settings.summaryShared === true,
          proactiveDate: finishedLifeDayKey(now, settings.dayBoundaryHour),
          userName,
        },
        weather: weatherForInjection,
        xingjiEntries,
        deepseekNotice: deepseekDecision.notice,
        includeTime: settings.injectMode !== "economical",
        force: decision.reason === "new-session" || decision.reason === "day-changed" || decision.reason === "injection-enabled",
        periodEndedYesterday,
        festivalHint,
      });

      // 天气提醒独立成段，附在情境后面：它有自己的判定和措辞，不混进「窗外天气」那块。
      const weatherAlertText = weatherAlertForced
        ? buildWeatherAlertContext(weatherAlertDecision.notice, userName)
        : "";
      let text = scenarioText;
      if (weatherAlertText) {
        text = scenarioText ? `${scenarioText}\n\n${weatherAlertText}` : weatherAlertText;
      }

      if (!text) {
        tracker.set(sessionId, decisionState);
        persistInjectionState(data, sessionId, decisionState);
        return undefined;
      }

      // 回写已用节日引导变体索引（随机不重复；只有确实注入且带了节日引导才回写）
      // 宿主 before_agent_start 是同步回调，这里 fire-and-forget：EncryptedStore 内部有写队列，异步落盘不阻塞主流程
      if (festivalHint) {
        try {
          const merged = [...new Set([...data.getUsedFestivalHintIndexes(festivalHint.name), festivalHint.index])];
          data.setUsedFestivalHintIndexes(festivalHint.name, merged).catch(() => {});
        } catch {
          // 回写失败不影响主流程
        }
      }

      // 内容 hash 去重：同一会话同一内容不重复注入
      const hash = crypto.createHash("sha1").update(text).digest("hex");
      if (lastState && lastState.lastHash === hash && !deepseekForced && !weatherAlertForced && decision.reason !== "day-changed" && decision.reason !== "settings-changed" && decision.reason !== "injection-enabled" && decision.reason !== "festival-greeting-pending") {
        // 去重只是不塞第二条一样的消息，状态照样要存档（这次 reason 带来的 lastInjectAt/上下文指纹算数）。
        const dedupedState = { ...decisionState, lastHash: hash };
        tracker.set(sessionId, dedupedState);
        persistInjectionState(data, sessionId, dedupedState);
        return undefined;
      }

      const finalState = {
        ...decisionState,
        lastHash: hash,
        ...(festivalHint ? { festivalGreetingPromptedDate: todayKey, festivalGreetingName: festivalHint.name } : {}),
      };
      tracker.set(sessionId, finalState);
      persistInjectionState(data, sessionId, finalState);

      return {
        message: {
          customType: weatherAlertForced && !scenarioText ? "shiguangji-weather-alert" : "shiguangji-today-context",
          content: text,
          display: false,
          details: {
          injector: "shiguangji",
          reason: [
            decision.reason,
            deepseekForced ? `deepseek-${deepseekDecision.reason}` : "",
            weatherAlertForced ? `weather-alert-${weatherAlertDecision.reason}` : "",
          ].filter(Boolean).join("+"),
          deepseekNotice: deepseekForced,
          weatherAlert: weatherAlertForced,
          summaryCount: recent.entries.length,
          summaryExpanded: recent.expanded,
        },
        },
      };
    } catch {
      // 注入失败绝不能影响主对话
      return undefined;
    }
  });
}

// ── Code 页注入 ──
// 频率跟聊天窗口同一套：适时 / 相伴 / 常在 + 回来多久后更新，都由用户选。
// 以前 Code 页是「每轮都带时间」的特例，那条例外已经取消——它只是块更少、状态更独立。
//
// 开关只认 Code 自己那一套：全局 codeInjectionEnabled + 本屏的 codeInjectionDisabledAgentIds 名单。
// 聊天那屏的 injectionDisabledAgentIds 是聊天的屏蔽名单，不往这里伸手：
// 把聊天静音的伙伴，不代表不让她在改代码的时候拿到时间。
function decideCodeModeInjection({ data, settings, now, sessionId, currentAgentId, currentModel, diskPeakState }) {
  const previous = tracker.get(sessionId) || data.getInjectionState(sessionId) || null;
  // 峰谷状态同样只看自己那两处：内存 → 盘；旧版写在情境状态里的当迁移来源。
  const peakLastState = resolvePeakLastState(sessionId, diskPeakState, previous);

  // 总闸关掉 = 那边一句话都不带，连峰谷也停。这正是「一键关掉 Code 页所有注入词」。
  const codeConfig = resolveCodeInjection(settings, currentAgentId);
  const {
    enabled: codeEnabled,
    items,
    mode: codeMode,
    intervalHours: codeIntervalHours,
  } = codeConfig;
  if (!codeEnabled) {
    const state = { ...(previous || {}), codeMode: true, injectionEnabled: false, lastInjectAt: now.getTime() };
    tracker.set(sessionId, state);
    if (!previous || previous.injectionEnabled !== false) persistInjectionState(data, sessionId, state);
    return undefined;
  }

  // 峰谷在这屏只认勾选：聊天那屏的峰谷开关管聊天，Code 页自己勾了才带。
  const peakEnabled = items.peak === true;
  const peakDecision = peakEnabled
    ? decideDeepSeekNotice({ model: currentModel, now, lastState: peakLastState })
    : { should: false, reason: "peak-off", notice: null, state: null };
  commitPeakState(data, sessionId, peakDecision.state);

  // 频率判定：和聊天窗口同一个 shouldInject，只是读 Code 自己那屏的设置。
  // 改了 Code 那屏的设置（方式/间隔/带哪些/时间开关）→ 下一轮立刻按新设置来，不等间隔。
  // 指纹只认当前伙伴的生效配置：别的伙伴改了她自己的 Code 配置，不该让本窗口重刷。
  const contextKey = buildCodeContextKey(settings, codeConfig);
  const decision = shouldInject({
    sessionId,
    now,
    mode: codeMode,
    intervalHours: codeIntervalHours,
    lastState: previous,
    hasSpecialDay: false,
    dayBoundaryHour: settings.dayBoundaryHour,
    contextKey,
    injectionEnabled: true,
  });
  // 换班预告这类硬触发不吃频率：错过那几分钟就没下次了。
  const peakForced = peakDecision.should;
  const baseState = { ...(previous || {}), ...decision.newState, codeMode: true, injectionEnabled: true };
  if (!decision.should && !peakForced) {
    tracker.set(sessionId, baseState);
    persistInjectionState(data, sessionId, baseState);
    return undefined;
  }

  if (!decision.should) {
    // 峰谷自己到点、这屏的刷新频率还没到：只发峰谷一条，不收集其它块，
    // 也不动 lastInjectAt/lastHash——否则一次换班预告就把下次刷新往后推了一个间隔。
    tracker.set(sessionId, baseState);
    persistInjectionState(data, sessionId, baseState);
    return {
      message: {
        customType: "shiguangji-deepseek-peak",
        content: buildDeepSeekContext(peakDecision.notice, readHanaUserName() || "对方", { codeMode: true }),
        display: false,
        details: {
          injector: "shiguangji",
          reason: `deepseek-${peakDecision.reason}`,
          codeMode: true,
          deepseekNotice: true,
          summaryCount: 0,
          noticeOnly: true,
        },
      },
    };
  }

  // 只收集真正要带的东西：没选的块连算都不算，省得白读一遍总结和天气。
  const builtin = items.special ? getBuiltinFestivals(now) : [];
  const userEvents = items.special ? data.eventsOnDate(now).filter((e) => e.type !== "period") : [];
  const periods = items.special && settings.showPeriod !== false
    ? data.periodsWithDayOn(now).filter((p) => !p.predicted).map((p) => p.event)
    : [];
  const workday = items.special ? isWorkday(now) : false;
  const todos = items.todos ? filterDueTodos(data.listEvents(), now) : [];
  const weather = items.weather ? readFreshWeather(data, settings, now) : null;
  const userName = readHanaUserName() || "对方";
  const summaryAgentId = items.archive ? resolveSummaryAgentId(getAgentsDir(), currentAgentId) : "";
  // Code 页不做话题关联展开，也不请人做「历史档案」那套日期推演：只带最近几天，够用就收。
  const recent = items.archive
    ? selectRecentSummaries(data.listSummaryEntries(), {
        now,
        boundaryHour: settings.dayBoundaryHour,
        currentAgentId: summaryAgentId,
        shared: settings.summaryShared === true,
        userName,
        prompt: "",
      })
    : { entries: [], expanded: false };
  const xingjiEntries = items.xingji && settings.xingjiInjectionEnabled === true && currentAgentId
    ? pickInjectableEntries(data.getXingjiProfile(currentAgentId))
    : [];
  // 天气也走同一份冷却：同一件天气事实在 Code 页说过，不用每轮再说一次。
  const weatherDecision = decideWeatherMention({ weather, lastState: previous, now });
  const weatherForInjection = weatherDecision.should ? weather : null;

  const text = buildInjectionText({
    now,
    builtinFestivals: builtin,
    userEvents,
    periods,
    isWorkday: workday,
    todosDue: todos,
    recentSummaries: recent.entries,
    recentSummaryOptions: {
      currentAgentId: summaryAgentId,
      shared: settings.summaryShared === true,
      proactiveDate: finishedLifeDayKey(now, settings.dayBoundaryHour),
      userName,
    },
    xingjiEntries,
    weather: weatherForInjection,
    deepseekNotice: peakDecision.notice,
    // 适时档只给日期不给钟点：一天最多来一次，那一刻的钟点很快就过期了，
    // 带一个错的比不带更糟。聊天窗口的「适时」也是同一条规矩。
    includeTime: codeMode !== "economical",
    includeTimeBlock: items.time === true, // 时间没勾选时，整行「今日时光」都不进
    force: true, // Code 页至少要把这一轮的时间递上去
    codeMode: true,
  });

  const state = {
    ...(previous || {}),
    ...decision.newState,
    codeMode: true,
    injectionEnabled: true,
  };
  if (!text) {
    // 一个块都没凑齐（时间关着、其它也没勾）：这轮不注入，
    // 但也不推进间隔——用户把时间开关打开后，下一条消息就该看到。
    state.lastInjectAt = previous?.lastInjectAt ?? now.getTime();
    state.lastDateKey = previous?.lastDateKey || lifeDayKey(now, settings.dayBoundaryHour);
    tracker.set(sessionId, state);
    persistInjectionState(data, sessionId, state);
    return undefined;
  }

  const hash = crypto.createHash("sha1").update(text).digest("hex");
  state.lastInjectAt = now.getTime();
  state.lastDateKey = lifeDayKey(now, settings.dayBoundaryHour);
  state.lastHash = hash;
  if (weatherForInjection) {
    state.weatherLastMentionAt = now.getTime();
    state.weatherLastFactKey = weatherDecision.factKey;
  }
  // 换班预告这类硬触发不许被去重吃掉；其余同一分钟同一份内容就不再塞第二遍。
  const unchanged = previous?.codeMode === true && previous?.lastHash === hash && !peakForced;
  tracker.set(sessionId, state);
  persistInjectionState(data, sessionId, state);
  if (unchanged) return undefined;

  return {
    message: {
      customType: "shiguangji-code-context",
      content: text,
      display: false,
      details: {
        injector: "shiguangji",
        reason: [decision.reason, peakForced ? `deepseek-${peakDecision.reason}` : ""].filter(Boolean).join("+"),
        codeMode: true,
        deepseekNotice: !!peakForced,
      },
    },
  };
}

// Code 页自己的设置指纹：只认 Code 这屏管的东西，而且只认当前伙伴的生效结果
// （resolveCodeInjection 已经把这位伙伴在不在这屏的屏蔽名单里算进 enabled）。
// 聊天那屏改了别的设置、或者名单里别的伙伴变了，都不该让这屏重刷一次。
function buildCodeContextKey(settings = {}, codeConfig = {}) {
  return JSON.stringify({
    enabled: codeConfig.enabled !== false,
    mode: codeConfig.mode,
    intervalHours: codeConfig.intervalHours,
    items: codeConfig.items || {},
    boundaryHour: settings.dayBoundaryHour,
    showPeriod: settings.showPeriod !== false,
    summaryShared: settings.summaryShared === true,
    weatherEnabled: settings.weatherEnabled !== false,
    weatherLocation: settings.weatherLocation || "",
    xingjiInjectionEnabled: settings.xingjiInjectionEnabled === true,
  });
}

function buildInjectionContextKey(settings = {}) {
  return JSON.stringify({
    mode: settings.injectMode || "balanced",
    intervalHours: settings.injectIntervalHours || 4,
    boundaryHour: settings.dayBoundaryHour,
    showPeriod: settings.showPeriod !== false,
    summaryShared: settings.summaryShared === true,
    weatherEnabled: settings.weatherEnabled !== false,
    weatherLocation: settings.weatherLocation || "",
    injectionDisabledAgentIds: Array.isArray(settings.injectionDisabledAgentIds)
      ? [...settings.injectionDisabledAgentIds].map(String).sort()
      : [],
    xingjiInjectionEnabled: settings.xingjiInjectionEnabled === true,
  });
}

function parseContextKey(value) {
  try {
    const parsed = JSON.parse(String(value || ""));
    return parsed && typeof parsed === "object" ? parsed : { value };
  } catch {
    return { value: String(value || "") };
  }
}

function logContextKeyChange(sessionId, previousKey, nextKey) {
  const previous = parseContextKey(previousKey);
  const next = parseContextKey(nextKey);
  const fields = [...new Set([...Object.keys(previous), ...Object.keys(next)])]
    .filter((key) => JSON.stringify(previous[key]) !== JSON.stringify(next[key]));
  if (!fields.length) return;
  logInfo(`情境注入设置指纹变化 session=${sessionId} fields=${fields.join(",")} old=${JSON.stringify(previous)} new=${JSON.stringify(next)}`);
}

function readFreshWeather(data, settings, now) {
  try {
    const cache = data.getWeatherCache();
    if (
      settings.weatherEnabled !== false &&
      weatherCacheMatches(cache, settings) &&
      weatherCacheIsFresh(cache, settings, now)
    ) {
      const normalized = normalizeWeatherResult(cache.result, now);
      return normalized ? { ...normalized, place: normalized.place || cache.location || "" } : null;
    }
  } catch {
    // 天气读取失败时继续注入其他情境。
  }
  return null;
}

function getAgentsDir() {
  const hanaHome = process.env.HANA_HOME || path.join(os.homedir(), ".hanako");
  return path.join(hanaHome, "agents");
}

function dateKeyOf(d) {
  const pad2 = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

function extractPrompt(event) {
  const value = event?.prompt ?? event?.message?.content ?? event?.text ?? "";
  if (typeof value === "string") return value.slice(0, 2000);
  if (Array.isArray(value)) {
    return value.map((part) => typeof part === "string" ? part : part?.text || "").join(" ").slice(0, 2000);
  }
  return "";
}

export function resolveCurrentModel(event, ctx, sessionId = "", agentId = "") {
  try {
    const model = ctx?.model;
    if (model) return model;
  } catch {
    // 旧宿主或尚未绑定模型时，继续尝试事件字段。
  }
  // 主对话场景宿主把 ctx.model 填成 null（实测），模型自述又不可信（模型不知道自己跑在哪个模型上）。
  // 正路：注入前由 App 适配层经 ctx.resources 预取好的会话模型（读宿主会话 jsonl 里的 model_change）。
  const primed = getPrimedModel(agentId || ctx?.agentId, sessionId || ctx?.sessionManager?.getSessionId?.());
  if (primed) return primed;
  // 回退：老路径，万一宿主哪天放开 fs 或 getSessionFile 变得可用。
  const recorded = readLatestModelChange(
    ctx?.sessionManager?.getSessionFile?.()
    || findSessionFile(agentId || ctx?.agentId, sessionId || ctx?.sessionManager?.getSessionId?.()),
  );
  if (recorded) return recorded;
  return event?.model || event?.currentModel || event?.modelInfo || null;
}

export function resolveAgentId(event, ctx) {
  const direct = [
    ctx?.agentId,
    ctx?.agent?.id,
    ctx?.agent?.agentId,
    ctx?.sessionManager?.getAgentId?.(),
    event?.agentId,
    event?.agent?.id,
  ];
  for (const value of direct) {
    const id = String(value || "").trim();
    if (id) return id;
  }
  // 当前宿主仍可能只给 session 文件路径；路径回退只取 agents/<id>/sessions 这一段。
  const sessionPath = ctx?.sessionManager?.getSessionFile?.() || ctx?.sessionPath || "";
  const match = String(sessionPath).match(/[\\/]agents[\\/]([^\\/]+)[\\/]sessions[\\/]/i);
  return match ? match[1] : "";
}

// ── 天气惰性刷新 ──
// 每 15 分钟检查一次：配置了居住地 + 缓存过期 → 后台查一次天气写缓存。
// 注入只同步读缓存，刷新永不阻塞对话。
function startWeatherRefresher(dataDir = null) {
  if (weatherTimer) return; // 防重复
  const check = () => {
    try {
      const data = getData();
      const settings = data.getSettings();
      if (settings.weatherEnabled === false) return; // 用户主动关闭天气时不查询
      if (!resolveWeatherLocation(settings).location) return; // 没配置居住地就不查
      // 缓存有效就什么都不做；过期/没有 → 后台查（失败静默，下次再试）。判定逻辑统一在 weather.js。
      ensureWeatherFresh({
        data,
        settings,
        onError: (e) => logWarn(`天气后台刷新失败：${String(e?.message || e || "").slice(0, 300)}`),
      }).then((r) => {
        if (r) {
          // 新天气落地了，对外快照跟着换一份
          try {
            const refreshed = getData();
            refreshPublicTodayNow({ dataDir, data: refreshed, settings: refreshed.getSettings() });
          } catch {
            // 天气刷新成功但快照失败，不影响下一次注入
          }
        }
      }).catch(() => {});
    } catch {
      // 刷新失败静默
    }
  };
  check(); // 启动即检查一次
  weatherTimer = setInterval(check, 15 * 60 * 1000);
  weatherTimer.unref?.();
}
