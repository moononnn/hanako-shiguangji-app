/**
 * 拾光记 · 「她说做完了」就把它勾掉
 *
 * 一件事有两种来路，同一个动作、同一条规矩：
 *   1. 主对话里助手调工具 shiguangji_complete_todo；
 *   2. 茶话会（或其他获准 App）跨 App 调服务 todo/complete。
 *
 * 定位与判定是纯函数，落笔只有一处：data.updateEvent(id, { done: true })。
 * 剩下的事情（撤掉还没发出去的提醒、重新发布对外情境）走既有回调，不另搞一套。
 *
 * 三条纪律：
 *   1. **只勾完成，不改别的**。这里的接口不接受标题、日期、时间的写入。
 *   2. **只认调用者**。跨 App 入口默认关闭，进来的人还要在白名单里。
 *   3. **能重复调**。同一句"我做完了"被两遍说中，第二遍回"已经勾过了"，不重复写、不报错。
 */

import { dateKey, filterDueTodos, isTodoDue } from "./data.js";
import { isRecurringTodo } from "./todo-repeat.js";

export const TODO_COMPLETE_SERVICE = "todo/complete";

/** 允许改动待办的调用方。想再放一个 App，在这里加一行，并告诉她在权限页开开关。 */
const ALLOWED_CALLERS = new Set(["chahuahui"]);

const TEXT_LIMIT = 120;

