// 拾光记 · 会话分区判断（普通窗口 / Code 页窗口 / App 会话）
//
// 为什么不能看 sessionPath 了事：Code 页的会话不在 session:list 的名单里（2026-10-25 实机确认），
// 只有 session:get 查得到，而且只有它返回的对象带 namespace（home / code / app）。
// session:list 那些字段（path / title / kind / visibility / ownerPluginId）没有一项能区分 Code 窗口：
// 普通会话的 kind 一律空，cwd 两边都可能指向同一个工作台。
//
// 判不出来则 fail-closed：这一轮什么都不注入。
// 不能默认按普通窗口处理：把 Code 窗口误认成聊天窗口，会往改代码的那一轮塞进整套生活情境
// （日记、生理期、做好的回顾）；反过来认错只是少带一次精简的时间与峰谷，下一轮就补回来。
// 所以「拿不准」只允许倒向「这轮跳过」，不允许倒向「给全套」。

const CACHE_MAX = 200;
// 会话落在哪个分区是创建时定死的，中途不会变，缓存可以一直用；留保鲜期只为宿主重启后对象重造时自然失效。
const CACHE_TTL_MS = 30 * 60 * 1000;
// 查不到的也记一笔：子代理会话每条都查不到，不记就会每个钩子重打两遍失败查询，
// 白占宿主那条 RPC 通道。负结果只保鲜一分钟，宿主刚启动或会话刚建出来时 miss 是正常的。
const NEGATIVE_TTL_MS = 60 * 1000;
// 「宿主没答上来」（超时、报错）不按负结果记那么久：这一轮跳过，下一轮就该重新问。
// 记一分钟的话，宿主只是忙一下，那个会话接下来一分钟都会被当成「查不出分区」。
const UNKNOWN_TTL_MS = 5 * 1000;

/** 宿主已确认的分区。只有这几个是「知道自己在哪儿」，其余一律当未知分区处理。 */
export const KNOWN_SESSION_NAMESPACES = Object.freeze(["home", "code", "app", "casual"]);

// 会话 id 和会话文件名里都带着同一段 UUID（文件名形如 2026-10-29T12-53-04-519Z_<uuid>.jsonl），
// 它跟着会话走、不会变，是核对「问的和回的到底是不是同一个会话」最可靠的锚点。
const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

/** 从会话 id 或会话文件路径里抠出那段 UUID；抠不出来返回空串。 */
export function extractSessionUuid(value) {
  const matched = String(value || "").match(UUID_RE);
  return matched ? matched[0].toLowerCase() : "";
}

/**
 * session:get 回的会话是不是所问的那一个。
 *
 * 宿主按 id 查、按路径查都能落到某个会话上，跨会话串号时它照样会给一个「查到了」的答复：
 * 问 A 的路径，回 B 的会话；问 A 的 id，回 B 的 id。分区一旦取自错的会话，
 * 后面整套注入（今日时光、历史档案、峰谷提醒）都会按错的身份来算。
 *
 * 只有两边形态对得上（都是 UUID，或都是 sess_xxx）才敢比；形态不同说明压根没法比，不算错。
 */
export function sessionMatchesRequest({ askedId, askedFile, gotId, gotPath } = {}) {
  const asked = String(askedId || "").trim();
  const got = String(gotId || "").trim();
  if (asked && got) {
    const bothUuid = Boolean(extractSessionUuid(asked)) && Boolean(extractSessionUuid(got));
    const bothSess = /^sess_/i.test(asked) && /^sess_/i.test(got);
    if ((bothUuid || bothSess) && asked.toLowerCase() !== got.toLowerCase()) return false;
  }
  const askedFileUuid = extractSessionUuid(askedFile);
  const gotFileUuid = extractSessionUuid(gotPath);
  if (askedFileUuid && gotFileUuid && askedFileUuid !== gotFileUuid) return false;
  return true;
}

/**
 * 分区查问有三种结果，含义完全不同，揉成一句「查不到」就会认错窗口：
 *   resolved  —— 宿主认得这个会话，并说出了分区。
 *   not-found —— 宿主答了，但这个会话不在它给应用看的那份名单里（闲聊就是这样：
 *                session:get 内部走 listSessions({namespace:"all"})，而 all 白名单缺 casual）。
 *   unknown   —— 宿主没答上来（超时、报错）。这时候我们不知道，别猜。
 *
 * 「宿主答了但没有它」和「宿主没答」的区别，就是「认错窗口」和「少带一次」的区别：
 * 2026-10-31 实采，宿主忙到 session:get 超时，一个 Code 页会话被当成闲聊灌了 2390 字
 * 完整情境（Code 那档本该只有 81 字精简块）。
 */
const EMPTY = Object.freeze({ namespace: "", title: "", status: "unknown" });

/**
 * 分区是否已经查清（home / code / app）。
 * 调用方拿它决定要不要继续做注入：false 就是「这轮跳过」，不是「按聊天算」。
 */
export function isKnownSessionNamespace(namespace) {
  return KNOWN_SESSION_NAMESPACES.includes(String(namespace || "").trim());
}

