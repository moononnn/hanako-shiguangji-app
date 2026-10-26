// 拾光记 · 对外契约 alerts（天气提醒事件）测试
// 覆盖：只摊值得留意的事件、事件字段裁剪、预报不新鲜/没开/读崩一律空契约、
// 发布指纹去重与 force 重发、失败不反噬。

import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { UserData } from "../lib/data.js";
import {
  PUBLIC_ALERTS_KEY,
  PUBLIC_ALERTS_SCHEMA_VERSION,
  PUBLIC_ALERTS_MAX_EVENTS,
  __resetAlertsPublishCache,
  alertsDayKey,
  buildPublicAlerts,
  configurePublicAlertsPublisher,
  publishPublicAlerts,
} from "../lib/public-alerts.js";
import { flushPublicTodayPublisher } from "../lib/public-today.js";

process.env.TZ = "Asia/Shanghai";

const NOW = new Date(2026, 9, 24, 7, 20); // 2026-10-24 07:20 本地
const TODAY = "2026-10-24";
const TOMORROW = "2026-10-25";
const LOCATION = "成都 武侯区";

function makeData(tag) {
  return new UserData(mkdtempSync(path.join(tmpdir(), `sgj-alerts-${tag}-`)));
}

/** 24 小时里只改某个钟点的温度：用来造「下午比现在高 9 度」这种事。 */
function makeForecast({ temperatures = null, codes = null, probs = null, gusts = null } = {}) {
  const times = [];
  for (let i = 0; i < 48; i += 1) {
    const day = 24 + Math.floor(i / 24);
    times.push(`2026-10-${String(day).padStart(2, "0")}T${String(i % 24).padStart(2, "0")}:00`);
  }
  return {
    timezone: "Asia/Shanghai",
    utcOffsetSeconds: 28800,
    hourly: {
      time: times,
      temperature_2m: temperatures || new Array(48).fill(9),
      apparent_temperature: temperatures || new Array(48).fill(9),
      weather_code: codes || new Array(48).fill(0),
      precipitation_probability: probs || new Array(48).fill(0),
      wind_gusts_10m: gusts || new Array(48).fill(10),
    },
    daily: {
      time: [TODAY, TOMORROW],
      weather_code: [0, 0],
      temperature_2m_max: [18, 18],
      temperature_2m_min: [9, 9],
      precipitation_probability_max: [0, 0],
      wind_gusts_10m_max: [12, 12],
    },
  };
}

async function seedForecast(data, forecast, { fetchedAt = NOW.getTime(), location = LOCATION } = {}) {
  await data.setWeatherForecastCache({ location, fetchedAt, forecast });
}

const settings = {
  weatherLocation: LOCATION,
  weatherEnabled: true,
  weatherAlertEnabled: true,
};

beforeEach(() => {
  configurePublicAlertsPublisher(null);
  __resetAlertsPublishCache();
});

// ── 摊什么 ──

test("alerts：下午比现在高 9 度，摊成一条 rise 事件", async () => {
  const data = makeData("rise");
  const temps = new Array(48).fill(9);
  for (let i = 14; i <= 17; i += 1) temps[i] = 18; // 今天下午到 18°C
  await seedForecast(data, makeForecast({ temperatures: temps }));

  const snapshot = buildPublicAlerts({ data, settings, now: NOW });
  assert.equal(snapshot.schemaVersion, PUBLIC_ALERTS_SCHEMA_VERSION);
  assert.equal(snapshot.day, TODAY);
  assert.equal(snapshot.reason, "ok");
  const rise = snapshot.events.find((event) => event.kind === "rise");
  assert.ok(rise, "应该摊出升温事件");
  assert.equal(rise.label, "要升温");
  assert.ok(rise.facts.join("").includes("18"));
  assert.ok(rise.facts.join("").includes("高 9"));
  assert.match(rise.slot, /今天下午/);
  assert.ok(Array.isArray(rise.keywords) && rise.keywords.includes("薄"));
});

test("alerts：风平浪静的时候就是一份空清单，不硬凑", async () => {
  const data = makeData("calm");
  await seedForecast(data, makeForecast());
  const snapshot = buildPublicAlerts({ data, settings, now: NOW });
  assert.equal(snapshot.reason, "ok");
  assert.deepEqual(snapshot.events, []);
});

test("alerts：事件最多摊 6 条，字段长度都收过", async () => {
  const data = makeData("capped");
  // 每一小时雷暴 + 大风 + 高温，制造大量事件
  const codes = new Array(48).fill(95);
  const gusts = new Array(48).fill(80);
  const temps = new Array(48).fill(9);
  for (let i = 0; i < 30; i += 1) temps[i] = 30;
  await seedForecast(data, makeForecast({ codes, gusts, temperatures: temps }));
  const snapshot = buildPublicAlerts({ data, settings, now: NOW });
  assert.ok(snapshot.events.length > 0);
  assert.ok(snapshot.events.length <= PUBLIC_ALERTS_MAX_EVENTS);
  for (const event of snapshot.events) {
    assert.ok(event.facts.length <= 4);
    assert.ok(event.keywords.length <= 8);
    assert.ok(event.key.length <= 80);
  }
});

