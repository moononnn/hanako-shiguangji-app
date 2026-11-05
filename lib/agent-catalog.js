// 伙伴名单目录：宿主那边随时可能新建伙伴，名单不能只在装载时抓一次。
// 目录本体仍由 lib/day-summary.js 持有，这里只管「什么时候去问宿主要最新的」。
//
// 为什么需要这一层：App 环境读不到 agents 目录，伙伴名单只能靠宿主接口拿。
// 早先只在 apply() 里取一次，用户后来在 Hana 新建伙伴，拾光记这边就一直拿着旧名单，
// 设置里的伙伴列表既选不到新伙伴，注入里的名字也停在旧的那一批。
import { setAgentCatalog } from './day-summary.js';
import { logInfo, logWarn } from './debug-log.js';

let bus = null;
let fetchedAt = 0;
let inflight = null;

export function configureAgentCatalog(ctx) {
  bus = ctx?.bus && typeof ctx.bus.request === 'function' ? ctx.bus : null;
  return !!bus;
}

/**
 * 拉一次最新名单并写回目录。
 * ttlMs：多久之内不重复问宿主；force 为真时无视这个间隔。
 * 拉失败不动旧名单——宁可名单旧一点，也不要把已有的伙伴清空。
 */
export async function refreshAgentCatalog({ ttlMs = 0, force = false } = {}) {
  if (!bus) return 0;
  const now = Date.now();
  if (!force && now - fetchedAt < ttlMs) return 0;
  if (inflight) {
    await inflight;
    return 0;
  }
  fetchedAt = now;
  inflight = (async () => {
    const rows = await bus.request('agent:list', { scope: 'all' });
    return setAgentCatalog(rows);
  })();
  try {
    const count = await inflight;
    logInfo(`伙伴名单已刷新：${count} 个`);
    return count;
  } catch (error) {
    logWarn(`伙伴名单刷新失败，沿用旧名单：${error?.code || ''} ${error?.message || error}`);
    return 0;
  } finally {
    inflight = null;
  }
}
