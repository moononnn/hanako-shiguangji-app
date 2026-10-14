import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { UserData } from "../lib/data.js";
import { FOCUS_REMINDER_TASK_TYPE, FocusReminderScheduler } from "../lib/focus-reminder-scheduler.js";

function harness({ active = null } = {}) {
  const state = { active: active ? structuredClone(active) : null, sessions: [] };
  const schedules = [];
  const calls = { registered: [], scheduled: [], unscheduled: [], notifications: [], serviceRequests: [] };
  let handler;
  const data = {
    focusStore: { read: () => structuredClone(state), async update(change) { change(state); } },
    listFocusSessions: () => state.sessions.map(row => ({ ...row })),
    async claimFocusEndNotification(id) {
      const row = state.sessions.find(item => item.id === id);
      if (!row || row.status !== "completed" || ["sending", "confirmed", "unknown", "suppressed"].includes(row.notificationState)) return false;
      row.notificationState = "sending";
      return true;
    },
    async settleFocusEndNotification(id, status) {
      const row = state.sessions.find(item => item.id === id);
      if (!row || row.notificationState !== "sending") return false;
      row.notificationState = status;
      return true;
    },
    async recoverFocusEndNotifications() {
      let count = 0;
      for (const row of state.sessions) if (row.notificationState === "sending") { row.notificationState = "unknown"; count += 1; }
      return count;
    },
    async claimFocusStartNotification(id) {
      const active = state.active;
      if (active?.id !== id || active.phase !== "focus" || active.pausedAt || ["sending", "confirmed", "unknown", "failed", "suppressed"].includes(active.startNotificationState)) return false;
      active.startNotificationState = "sending";
      return true;
    },
    async settleFocusStartNotification(id, status) {
      if (state.active?.id !== id || state.active.startNotificationState !== "sending") return false;
      state.active.startNotificationState = status;
      return true;
    },
    async recoverFocusStartNotifications() {
      if (state.active?.startNotificationState !== "sending") return 0;
      state.active.startNotificationState = "unknown";
      return 1;
    },
    async advanceFocusSession(now = new Date()) {
      const current = state.active;
      if (!current || current.phase !== "focus" || current.pausedAt || Date.parse(current.targetAt) > now.getTime()) return current;
      if (!state.sessions.some(row => row.id === current.id)) state.sessions.push({
        ...current, status: "completed", endedAt: now.toISOString(),
        durationMs: Number(current.plannedMinutes || 25) * 60_000,
      });
      state.active = Number(current.breakMinutes) > 0 ? { ...current, phase: "break" } : null;
      return state.active;
    },
  };
  const ctx = {
    tasks: {
      async registerHandler(key, value) { calls.registered.push(key); handler = value; },
      async listSchedules() { return schedules.slice(); },
      async schedule(value) {
        calls.scheduled.push(value);
        const schedule = { ...value, scheduleId: `focus-plan-${calls.scheduled.length}` };
        schedules.push(schedule);
        return { schedule };
      },
      async unschedule(id) {
        calls.unscheduled.push(id);
        const index = schedules.findIndex(row => row.scheduleId === id);
        if (index >= 0) schedules.splice(index, 1);
      },
    },
    notifications: { async show(value) { calls.notifications.push(value); return { shown: true }; } },
    logger: { warn() {} },
  };
  const scheduler = new FocusReminderScheduler({ ctx, data });
  return { state, schedules, calls, data, ctx, scheduler, get handler() { return handler; } };
}

const activeFocus = (overrides = {}) => ({
  id: "focus-1", phase: "focus", targetAt: new Date(Date.now() + 60_000).toISOString(),
  startedAt: new Date().toISOString(), taskTitle: "读完这一章", plannedMinutes: 25, roundIndex: 1, totalRounds: 4, breakMinutes: 0,
  ...overrides,
});

