// 拾光记 · 注入冲突回归
// 这一组锁的是几处「两套判定互相踩」的真 bug：
//   1. 峰谷状态被陈旧的情境状态覆盖 → 关情境→预告→开情境时同一场换班预告报两遍
//   2. 峰谷/天气提醒自己到点时，顺手把整份情境塞进来，还把情境计时往后推
//   3. 同 hash 去重分支里那个没定义的变量，让状态没存成
//   4. 分区查不清时按聊天窗口算，把生活全套塞进 Code
//   5. Code 那屏跟着聊天的伙伴屏蔽一起哑
import { test, before } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { UserData } from "../lib/data.js";
import { __setSharedUserDataForTest } from "../lib/shared-data.js";
import { buildInjectionText, buildDeepSeekContext } from "../lib/inject.js";
import { DEFAULT_CODE_INJECTION_ITEMS, resolveCodeInjection } from "../lib/code-mode.js";
import registerShiguangjiInject, {
  __clearInjectTrackersForTest,
  __setInjectNowForTest,
} from "../extensions/inject.js";
import { attachInject, codeWeatherEnabled } from "../lib/inject-app.js";

const BASE_DIR = path.join(os.tmpdir(), `sgj-inject-conflicts-${Date.now()}`);
const DEEPSEEK = { provider: "openrouter", id: "deepseek/deepseek-v4-flash" };
const OTHER_MODEL = { provider: "openai", id: "gpt-5.6" };

