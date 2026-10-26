// 拾光记 · Code 页注入测试
// 覆盖：项目清单归一化、Code 页精简文案、总闸与单项开关、普通窗口不受影响、会话分区判断。

import { test, before } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import { UserData, dateKey } from "../lib/data.js";
import { __setSharedUserDataForTest } from "../lib/shared-data.js";
import { DEFAULT_CODE_INJECTION_ITEMS, normalizeCodeInjectionItems } from "../lib/code-mode.js";
import { buildInjectionText } from "../lib/inject.js";
import { createSessionMetaResolver, isCodeSession } from "../lib/session-kind.js";
import registerShiguangjiInject, {
  __clearInjectTrackersForTest,
  __setInjectNowForTest,
} from "../extensions/inject.js";
import { attachInject } from "../lib/inject-app.js";

const BASE_DIR = path.join(os.tmpdir(), `sgj-code-mode-${Date.now()}`);
const FIXED_NOW = new Date(2026, 9, 26, 9, 10, 0);

before(() => {
  fs.mkdirSync(BASE_DIR, { recursive: true });
  __setSharedUserDataForTest(new UserData(BASE_DIR));
  __setInjectNowForTest(() => FIXED_NOW);
});

function makeData(tag) {
  const data = new UserData(path.join(BASE_DIR, `${tag}-${Math.random().toString(36).slice(2)}`));
  __setSharedUserDataForTest(data);
  return data;
}

function makeHandler() {
  const handlers = {};
  registerShiguangjiInject({ on(type, fn) { handlers[type] = fn; } });
  return handlers.before_agent_start;
}

function codeCtx(sessionId, extra = {}) {
  return {
    agentId: "hanako",
    model: { provider: "deepseek", id: "deepseek-chat" },
    sessionNamespace: "code",
    sessionManager: { getSessionId: () => sessionId },
    ...extra,
  };
}

function homeCtx(sessionId) {
  return {
    agentId: "hanako",
    model: { provider: "openai", id: "gpt-5.6" },
    sessionNamespace: "home",
    sessionManager: { getSessionId: () => sessionId },
  };
}

// ── 配置归一化 ──

test("Code 页注入项：缺省只留峰谷，写坏的键不认，布尔值才生效", () => {
  assert.deepEqual(normalizeCodeInjectionItems(undefined), { ...DEFAULT_CODE_INJECTION_ITEMS });
  assert.deepEqual(normalizeCodeInjectionItems("坏数据"), { ...DEFAULT_CODE_INJECTION_ITEMS });
  assert.deepEqual(normalizeCodeInjectionItems([1, 2]), { ...DEFAULT_CODE_INJECTION_ITEMS });

  const merged = normalizeCodeInjectionItems({ weather: true, todos: false, peak: false, bogus: true });
  assert.equal(merged.weather, true);
  assert.equal(merged.todos, false);
  assert.equal(merged.peak, false, "亲手关掉的项不能被默认值盖回来");
  assert.equal(merged.archive, false);
  assert.equal("bogus" in merged, false, "清单外的键不该被存下去");

  // 字符串 "true" 不算打开：宁可少带一块，也别照着乱七八糟的值乱塞。
  assert.equal(normalizeCodeInjectionItems({ weather: "true" }).weather, false);
});

// ── 文案 ──

test("Code 页文案只留时间与一句页脚，不带历史档案的日期硬约束", () => {
  const text = buildInjectionText({ now: FIXED_NOW, codeMode: true, force: true });
  assert.match(text, /【今日时光】2026年10月26日星期一 09:10/);
  assert.match(text, /以上是此刻的时间与背景/);
  assert.ok(!text.includes("日期硬约束"), "Code 页不该背一套日期宪法");
  assert.ok(!text.includes("上面这些是你手上关于今天"), "也不该带普通窗口那份事实边界长句");
});

test("普通窗口的页脚保持原样", () => {
  const text = buildInjectionText({ now: FIXED_NOW, force: true });
  assert.match(text, /以上为今日时光背景/);
  assert.ok(!text.includes("以上是此刻的时间与背景"));
});

// ── 扩展：Code 页行为 ──

