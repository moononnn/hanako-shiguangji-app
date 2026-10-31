// 拾光记 App 版 · 注入适配层
//
// 旧版 extensions/inject.js 的决策逻辑（什么时候注入、注入什么、去重、节流）一行不改，
// 这一层只负责把它的宿主接口换成 App 的：
//   旧：pi.on("before_agent_start", (event, ctx)) → 返回 { message: { customType, content, display:false } }
//   新：ctx.hooks.onDecision("agent/before-start", (payload)) → 返回 { message: { role:"user", content } }
//
// 旧代码要的 ctx 面：sessionManager（会话 id/文件/伙伴/条目）、dataDir、model。
// 其中 getEntries/getLeafId 是同步取会话树，App 里只有异步总线，所以进钩子时先预取一份快照。

import registerShiguangjiInject from "../extensions/inject.js";
import { configureSharedUserData, getSharedUserData } from "../lib/shared-data.js";
import { primeSessionModel } from "../lib/session-model.js";
import { createSessionMetaResolver, extractSessionUuid, isCasualSession, isCodeSession, isKnownSessionNamespace, isSubagentSessionPath } from "../lib/session-kind.js";
import { resolveCodeInjection } from "../lib/code-mode.js";
import { isDeepSeekModel } from "../lib/deepseek-peak.js";
import { ensureWeatherFresh, ensureWeatherForecastFresh } from "../lib/weather.js";
import { configureDebugLog, logInfo, logWarn } from "../lib/debug-log.js";

// 缓存过期时的同步补查上限：天气只配了 5 秒，不能拖慢整轮开场。
const WEATHER_PREFETCH_TIMEOUT_MS = 5000;

// 用户是否主动打开过「闲聊窗口」注入。它既是功能开关，也是「分区查不出来时允许按
// 聊天档走」的授权。读不到设置时当没开（fail-closed 不变）。
function casualInjectionOptedIn() {
  try {
    return getSharedUserData()?.getSettings?.()?.casualInjectionEnabled === true;
  } catch {
    return false;
  }
}

// 闲聊那类会话落在这里：agents/<id>/sessions/<时间戳>_<uuid>.jsonl。
//
// 为什么要看路径：分区查不出来时，我们靠用户打开「闲聊窗口」开关来放行，但那一放
// 会连别的东西一起放：宿主的 background / activity 会话（定时的记忆整理、巡检之类）
// 同样查不到分区（它们在 `agents/<id>/activity/` 下），跟着被当成闲聊灌进一整套
// 生活情境。2026-10-30 16:01 实采到一次：204 字注入落进了 background 会话，伙伴还是「?」。
// 所以放行只认聊天会话那个目录，其它的照旧跳过。
const CHAT_SESSION_PATH_RE = /[\\/]agents[\\/][^\\/]+[\\/]sessions[\\/]/i;

/** 这个路径看起来是不是一个聊天会话（闲聊和普通聊天都在这儿，子代理/后台不在）。 */
export function looksLikeChatSessionPath(sessionPath) {
  return CHAT_SESSION_PATH_RE.test(String(sessionPath || ""));
}

function agentIdFromSessionPath(sessionPath) {
  const match = String(sessionPath || "").match(/[\\/]agents[\\/]([^\\/]+)[\\/]sessions[\\/]/i);
  return match ? match[1] : "";
}

function textOrEmpty(value) {
  return typeof value === "string" ? value.trim() : "";
}

/**
 * 按既有调用契约读取 `payload.session.agentId` / `payload.agentId`。
 * 只接受非空字符串，不猜显示名，也不将对象、数字或布尔转换成假 ID。
 * 认不出就返回空串，交给路径回退。
 */
function agentIdFromPayload(payload) {
  const nested = textOrEmpty(payload?.session?.agentId);
  if (nested) return nested;
  return textOrEmpty(payload?.agentId);
}

