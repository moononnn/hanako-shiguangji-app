// 拾光记 · Code 页注入配置
//
// Code 页是干活的地方，塞个人生活情境（日记、生理期、做好的回顾）只会变成噪音。
// 所以这里列一份「可以带什么」的清单，勾上的才带，
// 再加一个总闸一键关掉 Code 页所有注入词。
//
// 频率不再给 Code 开特例：聊天窗口能选「适时 / 相伴 / 常在」和回来多久后更新，
// Code 页用同一套判定、同一套语义，只是各存各的值（聊天那屏和 Code 那屏本来就各管各的）。
// 时间也在这份清单里——以前它是底子，每轮都带，谁都关不掉。
//
// 纯数据 + 纯函数，不依赖任何 store，data.js / 扩展 / 路由 / 页面都能直接引。

/** Code 页可选的注入项；总闸一关，全都不带。 */
export const CODE_INJECTION_ITEMS = Object.freeze([
  { id: "time", label: "当前时间" },
  { id: "peak", label: "峰谷关照" },
  { id: "weather", label: "窗外天气" },
  { id: "special", label: "今天是什么日子" },
  { id: "todos", label: "今日待办" },
  { id: "archive", label: "近期动态" },
  { id: "xingji", label: "拾性的做法" },
]);

export const CODE_INJECTION_ITEM_IDS = Object.freeze(CODE_INJECTION_ITEMS.map((item) => item.id));

/** Code 页的带入方式，和聊天窗口同一套语义。 */
export const CODE_INJECT_MODES = Object.freeze(["economical", "balanced", "always"]);
export const DEFAULT_CODE_INJECT_MODE = "balanced";

/** Code 页可选的刷新间隔（小时），和聊天窗口同一组档位。 */
export const VALID_CODE_INJECT_INTERVAL_HOURS = Object.freeze([0.5, 1, 4, 8]);
export const DEFAULT_CODE_INJECT_INTERVAL_HOURS = 4;

/** 把存盘里的带入方式收敛成合法值。写坏了按默认的「相伴」算。 */
export function normalizeCodeInjectMode(value) {
  const mode = String(value || "").trim().toLowerCase();
  return CODE_INJECT_MODES.includes(mode) ? mode : DEFAULT_CODE_INJECT_MODE;
}

/** 把存盘里的间隔收敛成合法档位；写坏了按 4 小时算。 */
export function normalizeCodeInjectIntervalHours(value) {
  const hours = Number(value);
  return VALID_CODE_INJECT_INTERVAL_HOURS.includes(hours) ? hours : DEFAULT_CODE_INJECT_INTERVAL_HOURS;
}

// 默认带当前时间和峰谷：Code 页里最常见的话是「这段怎么改」，
// 知道现在几点、这会儿贵不贵就够了；日记、生理期、做好的回顾一概不进。
export const DEFAULT_CODE_INJECTION_ITEMS = Object.freeze({
  time: true,
  peak: true,
  weather: false,
  special: false,
  todos: false,
  archive: false,
  xingji: false,
});

/**
 * 把存盘里的注入项收敛成固定形状：只认清单里的 id、只认布尔值，
 * 缺的键按默认补。写坏了也不会让注入端崩。
 */
export function normalizeCodeInjectionItems(value) {
  const result = { ...DEFAULT_CODE_INJECTION_ITEMS };
  if (!value || typeof value !== "object" || Array.isArray(value)) return result;
  for (const id of CODE_INJECTION_ITEM_IDS) {
    if (typeof value[id] === "boolean") result[id] = value[id];
  }
  return result;
}

/** 某一项是否开着（默认值参与判定）。 */
export function isCodeItemOn(items, id) {
  return normalizeCodeInjectionItems(items)[id] === true;
}

