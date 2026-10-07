import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { registerDaybookTools } from '../lib/app-tools.js';
import { getSharedUserData } from '../lib/shared-data.js';

function context() {
  const tools = [];
  return { dataDir: mkdtempSync(path.join(tmpdir(), 'sgj-tools-app-')),
    tools: { register(tool) { tools.push(tool); } }, registered: tools };
}

test('App 工具：保留命名空间，查询免审阅，写入不冒充只读', () => {
  const ctx = context();
  registerDaybookTools(ctx);
  assert.deepEqual(ctx.registered.map(t => t.name), ['shiguangji_today', 'shiguangji_add_event', 'shiguangji_complete_todo']);
  assert.equal(ctx.registered[0].sessionPermission.readOnly, true);
  assert.notEqual(ctx.registered[1].sessionPermission?.readOnly, true);
  assert.notEqual(ctx.registered[2].sessionPermission?.readOnly, true, '勾完成也是写，不能冒充只读');
});

test('App 工具：聊天记日子写到自己的账本，待办同步调度，查询能看见', async () => {
  const ctx = context();
  const changed = [];
  registerDaybookTools(ctx, event => changed.push(event));
  const day = new Date();
  const date = [day.getFullYear(), String(day.getMonth() + 1).padStart(2, '0'), String(day.getDate()).padStart(2, '0')].join('-');
  const result = await ctx.registered[1].execute({ date, title: '临时测试待办', type: 'todo', reminderStart: '15:00', reminderEnd: '15:00' });
  assert.match(result.content[0].text, /已记下/);
  assert.equal(getSharedUserData(ctx.dataDir).listEvents().length, 1);
  assert.equal(changed.length, 1);
  assert.equal(changed[0].type, 'todo');
  const query = await ctx.registered[0].execute({});
  assert.match(query.content[0].text, /临时测试待办/);
});

test('App 工具：无效记录不会触发提醒同步，也不伪装记成功', async () => {
  const ctx = context();
  let changed = 0;
  registerDaybookTools(ctx, () => changed++);
  const result = await ctx.registered[1].execute({ date: 'bad-date', title: 'bad' });
  assert.match(result.content[0].text, /没记成/);
  assert.equal(changed, 0);
  assert.equal(getSharedUserData(ctx.dataDir).listEvents().length, 0);
});
