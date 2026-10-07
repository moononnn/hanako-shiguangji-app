// 拾光记 · 对外快照（public-today）测试
//
// 这份快照是给别的消费方（聊天类 App 等）读的门面，所以重点守三件事：
//  ① 形状与字段稳定（schemaVersion、today、weather、summaries）；
//  ② 隐私边界——每位伙伴只拿得到自己那段生活日，别人的不许串进来；
//  ③ 失效要安静——数据读不到、天气过期、写盘失败都不能炸。
process.env.TZ = "Asia/Shanghai";

import { test } from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import fs from "node:fs";
import { mkdtempSync } from "node:fs";

import {
  PUBLIC_TODAY_SCHEMA_VERSION,
  SUMMARY_CHAR_BUDGET,
  buildPublicToday,
  collectSnapshotSummaries,
  publicTodayPath,
  readSnapshotWeather,
  schedulePublicToday,
  writePublicToday,
  __resetPublicTodayCache,
  __clearPublicTodayTimer,
} from "../lib/public-today.js";
import { resolveWeatherLocation } from "../lib/weather.js";
import { UserData } from "../lib/data.js";

function tmpDir(name) {
  return mkdtempSync(path.join(os.tmpdir(), `shiguangji-${name}-`));
}

/** 固定一个「东八区中午」的时刻，避开生活日翻篇边界。 */
function noonOf(iso) {
  return new Date(`${iso}T12:00:00+08:00`);
}

/** 造一个够用的假数据层；只实现快照要用到的几个入口。 */
function fakeData(overrides = {}) {
  return {
    getSettings: () => ({ dayBoundaryHour: 4, showPeriod: true, ...(overrides.settings || {}) }),
    getDataRev: () => (overrides.rev === undefined ? 7 : overrides.rev),
    eventsOnDate: () => overrides.events || [],
    periodsWithDayOn: () => overrides.periods || [],
    listEvents: () => overrides.allEvents || [],
    listSummaryEntries: () => {
      if (overrides.summariesThrows) throw new Error("read failed");
      return overrides.summaries || [];
    },
    getWeatherCache: () => overrides.weatherCache || null,
  };
}

const NOON = noonOf("2026-09-13");

// ── 形状 ──

test("快照形状：版本号、dataRev、today 各字段齐全", () => {
  const data = fakeData({
    rev: 42,
    events: [{ title: "在一起第 500 天", type: "event" }],
    allEvents: [
      { type: "todo", title: "给圆宝买狗粮", date: "2026-09-13", done: false },
      { type: "todo", title: "已经做完的事", date: "2026-09-13", done: true },
      { type: "todo", title: "以后才到期", date: "2026-09-20", done: false },
    ],
  });
  const snap = buildPublicToday({ now: NOON, data });

  assert.equal(snap.schemaVersion, PUBLIC_TODAY_SCHEMA_VERSION);
  assert.equal(snap.dataRev, 42);
  assert.equal(snap.today.date, "2026-09-13");
  assert.equal(snap.today.weekday, "日");
  assert.deepEqual(snap.today.events, ["在一起第 500 天"]);
  assert.deepEqual(snap.today.todos, ["给圆宝买狗粮"]);
  assert.equal(typeof snap.today.workday, "boolean");
  assert.equal(snap.weather, null);
  assert.deepEqual(snap.summaries, {});
  assert.ok(!Number.isNaN(Date.parse(snap.generatedAt)));
});

test("星期映射：一周七天都对得上", () => {
  const cases = [
    ["2026-09-13", "日"],
    ["2026-09-14", "一"],
    ["2026-09-15", "二"],
    ["2026-09-16", "三"],
    ["2026-09-17", "四"],
    ["2026-09-18", "五"],
    ["2026-09-19", "六"],
  ];
  for (const [iso, expected] of cases) {
    const snap = buildPublicToday({ now: noonOf(iso), data: fakeData() });
    assert.equal(snap.today.weekday, expected, `${iso} 应是星期${expected}`);
  }
});

test("生理期跟随开关：关掉后 period 恒为 false", () => {
  const periods = [{ event: { title: "生理期" }, day: 2, predicted: false }];
  const on = buildPublicToday({ now: NOON, data: fakeData({ periods, settings: { showPeriod: true } }) });
  assert.equal(on.today.period, true);

  const off = buildPublicToday({ now: NOON, data: fakeData({ periods, settings: { showPeriod: false } }) });
  assert.equal(off.today.period, false);
});

