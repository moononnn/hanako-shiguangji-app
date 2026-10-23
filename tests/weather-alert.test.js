import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  collectWeatherEvents,
  decideWeatherAlert,
  didMentionWeatherEvent,
  markWeatherEventReported,
} from '../lib/weather-alert.js';
import { buildWeatherAlertContext } from '../lib/inject.js';
import {
  getWeatherForecast,
  normalizeForecastPayload,
  weatherForecastCacheIsFresh,
  weatherForecastCacheMatches,
} from '../lib/weather.js';

process.env.TZ = 'Asia/Shanghai';

const NOW = new Date(2026, 9, 22, 10, 0); // 2026-10-22 10:00 本地
const TODAY = '2026-10-22';
const TOMORROW = '2026-10-23';

function hourlyTimes(count = 48, startDay = 22) {
  const times = [];
  for (let i = 0; i < count; i += 1) {
    const day = startDay + Math.floor(i / 24);
    const hour = i % 24;
    times.push(`2026-10-${String(day).padStart(2, '0')}T${String(hour).padStart(2, '0')}:00`);
  }
  return times;
}

function makeForecast(overrides = {}) {
  const times = hourlyTimes();
  const hourly = {
    time: times,
    temperature_2m: new Array(48).fill(20),
    apparent_temperature: new Array(48).fill(20),
    weather_code: new Array(48).fill(0),
    precipitation_probability: new Array(48).fill(0),
    wind_gusts_10m: new Array(48).fill(10),
    ...(overrides.hourly || {}),
  };
  const daily = {
    time: [TODAY, TOMORROW],
    weather_code: [0, 0],
    temperature_2m_max: [22, 22],
    temperature_2m_min: [14, 14],
    precipitation_probability_max: [0, 0],
    wind_gusts_10m_max: [12, 12],
    ...(overrides.daily || {}),
  };
  return { timezone: 'Asia/Shanghai', utcOffsetSeconds: 28800, hourly, daily };
}

function eventsOf(forecast, currentTemp = 20, settings = {}) {
  return collectWeatherEvents({ forecast, now: NOW, currentTemp, settings });
}

// ── 恶劣天气 ──

test('天气提醒：雷暴算恶劣天气，会挑出今天下午那一小时', () => {
  const codes = new Array(48).fill(0);
  codes[15] = 95; // 2026-10-22T15:00
  const events = eventsOf(makeForecast({ hourly: { weather_code: codes } }));
  const severe = events.filter((e) => e.kind === 'severe');
  assert.equal(severe.length, 1);
  assert.equal(severe[0].dateKey, TODAY);
  assert.match(severe[0].slot, /今天下午/);
  assert.ok(severe[0].facts.join('').includes('雷阵雨'));
});

test('天气提醒：小雨和普通阵雨不算恶劣天气，不提', () => {
  const codes = new Array(48).fill(0);
  codes[15] = 61; // 小雨
  codes[20] = 80; // 阵雨
  const events = eventsOf(makeForecast({ hourly: { weather_code: codes } }));
  assert.equal(events.filter((e) => e.kind === 'severe').length, 0);
});

// ── 降水概率 ──

test('天气提醒：降水概率到 60% 才提，40% 不提', () => {
  const probs = new Array(48).fill(0);
  probs[15] = 65;
  const codes = new Array(48).fill(0);
  codes[15] = 61;
  const hit = eventsOf(makeForecast({ hourly: { precipitation_probability: probs, weather_code: codes } }));
  assert.equal(hit.filter((e) => e.kind === 'rain').length, 1);

  const lowProbs = new Array(48).fill(0);
  lowProbs[15] = 40;
  const miss = eventsOf(makeForecast({ hourly: { precipitation_probability: lowProbs, weather_code: codes } }));
  assert.equal(miss.filter((e) => e.kind === 'rain').length, 0);
});

// ── 风 ──

test('天气提醒：阵风到 50 才提，40 不提', () => {
  const gusts = new Array(48).fill(10);
  gusts[16] = 55;
  const hit = eventsOf(makeForecast({ hourly: { wind_gusts_10m: gusts } }));
  assert.equal(hit.filter((e) => e.kind === 'wind').length, 1);

  const mild = new Array(48).fill(10);
  mild[16] = 40;
  const miss = eventsOf(makeForecast({ hourly: { wind_gusts_10m: mild } }));
  assert.equal(miss.filter((e) => e.kind === 'wind').length, 0);
});

