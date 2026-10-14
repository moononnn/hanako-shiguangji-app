// 专注约定仅交给获准的茶话会，不发布到通用情境或主对话。
import { logWarn } from "./debug-log.js";

export const FOCUS_STATE_SERVICE = 'focus/state';
const TEA_APP = 'chahuahui';
const PARTNERS_SERVICE = `app:${TEA_APP}/focus/partners`;
const SYNC_SERVICE = `app:${TEA_APP}/focus/sync`;
// 陪读头像在拾光记自己的路由上代理出去，前端拿到的就是这条同源相对路径。
const AVATAR_ROUTE = 'api/focus/avatar/';
// 与茶话会那条服务同一个口径：宿主伙伴头像常见 1~2MB，base64 后接近 3MB，
// 闸设太小会把真图全挡掉、只剩首字。6MB 覆盖 4MB 以内原图，仍留一道闸。
const MAX_AVATAR_BYTES = 6 * 1024 * 1024;
// 多轮计划的轮次字段要一并投影给茶话会：那边要分得出“第几轮/共几轮”，
// 否则每轮开场收尾措辞完全一样，也说不出后面还剩几轮。tea 那边同名同义，读不到就按单轮。
const ACTIVE_FIELDS = ['id', 'phase', 'startedAt', 'targetAt', 'pausedAt', 'remainingMs', 'elapsedMs', 'plannedMinutes', 'taskTitle', 'companionId', 'companionName',
  'setId', 'roundIndex', 'totalRounds', 'breakKind', 'breakMinutes'];
// 收尾记录也要带休息安排：她结束一轮时得知道接下来歇多久，否则只剩“计时到了”而没有下文。
const RECORD_FIELDS = ['id', 'status', 'startedAt', 'endedAt', 'durationMs', 'plannedMinutes', 'taskTitle', 'companionId', 'companionName',
  'roundIndex', 'totalRounds', 'planStatus', 'breakKindAfter', 'shortBreakMinutes', 'longBreakMinutes'];
const pick = (row, fields) => Object.fromEntries(fields.filter(key => row[key] !== undefined).map(key => [key, row[key]]));

export function registerFocusStateService({ ctx, data }) {
  // 与 todo/complete 同一条规矩：服务注册失败不该拖垮整个应用装载。
  // 宿主没有 bus.handle（旧版或测试用最小 ctx）时只警告并跳过，不抛。
  if (typeof ctx?.bus?.handle !== "function") {
    logWarn("[拾光记] 专注状态服务没挂上：宿主没有 bus.handle");
    return null;
  }
  return ctx.bus.handle(FOCUS_STATE_SERVICE, async (payload = {}, caller = {}) => {
    if (caller.callerAppId !== TEA_APP) throw new Error('专注约定只向茶话会开放');
    if (caller.signal?.aborted) throw new Error('这次读取已取消');
    const snapshot = await data.getFocusSnapshot();
    const active = snapshot.active?.companionId ? pick(snapshot.active, ACTIVE_FIELDS) : null;
    const id = String(payload.sessionId || '').slice(0, 100);
    const record = id ? data.listFocusSessions().find(row => row.id === id && row.companionId) : null;
    return { ok: true, active, session: record ? pick(record, RECORD_FIELDS) : null };
  }, { allowCrossApp: true });
}

const ABSENT_CODES = new Set(['app_not_installed', 'app_not_found', 'unknown_app']);

/**
 * 缺装、停用、拒权、超时在 bus 上可能长得很像。
 * 这里只在 code 或文案明确说“未安装/不存在”时才判 absent，其余一律 unavailable。
 * 注意：这些 code 是根据常见命名列的候选，**没有拿到宿主的实际报错证据**；
 * 认不出来就归 unknown，不会把停用或拒权说成没装。
 */
function classifyBusFailure(error) {
  if (ABSENT_CODES.has(String(error?.code || '').toLowerCase())) return 'absent';
  const message = String(error?.message || '').toLowerCase();
  if (/\b(app|application)\b[^a-z]{0,3}(is )?not installed/.test(message)) return 'absent';
  if (/应用未安装|应用不存在/.test(message)) return 'absent';
  return 'unavailable';
}

