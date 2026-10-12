import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeWeatherResult, translateWeatherToMood, getWeatherForInject, ensureWeatherFresh } from '../lib/weather.js';
import { buildInjectionText, weatherFactKey, decideWeatherMention } from '../lib/inject.js';
import { readSnapshotWeather } from '../lib/public-today.js';
process.env.TZ = 'Asia/Shanghai';
const at = hour => new Date(2026, 9, 12, hour, 14);
const legacy = { place: '成都 武侯区', line: '小雨，淅淅沥沥，19°C，清晨刚亮', temp: 19, code: 53, isDay: true };
const settings = { weatherLocation: '成都 武侯区', weatherEnabled: true, weatherIntervalHours: 3 };
const cache = { location: settings.weatherLocation, fetchedAt: at(7).getTime(), result: legacy };

for (const [hour, label] of [[1, '凌晨时分'], [6, '清晨时分'], [9, '上午时分'], [12, '午间时分'], [15, '下午时分'], [18, '傍晚时分'], [21, '夜间时分']]) {
  test(`天气时段：缓存事实不变，${hour}点按当前钟点显示${label}`, () => {
    const result = normalizeWeatherResult(legacy, at(hour));
    assert.equal(result.line, `小雨，淅淅沥沥，19°C，${label}`);
    assert.equal(result.temp, legacy.temp);
    assert.equal(result.code, legacy.code);
    assert.equal(result.isDay, legacy.isDay, '观测的昼夜字段不靠钟点伪造');
    assert.equal(legacy.line, '小雨，淅淅沥沥，19°C，清晨刚亮');
  });
}

test('天气时段：晴雨都不凭钟点推断天亮、阳光、月色或天黑', () => {
  for (const [code, isDay, hour] of [[53, 1, 12], [0, 1, 6], [0, 0, 21], [1, 0, 21]]) {
    const result = translateWeatherToMood({ current: { temperature_2m: 19, weather_code: code, is_day: isDay, time: '2026-10-12T07:00:00+08:00' } }, at(hour));
    assert.doesNotMatch(result.line, /刚亮|阳光|夜色清亮|天已经黑|月亮|星星/);
    assert.ok(result.line.includes('19°C'));
  }
});

test('天气时段：已正规化的行反复读取不叠加时段，也不修改缓存', () => {
  const result = normalizeWeatherResult(legacy, at(9));
  assert.deepEqual(normalizeWeatherResult(result, at(9)), result);
  assert.equal(normalizeWeatherResult(result, at(15)).line, '小雨，淅淅沥沥，19°C，下午时分');
  assert.equal(cache.result, legacy);
});

test('天气时段：未知昼夜反复读取仍未知，不把时段标签当观测证据', () => {
  for (const hour of [1, 6, 9, 12, 18, 21]) {
    const source = { line: '天气状态待确认', temp: 19 };
    const result = normalizeWeatherResult(source, at(hour));
    assert.equal(result.isDay, null);
    assert.deepEqual(normalizeWeatherResult(result, at(hour)), result);
    assert.equal(weatherFactKey(source), weatherFactKey(result));
  }
});

test('天气时段：缓存命中零网络零写盘，两个公共读取入口都按当前时间显示', async () => {
  let fetches = 0;
  let writes = 0;
  const data = { getSettings: () => settings, getWeatherCache: () => cache, setWeatherCache: async () => { writes++; } };
  const fetcher = async () => { fetches++; throw new Error('cache hit must not query'); };
  assert.equal((await getWeatherForInject({ data, now: at(9), fetcher })).line, '小雨，淅淅沥沥，19°C，上午时分');
  assert.equal((await ensureWeatherFresh({ data, now: at(9), fetcher })).line, '小雨，淅淅沥沥，19°C，上午时分');
  assert.equal(fetches, 0);
  assert.equal(writes, 0);
  assert.equal(legacy.line, '小雨，淅淅沥沥，19°C，清晨刚亮');
});

test('天气时段：共享快照与注入文本按各自 now 重绘，素材不强制播报', () => {
  const data = { getWeatherCache: () => cache };
  assert.equal(readSnapshotWeather(data, settings, at(9)).line, '小雨，淅淅沥沥，19°C，上午时分');
  const text = buildInjectionText({ now: at(9), weather: legacy, force: true });
  assert.ok(text.includes('【窗外】小雨，淅淅沥沥，19°C，上午时分'));
  assert.ok(!text.includes('清晨刚亮'));
  assert.ok(text.includes('不要单独起一句报温度'));
});

test('天气时段：新旧时段不改变事实指纹，不额外突破天气提及冷却', () => {
  for (const source of [legacy, { place: '某地', line: '云层慢慢散开，19°C，清晨刚亮', temp: 19, isDay: true }]) {
    const morning = normalizeWeatherResult(source, at(7));
    const later = normalizeWeatherResult(source, at(9));
    assert.equal(weatherFactKey(morning), weatherFactKey(later));
    assert.equal(weatherFactKey(source), weatherFactKey(later));
    assert.equal(decideWeatherMention({ weather: later, now: at(9), lastState: { weatherLastMentionAt: at(7).getTime(), weatherLastFactKey: weatherFactKey(morning) } }).should, false);
  }
});
