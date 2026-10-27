import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createSessionMetaResolver } from '../lib/session-kind.js';

test('分区缓存：只有标题时不占用30分钟正缓存，负缓存到期后重查', async () => {
  let calls = 0;
  const resolve = createSessionMetaResolver({ negativeTtlMs: 0, bus: { async request() {
    calls += 1;
    return { session: calls === 1 ? { title: '新窗口' } : { title: '新窗口', namespace: 'code' } };
  } } });
  assert.equal((await resolve({ sessionId: 'title-only' })).namespace, '');
  assert.equal((await resolve({ sessionId: 'title-only' })).namespace, 'code');
  assert.equal((await resolve({ sessionId: 'title-only' })).namespace, 'code');
  assert.equal(calls, 2, '查清后的分区才使用长缓存');
});

test('分区缓存：ID查询只有标题时继续使用路径查清分区', async () => {
  const payloads = [];
  const resolve = createSessionMetaResolver({ bus: { async request(_event, payload) {
    payloads.push(payload);
    return { session: payload.sessionId ? { title: '窗口' } : { title: '窗口', namespace: 'code' } };
  } } });
  const meta = await resolve({ sessionId: 'by-id', sessionPath: 'fixture/sessions/window.jsonl' });
  assert.equal(meta.namespace, 'code');
  assert.equal(payloads.length, 2);
  assert.equal(payloads[1].legacySessionPath, 'fixture/sessions/window.jsonl');
});

test('分区缓存：未知分区同样只短暂缓存，不把未知值当作已确认', async () => {
  let calls = 0;
  const resolve = createSessionMetaResolver({ negativeTtlMs: 0, bus: { async request() {
    calls += 1;
    return { session: { namespace: calls === 1 ? 'future-namespace' : 'home', title: '窗口' } };
  } } });
  assert.equal((await resolve({ sessionId: 'unknown-namespace' })).namespace, '');
  assert.equal((await resolve({ sessionId: 'unknown-namespace' })).namespace, 'home');
  assert.equal(calls, 2);
});