/**
 * 这一跑到底是谁：宿主给了就信宿主（Code 窗口的 sessionPath 可能压根没带
 * agents/<id>/sessions 这一段，只靠路径推会推出空号），没有才退回路径解析。
 */
function resolveRunAgentId(payload, sessionPath) {
  return agentIdFromPayload(payload) || agentIdFromSessionPath(sessionPath);
}

async function readEntriesSnapshot(ctx, sessionId) {
  try {
    const result = await ctx.bus.request("session:entries", { sessionId, scope: "all" });
    return {
      entries: Array.isArray(result?.entries) ? result.entries : [],
      leafId: typeof result?.leafId === "string" ? result.leafId : null,
    };
  } catch {
    return { entries: [], leafId: null };
  }
}

// 缓存没得用时同步补一次天气（最多等 WEATHER_PREFETCH_TIMEOUT_MS；失败一律当没有，不阻断对话）。
// 命中缓存时 ensureWeatherFresh 直接同步返回，不产生任何等待。
// 模型同理：进钩子前先把「当前会话用的是哪个模型」读好，扩展里那套同步判定就不用改成 async。
async function primeSessionModelBounded(ctx, agentId, sessionId) {
  const timer = new Promise((resolve) => setTimeout(() => resolve(null), 3000));
  try {
    return await Promise.race([
      primeSessionModel(ctx?.resources, { agentId, sessionId }),
      timer,
    ]);
  } catch {
    return null;
  }
}
async function prefetchWeather(ctx) {
  try {
    configureDebugLog(ctx?.dataDir);
    if (ctx?.dataDir) configureSharedUserData(ctx.dataDir);
    const data = getSharedUserData();
    if (!data) return;
    await ensureWeatherFresh({
      data,
      timeoutMs: WEATHER_PREFETCH_TIMEOUT_MS,
      onError: (e) => logWarn(`天气预取失败：${String(e?.message || e || "").slice(0, 200)}`),
      log: { info: logInfo, warn: logWarn },
    });
  } catch {
    // 预取失败不影响注入：照样带日期、节日、待办这些。
  }
}

// 预报预取：天气提醒要靠未来几小时的预报。缓存新鲜时直接返回，不产生等待；
// 没有缓存时先花几秒补一次，让第一句话就有机会带上提醒。
async function prefetchWeatherForecast(ctx) {
  try {
    configureDebugLog(ctx?.dataDir);
    if (ctx?.dataDir) configureSharedUserData(ctx.dataDir);
    const data = getSharedUserData();
    if (!data) return;
    await ensureWeatherForecastFresh({
      data,
      timeoutMs: WEATHER_PREFETCH_TIMEOUT_MS,
      onError: (e) => logWarn(`天气预报预取失败：${String(e?.message || e || "").slice(0, 200)}`),
      log: { info: logInfo, warn: logWarn },
    });
  } catch {
    // 预取失败不影响注入：照样带日期、节日、待办这些。
  }
}

// Code 页这一轮要不要天气：按当前伙伴的生效结果算（`resolveCodeInjection(settings, agentId)` 会把
// codeInjectionDisabledAgentIds 名单算进去）。总闸关了、这位伙伴被单独关闭、或没勾天气就不查——
// 省一次网络，也省掉那几秒等待。
// 没有伙伴身份时传空：那时只能看全局配置；判不出配置时按要查算（宁可多查一次，别吞了人家选的天气）。
export function codeWeatherEnabled(agentId) {
  try {
    const settings = getSharedUserData()?.getSettings?.();
    if (!settings) return true;
    const code = resolveCodeInjection(settings, agentId);
    if (!code.enabled) return false;
    return code.items.weather === true;
  } catch {
    return true;
  }
}

