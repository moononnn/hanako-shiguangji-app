import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { renderPage } from '../lib/page-template.js';

const html = renderPage('');
const script = [...html.matchAll(/<script>([\s\S]*?)<\/script>/gi)].map(m => m[1]).find(s => s.includes('function renderFocusPage()'));
const focusCode = script.slice(script.indexOf('function focusTodayKey()'), script.indexOf('/* ── 今日概览 ── */'));

// Minimal DOM double: checks node identity and writes, not browser layout/IME behavior.
function harness() {
  const nodes = new Map();
  class Element {
    constructor(id) {
      this.id = id; this.dataset = {}; this._html = ''; this.writes = 0;
      this.textContent = ''; this.disabled = false; this.open = false;
      this.value = ''; this.selectionStart = 0; this.selectionEnd = 0;
      this.classes = new Set(); this.attrs = {};
      this.classList = { add: c => this.classes.add(c), remove: c => this.classes.delete(c),
        contains: c => this.classes.has(c), toggle: (c, on) => on ? this.classes.add(c) : this.classes.delete(c) };
    }
    get innerHTML() { return this._html; }
    set innerHTML(value) {
      this._html = value; this.writes++;
      for (const m of value.matchAll(/id="([^"]+)"/g)) nodes.set(m[1], new Element(m[1]));
    }
    setAttribute(key, value) { this.attrs[key] = value; }
    contains(node) { return !!node && node.id.startsWith('focus-'); }
    focus() { document.activeElement = this; }
    querySelector(selector) { return selector === 'button' && this._html.includes('<button') ? new Element('focus-companion-choice') : null; }
    querySelectorAll() { return []; }
  }
  const document = { activeElement: null, getElementById: id => nodes.get(id) || null };
  for (const id of ['focus-timer-card', 'focus-session-list', 'focus-week-summary', 'focus-week-bars', 'focus-mini-indicator', 'panel-focus']) nodes.set(id, new Element(id));
  const calls = [], notices = [];
  const snapshot = { active: null, sessions: [], groups: [], favoriteGoals: [], favoriteGoalConfigs: {}, focusConfig: null, stats: null, taskOptions: [{ id: 'todo-1', title: '读一章书', date: '2026-10-12' }], companionOptions: { available: true, partners: [{ id: 'reader', name: '陪读伙伴' }, { id: 'writer', name: '写作伙伴' }] } };
  const context = vm.createContext({ document, Date, console, URL, AbortSignal, setInterval() {},
    apiFetch: async () => ({ ok: false }),
    focusSnapshot: snapshot, focusSelectedTaskId: '', focusSelectedCompanionId: '', focusFreeTitle: '', focusMinutes: 25, focusTotalRounds: 4, breakMinutes: 5,
    focusLongBreakEnabled: true, focusLongBreakEvery: 4, focusLongBreakMinutes: 15, focusSettingsInitialized: false, focusSettingsTouched: false,
    focusSelectedFavoriteTitle: '', focusConfigSaveQueue: Promise.resolve(), focusConfigSaveSequence: 0, focusFavoritePending: false,
    focusActionPending: false, focusAdvancePending: false, focusAdvanceRetryAt: 0, focusLastRefreshAt: Date.now(), focusStatusNotice: '', focusTicker: null,
    esc: value => String(value ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('"', '&quot;'),
    jsArg: value => JSON.stringify(value), dk: (y, m, d) => `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`, WEEK: ['日', '一', '二', '三', '四', '五', '六'],
    toast: value => notices.push(value), api: async (url, options) => { calls.push([url, options]); return { ok: true, ...snapshot }; },
    switchTab() {}, selectedDate: '', askConfirm() {},
  });
  vm.runInContext(focusCode, context);
  context.renderFocusPage();
  return { context, nodes, calls, notices, document };
}

test('专注UI：准备主线、统计折叠与隐私说明保留，三段脚本解析', () => {
  const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/gi)];
  assert.equal(scripts.length, 3);
  scripts.forEach(m => new Function(m[1]));
  assert.match(html, /<details class="focus-records" id="focus-records">/);
  assert.match(html, /不进入主对话或通用情境/);
  assert.match(html, /记录本机加密；选伙伴时同步目标、时长与约定/);
  const { nodes } = harness();
  const preparation = nodes.get('focus-timer-card').innerHTML;
  assert.equal(nodes.get('focus-long-every-count').textContent, '每隔 4 轮');
  assert.ok(preparation.indexOf('做什么') < preparation.indexOf('谁陪你'));
  assert.ok(preparation.indexOf('谁陪你') < preparation.indexOf('多久'));
  assert.doesNotMatch(preparation, /自己填写|已有待办|focus-todo-field|focus-task-list|focus-companion-picker|刷新伙伴|focus-step-title|<small>0[123]<\/small>/);
  assert.match(preparation, /开始前，安排一下/);
  assert.match(preparation, /这次想做什么？/);
  assert.match(preparation, /每轮专注多久？/);
  assert.match(preparation, /谁陪你专注？/);
  assert.match(preparation, /（可选）/);
  assert.doesNotMatch(preparation, /focus-companion-search/);
  assert.match(preparation, /oninput="editFocusTitle\(this.value\)"/);
  assert.equal((preparation.match(/id="focus-free-title"/g) || []).length, 1);
  assert.doesNotMatch(preparation, /<span>自由专注<\/span>/);
});

test('专注UI：轮询保留直接输入节点、焦点、光标与伙伴列表', async () => {
  const { context: c, nodes, document } = harness();
  const input = nodes.get('focus-free-title'), list = nodes.get('focus-companion-list');
  input.value = '正在写的目标'; input.selectionStart = 2; input.selectionEnd = 5; input.focus();
  c.editFocusTitle(input.value);
  const writes = list.writes;
  await c.loadFocus();
  assert.equal(nodes.get('focus-free-title'), input);
  assert.equal(nodes.get('focus-companion-list'), list);
  assert.equal(list.writes, writes);
  assert.equal(document.activeElement, input);
  assert.equal(input.value, '正在写的目标');
  assert.equal(input.selectionStart, 2); assert.equal(input.selectionEnd, 5);
});

