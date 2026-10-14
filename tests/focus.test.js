import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { UserData, dateKey } from "../lib/data.js";
import { buildPublicToday } from "../lib/public-today.js";

function makeData(t, name) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `sgj-focus-${name}-`));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return { data: new UserData(dir), dir };
}

function at(hour, minute = 0) {
  return new Date(2026, 9, 12, hour, minute, 0, 0);
}

test("专注计时：专注时长保留预设，可自选休息与轮数并关联未完成待办", async (t) => {
  const { data } = makeData(t, "start");
  const date = dateKey(at(9));
  const event = await data.addEvent({ title: "随手记", type: "event", date });
  await assert.rejects(data.startFocusSession({ taskId: event.id }, at(9)), /只能关联拾光记里的待办/);
  await assert.rejects(data.startFocusSession({ focusMinutes: 20 }, at(9)), /请选择 15、25、30 或 45/);

  const todo = await data.addEvent({ title: "整理照片", type: "todo", date, reminderStart: "09:00", reminderEnd: "09:00" });
  const active = await data.startFocusSession({ taskId: todo.id, focusMinutes: 25, breakMinutes: 5 }, at(9));
  assert.equal(active.phase, "focus");
  assert.equal(active.taskTitle, "整理照片");
  await assert.rejects(data.startFocusSession({}, at(9, 1)), /先结束当前/);

  await data.toggleTodo(todo.id);
  await data.cancelFocusSession(at(9, 1));
  await assert.rejects(data.startFocusSession({ taskId: todo.id }, at(9, 2)), /已经完成/);
});

test("专注计时：暂停、继续与提前结束按实际专注时长记账", async (t) => {
  const { data, dir } = makeData(t, "pause");
  await data.startFocusSession({ focusMinutes: 25, breakMinutes: 5 }, at(9));
  const paused = await data.pauseFocusSession(at(9, 4));
  assert.equal(paused.remainingMs, 21 * 60_000);

  const reopened = new UserData(dir);
  const resumed = await reopened.resumeFocusSession(at(9, 10));
  assert.equal(Date.parse(resumed.targetAt), at(9, 31).getTime());
  const ended = await reopened.endFocusSession(at(9, 20));
  assert.equal(ended.session.status, "interrupted");
  assert.equal(ended.session.durationMs, 14 * 60_000);
  assert.equal(reopened.listFocusSessions(dateKey(at(9))).length, 1);

  const stats = reopened.getFocusStats(at(9, 20));
  assert.equal(stats.totalDurationMs, 14 * 60_000);
  assert.equal(stats.count, 1);
  assert.equal(stats.completedCount, 0);
});

test("专注计时：并发结束同一段只落一条记录，不误报失败", async (t) => {
  const { data } = makeData(t, "parallel-end");
  await data.startFocusSession({ focusMinutes: 25, breakMinutes: 5 }, at(9));
  const results = await Promise.all([data.endFocusSession(at(9, 5)), data.endFocusSession(at(9, 5))]);
  assert.ok(results.every((result) => result.session && result.session.status === "interrupted"));
  assert.equal(data.listFocusSessions(dateKey(at(9))).length, 1);
});

test("多轮专注：到点结算短休，重开后休息结束自动进入下一轮", async (t) => {
  const { data, dir } = makeData(t, "complete");
  const start = at(9);
  const first = await data.startFocusSession({ focusMinutes: 15, breakMinutes: 5, totalRounds: 2 }, start);

  const afterFocus = await data.getFocusSnapshot(at(9, 15));
  assert.equal(afterFocus.active.phase, "break");
  assert.equal(afterFocus.active.breakKind, "short");
  assert.equal(afterFocus.active.remainingMs, 5 * 60_000);
  assert.equal(afterFocus.sessions.length, 1);
  assert.equal(afterFocus.sessions[0].status, "completed");

  const reopened = await new UserData(dir).getFocusSnapshot(at(9, 16));
  assert.equal(reopened.active.phase, "break");
  assert.equal(reopened.active.remainingMs, 4 * 60_000);
  assert.equal(reopened.sessions.length, 1);

  const afterBreak = await data.getFocusSnapshot(at(9, 20));
  assert.equal(afterBreak.active.phase, "focus");
  assert.equal(afterBreak.active.roundIndex, 2);
  assert.equal(afterBreak.active.plannedMinutes, 15);
  assert.equal(afterBreak.active.elapsedMs, 0);
  assert.notEqual(afterBreak.active.id, first.id);
  assert.equal(afterBreak.active.setId, first.setId);
  assert.equal(afterBreak.sessions.length, 1);
  assert.equal(afterBreak.stats.count, 1);
  assert.equal(afterBreak.stats.completedCount, 0);
});

