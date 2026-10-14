export const FOCUS_REMINDER_TASK_TYPE = "shiguangji-focus-end-reminder";

let sharedFocusReminderScheduler = null;
const TASK_TIMEOUT_MS = 8_000;
const NOTIFICATION_TIMEOUT_MS = 3_000;
const TIGEXING_NOTIFY_SERVICE = "app:tigexing-app/focus/notify";
const TIGEXING_NOTIFY_TIMEOUT_MS = 8_000;

const text = value => typeof value === "string" ? value.trim() : "";
function withTimeout(promise, label, timeoutMs = TASK_TIMEOUT_MS) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${label}超时`)), timeoutMs);
    Promise.resolve(promise).then(value => { clearTimeout(timer); resolve(value); }, error => { clearTimeout(timer); reject(error); });
  });
}
const schedulesOf = result => Array.isArray(result) ? result : Array.isArray(result?.schedules) ? result.schedules : [];
function isDeliveryOutcomeUnknown(error) {
  const code = String(error?.code || "").toLowerCase();
  const message = String(error?.message || error || "").toLowerCase();
  return error?.focusNotifyTimedOut === true || /timeout|timed out|aborted|cancelled|canceled|超时|中止|取消/.test(`${code} ${message}`);
}
function isFocusServiceDefinitelyUnavailable(error) {
  const code = String(error?.code || "").toLowerCase();
  const message = String(error?.message || error || "").toLowerCase();
  if (/app_not_installed|app_not_found|unknown_app|app_disabled|app_not_active|service_not_found|service_unavailable|handler_not_found|capability_denied|permission_denied|forbidden|unauthorized/.test(code)) return true;
  return /\b(service|handler)\b.{0,60}(not found|unavailable|not registered|disabled)/.test(message)
    || /\b(app|application)\b.{0,60}(not installed|not found|disabled|inactive)/.test(message)
    || /应用未安装|应用不存在|服务未注册|服务不可用|权限拒绝/.test(message);
}
function safeFocusNotifyErrorCode(error) {
  const code = String(error?.code || "");
  if (/^[A-Za-z0-9_.-]{1,64}$/.test(code)) return code;
  if (isDeliveryOutcomeUnknown(error)) return "outcome_unknown";
  if (isFocusServiceDefinitelyUnavailable(error)) return "service_unavailable";
  return "unknown";
}

export class FocusReminderScheduler {
  constructor({ ctx, data, log = ctx?.logger } = {}) {
    this.ctx = ctx || {};
    this.data = data;
    this.log = log || {};
    this.ready = null;
    this.queue = Promise.resolve();
    this.notificationRecoveryDone = false;
  }

  async notifyFocusEvent(payload, fallbackToast) {
    const request = this.ctx.bus?.request;
    if (typeof request === "function") {
      try {
        const serviceCall = request.call(this.ctx.bus, TIGEXING_NOTIFY_SERVICE, payload, { timeout: TIGEXING_NOTIFY_TIMEOUT_MS });
        const result = await withTimeout(serviceCall, "提个醒专注通知", TIGEXING_NOTIFY_TIMEOUT_MS);
        if (result?.suppressed === true) return { status: "suppressed", via: "tigexing" };
        if (result?.sent === true) return { status: "confirmed", via: "tigexing" };
        if (result && result.sent === false) {
          this.log?.warn?.(`[拾光记] 提个醒未能提交专注通知，改走系统通知 via=${result.via || "unknown"}`);
        } else {
          return { status: "unknown", via: "tigexing" };
        }
      } catch (error) {
        if (isDeliveryOutcomeUnknown(error)) {
          this.log?.warn?.(`[拾光记] 提个醒专注通知结果未知，不补发以免双响 code=${safeFocusNotifyErrorCode(error)}`);
          return { status: "unknown", via: "tigexing" };
        }
        if (!isFocusServiceDefinitelyUnavailable(error)) {
          this.log?.warn?.(`[拾光记] 提个醒专注通知结果未知，不补发以免双响 code=${safeFocusNotifyErrorCode(error)}`);
          return { status: "unknown", via: "tigexing" };
        }
        this.log?.warn?.(`[拾光记] 提个醒服务明确不可用，改走系统通知 code=${safeFocusNotifyErrorCode(error)}`);
      }
    }

    const show = this.ctx.notifications?.show;
    if (typeof show !== "function") return { status: "failed", via: "native" };
    try {
      const result = await withTimeout(show.call(this.ctx.notifications, fallbackToast), "ctx.notifications.show", NOTIFICATION_TIMEOUT_MS);
      return { status: result?.shown === true ? "confirmed" : "failed", via: "native" };
    } catch (error) {
      this.log?.warn?.(`[拾光记] 原生通知调用结果未知 code=${safeFocusNotifyErrorCode(error)}`);
      return { status: "unknown", via: "native", error };
    }
  }

  registerAppTaskHandler() {
    if (this.ready) return this.ready;
    this.ready = (async () => {
      const tasks = this.ctx.tasks;
      if (typeof tasks?.registerHandler !== "function") throw new Error("宿主没有公开的后台任务处理接口");
      await withTimeout(tasks.registerHandler(FOCUS_REMINDER_TASK_TYPE, {
        run: ({ input } = {}) => this.runAppTask(input),
      }), "ctx.tasks.registerHandler");
      return true;
    })().catch(error => {
      this.log?.warn?.(`[拾光记] 专注结束后台提醒未接通：${error?.message || error}`);
      return false;
    });
    return this.ready;
  }

  async listSchedules() {
    if (typeof this.ctx.tasks?.listSchedules !== "function") throw new Error("宿主没有公开的后台任务查询接口");
    return schedulesOf(await withTimeout(this.ctx.tasks.listSchedules(), "ctx.tasks.listSchedules"))
      .filter(row => row?.handlerKey === FOCUS_REMINDER_TASK_TYPE);
  }

  async removeSchedules(focusId, schedules = null) {
    const rows = schedules || await this.listSchedules();
    const matches = rows.filter(row => !focusId || text(row.payload?.focusId) === focusId);
    for (const row of matches) {
      if (row.scheduleId && typeof this.ctx.tasks?.unschedule === "function") {
        await withTimeout(this.ctx.tasks.unschedule(row.scheduleId), "ctx.tasks.unschedule");
      }
    }
  }

  serialize(action) {
    const operation = this.queue.then(action, action);
    this.queue = operation.catch(() => {});
    return operation;
  }

  schedule(active) {
    return this.serialize(() => this.scheduleInternal(active));
  }

  async scheduleInternal(active) {
    if (this.ready && await this.ready !== true) throw new Error("专注后台计时处理器未能注册");
    const hasNextRound = Number(active?.roundIndex || 1) < Number(active?.totalRounds || 1);
    const canSchedule = active?.phase === "focus" || active?.phase === "break" && hasNextRound;
    if (!active?.id || !canSchedule || active.pausedAt) {
      if (active?.id) await this.removeSchedules(String(active.id));
      return false;
    }
    const tasks = this.ctx.tasks;
    for (const method of ["listSchedules", "schedule", "unschedule"]) {
      if (typeof tasks?.[method] !== "function") throw new Error(`宿主没有公开的后台任务接口：${method}`);
    }
    const focusId = String(active.id);
    const phase = active.phase;
    const targetAt = Date.parse(String(active.targetAt || ""));
    if (!Number.isFinite(targetAt)) throw new Error("专注阶段结束时间无效，没法安排后台计时");
    const schedules = await this.listSchedules();
    const matching = schedules.filter(row => text(row.payload?.focusId) === focusId);
    const current = matching.find(row => row.enabled !== false
      && String(row.payload?.phase || "focus") === phase
      && Number(row.payload?.targetAt) === targetAt);
    await this.removeSchedules(focusId, current ? matching.filter(row => row !== current) : matching);
    if (current) return true;
    const expectedRunAt = Math.max(targetAt, Date.now() + 100);
    const result = await withTimeout(tasks.schedule({
      handlerKey: FOCUS_REMINDER_TASK_TYPE,
      scope: "app",
      label: phase === "break" ? "拾光记休息结束后继续下一轮" : "拾光记专注结束提醒",
      payload: { focusId, phase, targetAt },
      runAt: expectedRunAt,
      enabled: true,
    }), "ctx.tasks.schedule");
    const schedule = result?.schedule && typeof result.schedule === "object" ? result.schedule : result;
    if (!text(schedule?.scheduleId)) throw new Error("后台任务没有返回 scheduleId");
    return true;
  }

  async reconcileTransition(before, active, { insideQueue = false } = {}) {
    const transitioned = before?.phase === "focus" && before.id
      && (!active || active.id !== before.id || active.phase !== "focus");
    if (transitioned) {
      const session = this.data.listFocusSessions().find(row => row.id === before.id && row.status === "completed");
      if (session) await this.notifyCompletedSession(session);
    }
    const roundStarted = before?.phase === "break" && before.id
      && active?.phase === "focus" && active.id !== before.id;
    if (roundStarted) await this.notifyFocusStarted(active);
    if (before?.id && (!active || active.id !== before.id)) {
      if (insideQueue) await this.removeSchedules(String(before.id));
      else await this.cancel(before.id);
    }
    if (active) {
      if (insideQueue) await this.scheduleInternal(active);
      else await this.schedule(active);
    }
    return active;
  }

  async advanceAndNotify(now = new Date(), { insideQueue = false } = {}) {
    const before = this.data.focusStore.read()?.active;
    const active = await this.data.advanceFocusSession(now);
    return this.reconcileTransition(before, active, { insideQueue });
  }

  restore() {
    return this.serialize(() => this.restoreInternal());
  }

  async restoreInternal() {
    try {
      if (!this.notificationRecoveryDone) {
        const recoveredEnd = await this.data.recoverFocusEndNotifications();
        const recoveredStart = await this.data.recoverFocusStartNotifications();
        this.notificationRecoveryDone = true;
        const recovered = Number(recoveredEnd) + Number(recoveredStart);
        if (recovered) this.log?.warn?.(`[拾光记] ${recovered} 条专注通知中断，结果记为未知，不自动重复发送`);
      }
      if (!this.ready || await this.ready !== true) return false;
      await this.advanceAndNotify(new Date(), { insideQueue: true });
      const schedules = await this.listSchedules();
      const active = this.data.focusStore.read()?.active;
      if (active) await this.scheduleInternal(active);
      const currentSchedules = await this.listSchedules();
      const keep = active ? currentSchedules.filter(row => text(row.payload?.focusId) === String(active.id)) : [];
      await this.removeSchedules("", schedules.filter(row => !keep.some(item => item.scheduleId === row.scheduleId)));
      return true;
    } catch (error) {
      this.log?.warn?.(`[拾光记] 专注结束后台提醒恢复失败：${error?.message || error}`);
      return false;
    }
  }

  cancel(focusId) {
    return this.serialize(async () => {
      const id = text(focusId);
      if (!id) return true;
      await this.removeSchedules(id);
      return true;
    });
  }

  async notifyFocusStarted(active) {
    if (!active || active.phase !== "focus" || active.pausedAt || !text(active.id)) return false;
    let claimed = false;
    try {
      claimed = await this.data.claimFocusStartNotification(active.id);
      if (!claimed) return false;
      const roundIndex = Math.max(1, Number(active.roundIndex) || 1);
      const totalRounds = Math.max(1, Number(active.totalRounds) || 1);
      const minutes = Math.max(1, Number(active.plannedMinutes) || 25);
      const toast = {
        title: "拾光记 · 专注开始",
        body: `第 ${roundIndex}/${totalRounds} 轮开始，计划专注 ${minutes} 分钟。`,
      };
      const result = await this.notifyFocusEvent({
        kind: "start", focusId: String(active.id), taskTitle: text(active.taskTitle),
        durationMinutes: minutes, roundIndex, totalRounds,
        companionId: text(active.companionId), companionName: text(active.companionName),
      }, toast);
      await this.data.settleFocusStartNotification(active.id, result.status);
      if (result.status === "failed") this.log?.warn?.("[拾光记] 专注开始通知未能送达");
      return result.status === "confirmed";
    } catch (error) {
      if (claimed) await this.data.settleFocusStartNotification(active.id, "unknown").catch(() => {});
      this.log?.warn?.(`[拾光记] 专注开始通知结果未确认：${error?.message || error}`);
      return false;
    }
  }

  async notifyCompletedSession(session) {
    if (!session || session.status !== "completed") return false;
    let claimed = false;
    try {
      claimed = await this.data.claimFocusEndNotification(session.id);
      if (!claimed) return false;
      const roundIndex = Math.max(1, Number(session.roundIndex) || 1);
      const totalRounds = Math.max(1, Number(session.totalRounds) || 1);
      const minutes = Math.max(0, Math.round((Number(session.durationMs) || 0) / 60_000));
      const toast = {
        title: "拾光记 · 专注结束",
        body: `「${String(session.taskTitle || "这段专注").slice(0, 100)}」已完成，专注了 ${minutes} 分钟。`,
      };
      const result = await this.notifyFocusEvent({
        kind: "end", focusId: String(session.id), taskTitle: text(session.taskTitle),
        durationMinutes: minutes, roundIndex, totalRounds,
        companionId: text(session.companionId), companionName: text(session.companionName),
      }, toast);
      await this.data.settleFocusEndNotification(session.id, result.status);
      if (result.status === "failed") this.log?.warn?.("[拾光记] 专注结束通知未能送达");
      return result.status === "confirmed";
    } catch (error) {
      await this.data.settleFocusEndNotification(session.id, "unknown");
      this.log?.warn?.(`[拾光记] 专注结束通知结果未确认：${error?.message || error}`);
      return false;
    }
  }

  async runAppTask(input = {}) {
    const focusId = text(input.focusId);
    if (!focusId) return { skipped: true, reason: "missing-focus-id" };
    try {
      const active = this.data.focusStore.read()?.active;
      if (active?.id === focusId) {
        if (active.pausedAt) return { skipped: true, reason: "focus-paused" };
        const targetAt = Date.parse(String(active.targetAt || ""));
        if (!Number.isFinite(targetAt)) return { skipped: true, reason: "invalid-target" };
        if (targetAt > Date.now()) {
          await this.schedule(active);
          return { rescheduled: true };
        }
        const prior = this.data.listFocusSessions().find(row => row.id === focusId);
        const wasAlreadyConfirmed = prior?.notificationState === "confirmed";
        await this.advanceAndNotify(new Date());
        const completed = this.data.listFocusSessions().find(row => row.id === focusId && row.status === "completed");
        return { notified: !wasAlreadyConfirmed && !!(completed && completed.notificationState === "confirmed") };
      }
      const session = this.data.listFocusSessions().find(row => row.id === focusId);
      if (!session || session.status !== "completed") return { skipped: true, reason: "focus-not-completed" };
      const notified = await this.notifyCompletedSession(session);
      return { notified };
    } catch (error) {
      this.log?.warn?.(`[拾光记] 专注后台计时执行失败：${error?.message || error}`);
      return { ok: false, error: "focus-reminder-failed" };
    }
  }
}

export function setFocusReminderScheduler(scheduler) {
  sharedFocusReminderScheduler = scheduler || null;
  return sharedFocusReminderScheduler;
}

export function getFocusReminderScheduler() {
  return sharedFocusReminderScheduler;
}
