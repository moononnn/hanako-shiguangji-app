// 拾光记 · 从会话档案读当前模型
// 宿主每次开窗和切模型都会往会话 jsonl 追加一条 {"type":"model_change",provider,modelId}，
// 这是宿主落盘的权威记录。模型自述不可信（模型不知道自己跑在哪个模型上），
// ctx.model 在主对话场景实测恒为 null，能用的只有这里。
//
// 会话文件只追加不重写，所以记住上次扫到哪个字节，下次只扫新增的那一段；
// 文件没长大就直接复用上次结果。否则每轮对话都要把整个档案重扫一遍，越聊越慢。

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { logWarn } from "./debug-log.js";

const CHUNK_BYTES = 256 * 1024;
const MAX_SCAN_BYTES = 32 * 1024 * 1024;
const ALIGN_WINDOW_BYTES = 64 * 1024;
const CACHE_LIMIT = 32;

/** sessionFile → { size, model }。进程内缓存，重启后自然失效（多扫一次，无副作用）。 */
const cache = new Map();

/** agentId|sessionId → 会话文件路径。getSessionFile 实机给不出可用路径时的兵底。 */
const fileCache = new Map();

const HOME_SESSION_ROOT = path.join(os.homedir(), ".hanako", "agents");

// 测试可换根目录；实机固定指向用户主目录。会话文件会被宿主清理，
// 所以测试必须在临时目录里自己造一份，不能拿真实会话文件名当断言。
let sessionRoot = HOME_SESSION_ROOT;

export function __setSessionRootForTest(root) {
  sessionRoot = String(root || HOME_SESSION_ROOT);
  cache.clear();
  fileCache.clear();
}

/**
 * 按 agentId + sessionId 在会话目录里找档案文件。
 * 会话文件名里带 sessionId（形如 <时间戳>_<sessionId>.jsonl），所以包含匹配就够定位。
 * 找不到返回 null；整段都用 try 包住，失败只当没找到，不影响对话。
 */
export function findSessionFile(agentId, sessionId) {
  const agent = String(agentId || "").trim();
  const session = String(sessionId || "").trim();
  if (!agent || !session) return null;
  const key = `${agent}|${session}`;
  if (fileCache.has(key)) return fileCache.get(key);
  let found = null;
  try {
    const dir = path.join(sessionRoot, agent, "sessions");
    const entries = fs.readdirSync(dir).filter((name) => name.endsWith(".jsonl") && name.includes(session));
    if (entries.length) {
      // 同名可能带不同时间戳前缀，取最新修改的那个。
      entries.sort((a, b) => fs.statSync(path.join(dir, b)).mtimeMs - fs.statSync(path.join(dir, a)).mtimeMs);
      found = path.join(dir, entries[0]);
    }
  } catch {
    found = null;
  }
  if (fileCache.size >= CACHE_LIMIT) fileCache.delete(fileCache.keys().next().value);
  fileCache.set(key, found);
  return found;
}

function parseModelChangeLine(line) {
  const trimmed = line.trim();
  if (!trimmed || trimmed[0] !== "{") return null;
  let entry;
  try {
    entry = JSON.parse(trimmed);
  } catch {
    // 末行可能正写到一半；坏行直接跳过继续往前。
    return null;
  }
  if (entry?.type !== "model_change") return null;
  const provider = typeof entry.provider === "string" ? entry.provider : "";
  const modelId = typeof entry.modelId === "string" ? entry.modelId : "";
  if (!provider && !modelId) return null;
  return { provider, modelId, at: typeof entry.timestamp === "string" ? entry.timestamp : null };
}

/** 把起点往前对齐到行边界，免得从半行 JSON 开始扫。 */
function alignToLineStart(fd, start) {
  if (start <= 0) return 0;
  const window = Math.min(start, ALIGN_WINDOW_BYTES);
  const buffer = Buffer.allocUnsafe(window);
  fs.readSync(fd, buffer, 0, window, start - window);
  const index = buffer.lastIndexOf(0x0a);
  return index === -1 ? start - window : start - window + index + 1;
}

/** 倒着扫 [start, end) 区间，找最近一条 model_change。 */
function scanRange(fd, start, end, floor) {
  const from = alignToLineStart(fd, start);
  let position = end;
  let carry = "";
  while (position > from && position - from < MAX_SCAN_BYTES) {
    const length = Math.min(CHUNK_BYTES, position - from);
    position -= length;
    const buffer = Buffer.allocUnsafe(length);
    fs.readSync(fd, buffer, 0, length, position);
    // carry 是靠后那块的首行残行，本块内容在前，拼接后仍是正常行序。
    const lines = `${buffer.toString("utf8")}${carry}`.split("\n");
    carry = lines.shift() ?? "";
    for (let index = lines.length - 1; index >= 0; index -= 1) {
      const found = parseModelChangeLine(lines[index]);
      if (found) return found;
    }
  }
  if (position <= from) return parseModelChangeLine(carry);
  return null;
}