// ── 峰谷提示的时效 ────────────────────────────────────────
// 峰谷关照是「到点提醒」，不是长期指令。但注入本身是往会话里落一条消息，
// 它进了历史就一直躺在那里，之后每一轮模型都能读到「本轮回复里必须把这个时段说出口」，
// 于是把一次性提醒当成待办，每回话末尾都交一次差（实采：01a184d6 一轮注入、后续又自己说了两次）。
//
// 治法是让命令过期，不是让命令变软：每轮请求模型之前，把「最后一条用户消息之前」的
// 峰谷注入里的那段指令整段拆掉，本轮刚注入的原样放行。到点照样报，只是不再被反复复读。
//
// 注意：拆掉的内容一句话都不回填。早期版本把整条消息换成一句「已过期，不必再提这个时段」，
// 结果是每轮又往上下文里塞一句带「时段」二字的话，等于自己给自己递题。现在什么都不留。
const PEAK_MARK = "【模型峰谷关照】";
const PEAK_ENDING_MARK = "本轮的模型峰谷关照要在本轮回复里带出一句";

function messageTextOf(message) {
  const content = message?.content;
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content.map((part) => (typeof part === "string" ? part : part?.text || "")).join("");
  }
  return "";
}

// 注入落进会话后 role 会是 custom（内容里带着那段文案）；兼容还没转换的 user 形态。
function isPeakInjection(message) {
  const role = message?.role;
  if (role !== "custom" && role !== "user") return false;
  return messageTextOf(message).includes(PEAK_MARK);
}

/**
 * 把一段注入文本里的峰谷部分整段拿掉，其余内容（今日时光／历史档案／近期回忆）原样保留。
 * 返回空串表示这条消息除了峰谷没别的东西，可以整条丢弃。
 */
export function stripPeakSection(text) {
  const raw = String(text || "");
  if (!raw.includes(PEAK_MARK) && !raw.includes(PEAK_ENDING_MARK)) return raw;
  const kept = raw
    .split("\n")
    // 峰谷那一段是一整行（前缀固定），整行拿走
    .filter((line) => !line.trimStart().startsWith(PEAK_MARK))
    // 结尾那句只提峰谷的收口也拿走，别留半句孤零零的命令
    .map((line) => {
      const at = line.indexOf(PEAK_ENDING_MARK);
      if (at < 0) return line;
      const head = line.slice(0, at);
      // 句子到下一个分号结束（「…换了就过去了）；」），把它连同分号一起剪掉
      const tail = line.slice(at);
      const semi = tail.indexOf("；");
      return head + (semi >= 0 ? tail.slice(semi + 1) : "");
    })
    .join("\n");
  return kept.replace(/\n{3,}/g, "\n\n").trim();
}

/**
 * 把历史里过期的峰谷注入拆掉，本轮新注入的不动。
 *
 * 判据是位置而不是时间戳：注入排在本轮用户消息之后，所以「最后一条用户消息之前」的
 * 峰谷消息必然来自更早的轮次。找不到用户消息时一律不动（宁可多念一次，不误删本轮的提醒）。
 */
export function expireStalePeakNotices(messages) {
  if (!Array.isArray(messages) || messages.length === 0) return undefined;

  let lastUserIndex = -1;
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i]?.role === "user") { lastUserIndex = i; break; }
  }
  if (lastUserIndex < 0) return undefined;

  let changed = false;
  const next = [];
  for (let index = 0; index < messages.length; index++) {
    const message = messages[index];
    if (index >= lastUserIndex || !isPeakInjection(message)) {
      next.push(message);
      continue;
    }
    changed = true;
    const text = messageTextOf(message);
    const stripped = stripPeakSection(text);
    if (!stripped) continue; // 只剩峰谷：整条丢掉，不留任何回填
    const content = typeof message.content === "string"
      ? stripped
      : [{ type: "text", text: stripped }];
    next.push({ ...message, content, details: { ...(message.details || {}), peakExpired: true } });
  }

  return changed ? { messages: next } : undefined;
}

