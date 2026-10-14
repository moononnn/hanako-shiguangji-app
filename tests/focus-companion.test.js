import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { UserData } from '../lib/data.js';
import { registerFocusStateService, getFocusCompanions, resolveFocusCompanion, fetchFocusAvatar, syncFocusCompanion } from '../lib/focus-companion.js';

test('陪读服务：只向茶话会提供选中约定，结算只取指定记录，不公开历史和心情', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'focus-private-'));
  try {
    const data = new UserData(dir);
    const registered = {};
    registerFocusStateService({ data, ctx: { bus: { handle(name, handler, options) { registered[name] = { handler, options }; } } } });
    const { handler, options } = registered['focus/state'];
    assert.equal(options.allowCrossApp, true);
    await assert.rejects(handler({}, { callerAppId: 'other' }), /只向茶话会/);
    const started = await data.startFocusSession({ taskTitle: '读书', focusMinutes: 30, companionId: 'reader', companionName: '搭子' });
    const state = await handler({}, { callerAppId: 'chahuahui' });
    assert.equal(state.active.companionId, 'reader');
    assert.equal(state.active.taskTitle, '读书');
    assert.equal(state.sessions, undefined);
    assert.equal(state.stats, undefined);
    await data.pauseFocusSession();
    assert.ok((await handler({}, { callerAppId: 'chahuahui' })).active.pausedAt);
    await data.resumeFocusSession();
    await data.endFocusSession();
    const ended = await handler({ sessionId: started.id }, { callerAppId: 'chahuahui' });
    assert.equal(ended.active, null);
    assert.equal(ended.session.status, 'interrupted');
    assert.equal(ended.session.companionName, '搭子');
    assert.equal((await handler({ sessionId: 'unknown' }, { callerAppId: 'chahuahui' })).session, null);
    const legacy = await data.startFocusSession({ focusMinutes: 15 });
    assert.equal((await handler({}, { callerAppId: 'chahuahui' })).active, null);
    assert.ok(legacy.id);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('多轮计划：轮次字段投影给茶话会，收尾记录也带得上', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'focus-rounds-'));
  try {
    const data = new UserData(dir);
    const registered = {};
    registerFocusStateService({ data, ctx: { bus: { handle(name, handler) { registered[name] = { handler }; } } } });
    const { handler } = registered['focus/state'];
    const started = await data.startFocusSession({ taskTitle: '读书', focusMinutes: 15, companionId: 'reader', companionName: '搭子', totalRounds: 3, shortBreakMinutes: 5, longBreakEvery: 2 });
    const active = (await handler({}, { callerAppId: 'chahuahui' })).active;
    assert.equal(active.roundIndex, 1);
    assert.equal(active.totalRounds, 3);
    assert.equal(active.breakMinutes, 5);
    // 长休间隔不投影：茶话会只用得上“歇多久”，不需要知道整组的长休排布。
    assert.equal(active.longBreakEvery, undefined);
    assert.equal(active.breakKind, undefined);
    // 过界进休息：轮次不变，休息种类算出来，茶话会那边照样分得出这是第几轮。
    const broken = await data.advanceFocusSession(new Date(Date.parse(active.targetAt) + 1000));
    assert.equal(broken.phase, 'break');
    assert.equal(broken.roundIndex, 1);
    assert.equal(broken.breakKind, 'short');
    const session = (await handler({ sessionId: started.id }, { callerAppId: 'chahuahui' })).session;
    assert.equal(session.status, 'completed');
    assert.equal(session.roundIndex, 1);
    assert.equal(session.totalRounds, 3);
    // 还有下一轮，不能显示成整组做完。
    assert.equal(session.planStatus, 'active');
    // 休息结束自动开下一轮，编号换新、轮次加一。
    const next = await data.advanceFocusSession(new Date(Date.parse(broken.targetAt) + 1000));
    assert.equal(next.phase, 'focus');
    assert.equal(next.roundIndex, 2);
    assert.equal(next.totalRounds, 3);
    assert.notEqual(next.id, started.id);
    // 单轮老记录没有轮次字段时也不报错，只是拿不到。
    const legacy = await handler({ sessionId: 'nope' }, { callerAppId: 'chahuahui' });
    assert.equal(legacy.session, null);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

const partnersCtx = partners => ({ bus: { request: async name => {
  if (name.endsWith('/focus/partners')) return { ok: true, partners };
  return { ok: true };
} } });

test('独立专注：不选伙伴不碰茶话会，选中的伙伴拿不到时明确失败不降级', async () => {
  const broken = { bus: { request: async () => { throw new Error('denied'); } } };
  assert.deepEqual(await resolveFocusCompanion(broken, ''), { companionId: '', companionName: '' });
  assert.deepEqual(await resolveFocusCompanion(broken, '   '), { companionId: '', companionName: '' });
  await assert.rejects(resolveFocusCompanion(broken, 'reader'), /茶话会|茶会|联系不上/);
  const ctx = partnersCtx([{ id: 'reader', name: '搭子', secrets: 'hidden' }, { id: null, name: 'invalid' }]);
  assert.deepEqual(await resolveFocusCompanion(ctx, 'reader'), { companionId: 'reader', companionName: '搭子' });
  await assert.rejects(resolveFocusCompanion(ctx, 'gone'), /不在茶话会名单/);
});

test('陪伴目录：四种状态分开报，拿不到时不留旧茶话会伙伴', async () => {
  const ok = await getFocusCompanions(partnersCtx([{ id: 'reader', name: '搭子', secrets: 'hidden' }]));
  assert.equal(ok.status, 'available');
  assert.equal(ok.available, true);
  assert.equal(ok.error, '');
  assert.deepEqual(ok.partners, [{ id: 'reader', name: '搭子', avatar: 'api/focus/avatar/reader' }]);

  const empty = await getFocusCompanions(partnersCtx([]));
  assert.equal(empty.status, 'empty');
  assert.equal(empty.available, false);
  assert.deepEqual(empty.partners, []);
  assert.match(empty.error, /还没有可陪读的伙伴/);

  const absent = await getFocusCompanions({ bus: { request: async () => {
    const error = new Error('app "chahuahui" is not installed');
    error.code = 'APP_NOT_INSTALLED';
    throw error;
  } } });
  assert.equal(absent.status, 'absent');
  assert.equal(absent.available, false);
  assert.deepEqual(absent.partners, []);

  // 拒权、停用、超时、报错格式不认识，一律 unavailable，不能猜成没装。
  for (const error of [new Error('denied'), new Error('permission'), Object.assign(new Error('x'), { code: 'ETIMEDOUT' }), new Error('没有这个 handler')]) {
    const result = await getFocusCompanions({ bus: { request: async () => { throw error; } } });
    assert.equal(result.status, 'unavailable', error.message);
    assert.deepEqual(result.partners, []);
  }
  const unknown = await getFocusCompanions({ bus: { request: async () => ({ ok: true, partners: 'not-a-list' }) } });
  assert.equal(unknown.status, 'unavailable');
});

// 真实的 1×1 PNG，不是凑出来的魔数。
const PNG_B64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

test('头像代理：只认茶话会给的真图字节，编号和类型都不过关就交空', async () => {
  const png = Buffer.from(PNG_B64, 'base64');
  assert.ok(png.length > 12 && png[0] === 0x89 && png[1] === 0x50, '夹具得是能过真图检查的 PNG');
  const avatarCtx = avatar => ({ bus: { request: async () => ({ ok: true, avatar }) } });
  const pngAvatar = { contentType: 'image/png', base64: PNG_B64 };
  const found = await fetchFocusAvatar(avatarCtx(pngAvatar), 'reader');
  assert.equal(found.contentType, 'image/png');
  assert.deepEqual(found.bytes, png);
  assert.equal(await fetchFocusAvatar(avatarCtx(pngAvatar), ''), null);
  assert.equal(await fetchFocusAvatar(avatarCtx(pngAvatar), 'x'.repeat(201)), null);

  for (const avatar of [{ contentType: 'text/html', base64: PNG_B64 }, { contentType: 'image/png', base64: '' }, null]) {
    assert.equal(await fetchFocusAvatar(avatarCtx(avatar), 'reader'), null, JSON.stringify(avatar));
  }
  // 声明是图、字节不是图：不放行。
  const fake = Buffer.from('<html>this is not an image</html>');
  assert.equal(await fetchFocusAvatar(avatarCtx({ contentType: 'image/png', base64: fake.toString('base64') }), 'reader'), null);
  assert.equal(await fetchFocusAvatar(avatarCtx({ contentType: 'image/png', base64: Buffer.from('短').toString('base64') }), 'reader'), null);
  // 声明与字节对不上：同一份 PNG 报成 jpeg/webp/gif 都得拒。
  for (const contentType of ['image/jpeg', 'image/webp', 'image/gif']) {
    assert.equal(await fetchFocusAvatar(avatarCtx({ contentType, base64: PNG_B64 }), 'reader'), null, contentType);
  }
  const jpeg = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(16, 1)]);
  assert.equal(await fetchFocusAvatar(avatarCtx({ contentType: 'image/png', base64: jpeg.toString('base64') }), 'reader'), null);
  // 真 webp 头配自己声明才过。
  const webp = Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4, 1), Buffer.from('WEBPVP8 '), Buffer.alloc(8, 1)]);
  assert.equal((await fetchFocusAvatar(avatarCtx({ contentType: 'image/webp', base64: webp.toString('base64') }), 'reader'))?.contentType, 'image/webp');

  const huge = Buffer.alloc(7 * 1024 * 1024);
  assert.equal(await fetchFocusAvatar(avatarCtx({ contentType: 'image/png', base64: huge.toString('base64') }), 'reader'), null);
  // 宿主伙伴头像常见 1~2MB：抬闸后必须能过，否则又会退回首字。
  const twoMb = Buffer.concat([png, Buffer.alloc(2 * 1024 * 1024, 1)]);
  assert.equal((await fetchFocusAvatar(avatarCtx({ contentType: 'image/png', base64: twoMb.toString('base64') }), 'reader'))?.contentType, 'image/png');
  assert.equal(await fetchFocusAvatar({ bus: { request: async () => { throw new Error('denied'); } } }, 'reader'), null);
});