// ── 按伙伴单独关 ──
//
// 能按伙伴分开的只有一件事：关不关。带哪些、多久带一次全听上面那份全局设置，
// 不再给单个伙伴留一份参数覆盖（那套逐伙伴参数编辑已经撤掉，旧表只用来迁移屏蔽）。
// 名单与聊天窗口的 injectionDisabledAgentIds 是两份，互不相干；
// 总闸 codeInjectionEnabled 仍压在所有伙伴头上：一关，名单里有没有人都一样。

/** 原型链上的危险键：不许当伙伴 ID 进门，免得写进去改的是对象原型。 */
export const BLOCKED_CODE_AGENT_IDS = Object.freeze(["__proto__", "constructor", "prototype"]);

function isPlainObject(value) {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

/** 只读对象自有的键：原型链上来的值一律不算数。 */
function ownValue(source, key) {
  return source && Object.prototype.hasOwnProperty.call(source, key) ? source[key] : undefined;
}

/** 伙伴 ID 收敛：只认字符串、去空白，危险键不收；认不出返回空串。 */
function normalizeDisabledAgentId(value) {
  if (typeof value !== "string") return "";
  const id = value.trim();
  if (!id || BLOCKED_CODE_AGENT_IDS.includes(id)) return "";
  return id;
}

/**
 * 名单收敛：只收字符串 ID，去空白、去重，保留首次出现的顺序。
 * 对象、数字这些一律不当 ID；写坏了得到空名单，注入端照样能跑。
 */
export function normalizeCodeInjectionDisabledAgentIds(value) {
  const result = [];
  if (!Array.isArray(value)) return result;
  for (const raw of value) {
    const id = normalizeDisabledAgentId(raw);
    if (id && !result.includes(id)) result.push(id);
  }
  return result;
}

/**
 * 旧配置 codeAgentSettings 只搬「enabled === false」这一件事。
 * 旧表里的 items / mode / intervalHours 一概不认——那套逐伙伴参数已经撤掉。
 */
function legacyCodeAgentDisabledIds(value) {
  const result = [];
  if (!isPlainObject(value)) return result;
  for (const key of Object.keys(value)) {
    const id = normalizeDisabledAgentId(key);
    if (!id || result.includes(id)) continue;
    const entry = ownValue(value, key);
    if (isPlainObject(entry) && ownValue(entry, "enabled") === false) result.push(id);
  }
  return result;
}

/**
 * 读 Code 页的屏蔽名单。
 * 新字段 codeInjectionDisabledAgentIds 只要是数组（哪怕 []）就以它为准：
 * 用户解除某位伙伴的屏蔽之后，绝不能因为旧表里还留着 enabled:false 又把人合回来。
 * 只有新字段缺失（或根本不是数组，等于旧配置）时，才从旧表迁一次屏蔽。
 */
export function readCodeInjectionDisabledAgentIds(settings = {}) {
  const source = isPlainObject(settings) ? settings : {};
  const raw = ownValue(source, "codeInjectionDisabledAgentIds");
  if (Array.isArray(raw)) return normalizeCodeInjectionDisabledAgentIds(raw);
  return legacyCodeAgentDisabledIds(ownValue(source, "codeAgentSettings"));
}

/**
 * Code 页这一轮到底带不带、带哪些、多久带一次。
 * 总闸关掉或这位伙伴在名单里就一个字都不带，连峰谷也停；
 * 内容和频率始终来自全局设置，给不给 agentId 都不改这几项。
 */
export function resolveCodeInjection(settings = {}, agentId = "") {
  const source = isPlainObject(settings) ? settings : {};
  const id = typeof agentId === "string" ? agentId.trim() : "";
  const disabled = id ? readCodeInjectionDisabledAgentIds(source) : [];
  return {
    enabled: source.codeInjectionEnabled !== false && !(id && disabled.includes(id)),
    items: normalizeCodeInjectionItems(source.codeInjectionItems),
    mode: normalizeCodeInjectMode(source.codeInjectMode),
    intervalHours: normalizeCodeInjectIntervalHours(source.codeInjectIntervalHours),
  };
}