test('专注UI：少人全部展示，选择收为名片，更换才展开且轮询不收起', async () => {
  const { context: c, nodes } = harness();
  const input = nodes.get('focus-free-title');
  assert.match(nodes.get('focus-companion-list').innerHTML, /写作伙伴/);
  assert.match(nodes.get('focus-companion-list').innerHTML, /陪读伙伴/);
  assert.equal(nodes.get('focus-companion-retry').classes.has('hidden'), true);
  c.chooseFocusCompanion('reader');
  assert.equal(nodes.get('focus-companion-list').classes.has('hidden'), true);
  assert.match(nodes.get('focus-companion-selected').innerHTML, /陪读伙伴.*陪你专注这段时间/);
  c.changeFocusCompanion();
  assert.equal(nodes.get('focus-companion-list').classes.has('hidden'), false);
  assert.match(nodes.get('focus-companion-list').innerHTML, /aria-pressed="true".*✓/);
  await c.loadFocus();
  assert.equal(nodes.get('focus-companion-list').classes.has('hidden'), false);
  c.focusSnapshot.companionOptions.partners = [{ id: 'other', name: '新伙伴' }]; c.renderFocusPage();
  assert.equal(nodes.get('focus-free-title'), input);
  assert.equal(c.focusSelectedCompanionId, 'reader');
  assert.match(c.focusPreparationHint(), /已不在名单/);
});

test('专注UI：通用人数0/1/5/10/11/31，超过10才展开并内部滚动', async () => {
  for (const count of [0, 1, 5, 10, 11, 31]) {
    const { context: c, nodes } = harness();
    c.focusSnapshot.companionOptions = { status: count ? 'available' : 'empty', partners: Array.from({ length: count }, (_, i) => ({ id: 'p' + i, name: '伙伴' + i })) };
    c.renderFocusPage();
    const list = nodes.get('focus-companion-list');
    assert.equal((list.innerHTML.match(/<button/g) || []).length, Math.min(count, 10));
    assert.equal(nodes.get('focus-companion-all').classes.has('hidden'), count <= 10);
    if (count <= 10) continue;
    assert.equal(nodes.get('focus-companion-all').textContent, '查看全部伙伴（共' + count + '位）');
    c.expandFocusCompanions();
    assert.equal((list.innerHTML.match(/<button/g) || []).length, count);
    assert.equal(list.classes.has('expanded'), true);
    await c.loadFocus();
    assert.equal(nodes.get('focus-companion-list').classes.has('hidden'), false);
    c.chooseFocusCompanion('p10');
    assert.equal(list.classes.has('hidden'), true);
    c.changeFocusCompanion();
    assert.equal((list.innerHTML.match(/<button/g) || []).length, count);
    assert.match(list.innerHTML, /aria-pressed="true".*伙伴10.*✓/);
  }
});

test('专注UI：30人选末位后更换直接显示完整名单与勾，轮询保持展开', async () => {
  const { context: c, nodes } = harness();
  c.focusSnapshot.companionOptions = { status: 'available', partners: Array.from({ length: 30 }, (_, i) => ({ id: 'demo-' + i, name: '伙伴' + (i + 1) })) };
  c.renderFocusPage(); c.expandFocusCompanions();
  c.chooseFocusCompanion('demo-29'); c.changeFocusCompanion();
  const list = nodes.get('focus-companion-list');
  assert.equal((list.innerHTML.match(/<button/g) || []).length, 30);
  assert.equal((list.innerHTML.match(/aria-pressed="true"/g) || []).length, 1);
  assert.match(list.innerHTML, /aria-pressed="true"[^]*伙伴30[^]*✓/);
  await c.loadFocus();
  assert.equal(list.classes.has('hidden'), false);
  assert.equal(list.classes.has('expanded'), true);
  assert.equal((list.innerHTML.match(/aria-pressed="true"/g) || []).length, 1);
});

test('专注UI：四态及available旧契约，空选中均可独立开始且不显示假头像', async () => {
  for (const status of ['available', 'empty', 'absent', 'unavailable']) {
    const { context: c, nodes, calls } = harness();
    c.focusSnapshot.companionOptions = { status, available: false, partners: [{ id: 'reader', name: '陪读伙伴' }] };
    c.editFocusTitle('自己读书');
    assert.equal(nodes.get('focus-companions').classes.has('hidden'), status === 'absent');
    assert.equal(nodes.get('focus-prepare-grid').classes.has('without-companions'), status === 'absent');
    if (status === 'available') assert.match(nodes.get('focus-companion-list').innerHTML, /陪读伙伴/);
    if (status === 'empty') assert.match(nodes.get('focus-companion-error').textContent, /暂无可选伙伴/);
    if (status === 'unavailable') assert.match(nodes.get('focus-companion-error').textContent, /暂不可用/);
    assert.doesNotMatch(nodes.get('focus-companion-solo').innerHTML, /img|focus-avatar/);
    c.startFocusTimer();
    assert.equal(JSON.parse(calls.at(-1)[1].body).companionId, '');
    await new Promise(r => setImmediate(r));
  }
  const { context: c, nodes } = harness();
  assert.equal(c.focusCompanionStatus(), 'available');
  c.chooseFocusCompanion('reader'); c.chooseFocusCompanion('');
  assert.equal(c.focusSelectedCompanionId, '');
  assert.equal(nodes.get('focus-companion-selected').innerHTML, '');
});