test("生理期不进 events 列表，只走 period 一个字段", () => {
  const snap = buildPublicToday({
    now: NOON,
    data: fakeData({
      events: [{ title: "生理期", type: "period" }, { title: "相识纪念日", type: "event" }],
      periods: [{ event: {}, day: 1, predicted: false }],
    }),
  });
  assert.deepEqual(snap.today.events, ["相识纪念日"]);
  assert.equal(snap.today.period, true);
});

test("待办不进 events 列表：勾掉的、没勾的都不进，年度重复的仍当日程", () => {
  const data = fakeData({
    events: [
      { title: "给薄荷浇水", type: "todo" },
      { title: "已经做完的事", type: "todo", done: true },
      { title: "每年给妈妈过生日", type: "todo", repeatYearly: true },
      { title: "相识纪念日", type: "event" },
    ],
    allEvents: [],
  });
  const snap = buildPublicToday({ now: NOON, data });
  // 待办丢了完成状态后混进「今天是」，消费方会当成还没做；它们另有 todos/todosDue/todosPending 三条出口。
  assert.deepEqual(snap.today.events, ["每年给妈妈过生日", "相识纪念日"]);
  assert.deepEqual(snap.today.todos, []);
});

test("预计中的生理期不算数", () => {
  const snap = buildPublicToday({
    now: NOON,
    data: fakeData({ periods: [{ event: {}, day: 3, predicted: true }] }),
  });
  assert.equal(snap.today.period, false);
});

test("脏标题被洗过：控制字符去掉、超长截断", () => {
  const long = "长".repeat(200);
  const snap = buildPublicToday({
    now: NOON,
    data: fakeData({
      events: [{ title: `有\u0000控制\u001F符`, type: "event" }],
      allEvents: [{ type: "todo", title: long, date: "2026-09-13", done: false }],
    }),
  });
  assert.equal(snap.today.events[0], "有控制符");
  assert.equal(snap.today.todos[0].length, 60);
});

// ── 天气 ──

function weatherFixture(now, { fetchedAt, location } = {}) {
  const settings = { weatherLocation: "成都市 武侯区", weatherIntervalHours: 3, weatherEnabled: true };
  const resolved = resolveWeatherLocation(settings).location;
  return {
    settings,
    cache: {
      location: location === undefined ? resolved : location,
      fetchedAt: fetchedAt === undefined ? now.getTime() - 3600 * 1000 : fetchedAt,
      result: { line: "窗外阴着，风不大，24°C 上下", temp: 24, place: "成都 武侯区", code: 3, isDay: true },
    },
  };
}

test("天气：新鲜缓存会写进快照", () => {
  const fix = weatherFixture(NOON);
  const snap = buildPublicToday({
    now: NOON,
    data: fakeData({ weatherCache: fix.cache, settings: fix.settings }),
    settings: fix.settings,
  });
  assert.ok(snap.weather);
  assert.equal(snap.weather.temp, 24);
  assert.ok(snap.weather.line.includes("24"));
});

test("天气：关掉开关、缓存过期、地点不符都不给", () => {
  const fix = weatherFixture(NOON);

  const off = buildPublicToday({
    now: NOON,
    data: fakeData({ weatherCache: fix.cache, settings: { weatherEnabled: false } }),
    settings: { weatherEnabled: false },
  });
  assert.equal(off.weather, null);

  const stale = weatherFixture(NOON, { fetchedAt: NOON.getTime() - 10 * 3600 * 1000 });
  assert.equal(readSnapshotWeather(fakeData({ weatherCache: stale.cache }), stale.settings, NOON), null);

  const other = weatherFixture(NOON, { location: "别的地方" });
  assert.equal(readSnapshotWeather(fakeData({ weatherCache: other.cache }), other.settings, NOON), null);
});

// ── 生活日回顾（隐私边界） ──

const base = "2026-09-12";
const otherDay = "2026-09-11";

function summaryEntry(agentId, date, text) {
  return { date, agentId, agentName: agentId, text, importance: 5, source: "auto" };
}

