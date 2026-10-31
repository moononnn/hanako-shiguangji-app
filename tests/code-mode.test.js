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
import { buildDeepSeekContext, buildInjectionText } from "../lib/inject.js";
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

test("Code 页注入项：缺省带时间和峰谷，写坏的键不认，布尔值才生效", () => {
  assert.deepEqual(normalizeCodeInjectionItems(undefined), { ...DEFAULT_CODE_INJECTION_ITEMS });
  assert.deepEqual(normalizeCodeInjectionItems("坏数据"), { ...DEFAULT_CODE_INJECTION_ITEMS });
  assert.deepEqual(normalizeCodeInjectionItems([1, 2]), { ...DEFAULT_CODE_INJECTION_ITEMS });

  const merged = normalizeCodeInjectionItems({ weather: true, todos: false, peak: false, bogus: true });
  assert.equal(merged.weather, true);
  assert.equal(merged.todos, false);
  assert.equal(merged.peak, false, "亲手关掉的项不能被默认值盖回来");
  assert.equal(merged.archive, false);
  assert.equal(merged.time, true, "时间跟其它块一样在清单里，默认带着");
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
  assert.ok(!text.includes("以上是这次带给你的今日背景"), "也不该带普通窗口那份事实边界长句");
});

test("Code 页时间块关掉时：一个块都没有就整轮不注入", () => {
  const text = buildInjectionText({ now: FIXED_NOW, codeMode: true, force: true, includeTimeBlock: false });
  assert.equal(text, null, "没有任何块时不该返回半句话");
});

test("Code 页只给日期不给钟点时：页脚说清是日期", () => {
  const text = buildInjectionText({ now: FIXED_NOW, codeMode: true, force: true, includeTime: false });
  assert.match(text, /【今日时光】2026年10月26日星期一/);
  assert.ok(!text.includes("09:10"), "不该带会过期的钟点");
  assert.match(text, /以上是今天的日期与背景/);
});

test("普通窗口的页脚保持原样", () => {
  const text = buildInjectionText({ now: FIXED_NOW, force: true });
  assert.match(text, /以上为今日时光背景/);
  assert.ok(!text.includes("以上是此刻的时间与背景"));
});

// 峰谷文案只有一份：Code 页与聊天窗口用同一个 buildDeepSeekContext，各通知场景都不另写一套。
test("Code 页的峰谷文案与聊天窗口逐字一致（开场 / 预告 / 补报 / 周末）", () => {
  const nextBoundary = { period: "valley", periodLabel: "谷时段", at: "12:00" };
  const scenarios = [
    { name: "工作日开场", notice: { kind: "detected", period: "peak", periodLabel: "高峰时段", nextBoundary } },
    { name: "换班预告", notice: { kind: "preview", period: "peak", periodLabel: "高峰时段", nextBoundary, previewMinutes: 4 } },
    { name: "错过预告补报", notice: { kind: "entered", period: "valley", periodLabel: "谷时段", nextBoundary: { period: "peak", periodLabel: "高峰时段", at: "14:00" } } },
    { name: "周末全天谷", notice: { kind: "detected", period: "valley", periodLabel: "谷时段", isWeekend: true, nextBoundary: null } },
  ];

  for (const { name, notice: raw } of scenarios) {
    // 固定语气序号，否则三句变体随机取一条，无法逐字比
    const notice = { ...raw, toneIndex: 1 };
    const shared = buildDeepSeekContext(notice, "小满");
    const base = { now: FIXED_NOW, force: true, deepseekNotice: notice, recentSummaryOptions: { userName: "小满" } };
    const pickPeak = (text) => String(text || "").split("\n").find((line) => line.startsWith("【模型峰谷关照】")) || "";
    const chat = pickPeak(buildInjectionText(base));
    const code = pickPeak(buildInjectionText({ ...base, codeMode: true }));

    assert.ok(chat, `${name}：聊天窗口要带峰谷`);
    assert.ok(code, `${name}：Code 页也要带峰谷`);
    assert.equal(code, chat, `${name}：两屏那一句必须一模一样`);
    assert.equal(code, shared, `${name}：Code 页不再有自己的写法`);
    assert.match(code, /保持当前伙伴自己的性格/, `${name}：人格是伙伴自己的`);
    assert.match(code, /朋友视角/, `${name}：朋友视角不分屏`);
    assert.match(code, /只表示模型费用时段/, `${name}：费用口径在`);
    assert.ok(code.includes("小满"), `${name}：称呼用本人的名字`);
    assert.ok(!code.includes("这是费用信息，不是性能信息"), `${name}：Code 专用文案已删`);
  }
});

