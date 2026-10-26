// 拾光记 · 会话分区判断（普通窗口 / Code 页窗口 / App 会话）
//
// 为什么不能看 sessionPath 了事：Code 页的会话不在 session:list 的名单里（2026-10-25 实机确认），
// 只有 session:get 查得到，而且只有它返回的对象带 namespace（home / code / app）。
// session:list 那些字段（path / title / kind / visibility / ownerPluginId）没有一项能区分 Code 窗口：
// 普通会话的 kind 一律空，cwd 两边都可能指向同一个工作台。
//
// 判不出来一律按普通窗口处理：宁可少开一次 Code 页那套精简注入，
// 也不能把普通聊天当成代码窗口，把该给她的情境吞掉。

const CACHE_MAX = 200;
// 会话落在哪个分区是创建时定死的，中途不会变，缓存可以一直用；留保鲜期只为宿主重启后对象重造时自然失效。
const CACHE_TTL_MS = 30 * 60 * 1000;
// 查不到的也记一笔：子代理会话每条都查不到，不记就会每个钩子重打两遍失败查询，
// 白占宿主那条 RPC 通道。负结果只保鲜一分钟，宿主刚启动或会话刚建出来时 miss 是正常的。
const NEGATIVE_TTL_MS = 60 * 1000;

const EMPTY = Object.freeze({ namespace: "", title: "" });

/**
 * 创建会话信息解析器。
 * @param {{bus?:object, debug?:(line:string)=>void}} opts
 * @returns {(input:{sessionId?:string, sessionPath?:string, timeoutMs?:number}) => Promise<{namespace:string, title:string}>}
 *   namespace 为 'home' / 'code' / 'app'，判不出来是空字符串。
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

    for (const payload of attempts) {
      try {
        const result = await bus.request("session:get", payload, { timeout: timeoutMs });
        const session = result?.session || result;
        const meta = {
          namespace: String(session?.namespace || "").trim(),
          title: typeof session?.title === "string" ? session.title.trim() : "",
        };
        if (meta.namespace || meta.title) {
          remember(key, meta);
          if (file && file !== key) remember(file, meta);
          return meta;
        }
      } catch (error) {
        debug?.("会话分区判断失败：" + (error?.message || error));
      }
    }
    remember(key, EMPTY, negativeTtlMs);
    return EMPTY;
  };
}

/** 是不是 Code 页的会话。 */
export function isCodeSession(namespace) {
  return String(namespace || "").trim() === "code";
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