test("回顾按伙伴分组：每人只拿自己那份，别人的不串味", () => {
  const summaries = [
    summaryEntry("hanako", base, "和小花一起调插件"),
    summaryEntry("qing", base, "和阿青对了半天戏"),
    summaryEntry("hanako", otherDay, "小花在看文档"),
  ];
  const out = collectSnapshotSummaries(fakeData({ summaries }), { now: NOON, boundaryHour: 4 });

  assert.deepEqual(Object.keys(out).sort(), ["hanako", "qing"]);
  assert.deepEqual(out.hanako.map((r) => r.date), [base, otherDay]);
  assert.ok(out.hanako.every((r) => r.text.includes("小花")));
  assert.equal(out.qing.length, 1);
  assert.ok(out.qing[0].text.includes("阿青"));
  // 任何一份里都不许出现别人的字眼
  assert.ok(!out.hanako.some((r) => r.text.includes("阿青")));
  assert.ok(!out.qing.some((r) => r.text.includes("小花")));
});

test("回顾：技术探针、空档案、坏数据都不进快照", () => {
  const summaries = [
    summaryEntry("hanako", base, "正常的一天"),
    summaryEntry("xiaoshenghuo-probe-agent", base, "探针不该出现"),
    { date: base, agentId: "hanako", text: "   ", importance: 5 },
    { date: base, agentId: "hanako", empty: true, text: "空白档案" },
    { date: base, agentId: "", text: "没有归属的旧档案" },
  ];
  const out = collectSnapshotSummaries(fakeData({ summaries }), { now: NOON, boundaryHour: 4 });
  assert.deepEqual(Object.keys(out), ["hanako"]);
  assert.equal(out.hanako.length, 1);
  assert.equal(out.hanako[0].text, "正常的一天");
});

test("回顾：只取近 3 个已结束生活日做底座，太老的不带", () => {
  const summaries = [
    summaryEntry("hanako", "2026-09-12", "最近一天"),
    summaryEntry("hanako", "2026-09-11", "前一天"),
    summaryEntry("hanako", "2026-09-10", "再前一天"),
    summaryEntry("hanako", "2026-08-01", "很久以前"),
  ];
  const out = collectSnapshotSummaries(fakeData({ summaries }), { now: NOON, boundaryHour: 4 });
  assert.deepEqual(out.hanako.map((r) => r.date), ["2026-09-12", "2026-09-11", "2026-09-10"]);
});

test("回顾：超长正文按字符预算截断，不把快照撑爆", () => {
  const long = "字".repeat(SUMMARY_CHAR_BUDGET + 500);
  const out = collectSnapshotSummaries(
    fakeData({ summaries: [summaryEntry("hanako", base, long)] }),
    { now: NOON, boundaryHour: 4 },
  );
  assert.ok(out.hanako[0].text.length <= SUMMARY_CHAR_BUDGET);
});

test("回顾：数据层读崩了当没有，不往外抛", () => {
  const out = collectSnapshotSummaries(fakeData({ summariesThrows: true }), { now: NOON, boundaryHour: 4 });
  assert.deepEqual(out, {});
});

test("回顾：接真实数据层走一遍", async () => {
  const dir = tmpDir("public-today-data");
  const data = new UserData(dir);
  await data.saveAgentSummary(base, "hanako", "和小花一起把茶话会接上了拾光记", { importance: 6 });
  await data.saveAgentSummary(base, "qing", "和阿青聊了一晚上剧本", { importance: 3 });

  const snap = buildPublicToday({ now: NOON, data });
  assert.deepEqual(Object.keys(snap.summaries).sort(), ["hanako", "qing"]);
  assert.ok(snap.summaries.hanako[0].text.includes("拾光记"));
  assert.ok(snap.summaries.qing[0].text.includes("剧本"));
});

// ── 写盘 ──

test("路径：落在数据目录下，文件名固定", () => {
  const dir = tmpDir("public-today-path");
  assert.equal(publicTodayPath(dir), path.join(dir, "public-today.json"));
});

