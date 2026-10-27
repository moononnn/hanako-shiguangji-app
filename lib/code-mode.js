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

// ── 按伙伴单独调 ──
//
// 上面那套是「全局默认」，Code 页原先只认这一份。真用起来会想「这位伙伴带天气、
// 那位不带」，所以再给每个伙伴留一份**稀疏**覆盖：只写动手改过的那几项，
// 没写的继续跟全局走（存盘里也不替没动手的字段写值）。
// 总闸 codeInjectionEnabled 仍压在所有伙伴头上：一关，谁都别带。

/** 原型链上的危险键：不许当伙伴 ID 进门，免得写进去改的是对象原型。 */
export const BLOCKED_CODE_AGENT_IDS = Object.freeze(["__proto__", "constructor", "prototype"]);

function isPlainObject(value) {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

/** 只读对象自有的键：原型链上来的值一律不算数。 */
function ownValue(source, key) {
  return source && Object.prototype.hasOwnProperty.call(source, key) ? source[key] : undefined;
}

/** 伙伴 ID 收敛：空白、危险键都不认，认不出返回空串（= 跟全局走）。 */
export function normalizeCodeAgentId(value) {
  const id = String(value == null ? "" : value).trim();
  if (!id || BLOCKED_CODE_AGENT_IDS.includes(id)) return "";
  return id;
}

/**
 * 单个伙伴的覆盖收敛成稀疏对象：只留认得出的字段，认不出的直接丢掉。
 * 空对象表示「没动手改」，调用方当没有覆盖处理。
 */
export function normalizeCodeAgentOverride(value) {
  const result = {};
  if (!isPlainObject(value)) return result;
  const enabled = ownValue(value, "enabled");
  if (typeof enabled === "boolean") result.enabled = enabled;
  const rawItems = ownValue(value, "items");
  if (isPlainObject(rawItems)) {
    const items = {};
    for (const id of CODE_INJECTION_ITEM_IDS) {
      const on = ownValue(rawItems, id);
      if (typeof on === "boolean") items[id] = on;
    }
    if (Object.keys(items).length) result.items = items;
  }
  const rawMode = ownValue(value, "mode");
  if (typeof rawMode === "string") {
    const mode = rawMode.trim().toLowerCase();
    if (CODE_INJECT_MODES.includes(mode)) result.mode = mode;
  }
  const rawInterval = ownValue(value, "intervalHours");
  if ((typeof rawInterval === "number" && Number.isFinite(rawInterval)) || (typeof rawInterval === "string" && rawInterval.trim())) {
    const hours = Number(rawInterval);
    if (VALID_CODE_INJECT_INTERVAL_HOURS.includes(hours)) result.intervalHours = hours;
  }
  return result;
}

/**
 * 整张「按伙伴」的表收敛：agentId -> 稀疏覆盖。
 * 危险键、非法形状、收敛后为空的条目都不进门；旧配置空表得到空对象（行为不变）。
 */
export function normalizeCodeAgentSettings(value) {
  const result = {};
  if (!isPlainObject(value)) return result;
  for (const key of Object.keys(value)) {
    const agentId = normalizeCodeAgentId(key);
    if (!agentId) continue;
    const override = normalizeCodeAgentOverride(ownValue(value, key));
    if (Object.keys(override).length) result[agentId] = override;
  }
  return result;
}

/** 取某个伙伴的稀疏覆盖；没有这份覆盖就返回 null（继续跟全局）。 */
export function codeAgentOverrideFor(settings, agentId = "") {
  const id = normalizeCodeAgentId(agentId);
  if (!id) return null;
  const map = isPlainObject(settings) ? ownValue(settings, "codeAgentSettings") : undefined;
  if (!isPlainObject(map) || !Object.prototype.hasOwnProperty.call(map, id)) return null;
  const override = normalizeCodeAgentOverride(ownValue(map, id));
  return Object.keys(override).length ? override : null;
}

/**
 * Code 页这一轮到底带不带、带哪些、多久带一次。
 * 总闸关掉就一个字都不带，连峰谷也停。
 *
 * 第二个参数是当前伙伴的 agentId：给了就叠上这位伙伴的稀疏覆盖，
 * 不给（或这位伙伴没单独设置过）就是原来那份全局结果，形状不变。
 */
export function resolveCodeInjection(settings = {}, agentId = "") {
  const source = isPlainObject(settings) ? settings : {};
  const override = codeAgentOverrideFor(source, agentId);
  const globalItems = normalizeCodeInjectionItems(source.codeInjectionItems);
  return {
    // 总闸压在所有伙伴头上：全局关就是关，伙伴自己的开关只能再关一次，不能反过来打开。
    enabled: source.codeInjectionEnabled !== false && override?.enabled !== false,
    // 内容是「全局 + 这位伙伴改过的那几项」，没改过的项跟全局。
    items: override?.items ? normalizeCodeInjectionItems({ ...globalItems, ...override.items }) : globalItems,
    // 方式和间隔：这位伙伴设过合法值就用它，没设过跟全局。
    mode: override?.mode || normalizeCodeInjectMode(source.codeInjectMode),
    intervalHours: override?.intervalHours !== undefined
      ? override.intervalHours
      : normalizeCodeInjectIntervalHours(source.codeInjectIntervalHours),
  };
}