test("Code 页默认只带时间和峰谷，纪念日、待办、天气都不进来", async () => {
  __clearInjectTrackersForTest();
  const data = makeData("code-default");
  const today = dateKey(FIXED_NOW);
  await data.addEvent({ title: "不该出现的纪念日", type: "event", date: today });
  await data.addEvent({ title: "不该出现的待办", type: "todo", date: today, reminderStart: "08:00", reminderEnd: "08:00" });
  await data.setWeatherCache({
    location: "四川省 成都市 武侯区",
    fetchedAt: FIXED_NOW.getTime(),
    result: { place: "四川省 成都市 武侯区", line: "小雨淅沥，10°C", temp: 10, code: 61, isDay: true },
  });
  await data.updateSettings({ weatherLocation: "四川省 成都市 武侯区", weatherArea: { code: "510107" } });

  const handler = makeHandler();
  const result = handler({}, codeCtx("code-default-session"));

  assert.ok(result?.message, "Code 页默认应该带上这一轮的时间");
  const content = result.message.content;
  assert.match(content, /【今日时光】2026年10月26日/);
  assert.match(content, /【模型峰谷关照】/, "默认开着的峰谷关照要跟着来");
  assert.ok(!content.includes("不该出现的纪念日"));
  assert.ok(!content.includes("不该出现的待办"));
  assert.ok(!content.includes("【窗外】"));
  assert.ok(!content.includes("近期"), "默认不带近期动态");
  assert.equal(result.message.details.codeMode, true);
});

test("Code 页总闸一关，连峰谷都不带", async () => {
  __clearInjectTrackersForTest();
  const data = makeData("code-master-off");
  await data.updateSettings({ codeInjectionEnabled: false });
  const handler = makeHandler();
  const result = handler({}, codeCtx("code-master-off-session"));
  assert.equal(result, undefined, "一键关掉后 Code 页一句都不该带");

  await data.updateSettings({ codeInjectionEnabled: true });
  __clearInjectTrackersForTest();
  const restored = handler({}, codeCtx("code-master-off-session"));
  assert.ok(restored?.message, "重新打开后下一轮恢复");
});

test("Code 页关掉峰谷项后只剩时间", async () => {
  __clearInjectTrackersForTest();
  const data = makeData("code-peak-off");
  await data.updateSettings({ codeInjectionItems: { peak: false } });
  const handler = makeHandler();
  const result = handler({}, codeCtx("code-peak-off-session"));
  assert.ok(result?.message);
  assert.match(result.message.content, /【今日时光】/);
  assert.ok(!result.message.content.includes("模型峰谷关照"));
});

test("Code 页选上天气才带窗外，选上待办才列待办", async () => {
  __clearInjectTrackersForTest();
  const data = makeData("code-weather-on");
  const today = dateKey(FIXED_NOW);
  await data.addEvent({ title: "查一下接口", type: "todo", date: today, reminderStart: "08:00", reminderEnd: "08:00" });
  await data.setWeatherCache({
    location: "四川省 成都市 武侯区",
    fetchedAt: FIXED_NOW.getTime(),
    result: { place: "四川省 成都市 武侯区", line: "小雨淅沥，10°C", temp: 10, code: 61, isDay: true },
  });
  await data.updateSettings({
    weatherLocation: "四川省 成都市 武侯区",
    weatherArea: { code: "510107" },
    codeInjectionItems: { weather: true, todos: true },
  });
  const handler = makeHandler();
  const result = handler({}, codeCtx("code-weather-on-session"));
  assert.ok(result?.message);
  assert.ok(result.message.content.includes("【窗外】"));
  assert.match(result.message.content, /今日待办：查一下接口/);
});

test("同一分钟同一份内容不重复塞，换了一分钟就带新的时间", async () => {
  __clearInjectTrackersForTest();
  makeData("code-dedupe");
  const handler = makeHandler();
  const ctx = codeCtx("code-dedupe-session", { model: { provider: "openai", id: "gpt-5.6" } });
  const first = handler({}, ctx);
  assert.ok(first?.message);
  assert.equal(handler({}, ctx), undefined, "同一分钟不该再塞一条一样的时间");

  __setInjectNowForTest(() => new Date(2026, 9, 26, 9, 12, 0));
  const later = handler({}, ctx);
  assert.ok(later?.message, "时间变了要重新带");
  assert.match(later.message.content, /09:12/);
  __setInjectNowForTest(() => FIXED_NOW);
});

