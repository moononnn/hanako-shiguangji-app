import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { apply } from '../index.js';
import { getSharedUserData } from '../lib/shared-data.js';
import { flushPublicTodayPublisher } from '../lib/public-today.js';

test('保存后共享：页面与聊天共用的数据层改动立即更新，不等下一轮聊天或分钟计时', async () => {
  const dataDir = mkdtempSync(path.join(tmpdir(), 'sgj-save-share-'));
  const published = [];
  await apply({dataDir, hooks:{onDecision(){}},tools:{register(){}},
    bus:{async request(){return {agents:[]};}},
    publicData:{async publish(value){published.push(value.data);}}});
  await new Promise(resolve=>setTimeout(resolve,30));
  await flushPublicTodayPublisher();
  const data=getSharedUserData(dataDir);
  const today=published.at(-1).today.date;
  const event=await data.addEvent({title:'新增日子',date:today});
  await flushPublicTodayPublisher();
  assert.ok(published.at(-1).today.events.includes('新增日子'));
  await data.updateEvent(event.id,{title:'修改日子'}); await flushPublicTodayPublisher();
  assert.ok(published.at(-1).today.events.includes('修改日子'));
  assert.ok(!published.at(-1).today.events.includes('新增日子'));
  await data.removeEvent(event.id); await flushPublicTodayPublisher();
  assert.ok(!published.at(-1).today.events.includes('修改日子'));
  const period=await data.markPeriod(new Date(today+'T12:00:00'));
  await flushPublicTodayPublisher(); assert.equal(published.at(-1).today.period,true);
  await data.updateSettings({showPeriod:false}); await flushPublicTodayPublisher();
  assert.equal(published.at(-1).today.period,false);
  assert.ok(period.event);
});