test('专注UI：头像经既有凭据请求同源接口，空头像/网络失败/解码失败保留首字', async () => {
  const { context: c, nodes } = harness();
  assert.match(c.focusAvatarHtml({ id: 'a', name: '测试伙伴', avatar: '' }), /<span>测<\/span>/);
  assert.doesNotMatch(c.focusAvatarHtml({ id: 'a', name: '测试伙伴', avatar: '' }), /<img/);
  assert.match(c.focusAvatarHtml({ id: 'a', name: '<名字>', avatar: 'api/focus/avatar/a' }), /img hidden.*alt=""/);
  const images = [{ dataset: { focusAvatar: 'id /雪' }, hidden: true, removeAttribute(key) { delete this[key]; } }, { dataset: { focusAvatar: 'failed' }, hidden: true }];
  nodes.get('focus-companions').querySelectorAll = () => images;
  const urls = [];
  c.apiFetch = async url => { urls.push(url); return url.endsWith('failed') ? { ok: false } : { ok: true, blob: async () => new Blob(['avatar']) }; };
  c.focusLoadAvatars();
  await new Promise(r => setImmediate(r));
  assert.deepEqual(urls, ['api/focus/avatar/id%20%2F%E9%9B%AA', 'api/focus/avatar/failed']);
  assert.match(images[0].src, /^blob:/);
  assert.equal(images[0].hidden, true); images[0].onload(); assert.equal(images[0].hidden, false);
  images[0].onerror(); assert.equal(images[0].hidden, true); assert.equal(images[0].src, undefined);
  assert.equal(images[1].src, undefined); assert.equal(images[1].hidden, true);
  c.focusLoadAvatars(); assert.equal(urls.length, 2);
  assert.match(script, /function apiFetch[\s\S]*X-Hana-App-Surface-Session[\s\S]*fetch\(BASE/);
  assert.doesNotMatch(focusCode, /api\/plugins|chahuahui.*avatar/);
});

test('专注UI：非空伙伴失效不降级，不轮询清id；主动自己专注后可开始', async () => {
  const { context: c, calls, nodes } = harness();
  c.editFocusTitle('读书'); c.chooseFocusCompanion('reader');
  c.focusSnapshot.companionOptions = { status: 'unavailable', partners: [] };
  await c.loadFocus(); c.startFocusTimer();
  assert.equal(calls.filter(([url]) => url === 'api/focus/start').length, 0);
  assert.equal(c.focusSelectedCompanionId, 'reader');
  assert.match(nodes.get('focus-companion-selected').innerHTML, /陪读伙伴/);
  c.focusSnapshot.companionOptions.status = 'absent'; c.renderFocusPage();
  assert.equal(nodes.get('focus-companions').classes.has('hidden'), true);
  assert.equal(nodes.get('focus-absent-solo').classes.has('hidden'), false);
  c.chooseFocusCompanion(''); c.startFocusTimer();
  assert.equal(JSON.parse(calls.at(-1)[1].body).companionId, '');
  await new Promise(r => setImmediate(r));
});

test('专注UI：独自start/end/休息忽略旧reminderStatus，陪伴提醒仍保留', async () => {
  const { context: c, nodes } = harness();
  const stale = { sessionId: 'solo', failed: true, start: 'waiting', end: 'pending' };
  c.focusSnapshot.companionOptions.reminderStatus = stale;
  c.editFocusTitle('独自读书');
  c.api = async () => ({ ok: true, ...c.focusSnapshot, active: { id: 'solo', companionId: '', phase: 'focus', targetAt: new Date(Date.now() + 60000).toISOString() } });
  c.startFocusTimer(); await new Promise(r => setImmediate(r));
  assert.equal(nodes.get('focus-live-companion').textContent, '');
  c.focusSnapshot.active.phase = 'break'; c.renderFocusPage();
  assert.equal(nodes.get('focus-live-companion').textContent, '');
  c.api = async () => ({ ok: true, ...c.focusSnapshot, active: null, ended: { session: { id: 'solo', companionId: '' } } });
  c.focusRequest('end'); await new Promise(r => setImmediate(r));
  assert.equal(nodes.get('focus-last-reminder').textContent, '');
  c.chooseFocusCompanion('reader');
  c.api = async () => ({ ok: true, ...c.focusSnapshot, active: { id: 'solo', companionId: 'reader', phase: 'focus', targetAt: new Date(Date.now() + 60000).toISOString() } });
  c.startFocusTimer(); await new Promise(r => setImmediate(r));
  assert.match(nodes.get('focus-live-companion').textContent, /没能送达/);
});

test('专注UI：陪读状态说清“已发送/未确认”，不暗示等待回复且轮询不重建控件', () => {
  const { context: c, nodes } = harness();
  const active = { id: 'focus-1', taskTitle: '写一页手帐', companionId: 'reader', companionName: '小花', phase: 'focus', plannedMinutes: 25, targetAt: new Date(Date.now() + 60_000).toISOString() };
  const reminderStatus = { sessionId: active.id, start: 'sent', end: 'waiting', failed: false };
  c.focusSnapshot.active = active;
  c.focusSnapshot.companionOptions.reminderStatus = reminderStatus;
  c.renderFocusPage();
  const card = nodes.get('focus-timer-card'), clock = nodes.get('focus-clock'), pause = nodes.get('focus-pause-button');
  const writes = card.writes, notice = nodes.get('focus-live-companion');
  assert.match(card.innerHTML, /class="focus-feedback focus-live-companion"[^>]*id="focus-live-companion"/);
  assert.equal(notice.textContent, '已把这次专注安排告诉小花。');
  assert.equal(notice.attrs['data-state'], 'sent');
  reminderStatus.start = 'waiting'; c.renderFocusPage();
  assert.match(notice.textContent, /开始提醒是否已送达茶话会，暂未确认/);
  assert.doesNotMatch(notice.textContent, /已把|已同步|等待伙伴|等.*回复/);
  assert.equal(notice.attrs['data-state'], 'unconfirmed');
  reminderStatus.start = 'pending'; c.renderFocusPage();
  assert.match(notice.textContent, /送达茶话会，暂未确认/);
  reminderStatus.start = 'stale'; c.renderFocusPage();
  assert.match(notice.textContent, /状态已过期/);
  assert.equal(notice.attrs['data-state'], 'warning');
  reminderStatus.start = 'failed'; reminderStatus.failed = false; c.renderFocusPage();
  assert.match(notice.textContent, /开始提醒未能送达/);
  assert.equal(notice.attrs['data-state'], 'warning');
  delete reminderStatus.start; c.renderFocusPage();
  assert.match(notice.textContent, /本次陪读伙伴：小花。.*状态尚未确认/);
  assert.equal(notice.attrs['data-state'], 'unknown');
  reminderStatus.sessionId = 'other'; reminderStatus.start = 'sent'; c.renderFocusPage();
  assert.doesNotMatch(notice.textContent, /已把这次专注安排告诉/);
  assert.equal(notice.attrs['data-state'], 'unknown');
  assert.equal(nodes.get('focus-timer-card').writes, writes);
  assert.equal(nodes.get('focus-clock'), clock);
  assert.equal(nodes.get('focus-pause-button'), pause);
  c.focusSnapshot.active.phase = 'break'; reminderStatus.sessionId = 'focus-1'; reminderStatus.end = 'failed'; reminderStatus.failed = false; c.renderFocusPage();
  assert.match(nodes.get('focus-live-companion').textContent, /收尾提醒未能送达/);
});

test('专注UI：日历待办预填，非当天关联不因目录缺项丢失，手改解除关联', async () => {
  const { context: c, nodes, calls } = harness();
  const input = nodes.get('focus-free-title');
  c.startFocusForTodo('todo-1');
  assert.equal(input.value, '读一章书');
  assert.equal(c.focusSelectedTaskId, 'todo-1');
  c.startFocusForTodo('other-day', '其他日期待办');
  await c.loadFocus();
  assert.equal(c.focusSelectedTaskId, 'other-day');
  assert.equal(input.value, '其他日期待办');
  c.chooseFocusCompanion('reader'); c.startFocusTimer();
  assert.equal(JSON.parse(calls.at(-1)[1].body).taskId, 'other-day');
  await new Promise(r => setImmediate(r));
  c.editFocusTitle('我手改的目标');
  assert.equal(c.focusSelectedTaskId, '');
  c.startFocusTimer();
  assert.equal(JSON.parse(calls.at(-1)[1].body).taskId, '');
  assert.equal(JSON.parse(calls.at(-1)[1].body).taskTitle, '我手改的目标');
  assert.equal(nodes.get('focus-free-title'), input);
});

test('专注UI：缺项按钮可点击，拒绝空目标/失效所选伙伴/所选服务离线', () => {
  const { context: c, nodes, calls, notices } = harness();
  assert.equal(nodes.get('focus-start-button').disabled, false);
  c.startFocusTimer(); assert.equal(calls.length, 0); assert.match(notices.at(-1), /写下/);
  c.focusSelectedCompanionId = 'reader'; c.startFocusTimer(); assert.match(notices.at(-1), /写下/);
  c.focusFreeTitle = '读书'; c.focusSelectedCompanionId = 'gone'; c.startFocusTimer(); assert.equal(calls.length, 0);
  c.focusSelectedCompanionId = 'reader'; c.focusSnapshot.companionOptions.available = false;
  c.focusSnapshot.companionOptions.error = '茶话会暂未接通'; c.startFocusTimer();
  assert.match(notices.at(-1), /所选伙伴暂不可用/); assert.equal(calls.length, 0);
  assert.equal(c.focusSelectedCompanionId, 'reader');
});

test('专注UI：开始即时反馈、重复点击保护及focusRequest原数据契约', async () => {
  const { context: c, nodes, calls } = harness();
  c.focusFreeTitle = '读书'; c.chooseFocusCompanion('reader');
  let resolve;
  c.api = (url, options) => { calls.push([url, options]); return new Promise(r => { resolve = r; }); };
  c.startFocusTimer(); c.startFocusTimer();
  assert.equal(calls.length, 1);
  assert.equal(calls[0][0], 'api/focus/start');
  assert.deepEqual(JSON.parse(calls[0][1].body), { taskId: '', taskTitle: '读书', companionId: 'reader', focusMinutes: 25, breakMinutes: 5, shortBreakMinutes: 5, totalRounds: 4, longBreakEvery: 4, longBreakMinutes: 15,
    focusConfig: { focusMinutes: 25, totalRounds: 4, shortBreakMinutes: 5, longBreakEnabled: true, longBreakEvery: 4, longBreakMinutes: 15 }, favoriteGoalTitle: '' });
  assert.equal(nodes.get('focus-start-button').disabled, true);
  assert.match(nodes.get('focus-start-button').textContent, /正在开始/);
  assert.match(nodes.get('focus-status-notice').textContent, /正在开始/);
  resolve({ ok: true, ...c.focusSnapshot });
  await new Promise(r => setImmediate(r));
  assert.equal(c.focusActionPending, false); assert.equal(nodes.get('focus-start-button').disabled, false);
});

test('专注UI：轮数与短长休均可自选，pending时设置不改写', () => {
  const { context: c } = harness();
  for (const v of [15, 25, 30, 45]) { c.setFocusMinutes(v); assert.equal(c.focusMinutes, v); }
  c.setFocusMinutes(20); assert.equal(c.focusMinutes, 45);
  c.setFocusRounds(8); assert.equal(c.focusTotalRounds, 8);
  c.setBreakMinutes(12); assert.equal(c.breakMinutes, 12);
  c.setFocusLongBreakEvery(3); assert.equal(c.focusLongBreakEvery, 3);
  c.setFocusLongBreakMinutes(25); assert.equal(c.focusLongBreakMinutes, 25);
  c.toggleFocusLongBreak(); assert.equal(c.focusLongBreakEnabled, false);
  c.focusActionPending = true; c.setFocusMinutes(15); c.setBreakMinutes(5); c.setFocusRounds(2); c.startFocusForTodo('todo-1', '待办'); c.editFocusTitle('不应改写'); c.chooseFocusCompanion('reader');
  assert.equal(c.focusMinutes, 45); assert.equal(c.breakMinutes, 12); assert.equal(c.focusTotalRounds, 8); assert.equal(c.focusSelectedTaskId, ''); assert.equal(c.focusSelectedCompanionId, '');
});

test('专注UI：首次加载恢复上次配置，后续轮询不覆盖配置草稿', async () => {
  const { context: c } = harness();
  const saved = { focusMinutes: 45, totalRounds: 6, shortBreakMinutes: 8, longBreakEnabled: false, longBreakEvery: 3, longBreakMinutes: 22 };
  c.focusSnapshot.focusConfig = saved;
  await c.loadFocus();
  assert.equal(c.focusMinutes, 45); assert.equal(c.focusTotalRounds, 6); assert.equal(c.breakMinutes, 8);
  assert.equal(c.focusLongBreakEnabled, false); assert.equal(c.focusLongBreakEvery, 3); assert.equal(c.focusLongBreakMinutes, 22);
  c.setFocusRounds(7);
  await c.loadFocus();
  assert.equal(c.focusTotalRounds, 7);
});

test('专注UI：选常用目标恢复专属配置，编辑时保存到当前标签，手改目标解除绑定', async () => {
  const { context: c, calls } = harness();
  const profile = { focusMinutes: 30, totalRounds: 3, shortBreakMinutes: 6, longBreakEnabled: true, longBreakEvery: 2, longBreakMinutes: 18 };
  c.focusSnapshot.favoriteGoals = ['读书'];
  c.focusSnapshot.favoriteGoalConfigs = { 'goal:读书': profile };
  c.api = async (url, options) => {
    calls.push([url, options]);
    if (url === 'api/focus/favorites/select') return { ok: true, focusConfig: profile, favoriteGoalConfigs: { 'goal:读书': profile } };
    return { ok: true, focusConfig: JSON.parse(options.body).focusConfig, favoriteGoalConfigs: c.focusSnapshot.favoriteGoalConfigs };
  };
  await c.chooseFocusFavorite('读书');
  assert.equal(c.focusMinutes, 30); assert.equal(c.focusTotalRounds, 3); assert.equal(c.focusSelectedFavoriteTitle, '读书');
  c.setFocusRounds(4);
  await c.focusConfigSaveQueue;
  const saved = calls.findLast(([url]) => url === 'api/focus/settings');
  assert.equal(JSON.parse(saved[1].body).favoriteGoalTitle, '读书');
  assert.equal(JSON.parse(saved[1].body).focusConfig.totalRounds, 4);
  c.editFocusTitle('其他目标');
  c.setFocusRounds(5);
  await c.focusConfigSaveQueue;
  const detached = calls.findLast(([url]) => url === 'api/focus/settings');
  assert.equal(JSON.parse(detached[1].body).favoriteGoalTitle, '');
});

test('专注UI：常用目标按钮保存配置、去重状态与移除请求闭环', async () => {
  const { context: c, nodes, calls, notices } = harness();
  c.focusFreeTitle = '写一段日记'; c.renderFocusPage();
  c.api = async (url, options) => {
    calls.push([url, options]);
    return { ok: true, favoriteGoals: url.endsWith('/add') ? ['写一段日记'] : [], favoriteGoalConfigs: {} };
  };
  c.saveFocusFavorite();
  assert.equal(calls.at(-1)[0], 'api/focus/favorites/add');
  assert.deepEqual(JSON.parse(calls.at(-1)[1].body), { title: '写一段日记', focusConfig: { focusMinutes: 25, totalRounds: 4, shortBreakMinutes: 5, longBreakEnabled: true, longBreakEvery: 4, longBreakMinutes: 15 } });
  assert.equal(nodes.get('focus-save-favorite').disabled, true);
  await new Promise(r => setImmediate(r));
  assert.match(nodes.get('focus-favorites').innerHTML, /写一段日记/);
  assert.equal(nodes.get('focus-save-favorite').textContent, '已存常用');
  assert.ok(notices.includes('已存进常用目标'));
  c.removeFocusFavorite('写一段日记');
  assert.equal(calls.at(-1)[0], 'api/focus/favorites/remove');
  assert.deepEqual(JSON.parse(calls.at(-1)[1].body), { title: '写一段日记' });
  await new Promise(r => setImmediate(r));
  assert.equal(nodes.get('focus-favorites').innerHTML, '');
  assert.ok(notices.includes('已从常用目标移除'));
});

test('专注UI：进行与暂停控件稳定，常规轮询只更新倒计时不重建卡片', () => {
  const { context: c, nodes } = harness();
  c.focusSnapshot.active = { id: 'one', phase: 'focus', taskTitle: '很长的目标'.repeat(20), companionName: '很长的伙伴'.repeat(20), plannedMinutes: 25, roundIndex: 2, totalRounds: 4, targetAt: new Date(Date.now() + 60000).toISOString() };
  c.renderFocusPage();
  const card = nodes.get('focus-timer-card'), count = card.writes, pause = nodes.get('focus-pause-button');
  assert.match(card.innerHTML, /提前结束本组/);
  assert.match(card.innerHTML, /focus-pause-button[\s\S]*focus-end-button/);
  assert.doesNotMatch(card.innerHTML, /focus-secondary-actions|focus-cancel-button|取消，不留记录/);
  assert.equal(nodes.get('focus-cancel-button'), undefined);
  c.renderFocusPage(); assert.equal(card.writes, count); assert.equal(nodes.get('focus-pause-button'), pause);
  c.focusSnapshot.active.pausedAt = new Date().toISOString(); c.focusSnapshot.active.remainingMs = 42000; c.renderFocusPage();
  assert.equal(card.writes, count);
  assert.equal(nodes.get('focus-pause-button'), pause);
  assert.equal(pause.textContent, '继续专注');
  assert.equal(pause.attrs.onclick, 'focusRequest("resume")');
  assert.equal(nodes.get('focus-clock').textContent, '00:42');
});

test('专注UI：休息与准备均保留收尾pending/失败，空统计不展示柱图', () => {
  const { context: c, nodes } = harness();
  c.focusSnapshot.active = { id: 'one', phase: 'break', taskTitle: '读书', companionId: 'reader', companionName: '陪读伙伴', roundIndex: 1, totalRounds: 2, breakKind: 'short', breakMinutes: 5, targetAt: new Date(Date.now() + 60000).toISOString() };
  c.focusSnapshot.companionOptions.reminderStatus = { sessionId: 'one', end: 'pending' }; c.renderFocusPage();
  assert.match(nodes.get('focus-live-companion').textContent, /收尾提醒是否已送达茶话会，暂未确认/);
  assert.match(nodes.get('focus-timer-card').innerHTML, /结束本组并保留记录/);
  c.focusSnapshot.companionOptions.reminderStatus.failed = true; c.renderFocusPage();
  assert.match(nodes.get('focus-live-companion').textContent, /没能送达/);
  c.focusSnapshot.active = null; c.renderFocusPage(); assert.match(nodes.get('focus-last-reminder').textContent, /不会自动重试/);
  assert.equal(nodes.get('focus-week-bars').classes.has('hidden'), true);
});

test('专注UI：15秒轮询与到点advance沿用原节奏和静默请求契约', async () => {
  const { context: c, calls } = harness();
  c.focusSnapshot.active = { id: 'one', phase: 'focus', targetAt: new Date(Date.now() + 60000).toISOString() };
  c.focusLastRefreshAt = Date.now() - 16000; c.focusTick();
  await new Promise(r => setImmediate(r));
  assert.equal(calls[0][0], 'api/focus');
  const afterPoll = calls.length; c.focusTick(); assert.equal(calls.length, afterPoll);
  c.focusSnapshot.active.targetAt = new Date(Date.now() - 1000).toISOString();
  let request;
  c.focusRequest = (...args) => { request = args; }; c.focusTick();
  assert.deepEqual(request, ['advance', null, true]); assert.equal(c.focusAdvancePending, true);
});

test('专注UI：请求失败即时可见，按钮恢复且目标节点不丢', async () => {
  const { context: c, nodes, notices } = harness();
  const input = nodes.get('focus-free-title');
  c.focusFreeTitle = '读书'; c.chooseFocusCompanion('reader');
  c.api = async url => url === 'api/focus/start' ? { ok: false, error: '无法开始，请检查茶话会连接' } : { ok: false, error: '无法开始，请检查茶话会连接' };
  c.startFocusTimer(); await new Promise(r => setImmediate(r));
  assert.equal(c.focusActionPending, false); assert.equal(nodes.get('focus-start-button').disabled, false);
  assert.equal(nodes.get('focus-free-title'), input);
  assert.match(notices.at(-1), /检查茶话会连接/);
  assert.match(nodes.get('focus-status-notice').textContent, /检查茶话会连接/);
});

test('专注UI：加载失败保留进行操作，空目录提供配置提示和重试', async () => {
  const { context: c, nodes } = harness();
  c.focusSelectedCompanionId = 'reader'; c.editFocusTitle('已有草稿');
  c.focusSnapshot.companionOptions.partners = []; c.focusUpdatePreparation(); assert.match(c.focusPreparationHint(), /所选伙伴暂不可用/);
  assert.match(nodes.get('focus-companion-error').textContent, /暂无可选伙伴.*自己开始/);
  assert.equal(nodes.get('focus-companion-retry').classes.has('hidden'), false);
  c.focusSnapshot.active = { id: 'one', phase: 'focus', taskTitle: '读书', targetAt: new Date(Date.now() + 60000).toISOString() };
  c.renderFocusPage(); const pause = nodes.get('focus-pause-button');
  c.api = async () => { throw new Error('offline'); }; c.loadFocus();
  await new Promise(r => setImmediate(r));
  assert.equal(nodes.get('focus-pause-button'), pause);
  assert.match(nodes.get('focus-live-status').textContent, /检查一下连接/);
});

test('专注UI：获取失败显示重试，重试即时反馈防连点，恢复后撤下按钮', async () => {
  const { context: c, nodes, calls } = harness();
  const input = nodes.get('focus-free-title');
  c.editFocusTitle('保留草稿');
  c.api = async () => { throw new Error('offline'); };
  await c.loadFocus();
  const retry = nodes.get('focus-companion-retry');
  assert.equal(retry.classes.has('hidden'), false);
  assert.match(nodes.get('focus-companion-error').textContent, /重试/);
  let resolve;
  c.api = (url, options) => { calls.push([url, options]); return new Promise(r => { resolve = r; }); };
  c.retryFocusCompanions(); c.retryFocusCompanions();
  assert.equal(calls.length, 1);
  assert.equal(retry.disabled, true);
  assert.match(retry.textContent, /正在获取/);
  resolve({ ok: true, ...c.focusSnapshot });
  await new Promise(r => setImmediate(r));
  assert.equal(retry.disabled, false);
  assert.equal(retry.classes.has('hidden'), true);
  assert.equal(nodes.get('focus-companion-error').textContent, '');
  assert.equal(nodes.get('focus-free-title'), input);
  assert.equal(input.value, '保留草稿');
});

test('专注UI：目录为空重试后仍清楚提示，失败不隐藏入口', async () => {
  const { context: c, nodes } = harness();
  c.focusSnapshot.companionOptions.partners = [];
  c.renderFocusPage();
  c.retryFocusCompanions();
  await new Promise(r => setImmediate(r));
  assert.equal(nodes.get('focus-companion-retry').classes.has('hidden'), false);
  assert.equal(nodes.get('focus-companion-retry').disabled, false);
  assert.match(nodes.get('focus-companion-error').textContent, /暂无可选伙伴.*自己开始/);
  c.api = async () => ({ ok: false, error: '目录读取失败' });
  c.retryFocusCompanions();
  await new Promise(r => setImmediate(r));
  assert.match(nodes.get('focus-companion-error').textContent, /目录读取失败.*重试/);
  assert.equal(nodes.get('focus-companion-retry').disabled, false);
});

test('专注UI：收尾pending触发15秒轮询，响应到达不回滚正在输入的目标', async () => {
  const { context: c, nodes, document, calls } = harness();
  c.focusSnapshot.companionOptions.reminderStatus = { end: 'pending' };
  c.focusLastRefreshAt = Date.now() - 16000;
  let resolve;
  c.api = (url, options) => { calls.push([url, options]); return new Promise(r => { resolve = r; }); };
  c.focusTick();
  assert.equal(calls[0][0], 'api/focus');
  const input = nodes.get('focus-free-title');
  input.value = '轮询期间继续输入'; input.focus();
  c.editFocusTitle(input.value);
  input.selectionStart = 3; input.selectionEnd = 6;
  resolve({ ok: true, ...c.focusSnapshot });
  await new Promise(r => setImmediate(r));
  assert.equal(nodes.get('focus-free-title'), input);
  assert.equal(document.activeElement, input);
  assert.equal(input.value, '轮询期间继续输入');
  assert.equal(input.selectionStart, 3); assert.equal(input.selectionEnd, 6);
  assert.match(nodes.get('focus-last-reminder').textContent, /暂未确认送达/);
});

test('专注UI：日历入口传已知标题，关联任务的后端契约不删改', () => {
  assert.match(script, /startFocusForTodo\(' \+ jsArg\(e.id\) \+ ',' \+ jsArg\(e.title\)/);
  const { context: c, nodes } = harness();
  c.startFocusForTodo('other-day', '写作「引号」与长标题');
  assert.equal(c.focusSelectedTaskId, 'other-day');
  assert.equal(nodes.get('focus-free-title').value, '写作「引号」与长标题');
  assert.equal(c.focusFreeTitle, '写作「引号」与长标题');
  c.editFocusTitle('');
  assert.equal(c.focusSelectedTaskId, '');
  c.focusSelectedCompanionId = 'reader';
  assert.match(c.focusPreparationHint(), /写下/);
});

test('专注UI：样式约束覆盖小窗口、焦点、固定操作和长内容', () => {
  assert.match(html, /\.focus-favorite-chip \{[^}]*border-radius: 8px/);
  assert.match(html, /#panel-focus \.focus-settlement \.archive-actions button \{[^}]*border-radius: 8px/);
  assert.match(html, /\.focus-prepare-grid \{[^}]*grid-template-areas: 'goal companion' 'duration companion'/);
  assert.match(html, /grid-template-areas: 'goal' 'companion' 'duration'/);
  assert.match(html, /\.focus-layout \{[^}]*max-width: 980px/);
  assert.match(html, /#panel-focus \.focus-companion-grid \{[^}]*display: grid; grid-template-columns: repeat\(2, minmax\(0, 1fr\)\)/);
  assert.match(html, /@container \(max-width: 300px\) \{ #panel-focus \.focus-companion-grid \{ grid-template-columns: minmax\(0, 1fr\)/);
  assert.match(html, /@container \(max-width: 300px\)/);
  assert.match(html, /\.focus-companion-grid\.expanded \{[^}]*max-height: 280px; overflow-y: auto/);
  assert.doesNotMatch(html, /--focus-ink|--focus-muted|focus-step-title|focus-mode-row|focus-picker-body/);
  assert.doesNotMatch(html, /\.focus-companion-grid \{[^}]*max-height/);
  assert.doesNotMatch(html, /#panel-focus \.btn\.primary \{/);
  assert.match(html, /#panel-focus input:focus-visible/);
  assert.match(html, /\.focus-actions \{[^}]*flex-wrap: nowrap/);
  assert.doesNotMatch(html, /\.focus-live \.focus-(?:task|companion)-name \{[^}]*(?:max-height|overflow: auto)/);
  assert.match(html, /#panel-focus \.focus-companion-grid span \{[^}]*white-space: normal; overflow-wrap: anywhere/);
  assert.doesNotMatch(html, /\.focus-submit \{[^}]*sticky|\.focus-live \.focus-actions \{[^}]*sticky|\.focus-primary-action \{[^}]*width: 100%/);
  assert.match(html, /\.focus-live \.focus-clock \{[^}]*font-size: 56px/);
  assert.match(html, /@media \(max-width: 380px\)/);
  assert.match(html, /@container \(max-width: 460px\) \{ #panel-focus \.focus-plan-grid \{ grid-template-columns: minmax\(0, 1fr\); \} \}/);
  assert.doesNotMatch(html, /focus-actions-with-cancel|focus-cancel-action|focus-secondary-actions/);
  assert.match(html, /@media \(prefers-reduced-motion: reduce\)/);
});

test('专注UI：模板稳定生成，准备复用内容输入及伙伴选择契约（产物由主会话构建）', () => {
  assert.equal(renderPage(''), html);
  const { context: c, nodes } = harness();
  const preparation = nodes.get('focus-timer-card').innerHTML;
  assert.match(preparation, /focus-goal add-form/);
  assert.doesNotMatch(preparation, /set-input|focus-primary-action/);
  assert.match(preparation, /class="add-head"/);
  assert.match(preparation, /class="add-actions focus-submit"/);
  c.chooseFocusCompanion('reader');
  assert.match(nodes.get('focus-companion-list').innerHTML, /mood-cell focus-task-option picked active/);
  assert.match(preparation, /class="mood-grid focus-companion-grid"/);
});

test('专注UI：等待、暂停、继续和正文变化不重建计时节点', () => {
  const { context: c, nodes, document } = harness();
  c.focusSnapshot.active = { id: 'stable', phase: 'focus', taskTitle: '读书', plannedMinutes: 25, targetAt: new Date(Date.now() + 60000).toISOString() };
  c.renderFocusPage();
  const card = nodes.get('focus-timer-card'), count = card.writes;
  const pause = nodes.get('focus-pause-button'), clock = nodes.get('focus-clock'), end = nodes.get('focus-end-button');
  pause.focus();
  c.focusActionPending = true; c.renderFocusPage();
  assert.equal(pause.disabled, true); assert.equal(end.disabled, true);
  c.focusSnapshot.active.pausedAt = new Date().toISOString(); c.focusSnapshot.active.remainingMs = 30000;
  c.focusActionPending = false; c.renderFocusPage();
  c.focusSnapshot.active.taskTitle = '手动返回的长标题'.repeat(25);
  c.focusSnapshot.active.companionName = '长伙伴名字'.repeat(25); c.renderFocusPage();
  assert.equal(card.writes, count); assert.equal(nodes.get('focus-clock'), clock);
  assert.equal(nodes.get('focus-pause-button'), pause); assert.equal(nodes.get('focus-end-button'), end);
  assert.equal(document.activeElement, pause); assert.equal(pause.textContent, '继续专注');
  assert.equal(nodes.get('focus-live-task').textContent, c.focusSnapshot.active.taskTitle);
  assert.equal(nodes.get('focus-live-name').textContent, '陪伴：' + c.focusSnapshot.active.companionName);
  delete c.focusSnapshot.active.pausedAt; c.renderFocusPage();
  assert.equal(card.writes, count); assert.equal(pause.textContent, '暂停');
  assert.equal(pause.attrs.onclick, 'focusRequest("pause")');
});

test('专注UI：休息只展示同id真实结算，跨日期记录和心情动作沿用日历契约', () => {
  const { context: c, nodes } = harness();
  c.focusSnapshot.active = { id: 'done', phase: 'break', taskTitle: '不可拿计划猜实记', breakMinutes: 5, targetAt: new Date(Date.now() + 60000).toISOString() };
  c.focusSnapshot.sessions = [{ id: 'other', taskTitle: '无关的记录', durationMs: 900000 },
    { id: 'done', date: '2026-10-12', taskTitle: '<真实目标>', companionName: '真实伙伴', durationMs: 182000, plannedMinutes: 25, status: 'completed', startedAt: '2026-10-12T23:58:00', endedAt: '2026-10-13T00:01:02' }];
  c.renderFocusPage();
  const settlement = nodes.get('focus-settlement').innerHTML;
  assert.match(settlement, /day-title/); assert.match(settlement, /archive-item/);
  assert.match(settlement, /a-agent.*真实伙伴/); assert.match(settlement, /&lt;真实目标>/);
  assert.match(settlement, /实际专注 3 分钟/); assert.match(settlement, /10\/13 00:01/);
  assert.match(settlement, /看这天/); assert.doesNotMatch(settlement, /记心情|无关的记录|实际专注 25 分钟/);
  assert.match(settlement, /计时记录不代表待办已完成/);
  assert.equal(nodes.get('focus-live-task').textContent, '接下来继续：不可拿计划猜实记');
  c.focusSnapshot.sessions[1].date = c.focusTodayKey(); c.renderFocusPage();
  assert.match(nodes.get('focus-settlement').innerHTML, /focusOpenMood\(\)/);
});

test('专注UI：休息缺少同id结算不猜时长，记录迟到仅局部更新', () => {
  const { context: c, nodes } = harness();
  c.focusSnapshot.active = { id: 'pending', phase: 'break', taskTitle: '旧目标', targetAt: new Date(Date.now() + 60000).toISOString() };
  c.focusSnapshot.sessions = [{ id: 'other', durationMs: 1500000, status: 'completed' }];
  c.renderFocusPage();
  const card = nodes.get('focus-timer-card'), count = card.writes, clock = nodes.get('focus-clock');
  assert.match(nodes.get('focus-settlement').innerHTML, /结算记录暂未返回/);
  assert.doesNotMatch(nodes.get('focus-settlement').innerHTML, /实际专注|25 分钟|已完成|看这天/);
  c.focusSnapshot.sessions.push({ id: 'pending', date: c.focusTodayKey(), taskTitle: '迟到记录', status: 'completed' });
  c.renderFocusPage();
  assert.equal(card.writes, count); assert.equal(nodes.get('focus-clock'), clock);
  assert.match(nodes.get('focus-settlement').innerHTML, /迟到记录.*实际时长暂未返回/s);
  assert.doesNotMatch(nodes.get('focus-settlement').innerHTML, /实际专注 0 分钟/);
});

test('专注UI：中途结束返回准备，自然advance按后端返回进入休息', async () => {
  const { context: c, nodes, calls } = harness();
  const active = { id: 'one', phase: 'focus', taskTitle: '读书', targetAt: new Date(Date.now() + 60000).toISOString() };
  c.focusSnapshot.active = active; c.renderFocusPage();
  c.api = async (url, options) => {
    calls.push([url, options]);
    return { ok: true, ...c.focusSnapshot, active: null, ended: { session: { id: 'one' } } };
  };
  c.focusRequest('end'); await new Promise(r => setImmediate(r));
  assert.equal(calls.at(-1)[0], 'api/focus/end');
  assert.equal(c.focusSnapshot.active, null); assert.equal(nodes.get('focus-timer-card').dataset.mode, 'prepare');
  c.focusSnapshot.active = active; c.renderFocusPage();
  c.api = async (url, options) => {
    calls.push([url, options]);
    return { ok: true, ...c.focusSnapshot, active: { ...active, phase: 'break' } };
  };
  c.focusRequest('advance', null, true); await new Promise(r => setImmediate(r));
  assert.equal(calls.at(-1)[0], 'api/focus/advance');
  assert.equal(c.focusSnapshot.active.phase, 'break');
  assert.match(nodes.get('focus-timer-card').innerHTML, /结束本组并保留记录/);
});

test('专注UI：结束时上一轮已到点但本组中断，不误报整组完成', async () => {
  const { context: c, notices } = harness();
  c.focusSnapshot.active = { id: 'one', setId: 'set', phase: 'focus', roundIndex: 1, totalRounds: 3, targetAt: new Date(Date.now() + 60000).toISOString() };
  c.api = async () => ({ ok: true, active: null, sessions: [], groups: [], favoriteGoals: [], stats: null,
    ended: { phase: 'focus', session: { id: 'one', status: 'completed', planStatus: 'interrupted' } } });
  c.focusRequest('end');
  await new Promise(r => setImmediate(r));
  assert.ok(notices.includes('这一组提前结束，已完成轮次保留'));
  assert.ok(!notices.includes('这一组完成啦，已记下专注时间'));
});

test('专注UI：提前结束整组需确认，明确保留记录；开始提醒状态不暗示等待伙伴回应', () => {
  const { context: c, nodes, calls } = harness();
  let confirmation;
  c.askConfirm = (message, accept) => { confirmation = { message, accept }; };
  c.focusSnapshot.active = { id: 'one', phase: 'focus', companionId: 'reader', targetAt: new Date(Date.now() + 60000).toISOString() };
  c.focusSnapshot.companionOptions.reminderStatus = { sessionId: 'one', start: 'waiting' }; c.renderFocusPage();
  assert.match(nodes.get('focus-live-companion').textContent, /送达茶话会，暂未确认/);
  assert.doesNotMatch(nodes.get('focus-live-companion').textContent, /等待伙伴|等.*回复/);
  c.confirmEndFocusSet(); assert.equal(calls.length, 0);
  assert.match(confirmation.message, /已完成轮次和当前真实专注时长都会保留/);
  confirmation.accept(); assert.equal(calls.at(-1)[0], 'api/focus/end');
  c.focusSnapshot.companionOptions.reminderStatus = null;
  c.focusSnapshot.companionOptions.available = false; c.renderFocusPage();
  assert.match(nodes.get('focus-live-companion').textContent, /暂时联系不上茶话会.*本机继续/);
});
