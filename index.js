// 拾光记 App：数据、注入、聊天工具与共享情境的正式入口。
// apply 只初始化自己的数据、登记贡献；受保护的宿主查询放到装载后预热。
import { configureDebugLog, logInfo, logWarn } from './lib/debug-log.js';
import { configureSharedUserData } from './lib/shared-data.js';
import { configureUserNameStore } from './lib/user-name.js';
import { setAgentCatalog } from './lib/day-summary.js';
import { attachInject } from './lib/inject-app.js';
import { registerDaybookTools } from './lib/app-tools.js';
import { configurePublicTodayPublisher, writePublicToday } from './lib/public-today.js';
import { configurePublicGreetingsPublisher, publishPublicGreetings } from './lib/public-greetings.js';
import { setHostResources } from './lib/session-model.js';
import { TodoReminderScheduler, setTodoReminderScheduler } from './lib/todo-reminder-scheduler.js';
import { registerTodoCompleteService } from './lib/todo-complete.js';
import { registerFocusStateService } from './lib/focus-companion.js';
import { FocusReminderScheduler, setFocusReminderScheduler } from './lib/focus-reminder-scheduler.js';
import { rememberActiveSession, showTodoBanner } from './lib/todo-banner.js';

export const name = 'shiguangji-app';

export async function apply(ctx) {
  if (!ctx?.dataDir) throw new Error('拾光记需要宿主提供应用数据目录');
  configureDebugLog(ctx.dataDir);
  const data = configureSharedUserData(ctx.dataDir);
  configureUserNameStore(ctx.dataDir);
  configurePublicTodayPublisher(ctx);
  // greetings 与 today 同一条通道、各自判重；发布失败只安静收场，绝不影响保存与对话。
  configurePublicGreetingsPublisher(ctx);
  data.onPublicContextChange = () => {
    try { writePublicToday({ dataDir: ctx.dataDir, data }); }
    catch (error) { logWarn(`保存后的共享情境更新失败：${error?.message || error}`); }
    try { publishPublicGreetings({ data }); }
    catch (error) { logWarn(`保存后的节日问候共享失败：${error?.message || error}`); }
  };
  // 先把宿主的 resources 句柄递给扩展：扩展自己的 ctx 里没有它，但两者同进程。
  setHostResources(ctx.resources);
  attachInject(ctx, message => logInfo(message));
  // 她最近在哪个会话开口：subscribe 第二个参数就是会话路径，到点的横幅要挂到那儿。
  try {
    ctx.bus.subscribe((event, sessionPath) => rememberActiveSession(sessionPath), { types: ['message_end'] });
  } catch (error) {
    logWarn(`会话在场记录没挂上，待办横幅会退回系统通知：${error?.code || ''} ${error?.message || error}`);
  }
  const reminder = setTodoReminderScheduler(new TodoReminderScheduler({ ctx, data,
    log: { info: logInfo, warn: logWarn, error: logWarn },
    banner: { show: (payload) => showTodoBanner(ctx, payload, { log: logWarn }) } }));
  const focusReminder = setFocusReminderScheduler(new FocusReminderScheduler({ ctx, data, log: { warn: logWarn } }));
  try { registerDaybookTools(ctx, event => event?.type === 'todo' ? reminder.eventChanged(event) : undefined); }
  catch (error) {
    logWarn(`聊天工具登记失败：${error?.code || ""} ${error?.message || error}`);
    throw error; // 不把缺失工具伪装成成功装载；异步登记失败仍由宿主裁决。
  }

  // 跨 App 勾完成：茶话会里听见她说"我做完了"，从那边走这条路落到同一本账。
  // 装载期只注册服务，不调用任何受保护接口；真正被调用时才读写数据。
  try { registerTodoCompleteService({ ctx, data, eventChanged: event => event?.type === 'todo' ? reminder.eventChanged(event) : undefined, log: { info: logInfo, warn: logWarn } }); }
  catch (error) {
    logWarn(`跨 App 完成服务没挂上：${error?.code || ""} ${error?.message || error}`);
  }

  // 专注约定服务：与 todo/complete 同规矩，注册失败只警告，不拖垮整个应用装载。
  try { registerFocusStateService({ ctx, data }); }
  catch (error) {
    logWarn(`专注状态服务没挂上：${error?.code || ""} ${error?.message || error}`);
  }

  await reminder.registerAppTaskHandler(); // 只登记；装载期不查询权限或创建计划。
  await focusReminder.registerAppTaskHandler();

  // 不再采样其他会话正文、旁听每个 step，或执行试错式资源查询。
  // 探针与探路函数已全部清除：ctx.resources 正门在 1.1.0-beta 上实测可用，
  // 会话模型改由 inject-app.js 的 primeSessionModel 预取。
  const timer = setTimeout(async () => {
    writePublicToday({ dataDir: ctx.dataDir, data, force: true });
    publishPublicGreetings({ data, force: true });
    void reminder.restoreAppSchedules();
    void focusReminder.restore();
    try {
      const rows = await ctx.bus.request('agent:list', { scope: 'all' });
      logInfo(`伙伴名称目录就绪：${setAgentCatalog(rows)} 个`);
    } catch (error) {
      logWarn(`伙伴名称目录未就绪：${error?.code || ''} ${error?.message || error}`);
    }
  }, 0);
  timer.unref?.();
  // 茶话会单独聊天时也要跨天更新；内容指纹会跳过没变化的写盘和发布。
  const refresh = setInterval(() => {
    try { writePublicToday({ dataDir: ctx.dataDir, data }); }
    catch (error) { logWarn(`共享情境刷新失败：${error?.message || error}`); }
    // 问候台账跟着定时补一次：完成确认那侧没有通道，靠这里按内容指纹把变化送出去。
    try { publishPublicGreetings({ data }); }
    catch (error) { logWarn(`节日问候共享刷新失败：${error?.message || error}`); }
    void reminder.restoreAppSchedules(); // 补排已过期的失败重试；未知结果只对账，不盲目重建。
    void focusReminder.restore();
  }, 60 * 1000);
  refresh.unref?.();
}

export default apply;
