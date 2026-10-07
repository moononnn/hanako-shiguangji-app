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
  assert.deepEqual(hooks.map(h=>h.name).sort(), ['agent/before-start','messages/post-assistant']);
  assert.equal(tools.length, 3);
  await new Promise(resolve => setTimeout(resolve, 30));
  await flushPublicTodayPublisher();
  assert.deepEqual(verbs, ['agent:list']);
  assert.equal(shared.length, 1);
  assert.equal(shared[0].key, 'today');
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
  assert.equal(shared.at(-1).data.today.date, '2026-10-05');
  t.mock.timers.tick(60_000); await flushPublicTodayPublisher();
  assert.equal(shared.length, 1);
  t.mock.timers.setTime(Date.parse('2026-10-06T09:41:00+08:00'));
  t.mock.timers.tick(60_000); await flushPublicTodayPublisher();
  assert.equal(shared.at(-1).data.today.date, '2026-10-06');
  assert.equal(shared.length, 2);
});

test('工具登记同步失败：保留错误交宿主裁决，不伪装成完整装载', async () => {
  const dataDir=mkdtempSync(path.join(tmpdir(),'sgj-entry-duplicate-'));
  await assert.rejects(apply({dataDir,hooks:{onDecision(){}},
    tools:{register(){throw new Error('duplicate tool name');}}}),/duplicate tool name/);
});
