import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { configurePublicTodayPublisher, flushPublicTodayPublisher, writePublicToday, fitPublicTodayBudget } from '../lib/public-today.js';

const now = new Date('2026-10-05T09:41:00+08:00');
function data(rev = 1) {
  return { getSettings: () => ({ dayBoundaryHour: 4 }), getDataRev: () => rev,
    eventsOnDate: () => [], periodsWithDayOn: () => [], listEvents: () => [],
    listSummaryEntries: () => [], getWeatherCache: () => null };
}
function job(rev = 1) { return { dataDir: mkdtempSync(path.join(tmpdir(), 'sgj-public-app-')), data: data(rev), now }; }
afterEach(() => configurePublicTodayPublisher(null));

test('App 快照：写盘同时发布给宿主，不读取旧插件目录', async () => {
  const calls = [];
  configurePublicTodayPublisher({ publicData: { async publish(value) { calls.push(value); } } });
  const snapshot = writePublicToday(job());
  await flushPublicTodayPublisher();
  assert.equal(calls.length, 1);
  assert.equal(calls[0].key, 'today');
  assert.equal(calls[0].schemaVersion, 1);
  assert.deepEqual(calls[0].data, snapshot);
});

test('App 快照：内容不变不重复发布，重启重新绑定后仍发布一次', async () => {
  const calls = [];
  const ctx = { publicData: { async publish(value) { calls.push(value); } } };
  const input = job();
  configurePublicTodayPublisher(ctx);
  writePublicToday(input); await flushPublicTodayPublisher();
  writePublicToday(input); await flushPublicTodayPublisher();
  assert.equal(calls.length, 1);
  configurePublicTodayPublisher(ctx);
  writePublicToday(input); await flushPublicTodayPublisher();
  assert.equal(calls.length, 2);
});

test('App 快照：撤权/失败不影响本地记录，下一次刷新可重试', async () => {
  let attempts = 0;
  const warnings = [];
  configurePublicTodayPublisher({ publicData: { async publish() {
    if (++attempts === 1) throw Object.assign(new Error('not granted'), { code: 'APP_CAPABILITY_NOT_GRANTED' });
  } }, logger: { warn(value) { warnings.push(value); } } });
  const input = job();
  assert.ok(writePublicToday(input)); await flushPublicTodayPublisher();
  assert.equal(warnings.length, 1);
  writePublicToday(input); await flushPublicTodayPublisher();
  assert.equal(attempts, 2);
});

test('App 快照：成功后撤权清掉宿主快照，再授权时无内容变化也能恢复发布', async () => {
  let allowed=true, visible=false, attempts=0;
  configurePublicTodayPublisher({publicData:{
    async list(input){assert.equal(input.appId,'shiguangji-app');return {entries:visible?[{key:'today'}]:[]};},
    async publish(){attempts++; if(!allowed)throw new Error('publish denied');visible=true;},
  }});
  const input=job();
  writePublicToday(input);await flushPublicTodayPublisher();assert.equal(visible,true);
  allowed=false;visible=false;
  writePublicToday(input);await flushPublicTodayPublisher();assert.equal(visible,false);
  allowed=true;
  writePublicToday(input);await flushPublicTodayPublisher();
  assert.equal(visible,true,'宿主快照被清后不能被本地指纹缓存永久挡住');
  assert.equal(attempts,3);
});

test('App 快照：发布按顺序完成，最后一份是最新数据', async () => {
  const revisions = [];
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  configurePublicTodayPublisher({ publicData: { async publish(value) {
    if (value.data.dataRev === 1) await gate;
    revisions.push(value.data.dataRev);
  } } });
  writePublicToday(job(1));
  await Promise.resolve();
  writePublicToday(job(2));
  release();
  await flushPublicTodayPublisher();
  assert.deepEqual(revisions, [1, 2]);
});

test('App 快照：总 JSON 不超过宿主 64 KiB，中文和表情按真实字节计，伙伴各归各的', () => {
  const summaries = Object.fromEntries(Array.from({length: 40}, (_, i) => [`partner-${i}`, [
    {date: '2026-10-03', text: `旧日${i}：` + '茶香😀\\"'.repeat(300)},
    {date: '2026-10-04', text: `新日${i}：` + '中文😀\\"'.repeat(300)},
  ]]));
  const input = {schemaVersion:1, generatedAt: now.toISOString(), dataRev:1,
    today:{date:'2026-10-05',events:['纪念日'],todos:['喝茶']},weather:null,summaries};
  const original = JSON.stringify(input);
  const trimmed = fitPublicTodayBudget(input);
  assert.ok(Buffer.byteLength(JSON.stringify(trimmed),'utf8') <= 64 * 1024);
  assert.deepEqual(Object.keys(trimmed.summaries), Object.keys(summaries));
  assert.deepEqual(trimmed.today, input.today);
  assert.equal(JSON.stringify(input), original, '不修改本地完整档案');
  for (const [id, rows] of Object.entries(trimmed.summaries)) {
    const mine = id.split('-').at(-1);
    assert.ok(rows.some(row => row.text.startsWith(`新日${mine}：`)), '优先保留每位伙伴的最新回顾');
    assert.ok(rows.every(row => !/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/.test(row.text)));
  }
});

test('App 快照：真实发布入口先裁到宿主上限，本地完整快照不受影响', async () => {
  const calls=[];
  configurePublicTodayPublisher({publicData:{async publish(value){
    assert.ok(Buffer.byteLength(JSON.stringify(value.data),'utf8')<=64*1024);
    calls.push(value);
  }}});
  const input=job();
  input.data.listSummaryEntries=()=>Array.from({length:40},(_,i)=>({
    agentId:`partner-${i}`,date:'2026-10-04',text:'这一天的中文回顾😀'.repeat(250),
  }));
  const local=writePublicToday(input);
  assert.ok(Buffer.byteLength(JSON.stringify(local),'utf8')>64*1024);
  await flushPublicTodayPublisher();
  assert.equal(calls.length,1);
  assert.equal(Object.keys(calls[0].data.summaries).length,40);
  assert.ok(local.summaries['partner-0'][0].text.length>calls[0].data.summaries['partner-0'][0].text.length);
});

test('App 快照：小快照不裁剪，完整保留既有业务 schema', () => {
  const input = {schemaVersion:1,today:{date:'2026-10-05'},summaries:{one:[{date:'2026-10-04',text:'一小段'}]}};
  assert.deepEqual(fitPublicTodayBudget(input), input);
});
