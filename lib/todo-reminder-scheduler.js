// 拾光记 · 待办到点调度器
// v2 App 使用 Hana TaskRegistry 持久化 runAt；旧插件 mock 路径保留 30 秒扫描兼容。
// 两条路径共用同一份加密送达状态；App 缺少公开能力时明确停用，不回退旧接口。
// 文件预算豁免：TaskRegistry、旧宿主退回扫描和送达状态必须共用同一调度边界。

import {
  TODO_REMINDER_TASK_TYPE,
  TODO_REMINDER_POLL_INTERVAL_MS,
  TODO_REMINDER_RETRY_DELAY_MS,
  buildTodoReminderPayload,
  isReminderDelivered,
  reminderStateForKey,
  todoReminderKey,
  todoReminderRunAt,
  todoReminderScheduleId,
} from "./todo-reminder.js";
import { readHanaUserName } from "./user-name.js";

const PLUGIN_ID = "shiguangji";
const BUS_REQUEST_TIMEOUT_MS = 8 * 1000;
const SESSION_CREATE_TIMEOUT_MS = 15 * 1000;
const NOTIFICATION_TIMEOUT_MS = 3 * 1000;
const APP_REMINDER_CAPABILITIES = [
  "app/tasks.manage",
  "app/notifications.show",
];

let sharedTodoReminderScheduler = null;

function errorText(error) {
  const code = text(error?.code);
  const message = text(error?.message || error);
  return [code, message].filter(Boolean).join(": ") || "未知错误";
}

function isCapabilityFailure(error) {
  return /capability|permission|not.granted|not.declared|denied/i.test(errorText(error));
}

function capabilityFromError(error, fallback) {
  return errorText(error).match(/app\/[a-z0-9][a-z0-9./-]*/i)?.[0] || fallback;
}