/** 归一化标题：去空白与常见标点、大小写、全角半角差异，让"吃维生素 d"对得上"吃维生素d"。 */
export function normalizeTitle(value, maxLength = TEXT_LIMIT) {
  return String(value ?? "")
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[\s　]+/g, "")
    .replace(/[，。！？、,.!?;；:："'`~—\-_*·]/g, "")
    .slice(0, maxLength);
}

function todoOf(event) {
  return event && event.type === "todo" ? event : null;
}

/**
 * 在事件账本里找"她说的那一条"。
 * @returns {{status:"ok", event:object}|{status:"already-done", event:object}|{status:"ambiguous", candidates:object[]}|{status:"not-found", candidates:object[]}|{status:"empty"}}
 */
export function locateTodo(events, { id = "", title = "" } = {}) {
  const rows = (Array.isArray(events) ? events : []).map(todoOf).filter(Boolean);
  const wantedId = String(id || "").trim();
  if (wantedId) {
    const hit = rows.find((row) => String(row.id || "") === wantedId);
    if (!hit) return { status: "not-found", candidates: [] };
    return hit.done ? { status: "already-done", event: hit } : { status: "ok", event: hit };
  }
  const wanted = normalizeTitle(title);
  if (!wanted) return { status: "empty", candidates: [] };

  const exact = [];
  const loose = [];
  const doneExact = [];
  for (const row of rows) {
    const key = normalizeTitle(row.title);
    if (!key) continue;
    if (key === wanted) (row.done ? doneExact : exact).push(row);
    else if (key.includes(wanted) || wanted.includes(key)) {
      if (!row.done) loose.push(row);
    }
  }
  const pool = exact.length ? exact : loose;
  if (pool.length === 1) return { status: "ok", event: pool[0] };
  if (pool.length > 1) {
    return { status: "ambiguous", candidates: pool.slice(0, 5).map((row) => ({ id: row.id, title: row.title, date: row.date })) };
  }
  if (doneExact.length) return { status: "already-done", event: doneExact[0] };
  // 什么也没对上：把最近几条在办待办摆给她看，别只说一句"没找到"。
  return {
    status: "not-found",
    candidates: rows
      .filter((row) => !row.done)
      .sort((a, b) => String(b.date || "").localeCompare(String(a.date || "")) || String(a.id || "").localeCompare(String(b.id || "")))
      .slice(0, 5)
      .map((row) => ({ id: row.id, title: row.title, date: row.date })),
  };
}

/** 今天（含以前欠着的）该被关心的那几条，用于把"没找到"这句说得有用一点。 */
export function pendingTodosOnOrBefore(events, now = new Date()) {
  return filterDueTodos(events, now).filter((event) => !event.done && isTodoDue(event, now));
}

function publicView(event, extra = {}) {
  return {
    id: event.id,
    title: event.title,
    date: event.date,
    at: String(event.reminderStart || "").slice(0, 5),
    ...extra,
  };
}

/**
 * 勾掉一条待办。已勾的直接回"已经勾过"，这是幂等，不是错误。
 * 撤提醒与重新发布由调用方接既有回调；这里不吞它的失败，报给上层决定怎么说。
 */
export async function completeTodo({ data, id = "", title = "", now = new Date(), eventChanged = null, today = "" } = {}) {
  if (!data) throw new Error("拾光记数据层没接上");
  const rawEvents = data.listEvents();
  const lookupEvents = rawEvents.flatMap((event) => isRecurringTodo(event)
    ? filterDueTodos([event], now)
    : [event]);
  const direct = id ? data.getEvent(id) : null;
  const usableDirect = direct && !(isRecurringTodo(direct) && !direct.occurrenceDate) ? direct : null;
  const found = locateTodo(usableDirect ? [usableDirect] : lookupEvents, { id, title });
  if (found.status === "empty") return { ok: false, reason: "empty" };
  if (found.status === "not-found") {
    return { ok: false, reason: "not-found", candidates: found.candidates };
  }
  if (found.status === "ambiguous") {
    return { ok: false, reason: "ambiguous", candidates: found.candidates };
  }
  if (found.status === "already-done") {
    return { ok: true, alreadyDone: true, todo: publicView(found.event) };
  }
  const before = found.event;
  // locate 到落笔之间有可能被人点掉了；先看一眼再翻，不然 toggle 会把已完成翻回未完成。
  const live = data.getEvent(before.id);
  if (!live) return { ok: false, reason: "not-found", candidates: [] };
  if (live.done) return { ok: true, alreadyDone: true, todo: publicView(live) };
  // 用既有的 toggle：此刻确认是未勾的，翻过去就是"完成了"。
  // 不给 updateEvent 另开一条写 done 的路，少一条能写歪的口子。
  const updated = await data.toggleTodo(before.id);
  if (!updated) throw new Error("这条待办刚刚不在了，再看一眼再试");
  let reminderWarning = "";
  if (typeof eventChanged === "function") {
    try {
      await eventChanged(updated);
    } catch (error) {
      // 待办已经勾掉了，撤不掉提醒计划也不能把已完成说成失败。
      reminderWarning = `；但「${updated.title}」的提醒还没撤下来，稍后会自动重试`;
    }
  }
  return {
    ok: true,
    alreadyDone: false,
    todo: publicView(updated, { completedOn: today || dateKey(now) }),
    reminderWarning,
  };
}

/**
 * 跨 App 入口：茶话会在聊天里听见她说"我做完了"，从这里勾掉。
 * 装载期不调用任何受保护接口——服务注册本身不需要授权以外的宿主查询。
 */
export function registerTodoCompleteService({ ctx, data, eventChanged = null, log = null } = {}) {
  if (typeof ctx?.bus?.handle !== "function") {
    log?.warn?.("[拾光记] 跨 App 完成服务没挂上：宿主没有 bus.handle");
    return null;
  }
  const release = ctx.bus.handle(TODO_COMPLETE_SERVICE, async (payload = {}, caller = {}) => {
    if (caller?.signal?.aborted) throw new Error("这次勾选已经取消了。");
    const callerAppId = String(caller?.callerAppId || "").trim();
    if (!ALLOWED_CALLERS.has(callerAppId)) {
      log?.warn?.(`[拾光记] 拒绝了 ${callerAppId || "匿名调用方"} 的完成请求`);
      throw new Error("这个应用没有得到改动拾光记的许可。");
    }
    log?.info?.(`[拾光记] 收到 ${callerAppId} 的完成请求：${JSON.stringify(payload || {}).slice(0, 120)}`);
    const now = new Date();
    const result = await completeTodo({
      data,
      id: payload?.id,
      title: payload?.title,
      now,
      eventChanged,
      today: dateKey(now),
    });
    log?.info?.(
      result.ok
        ? `[拾光记] ${callerAppId} 勾掉了「${result.todo?.title}」${result.alreadyDone ? "（本来已勾）" : ""}`
        : `[拾光记] ${callerAppId} 的完成请求没对上：${result.reason}`,
    );
    return result;
  }, { allowCrossApp: true });
  log?.info?.(`[拾光记] 跨 App 完成服务已挂上：${TODO_COMPLETE_SERVICE}`);
  return release;
}