test('陪读服务不可用：只记 code 和归类，报错原文不进日志', async () => {
  const lines = [];
  const ctx = { log: { warn: line => lines.push(String(line)) }, bus: { request: async () => {
    const error = new Error(`读不到 C:\\Users\\someone\\secret\\app.json`);
    error.code = 'EACCES';
    throw error;
  } } };
  assert.equal((await getFocusCompanions(ctx)).status, 'unavailable');
  assert.equal(lines.length, 1);
  assert.match(lines[0], /EACCES/);
  assert.match(lines[0], /unavailable/);
  assert.ok(!lines[0].includes('secret') && !lines[0].includes('app.json'));
  assert.deepEqual(await getFocusCompanions({ bus: { request: async () => { throw new Error('x'); } } }), {
    status: 'unavailable', available: false, partners: [], reminderStatus: null,
    error: '暂时联系不上茶话会。不选伙伴照样可以自己专注。',
  });
});

test('陪读同步：茶话会没确认就说没接通，不假装同步成功', async () => {
  const unavailable = { bus: { request: async () => { throw new Error('denied'); } } };
  assert.match(await syncFocusCompanion(unavailable), /尚未确认/);
  const ctx = partnersCtx([]);
  assert.equal(await syncFocusCompanion(ctx), '');
  const failed = { bus: { request: async () => ({ ok: true, reminderStatus: { failed: true } }) } };
  assert.match(await syncFocusCompanion(failed), /没能生成/);
});
