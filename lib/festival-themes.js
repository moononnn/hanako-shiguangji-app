// 拾光记 · 节日主题表
//
// 干什么用：某一天正好是某个节日，就把整页换成那个节日的配色和背景图。
// 判定走 festivals.js（现成的节日库），这里只管「这个节日长什么样」。
//
// 三条纪律：
//  1. **不重复造节日表**。节日什么时候是哪个日子，festivals.js 说了算。
//  2. **整个假期都用同一个节日的主题**。法定假期是一段区间（春节那七天），
//     区间里每一天都该是春节的样子；只有正日子才叫「春节」，其余天叫「春节假期」，
//     但换肤按本节日算，不按当天的名字算。
//  3. **配色只给 CSS 变量**。页面把这里的值写成 CSS 变量，结构、字号、圆角一律不动，
//     换肤是「换纸」，不是「换皮」。
//
// 加一个新节日 = 在 FESTIVAL_THEMES 里加一条 + 往 assets/festivals/<key>/ 放两张背景图，
// 页面代码一行都不用改。

import { getBuiltinFestivals } from "./festivals.js";

/**
 * 主题表。key 是节日名（跟 festivals.js 里的 name 对齐）。
 * palette 用 CSS 变量名做键，页面直接 setProperty，变量名写错不会静默失效（值会原样落上去，
 * 只是没生效），比维护一份映射表省事。
 * background 是相对 App 根目录的路径，页面按它铺背景。
 */
export const FESTIVAL_THEMES = {
  "春节": {
    key: "chunjie",
    title: "春节",
    emoji: "🧧",
    palette: {
      light: {
        "--bg": "#fbf1e7",
        "--card": "#fffdf9",
        "--ink": "#4b3f36",
        "--muted": "#9b8975",
        "--primary": "#c0574d",
        "--primary-light": "#e09a90",
        "--primary-deep": "#9c3d35",
        "--primary-soft": "#f7e2dc",
        "--accent": "#d8a43f",
        "--accent-light": "#ecc979",
        "--accent-deep": "#a87a17",
        "--accent-soft": "#f8ecd1",
        "--warm": "#dd9f6f",
        "--warm-light": "#e9cdab",
        "--warm-soft": "#f9ecdf",
        "--period": "#d98a96",
        "--period-soft": "#f8e4e7",
        "--line": "#f0dfcd",
        // 节日专属：把平时的实白换成半透明纸面，让背景的水彩透上来。
        // 大块用 surface（薄），小件用 surface-strong（实一点，文字才清楚）。
        "--fest-surface": "rgba(255, 251, 240, .9)",
        "--fest-surface-strong": "rgba(255, 253, 247, .96)",
        "--fest-today-grad": "linear-gradient(135deg, rgba(255, 245, 235, .96) 0%, rgba(250, 233, 222, .92) 70%)",
      },
      dark: {
        "--bg": "#1d1917",
        "--card": "#26211d",
        "--ink": "#e9dfcd",
        "--muted": "#a3937c",
        "--primary": "#cf6b5f",
        "--primary-light": "#e8a196",
        "--primary-deep": "#f0b0a4",
        "--primary-soft": "#3a2723",
        "--accent": "#d5a44a",
        "--accent-light": "#e8c983",
        "--accent-deep": "#f0d090",
        "--accent-soft": "#3a2f1b",
        "--warm": "#d9a06f",
        "--warm-light": "#e8cdab",
        "--warm-soft": "#3a2f24",
        "--period": "#cf6b5f",
        "--period-soft": "#3a2723",
        "--line": "#39322a",
        "--fest-surface": "rgba(40, 35, 30, .88)",
        "--fest-surface-strong": "rgba(46, 40, 34, .94)",
        "--fest-today-grad": "linear-gradient(135deg, rgba(48, 38, 34, .94) 0%, rgba(38, 30, 28, .9) 70%)",
      },
    },
    background: {
      light: "assets/festivals/chunjie/light.webp",
      dark: "assets/festivals/chunjie/dark.webp",
    },
  },
};

/**
 * 取某天的节日主题。今天没有主题节日就返回 null。
 * 假期区间里的日子也算：名字是「春节假期」，按 baseName（春节）找主题。
 * @param {Date} date
 * @returns {{key:string,title:string,festivalName:string,emoji:string,kind:string,
 *            palette:{light:Object,dark:Object}, background:{light:string,dark:string}}|null}
 */
export function getFestivalTheme(date) {
  const list = getBuiltinFestivals(date);
  for (const f of list) {
    // 法定假期的名字可能是「春节假期」，正日子才叫「春节」；两种名字都试一遍。
    const theme = FESTIVAL_THEMES[f.name] || (f.baseName ? FESTIVAL_THEMES[f.baseName] : null);
    if (!theme) continue;
    return {
      key: theme.key,
      title: theme.title,
      festivalName: f.name,
      emoji: f.emoji,
      kind: f.kind,
      palette: theme.palette,
      background: theme.background,
    };
  }
  return null;
}

/** 主题表里有哪些节日（给设置页以后做「开关」用）。 */
export function listFestivalThemeNames() {
  return Object.keys(FESTIVAL_THEMES);
}

/**
 * 按 key 取主题，不看日期（设置页的「预览某个节日」用）。
 * @param {string} key
 */
export function getFestivalThemeByKey(key) {
  const theme = Object.values(FESTIVAL_THEMES).find((t) => t.key === key);
  if (!theme) return null;
  return {
    key: theme.key,
    title: theme.title,
    festivalName: theme.title,
    emoji: theme.emoji || "",
    kind: "preview",
    palette: theme.palette,
    background: theme.background,
  };
}