// ── 升降温 ──

test('天气提醒：温差不到 8 度不提，到了才提', () => {
  const temps = new Array(48).fill(20);
  temps[20] = 15; // 只差 5 度
  const mild = eventsOf(makeForecast({ hourly: { temperature_2m: temps } }), 20);
  assert.equal(mild.filter((e) => e.kind === 'drop' || e.kind === 'rise').length, 0);

  const cold = new Array(48).fill(20);
  cold[20] = 10; // 差 10 度
  const hit = eventsOf(makeForecast({ hourly: { temperature_2m: cold } }), 20);
  const drop = hit.filter((e) => e.kind === 'drop');
  assert.equal(drop.length, 1);
  assert.ok(drop[0].facts.join('').includes('低 10°C'));
});

test('天气提醒：明显升温单独成件事，跟降温分开', () => {
  const temps = new Array(48).fill(20);
  temps[20] = 30;
  const hit = eventsOf(makeForecast({ hourly: { temperature_2m: temps } }), 20);
  const rise = hit.filter((e) => e.kind === 'rise');
  assert.equal(rise.length, 1);
  assert.equal(hit.filter((e) => e.kind === 'drop').length, 0);
});

test('天气提醒：明天比今天低 8 度以上，按明天算一件事', () => {
  const forecast = makeForecast({
    daily: {
      temperature_2m_max: [22, 12],
      temperature_2m_min: [14, 5],
    },
  });
  const events = eventsOf(forecast, 20);
  const drop = events.filter((e) => e.kind === 'drop');
  assert.ok(drop.length >= 1);
  assert.ok(drop.some((e) => e.dateKey === TOMORROW));
});

// ── 事件去重与补报 ──

test('天气提醒：同一件事只提一次，伙伴接住后不再提', () => {
  const codes = new Array(48).fill(0);
  codes[15] = 95;
  const forecast = makeForecast({ hourly: { weather_code: codes } });
  const events = eventsOf(forecast);

  const first = decideWeatherAlert({ events, lastState: null, now: NOW });
  assert.equal(first.should, true);
  assert.equal(first.reason, 'detected');
  const key = first.notice.key;

  // 伙伴这一轮说出口了
  const confirmed = markWeatherEventReported(first.state, { key });
  const second = decideWeatherAlert({ events, lastState: confirmed, now: NOW });
  assert.equal(second.should, false);
  assert.equal(second.reason, 'already-reported');
});

test('天气提醒：伙伴一直不接住，最多补报一次就放手', () => {
  const codes = new Array(48).fill(0);
  codes[15] = 95;
  const events = eventsOf(makeForecast({ hourly: { weather_code: codes } }));

  const first = decideWeatherAlert({ events, lastState: null, now: NOW });
  assert.equal(first.should, true);

  const second = decideWeatherAlert({ events, lastState: first.state, now: NOW });
  assert.equal(second.should, true);
  assert.equal(second.reason, 'retry');

  const third = decideWeatherAlert({ events, lastState: second.state, now: NOW });
  assert.equal(third.should, false);
  assert.equal(third.reason, 'give-up');
});

test('天气提醒：不同目标日算两件事，各提各的', () => {
  const codes = new Array(48).fill(0);
  codes[15] = 95; // 今天下午雷暴
  const forecast = makeForecast({
    hourly: { weather_code: codes },
    daily: { temperature_2m_max: [22, 12], temperature_2m_min: [14, 5] },
  });
  const events = eventsOf(forecast, 20);
  const keys = new Set(events.map((e) => e.key));
  assert.ok(keys.size >= 2);
  assert.ok([...keys].some((k) => k.includes(TODAY)));
  assert.ok([...keys].some((k) => k.includes(TOMORROW)));
});

test('天气提醒：先说马上要来的，远的事往后排', () => {
  // 今天下午有雨，明天凌晨雨更大：先提今天下午那件。
  const codes = new Array(48).fill(0);
  codes[15] = 61;
  codes[24] = 95; // 2026-10-23T00:00
  const probs = new Array(48).fill(0);
  probs[15] = 70;
  const events = eventsOf(makeForecast({ hourly: { weather_code: codes, precipitation_probability: probs } }));
  assert.equal(events[0].dateKey, TODAY);
  assert.equal(events[0].kind, 'rain');
  assert.ok(events.some((e) => e.dateKey === TOMORROW && e.kind === 'severe'));
});