test("数据层：静默拦截状态可落盘并阻止重复通知", async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sgj-focus-notify-suppressed-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const data = new UserData(dir);
  const active = await data.startFocusSession({ taskTitle: "整理资料", focusMinutes: 25 }, new Date());

  assert.equal(await data.claimFocusStartNotification(active.id), true);
  assert.equal(await data.settleFocusStartNotification(active.id, "suppressed"), true);
  assert.equal(data.focusStore.read().active.startNotificationState, "suppressed");
  assert.equal(await data.claimFocusStartNotification(active.id), false);

  const completed = { ...active, id: "focus-end-suppressed", status: "completed", notificationState: "" };
  await data.focusStore.update(state => state.sessions.push(completed));
  assert.equal(await data.claimFocusEndNotification(completed.id), true);
  assert.equal(await data.settleFocusEndNotification(completed.id, "suppressed"), true);
  assert.equal(data.focusStore.read().sessions.find(row => row.id === completed.id).notificationState, "suppressed");
  assert.equal(await data.claimFocusEndNotification(completed.id), false);
});

test("后台专注提醒：每轮开始通知使用当前轮ID认领，重复调用不重弹", async () => {
  const h = harness({ active: activeFocus() });
  assert.equal(await h.scheduler.notifyFocusStarted(h.state.active), true);
  assert.equal(h.state.active.startNotificationState, "confirmed");
  assert.equal(h.calls.notifications.length, 1);
  assert.match(h.calls.notifications[0].body, /第 1\/4 轮开始/);
  assert.equal(await h.scheduler.notifyFocusStarted(h.state.active), false);
  assert.equal(h.calls.notifications.length, 1);
  h.state.active.pausedAt = new Date().toISOString();
  assert.equal(await h.scheduler.notifyFocusStarted(h.state.active), false);
  assert.equal(h.calls.notifications.length, 1);
});

test("专注开始通知：提个醒接收后不再调用原生通知，并收到陪读身份", async () => {
  const active = activeFocus({ companionId: "tea-character-id", companionName: "角色甲" });
  const h = harness({ active });
  h.ctx.bus = { async request(service, payload, options) {
    h.calls.serviceRequests.push({ service, payload, options });
    return { ok: true, sent: true, via: "powershell" };
  } };

  assert.equal(await h.scheduler.notifyFocusStarted(h.state.active), true);
  assert.equal(h.calls.notifications.length, 0);
  assert.equal(h.calls.serviceRequests.length, 1);
  assert.equal(h.calls.serviceRequests[0].service, "app:tigexing-app/focus/notify");
  assert.equal(h.calls.serviceRequests[0].payload.kind, "start");
  assert.equal(h.calls.serviceRequests[0].payload.companionId, "tea-character-id");
  assert.equal(h.calls.serviceRequests[0].payload.companionName, "角色甲");
  assert.equal(h.state.active.startNotificationState, "confirmed");
});

test("专注通知：提个醒静默时记录 suppressed，不绕过静默、不重复请求", async () => {
  const h = harness({ active: activeFocus() });
  h.ctx.bus = { async request(service, payload) {
    h.calls.serviceRequests.push({ service, payload });
    return { ok: true, sent: false, suppressed: true, reason: "quiet" };
  } };

  assert.equal(await h.scheduler.notifyFocusStarted(h.state.active), false);
  assert.equal(h.state.active.startNotificationState, "suppressed");
  assert.equal(h.calls.notifications.length, 0);
  assert.equal(await h.scheduler.notifyFocusStarted(h.state.active), false);
  assert.equal(h.calls.serviceRequests.length, 1);
});

test("专注通知：提个醒服务缺失时回退现有原生通知", async () => {
  const h = harness({ active: activeFocus() });
  h.ctx.bus = { async request() { throw Object.assign(new Error("service not found"), { code: "APP_SERVICE_NOT_FOUND" }); } };

  assert.equal(await h.scheduler.notifyFocusStarted(h.state.active), true);
  assert.equal(h.state.active.startNotificationState, "confirmed");
  assert.equal(h.calls.notifications.length, 1);
});