before(() => {
  fs.mkdirSync(BASE_DIR, { recursive: true });
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

function chatCtx(sessionId, extra = {}) {
  return {
    agentId: "hanako",
    model: DEEPSEEK,
    sessionNamespace: "home",
    sessionManager: { getSessionId: () => sessionId },
    ...extra,
  };
}

function codeCtx(sessionId, extra = {}) {
  return {
    agentId: "hanako",
    model: DEEPSEEK,
    sessionNamespace: "code",
    sessionManager: { getSessionId: () => sessionId },
    ...extra,
  };
}

// 2026-09-07 周一：09:00-12:00 高峰，11:56 落在换班前 4 分钟的预告窗口里。
const local = (h, m, s = 0) => new Date(2026, 8, 7, h, m, s);

async function readInjectionState(data, sessionId) {
  await data.injectionState.update(() => {});
  return data.getInjectionState(sessionId);
}

async function readPeakState(data, sessionId) {
  await data.deepseekPeak.update(() => {});
  return data.getDeepSeekPeakState(sessionId);
}

// ── 1. 关情境 → 预告 → 开情境，同一场换班不报第二遍 ──

test("峰谷：关情境→预告→开情境不重复预告（情境状态不许覆盖峰谷真状态）", async () => {
  __clearInjectTrackersForTest();
  const data = makeData("chat-peak-toggle");
  await data.updateSettings({ injectionEnabled: true });
  __setInjectNowForTest(() => local(10, 0));
  try {
    const handler = makeHandler();
    const ctx = chatCtx("peak-toggle-session");
    const first = handler({}, ctx);
    assert.ok(first?.message, "新窗口先带一次情境与峰谷");
    assert.equal(first.message.details.deepseekNotice, true);
    assert.ok(first.message.content.includes("【模型峰谷关照】"));

    // 她把情境关掉：峰谷关照自己还有开关，照常判
    await data.updateSettings({ injectionEnabled: false });
    assert.equal(handler({}, ctx), undefined, "同一时段关掉情境后不该再说一遍");

    // 11:56，换班前 4 分钟：只剩峰谷预告这一条
    __setInjectNowForTest(() => local(11, 56));
    const preview = handler({}, ctx);
    assert.ok(preview?.message, "换班预告是硬触发，情境关着也要说");
    assert.ok(preview.message.content.includes("【模型峰谷关照】"), preview.message.content);
    assert.ok(!preview.message.content.includes("【今日时光】"), "预告不该把生活情境一起带进来");
    assert.equal(preview.message.details.deepseekNotice, true);

    // 11:57 她又把情境打开：情境这轮刷新，但预告已经说过了，不许再来一遍
    await data.updateSettings({ injectionEnabled: true });
    __setInjectNowForTest(() => local(11, 57));
    const reenabled = handler({}, ctx);
    assert.ok(reenabled?.message, "重新打开情境，下一轮按新设置刷新");
    assert.ok(!reenabled.message.content.includes("【模型峰谷关照】"), "同一场换班预告只能出现一次");
    assert.notEqual(reenabled.message.details.deepseekNotice, true);

    // 峰谷真状态记在它自己那本账上，预览过的那条边界也在
    const peak = await readPeakState(data, "peak-toggle-session");
    assert.equal(peak.dsActive, true);
    assert.equal(peak.dsPeriod, "peak");
    assert.ok(peak.dsPreviewKeys.includes("2026-09-07@12:00"), JSON.stringify(peak));
  } finally {
    __setInjectNowForTest(null);
  }
});

test("峰谷：一开始关着、后来打开，开场那一次不重报", async () => {
  __clearInjectTrackersForTest();
  const data = makeData("chat-peak-off-first");
  await data.updateSettings({ injectionEnabled: false });
  __setInjectNowForTest(() => local(10, 0));
  try {
    const handler = makeHandler();
    const ctx = chatCtx("peak-off-first-session");
    const peakOnly = handler({}, ctx);
    assert.ok(peakOnly?.message, "情境关着，峰谷照常开场一次");
    assert.equal(peakOnly.message.details.deepseekNotice, true);
    assert.ok(!peakOnly.message.content.includes("【今日时光】"));

    await data.updateSettings({ injectionEnabled: true });
    __setInjectNowForTest(() => local(10, 5));
    const scenario = handler({}, ctx);
    assert.ok(scenario?.message, "打开情境后下一轮立刻刷新");
    assert.ok(scenario.message.content.includes("【今日时光】"));
    assert.ok(!scenario.message.content.includes("【模型峰谷关照】"), "开场时段已经说过，不再重报");
    assert.notEqual(scenario.message.details.deepseekNotice, true);
  } finally {
    __setInjectNowForTest(null);
  }
});

// ── 2. 峰谷 / 天气提醒单独触发：不带情境、不动情境计时 ──

test("聊天：峰谷单独触发只发峰谷，不带当天日子，也不推进情境刷新计时", async () => {
  __clearInjectTrackersForTest();
  const data = makeData("chat-peak-only");
  await data.addEvent({ title: "峰谷单独触发锚点", type: "event", date: "2026-09-07" });
  __setInjectNowForTest(() => local(10, 0));
  try {
    const handler = makeHandler();
    const ctx = chatCtx("peak-only-timer-session");
    const first = handler({}, ctx);
    assert.ok(first?.message.content.includes("峰谷单独触发锚点"));
    const firstState = await readInjectionState(data, "peak-only-timer-session");
    assert.equal(firstState.lastInjectAt, local(10, 0).getTime());

    // 11:56 换班预告：情境还在 4 小时间隔内，只该发预告
    __setInjectNowForTest(() => local(11, 56));
    const preview = handler({}, ctx);
    assert.ok(preview?.message, "预告要说话");
    assert.ok(!preview.message.content.includes("峰谷单独触发锚点"), "notice-only 不该带当天日子");
    assert.ok(!preview.message.content.includes("【今日时光】"), "notice-only 不该带今日时光");
    assert.ok(preview.message.content.includes("【模型峰谷关照】"));
    assert.equal(preview.message.details.noticeOnly, true);
    assert.equal(preview.message.customType, "shiguangji-deepseek-peak");

    const afterNotice = await readInjectionState(data, "peak-only-timer-session");
    assert.equal(afterNotice.lastInjectAt, firstState.lastInjectAt, "预告不能把情境计时往后推");
    assert.equal(afterNotice.lastHash, firstState.lastHash, "也不该改情境的内容指纹");

    // 预告刚说完一轮内，什么都不该再冒出来
    __setInjectNowForTest(() => local(11, 58));
    assert.equal(handler({}, ctx), undefined, "情境没到期、预告已说过，这轮该静默");
  } finally {
    __setInjectNowForTest(null);
  }
});

test("聊天：天气提醒单独触发时不带情境，也不推进天气软提及冷却", async () => {
  __clearInjectTrackersForTest();
  const data = makeData("chat-weather-alert");
  const location = "四川省 成都市 武侯区";
  await data.updateSettings({
    weatherLocation: location,
    weatherArea: { code: "510107" },
    weatherEnabled: true,
    weatherAlertEnabled: true,
  });
  const hours = [];
  for (let i = 0; i < 24; i += 1) hours.push(`2026-09-07T${String(i).padStart(2, "0")}:00`);
  const forecastOf = (temps) => ({
    timezone: "Asia/Shanghai",
    utcOffsetSeconds: 28800,
    hourly: {
      time: hours,
      temperature_2m: temps,
      apparent_temperature: hours.map(() => 18),
      weather_code: hours.map(() => 0),
      precipitation_probability: hours.map(() => 0),
      wind_gusts_10m: hours.map(() => 5),
    },
    daily: {
      time: ["2026-09-07", "2026-09-08"],
      weather_code: [0, 0],
      temperature_2m_max: [20, 20],
      temperature_2m_min: [14, 14],
      precipitation_probability_max: [0, 0],
      wind_gusts_10m_max: [10, 10],
    },
  });
  await data.setWeatherCache({
    location,
    fetchedAt: local(10, 0).getTime(),
    result: { place: location, line: "阴天，18°C", temp: 18, code: 3, isDay: true },
  });
  // 第一份预报平平稳稳：开场那一轮不该有提醒
  await data.setWeatherForecastCache({
    location,
    fetchedAt: local(10, 0).getTime(),
    forecast: forecastOf(hours.map(() => 18)),
  });
  __setInjectNowForTest(() => local(10, 0));
  try {
    const handler = makeHandler();
    const ctx = chatCtx("weather-alert-only-session");
    const first = handler({}, ctx);
    assert.ok(first?.message, "新窗口先带一次情境");
    assert.ok(!first.message.content.includes("【天气提醒】"), first.message.content);
    const firstState = await readInjectionState(data, "weather-alert-only-session");
    assert.equal(firstState.lastInjectAt, local(10, 0).getTime());

    // 十分钟后预报换成明显降温：情境还在间隔内，提醒该单独开口
    await data.setWeatherForecastCache({
      location,
      fetchedAt: local(10, 5).getTime(),
      forecast: forecastOf(hours.map((_, i) => (i >= 13 ? 8 : 18))),
    });
    __setInjectNowForTest(() => local(10, 10));
    const alert = handler({}, ctx);
    assert.ok(alert?.message, "天气提醒自己到点就要开口");
    assert.ok(alert.message.content.includes("【天气提醒】"), alert.message.content);
    assert.ok(!alert.message.content.includes("【今日时光】"), "提醒单独发时不带整份情境");
    assert.equal(alert.message.customType, "shiguangji-weather-alert");
    assert.ok(!alert.message.content.includes("比上面那份情境材料更新"), "上面没有情境材料时不能这么说");

    const afterAlert = await readInjectionState(data, "weather-alert-only-session");
    assert.equal(afterAlert.lastInjectAt, firstState.lastInjectAt, "提醒不能推进情境计时");
    assert.equal(afterAlert.weatherLastMentionAt, firstState.weatherLastMentionAt, "也不该动天气软提及冷却");
  } finally {
    __setInjectNowForTest(null);
  }
});

test("Code：峰谷单独触发只发峰谷，不带时间块，也不推进刷新计时", async () => {
  __clearInjectTrackersForTest();
  const data = makeData("code-peak-only");
  __setInjectNowForTest(() => local(10, 0));
  try {
    const handler = makeHandler();
    const ctx = codeCtx("code-peak-only-session");
    const first = handler({}, ctx);
    assert.ok(first?.message, "新会话该带一次时间");
    assert.ok(first.message.content.includes("【今日时光】"));
    const firstState = await readInjectionState(data, "code-peak-only-session");
    assert.equal(firstState.lastInjectAt, local(10, 0).getTime());

    __setInjectNowForTest(() => local(11, 56));
    const preview = handler({}, ctx);
    assert.ok(preview?.message, "换班预告不吃频率");
    assert.ok(preview.message.content.includes("【模型峰谷关照】"));
    // 单独发的这条也是聊天窗口同一份文案：不另起一套 Code 写法。
    assert.match(preview.message.content, /保持当前伙伴自己的性格/, "峰谷文案与聊天同源");
    assert.match(preview.message.content, /朋友视角/);
    assert.ok(!preview.message.content.includes("这是费用信息，不是性能信息"), "Code 专用文案已删");
    assert.ok(!preview.message.content.includes("【今日时光】"), "只发峰谷时不该顺手带时间");
    assert.equal(preview.message.details.codeMode, true);
    assert.equal(preview.message.details.noticeOnly, true);

    const after = await readInjectionState(data, "code-peak-only-session");
    assert.equal(after.lastInjectAt, firstState.lastInjectAt, "峰谷单独触发不能推进 Code 的刷新计时");
  } finally {
    __setInjectNowForTest(null);
  }
});

test("Code 页与聊天窗口共用同一份峰谷文案（人格、朋友视角、费用口径都不分屏）", () => {
  const notice = {
    kind: "preview",
    period: "peak",
    periodLabel: "高峰时段",
    nextBoundary: { period: "valley", periodLabel: "谷时段", at: "12:00" },
    previewMinutes: 4,
    toneIndex: 2,
  };
  const pickPeakLine = (text) => String(text || "").split("\n").find((line) => line.startsWith("【模型峰谷关照】")) || "";
  const shared = buildDeepSeekContext(notice, "小满");
  const now = local(11, 56);
  const options = { now, force: true, deepseekNotice: notice, recentSummaryOptions: { userName: "小满" } };

  const chatLine = pickPeakLine(buildInjectionText(options));
  const codeLine = pickPeakLine(buildInjectionText({ ...options, codeMode: true }));
  assert.ok(chatLine, "聊天窗口要带峰谷关照");
  assert.ok(codeLine, "Code 页也要带峰谷关照");
  assert.equal(codeLine, chatLine, "Code 页那一句必须就是聊天窗口那一句");
  assert.equal(codeLine, shared, "两屏都不该再有自己的写法");

  assert.match(codeLine, /费用/, "费用事实要在");
  assert.match(codeLine, /第三方供应商/, "第三方不保证官方价格要写清");
  assert.match(codeLine, /不要把它解释成/, "禁止性能联想");
  assert.match(codeLine, /保持当前伙伴自己的性格/, "人格要用伙伴自己的");
  assert.match(codeLine, /朋友视角/, "朋友视角要保留");
  assert.match(codeLine, /梁文峰/, "两屏一致的梗还在");
  // 「必须说出口」这条也不分屏：开峰谷提醒就是为了知道当下时段。
  assert.match(codeLine, /哪怕当前只是闲聊也要自然带出一句/, "Code 页也要下硬要求");
  assert.ok(!codeLine.includes("这是费用信息，不是性能信息"), "Code 专用那份文案已经删了");
  assert.ok(!codeLine.includes("不要铺陈"), "也不再有 Code 专用的短文案措辞");
  assert.ok(!codeLine.includes("话题合适"), "不许再留「话题合适才提」的口子");
  assert.ok(!codeLine.includes("专心处理问题就先不提"), "不许再写「忙就先不提」");
});

test("峰谷结尾与块同一档：开场/补报/预告一律硬要求说出口", () => {
  const base = {
    period: "peak",
    periodLabel: "高峰时段",
    nextBoundary: { period: "valley", periodLabel: "谷时段", at: "12:00" },
    previewMinutes: 4,
  };
  const now = local(11, 56);
  const preview = buildInjectionText({ now, force: true, deepseekNotice: { ...base, kind: "preview" } });
  assert.match(preview, /要在本轮回复里带出一句/);
  assert.ok(!preview.includes("是软性的"), "预告是硬触发，结尾不能说软");

  const detected = buildInjectionText({ now, force: true, deepseekNotice: { ...base, kind: "detected" } });
  assert.match(detected, /请在本轮回复里自然带一句/);
  assert.match(detected, /要在本轮回复里带出一句/, "detected 这轮就要说，结尾不能打折");

  // entered 是「错过预告后的补报」，同样是到点提醒本身。
  // 实测教训（2026-10-27）：这里原先把 entered 归成「软性、话题不搭就不带」，
  // 结果 Code 页开场明明注入了峰谷却一句不说，与「开峰谷提醒就是为了知道当下时段」相违。
  const entered = buildInjectionText({ now, force: true, deepseekNotice: { ...base, kind: "entered" } });
  assert.match(entered, /请在本轮回复里自然带一句/, "entered 也要下硬要求");
  assert.ok(!entered.includes("如果这轮对话话题合适"), "不许再留「话题合适才提」这种口子");
  assert.ok(!entered.includes("是软性的"), "entered 不再是软性补报");
  assert.match(entered, /要在本轮回复里带出一句/, "结尾要和块同一档");
  assert.match(entered, /哪怕当前只是闲聊也要自然带出一句/, "开场/补报都要硬带");
});

test("情境到期时峰谷提醒可以并进来，计时按普通刷新走", async () => {
  __clearInjectTrackersForTest();
  const data = makeData("chat-peak-combined");
  await data.addEvent({ title: "合并注入锚点", type: "event", date: "2026-09-07" });
  __setInjectNowForTest(() => local(10, 0));
  try {
    const handler = makeHandler();
    const ctx = chatCtx("peak-combined-session", { model: OTHER_MODEL });
    const first = handler({}, ctx);
    assert.ok(first?.message.content.includes("合并注入锚点"));
    assert.ok(!first.message.content.includes("【模型峰谷关照】"), "非 DeepSeek 模型不报峰谷");

    // 过了 4 小时间隔，换到 DeepSeek：情境自己到期，峰谷提醒并进来，一起算这一次普通刷新
    __setInjectNowForTest(() => local(14, 1));
    const combined = handler({}, chatCtx("peak-combined-session"));
    assert.ok(combined?.message, "间隔到了要刷新");
    assert.ok(combined.message.content.includes("【今日时光】"), "情境块要在");
    assert.ok(combined.message.content.includes("合并注入锚点"), "当天日子也要在");
    assert.ok(combined.message.content.includes("【模型峰谷关照】"), "峰谷提醒能并进来");
    assert.equal(combined.message.details.deepseekNotice, true);
    assert.notEqual(combined.message.details.noticeOnly, true, "这是整份情境，不是 notice-only");

    const state = await readInjectionState(data, "peak-combined-session");
    assert.equal(state.lastInjectAt, local(14, 1).getTime(), "按普通刷新计时");
    assert.ok(state.lastHash, "内容指纹要更新");
  } finally {
    __setInjectNowForTest(null);
  }
});

test("Code：没勾天气或总闸关着就不去预取天气", async () => {
  __clearInjectTrackersForTest();
  const data = makeData("code-weather-prefetch");
  // 默认清单：带了时间和峰谷，没带天气
  assert.equal(codeWeatherEnabled("hanako"), false, "没勾天气就不该预取");

  await data.updateSettings({ codeInjectionItems: { time: true, peak: true, weather: true } });
  assert.equal(codeWeatherEnabled("hanako"), true, "勾了天气就要预取");

  await data.updateSettings({ codeInjectionEnabled: false });
  assert.equal(codeWeatherEnabled("hanako"), false, "Code 总闸关掉就一律不查");

  // 被单独关闭的伙伴：哪怕勾了天气也不去查；名单外的人照常查
  await data.updateSettings({ codeInjectionEnabled: true, codeInjectionDisabledAgentIds: ["agent-a"] });
  assert.equal(codeWeatherEnabled("agent-a"), false, "被屏蔽的伙伴不该去查天气");
  assert.equal(codeWeatherEnabled("agent-b"), true, "名单外的伙伴照常预取");
});

// ── 3. 同 hash 去重分支也要存状态 ──

test("同 hash 去重：状态照样落盘，计时跟着这一轮走", async () => {
  __clearInjectTrackersForTest();
  const data = makeData("chat-same-hash");
  await data.updateSettings({ injectMode: "always" });
  __setInjectNowForTest(() => local(10, 0, 10));
  try {
    const handler = makeHandler();
    const ctx = chatCtx("same-hash-session", { model: OTHER_MODEL });
    const first = handler({}, ctx);
    assert.ok(first?.message, "新会话先带一次");
    const firstState = await readInjectionState(data, "same-hash-session");

    // 同一分钟、同样的内容：不该塞第二条，但状态要更新成这一轮的
    __setInjectNowForTest(() => local(10, 0, 40));
    assert.equal(handler({}, ctx), undefined, "同一分钟同一份内容不重复注入");
    const secondState = await readInjectionState(data, "same-hash-session");
    assert.equal(secondState.lastInjectAt, local(10, 0, 40).getTime(), "去重分支也必须把 state 存下来");
    assert.equal(secondState.lastHash, firstState.lastHash);
  } finally {
    __setInjectNowForTest(null);
  }
});

// ── 4. 分区查不清：跳过，不按聊天算 ──

function makeAdapterHost(data, { namespace = null, throws = false } = {}) {
  const hooks = {};
  const asked = [];
  const logs = [];
  const resourcesTouched = [];
  // 宿主资源（模型预取那一路）只要被碰一下就记一笔；真被调用就抛错，由内部 catch 吃掉。
  const resources = new Proxy({}, {
    get(_target, prop) {
      if (prop === "then" || typeof prop === "symbol") return undefined;
      return async () => {
        resourcesTouched.push(String(prop));
        throw new Error("不该碰宿主资源");
      };
    },
  });
  const ctx = {
    dataDir: data.dataDir,
    resources,
    bus: {
      async request(name, payload) {
        asked.push(name);
        if (name === "session:entries") return { entries: [], leafId: null };
        if (name === "session:get") {
          if (throws) throw new Error("Session manifest not found");
          return namespace === null ? {} : { session: { namespace, title: "窗口" } };
        }
        return null;
      },
    },
    hooks: { onDecision(name, fn) { hooks[name] = fn; } },
  };
  attachInject(ctx, (line) => logs.push(line));
  return { hooks, asked, logs, resourcesTouched };
}

test("适配层：payload 没带 namespace 时去问 session:get，查到了照常注入", async () => {
  __clearInjectTrackersForTest();
  const data = makeData("adapter-namespace-query");
  await data.addEvent({ title: "分区查询锚点", type: "event", date: "2026-09-07" });
  __setInjectNowForTest(() => local(10, 0));
  const { hooks, asked } = makeAdapterHost(data, { namespace: "home" });
  try {
    const out = await hooks["agent/before-start"]({
      session: { sessionId: "adapter-ns-home", sessionPath: "D:/hana/agents/hanako/sessions/a.jsonl" },
      model: DEEPSEEK,
    });
    assert.ok(asked.includes("session:get"), "缺省 payload 只能靠 session:get 查分区");
    assert.ok(out?.message?.content.includes("【今日时光】"), "分区查清了就该照常注入");
  } finally {
    __setInjectNowForTest(null);
  }
});

test("适配层：分区查不清就跳过，且在快照/模型/天气这些副作用之前", async () => {
  __clearInjectTrackersForTest();
  const data = makeData("adapter-namespace-miss");
  await data.addEvent({ title: "不该被注入的日子", type: "event", date: "2026-09-07" });
  __setInjectNowForTest(() => local(10, 0));
  const { hooks, asked, logs, resourcesTouched } = makeAdapterHost(data, { throws: true });
  try {
    const out = await hooks["agent/before-start"]({
      session: { sessionId: "adapter-ns-miss", sessionPath: "D:/hana/agents/hanako/sessions/b.jsonl" },
      model: DEEPSEEK,
    });
    assert.equal(out, undefined, "分区不明时这轮什么都不注入");
    assert.ok(!asked.includes("session:entries"), "跳过要在读会话快照之前");
    assert.deepEqual(resourcesTouched, [], "也不该去预取模型");
    assert.ok(logs.some((line) => line.includes("注入跳过: 分区未知")), logs.join("\n"));
  } finally {
    __setInjectNowForTest(null);
  }
});

test("适配层：payload 自带 namespace 时不再多问一次宿主", async () => {
  __clearInjectTrackersForTest();
  const data = makeData("adapter-namespace-given");
  __setInjectNowForTest(() => local(10, 0));
  const { hooks, asked } = makeAdapterHost(data, { namespace: "home" });
  try {
    const out = await hooks["agent/before-start"]({
      session: { sessionId: "adapter-ns-given", sessionPath: "", namespace: "code" },
      model: DEEPSEEK,
    });
    assert.ok(!asked.includes("session:get"), "已知分区就不该再问");
    assert.ok(out?.message?.content.includes("【今日时光】"), "Code 窗口走精简那套");
    assert.ok(!out.message.content.includes("日期硬约束"));
  } finally {
    __setInjectNowForTest(null);
  }
});

// ── 5. Code 那屏的开关只认自己 ──

test("Code：聊天的伙伴屏蔽名单不牵连 Code", async () => {
  __clearInjectTrackersForTest();
  const data = makeData("code-chat-blocklist");
  await data.updateSettings({ injectionDisabledAgentIds: ["hanako"] });
  __setInjectNowForTest(() => local(10, 0));
  try {
    const handler = makeHandler();
    const code = handler({}, codeCtx("code-chat-blocklist-session"));
    assert.ok(code?.message, "聊天静音的伙伴，改代码时照样该拿到时间");
    assert.ok(code.message.content.includes("【今日时光】"));

    // 聊天窗口这边确实被屏蔽了（换一个不触发峰谷的模型：屏蔽就真是一个字都不带）
    assert.equal(
      handler({}, chatCtx("code-chat-blocklist-home", { model: OTHER_MODEL })),
      undefined,
      "聊天那屏仍按名单静音"
    );
  } finally {
    __setInjectNowForTest(null);
  }
});

test("Code：名单里别的伙伴变了，不该让本窗口重刷", async () => {
  __clearInjectTrackersForTest();
  const data = makeData("code-other-agent-key");
  __setInjectNowForTest(() => local(10, 0));
  try {
    const handler = makeHandler();
    const ctx = codeCtx("code-other-agent-key-session");
    assert.ok(handler({}, ctx)?.message, "新会话先带一次");
    assert.equal(handler({}, ctx), undefined, "间隔没到不注入");

    await data.updateSettings({ codeInjectionDisabledAgentIds: ["other-partner"] });
    // 先把「这名单真被 resolver 读到了」钉死：否则这条用例只是「什么也没发生」的空转。
    const settings = data.getSettings();
    assert.equal(resolveCodeInjection(settings, "other-partner").enabled, false, "other-partner 真被关掉了");
    assert.equal(resolveCodeInjection(settings, "other-partner").items.weather, false, "关的是开关，内容仍跟全局");
    const mine = resolveCodeInjection(settings, "hanako");
    assert.equal(mine.enabled, true, "本窗口没被连坐");
    assert.deepEqual(mine.items, { ...DEFAULT_CODE_INJECTION_ITEMS });

    assert.equal(handler({}, ctx), undefined, "别的伙伴被关掉不该动到本窗口的设置指纹");
  } finally {
    __setInjectNowForTest(null);
  }
});

test("Code：屏蔽 A 不连坐 B（靠 resolveCodeInjection 的 agentId 参数）", async () => {
  __clearInjectTrackersForTest();
  const data = makeData("code-agent-overrides");
  await data.updateSettings({ codeInjectionDisabledAgentIds: ["agent-a"] });
  __setInjectNowForTest(() => local(10, 0));
  try {
    const handler = makeHandler();
    // 名单必须先被 resolver 认下来；否则下面“A 不注入”可能只是碰巧全局也关着。
    const settings = data.getSettings();
    assert.equal(resolveCodeInjection(settings, "agent-a").enabled, false, "A 的关闭要真被 resolver 读到");
    assert.equal(resolveCodeInjection(settings, "agent-b").enabled, true, "B 不能被 A 连坐");
    assert.equal(resolveCodeInjection(settings).enabled, true, "全局总闸仍是开的");

    const off = handler({}, codeCtx("code-agent-a-session", { agentId: "agent-a" }));
    assert.equal(off, undefined, "A 被单独关闭，就不该带");

    const on = handler({}, codeCtx("code-agent-b-session", { agentId: "agent-b" }));
    assert.ok(on?.message, "B 没被关闭就照常带");
    assert.ok(on.message.content.includes("【今日时光】"));

    // 重新打开总闸、名单还在：A 依旧不带，取消屏蔽后 A 回来
    await data.updateSettings({ codeInjectionEnabled: false });
    assert.equal(handler({}, codeCtx("code-agent-b-off-session", { agentId: "agent-b" })), undefined, "总闸关掉谁都别带");
    await data.updateSettings({ codeInjectionEnabled: true });
    assert.equal(handler({}, codeCtx("code-agent-a-again", { agentId: "agent-a" })), undefined, "重新开总闸，A 仍在名单里");
    await data.updateSettings({ codeInjectionDisabledAgentIds: [] });
    const back = handler({}, codeCtx("code-agent-a-back", { agentId: "agent-a" }));
    assert.ok(back?.message, "取消屏蔽后 A 回来");
  } finally {
    __setInjectNowForTest(null);
  }
});

// ── 6. 伙伴身份：宿主说谁就是谁 ──
// Code 窗口的 sessionPath 可能压根不带 agents/<id>/sessions 那一段，只靠路径推会推成空号，
// 于是这位伙伴单独关掉的 Code 注入都不生效。所以先认宿主明说的 id（payload.session.agentId / payload.agentId）。

const PARTNER_B_PATH = "D:/hana/agents/partner-b/sessions/2026-09-07T10-00-00-000Z_abc.jsonl";

test("适配层：没给 sessionPath 时，payload.session.agentId 说了算（A 关了就不注入）", async () => {
  __clearInjectTrackersForTest();
  const data = makeData("adapter-agent-payload");
  await data.updateSettings({ codeInjectionDisabledAgentIds: ["agent-a"] });
  __setInjectNowForTest(() => local(10, 0));
  const { hooks, logs } = makeAdapterHost(data);
  try {
    const out = await hooks["agent/before-start"]({
      session: { sessionId: "adapter-agent-payload", namespace: "code", agentId: "agent-a" },
      model: DEEPSEEK,
    });
    assert.equal(out, undefined, "A 关了自己的 Code 注入：身份只能来自 payload，没有路径可退");
    assert.ok(logs.some((line) => line.includes("伙伴=agent-a")), logs.join("\n"));
  } finally {
    __setInjectNowForTest(null);
  }
});

test("适配层：路径指向 B、payload 明确是 A 时 A 优先", async () => {
  __clearInjectTrackersForTest();
  const data = makeData("adapter-agent-precedence");
  await data.updateSettings({ codeInjectionDisabledAgentIds: ["agent-a"] });
  __setInjectNowForTest(() => local(10, 0));
  const { hooks, logs } = makeAdapterHost(data);
  try {
    const off = await hooks["agent/before-start"]({
      session: {
        sessionId: "adapter-agent-precedence-a",
        namespace: "code",
        sessionPath: PARTNER_B_PATH,
        agentId: "agent-a",
      },
      model: DEEPSEEK,
    });
    assert.equal(off, undefined, "宿主明说 A，就不能拿路径上的 B 去查配置");
    assert.ok(logs.some((line) => line.includes("伙伴=agent-a")), logs.join("\n"));

    // 同一个路径，宿主说 B：B 没关，照常带
    const on = await hooks["agent/before-start"]({
      session: {
        sessionId: "adapter-agent-precedence-b",
        namespace: "code",
        sessionPath: PARTNER_B_PATH,
        agentId: "partner-b",
      },
      model: DEEPSEEK,
    });
    assert.ok(on?.message, "换成 B 就该按 B 的配置带");
    assert.ok(on.message.content.includes("【今日时光】"));
  } finally {
    __setInjectNowForTest(null);
  }
});

test("适配层：顶层 payload.agentId 也算宿主明说", async () => {
  __clearInjectTrackersForTest();
  const data = makeData("adapter-agent-top");
  await data.updateSettings({ codeInjectionDisabledAgentIds: ["agent-a"] });
  __setInjectNowForTest(() => local(10, 0));
  const { hooks, logs } = makeAdapterHost(data);
  try {
    const out = await hooks["agent/before-start"]({
      session: { sessionId: "adapter-agent-top", namespace: "code", sessionPath: PARTNER_B_PATH },
      agentId: "agent-a",
      model: DEEPSEEK,
    });
    assert.equal(out, undefined, "顶层 agentId 也是宿主说的，不能当没看见");
    assert.ok(logs.some((line) => line.includes("伙伴=agent-a")), logs.join("\n"));
  } finally {
    __setInjectNowForTest(null);
  }
});

test("适配层：没有合法 id 就不要猜——agentName 不算、对象不算，退回路径", async () => {
  __clearInjectTrackersForTest();
  const data = makeData("adapter-agent-invalid");
  await data.updateSettings({ codeInjectionDisabledAgentIds: ["agent-a"] });
  __setInjectNowForTest(() => local(10, 0));
  const { hooks, logs } = makeAdapterHost(data);
  try {
    const out = await hooks["agent/before-start"]({
      session: {
        sessionId: "adapter-agent-invalid",
        namespace: "code",
        sessionPath: PARTNER_B_PATH,
        agentName: "agent-a", // 显示名，不是身份
        agentId: 42, // 不是字符串，不算
      },
      agentId: { id: "agent-a" }, // 对象更不能 String() 成 "[object Object]"
      model: DEEPSEEK,
    });
    assert.ok(out?.message, "认不出合法 id 就该退回路径，不能拿 agentName 或假 ID 顶替");
    assert.ok(logs.some((line) => line.includes("伙伴=partner-b")), logs.join("\n"));
  } finally {
    __setInjectNowForTest(null);
  }
});

test("适配层：路径也没有伙伴段时用默认（全局）配置", async () => {
  __clearInjectTrackersForTest();
  const data = makeData("adapter-agent-default");
  await data.updateSettings({ codeInjectionDisabledAgentIds: ["agent-a"] });
  __setInjectNowForTest(() => local(10, 0));
  const { hooks, logs } = makeAdapterHost(data);
  try {
    await data.updateSettings({ codeInjectionEnabled: false });
    const off = await hooks["agent/before-start"]({
      session: { sessionId: "adapter-agent-default-1", namespace: "code", sessionPath: "D:/hana/tmp/abc.jsonl" },
      model: DEEPSEEK,
    });
    assert.equal(off, undefined, "认不出伙伴时按全局配置，全局关着就不注入");
    assert.ok(logs.some((line) => line.includes("伙伴=?")), logs.join("\n"));

    await data.updateSettings({ codeInjectionEnabled: true });
    const on = await hooks["agent/before-start"]({
      session: { sessionId: "adapter-agent-default-2", namespace: "code", sessionPath: "D:/hana/tmp/abc.jsonl" },
      model: DEEPSEEK,
    });
    assert.ok(on?.message, "全局打开就照常带（A 的关闭不能误伤认不出身份的人）");
  } finally {
    __setInjectNowForTest(null);
  }
});
