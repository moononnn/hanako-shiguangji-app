import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { apply } from '../index.js';
import { flushPublicTodayPublisher } from '../lib/public-today.js';

test('正式入口：登记实际贡献，不采样其他会话、不记录正文探针', async () => {
  const dataDir = mkdtempSync(path.join(tmpdir(), 'sgj-entry-'));
  const hooks = [], tools = [], verbs = [], shared = [];
  await apply({ dataDir,
    hooks: { onDecision(name, fn) { hooks.push({name,fn}); } },
    tools: { register(value) { tools.push(value); } },
    bus: { async request(verb) { verbs.push(verb); if (verb === 'agent:list') return {agents:[]}; throw new Error('不应采样会话'); } },
    publicData: { async publish(value) { shared.push(value); } },
  });
  // pre-step 负责把历史里过期的峰谷提示收掉，让「必须说出口」只管一轮。
  assert.deepEqual(hooks.map(h=>h.name).sort(), ['agent/before-start','agent/pre-step','messages/post-assistant']);
  assert.equal(tools.length, 3);
  await new Promise(resolve => setTimeout(resolve, 30));
  await flushPublicTodayPublisher();
  assert.deepEqual(verbs, ['agent:list']);
  // today / greetings / alerts 同一条通道、各占一个 key：启动时各发一次。
  assert.deepEqual(shared.map(value => value.key).sort(), ['alerts', 'greetings', 'today']);
  assert.equal(shared.find(value => value.key === 'greetings').schemaVersion, 1);
  assert.deepEqual(shared.find(value => value.key === 'greetings').data.entries, []);
  // 没配地点、没预报：天气提醒摊一份空清单，reason 说明缘由。
  assert.equal(shared.find(value => value.key === 'alerts').schemaVersion, 1);
  assert.deepEqual(shared.find(value => value.key === 'alerts').data.events, []);
  assert.equal(shared.find(value => value.key === 'alerts').data.reason, 'no-forecast');
  assert.equal(existsSync(path.join(dataDir, 'probe.log')), false);
});

test('共享情境：只在茶话会聊天也能跨天刷新，无变化不反复发布', async t => {
  t.mock.timers.enable({ apis: ['setInterval', 'Date'], now: Date.parse('2026-10-05T09:41:00+08:00') });
  const dataDir = mkdtempSync(path.join(tmpdir(), 'sgj-entry-day-'));
  const shared = [];
  await apply({ dataDir,
    hooks: { onDecision() {} }, tools: { register() {} },
    bus: { async request() { return {agents:[]}; } },
    publicData: { async publish(value) { shared.push(value); } },
  });
  await new Promise(resolve => setTimeout(resolve, 30));
  await flushPublicTodayPublisher();
  const todayData = () => shared.filter(v => v.key === 'today').at(-1).data;
  assert.equal(todayData().today.date, '2026-10-05');
  t.mock.timers.tick(60_000); await flushPublicTodayPublisher();
  assert.equal(shared.length, 3, '第一轮：today / greetings / alerts 各一份');
  t.mock.timers.setTime(Date.parse('2026-10-06T09:41:00+08:00'));
  t.mock.timers.tick(60_000); await flushPublicTodayPublisher();
  assert.equal(todayData().today.date, '2026-10-06');
  assert.equal(shared.length, 5, 'today 与 alerts 的日期键都变了，greetings 没变就不重发');
});

test('工具登记同步失败：保留错误交宿主裁决，不伪装成完整装载', async () => {
  const dataDir=mkdtempSync(path.join(tmpdir(),'sgj-entry-duplicate-'));
  await assert.rejects(apply({dataDir,hooks:{onDecision(){}},
    tools:{register(){throw new Error('duplicate tool name');}}}),/duplicate tool name/);
});