test("专注通知：提个醒调用超时后记为 unknown，不走原生补发", async () => {
  const h = harness({ active: activeFocus() });
  h.ctx.bus = { async request() { throw Object.assign(new Error("service request timeout"), { code: "APP_SERVICE_TIMEOUT" }); } };

  assert.equal(await h.scheduler.notifyFocusStarted(h.state.active), false);
  assert.equal(h.state.active.startNotificationState, "unknown");
  assert.equal(h.calls.notifications.length, 0);
});

test("专注通知：未分类服务错误按结果未知处理，不回退以免双弹", async () => {
  const h = harness({ active: activeFocus() });
  h.ctx.bus = { async request() { throw new Error("opaque IPC failure"); } };

  assert.equal(await h.scheduler.notifyFocusStarted(h.state.active), false);
  assert.equal(h.state.active.startNotificationState, "unknown");
  assert.equal(h.calls.notifications.length, 0);
});

test("原生通知接口抛错时记为 unknown，不把结果当明确失败", async () => {
  const h = harness({ active: activeFocus() });
  h.ctx.notifications.show = async () => { throw new Error("opaque host failure"); };

  assert.equal(await h.scheduler.notifyFocusStarted(h.state.active), false);
  assert.equal(h.state.active.startNotificationState, "unknown");
  assert.equal(await h.scheduler.notifyFocusStarted(h.state.active), false);
  assert.equal(h.calls.notifications.length, 0);
});

test("专注结束通知：提个醒收到当前轮与陪读伙伴，不再弹原生通知", async () => {
  const h = harness();
  const session = {
    id: "focus-end-1", status: "completed", taskTitle: "整理资料", durationMs: 25 * 60_000,
    companionId: "tea-character-id", companionName: "角色甲", roundIndex: 2, totalRounds: 4,
  };
  h.state.sessions.push(session);
  h.ctx.bus = { async request(service, payload) {
    h.calls.serviceRequests.push({ service, payload });
    return { ok: true, sent: true, via: "host" };
  } };

  assert.equal(await h.scheduler.notifyCompletedSession(session), true);
  assert.equal(h.calls.notifications.length, 0);
  assert.equal(h.calls.serviceRequests[0].payload.kind, "end");
  assert.equal(h.calls.serviceRequests[0].payload.focusId, "focus-end-1");
  assert.equal(h.calls.serviceRequests[0].payload.roundIndex, 2);
  assert.equal(h.calls.serviceRequests[0].payload.companionName, "角色甲");
  assert.equal(session.notificationState, "confirmed");
});

test("后台专注提醒：注册一次性宿主计划，到点结算并弹通知，重复回调不重弹", async () => {
  const h = harness({ active: activeFocus() });
  await h.scheduler.registerAppTaskHandler();
  assert.deepEqual(h.calls.registered, [FOCUS_REMINDER_TASK_TYPE]);
  await h.scheduler.schedule(h.state.active);
  assert.equal(h.calls.scheduled.length, 1);
  assert.equal(h.calls.scheduled[0].handlerKey, FOCUS_REMINDER_TASK_TYPE);
  assert.equal(h.calls.scheduled[0].scope, "app");
  assert.equal(h.calls.scheduled[0].payload.focusId, "focus-1");

  h.state.active.targetAt = new Date(Date.now() - 1_000).toISOString();
  const input = h.calls.scheduled[0].payload;
  assert.deepEqual(await h.handler.run({ input }), { notified: true });
  assert.equal(h.state.active, null);
  assert.equal(h.state.sessions[0].status, "completed");
  assert.equal(h.state.sessions[0].notificationState, "confirmed");
  assert.equal(h.calls.notifications.length, 1);
  assert.match(h.calls.notifications[0].body, /读完这一章/);
  assert.deepEqual(await h.handler.run({ input }), { notified: false });
  assert.equal(h.calls.notifications.length, 1);
});

