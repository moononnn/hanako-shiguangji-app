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

/**
 * Code 页这一轮到底带不带、带哪些、多久带一次。
 * 总闸关掉就一个字都不带，连峰谷也停。
 */
export function resolveCodeInjection(settings = {}) {
  return {
    enabled: settings.codeInjectionEnabled !== false,
    items: normalizeCodeInjectionItems(settings.codeInjectionItems),
    mode: normalizeCodeInjectMode(settings.codeInjectMode),
    intervalHours: normalizeCodeInjectIntervalHours(settings.codeInjectIntervalHours),
  };
}