test('天气提醒：没有值得留意的事就闭嘴', () => {
  const events = eventsOf(makeForecast());
  const decision = decideWeatherAlert({ events, lastState: null, now: NOW });
  assert.equal(decision.should, false);
  assert.equal(decision.reason, 'no-event');
});

test('天气提醒：判断伙伴有没有说出口时，宽松匹配算提过', () => {
  const event = { keywords: ['降温', '冷'] };
  assert.equal(didMentionWeatherEvent('明天下午降温 9 度，记得加件衣服', event), true);
  assert.equal(didMentionWeatherEvent('今天聊点别的', event), false);
  assert.equal(didMentionWeatherEvent('', event), false);
});

// ── 注入文案 ──

test('天气提醒：给伙伴的是事实和落笔方向，不塞播报腔', () => {
  const text = buildWeatherAlertContext({
    kind: 'drop',
    facts: ['明天下午最低 12°C，比今天低 9°C'],
    keywords: ['降温'],
  }, '阿禾');
  assert.ok(text.includes('【天气提醒】'));
  assert.ok(text.includes('明天下午最低 12°C'));
  assert.ok(text.includes('只提一次'));
  assert.ok(text.includes('阿禾'));
  assert.doesNotMatch(text, /系统通知|请注意：|温馨提示/);
});

test('天气提醒：没有事实就不产出文案', () => {
  assert.equal(buildWeatherAlertContext({ kind: 'drop', facts: [] }, '阿禾'), '');
  assert.equal(buildWeatherAlertContext(null, '阿禾'), '');
});

// ── 预报缓存 ──

test('预报缓存：命中时不发网络请求，过期后重新查', async () => {
  const settings = { weatherLocation: '成都 武侯区', weatherEnabled: true, weatherAlertEnabled: true };
  let fetches = 0;
  let writes = 0;
  const cache = {
    location: settings.weatherLocation,
    fetchedAt: NOW.getTime() - 10 * 60 * 1000,
    forecast: normalizeForecastPayload({
      timezone: 'Asia/Shanghai',
      utc_offset_seconds: 28800,
      hourly: { time: ['2026-10-22T10:00'], temperature_2m: [20] },
      daily: { time: [TODAY] },
    }),
  };
  const data = {
    getSettings: () => settings,
    getWeatherForecastCache: () => cache,
    setWeatherForecastCache: async () => { writes += 1; },
  };
  const fetcher = async () => { fetches += 1; throw new Error('cache hit must not query'); };

  const hit = await getWeatherForecast({ data, now: NOW, fetcher });
  assert.equal(fetches, 0);
  assert.equal(writes, 0);
  assert.equal(hit.location, settings.weatherLocation);

  // 超过 1 小时就该重新查了
  const stale = { ...cache, fetchedAt: NOW.getTime() - 2 * 3600 * 1000 };
  const data2 = {
    getSettings: () => settings,
    getWeatherForecastCache: () => stale,
    setWeatherForecastCache: async () => { writes += 1; },
  };
  const fetcher2 = async () => ({
    timezone: 'Asia/Shanghai',
    utc_offset_seconds: 28800,
    hourly: { time: ['2026-10-22T10:00'], temperature_2m: [20] },
    daily: { time: [TODAY] },
  });
  const refreshed = await getWeatherForecast({ data: data2, now: NOW, fetcher: fetcher2 });
  assert.equal(fetches, 0);
  assert.equal(writes, 1);
  assert.ok(refreshed.forecast.hourly.time.length === 1);
});

test('预报缓存：默认一小时过期，地点对得上才算命中', () => {
  const settings = { weatherLocation: '成都 武侯区' };
  const cache = { location: '成都 武侯区', fetchedAt: NOW.getTime(), forecast: { hourly: {}, daily: {} } };
  assert.equal(weatherForecastCacheIsFresh(cache, settings, NOW), true);
  assert.equal(weatherForecastCacheIsFresh({ ...cache, fetchedAt: NOW.getTime() - 3600 * 1000 }, settings, NOW), false);
  assert.equal(weatherForecastCacheMatches(cache, settings), true);
  assert.equal(weatherForecastCacheMatches({ ...cache, location: '绵阳 涪城区' }, settings), false);
});