/**
 * 这段对话现在跑的是不是 DeepSeek 系模型 —— 看上下文里最近一条助手消息自己带的 provider/model。
 *
 * 用它来验一件事：峰谷关照是「这段对话正在跑 DeepSeek 系模型」时才成立的断言。
 * 认不出来（还没开过口、消息里没带模型字段）就返回 null，不下判断。
 */
export function conversationRunsDeepSeek(messages) {
  if (!Array.isArray(messages)) return null;
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i];
    if (!message || message.role !== "assistant") continue;
    const provider = typeof message.provider === "string" ? message.provider : "";
    const modelId = typeof message.model === "string"
      ? message.model
      : (typeof message.modelId === "string" ? message.modelId : "");
    if (!provider && !modelId) continue;
    return isDeepSeekModel({ provider, modelId });
  }
  return null;
}

/**
 * 峰谷提醒落到了不该落的对话里时，整段拿掉。
 *
 * 2026-10-29 实机：minimax 的 Code 窗口里收到一段「咱们这会儿正用着 DeepSeek」的峰谷关照，
 * 那段是按另一个会话（DeepSeek 系）的身份算出来的，模型顺着它说「现在正是谷时段，挺划算」。
 * 分区和模型都由那段对话自己的上下文说了算，对不上就是串了——所以这里不看注入时算的模型，
 * 直接看这段对话自己跑的是什么模型：不是 DeepSeek 系，这段提醒就不成立，整段拆掉。
 */
export function stripPeakForForeignModel(messages) {
  if (!Array.isArray(messages) || messages.length === 0) return undefined;
  if (conversationRunsDeepSeek(messages) !== false) return undefined;

  let changed = false;
  const next = [];
  for (const message of messages) {
    if (!isPeakInjection(message)) {
      next.push(message);
      continue;
    }
    changed = true;
    const stripped = stripPeakSection(messageTextOf(message));
    if (!stripped) continue; // 只剩峰谷：整条丢掉，不留任何回填
    const content = typeof message.content === "string"
      ? stripped
      : [{ type: "text", text: stripped }];
    next.push({ ...message, content, details: { ...(message.details || {}), peakForeignModel: true } });
  }
  return changed ? { messages: next } : undefined;
}