test("写盘：生成可解析的 JSON；内容没变不重写；force 才重写", () => {
  const dir = tmpDir("public-today-write");
  __resetPublicTodayCache();
  const data = fakeData({ events: [{ title: "相识纪念日", type: "event" }] });
  const file = publicTodayPath(dir);

  writePublicToday({ dataDir: dir, data, now: NOON });
  const first = JSON.parse(fs.readFileSync(file, "utf-8"));
  assert.equal(first.schemaVersion, PUBLIC_TODAY_SCHEMA_VERSION);
  const firstAt = first.generatedAt;

  // 同一份内容、换了时刻：应当跳过写入，文件里的时间戳还是旧的
  writePublicToday({ dataDir: dir, data, now: new Date(NOON.getTime() + 60_000) });
  assert.equal(JSON.parse(fs.readFileSync(file, "utf-8")).generatedAt, firstAt);

  // force 才真正重写
  writePublicToday({ dataDir: dir, data, now: new Date(NOON.getTime() + 120_000), force: true });
  assert.notEqual(JSON.parse(fs.readFileSync(file, "utf-8")).generatedAt, firstAt);
});

test("写盘：缺 dataDir 或 data 时安静返回 null", () => {
  assert.equal(writePublicToday({ dataDir: "", data: fakeData() }), null);
  assert.equal(writePublicToday({ dataDir: tmpDir("public-today-empty"), data: null }), null);
});

test("写盘：临时文件不留在目录里", () => {
  const dir = tmpDir("public-today-tmp");
  __resetPublicTodayCache();
  writePublicToday({ dataDir: dir, data: fakeData(), now: NOON });
  const names = fs.readdirSync(dir);
  assert.deepEqual(names, ["public-today.json"]);
});

test("去抖：连着排多次只落一次盘（清掉定时器不炸）", () => {
  __clearPublicTodayTimer();
  schedulePublicToday({ dataDir: tmpDir("public-today-sched"), data: fakeData(), now: NOON });
  schedulePublicToday({ dataDir: tmpDir("public-today-sched"), data: fakeData(), now: NOON });
  __clearPublicTodayTimer();
  assert.ok(true);
});

// ── 到点那一份（给聊天类消费方当由头）──

// 用本地时间构造，跟 dateKey / getHours 同一套算法，换时区跑也不会飘。
const LOCAL_1700 = new Date(2026, 8, 13, 17, 0, 0);

test("todosDue：只收今天过了钟点、还没了结的那几条，带钟点", () => {
  const data = fakeData({
    allEvents: [
      { id: "e1", type: "todo", title: "给薄荷浇水", date: "2026-09-13", reminderStart: "16:00", reminderEnd: "16:00", done: false },
      { type: "todo", title: "晚上买纸", date: "2026-09-13", reminderStart: "20:00", reminderEnd: "20:00", done: false },
      { type: "todo", title: "没写钟点", date: "2026-09-13", done: false },
      { type: "todo", title: "已经做掉", date: "2026-09-13", reminderStart: "09:00", reminderEnd: "09:00", done: true },
      { type: "todo", title: "昨天欠的", date: "2026-09-12", reminderStart: "09:00", reminderEnd: "09:00", done: false },
    ],
  });
  const snap = buildPublicToday({ now: LOCAL_1700, data });
  assert.deepEqual(snap.today.todosDue, [{ id: "e1", title: "给薄荷浇水", at: "16:00", soon: 0 }]);
  // todos 的口径一点没动，旧消费方照旧当标题串读
  assert.deepEqual(snap.today.todos, ["给薄荷浇水", "晚上买纸", "没写钟点", "昨天欠的"]);
});

test("todosDue：钟点前几分钟的也先摊出来，soon 写着还差多少分", () => {
  // 消费方拿到待办还要跑模型组织语言，踩着点开工一定晚几分钟，所以要提前给。
  const local = (h, m) => new Date(2026, 8, 13, h, m, 0);
  const data = fakeData({
    allEvents: [
      { id: "e1", type: "todo", title: "吃维生素d", date: "2026-09-13", reminderStart: "16:00", reminderEnd: "16:00", done: false },
      { type: "todo", title: "晚点再说", date: "2026-09-13", reminderStart: "16:30", reminderEnd: "16:30", done: false },
    ],
  });
  const soon = buildPublicToday({ now: local(15, 56), data });
  assert.deepEqual(soon.today.todosDue, [{ id: "e1", title: "吃维生素d", at: "16:00", soon: 4 }]);
  // 提前量之外的不给：还有半小时的事，现在提只是白提一句
  const early = buildPublicToday({ now: local(15, 40), data });
  assert.deepEqual(early.today.todosDue, []);
});

test("todosDue：没有到点的就是空数组，不是缺字段", () => {
  const snap = buildPublicToday({ now: NOON, data: fakeData() });
  assert.deepEqual(snap.today.todosDue, []);
});