test("普通窗口不受影响：纪念日照常进来", async () => {
  __clearInjectTrackersForTest();
  const data = makeData("home-unchanged");
  await data.addEvent({ title: "普通窗口的纪念日", type: "event", date: dateKey(FIXED_NOW) });
  await data.updateSettings({ codeInjectionItems: { peak: false } });
  const handler = makeHandler();
  const result = handler({}, homeCtx("home-unchanged-session"));
  assert.ok(result?.message);
  assert.ok(result.message.content.includes("普通窗口的纪念日"));
  assert.ok(!result.message.content.includes("以上是此刻的时间与背景"));
});

test("Code 页的峰谷只认那屏的勾选，不被聊天那屏的开关彫住", async () => {
  __clearInjectTrackersForTest();
  const data = makeData("code-peak-own");
  // 聊天那屏把峰谷关了，Code 页勾着就该照带（两屏各管各的）
  await data.updateSettings({ deepseekPeakEnabled: false });
  const handler = makeHandler();
  const result = handler({}, codeCtx("code-peak-own-session"));
  assert.ok(result?.message);
  assert.match(result.message.content, /【模型峰谷关照】/);
});

test("两个开关各管各的：聊天关了，Code 页照样带时间和峰谷", async () => {
  __clearInjectTrackersForTest();
  const data = makeData("code-own-switch");
  await data.updateSettings({ injectionEnabled: false });
  const handler = makeHandler();
  const result = handler({}, codeCtx("code-own-switch-session"));
  assert.ok(result?.message, "聊天那开关关着，Code 页不该跟着哑");
  assert.match(result.message.content, /【今日时光】/);
  assert.match(result.message.content, /【模型峰谷关照】/);
});

// ── 路由与页面 ──