export function attachInject(ctx, record = () => {}) {
  const handlers = { before_agent_start: [], message_end: [] };
  // 分区判断要问宿主总线，结果缓存 30 分钟（见 lib/session-kind.js）。
  const resolveSessionMeta = createSessionMetaResolver({ bus: ctx.bus, debug: record });
  const fakePi = {
    dataDir: ctx.dataDir,
    on(name, fn) {
      (handlers[name] ||= []).push(fn);
    },
  };

  try {
    registerShiguangjiInject(fakePi);
    record(
      `注入适配: 旧版注册完成 (before_agent_start=${handlers.before_agent_start.length} 个, message_end=${handlers.message_end.length} 个)`
    );
  } catch (e) {
    record(`注入适配 FAIL 注册: code=${e?.code || "-"} ${e?.message || e}`);
    return;
  }

  ctx.hooks.onDecision("agent/before-start", async (payload) => {
    try {
      const sessionId = payload?.session?.sessionId || null;
      if (!sessionId) return undefined;
      const sessionPath = payload?.session?.sessionPath || "";
      // 会话身份自检：宿主给的 id 和路径必须指向同一个会话。
      // 两者对不上，说明这一轮拿到的身份是串的——这时分区、模型、时段全会按错的身份算，
      // 所以这一轮什么都不注入（宁可少带一次，下一轮自然补回来）。
      const idUuid = extractSessionUuid(sessionId);
      const pathUuid = extractSessionUuid(sessionPath);
      if (idUuid && pathUuid && idUuid !== pathUuid) {
        record(`注入跳过: 会话 id 与路径指向不同的会话（${idUuid} / ${pathUuid}）`);
        return undefined;
      }
      // 子代理会话是派出去干活的临时对话：那边没有「她」在等今天几点、窗外什么天气。
      // 一律不注入，也不为它去查会话快照、模型和天气——一分钱的开销都不花。
      if (isSubagentSessionPath(sessionPath)) {
        record(`注入跳过: 子代理会话 ${sessionId}`);
        return undefined;
      }
      const agentId = resolveRunAgentId(payload, sessionPath);
      // 分区要在任何副作用（会话快照、模型预取、天气预取）之前问清楚：
      // Code 窗口和聊天窗口带的东西是两套，分区不明就什么都不做——认错的代价比这次少带一次大得多。
      let sessionMeta = String(payload?.session?.namespace || "").trim()
        ? { namespace: String(payload.session.namespace).trim() }
        : await resolveSessionMeta({ sessionId, sessionPath, timeoutMs: 1200 }).catch(() => ({ namespace: "" }));
      if (!isKnownSessionNamespace(sessionMeta?.namespace)) {
        // 闲聊那类会话，宿主现在根本不向应用公开身份：session:get 内部走
        // `listSessions({ namespace: "all" })`，而宿主自己的 all 白名单是
        // `["home", "code", "app"]`（缺 casual），于是闲聊会话一律查不到、回 null。
        // 所以「查不出分区」现在有两种含义：一种是宿主抖动，一种就是闲聊。
        // 区分不了就不自己猜。只有在用户主动打开「闲聊窗口」开关时，才算他授权了
        // 「这种查不出分区的时候，按聊天档带一次」；开关没开就照旧一个字不塞。
        if (!casualInjectionOptedIn() || !looksLikeChatSessionPath(sessionPath)) {
          record(`注入跳过: 分区未知「${sessionMeta?.namespace || "-"}」 会话=${sessionId}`);
          return undefined;
        }
        record(`注入放行: 分区未知，但用户开了闲聊窗口开关，按聊天档处理 会话=${sessionId}`);
        // resolveSessionMeta 拿不到时回的是 Object.freeze 的空壳，不能直接改字段。
        sessionMeta = { ...sessionMeta, namespace: "casual" };
      }
      const inCode = isCodeSession(sessionMeta.namespace);
      // 闲聊（宿主侧边栏那扇门）几段就换一个会话，一段一个 sessionId。注入状态如果按
      // sessionId 记，每段都会被当成新会话、每段重播一遍今天。所以那边按伙伴记一本账；
      // before-start 与 post-assistant 必须用同一个键，否则节日问候在说出口的那一侧
      // 记不回来，注入侧会一直当成「还没问候过」反复催。
      const sessionAppKey = isCasualSession(sessionMeta.namespace)
        ? `casual:${agentId || "unknown"}`
        : sessionId;
      const snapshot = await readEntriesSnapshot(ctx, sessionId);
      await primeSessionModelBounded(ctx, agentId, sessionId);
      // 天气预取：缓存过期时不拿旧的冒充、也不干等下一轮，先花几秒补一次再组装。
      // 这样刚开机或久未开口时的第一句话也能带上「窗外」。
      // Code 页没选天气就不必去查：省一次网络，也省掉那几秒等待。
      if (!inCode || codeWeatherEnabled(agentId)) {
        try {
          await prefetchWeather(ctx);
        } catch (error) {
          logWarn(`天气预取失败：${String(error?.message || error || "").slice(0, 200)}`);
        }
        try {
          await prefetchWeatherForecast(ctx);
        } catch (error) {
          logWarn(`天气预报预取失败：${String(error?.message || error || "").slice(0, 200)}`);
        }
      }
      const legacyCtx = {
        dataDir: ctx.dataDir,
        agentId,
        model: payload?.model || null,
        // Code 页判定结果：扩展里拿不到总线，只能在这里先取好递进去。
        sessionNamespace: sessionMeta?.namespace || "",
        // 注入状态该记在哪个键上（闲聊按伙伴，其余按会话）。
        sessionAppKey,
        sessionManager: {
          getSessionId: () => sessionId,
          getSessionFile: () => sessionPath,
          getAgentId: () => agentId,
          getEntries: () => snapshot.entries,
          getLeafId: () => snapshot.leafId,
        },
      };

      for (const handler of handlers.before_agent_start) {
        const out = await handler(payload, legacyCtx);
        const text = out?.message?.content;
        if (typeof text === "string" && text.trim()) {
          record(
            `注入命中: ${text.length} 字 | reason=${out?.message?.details?.reason || "?"} | 伙伴=${agentId || "?"} | 窗口=${sessionMeta?.namespace || "?"} | 开头=${text.slice(0, 90).replace(/\s+/g, " ")}`
          );
          return { message: { role: "user", content: text } };
        }
      }
      record(`注入未命中: 伙伴=${agentId || "?"} 窗口=${sessionMeta?.namespace || "?"} 会话=${sessionId}`);
      return undefined;
    } catch (e) {
      record(`注入适配 FAIL before-start: code=${e?.code || "-"} ${e?.message || e}`);
      return undefined;
    }
  });

  ctx.hooks.onDecision("messages/post-assistant", async (payload) => {
    try {
      const sessionId = payload?.session?.sessionId || null;
      if (!sessionId) return undefined;
      const sessionPath = payload?.session?.sessionPath || "";
      // 与 before-start 用同一个键：闲聊按伙伴、其余按会话。分区查询走 30 分钟缓存，
      // 这里不会每轮都去撞总线。
      let sessionAppKey = sessionId;
      const meta = await resolveSessionMeta({ sessionId, sessionPath, timeoutMs: 1200 })
        .catch(() => ({ namespace: "" }));
      // 与 before-start 同一套判定：真认成 casual，或者分区查不出但用户开了闲聊开关。
      const casualNamespace = isCasualSession(meta?.namespace)
        || (!isKnownSessionNamespace(meta?.namespace) && casualInjectionOptedIn() && looksLikeChatSessionPath(sessionPath));
      if (casualNamespace) {
        sessionAppKey = `casual:${resolveRunAgentId(payload, sessionPath) || "unknown"}`;
      }
      const legacyCtx = {
        dataDir: ctx.dataDir,
        agentId: resolveRunAgentId(payload, sessionPath),
        sessionNamespace: casualNamespace ? "casual" : (meta?.namespace || ""),
        sessionAppKey,
        sessionManager: { getSessionId: () => sessionAppKey },
      };
      for (const handler of handlers.message_end) {
        await handler({ message: payload?.message }, legacyCtx);
      }
    } catch (e) {
      record(`注入适配 FAIL post-assistant: code=${e?.code || "-"} ${e?.message || e}`);
    }
    return undefined;
  });

  // 峰谷提示只管一轮：请求模型之前把过期的那些收掉，本轮刚注入的放行。
  // 这里只改上下文里的那一条，绝不回写会话档案——历史保持原样，可追溯。
  ctx.hooks.onDecision("agent/pre-step", async (payload) => {
    try {
      const expired = expireStalePeakNotices(payload?.messages);
      const messages = expired?.messages || payload?.messages;
      const foreign = stripPeakForForeignModel(messages);
      if (foreign) {
        record("峰谷提示移除: 这段对话跑的不是 DeepSeek 系模型，那段时段提醒是按别的会话算的");
        return { messages: foreign.messages };
      }
      if (expired) record("峰谷提示过期: 历史里的峰谷段已拆掉（其它块保留）");
      return expired;
    } catch (e) {
      record(`注入适配 FAIL pre-step: code=${e?.code || "-"} ${e?.message || e}`);
      return undefined;
    }
  });

  record("注入适配: App 钩子已挂上（before-start + pre-step + post-assistant）");
}