// 只记 code 和归类：报错原文可能带本机路径或凭据，不往外送。以后真缺装时拿这条对账。
function noteBusFailure(ctx, error, status) {
  try { ctx?.log?.warn?.(`[拾光记] 茶话会陪读服务不可用（归类 ${status}，code ${String(error?.code || 'unknown').slice(0, 64)}）`); }
  catch { /* 记不上也不该影响专注 */ }
}

const STATUS_TEXT = {
  empty: '茶话会里还没有可陪读的伙伴，请先在茶话会配置一位；不选伙伴也能自己专注。',
  absent: '没找到茶话会。不选伙伴照样可以自己专注。',
  unavailable: '暂时联系不上茶话会。不选伙伴照样可以自己专注。',
};

// 只在明确可用时返回名单。任何一种拿不到的状态都交回空名单，不留旧茶话会伙伴。
function companionOptions(status, partners = [], reminderStatus = null) {
  return {
    status,
    available: status === 'available',
    partners,
    reminderStatus,
    error: status === 'available' ? '' : STATUS_TEXT[status] || STATUS_TEXT.unavailable,
  };
}

export async function getFocusCompanions(ctx) {
  try {
    const result = await ctx.bus.request(PARTNERS_SERVICE, {}, { timeout: 5000 });
    if (!result?.ok || !Array.isArray(result.partners)) throw new Error('茶话会尚未支持陪读');
    const partners = result.partners.filter(row => row && typeof row.id === 'string' && row.id && typeof row.name === 'string')
      .map(row => ({ id: row.id.slice(0, 200), name: row.name.slice(0, 120), avatar: `${AVATAR_ROUTE}${encodeURIComponent(row.id.slice(0, 200))}` }));
    return companionOptions(partners.length ? 'available' : 'empty', partners, result.reminderStatus || null);
  } catch (error) {
    const status = classifyBusFailure(error);
    noteBusFailure(ctx, error, status);
    return companionOptions(status);
  }
}

/**
 * 这次开始要不要茶话会陪读。
 * 没选伙伴就独立计时，不查茶话会；选了却拿不到、或这个编号已不在名单里，明确失败，不悄悄降级成自己专注。
 */
export async function resolveFocusCompanion(ctx, companionId) {
  const id = String(companionId || '').trim();
  if (!id) return { companionId: '', companionName: '' };
  const options = await getFocusCompanions(ctx);
  if (!options.available) throw new Error(options.error);
  const companion = options.partners.find(row => row.id === id);
  if (!companion) throw new Error('这位陪读伙伴已经不在茶话会名单里了，重新选一位再开始。');
  return { companionId: companion.id, companionName: companion.name };
}

// 声明与字节必须对得上：光看 Content-Type 等于把对方的声明当真，
// 拿 PNG 的字节声明成 image/jpeg 也会被放行。四种图的魔数各认各的，认不出就当没有。
const IMAGE_MAGIC = {
  'image/png': bytes => bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47,
  'image/jpeg': bytes => bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff,
  'image/gif': bytes => bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x38,
  'image/webp': bytes => bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46
    && bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50,
};

export async function fetchFocusAvatar(ctx, agentId) {
  const id = String(agentId || '').trim();
  if (!id || id.length > 200) return null;
  try {
    const result = await ctx.bus.request(`app:${TEA_APP}/focus/avatar`, { agentId: id }, { timeout: 5000 });
    const base64 = result?.avatar?.base64;
    if (!result?.ok || typeof base64 !== 'string' || !base64) return null;
    const bytes = Buffer.from(base64, 'base64');
    if (!bytes.length || bytes.length > MAX_AVATAR_BYTES) return null;
    const contentType = String(result.avatar.contentType || '').toLowerCase();
    const magic = IMAGE_MAGIC[contentType];
    if (!magic || bytes.length < 12 || !magic(bytes)) return null;
    return { bytes, contentType };
  } catch {
    return null;
  }
}

export async function syncFocusCompanion(ctx) {
  try {
    const result = await ctx.bus.request(SYNC_SERVICE, {}, { timeout: 5000 });
    if (!result?.ok) throw new Error('茶话会未确认同步');
    return result.reminderStatus?.failed ? '计时状态已同步，但有陪读消息没能生成；不会自动重试或切换模型。' : '';
  } catch {
    return '计时状态已保存，但茶话会陪伴尚未确认接通；请检查茶话会是否启用及两边的应用服务权限。';
  }
}