test("后台专注提醒：暂停撤销旧计划，继续后按新目标重排，取消能清掉计划", async () => {
  const h = harness({ active: activeFocus() });
  await h.scheduler.registerAppTaskHandler();
  await h.scheduler.schedule(h.state.active);
  const oldId = h.schedules[0].scheduleId;
  h.state.active.pausedAt = new Date().toISOString();
  assert.equal(await h.scheduler.cancel("focus-1"), true);
  assert.deepEqual(h.calls.unscheduled, [oldId]);
  assert.equal(h.schedules.length, 0);

  h.state.active.pausedAt = "";
  h.state.active.targetAt = new Date(Date.now() + 120_000).toISOString();
  await h.scheduler.schedule(h.state.active);
  assert.equal(h.schedules.length, 1);
  assert.equal(h.schedules[0].payload.targetAt, Date.parse(h.state.active.targetAt));
  await h.scheduler.cancel("focus-1");
  assert.equal(h.schedules.length, 0);
});

test("后台专注提醒：禁用的旧一次性计划不会冒充有效计划", async () => {
  const active = activeFocus();
  const h = harness({ active });
  await h.scheduler.registerAppTaskHandler();
  h.schedules.push({
    scheduleId: "disabled-old", handlerKey: FOCUS_REMINDER_TASK_TYPE, enabled: false,
    payload: { focusId: active.id, targetAt: Date.parse(active.targetAt) }, runAt: Date.parse(active.targetAt),
  });
  await h.scheduler.schedule(active);
  assert.equal(h.calls.scheduled.length, 1);
  assert.deepEqual(h.calls.unscheduled, ["disabled-old"]);
  assert.equal(h.schedules.length, 1);
  assert.notEqual(h.schedules[0].scheduleId, "disabled-old");
});

test("后台专注提醒：启动恢复会补结算错过的到期专注并通知，不重排休息状态", async () => {
  const h = harness({ active: activeFocus({ targetAt: new Date(Date.now() - 10_000).toISOString() }) });
  await h.scheduler.registerAppTaskHandler();
  assert.equal(await h.scheduler.restore(), true);
  assert.equal(h.state.active, null);
  assert.equal(h.state.sessions.length, 1);
  assert.equal(h.calls.notifications.length, 1);
  assert.equal(h.schedules.length, 0);
});

test("后台专注提醒：通知接口挂起超时后记为unknown，不盲目重发", async t => {
  const h = harness({ active: activeFocus() });
  await h.scheduler.registerAppTaskHandler();
  await h.scheduler.schedule(h.state.active);
  h.state.active.targetAt = new Date(Date.now() - 1_000).toISOString();
  let calls = 0;
  h.ctx.notifications.show = () => { calls += 1; return new Promise(() => {}); };
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const pending = h.handler.run({ input: h.calls.scheduled[0].payload });
  await new Promise(resolve => setImmediate(resolve));
  t.mock.timers.tick(3_001);
  assert.deepEqual(await pending, { notified: false });
  assert.equal(h.state.sessions[0].notificationState, "unknown");
  assert.deepEqual(await h.handler.run({ input: h.calls.scheduled[0].payload }), { notified: false });
  assert.equal(calls, 1);
});

test("后台专注提醒：重启后把开始提醒残留sending标成unknown，不重复弹", async () => {
  const h = harness({ active: activeFocus({ startNotificationState: "sending" }) });
  await h.scheduler.registerAppTaskHandler();
  assert.equal(await h.scheduler.restore(), true);
  assert.equal(h.state.active.startNotificationState, "unknown");
  assert.equal(h.calls.notifications.length, 0);
});

test("后台专注提醒：重启后把残留sending标成unknown，避免永久锁和重复弹出", async () => {
  const h = harness();
  h.state.sessions.push({ id: "focus-1", status: "completed", notificationState: "sending", taskTitle: "读书" });
  await h.scheduler.registerAppTaskHandler();
  assert.equal(await h.scheduler.restore(), true);
  assert.equal(h.state.sessions[0].notificationState, "unknown");
  assert.equal(await h.scheduler.notifyCompletedSession(h.state.sessions[0]), false);
  assert.equal(h.calls.notifications.length, 0);
});

