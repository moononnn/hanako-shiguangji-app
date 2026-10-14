import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";

import { renderPage } from "../lib/page-template.js";

// 真实的 1×1 PNG，不是凑出来的魔数。
const PNG_B64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

test("专注页面：导航、日期记录入口和内联脚本都可解析", () => {
  const html = renderPage("");
  assert.match(html, /id="tab-focus"[^>]*>专注/);
  assert.match(html, /id="panel-focus"/);
  assert.match(html, /startFocusForTodo\(/);
  assert.match(html, /focusSessions/);
  assert.match(html, /focusOpenMood\(/);
  const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/gi)].map((match) => match[1]);
  assert.ok(scripts.length >= 3);
  scripts.forEach((script, index) => {
    if (!script.trim()) return;
    try { new Function(script); }
    catch (error) { throw new Error('第 ' + (index + 1) + ' 个内联脚本解析失败：' + error.stack); }
  });
});

test("专注路由：独立计时全程不找茶话会，选中的伙伴拿不到就失败，头像只代理真图", () => {
  const isolatedHome = fs.mkdtempSync(path.join(os.tmpdir(), "sgj-focus-route-test-"));
  const routeUrl = pathToFileURL(path.resolve("routes/ui.js")).href;
  const dataUrl = pathToFileURL(path.resolve("lib/data.js")).href;
  const sharedUrl = pathToFileURL(path.resolve("lib/shared-data.js")).href;
  const childCode = `
    const PNG_B64 = ${JSON.stringify(PNG_B64)};
    import path from "node:path";
    import registerRoutes from ${JSON.stringify(routeUrl)};
    import { UserData, dateKey } from ${JSON.stringify(dataUrl)};
    import { __setSharedUserDataForTest } from ${JSON.stringify(sharedUrl)};
    import { FocusReminderScheduler, setFocusReminderScheduler } from ${JSON.stringify(pathToFileURL(path.resolve("lib/focus-reminder-scheduler.js")).href)};
    const dataDir = path.join(process.env.HANA_HOME, "app-data", "shiguangji-app");
    const data = new UserData(dataDir);
    __setSharedUserDataForTest(data);
    const routes = [];
    const app = {
      get(path, handler) { routes.push({ method: "GET", path, handler }); },
      post(path, handler) { routes.push({ method: "POST", path, handler }); },
      put(path, handler) { routes.push({ method: "PUT", path, handler }); },
      delete(path, handler) { routes.push({ method: "DELETE", path, handler }); },
    };
    const png = Buffer.from(PNG_B64, 'base64');
    let teaMode = 'ok';
    const busCalls = [];
    const notifications = [];
    const taskSchedules = [];
    let taskHandler;
    let taskSequence = 0;
    const ctx = { dataDir, log: { info() {}, warn() {}, error() {} },
      notifications: { async show(value) { notifications.push(value); return { shown: true }; } },
      bus: { request: async (type, payload) => {
      busCalls.push(type);
      if (type === 'app:tigexing-app/focus/notify') throw Object.assign(new Error('service not found'), { code: 'APP_SERVICE_NOT_FOUND' });
      if (teaMode === 'broken') throw new Error('tea unavailable');
      if (teaMode === 'boom') throw new Error('avatar reader exploded at ' + dataDir);
      if (type.endsWith('/focus/partners')) return { ok: true, partners: [{ id: 'reader', name: '陪读搭子' }] };
      if (type.endsWith('/focus/sync')) return { ok: true };
      if (type.endsWith('/focus/avatar')) {
        if (payload?.agentId !== 'reader') return { ok: true, avatar: null };
        return { ok: true, avatar: { contentType: 'image/png', base64: png.toString('base64') } };
      }
      throw new Error('unknown service');
    } } };
    const taskCtx = { ...ctx, tasks: {
      async registerHandler(key, handler) { taskHandler = handler; },
      async listSchedules() { return taskSchedules.slice(); },
      async schedule(value) { const row = { ...value, scheduleId: 'focus-' + (++taskSequence) }; taskSchedules.push(row); return { schedule: row }; },
      async unschedule(id) { const index = taskSchedules.findIndex(row => row.scheduleId === id); if (index >= 0) taskSchedules.splice(index, 1); },
    } };
    const focusReminder = setFocusReminderScheduler(new FocusReminderScheduler({ ctx: taskCtx, data, log: ctx.log }));
    await focusReminder.registerAppTaskHandler();
    registerRoutes(app, ctx);
    const today = dateKey(new Date());
    const todo = await data.addEvent({ title: "读一页", type: "todo", date: today, reminderStart: "09:00", reminderEnd: "09:00" });
    const call = async (method, path, body, date, id) => {
      const route = routes.find((item) => item.method === method && item.path === path);
      if (!route) throw new Error("缺少路由 " + method + " " + path);
      return route.handler({
        req: {
          json: async () => body || {},
          param(name) { return name === "date" ? date : (name === "id" ? id : ""); },
        },
        json(value, status) { return { __json: value, status: status || 200, headers: {} }; },
        body(value, status, headers) { return { __json: { body: value }, status: status || 200, headers: headers || {} }; },
      });
    };
    const payloadOf = async (result) => (result && result.__json) || result;
    const syncCount = () => busCalls.filter((type) => type.endsWith('/focus/sync')).length;
    // 到点开出来的那一段会直接进休息，开下一段前先把它清干净（只走数据层，不碰 bus）。
    const clearActive = async () => { let guard = 0; while (data.focusStore.read()?.active && guard++ < 5) await data.endFocusSession(); };

    // 独立计时：茶话会整个联系不上，全程不触发陪读同步，也不因此失败。
    teaMode = 'broken';
    const solo = await payloadOf(await call("POST", "/api/focus/start", { taskId: todo.id, focusMinutes: 30, breakMinutes: 5 }));
    if (!solo.ok || solo.active?.companionId !== '' || solo.active?.plannedMinutes !== 30) throw new Error('没有茶话会时不能自己专注');
    if (notifications.length !== 1 || !(notifications[0]?.body || '').includes('第 1/1 轮开始')) throw new Error('首轮开始时没有收到系统提醒');
    const firstStartNoticeCount = notifications.length;
    if (taskSchedules.length !== 1 || taskSchedules[0].payload.focusId !== solo.active.id) throw new Error('开始专注没有创建对应后台计划');
    if (solo.active?.taskTitle !== "读一页") throw new Error("独立专注没有关联到既有待办");
    if (solo.warning) throw new Error('独立专注不该带茶话会同步提示');
    if (syncCount() !== 0) throw new Error('独立专注触发了茶话会陪读同步');
    const soloSnapshot = await payloadOf(await call("GET", "/api/focus"));
    if (soloSnapshot.companionOptions?.status !== 'unavailable') throw new Error('状态分类没把联系不上茶话会分开');
    if ((soloSnapshot.companionOptions?.partners || []).length) throw new Error('联系不上茶话会时仍显示旧伙伴');
    const paused = await payloadOf(await call("POST", "/api/focus/pause"));
    if (!paused.ok || !paused.active?.pausedAt || taskSchedules.length !== 0) throw new Error('暂停没有撤销后台计划');
    const resumed = await payloadOf(await call("POST", "/api/focus/resume"));
    if (!resumed.ok || resumed.active?.pausedAt || taskSchedules.length !== 1) throw new Error('继续没有按新目标重排后台计划');
    if (notifications.length !== firstStartNoticeCount) throw new Error('暂停后继续不应重复弹轮开始提醒');
    const cancelled = await payloadOf(await call("POST", "/api/focus/cancel"));
    if (!cancelled.ok || cancelled.cancelled !== true || taskSchedules.length !== 0) throw new Error('取消没有清理后台计划');
    if (syncCount() !== 0) throw new Error('独立专注取消时触发了陪读同步');
    const soloAgain = await payloadOf(await call("POST", "/api/focus/start", { taskTitle: '再读一章', focusMinutes: 15, breakMinutes: 5 }));
    if (!soloAgain.ok || soloAgain.active?.companionId !== '') throw new Error('取消后不能重新独立开始');
    const soloEnded = await payloadOf(await call("POST", "/api/focus/end"));
    if (!soloEnded.ok || soloEnded.ended?.session?.companionId) throw new Error('独立专注结束不对');
    if (syncCount() !== 0) throw new Error('独立专注结束时触发了陪读同步');
    // 独立专注走到休息再结束：endFocusSession 只回 phase:'break'，这条路径也不能去碰茶话会。
    const soloRest = await data.startFocusSession({ taskTitle: '休息一下', focusMinutes: 15, breakMinutes: 5, totalRounds: 2 }, new Date(Date.now() - 16 * 60_000));
    const soloRestSnapshot = await payloadOf(await call("GET", "/api/focus"));
    if (soloRestSnapshot.active?.phase !== 'break') throw new Error('独立专注没有进休息');
    const soloRestEnd = await payloadOf(await call("POST", "/api/focus/end"));
    if (soloRestEnd.ended?.phase !== 'break' || syncCount() !== 0) throw new Error('独立休息结束却动了茶话会');

    // 选了伙伴就必须真选到：失效编号、茶话会联系不上，都明确失败，不悄悄降级成自己专注。
    teaMode = 'ok';
    const stale = await payloadOf(await call("POST", "/api/focus/start", { companionId: 'gone', taskTitle: '读书', focusMinutes: 30, breakMinutes: 5 }));
    if (stale.ok || (await data.getFocusSnapshot()).active) throw new Error('失效伙伴编号却开始了计时');
    if (!/不在茶话会名单/.test(stale.error || '')) throw new Error('失效伙伴没有明确报错：' + stale.error);
    teaMode = 'broken';
    const offline = await payloadOf(await call("POST", "/api/focus/start", { companionId: 'reader', taskTitle: '读书', focusMinutes: 30, breakMinutes: 5 }));
    if (offline.ok || (await data.getFocusSnapshot()).active) throw new Error('联系不上茶话会却带伙伴开始了计时');
    teaMode = 'ok';

    // 选了真伙伴：名字来自服务，同步照旧。
    const started = await payloadOf(await call("POST", "/api/focus/start", { taskId: todo.id, companionId: 'reader', companionName: '伪造名字', focusMinutes: 30, breakMinutes: 5 }));
    if (started.active?.companionName !== '陪读搭子' || started.active?.plannedMinutes !== 30) throw new Error('没有使用茶话会真实伙伴与30分钟');
    if (!started.ok || started.active?.taskTitle !== "读一页") throw new Error("专注没有关联到既有待办");
    if (syncCount() !== 1) throw new Error('选伙伴开始没有同步茶话会');
    const ended = await payloadOf(await call("POST", "/api/focus/end"));
    if (!ended.ok || !ended.ended?.session) throw new Error("提前结束没有返回实记记录");
    if (syncCount() !== 2) throw new Error('带伙伴结束没有同步茶话会');
    // 带伙伴走到休息再提前结束：session 为空，伙伴得从结束前那段读到，不然这次收尾就丢了。
    await data.startFocusSession({ taskTitle: '读书', companionId: 'reader', companionName: '陪读搭子', focusMinutes: 15, breakMinutes: 5, totalRounds: 2 }, new Date(Date.now() - 16 * 60_000));
    const restSnapshot = await payloadOf(await call("GET", "/api/focus"));
    if (restSnapshot.active?.phase !== 'break' || restSnapshot.active?.companionId !== 'reader') throw new Error('带伙伴没有进休息');
    const restEnded = await payloadOf(await call("POST", "/api/focus/end"));
    if (restEnded.ended?.phase !== 'break' || syncCount() !== 3) throw new Error('带伙伴结束休息没有同步茶话会');

    // 到点结束：结算前读到的是专注那一段，endFocusSession 必须带回同一条 completed 记录，不能只剩休息。
    await clearActive();
    const dueStart = await data.startFocusSession({ taskTitle: '到点了', companionId: 'reader', companionName: '陪读搭子', focusMinutes: 15, breakMinutes: 5 }, new Date(Date.now() - 16 * 60_000));
    const dueEnded = await payloadOf(await call("POST", "/api/focus/end"));
    if (dueEnded.ended?.session?.id !== dueStart.id || dueEnded.ended?.session?.status !== 'completed') {
      throw new Error('到点结束没有带回同一条 completed 记录：' + JSON.stringify(dueEnded.ended));
    }
    if (syncCount() !== 4) throw new Error('到点结束没有同步茶话会');

    // 专注与休息都已过界：结算前就没 active 了，endFocusSession 只能报 alreadyEnded，
    // 这时无处认伙伴，不发空同步；收尾提醒走的是茶话会轮询 focus/state 那条恢复路径。
    await clearActive();
    const elapsedStart = await data.startFocusSession({ taskTitle: '早过了', companionId: 'reader', companionName: '陪读搭子', focusMinutes: 15, breakMinutes: 5 }, new Date(Date.now() - 31 * 60_000));
    const elapsed = await payloadOf(await call("GET", "/api/focus"));
    if (elapsed.active) throw new Error('早就该结算完了');
    const elapsedEnd = await payloadOf(await call("POST", "/api/focus/end"));
    if (elapsedEnd.ended?.alreadyEnded !== true || syncCount() !== 4) throw new Error('全过界的结束语义不对：' + JSON.stringify(elapsedEnd.ended));
    if (!data.listFocusSessions().some((row) => row.id === elapsedStart.id && row.status === 'completed')) throw new Error('全过界没有把那段记成完成');

    // 结束时专注与休息都已过界：上一轮仍作为完成记录返回，页面路由照样发完成通知。
    await clearActive();
    const lateSetStart = await data.startFocusSession({ taskTitle: '越过休息后结束', companionId: 'reader', companionName: '陪读搭子', focusMinutes: 15, breakMinutes: 5, totalRounds: 3 }, new Date(Date.now() - 21 * 60_000));
    const lateSetNotifications = notifications.length;
    const lateSetEnd = await payloadOf(await call("POST", "/api/focus/end"));
    if (lateSetEnd.ended?.session?.id !== lateSetStart.id || lateSetEnd.ended?.session?.status !== 'completed'
      || lateSetEnd.ended?.session?.planStatus !== 'interrupted' || (await data.getFocusSnapshot()).active) {
      throw new Error('双阶段过界结束没有保留完成轮并关闭整组：' + JSON.stringify(lateSetEnd.ended));
    }
    if (notifications.length !== lateSetNotifications + 1 || !/越过休息后结束/.test(notifications.at(-1)?.body || '') || syncCount() !== 5) {
      throw new Error('双阶段过界结束没有只通知一轮并同步结束状态');
    }

    // 到点取消：语义是 completed，不是取消，也不该丢同步。
    await clearActive();
    const dueCancel = await data.startFocusSession({ taskTitle: '到点就取消', companionId: 'reader', companionName: '陪读搭子', focusMinutes: 15, breakMinutes: 5 }, new Date(Date.now() - 16 * 60_000));
    const dueCancelled = await payloadOf(await call("POST", "/api/focus/cancel"));
    if (dueCancelled.cancelled !== false || dueCancelled.completed !== true) throw new Error('到点取消语义不对：' + JSON.stringify(dueCancelled));
    if (syncCount() !== 6) throw new Error('到点取消没有同步茶话会');
    const settled = data.listFocusSessions().find((row) => row.id === dueCancel.id);
    if (settled?.status !== 'completed') throw new Error('到点取消没有把那段记成完成');

    const day = await payloadOf(await call("GET", "/api/events/:date", null, today));
    if (!day.ok || day.day.focusSessions.length < 7 || !Array.isArray(day.day.focusGroups) || day.day.focusGroups.length < 7) throw new Error("日期页没有拿到专注组记录：" + JSON.stringify(day.day.focusGroups?.map((row) => row.planStatus)));
    if (day.day.userEvents.some((event) => event.type === "focus")) throw new Error("专注记录混进了日子事件账本");
    const expiredAt = new Date(Date.now() - 16 * 60_000);
    await clearActive();
    const expired = await data.startFocusSession({ focusMinutes: 15, breakMinutes: 5 }, expiredAt);
    const settledDay = await payloadOf(await call("GET", "/api/events/:date", null, dateKey(expiredAt)));
    if (!settledDay.day.focusSessions.some((session) => session.id === expired.id && session.status === "completed")) {
      throw new Error("只打开日历时，到点专注没有自动结算到日期页");
    }

    // 页面与后台任务共用加密通知认领状态：页面先结算时也只发一次，后台重复回调不重弹。
    await clearActive();
    const notificationsBefore = notifications.length;
    const notifying = await data.startFocusSession({ taskTitle: "读完这一章", focusMinutes: 15, breakMinutes: 5, totalRounds: 2 }, new Date(Date.now() - 16 * 60_000));
    const advanced = await payloadOf(await call("POST", "/api/focus/advance"));
    if (!advanced.ok || advanced.active?.phase !== "break") throw new Error("到点后没有进入休息");
    if (notifications.length !== notificationsBefore + 1 || !/读完这一章/.test(notifications.at(-1)?.body || '')
      || !data.listFocusSessions().some(row => row.id === notifying.id && row.status === "completed")) {
      throw new Error("页面检测到到点后没有结算并只发出一条提醒");
    }
    await data.focusStore.update(state => { state.active.targetAt = new Date(Date.now() - 1_000).toISOString(); });
    await focusReminder.runAppTask({ focusId: notifying.id });
    if (notifications.length !== notificationsBefore + 2 || !(notifications.at(-1)?.body || '').includes('第 2/2 轮开始')) throw new Error("休息结束后没有发出下一轮开始通知");
    await focusReminder.runAppTask({ focusId: notifying.id });
    if (notifications.length !== notificationsBefore + 2) throw new Error("旧回调造成专注结束或轮开始通知重复");

    // 日历读也会推进过界阶段；必须走同一通知幂等链，不能静默跳过下一轮开场。
    await clearActive();
    const calendarNoticeCount = notifications.length;
    await data.startFocusSession({ taskTitle: "日历推进", focusMinutes: 15, totalRounds: 2, shortBreakMinutes: 5 }, new Date(Date.now() - 16 * 60_000));
    const calendarBreak = await payloadOf(await call("GET", "/api/events/:date", null, today));
    if (calendarBreak.day.focusSessions.length < 1 || data.focusStore.read()?.active?.phase !== "break" || notifications.length !== calendarNoticeCount + 1) throw new Error("日历结算没有进入休息并发结束提醒");
    await data.focusStore.update(state => { state.active.targetAt = new Date(Date.now() - 1_000).toISOString(); });
    await call("GET", "/api/events/:date", null, today);
    if (data.focusStore.read()?.active?.roundIndex !== 2 || notifications.length !== calendarNoticeCount + 2 || !(notifications.at(-1)?.body || '').includes('第 2/2 轮开始')) throw new Error("日历推进休息结束时没有发送下一轮开始提醒");
    await clearActive();

    // 新开始请求若先替上一段做了到点结算，也要先经过通知协调，不能吞掉上一段结束提醒。
    const beforeReplacementStart = notifications.length;
    const expiredPrior = await data.startFocusSession({ taskTitle: "上一段到点", focusMinutes: 15, totalRounds: 1 }, new Date(Date.now() - 16 * 60_000));
    await focusReminder.schedule(expiredPrior);
    const replacementStart = await payloadOf(await call("POST", "/api/focus/start", { taskTitle: "新的一段", focusMinutes: 15, shortBreakMinutes: 5, totalRounds: 1, longBreakEvery: 0, longBreakMinutes: 15 }));
    if (!replacementStart.ok || replacementStart.active?.taskTitle !== "新的一段" || notifications.length !== beforeReplacementStart + 2
      || !/上一段到点/.test(notifications.at(-2)?.body || '') || !(notifications.at(-1)?.body || '').includes('第 1/1 轮开始')) {
      throw new Error("开始新专注前没有协调上一段的结束提醒与新一轮开始提醒");
    }
    await call("POST", "/api/focus/cancel");

    // 头像代理：只回图，不回凭据或本机路径；拿不到就是 404。
    const avatar = await call("GET", "/api/focus/avatar/:id", null, "", "reader");
    if (avatar.status !== 200 || !Buffer.isBuffer(avatar.__json?.body) || !avatar.__json.body.equals(png)) throw new Error('头像代理没有回字节');
    if (!/^image\\/png$/.test(String(avatar.headers?.['Content-Type'] || ''))) throw new Error('头像代理的 Content-Type 不对');
    if (!/no-store/.test(String(avatar.headers?.['Cache-Control'] || ''))) throw new Error('获权头像不该进 HTTP 缓存');
    if (JSON.stringify(avatar).includes(dataDir)) throw new Error('头像代理外泄了本机路径');
    const missing = await call("GET", "/api/focus/avatar/:id", null, "", "reader2");
    if (missing.status !== 404 || missing.__json?.ok !== false) throw new Error('没有头像时没有回 404');
    // 茶话会那边真出异常时，响应里只剩通用文案与状态码，不把异常里的路径端出去。
    teaMode = 'boom';
    const broken = await call("GET", "/api/focus/avatar/:id", null, "", "reader");
    if (![404, 500].includes(broken.status)) throw new Error('头像代理异常时状态码不对');
    if (JSON.stringify(broken).includes(dataDir)) throw new Error('头像代理异常时外泄了本机路径');
    if (!['没有头像', '头像暂时读不到'].includes(broken.__json?.error)) throw new Error('头像代理异常时文案不通用：' + JSON.stringify(broken.__json));
    teaMode = 'ok';

    const bookConfig = { focusMinutes: 45, totalRounds: 3, shortBreakMinutes: 7, longBreakEnabled: true, longBreakEvery: 2, longBreakMinutes: 20 };
    await data.addFavoriteFocusGoal('读书', bookConfig);
    const selectedConfig = await payloadOf(await call('POST', '/api/focus/favorites/select', { title: '读书' }));
    if (!selectedConfig.ok || JSON.stringify(selectedConfig.focusConfig) !== JSON.stringify(bookConfig)) throw new Error('选择常用目标没有恢复专属配置');
    const editedConfig = { ...bookConfig, totalRounds: 5 };
    const savedConfig = await payloadOf(await call('POST', '/api/focus/settings', { focusConfig: editedConfig, favoriteGoalTitle: '读书' }));
    if (!savedConfig.ok || savedConfig.favoriteGoalConfigs?.['goal:读书']?.totalRounds !== 5) throw new Error('编辑后没有保存目标专属配置');
    const configSnapshot = await payloadOf(await call('GET', '/api/focus'));
    if (configSnapshot.focusConfig?.totalRounds !== 5) throw new Error('重新打开专注时没有恢复上次设置');

    console.log(JSON.stringify({
      independent: solo.active.companionId === '',
      staleRefused: /不在茶话会名单/.test(stale.error || ''),
      offlineRefused: offline.ok === false,
      saved: day.day.focusSessions.length,
      calendarSettled: true,
      isolated: !day.day.userEvents.some((event) => event.type === "focus"),
      avatarStatus: avatar.status,
      avatarMissing: missing.status,
      avatarErrorStatus: broken.status,    }));
  `;
  try {
    const result = spawnSync(process.execPath, ["--input-type=module", "-e", childCode], {
      encoding: "utf8",
      timeout: 30_000,
      env: {
        ...process.env,
        USERPROFILE: isolatedHome,
        HOME: isolatedHome,
        HANA_HOME: path.join(isolatedHome, ".hanako"),
        TEMP: isolatedHome,
        TMP: isolatedHome,
      },
    });
    assert.equal(result.status, 0, result.stderr || result.stdout);
    assert.match(result.stdout, /"independent":true/);
    assert.match(result.stdout, /"staleRefused":true/);
    assert.match(result.stdout, /"offlineRefused":true/);
    assert.match(result.stdout, /"saved":\d+/);
    assert.match(result.stdout, /"isolated":true/);
    assert.match(result.stdout, /"avatarStatus":200/);
    assert.match(result.stdout, /"avatarMissing":404/);
    assert.match(result.stdout, /"avatarErrorStatus":(404|500)/);
  } finally {
    fs.rmSync(isolatedHome, { recursive: true, force: true });
  }
});
