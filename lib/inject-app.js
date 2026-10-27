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
import { createSessionMetaResolver, isCodeSession, isKnownSessionNamespace, isSubagentSessionPath } from "../lib/session-kind.js";
import { resolveCodeInjection } from "../lib/code-mode.js";
import { ensureWeatherFresh, ensureWeatherForecastFresh } from "../lib/weather.js";
import { configureDebugLog, logInfo, logWarn } from "../lib/debug-log.js";

// 缓存过期时的同步补查上限：天气只配了 5 秒，不能拖慢整轮开场。
const WEATHER_PREFETCH_TIMEOUT_MS = 5000;

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
      // 子代理会话是派出去干活的临时对话：那边没有「她」在等今天几点、窗外什么天气。
      // 一律不注入，也不为它去查会话快照、模型和天气——一分钱的开销都不花。
      if (isSubagentSessionPath(sessionPath)) {
        record(`注入跳过: 子代理会话 ${sessionId}`);
        return undefined;
      }
      const agentId = resolveRunAgentId(payload, sessionPath);
      // 分区要在任何副作用（会话快照、模型预取、天气预取）之前问清楚：
      // Code 窗口和聊天窗口带的东西是两套，分区不明就什么都不做——认错的代价比这次少带一次大得多。
      const sessionMeta = String(payload?.session?.namespace || "").trim()
        ? { namespace: String(payload.session.namespace).trim() }
        : await resolveSessionMeta({ sessionId, sessionPath, timeoutMs: 1200 }).catch(() => ({ namespace: "" }));
      if (!isKnownSessionNamespace(sessionMeta?.namespace)) {
        record(`注入跳过: 分区未知「${sessionMeta?.namespace || "-"}」 会话=${sessionId}`);
        return undefined;
      }
      const inCode = isCodeSession(sessionMeta.namespace);
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
      const legacyCtx = {
        dataDir: ctx.dataDir,
        sessionManager: { getSessionId: () => sessionId },
      };
      for (const handler of handlers.message_end) {
        await handler({ message: payload?.message }, legacyCtx);
      }
    } catch (e) {
      record(`注入适配 FAIL post-assistant: code=${e?.code || "-"} ${e?.message || e}`);
    }
    return undefined;
  });

  record("注入适配: App 钩子已挂上（before-start + post-assistant）");
}
