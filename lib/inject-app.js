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
import { ensureWeatherFresh } from "../lib/weather.js";
import { configureDebugLog, logInfo, logWarn } from "../lib/debug-log.js";

// 缓存过期时的同步补查上限：天气只配了 5 秒，不能拖慢整轮开场。
const WEATHER_PREFETCH_TIMEOUT_MS = 5000;

function agentIdFromSessionPath(sessionPath) {
  const match = String(sessionPath || "").match(/[\\/]agents[\\/]([^\\/]+)[\\/]sessions[\\/]/i);
  return match ? match[1] : "";
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

export function attachInject(ctx, record = () => {}) {
  const handlers = { before_agent_start: [], message_end: [] };
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
      const agentId = agentIdFromSessionPath(sessionPath);
      const snapshot = await readEntriesSnapshot(ctx, sessionId);
      // 天气预取：缓存过期时不拿旧的冒充、也不干等下一轮，先花几秒补一次再组装。
      // 这样刚开机或久未开口时的第一句话也能带上「窗外」。
      try {
        await prefetchWeather(ctx);
      } catch (error) {
        logWarn(`天气预取失败：${String(error?.message || error || "").slice(0, 200)}`);
      }
      const legacyCtx = {
        dataDir: ctx.dataDir,
        agentId,
        model: payload?.model || null,
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
            `注入命中: ${text.length} 字 | reason=${out?.message?.details?.reason || "?"} | 伙伴=${agentId || "?"} | 开头=${text.slice(0, 90).replace(/\s+/g, " ")}`
          );
          return { message: { role: "user", content: text } };
        }
      }
      record(`注入未命中: 伙伴=${agentId || "?"} 会话=${sessionId}`);
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