test("后台专注提醒：任务处理器未登记时仍恢复残留sending状态", async () => {
  const h = harness();
  h.state.sessions.push({ id: "focus-1", status: "completed", notificationState: "sending", taskTitle: "读书" });
  h.scheduler.ready = Promise.resolve(false);
  assert.equal(await h.scheduler.restore(), false);
  assert.equal(h.state.sessions[0].notificationState, "unknown");
});

test("后台专注提醒：提前中断的记录不触发完成通知", async () => {
  const h = harness();
  h.state.sessions.push({ id: "focus-1", status: "interrupted", taskTitle: "读书" });
  assert.equal(await h.scheduler.notifyCompletedSession(h.state.sessions[0]), false);
  assert.equal(h.calls.notifications.length, 0);
});

test("后台专注计时：页面关闭时由休息任务自动启动下一轮，旧回调不碰新轮", async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sgj-focus-round-task-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const data = new UserData(dir);
  const schedules = [];
  const notifications = [];
  let handler;
  let sequence = 0;
  const ctx = {
    tasks: {
      async registerHandler(_key, value) { handler = value; },
      async listSchedules() { return schedules.slice(); },
      async schedule(value) { const row = { ...value, scheduleId: "round-plan-" + (++sequence) }; schedules.push(row); return { schedule: row }; },
      async unschedule(id) { const index = schedules.findIndex(row => row.scheduleId === id); if (index >= 0) schedules.splice(index, 1); },
    },
    notifications: { async show(value) { notifications.push(value); return { shown: true }; } },
    logger: { warn() {} },
  };
  const scheduler = new FocusReminderScheduler({ ctx, data });
  await scheduler.registerAppTaskHandler();
  const first = await data.startFocusSession({ taskTitle: "整理资料", focusMinutes: 15, totalRounds: 2, shortBreakMinutes: 1 }, new Date());
  await scheduler.schedule(first);
  const firstPayload = schedules[0].payload;
  assert.equal(firstPayload.phase, "focus");
  assert.equal(await scheduler.notifyFocusStarted(first), true);
  assert.equal(await scheduler.notifyFocusStarted(first), false);
  assert.equal(notifications.length, 1);

  await data.focusStore.update(state => { state.active.targetAt = new Date(Date.now() - 1_000).toISOString(); });
  assert.deepEqual(await handler.run({ input: firstPayload }), { notified: true });
  assert.equal(data.focusStore.read().active.phase, "break");
  assert.equal(schedules.length, 1);
  const breakPayload = schedules[0].payload;
  assert.equal(breakPayload.phase, "break");
  assert.equal(breakPayload.focusId, first.id);
  assert.equal(notifications.length, 2);
  assert.match(notifications.at(-1).title, /专注结束/);

  await data.focusStore.update(state => { state.active.targetAt = new Date(Date.now() - 1_000).toISOString(); });
  assert.deepEqual(await handler.run({ input: breakPayload }), { notified: false });
  const second = data.focusStore.read().active;
  assert.equal(second.phase, "focus");
  assert.equal(second.roundIndex, 2);
  assert.equal(second.setId, first.setId);
  assert.notEqual(second.id, first.id);
  assert.ok(second.activeSince);
  assert.equal(second.elapsedMs, 0);
  assert.equal(second.plannedMinutes, 15);
  assert.equal(schedules.length, 1);
  assert.equal(schedules[0].payload.focusId, second.id);
  assert.equal(schedules[0].payload.phase, "focus");
  assert.equal(notifications.length, 3);
  assert.match(notifications.at(-1).title, /专注开始/);
  assert.match(notifications.at(-1).body, /第 2\/2 轮开始/);

  await handler.run({ input: firstPayload });
  assert.equal(data.focusStore.read().active.id, second.id);
  assert.equal(schedules.length, 1);
  assert.equal(notifications.length, 3);
});
