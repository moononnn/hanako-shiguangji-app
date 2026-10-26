// 拾光记 · Code 页注入配置
//
// Code 页是干活的地方，塞个人生活情境（日记、生理期、做好的回顾）只会变成噪音。
// 所以这里单独列一份「可以带什么」的清单：时间永远带，其余按项开关，
// 再加一个总闸一键关掉 Code 页所有注入词。
//
// 纯数据 + 纯函数，不依赖任何 store，data.js / 扩展 / 路由 / 页面都能直接引。

/** Code 页可选的注入项；时间是底子，不在清单里，总闸一关连它一起停。 */
export const CODE_INJECTION_ITEMS = Object.freeze([
  { id: "peak", label: "峰谷关照" },
  { id: "weather", label: "窗外天气" },
  { id: "special", label: "今天是什么日子" },
  { id: "todos", label: "今日待办" },
  { id: "archive", label: "近期动态" },
  { id: "xingji", label: "拾性的做法" },
]);

export const CODE_INJECTION_ITEM_IDS = Object.freeze(CODE_INJECTION_ITEMS.map((item) => item.id));

// 默认只留峰谷：Code 页里最常见的话是「这段怎么改」，多说一句「现在几点了、这会儿贵不贵」就够。
export const DEFAULT_CODE_INJECTION_ITEMS = Object.freeze({
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
 * Code 页这一轮到底带不带、带哪些。
 * 总闸关掉就一个字都不带，连峰谷也停。
 */
export function resolveCodeInjection(settings = {}) {
  return {
    enabled: settings.codeInjectionEnabled !== false,
    items: normalizeCodeInjectionItems(settings.codeInjectionItems),
  };
}