test("多轮计划在休息中结束：保留已完成轮次并标记整组提前结束", async (t) => {
  const { data } = makeData(t, "break-end");
  await data.startFocusSession({ focusMinutes: 15, breakMinutes: 5, totalRounds: 2 }, at(9));
  const breakState = await data.getFocusSnapshot(at(9, 15));
  assert.equal(breakState.active.phase, "break");
  const ended = await data.endFocusSession(at(9, 16));
  assert.equal(ended.phase, "break");
  assert.equal((await data.getFocusSnapshot(at(9, 16))).active, null);
  const group = data.listFocusGroups(dateKey(at(9)))[0];
  assert.equal(group.completedRounds, 1);
  assert.equal(group.planStatus, "interrupted");
  assert.equal(data.listFocusSessions(dateKey(at(9)))[0].status, "completed");
});

test("整组结束时专注与后续休息都已过界：保留完成轮并结束计划，不自动开新轮", async (t) => {
  const { data } = makeData(t, "overdue-end-set");
  const first = await data.startFocusSession({ focusMinutes: 15, breakMinutes: 5, totalRounds: 3 }, at(9));
  const ended = await data.endFocusSession(at(9, 21));
  assert.equal(ended.session.id, first.id);
  assert.equal(ended.session.status, "completed");
  assert.equal((await data.getFocusSnapshot(at(9, 21))).active, null);
  const rows = data.listFocusSessions(dateKey(at(9)));
  assert.equal(rows.length, 1);
  assert.equal(rows[0].status, "completed");
  const group = data.listFocusGroups(dateKey(at(9)))[0];
  assert.equal(group.completedRounds, 1);
  assert.equal(group.planStatus, "interrupted");
});

test("结束竞态中下一轮已由别的读取推进：返回上一轮完成项并另存当前实记", async (t) => {
  const { data } = makeData(t, "concurrent-round-end");
  const first = await data.startFocusSession({ focusMinutes: 15, breakMinutes: 5, totalRounds: 3 }, at(9));
  const advance = data.advanceFocusSession.bind(data);
  data.advanceFocusSession = async (now) => {
    const active = await advance(now);
    if (active?.phase === "break" && active.setId === first.setId) {
      const breakEndedAt = new Date(active.targetAt);
      await advance(breakEndedAt);
      await data.focusStore.update(state => {
        if (state.active?.setId !== first.setId || state.active.phase !== "focus") return;
        state.active.activeSince = new Date(breakEndedAt.getTime() - 1 * 60_000).toISOString();
        state.active.targetAt = new Date(breakEndedAt.getTime() + 13 * 60_000).toISOString();
      });
    }
    return data.focusStore.read().active;
  };
  const ended = await data.endFocusSession(at(9, 21));
  assert.equal(ended.session.id, first.id);
  assert.equal(ended.session.status, "completed");
  assert.equal(ended.session.planStatus, "interrupted");
  assert.equal(ended.partialSession.roundIndex, 2);
  assert.equal(ended.partialSession.status, "interrupted");
  assert.equal(ended.partialSession.durationMs, 2 * 60_000);
  assert.equal((await data.getFocusSnapshot(at(9, 21))).active, null);
  assert.equal(data.listFocusSessions(dateKey(at(9))).length, 2);
});

test("专注记录不进入伙伴可读的公开今日快照", async (t) => {
  const { data } = makeData(t, "private-snapshot");
  await data.startFocusSession({ focusMinutes: 15, breakMinutes: 5 }, at(9));
  await data.endFocusSession(at(9, 5));
  const snapshot = buildPublicToday({ now: at(9, 6), data });
  assert.equal(Object.prototype.hasOwnProperty.call(snapshot.today, "focusSessions"), false);
  assert.equal(JSON.stringify(snapshot).includes("自由专注"), false);
});

