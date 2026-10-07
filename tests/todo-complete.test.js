// 拾光记 · 「她说做完了就勾掉」这条路的回归
// 覆盖：定位（id / 标题 / 多个像 / 找不到）、幂等、撤提醒、跨 App 入口的白名单与取消。
process.env.TZ = "Asia/Shanghai";

import { test } from "node:test";
import assert from "node:assert/strict";

import { locateTodo, completeTodo, registerTodoCompleteService, normalizeTitle, TODO_COMPLETE_SERVICE } from "../lib/todo-complete.js";

function ev(id, title, extra = {}) {
  return { id, title, type: "todo", date: "2026-10-06", done: false, ...extra };
}

function fakeData(events) {
  const state = { events: {} };
  for (const row of events) state.events[row.id] = { ...row };
  return {
    getEvent: (id) => state.events[id] || null,
    listEvents: () => Object.values(state.events),
    async toggleTodo(id) {
      const target = state.events[id];
      if (!target || target.type !== "todo") return null;
      target.done = !target.done;
      return target;
    },
  };
}

test("归一化：空格、标点、全角半角、大小写都不影响对上", () => {
  assert.equal(normalizeTitle("吃维生素 d"), normalizeTitle("吃维生素D"));
  assert.equal(normalizeTitle("喝水。"), "喝水");
});

test("定位：给了 id 就认 id", () => {
  const found = locateTodo([ev("a", "喝水"), ev("b", "买纸")], { id: "b" });
  assert.equal(found.status, "ok");
  assert.equal(found.event.title, "买纸");
  assert.equal(locateTodo([ev("a", "喝水")], { id: "zz" }).status, "not-found");
});

test("定位：只给标题时完全相同优先，其次包含关系", () => {
  const rows = [ev("a", "吃维生素d"), ev("b", "吃维生素d片"), ev("c", "给薄荷浇水")];
  assert.equal(locateTodo(rows, { title: "吃维生素D" }).event.id, "a");
  assert.equal(locateTodo([ev("b", "吃维生素d片")], { title: "维生素d" }).event.id, "b");
});

test("定位：好几条都像就说不准，不替她挑", () => {
  const found = locateTodo([ev("a", "买纸"), ev("b", "买纸箱")], { title: "买纸" });
  // "买纸" 精确命中 a，不算歧义
  assert.equal(found.status, "ok");
  const ambiguous = locateTodo([ev("a", "买纸箱"), ev("b", "买纸巾")], { title: "买纸" });
  assert.equal(ambiguous.status, "ambiguous");
  assert.equal(ambiguous.candidates.length, 2);
});

test("定位：已经勾过的那条照样认得出来，不当成没找到", () => {
  const found = locateTodo([ev("a", "喝水", { done: true })], { title: "喝水" });
  assert.equal(found.status, "already-done");
});

test("定位：找不到时把最近几条在办的摆出来", () => {
  const found = locateTodo([ev("a", "喝水"), ev("b", "买纸")], { title: "浇花" });
  assert.equal(found.status, "not-found");
  assert.equal(found.candidates.length, 2);
  assert.equal(locateTodo([], { title: "喝水" }).status, "not-found");
  assert.equal(locateTodo([], { title: "" }).status, "empty");
});

test("勾掉：真的翻成已完成，并把这条交出去撤提醒", async () => {
  const data = fakeData([ev("a", "吃维生素d", { reminderStart: "08:00", reminderEnd: "08:00" })]);
  const handed = [];
  const result = await completeTodo({ data, title: "吃维生素D", today: "2026-10-06", eventChanged: (e) => { handed.push(e.id); } });
  assert.equal(result.ok, true);
  assert.equal(result.alreadyDone, false);
  assert.equal(result.todo.title, "吃维生素d");
  assert.equal(data.getEvent("a").done, true);
  assert.deepEqual(handed, ["a"]);
});

test("勾掉：同一句话说两遍，第二遍回“已经勾过”，不再翻一次", async () => {
  const data = fakeData([ev("a", "喝水")]);
  const first = await completeTodo({ data, id: "a" });
  const second = await completeTodo({ data, id: "a" });
  assert.equal(first.alreadyDone, false);
  assert.equal(second.alreadyDone, true);
  assert.equal(data.getEvent("a").done, true, "不能被翻回未完成");
});

test("勾掉：撤提醒失败不该把已完成说成失败", async () => {
  const data = fakeData([ev("a", "喝水")]);
  const result = await completeTodo({ data, id: "a", eventChanged: () => { throw new Error("计划没排上"); } });
  assert.equal(result.ok, true);
  assert.match(result.reminderWarning, /提醒还没撤下来/);
});

test("勾掉：标着多个或没找到时不写账", async () => {
  const data = fakeData([ev("a", "买纸箱"), ev("b", "买纸巾")]);
  const ambiguous = await completeTodo({ data, title: "买纸" });
  assert.equal(ambiguous.ok, false);
  assert.equal(ambiguous.reason, "ambiguous");
  const missing = await completeTodo({ data, title: "浇花" });
  assert.equal(missing.ok, false);
  assert.equal(data.getEvent("a").done, false);
  assert.equal(data.getEvent("b").done, false);
});

// ── 跨 App 入口 ──

function fakeBus() {
  const state = { handler: null, options: null };
  return {
    state,
    handle(name, handler, options) {
      state.handler = handler;
      state.name = name;
      state.options = options;
      return () => { state.handler = null; };
    },
  };
}

test("跨 App：服务挂上了，且明确允许别的 App 调", () => {
  const bus = fakeBus();
  const release = registerTodoCompleteService({ ctx: { bus }, data: fakeData([]) });
  assert.equal(bus.state.name, TODO_COMPLETE_SERVICE);
  assert.equal(bus.state.options.allowCrossApp, true);
  assert.equal(typeof release, "function");
});

test("跨 App：白名单外的调用方一律拒绝，账本一点不动", async () => {
  const bus = fakeBus();
  const data = fakeData([ev("a", "喝水")]);
  registerTodoCompleteService({ ctx: { bus }, data });
  await assert.rejects(() => bus.state.handler({ id: "a" }, { callerAppId: "somebody-else" }), /许可/);
  assert.equal(data.getEvent("a").done, false);
});

test("跨 App：茶话会调得动，结果原样回传", async () => {
  const bus = fakeBus();
  const data = fakeData([ev("a", "吃维生素d", { reminderStart: "08:00", reminderEnd: "08:00" })]);
  registerTodoCompleteService({ ctx: { bus }, data });
  const result = await bus.state.handler({ id: "a" }, { callerAppId: "chahuahui" });
  assert.equal(result.ok, true);
  assert.equal(data.getEvent("a").done, true);
});

test("跨 App：请求被取消就不落笔", async () => {
  const bus = fakeBus();
  const data = fakeData([ev("a", "喝水")]);
  registerTodoCompleteService({ ctx: { bus }, data });
  await assert.rejects(() => bus.state.handler({ id: "a" }, { callerAppId: "chahuahui", signal: { aborted: true } }), /取消/);
  assert.equal(data.getEvent("a").done, false);
});

test("跨 App：宿主没有 bus.handle 就安静跳过，不炸装载", () => {
  assert.equal(registerTodoCompleteService({ ctx: {}, data: fakeData([]) }), null);
});