test("路由：Code 页设置能存能读，坏格式拒收", () => {
  const isolatedHome = fs.mkdtempSync(path.join(os.tmpdir(), "sgj-code-route-"));
  const routeUrl = pathToFileURL(path.resolve("routes/ui.js")).href;
  const childCode = `
    import registerRoutes from ${JSON.stringify(routeUrl)};
    const routes = [];
    const app = {
      get(path, handler) { routes.push({ method: "GET", path, handler }); },
      post(path, handler) { routes.push({ method: "POST", path, handler }); },
      put(path, handler) { routes.push({ method: "PUT", path, handler }); },
      delete(path, handler) { routes.push({ method: "DELETE", path, handler }); },
    };
    registerRoutes(app, { log: { info() {}, warn() {}, error() {} } });
    const post = routes.find((item) => item.method === "POST" && item.path === "/api/settings");
    const get = routes.find((item) => item.method === "GET" && item.path === "/api/settings");
    if (!post || !get) throw new Error("设置路由未注册");
    const callPost = (body) => post.handler({ req: { async json() { return body; } }, json(value) { return value; } });
    const callGet = () => get.handler({ json(value) { return value; } });

    const saved = await callPost({
      codeInjectionEnabled: false,
      codeInjectionItems: { peak: true, weather: true, todos: false },
    });
    if (!saved?.ok) throw new Error("Code 页设置没存上：" + JSON.stringify(saved));
    const settings = (await callGet()).settings;
    if (settings.codeInjectionEnabled !== false) throw new Error("总闸没落盘");
    if (settings.codeInjectionItems.weather !== true) throw new Error("天气项没落盘");
    if (settings.codeInjectionItems.special !== false) throw new Error("未选的项不该被意外打开");
    if (!Array.isArray(settings.codeInjectionItemOptions) || !settings.codeInjectionItemOptions.length) {
      throw new Error("页面拿不到可选清单");
    }

    const bad = await callPost({ codeInjectionItems: "nope" });
    if (bad?.ok) throw new Error("坏格式应当拒收");
    console.log(JSON.stringify({ ok: true, weather: settings.codeInjectionItems.weather }));
  `;
  const result = spawnSync(process.execPath, ["--input-type=module", "-e", childCode], {
    encoding: "utf8",
    env: { ...process.env, USERPROFILE: isolatedHome, HOME: isolatedHome, HANA_HOME: path.join(isolatedHome, ".hanako") },
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /"ok":true/);
});

test("页面产物：聊天 / Code 共用一组设置，靠一个切换键换屏", () => {
  const html = fs.readFileSync(path.resolve("ui/panel.html"), "utf8");
  for (const id of ["context-mode-seg", "context-mode-note", "context-mode-panel", "context-panel-chat", "context-panel-code", "code-injection-items", "peak-seg"]) {
    assert.ok(html.includes(`id="${id}"`), `页面里缺 ${id}`);
  }
  assert.ok(!html.includes("这一屏配"), "切换键不再挂一个多余的标签");
  assert.ok(html.includes("聊天情境·开"), "主页第一个开关说清楚自己管聊天");
  assert.ok(html.includes('id="code-context-toggle-btn"'), "主页要有第二个开关管 Code");
  assert.match(html, /function toggleCodeInjectionQuick/);
  assert.ok(!html.includes("presetCodeInjectionItems"), "Code 屏不再摆快捷预设按钮");
  assert.ok(!html.includes('id="code-injection-item-actions"'));
  assert.match(html, /function syncContextModeUi/);
  assert.match(html, /context-mode-note\[data-mode="code"\]/);
  assert.match(html, /codeInjectionItems: codeInjectionItemsFromUI\(\)/);
});

// ── 适配层 ──

test("适配层：session:get 说是 Code 页，就把精简那套接上", async () => {
  __clearInjectTrackersForTest();
  const data = makeData("adapter-code");
  await data.addEvent({ title: "适配层不该带的日子", type: "event", date: dateKey(FIXED_NOW) });
  const hooks = {};
  const asked = [];
  const ctx = {
    dataDir: data.dataDir,
    resources: null,
    bus: {
      async request(name, payload) {
        asked.push(name);
        if (name === "session:entries") return { entries: [], leafId: null };
        if (name === "session:get") return { session: { namespace: "code", title: "改拾光记" } };
        return null;
      },
    },
    hooks: { onDecision(name, fn) { hooks[name] = fn; } },
  };
  attachInject(ctx, () => {});
  const out = await hooks["agent/before-start"]({
    session: { sessionId: "adapter-code-session", sessionPath: "D:/hana/agents/hanako/sessions/a.jsonl" },
    model: { provider: "openai", id: "gpt-5.6" },
  });
  assert.ok(asked.includes("session:get"), "分区只能靠 session:get 问");
  assert.ok(out?.message?.content.includes("【今日时光】"), "Code 页至少带时间");
  assert.ok(!out.message.content.includes("适配层不该带的日子"), "勾选之外的块不进去");
});

// ── 会话分区判断 ──

test("会话分区：只有 session:get 的 namespace 说得清 Code 页，查一次就缓存", async () => {
  let calls = 0;
  const bus = {
    async request(name, payload) {
      calls += 1;
      assert.equal(name, "session:get");
      assert.equal(payload.sessionId, "sess_code_1");
      return { session: { namespace: "code", title: "改拾光记" } };
    },
  };
  const resolve = createSessionMetaResolver({ bus });
  const first = await resolve({ sessionId: "sess_code_1" });
  assert.equal(first.namespace, "code");
  assert.equal(first.title, "改拾光记");
  assert.equal(isCodeSession(first.namespace), true);
  const second = await resolve({ sessionId: "sess_code_1" });
  assert.equal(second.namespace, "code");
  assert.equal(calls, 1, "同一条会话不该反复问宿主");
});

test("会话分区：查不到按普通窗口算，负结果也只保鲜一分钟", async () => {
  let calls = 0;
  const bus = {
    async request() {
      calls += 1;
      throw new Error("Session manifest not found");
    },
  };
  const resolve = createSessionMetaResolver({ bus, negativeTtlMs: 60 * 1000 });
  const input = { sessionId: "sess_unknown", sessionPath: "D:/hana/agents/hanako/sessions/a.jsonl" };
  assert.deepEqual(await resolve(input), { namespace: "", title: "" });
  assert.deepEqual(await resolve(input), { namespace: "", title: "" });
  assert.equal(calls, 2, "id 与路径各试一次就算完，负结果由缓存接着挡");
  assert.equal(isCodeSession(""), false);
  assert.equal(isCodeSession("home"), false);
});