test("提前取消也保留当前真实时长，到点竞态仍保留完成轮次", async (t) => {
  const { data } = makeData(t, "cancel");
  await data.startFocusSession({ focusMinutes: 15, breakMinutes: 5 }, at(9));
  const interrupted = await data.cancelFocusSession(at(9, 3));
  assert.equal(interrupted.cancelled, true);
  assert.equal(interrupted.session.status, "interrupted");
  assert.equal(interrupted.session.durationMs, 3 * 60_000);
  assert.equal(data.listFocusSessions(dateKey(at(9))).length, 1);
  assert.equal(data.listFocusGroups(dateKey(at(9)))[0].planStatus, "interrupted");

  await data.startFocusSession({ focusMinutes: 15, breakMinutes: 5 }, at(9, 30));
  const completed = await data.cancelFocusSession(at(9, 45));
  assert.equal(completed.cancelled, false);
  assert.equal(completed.completed, true);
  assert.equal(completed.session.status, "completed");
  assert.equal(data.listFocusSessions(dateKey(at(9))).length, 2);
  assert.equal((await data.getFocusSnapshot(at(9, 45))).active, null);
});

test("多轮计划：长休按间隔触发、每轮ID唯一、末轮不追加休息，统计按整组", async (t) => {
  const { data } = makeData(t, "rounds");
  const first = await data.startFocusSession({ focusMinutes: 15, shortBreakMinutes: 7, totalRounds: 4, longBreakEvery: 2, longBreakMinutes: 20 }, at(9));
  let snapshot = await data.getFocusSnapshot(at(9, 15));
  assert.equal(snapshot.active.phase, "break");
  assert.equal(snapshot.active.breakKind, "short");
  assert.equal(snapshot.active.breakMinutes, 7);
  snapshot = await data.getFocusSnapshot(at(9, 22));
  assert.equal(snapshot.active.phase, "focus");
  assert.equal(snapshot.active.roundIndex, 2);
  assert.equal(snapshot.active.plannedMinutes, 15);
  assert.equal(snapshot.active.setId, first.setId);

  snapshot = await data.getFocusSnapshot(at(9, 37));
  assert.equal(snapshot.active.phase, "break");
  assert.equal(snapshot.active.breakKind, "long");
  assert.equal(snapshot.active.breakMinutes, 20);
  snapshot = await data.getFocusSnapshot(at(9, 57));
  assert.equal(snapshot.active.phase, "focus");
  assert.equal(snapshot.active.roundIndex, 3);

  snapshot = await data.getFocusSnapshot(at(10, 12));
  assert.equal(snapshot.active.phase, "break");
  assert.equal(snapshot.active.breakKind, "short");
  snapshot = await data.getFocusSnapshot(at(10, 19));
  assert.equal(snapshot.active.roundIndex, 4);
  snapshot = await data.getFocusSnapshot(at(10, 34));
  assert.equal(snapshot.active, null);

  const rows = data.listFocusSessions(dateKey(at(9)));
  assert.equal(rows.length, 4);
  assert.equal(new Set(rows.map(row => row.id)).size, 4);
  assert.ok(rows.every(row => row.setId === first.setId));
  assert.deepEqual(rows.map(row => row.roundIndex), [1, 2, 3, 4]);
  assert.ok(rows.every(row => row.durationMs === 15 * 60_000));
  const group = data.listFocusGroups(dateKey(at(9)))[0];
  assert.equal(group.totalRounds, 4);
  assert.equal(group.completedRounds, 4);
  assert.equal(group.totalFocusMs, 60 * 60_000);
  assert.equal(group.planStatus, "completed");
  assert.equal(snapshot.stats.count, 1);
  assert.equal(snapshot.stats.completedCount, 1);
  assert.equal(snapshot.stats.totalDurationMs, 60 * 60_000);
});

test("第二轮暂停继续后结束：保留唯一轮次与实际净专注时长", async (t) => {
  const { data } = makeData(t, "round-pause");
  const first = await data.startFocusSession({ focusMinutes: 15, totalRounds: 2 }, at(9));
  await data.getFocusSnapshot(at(9, 15));
  const second = await data.getFocusSnapshot(at(9, 20));
  const paused = await data.pauseFocusSession(at(9, 23));
  assert.equal(paused.roundIndex, 2);
  assert.equal(paused.remainingMs, 12 * 60_000);
  const resumed = await data.resumeFocusSession(at(9, 30));
  assert.equal(resumed.roundIndex, 2);
  assert.equal(Date.parse(resumed.targetAt), at(9, 42).getTime());
  const ended = await data.endFocusSession(at(9, 35));
  assert.equal(ended.session.roundIndex, 2);
  assert.equal(ended.session.setId, first.setId);
  assert.equal(ended.session.durationMs, 8 * 60_000);
  const rows = data.listFocusSessions(dateKey(at(9)));
  assert.equal(rows.length, 2);
  assert.equal(new Set(rows.map(row => row.id)).size, 2);
  assert.equal(second.active.roundIndex, 2);
});