/**
 * 读当前会话最近一条 model_change。
 * 文件读不到、被占用、超出扫描上限都只返回 null，不抛——峰谷功能会自动静默。
 * @param {string} sessionFile 会话 jsonl 绝对路径
 * @returns {{provider: string, modelId: string, at: string|null}|null}
 */
export function readLatestModelChange(sessionFile) {
  try {
    const target = String(sessionFile || "").trim();
    if (!target) return null;
    const stat = fs.statSync(target);
    if (!stat.isFile() || stat.size <= 0) return null;

    const hit = cache.get(target);
    if (hit && stat.size === hit.size) return hit.model;

    const start = hit && stat.size > hit.size ? hit.size : 0;
    const fd = fs.openSync(target, "r");
    let found;
    try {
      found = scanRange(fd, start, stat.size, start);
    } finally {
      fs.closeSync(fd);
    }
    // 增量段里没有新的 model_change，就沿用上次认定的模型。
    const model = found || (hit ? hit.model : null);

    if (cache.size >= CACHE_LIMIT) cache.delete(cache.keys().next().value);
    cache.set(target, { size: stat.size, model });
    return model;
  } catch {
    // 文件不存在、权限不足——按拿不到处理。
    return null;
  }
}

/** 仅测试用：清掉进程内缓存。 */
export function __clearSessionModelCacheForTest() {
  cache.clear();
  fileCache.clear();
  resourcesCache.clear();
}

/** agentId|sessionId → 已预取的模型。注入前填好，旧版同步判定直接读它。 */
const primedModels = new Map();

/**
 * 预取当前会话的模型。必须在注入钩子调用之前 await，
 * 好让 extensions/inject.js 那套同步判定一行不用改成 async。
 */
export async function primeSessionModel(resources, { agentId, sessionId, sessionsRoot } = {}) {
  const key = `${String(agentId || "").trim()}|${String(sessionId || "").trim()}`;
  if (!resources || key === "|") return null;
  const model = await readLatestModelChangeViaResources(resources, { agentId, sessionId, sessionsRoot });
  if (model) primedModels.set(key, model);
  if (primedModels.size >= CACHE_LIMIT * 4) primedModels.delete(primedModels.keys().next().value);
  return model;
}

/** 同步取预取结果；没有就 null。 */
export function getPrimedModel(agentId, sessionId) {
  const key = `${String(agentId || "").trim()}|${String(sessionId || "").trim()}`;
  return primedModels.get(key) || null;
}

// ── 走宿主 ctx.resources 的那一条（实机可用的正门）─────────────────
// App 进程用 fs 读宿主目录会被 Node 权限模型拦死（ERR_ACCESS_DENIED），
// 但 ctx.resources 是宿主给的正规资源接口：能力 app/resources.read，
// 传 {kind:'local-file', path} 就能列、能读，junction 真实路径宿主自己会解析。
// 这几条是在 1.1.0-beta 上实测跑通的。

const resourcesCache = new Map();

// 扩展的 ctx 里没有 resources（只有 dataDir/agentId/model/sessionManager），
// 但扩展与 App 主入口在同一进程，用模块单例把宿主句柄递过去。
let hostResources = null;

export function setHostResources(resources) {
  hostResources = resources || null;
}

export function getHostResources() {
  return hostResources;
}

function sessionsDirOf(agentId) {
  const home = process.env.USERPROFILE || process.env.HOME || "";
  if (!home) return "";
  return path.join(home, ".hanako", "agents", String(agentId || "").trim(), "sessions");
}

/** resources.list 的返回可能是数组，也可能是 {items}，都认。 */
function pickItems(raw) {
  if (Array.isArray(raw)) return raw;
  if (Array.isArray(raw?.items)) return raw.items;
  return [];
}

/**
 * 从 read 的返回值里挖出文本。实测 1.1.0-beta 返回
 * {resourceKey, resource, content: Uint8Array, version, filePath}——文件是按 UTF-8 字节给的。
 * 这里依次处理：字节序列 / 字符串 / 字段名嵌套 / 数组，三种包法都认。
 */