/**
 * 创建会话信息解析器。
 * @param {{bus?:object, debug?:(line:string)=>void}} opts
 * @returns {(input:{sessionId?:string, sessionPath?:string, timeoutMs?:number}) => Promise<{namespace:string, title:string, status:"resolved"|"not-found"|"unknown"}>}
 *   namespace 为 'home' / 'code' / 'app' / 'casual'；status 说明这答案是问出来的还是没问出来。
 */
export function createSessionMetaResolver({ bus, debug, negativeTtlMs = NEGATIVE_TTL_MS } = {}) {
  const cache = new Map();

  function remember(key, value, ttlMs = CACHE_TTL_MS) {
    if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value);
    cache.set(key, { value, at: Date.now(), ttlMs });
  }

  return async function resolveSessionMeta({ sessionId, sessionPath, timeoutMs = 2500 } = {}) {
    const id = String(sessionId || "").trim();
    const file = String(sessionPath || "").trim();
    const key = id || file;
    if (!key) return EMPTY;

    const hit = cache.get(key);
    if (hit && Date.now() - hit.at < (hit.ttlMs ?? CACHE_TTL_MS)) return hit.value;
    if (typeof bus?.request !== "function") return EMPTY;

    // 宿主两种参数都认；有 sessionId 优先用它，没有就退回会话路径。
    // 总线事件里的 sessionId 有时是会话文件名（时间戳_UUID），不是宿主的 sess_xxx，
    // 所以宁可多试一次，也不能让分区判断落空。
    const attempts = [];
    if (id && id !== "unknown") attempts.push({ sessionId: id, scope: "all" });
    if (file) attempts.push({ legacySessionPath: file, scope: "all" });
    // 宿主答过没有：答了「这个会话我这儿没有」是一回事，没答上来是另一回事。
    let answered = false;
    let unresolvedTitle = "";

    for (const payload of attempts) {
      const via = payload.sessionId ? "id" : "path";
      try {
        const result = await bus.request("session:get", payload, { timeout: timeoutMs });
        const session = result?.session || result;
        // 回的不是所问的会话，就当没查到：宁可这一轮判不出分区（少带一次），
        // 也不拿别的会话的身份去算分区、算模型、算峰谷时段。
        debug?.(`会话分区: 按${via}查回 namespace="${String(session?.namespace || "-")}" title="${String(session?.title || "-").slice(0, 24)}"`);
        if (!sessionMatchesRequest({
          askedId: payload.sessionId,
          askedFile: payload.legacySessionPath,
          gotId: session?.sessionId,
          gotPath: session?.path,
        })) {
          // 这里不能算「宿主答了」：它回的根本不是我们问的那个会话。
          // 算成已答，会落到 status="not-found"，而那是闲聊的形状——Code 页会话
          // 就可能因此被当成闲聊放行。回错对象时该归 unknown：这轮不知道，跳过。
          debug?.("会话分区判断: session:get 回的不是所问的会话，按没查到处理");
          continue;
        }
        // 到这里才算宿主真的答了：要么给出了这个会话，要么明确说没有这个会话（回 null）。
        answered = true;
        const meta = {
          namespace: String(session?.namespace || "").trim(),
          title: typeof session?.title === "string" ? session.title.trim() : "",
          status: "resolved",
        };
        if (isKnownSessionNamespace(meta.namespace)) {
          remember(key, meta);
          if (file && file !== key) remember(file, meta);
          return meta;
        }
        // 有标题不代表分区已查清；继续尝试路径，未查清只用短负缓存。
        if (meta.title) unresolvedTitle = meta.title;
      } catch (error) {
        debug?.(`会话分区判断失败（按${via}）：${error?.message || error}`);
      }
    }
    // 宿主给了答复却说不出这个会话的分区 → 它不在应用能看的那份名单里（闲聊的形状）。
    // 宿主压根没答复 → 这一轮什么都不知道，跳过就行，别猜它是闲聊。
    const value = answered
      ? { namespace: "", title: unresolvedTitle, status: "not-found" }
      : { namespace: "", title: "", status: "unknown" };
    remember(key, value, answered ? negativeTtlMs : UNKNOWN_TTL_MS);
    return value;
  };
}

/** 是不是 Code 页的会话。 */
export function isCodeSession(namespace) {
  return String(namespace || "").trim() === "code";
}

/**
 * 是不是「闲聊」窗口的会话。
 *
 * 闲聊是宿主侧边栏那扇门（HanaAgent 1.5.7 起），它不是普通会话：每个 sess 是
 * `createDetachedSession({ namespace: "casual", visibleInSessionList: false })` 建出来的，
 * 聊几段就换一个会话，manifest 的 domain / namespace 都记为 casual。
 *
 * 它跟 home 一样是「聊天」，所以注入该吃全套情境；当未知分区跳过就等于这扇门永远关着。
 */
export function isCasualSession(namespace) {
  return String(namespace || "").trim() === "casual";
}

/**
 * 是不是子代理会话。
 * 宿主把子代理的会话落在 agents/<伙伴>/subagent-sessions/<kind>/ 下（2026-10-26 实机确认），
 * 这类会话 session:get 一律查不到 manifest，所以只能看路径。
 * 两边分隔符都认，大小写不敏感：宿主换盘符风格不该让判定失灵。
 */
export function isSubagentSessionPath(sessionPath) {
  return /[\\/]subagent-sessions[\\/]/i.test(String(sessionPath || ""));
}