test("Code 页没选峰谷就不带，选了就跟聊天窗口同一套话", async () => {
  __clearInjectTrackersForTest();
  const data = makeData("code-peak-voice");
  const handler = makeHandler();
  const result = handler({}, codeCtx("code-peak-voice-session"));
  assert.ok(result?.message, "新会话该带一次");
  const peakLine = result.message.content.split("\n").find((line) => line.startsWith("【模型峰谷关照】"));
  assert.ok(peakLine, "默认开着的峰谷关照要跟着来");
  assert.match(peakLine, /保持当前伙伴自己的性格/, "人格用伙伴自己的");
  assert.match(peakLine, /朋友视角/, "不把朋友视角去掉");
  assert.match(peakLine, /梁文峰/, "梗按聊天窗口那套保留");
  assert.match(peakLine, /费用/, "费用口径不变");
  assert.match(peakLine, /哪怕当前只是闲聊也要自然带出一句/, "Code 页也必须说出口");
  assert.ok(!peakLine.includes("这是费用信息，不是性能信息"), "Code 专用文案已删");

  await data.updateSettings({ codeInjectionItems: { peak: false } });
  __clearInjectTrackersForTest();
  const off = handler({}, codeCtx("code-peak-voice-off"));
  assert.ok(off?.message, "只关峰谷，时间和其它块还在");
  assert.ok(!off.message.content.includes("【模型峰谷关照】"), "没勾峰谷就不带");
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

test("默认（相伴）不再每轮都带：间隔内不注入，间隔到了才带", async () => {
  __clearInjectTrackersForTest();
  makeData("code-interval");
  const handler = makeHandler();
  const ctx = codeCtx("code-interval-session", { model: { provider: "openai", id: "gpt-5.6" } });
  const first = handler({}, ctx);
  assert.ok(first?.message, "新会话先带一次");
  assert.match(first.message.content, /【今日时光】2026年10月26日星期一 09:10/);
  assert.equal(handler({}, ctx), undefined, "间隔没到不该再带");

  // 过了 4 小时（默认间隔）才再带一次
  __setInjectNowForTest(() => new Date(2026, 9, 26, 13, 11, 0));
  const later = handler({}, ctx);
  assert.ok(later?.message, "间隔到了要重新带");
  assert.match(later.message.content, /13:11/);
  __setInjectNowForTest(() => FIXED_NOW);
});

test("选「常在」时每轮都带，同一分钟仍不重复塞", async () => {
  __clearInjectTrackersForTest();
  const data = makeData("code-always");
  await data.updateSettings({ codeInjectMode: "always" });
  const handler = makeHandler();
  const ctx = codeCtx("code-always-session", { model: { provider: "openai", id: "gpt-5.6" } });
  const first = handler({}, ctx);
  assert.ok(first?.message);
  assert.equal(handler({}, ctx), undefined, "同一分钟不该再塞一条一样的时间");

  __setInjectNowForTest(() => new Date(2026, 9, 26, 9, 12, 0));
  const later = handler({}, ctx);
  assert.ok(later?.message, "时间变了要重新带");
  assert.match(later.message.content, /09:12/);
  __setInjectNowForTest(() => FIXED_NOW);
});

test("选「适时」时，同一天不再重复带", async () => {
  __clearInjectTrackersForTest();
  const data = makeData("code-economical");
  await data.updateSettings({ codeInjectMode: "economical" });
  const handler = makeHandler();
  const ctx = codeCtx("code-economical-session", { model: { provider: "openai", id: "gpt-5.6" } });
  assert.ok(handler({}, ctx)?.message, "新会话带一次");
  assert.equal(handler({}, ctx), undefined, "同一天不该再带");

  __setInjectNowForTest(() => new Date(2026, 9, 27, 9, 12, 0));
  assert.ok(handler({}, ctx)?.message, "跨天要再带一次");
  __setInjectNowForTest(() => FIXED_NOW);
});

test("时间没勾选时，整行「今日时光」都不进", async () => {
  __clearInjectTrackersForTest();
  const data = makeData("code-no-time");
  await data.updateSettings({ codeInjectionItems: { time: false, peak: false } });
  const handler = makeHandler();
  const ctx = codeCtx("code-no-time-session", { model: { provider: "openai", id: "gpt-5.6" } });
  const result = handler({}, ctx);
  assert.ok(!result, "时间没勾、其它也没勾时，这轮什么都不该注入");
  assert.ok(!result?.message?.content?.includes("【今日时光】"));

  // 把别的块勾上：块进来了，时刻仍然不进
  await data.setWeatherCache({
    location: "四川省 成都市 武侯区",
    fetchedAt: FIXED_NOW.getTime(),
    result: { place: "四川省 成都市 武侯区", line: "小雨淅沥，10°C", temp: 10, code: 61, isDay: true },
  });
  await data.updateSettings({
    weatherLocation: "四川省 成都市 武侯区",
    weatherArea: { code: "510107" },
    codeInjectionItems: { time: false, peak: false, weather: true },
  });
  __clearInjectTrackersForTest();
  const handler2 = makeHandler();
  const withWeather = handler2({}, codeCtx("code-no-time-weather", { model: { provider: "openai", id: "gpt-5.6" } }));
  assert.ok(withWeather?.message, "勾了天气就该带");
  assert.ok(withWeather.message.content.includes("【窗外】"));
  assert.ok(!withWeather.message.content.includes("【今日时光】"), "时间没勾就不该出现日期与时刻");
  assert.ok(!withWeather.message.content.includes("此刻的时间"), "页脚也不能再提时间");
});

test("「适时」档只给日期不给钟点（钟点会过期，带错的比不带更糟）", async () => {
  __clearInjectTrackersForTest();
  const data = makeData("code-econ-time");
  await data.updateSettings({ codeInjectMode: "economical" });
  const handler = makeHandler();
  const result = handler({}, codeCtx("code-econ-time-session", { model: { provider: "openai", id: "gpt-5.6" } }));
  assert.ok(result?.message, "新会话该带一次");
  assert.match(result.message.content, /【今日时光】2026年10月26日星期一/, "日期要给");
  assert.ok(!/09:10/.test(result.message.content), "适时档不该带会过期的钟点");

  // 「相伴」档就要带完整时刻了
  __clearInjectTrackersForTest();
  await data.updateSettings({ codeInjectMode: "balanced" });
  const handler2 = makeHandler();
  const withClock = handler2({}, codeCtx("code-econ-time-session-2", { model: { provider: "openai", id: "gpt-5.6" } }));
  assert.match(withClock.message.content, /09:10/, "相伴档要带钟点");
});

test("页脚不再请她主动报时间", async () => {
  __clearInjectTrackersForTest();
  makeData("code-footer");
  const handler = makeHandler();
  const result = handler({}, codeCtx("code-footer-session", { model: { provider: "openai", id: "gpt-5.6" } }));
  assert.ok(result?.message);
  const text = result.message.content;
  assert.ok(!text.includes("自然带一句"), "旧页脚在请模型主动报时间");
  assert.ok(text.includes("不必在回复里专门报时间"), "新页脚要明说别报时间");
});

test("改了 Code 那屏的设置，下一轮立刻按新的来", async () => {
  __clearInjectTrackersForTest();
  const data = makeData("code-settings-change");
  const handler = makeHandler();
  const ctx = codeCtx("code-settings-change-session", { model: { provider: "openai", id: "gpt-5.6" } });
  assert.ok(handler({}, ctx)?.message, "新会话先带一次");
  assert.equal(handler({}, ctx), undefined, "间隔没到不注入");

  // 把时间关掉：设置变了，不该等间隔，下一轮就该按新设置来（结果是不注入）
  await data.updateSettings({ codeInjectionItems: { time: false, peak: false } });
  assert.equal(handler({}, ctx), undefined, "时间关掉后这轮不该再带时刻");

  // 再把方式改成常在、并且把时间打开：下一次立刻按新设置来
  // （推到下一分钟：同一分钟同一份内容会被去重挡掉，那是另一条规则）
  await data.updateSettings({ codeInjectMode: "always", codeInjectionItems: { time: true, peak: false } });
  __setInjectNowForTest(() => new Date(2026, 9, 26, 9, 11, 0));
  const again = handler({}, ctx);
  assert.ok(again?.message, "设置变了就该立即生效");
  assert.match(again.message.content, /【今日时光】2026年10月26日星期一 09:11/);
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
      codeInjectionItems: { time: false, peak: true, weather: true, todos: false },
      codeInjectMode: "always",
      codeInjectIntervalHours: 1,
    });
    if (!saved?.ok) throw new Error("Code 页设置没存上：" + JSON.stringify(saved));
    const settings = (await callGet()).settings;
    if (settings.codeInjectionEnabled !== false) throw new Error("总闸没落盘");
    if (settings.codeInjectionItems.weather !== true) throw new Error("天气项没落盘");
    if (settings.codeInjectionItems.special !== false) throw new Error("未选的项不该被意外打开");
    if (settings.codeInjectionItems.time !== false) throw new Error("时间项没落盘");
    if (!Array.isArray(settings.codeInjectionItemOptions) || !settings.codeInjectionItemOptions.length) {
      throw new Error("页面拿不到可选清单");
    }
    if (!settings.codeInjectionItemOptions.some((item) => item.id === "time")) {
      throw new Error("时间不在可选清单里");
    }
    if (settings.codeInjectMode !== "always") throw new Error("Code 页带入方式没落盘");
    if (settings.codeInjectIntervalHours !== 1) throw new Error("Code 页间隔没落盘");

    const bad = await callPost({ codeInjectionItems: "nope" });
    if (bad?.ok) throw new Error("坏格式应当拒收");
    const badMode = await callPost({ codeInjectMode: "乱写" });
    if (badMode?.ok) throw new Error("坏的带入方式应当拒收");
    const badInterval = await callPost({ codeInjectIntervalHours: 3 });
    if (badInterval?.ok) throw new Error("坏的间隔应当拒收");
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
  for (const id of ["context-mode-seg", "context-mode-note", "context-mode-panel", "context-panel-chat", "context-panel-code", "code-injection-items", "peak-seg",
    "code-mode-seg", "code-interval-seg"]) {
    assert.ok(html.includes(`id="${id}"`), `页面里缺 ${id}`);
  }
  assert.match(html, /function syncCodeModeUi/);
  assert.match(html, /codeInjectMode: segVal\('code-mode-seg'\)/);
  assert.match(html, /codeInjectIntervalHours: \+segVal\('code-interval-seg'\)/);
  assert.ok(!html.includes('id="code-time-seg"'), "时间不再单独当开关，并进多选清单里了");
  assert.match(html, /\{ id: 'time', label: '当前时间' \}/);
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

test("会话分区：宿主没答上来（超时、报错）时，判成未知而不是「查不到」", async () => {
  let calls = 0;
  const bus = {
    async request() {
      calls += 1;
      throw new Error("Session manifest not found");
    },
  };
  const resolve = createSessionMetaResolver({ bus, negativeTtlMs: 60 * 1000 });
  const input = { sessionId: "sess_unknown", sessionPath: "D:/hana/agents/hanako/sessions/a.jsonl" };
  // 宿主压根没答上来：这轮什么都不知道，不能当成「宿主没有这个会话」（那是闲聊的形状）。
  assert.deepEqual(await resolve(input), { namespace: "", title: "", status: "unknown" });
  assert.deepEqual(await resolve(input), { namespace: "", title: "", status: "unknown" });
  assert.equal(calls, 2, "id 与路径各试一次就算完，结果由缓存接着挡");
  assert.equal(isCodeSession(""), false);
  assert.equal(isCodeSession("home"), false);
});

test("会话分区：宿主答了但没有这个会话，是「查不到」不是「没答上来」", async () => {
  let calls = 0;
  const bus = {
    async request() {
      calls += 1;
      return null; // 宿主答了，但它没有这个会话
    },
  };
  const resolve = createSessionMetaResolver({ bus, negativeTtlMs: 60 * 1000 });
  const input = { sessionId: "sess_casual", sessionPath: "D:/hana/agents/hanako/sessions/b.jsonl" };
  const out = await resolve(input);
  assert.equal(out.namespace, "");
  assert.equal(out.status, "not-found", "宿主明确说没有，这才轮到「闲聊窗口」那个开关说话");
  assert.equal(calls, 2, "id 与路径各试一次");
});