function withTimeout(promise, ms, label) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${label}超时（${ms}ms）`)), ms);
    Promise.resolve(promise).then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

function text(value) {
  return typeof value === "string" ? value.trim() : "";
}

function sessionFromResult(result) {
  const value = result?.session && typeof result.session === "object" ? result.session : result;
  if (!value || typeof value !== "object") return null;
  const sessionId = text(value.sessionId || value.id || value.sessionRef?.sessionId);
  const sessionPath = text(value.sessionPath || value.path || value.sessionRef?.sessionPath || value.sessionRef?.path);
  const agentId = text(value.agentId || value.session?.agentId);
  if (!sessionId && !sessionPath) return null;
  return {
    ...(sessionId ? { sessionId } : {}),
    ...(sessionPath ? { sessionPath } : {}),
    ...(agentId ? { agentId } : {}),
  };
}

function safeAgentList(result) {
  return Array.isArray(result?.agents) ? result.agents.filter((item) => item && typeof item === "object") : [];
}

function isPublicAgent(agent) {
  const visibility = text(agent?.visibility).toLowerCase();
  return visibility !== "private" && visibility !== "plugin_private";
}

function shortTitle(value) {
  return text(value).replace(/\s+/g, " ").slice(0, 64) || "一件待办";
}

function samePlan(a, b) {
  return !!a && !!b && a.key === b.key && a.runAt === b.runAt && a.scheduleId === b.scheduleId;
}

function notificationText(value, limit) {
  const source = text(value);
  if (Buffer.byteLength(source, "utf8") <= limit) return source;
  let result = "", bytes = 0;
  for (const character of source) {
    const size = Buffer.byteLength(character, "utf8");
    if (bytes + size > limit - 3) break;
    result += character; bytes += size;
  }
  return result + "…";
}

export class TodoReminderScheduler {
  constructor({ ctx, data, now = () => Date.now(), log = ctx?.log, banner = null } = {}) {
    this.ctx = ctx || {};
    this.data = data;
    this.now = now;
    this.log = log || this.ctx?.logger || {};
    // 到点横幅（输入框上方那条）由外面注入；不注入就只走系统通知，测试不碰宿主。
    this.banner = banner;
    this.mode = "idle"; // idle | task | poll | disabled
    this.ready = null;
    this.appReady = null;
    this.appRuntime = false;
    this.scheduleRestoreComplete = false;
    this.scheduleRestorePromise = null;
    this.appScheduleRequests = new Map();
    this.pollTimer = null;
    this.retryTimers = new Map();
    this.inFlight = new Set();
    this.knownPlans = new Map();
    this.refreshQueue = Promise.resolve();
    this.agentIdPromise = null;
  }

  start() {
    if (this.appRuntime) return this.appReady || Promise.resolve(false);
    if (this.ready) return this.ready;
    const looksLikeAppContext = !!(this.ctx?.tasks || this.ctx?.notifications || this.ctx?.appId
      || (this.ctx?.logger && !this.ctx?.log));
    if (looksLikeAppContext) {
      this.mode = "disabled";
      this.ready = Promise.resolve(false);
      this.log?.warn?.("[拾光记] v2 App 必须由主入口调用 registerAppTaskHandler()；若公开 ctx.tasks API 缺失则停用，不启用旧接口回退");
      return this.ready;
    }
    this.ready = this.startInternal().catch((error) => {
      this.log?.warn?.("[拾光记] 待办提醒调度器启动失败：", error?.message || error);
      this.mode = "disabled";
    });
    return this.ready;
  }

  registerAppTaskHandler() {
    if (this.appReady) return this.appReady;
    this.appRuntime = true;
    this.appReady = this.registerAppTaskHandlerInternal().catch((error) => {
      this.mode = "disabled";
      this.log?.warn?.("[拾光记] v2 待办提醒处理器注册失败；未启用旧接口回退：", errorText(error));
      return false;
    });
    return this.appReady;
  }

  async registerAppTaskHandlerInternal() {
    const tasks = this.ctx?.tasks;
    if (typeof tasks?.registerHandler !== "function") {
      this.mode = "disabled";
      this.log?.warn?.("[拾光记] v2 App 缺少公开 ctx.tasks.registerHandler；待办提醒已停用，未启用旧接口回退");
      return false;
    }
    for (const method of ["listSchedules", "schedule", "updateSchedule", "unschedule"]) {
      if (typeof tasks[method] !== "function") {
        this.mode = "disabled";
        this.log?.warn?.(`[拾光记] v2 App 缺少公开 ctx.tasks.${method}；待办提醒已停用，未启用旧接口回退`);
        return false;
      }
    }

    await withTimeout(Promise.resolve(tasks.registerHandler.call(tasks, TODO_REMINDER_TASK_TYPE, {
      run: ({ input } = {}) => this.runAppTask(input),
    })), BUS_REQUEST_TIMEOUT_MS, "ctx.tasks.registerHandler");
    this.mode = "task";
    this.scheduleRestoreComplete = false;
    return true;
  }

  // 主入口只登记处理器；授权查询和计划读取必须等装载完成后再执行。
  async restoreAppSchedules() {
    if (!this.appRuntime || this.mode !== "task") return false;
    await this.diagnoseAppCapabilities();
    try {
      await this.ensureAppSchedulesRestored();
      for (const [id, plan] of this.knownPlans) {
        if (!this.data.getEvent(id)) {
          try { await this.unschedule(plan.scheduleId); this.knownPlans.delete(id); }
          catch (error) { this.log?.warn?.(`[拾光记] 已删除记录的旧计划尚未清理：${errorText(error)}`); }
        }
      }
      for (const event of this.data.listEvents()) {
        const state = this.data.getTodoReminder(event.id);
        if (state?.notificationState === "sending" && !this.inFlight.has(event.id)) {
          try {
            await this.data.saveTodoReminder(event.id, { ...state, status: "notification-unknown",
              notificationState: "unknown", nextRetryAt: 0, lastError: "进程中断，无法确认上次通知是否发出；不自动重发" });
          } catch (error) { this.log?.warn?.(`[拾光记] 单条未结算状态恢复失败，继续其他记录：${errorText(error)}`); }
        }
      }
      // 带明确时间的账本记录来自用户已提交的提醒意图；装载后对账补缺。
      await this.refreshAll();
      this.restoreRetryTimers();
      return true;
    } catch (error) {
      this.log?.warn?.("[拾光记] v2 待办计划恢复失败；不会改走旧 task 总线或轮询：", errorText(error));
      return false;
    }
  }

  async diagnoseAppCapabilities() {
    if (typeof this.ctx?.bus?.request !== "function") return;
    try {
      const result = await this.requestBus("app:capabilities", {}, BUS_REQUEST_TIMEOUT_MS);
      const capabilities = Array.isArray(result?.capabilities) ? result.capabilities : [];
      for (const capability of APP_REMINDER_CAPABILITIES) {
        const item = capabilities.find((entry) => entry?.capability === capability);
        if (!item || ["denied", "not_asked"].includes(String(item.status || ""))) {
          const status = item?.status || "未查询到授权记录";
          const label = capability === "app/tasks.manage" ? "管理后台任务" : "显示系统通知";
          this.log?.warn?.(`[拾光记] 待办提醒需「${label}」（${capability}）；请到「设置 → 应用 → 应用权限 → 拾光记」允许。当前状态：${status}`);
        }
      }
    } catch (error) {
      this.log?.warn?.("[拾光记] 无法读取待办提醒能力授权状态；不会尝试申请或绕过审批：", errorText(error));
    }
  }

  async ensureAppSchedulesRestored() {
    if (this.scheduleRestoreComplete) return;
    if (this.scheduleRestorePromise) return this.scheduleRestorePromise;
    this.scheduleRestorePromise = (async () => {
      const tasks = this.ctx?.tasks;
      if (typeof tasks?.listSchedules !== "function") throw new Error("ctx.tasks.listSchedules 不可用");
      const result = await withTimeout(Promise.resolve(tasks.listSchedules.call(tasks)), BUS_REQUEST_TIMEOUT_MS, "ctx.tasks.listSchedules");
      const schedules = Array.isArray(result) ? result : (Array.isArray(result?.schedules) ? result.schedules : []);
      this.knownPlans.clear();
      for (const schedule of schedules) {
        if (schedule?.handlerKey !== TODO_REMINDER_TASK_TYPE || schedule?.enabled === false) continue;
        const payload = schedule?.payload && typeof schedule.payload === "object" ? schedule.payload : {};
        const eventId = text(payload.eventId);
        const key = text(payload.key);
        const runAt = Number(payload.runAt ?? schedule.runAt ?? schedule.nextRunAt);
        const scheduleId = text(schedule.scheduleId);
        if (!eventId || !key || !scheduleId || !Number.isFinite(runAt)) continue;
        const existing = this.knownPlans.get(eventId);
        const savedId = text(this.data?.getTodoReminder?.(eventId)?.scheduleId);
        if (!existing || scheduleId === savedId) this.knownPlans.set(eventId, { key, runAt, scheduleId });
      }
      this.scheduleRestoreComplete = true;
    })();
    try {
      await this.scheduleRestorePromise;
    } finally {
      this.scheduleRestorePromise = null;
    }
  }

  restoreRetryTimers() {
    if (!this.data || typeof this.data.listEvents !== "function") return;
    for (const event of this.data.listEvents()) {
      const id = text(event?.id);
      const state = id ? this.data.getTodoReminder(id) : null;
      const retryAt = Number(state?.nextRetryAt) || 0;
      if (!id || state?.key !== todoReminderKey(event) || state?.status !== "pending" || retryAt <= this.now()) continue;
      const plan = this.knownPlans.get(id);
      if (!plan || plan.key !== state.key || plan.runAt !== retryAt) this.armRetryTimer(id, retryAt);
    }
  }

  async runAppTask(input) {
    const payload = input?.payload && typeof input.payload === "object" ? input.payload : input;
    if (!payload || typeof payload !== "object") return { skipped: true, reason: "invalid-input" };
    const runAt = Number(payload.runAt);
    return this.runScheduled({ payload, ...(Number.isFinite(runAt) ? { nextRunAt: runAt } : {}) });
  }

  async startInternal() {
    // 送达需要“新会话 + 可定位的系统弹窗通知”两个能力；路由单元测试和旧的极简宿主
    // 只有 request 时，不把普通模型调用误当成调度能力。
    if (!this.data || typeof this.ctx?.bus?.request !== "function" || typeof this.ctx?.bus?.emit !== "function") {
      this.mode = "disabled";
      return;
    }

    try {
      const result = await this.requestBus("task:register-handler", {
        type: TODO_REMINDER_TASK_TYPE,
        abort: (schedule) => this.abortSchedule(schedule),
        run: (schedule) => this.runScheduled(schedule),
      }, BUS_REQUEST_TIMEOUT_MS);
      if (result?.ok !== true) throw new Error("宿主没有确认待办调度处理器");
      this.mode = "task";
      await this.refreshNow();
    } catch (error) {
      // TaskRegistry 是较新的宿主能力；不能让它的缺失挡住旧 Hana 的待办功能。
      this.log?.warn?.("[拾光记] 宿主调度不可用，改用 30 秒补扫：", error?.message || error);
      this.mode = "poll";
      this.startPoller();
      await this.refreshNow();
    }
  }

  startPoller() {
    if (this.pollTimer) return;
    this.pollTimer = setInterval(() => {
      this.refreshAll().catch((error) => {
        this.log?.warn?.("[拾光记] 待办提醒补扫失败：", error?.message || error);
      });
    }, TODO_REMINDER_POLL_INTERVAL_MS);
    this.pollTimer.unref?.();
  }

  eventChanged(event, removedId = "") {
    const id = text(event?.id || removedId);
    if (this.appRuntime) {
      if (this.mode !== "task") {
        return Promise.reject(new Error("v2 待办调度器尚未就绪；主入口必须先注册公开 Task handler"));
      }
      return this.refreshAll(id ? { onlyId: id } : {}).catch((error) => {
        const message = `[拾光记] v2 待办调度更新失败；计划管理要求 manifest 声明并获授 app/tasks.manage：${errorText(error)}`;
        this.log?.warn?.(message);
        throw new Error(message, { cause: error });
      });
    }
    return this.start()
      .then(() => this.refreshAll(id ? { onlyId: id } : {}))
      .catch((error) => {
        this.log?.warn?.("[拾光记] 待办调度更新失败：", errorText(error));
        return false;
      });
  }

  refreshAll(options = {}) {
    const next = this.refreshQueue
      .catch(() => {})
      .then(() => this.refreshNow(options));
    this.refreshQueue = next.catch(() => {});
    return next;
  }

  async refreshNow({ onlyId = "" } = {}) {
    if (this.mode === "idle") return;
    const events = onlyId
      ? [this.data.getEvent(onlyId)].filter(Boolean)
      : this.data.listEvents();
    for (const event of events) {
      try { await this.syncEvent(event); }
      catch (error) {
        if (onlyId || !this.appRuntime) throw error;
        this.log?.warn?.(`[拾光记] 单条提醒对账未完成，继续其他记录：${errorText(error)}`);
      }
    }
    if (onlyId && !this.data.getEvent(onlyId)) await this.syncRemovedEvent(onlyId);
  }

  async syncEvent(event) {
    const id = text(event?.id);
    if (!id) return;
    if (this.appRuntime) return this.syncAppEvent(event);
    const key = todoReminderKey(event);
    const scheduleId = todoReminderScheduleId(id);
    const previous = this.data.getTodoReminder(id);

    // 只有「未完成、一次性、已填具体时间」的待办会进入主动提醒。
    // 无时间的旧待办仍保留在日历里，等用户编辑补齐时间。
    if (!key || event.done || event.repeatYearly) {
      if (this.mode === "task" && previous?.scheduleId) {
        await this.unschedule(previous.scheduleId);
      }
      this.knownPlans.delete(id);
      this.clearRetryTimer(id);
      if (event.type !== "todo" && previous) await this.data.removeTodoReminder(id);
      return;
    }

    const scheduleState = reminderStateForKey(previous, key, scheduleId);
    const keyChanged = !!previous && previous.key !== key;
    const state = await this.persistNormalizedState(id, previous, scheduleState);
    if (isReminderDelivered(state, key)) {
      if (this.mode === "task") await this.unschedule(state.scheduleId || scheduleId);
      this.knownPlans.delete(id);
      this.clearRetryTimer(id);
      return;
    }

    const retryAt = Number(state.nextRetryAt) || 0;
    const now = this.now();
    const runAt = retryAt > now ? retryAt : todoReminderRunAt(event, now);
    if (runAt === null) return;

    if (this.mode === "poll") {
      if (runAt <= now + 20 && (!retryAt || retryAt <= now)) {
        await this.deliverEvent(event, state);
      } else if (retryAt > now) {
        this.armRetryTimer(id, retryAt);
      }
      return;
    }
    if (this.mode !== "task") return;

    const plan = { key, runAt, scheduleId };
    const known = this.knownPlans.get(id);
    // 首次接管、时间被编辑、或 key 变化时先撤掉旧的一次性计划；否则宿主会保留旧 nextRunAt。
    if (keyChanged || !known) await this.unschedule(scheduleId);
    if (samePlan(known, plan)) return;

    const result = await this.requestBus("task:schedule", {
      scheduleId,
      type: TODO_REMINDER_TASK_TYPE,
      pluginId: this.pluginId,
      payload: { eventId: id, key },
      meta: { source: "shiguangji", kind: "todo-reminder" },
      runAt,
      enabled: true,
    }, BUS_REQUEST_TIMEOUT_MS);
    if (result?.ok !== true) throw new Error("宿主没有确认待办提醒计划");
    this.knownPlans.set(id, plan);
  }

  async syncAppEvent(event) {
    const id = text(event?.id);
    if (!id) return;
    const pendingRequest = this.appScheduleRequests.get(id);
    if (pendingRequest) {
      const currentKey = todoReminderKey(event), previous = this.data.getTodoReminder(id);
      if (isReminderDelivered(previous, currentKey)) return;
      if (currentKey && currentKey !== pendingRequest.key) {
        await this.data.saveTodoReminder(id, { ...reminderStateForKey(previous, currentKey, ""), planState: "waiting",
          lastError: "上一条提醒安排仍在处理，当前新时间会稍后重试", nextRetryAt: this.now() + TODO_REMINDER_RETRY_DELAY_MS });
      }
      throw new Error("上次提醒安排仍在处理中，不重复创建");
    }
    await this.ensureAppSchedulesRestored();

    const previous = this.data.getTodoReminder(id);
    const known = this.knownPlans.get(id);
    const key = todoReminderKey(event);
    if (!key || event.done || event.repeatYearly) {
      if (known?.scheduleId) await this.unschedule(known.scheduleId);
      this.knownPlans.delete(id);
      this.clearRetryTimer(id);
      if (event.type !== "todo" && previous) await this.data.removeTodoReminder(id);
      return;
    }

    if (previous?.notificationState === "sending" && this.inFlight.has(id) && previous.key === key) return;
    const state = await this.persistNormalizedState(
      id,
      previous,
      reminderStateForKey(previous, key, known?.scheduleId || ""),
    );
    if (state.planState === "unknown" && !known?.scheduleId) throw new Error("提醒安排结果尚未确认，请手动确认后重试");
    if (isReminderDelivered(state, key) || state.status === "notification-unknown") {
      if (known?.scheduleId) await this.unschedule(known.scheduleId);
      this.knownPlans.delete(id);
      this.clearRetryTimer(id);
      return;
    }

    const retryAt = Number(state.nextRetryAt) || 0;
    const runAt = retryAt > this.now() ? retryAt : todoReminderRunAt(event, this.now());
    if (runAt === null) return;
    const plan = { key, runAt, scheduleId: known?.scheduleId || "" };
    if (samePlan(known, plan)) {
      if (state.scheduleId !== known.scheduleId || state.planState !== "scheduled") {
        await this.data.saveTodoReminder(id, { ...state, scheduleId: known.scheduleId, planState: "scheduled",
          lastError: state.notificationState === "failed" ? state.lastError : "" });
      }
      return;
    }

    const payload = { eventId: id, key, runAt };
    const label = "拾光记待办提醒";
    let result;
    try {
      const operation = known?.scheduleId
        ? () => this.ctx.tasks.updateSchedule.call(this.ctx.tasks, known.scheduleId, { payload, label, runAt })
        : () => this.ctx.tasks.schedule.call(this.ctx.tasks, { handlerKey: TODO_REMINDER_TASK_TYPE, scope: "app", label, payload, runAt, enabled: true });
      result = await this.appScheduleCall(id, operation, key);
    } catch (error) {
      const uncertain = /timeout|timed.out|超时|peer.closed|disconnected|UNKNOWN/i.test(errorText(error));
      this.scheduleRestoreComplete = false;
      const live = this.data.getEvent(id), current = this.data.getTodoReminder(id);
      if (live && todoReminderKey(live) === key && current?.key === key && !isReminderDelivered(current, key)) {
        const executionObserved = current.lastAttemptAt && (current.lastAttemptAt !== state.lastAttemptAt || current.attempts !== state.attempts);
        await this.data.saveTodoReminder(id, { ...current,
          planState: executionObserved ? current.planState : uncertain ? "unknown" : "failed",
          lastError: executionObserved ? current.lastError : `提醒安排${uncertain ? "结果未确认" : "失败"}：${errorText(error).slice(0, 200)}`,
          nextRetryAt: executionObserved ? current.nextRetryAt : uncertain ? 0 : this.now() + TODO_REMINDER_RETRY_DELAY_MS });
      }
      throw error;
    }
    const schedule = result?.schedule && typeof result.schedule === "object" ? result.schedule : result;
    const scheduleId = text(schedule?.scheduleId) || text(known?.scheduleId);
    if (!scheduleId) throw new Error("ctx.tasks.schedule 没有返回 scheduleId");

    const nextPlan = { key, runAt, scheduleId };
    this.knownPlans.set(id, nextPlan);
    const currentEvent = this.data.getEvent(id);
    if (!currentEvent || todoReminderKey(currentEvent) !== key) {
      await this.unschedule(scheduleId);
      this.knownPlans.delete(id);
      return;
    }
    const currentState = this.data.getTodoReminder(id);
    const saved = currentState?.key === key ? currentState : state;
    if (saved.lastAttemptAt && (saved.lastAttemptAt !== state.lastAttemptAt || saved.attempts !== state.attempts)) {
      // 回调已运行，创建回包不是“计划仍活跃”的证据；下次先核宿主实物。
      this.knownPlans.delete(id);
      this.scheduleRestoreComplete = false;
      await this.data.saveTodoReminder(id, { ...saved, scheduleId: "",
        planState: isReminderDelivered(saved, key) ? "completed" : "reconcile" });
      return;
    }
    await this.data.saveTodoReminder(id, { ...saved, scheduleId, planState: "scheduled",
      lastError: saved.notificationState === "failed" || saved.status === "notification-unknown" ? saved.lastError : "" });
  }

  async appScheduleCall(id, operation, key) {
    const request = Promise.resolve().then(operation);
    this.appScheduleRequests.set(id, { request, key });
    let timedOut = false;
    const settled = () => {
      if (this.appScheduleRequests.get(id)?.request === request) this.appScheduleRequests.delete(id);
      if (timedOut) this.scheduleRestoreComplete = false; // 迟到回包后必须重新列出宿主实物。
    };
    request.then(settled, settled);
    try { return await withTimeout(request, BUS_REQUEST_TIMEOUT_MS, "提醒计划安排"); }
    catch (error) { timedOut = true; throw error; }
  }

  async syncRemovedEvent(id) {
    const key = text(id);
    if (!key) return;
    if (this.appRuntime && this.appScheduleRequests.has(key)) throw new Error("记录已删除，迟到的提醒安排结果尚未确认；恢复对账会继续清理");
    const state = this.data.getTodoReminder(key);
    if (this.appRuntime) {
      await this.ensureAppSchedulesRestored();
      const known = this.knownPlans.get(key);
      if (known?.scheduleId) await this.unschedule(known.scheduleId);
    } else if (this.mode === "task") {
      await this.unschedule(state?.scheduleId || todoReminderScheduleId(key));
    }
    this.knownPlans.delete(key);
    this.clearRetryTimer(key);
    if (state) await this.data.removeTodoReminder(key);
  }

  async persistNormalizedState(id, previous, normalized) {
    const current = previous && typeof previous === "object" ? previous : null;
    const inFlight = this.inFlight.has(id);
    let next = normalized;
    if (inFlight && current?.status === "sending" && current.key === normalized.key) {
      next = { ...normalized, status: "sending" };
    }
    const currentJson = current ? JSON.stringify(current) : "";
    if (!current || currentJson !== JSON.stringify(next)) {
      return this.data.saveTodoReminder(id, next);
    }
    return current;
  }

  async runScheduled(schedule) {
    const eventId = text(schedule?.payload?.eventId);
    const scheduledKey = text(schedule?.payload?.key);
    if (!eventId) return { skipped: true, reason: "missing-event" };
    const nextRunAt = Number(schedule?.nextRunAt);
    if (Number.isFinite(nextRunAt) && nextRunAt > this.now() + 20) {
      return { skipped: true, reason: "early-plan" };
    }
    this.knownPlans.delete(eventId);
    const event = this.data.getEvent(eventId);
    if (!event || todoReminderKey(event) !== scheduledKey || event.done || event.repeatYearly) {
      return { skipped: true, reason: "stale-plan" };
    }
    let state = this.data.getTodoReminder(eventId);
    if (this.appRuntime && state?.planState === "unknown" && state.key === scheduledKey) {
      state = { ...state, planState: "scheduled" }; // 有效宿主回调证明计划确已创建。
      await this.data.saveTodoReminder(eventId, state);
    }
    if (isReminderDelivered(state, scheduledKey)) return { skipped: true, reason: "already-delivered" };
    if (Number(state?.nextRetryAt) > this.now()) return { skipped: true, reason: "retry-backoff" };
    if (this.appRuntime && this.inFlight.has(eventId)) {
      // 旧 key 的通知仍在途时，新 key 的单次任务不能被白白消耗。
      await this.data.saveTodoReminder(eventId, { ...reminderStateForKey(state, scheduledKey, ""),
        nextRetryAt: this.now() + TODO_REMINDER_RETRY_DELAY_MS });
      await this.refreshAll({ onlyId: eventId });
      return { delivered: false, deferred: true };
    }
    await this.deliverEvent(event, state);
    const delivered = isReminderDelivered(this.data.getTodoReminder(eventId), scheduledKey);
    if (!delivered && this.appRuntime) {
      const currentEvent = this.data.getEvent(eventId);
      const currentState = this.data.getTodoReminder(eventId);
      if (currentEvent && todoReminderKey(currentEvent) === scheduledKey
        && currentState?.status === "pending" && Number(currentState.nextRetryAt) > this.now()) {
        try {
          await this.refreshAll({ onlyId: currentEvent.id });
        } catch (error) {
          this.log?.warn?.("[拾光记] v2 待办重试计划创建失败；将在进程内保留超时重试：", errorText(error));
          this.armRetryTimer(eventId, Number(currentState.nextRetryAt));
        }
      }
    }
    return { delivered };
  }

  abortSchedule(schedule) {
    const eventId = text(schedule?.payload?.eventId);
    if (!eventId) return;
    this.clearRetryTimer(eventId);
    this.knownPlans.delete(eventId);
  }

  async deliverEvent(event, state) {
    if (this.appRuntime) return this.deliverAppNotification(event, state);
    const id = text(event?.id);
    const key = todoReminderKey(event);
    if (!id || !key || this.inFlight.has(id)) return false;
    if (isReminderDelivered(state, key)) return true;
    this.inFlight.add(id);
    let target = null;
    let baseState = null;
    let deliveryStage = "定位目标会话";
    try {
      const liveEvent = this.data.getEvent(id);
      if (!liveEvent || todoReminderKey(liveEvent) !== key || liveEvent.done || liveEvent.repeatYearly) return false;
      const liveState = this.data.getTodoReminder(id);
      if (liveState?.key && liveState.key !== key) return false;
      const base = reminderStateForKey(liveState || state, key, this.appRuntime ? "" : todoReminderScheduleId(id));
      baseState = base;
      target = await this.ensureSession(liveEvent, base);
      // 用户可能在建会话期间编辑/删除了待办；旧请求不能覆盖新 key 的状态。
      const beforeSendEvent = this.data.getEvent(id);
      const beforeSendState = this.data.getTodoReminder(id);
      if (!beforeSendEvent || todoReminderKey(beforeSendEvent) !== key || beforeSendEvent.done || beforeSendEvent.repeatYearly) return false;
      if (beforeSendState?.key && beforeSendState.key !== key) return false;
      const attempts = (Number(base.attempts) || 0) + 1;
      const attemptTime = this.now();
      const sending = {
        ...base,
        ...target,
        status: "sending",
        attempts,
        lastAttemptAt: new Date(attemptTime).toISOString(),
        nextRetryAt: 0,
        lastError: "",
      };
      await this.data.saveTodoReminder(id, sending);

      const reminderName = readHanaUserName();
      const payload = buildTodoReminderPayload(beforeSendEvent, {
        userName: reminderName,
        now: new Date(attemptTime),
      });
      const sendPayload = {
        text: this.appRuntime
          ? `${payload.text}\n请自然地提醒${reminderName || "对方"}去做「${shortTitle(beforeSendEvent.title)}」。不要提及这段提醒说明，也不要说事情已经完成。`
          : payload.text,
        ...(target.sessionId ? { sessionId: target.sessionId } : {}),
        ...(target.sessionPath ? { sessionPath: target.sessionPath } : {}),
      };
      if (!this.appRuntime) {
        sendPayload.context = {
          // 旧插件兼容路径使用隐藏回合上下文；v2 App 只发送 APPS.md 公开的字段。
          beforeUser: payload.beforeUser,
          metadata: {
            pluginId: this.pluginId,
            reminderId: id,
            kind: "todo-reminder",
          },
        };
      }
      deliveryStage = "session:send";
      const sent = await this.requestBus("session:send", sendPayload, BUS_REQUEST_TIMEOUT_MS);
      if (this.appRuntime ? sent?.accepted !== true : (sent?.ok === false || sent?.accepted === false)) {
        throw new Error(sent?.error || (this.appRuntime ? "宿主没有返回 accepted: true" : "宿主没有接受待办提醒消息"));
      }

      const deliveredAt = new Date(this.now()).toISOString();
      const afterSendEvent = this.data.getEvent(id);
      const afterSendState = this.data.getTodoReminder(id);
      if (!afterSendEvent || todoReminderKey(afterSendEvent) !== key || (afterSendState?.key && afterSendState.key !== key)) {
        if (afterSendState?.key === key) await this.data.removeTodoReminder(id);
        return true;
      }
      await this.data.saveTodoReminder(id, {
        ...sending,
        status: "delivered",
        sentAt: deliveredAt,
        deliveredAt,
        nextRetryAt: 0,
        lastError: "",
      });
      this.clearRetryTimer(id);
      await this.emitNotification(payload, target);
      this.log?.info?.(`[拾光记] 待办已提醒：${event.title}`);
      return true;
    } catch (error) {
      const current = this.data.getTodoReminder(id);
      const liveEvent = this.data.getEvent(id);
      const retryState = current?.key === key ? current : (!current && baseState?.key === key ? baseState : null);
      // 编辑/删除时旧请求可能还在路上，不能让旧失败回写覆盖新时间或残留状态。
      if (retryState && liveEvent && todoReminderKey(liveEvent) === key) {
        const nextRetryAt = this.now() + TODO_REMINDER_RETRY_DELAY_MS;
        await this.data.saveTodoReminder(id, {
          ...retryState,
          status: "pending",
          nextRetryAt,
          lastError: errorText(error).slice(0, 300),
          ...(target || {}),
        });
        if (!this.appRuntime) this.armRetryTimer(id, nextRetryAt);
      }
      const capability = this.appRuntime && isCapabilityFailure(error)
        ? capabilityFromError(error, deliveryStage === "session:send" ? "app/session.start-turn" : "app/agents.read")
        : "";
      const capabilityHint = capability ? `；请确认 manifest 已声明并在「设置 → 应用权限」授予 ${capability}` : "";
      this.log?.warn?.(`[拾光记] 待办提醒失败，将在稍后重试：${event.title}${capabilityHint}`, errorText(error));
      return false;
    } finally {
      this.inFlight.delete(id);
    }
  }

  // App 的提醒只走原生通知，不开私有会话、不调用模型。
  async deliverAppNotification(event, previous) {
    const id = text(event?.id);
    const key = todoReminderKey(event);
    if (!id || !key || this.inFlight.has(id)) return false;
    if (isReminderDelivered(previous, key)) return true;
    this.inFlight.add(id);
    let sending = null;
    let notificationConfirmed = false;
    try {
      const live = this.data.getEvent(id);
      const state = this.data.getTodoReminder(id) || previous;
      if (!live || live.done || live.repeatYearly || todoReminderKey(live) !== key) return false;
      if (state?.key && state.key !== key) return false;
      if (state?.status === "notification-unknown") return false;
      if (state?.notificationState === "sending") {
        await this.data.saveTodoReminder(id, { ...state, status: "notification-unknown",
          notificationState: "unknown", nextRetryAt: 0, lastError: "上次发送未结算，不自动重发" });
        return false;
      }
      sending = { ...reminderStateForKey(state, key, ""), status: "sending",
        notificationState: "sending", attempts: (Number(state?.attempts) || 0) + 1,
        lastAttemptAt: new Date(this.now()).toISOString(), nextRetryAt: 0, lastError: "" };
      await this.data.saveTodoReminder(id, sending);
      // 写账过程中待办可能已改/删除，再核一次；旧请求不能替新记录发送。
      const current = this.data.getEvent(id);
      if (!current || current.done || todoReminderKey(current) !== key) return false;
      const payload = buildTodoReminderPayload(current, { userName: readHanaUserName(), now: new Date(this.now()) });
      const show = this.ctx?.notifications?.show;
      if (typeof show !== "function") throw new Error("原生通知不可用，请检查「显示系统通知」应用权限");
      const result = await withTimeout(Promise.resolve(show.call(this.ctx.notifications, {
        title: notificationText(payload.notificationTitle, 256), body: notificationText(payload.notificationBody, 4096),
      })), NOTIFICATION_TIMEOUT_MS, "系统通知");
      if (result?.shown !== true) {
        const error = new Error(result?.shown === false ? "宿主未发出通知" : "通知结果未确认");
        error.code = result?.shown === false ? "APP_NOTIFICATION_NOT_SHOWN" : "APP_NOTIFICATION_UNKNOWN";
        throw error;
      }
      notificationConfirmed = true;
      const after = this.data.getEvent(id);
      const afterState = this.data.getTodoReminder(id);
      if (!after || todoReminderKey(after) !== key || (afterState?.key && afterState.key !== key)) return true;
      const at = new Date(this.now()).toISOString();
      await this.data.saveTodoReminder(id, { ...sending, ...afterState, status: "delivered", notificationState: "confirmed",
        sentAt: at, deliveredAt: at, nextRetryAt: 0, lastError: "" });
      this.clearRetryTimer(id);
      // 顺手在她眼前的输入框上方也挂一条：系统通知飘一下就没了，这条挂得住。
      try { this.banner?.show?.({ title: after.title, window: payload.window, body: payload.notificationBody }); }
      catch (error) { this.log?.warn?.("[拾光记] 待办横幅挂载失败：", errorText(error)); }
      return true; // 确认发出，不代表操作系统一定展示横幅或用户已读。
    } catch (error) {
      const live = this.data.getEvent(id);
      const state = this.data.getTodoReminder(id);
      const unknown = notificationConfirmed || /timeout|timed.out|超时|UNKNOWN|未确认/i.test(errorText(error));
      if (sending && live && todoReminderKey(live) === key && (!state?.key || state.key === key)) {
        await this.data.saveTodoReminder(id, { ...sending, ...state,
          status: unknown ? "notification-unknown" : "pending",
          notificationState: notificationConfirmed ? "confirmed-unsettled" : unknown ? "unknown" : "failed",
          lastError: errorText(error).slice(0, 300),
          nextRetryAt: unknown ? 0 : this.now() + TODO_REMINDER_RETRY_DELAY_MS });
      }
      this.log?.warn?.(`[拾光记] 通知${notificationConfirmed ? "已发出但结算失败，不自动重发" : unknown ? "结果不明，不自动重发" : "未发出，稍后重试"}：${errorText(error)}`);
      return false;
    } finally { this.inFlight.delete(id); }
  }

  async retryNotification(event) {
    if (!this.appRuntime || !event || event.done) throw new Error("没有可重试的待办提醒");
    const state = this.data.getTodoReminder(event.id);
    if (state?.status === "sending" || this.inFlight.has(event.id)) throw new Error("提醒正在发送，请稍后再试");
    const key = todoReminderKey(event);
    await this.data.saveTodoReminder(event.id, { ...reminderStateForKey(state, key, ""),
      status: "pending", notificationState: "pending", planState: "pending", nextRetryAt: 0, deliveredAt: "", lastError: "" });
    try { return await this.eventChanged(event); }
    catch (error) {
      const live = this.data.getEvent(event.id), current = this.data.getTodoReminder(event.id);
      if (live && todoReminderKey(live) === key && current?.key === key
        && current.notificationState !== "sending" && !isReminderDelivered(current, key)) {
        await this.data.saveTodoReminder(event.id, { ...current, ...state, key,
          planState: state?.planState === "unknown" ? "unknown" : current.planState === "pending" ? (state?.planState || "failed") : current.planState,
          nextRetryAt: current.nextRetryAt ?? state?.nextRetryAt ?? 0,
          lastError: current.lastError || "重试安排未成功，原状态已保留" });
      }
      throw error;
    }
  }

  async ensureSession(event, state) {
    let target = {
      ...(text(state?.sessionId) ? { sessionId: text(state.sessionId) } : {}),
      ...(text(state?.sessionPath) ? { sessionPath: text(state.sessionPath) } : {}),
      ...(text(state?.agentId) ? { agentId: text(state.agentId) } : {}),
    };

    if ((!target.sessionId || !target.sessionPath) && (target.sessionId || target.sessionPath)) {
      try {
        const result = await this.requestBus("session:get", {
          ...(target.sessionId ? { sessionId: target.sessionId } : {}),
          ...(target.sessionPath ? { sessionPath: target.sessionPath } : {}),
        }, BUS_REQUEST_TIMEOUT_MS);
        target = { ...target, ...(sessionFromResult(result) || {}) };
      } catch {
        // 只缺一个定位字段时，继续用已有字段发送；宿主会给出最终裁决。
      }
    }
    // 当前宿主的 session:send 会用双定位校验；只剩一个字段时宁可新建，
    // 不把一条“请求成功但消息没落到会话里”的假送达写进状态。
    if (!(target.sessionId && target.sessionPath)) {
      target = target.agentId ? { agentId: target.agentId } : {};
    } else {
      return target;
    }

    const agentId = target.agentId || await this.resolveAgentId();
    if (!agentId) throw new Error("没有找到可接收提醒的助手");
    const createPayload = this.appRuntime
      ? { agentId }
      : {
        agentId,
        ownerPluginId: this.pluginId,
        visibility: "public",
        kind: "chat",
        memoryEnabled: true,
      };
    const created = await this.requestBus("session:create", createPayload, SESSION_CREATE_TIMEOUT_MS);
    const createdTarget = sessionFromResult(created);
    if (!createdTarget?.sessionId || !createdTarget?.sessionPath) {
      throw new Error("新对话没有同时返回 sessionId 和 sessionPath，已拒绝发送以保护目标定位");
    }
    const finalTarget = { ...createdTarget, agentId: createdTarget.agentId || agentId };

    // 宿主目前对 session:create 的 title 兼容并不一致，创建后单独改名。
    try {
      await this.requestBus("session:update", {
        ...(finalTarget.sessionId ? { sessionId: finalTarget.sessionId } : {}),
        ...(finalTarget.sessionPath ? { sessionPath: finalTarget.sessionPath } : {}),
        title: `拾光记 · 待办提醒 · ${shortTitle(event.title)}`,
      }, BUS_REQUEST_TIMEOUT_MS);
    } catch (error) {
      this.log?.debug?.("[拾光记] 待办提醒会话改名失败：", error?.message || error);
    }
    return finalTarget;
  }

  async resolveAgentId() {
    if (this.agentIdPromise) return this.agentIdPromise;
    this.agentIdPromise = (async () => {
      const direct = this.appRuntime ? "" : text(this.ctx?.agentId || this.ctx?.agent?.id);
      if (direct && direct !== this.pluginId) return direct;
      try {
        const result = await this.requestBus("agent:list", this.appRuntime
          ? { scope: "all", lifecycle: "active" }
          : { includePluginPrivate: false }, BUS_REQUEST_TIMEOUT_MS);
        const agents = safeAgentList(result).filter(isPublicAgent);
        const current = agents.find((agent) => agent.isCurrent === true);
        const primary = agents.find((agent) => agent.isPrimary === true);
        const hanako = agents.find((agent) => text(agent.id) === "hanako");
        const first = agents.find((agent) => text(agent.id));
        return text((current || primary || hanako || first)?.id);
      } catch (error) {
        if (this.appRuntime) {
          throw new Error(`读取可用伙伴失败；请确认 manifest 已声明并在「设置 → 应用权限」授予 app/agents.read：${errorText(error)}`, { cause: error });
        }
        this.log?.warn?.("[拾光记] 获取当前助手失败，回退 hanako：", error?.message || error);
        return "hanako";
      }
    })();
    try {
      return await this.agentIdPromise;
    } finally {
      this.agentIdPromise = null;
    }
  }

  async emitNotification(payload, target) {
    if (this.appRuntime) {
      const show = this.ctx?.notifications?.show;
      if (typeof show !== "function") {
        this.log?.warn?.("[拾光记] 消息已送达，但 v2 ctx.notifications.show 不可用；请核对 app/notifications.show，通知失败不会重发消息");
        return;
      }
      try {
        const result = await withTimeout(Promise.resolve(show.call(this.ctx.notifications, {
          title: payload.notificationTitle,
          body: payload.notificationBody,
        })), NOTIFICATION_TIMEOUT_MS, "ctx.notifications.show");
        if (result?.shown !== true) throw new Error("宿主没有返回 shown: true");
      } catch (error) {
        const detail = isCapabilityFailure(error)
          ? `；请确认 manifest 已声明并在「设置 → 应用权限」授予 app/notifications.show`
          : "";
        this.log?.warn?.(`[拾光记] 消息已送达，但系统通知未确认${detail}；不会重发消息：`, errorText(error));
      }
      return;
    }

    const emit = this.ctx?.bus?.emit;
    if (typeof emit !== "function") return;
    const sessionPath = text(target?.sessionPath);
    const event = {
      type: "notification",
      title: payload.notificationTitle,
      body: payload.notificationBody,
      agentId: text(target?.agentId) || null,
      desktopFocusPolicy: "always",
      openKind: "session",
      ...(sessionPath ? { sessionPath } : {}),
    };
    try {
      await withTimeout(Promise.resolve(emit.call(this.ctx.bus, event, sessionPath || null)), NOTIFICATION_TIMEOUT_MS, "系统弹窗通知");
    } catch (error) {
      // 系统弹窗通知失败不能把已经送进新对话的待办重新判成失败，否则会重复发消息。
      this.log?.warn?.("[拾光记] 系统弹窗通知没有显示：", error?.message || error);
    }
  }

  async unschedule(scheduleId) {
    const id = text(scheduleId);
    if (!id) return;
    if (this.appRuntime) {
      const tasks = this.ctx?.tasks;
      if (typeof tasks?.unschedule !== "function") throw new Error("ctx.tasks.unschedule 不可用（旧接口回退已禁用）");
      await withTimeout(Promise.resolve(tasks.unschedule.call(tasks, id)), BUS_REQUEST_TIMEOUT_MS, "ctx.tasks.unschedule");
      return;
    }
    if (typeof this.ctx?.bus?.request !== "function") return;
    try {
      await this.requestBus("task:unschedule", { scheduleId: id }, BUS_REQUEST_TIMEOUT_MS);
    } catch (error) {
      // 旧宿主没有 task:* 时由外层启动流程切到轮询；这里不阻塞事件保存。
      if (this.mode === "task") throw error;
    }
  }

  requestBus(typeName, payload, timeoutMs) {
    if (typeof this.ctx?.bus?.request !== "function") throw new Error("Hana 会话总线不可用");
    const request = this.ctx.bus.request(typeName, payload, { timeoutMs });
    return withTimeout(request, timeoutMs, typeName);
  }

  armRetryTimer(eventId, retryAt) {
    const id = text(eventId);
    if (!id) return;
    this.clearRetryTimer(id);
    const delay = Math.max(100, Number(retryAt) - this.now());
    const timer = setTimeout(() => {
      this.retryTimers.delete(id);
      const event = this.data.getEvent(id);
      if (event) this.refreshAll({ onlyId: id }).catch(() => {});
    }, delay);
    timer.unref?.();
    this.retryTimers.set(id, timer);
  }

  clearRetryTimer(eventId) {
    const id = text(eventId);
    const timer = this.retryTimers.get(id);
    if (timer) clearTimeout(timer);
    this.retryTimers.delete(id);
  }

  get pluginId() {
    return text(this.ctx?.pluginId) || PLUGIN_ID;
  }
}

export function setTodoReminderScheduler(scheduler) {
  sharedTodoReminderScheduler = scheduler || null;
  return sharedTodoReminderScheduler;
}

export function getTodoReminderScheduler() {
  return sharedTodoReminderScheduler;
}

export function __resetTodoReminderSchedulerForTest(scheduler) {
  if (!scheduler) return;
  if (sharedTodoReminderScheduler === scheduler) sharedTodoReminderScheduler = null;
  if (scheduler.pollTimer) clearInterval(scheduler.pollTimer);
  for (const timer of scheduler.retryTimers.values()) clearTimeout(timer);
  scheduler.pollTimer = null;
  scheduler.retryTimers.clear();
  scheduler.knownPlans.clear();
  scheduler.inFlight.clear();
}