function extractText(value, depth = 0) {
  if (typeof value === "string") return value;
  if (value === null || value === undefined || depth > 4) return "";
  // Buffer 是 Uint8Array 的子类，一并认了。
  if (value instanceof Uint8Array) return new TextDecoder().decode(value);
  if (ArrayBuffer.isView(value)) {
    return new TextDecoder().decode(new Uint8Array(value.buffer, value.byteOffset, value.byteLength));
  }
  if (Array.isArray(value)) {
    if (value.length && value.every((item) => typeof item === "number" && Number.isInteger(item) && item >= 0 && item <= 255)) {
      return new TextDecoder().decode(Uint8Array.from(value));
    }
    for (const item of value) {
      const got = extractText(item, depth + 1);
      if (got) return got;
    }
    return "";
  }
  if (typeof value !== "object") return "";
  for (const key of ["text", "content", "data", "body", "value", "utf8", "source", "raw"]) {
    if (key in value) {
      const got = extractText(value[key], depth + 1);
      if (got) return got;
    }
  }
  for (const item of Object.values(value)) {
    const got = extractText(item, depth + 1);
    if (got) return got;
  }
  return "";
}

/** 描述返回值形状：只说字段名、类型、长度，不打印内容——会话档案里是她的对话，不能进日志。 */
function describeShape(value) {
  if (value === null) return "null";
  if (value === undefined) return "undefined";
  if (value instanceof Uint8Array) return "Uint8Array[" + value.length + "]";
  if (ArrayBuffer.isView(value)) return value.constructor?.name + "[" + value.byteLength + "]";
  if (typeof value !== "object") return typeof value + "(" + String(value).slice(0, 80) + ")";
  if (Array.isArray(value)) return "array[" + value.length + "] 首元素=" + describeShape(value[0]);
  return Object.entries(value)
    .slice(0, 12)
    .map(([k, v]) => k + "=" + describeShape(v))
    .join(", ");
}

/** 在整段文本里倒着找最近一条 model_change。 */
function findModelChangeInText(text) {
  if (typeof text !== "string" || !text) return null;
  const lines = text.split("\n");
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const found = parseModelChangeLine(lines[index]);
    if (found) return found;
  }
  return null;
}

/**
 * 用宿主 resources 接口读当前会话的模型标识。
 * 先列会话目录按 sessionId 定位文件，再读内容找 model_change。
 * 任何一步失败都返回 null 并静默——峰谷功能据此自动不播报，不影响对话。
 * @param {object} resources ctx.resources
 * @param {{agentId: string, sessionId: string}} target
 */
export async function readLatestModelChangeViaResources(resources, { agentId, sessionId, sessionsRoot } = {}) {
  const agent = String(agentId || "").trim();
  const session = String(sessionId || "").trim();
  if (!resources || !agent || !session) return null;

  // sessionsRoot 只给测试用；实机固定走用户主目录下的 agents/<伙伴>/sessions。
  const dir = sessionsRoot ? path.join(sessionsRoot, agent, "sessions") : sessionsDirOf(agent);
  if (!dir) return null;

  const cacheKey = `${agent}|${session}`;
  let entry = resourcesCache.get(cacheKey) || { file: "", size: -1, model: null };

  try {
    if (!entry.file) {
      const listed = await resources.list({ kind: "local-file", path: dir });
      const items = pickItems(listed);
      // 关键：list 会把 junction 解析成真实路径并随结果一起还回来（如 C:\Users\…\.hanako → D:\HanaHome\.hanako）。
      // 后续 read 必须用它给的这个真实路径，不能拿自己拼的 C:\ 路径去读，否则 read 直接失败。
      const realDir = listed?.resource?.path || listed?.resource?.filePath || dir;
      const hit = items.find((item) => item && !item.isDirectory && typeof item.name === "string" && item.name.includes(session));
      if (!hit) {
        // 目录列了但没这个会话：可能是刚创建还没落盘，下次再试，不要写死缓存。
        return entry.model;
      }
      entry = { file: path.join(realDir, hit.name), size: Number(hit.size ?? -1), model: null };
    }

    const raw = await resources.read({ kind: "local-file", path: entry.file });
    const text = extractText(raw);
    const found = findModelChangeInText(text);
    if (!found) {
      logWarn(`会话档案里没找到 model_change：${path.basename(entry.file)} | read 返回形状：${describeShape(raw)}`);
    }
    // 没找到就沿用上一次的结果：同一份档案里 model_change 不会消失。
    if (found) entry.model = found;
    if (resourcesCache.size >= CACHE_LIMIT) resourcesCache.delete(resourcesCache.keys().next().value);
    resourcesCache.set(cacheKey, entry);
    return entry.model;
  } catch (error) {
    // 权限未授、文件正被写、路径不对——都按拿不到处理，但要说出来，不然静默到天荒地老。
    logWarn(`读会话模型失败：${error?.message || error}`);
    return entry.model;
  }
}