// ── 什么情况下摊空的 ──

test("alerts：天气关了或提醒单独关了，两份都摊空并说明缘由", async () => {
  const data = makeData("off");
  await seedForecast(data, makeForecast());
  const weatherOff = buildPublicAlerts({ data, settings: { ...settings, weatherEnabled: false }, now: NOW });
  assert.equal(weatherOff.reason, "weather-off");
  assert.deepEqual(weatherOff.events, []);
  const alertOff = buildPublicAlerts({ data, settings: { ...settings, weatherAlertEnabled: false }, now: NOW });
  assert.equal(alertOff.reason, "alert-off");
  assert.deepEqual(alertOff.events, []);
});

test("alerts：预报过期就摊空，不拿早上那版预报说晚上的事", async () => {
  const data = makeData("stale");
  const temps = new Array(48).fill(9);
  for (let i = 13; i <= 16; i += 1) temps[i] = 18;
  await seedForecast(data, makeForecast({ temperatures: temps }), { fetchedAt: NOW.getTime() - 3 * 3600 * 1000 });
  const snapshot = buildPublicAlerts({ data, settings, now: NOW });
  assert.equal(snapshot.reason, "stale");
  assert.deepEqual(snapshot.events, []);
});

test("alerts：没配地点/没有预报/数据层不在，一律安静给空契约", async () => {
  const data = makeData("none");
  assert.equal(buildPublicAlerts({ data, settings, now: NOW }).reason, "no-forecast");
  assert.equal(buildPublicAlerts({ data: null, settings, now: NOW }).reason, "no-data");
  assert.doesNotThrow(() => buildPublicAlerts({ data: {}, settings, now: NOW }));
});

test("alerts：缓存地点跟设置对不上时不当自己的预报用", async () => {
  const data = makeData("mismatch");
  await seedForecast(data, makeForecast(), { location: "北京 朝阳区" });
  const snapshot = buildPublicAlerts({ data, settings, now: NOW });
  assert.equal(snapshot.reason, "no-forecast");
});

// ── 发布 ──

function fakeChannel() {
  const published = [];
  return {
    published,
    async publish(payload) { published.push(payload); },
    async list() { return { entries: published.map((row) => ({ key: row.key })) }; },
  };
}

test("alerts：内容没变不重复发，force 才重发一次", async () => {
  const data = makeData("publish");
  const temps = new Array(48).fill(9);
  for (let i = 14; i <= 17; i += 1) temps[i] = 18;
  await seedForecast(data, makeForecast({ temperatures: temps }));
  const channel = fakeChannel();
  configurePublicAlertsPublisher({ publicData: channel });

  publishPublicAlerts({ data, settings, now: NOW });
  await flushPublicTodayPublisher();
  publishPublicAlerts({ data, settings, now: NOW });
  await flushPublicTodayPublisher();
  assert.equal(channel.published.length, 1, "指纹没变不该再发");
  assert.equal(channel.published[0].key, PUBLIC_ALERTS_KEY);
  assert.equal(channel.published[0].schemaVersion, PUBLIC_ALERTS_SCHEMA_VERSION);
  assert.ok(Array.isArray(channel.published[0].data.events));

  publishPublicAlerts({ data, settings, now: NOW, force: true });
  await flushPublicTodayPublisher();
  assert.equal(channel.published.length, 2);
});

test("alerts：事件变了会重发；没绑通道时安静返回", async () => {
  const data = makeData("publish2");
  await seedForecast(data, makeForecast());
  assert.equal(configurePublicAlertsPublisher(null) ?? publishPublicAlerts({ data, settings, now: NOW }), null);

  const channel = fakeChannel();
  configurePublicAlertsPublisher({ publicData: channel });
  publishPublicAlerts({ data, settings, now: NOW });
  await flushPublicTodayPublisher();
  const before = channel.published.length;

  const temps = new Array(48).fill(9);
  for (let i = 14; i <= 17; i += 1) temps[i] = 18;
  await seedForecast(data, makeForecast({ temperatures: temps }));
  publishPublicAlerts({ data, settings, now: NOW });
  await flushPublicTodayPublisher();
  assert.ok(channel.published.length > before, "事件变了应该重发");
});

test("alerts：日期键用本地日历日，跨天换一天", () => {
  assert.equal(alertsDayKey(new Date(2026, 9, 24, 23, 59)), "2026-10-24");
  assert.equal(alertsDayKey(new Date(2026, 9, 25, 0, 1)), "2026-10-25");
});