test("常用目标保存在加密专注数据中，可去重、重载与移除", async (t) => {
  const { data, dir } = makeData(t, "favorites");
  assert.deepEqual(await data.addFavoriteFocusGoal("  读一章书  "), ["读一章书"]);
  assert.deepEqual(await data.addFavoriteFocusGoal("读一章书"), ["读一章书"]);
  await data.addFavoriteFocusGoal("整理资料");
  const reopened = new UserData(dir);
  assert.deepEqual(reopened.listFavoriteFocusGoals(), ["整理资料", "读一章书"]);
  assert.deepEqual(await reopened.removeFavoriteFocusGoal("读一章书"), ["整理资料"]);
});

test("专注配置：上次设置与各常用目标独立保存，旧标签沿用上次设置并绑定", async t => {
  const { data, dir } = makeData(t, "settings");
  const book = { focusMinutes: 45, totalRounds: 3, shortBreakMinutes: 7, longBreakEnabled: true, longBreakEvery: 2, longBreakMinutes: 20 };
  const writing = { focusMinutes: 25, totalRounds: 2, shortBreakMinutes: 4, longBreakEnabled: false, longBreakEvery: 3, longBreakMinutes: 18 };

  await data.saveFocusSettings(book);
  await data.addFavoriteFocusGoal("读书", book);
  await data.addFavoriteFocusGoal("写作", writing);
  assert.deepEqual((await data.selectFavoriteFocusGoal("读书")).focusConfig, book);
  await data.saveFocusSettings(writing, "写作");

  const reopened = new UserData(dir);
  assert.deepEqual(reopened.getFocusSettings(), writing);
  assert.deepEqual((await reopened.selectFavoriteFocusGoal("读书")).focusConfig, book);
  const updatedBook = { ...book, focusMinutes: 30 };
  await reopened.saveFocusSettings(updatedBook, "读书");
  assert.deepEqual((await reopened.getFocusSnapshot()).favoriteGoalConfigs["goal:读书"], updatedBook);

  await reopened.focusStore.update(state => {
    state.favoriteGoals.unshift("旧标签");
    state.lastFocusConfig = writing;
  });
  assert.deepEqual((await reopened.selectFavoriteFocusGoal("旧标签")).focusConfig, writing);
  assert.deepEqual((await reopened.getFocusSnapshot()).favoriteGoalConfigs["goal:旧标签"], writing);
  await reopened.removeFavoriteFocusGoal("读书");
  assert.equal((await reopened.getFocusSnapshot()).favoriteGoalConfigs["goal:读书"], undefined);
});

test("专注配置：开始成功时一并记住本次设置和所选目标配置", async t => {
  const { data } = makeData(t, "start-settings");
  const config = { focusMinutes: 30, totalRounds: 5, shortBreakMinutes: 6, longBreakEnabled: false, longBreakEvery: 2, longBreakMinutes: 25 };
  await data.addFavoriteFocusGoal("读书", config);
  await data.startFocusSession({ taskTitle: "读书", focusMinutes: 30, totalRounds: 5, shortBreakMinutes: 6,
    longBreakEvery: 0, longBreakMinutes: 25, focusConfig: config, favoriteGoalTitle: "读书" }, at(9));
  assert.deepEqual(data.getFocusSettings(), config);
  assert.deepEqual((await data.getFocusSnapshot(at(9))).favoriteGoalConfigs["goal:读书"], config);

  const { data: scalarStart } = makeData(t, "scalar-start-config");
  const scalarActive = await scalarStart.startFocusSession({ taskTitle: "旧调用方", focusMinutes: 25, shortBreakMinutes: 7,
    totalRounds: 3, longBreakEvery: 0, longBreakMinutes: 15 }, at(9));
  assert.equal(scalarActive.shortBreakMinutes, 7);
  assert.equal(scalarActive.longBreakEvery, 0);
  assert.equal(scalarStart.getFocusSettings().shortBreakMinutes, 7);
  assert.equal(scalarStart.getFocusSettings().longBreakEnabled, false);
});
