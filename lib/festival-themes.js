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
        "--ink": "#332c26",
        "--muted": "#8e7c69",
        "--primary": "#c8402f",
        "--primary-light": "#e0796a",
        "--primary-deep": "#9c2a1c",
        "--primary-soft": "#f7ded5",
        "--accent": "#d8a43f",
        "--accent-light": "#ecc979",
        "--accent-deep": "#a87a17",
        "--accent-soft": "#f8ecd1",
        "--warm": "#dd9f6f",
        "--warm-light": "#e9cdab",
        "--warm-soft": "#f9ecdf",
        "--period": "#d16b76",
        "--period-soft": "#f8e4e7",
        "--line": "#f0dfcd",
        // 节日专属。四组东西：
        //  surface / surface-strong  卡片换成半透明暖纸，让底图的水彩透上来（大块薄、小件实）
        //  veil                     底图下缘的溶接渐变，颜色跟图自己的纸底对齐，接缝才不硬
        //  chip / today-cell / today-line / frame  头部按钮、今天那格、日历装裱的细件
        //  surface 的透明度不是随便写的：太透了字发漂，太实了底图看不见，.6 上下是实测好看的一档。
        "--fest-surface": "rgba(255, 248, 238, .88)",
        "--fest-surface-strong": "rgba(255, 251, 244, .93)",
        "--fest-line": "rgba(51, 44, 38, .34)",
        // 墨线：底图下缘那条收口的线。年画画到哪儿就一条线收住，线外面就是纸，
        // 原来这里是一条 33.4vw 高的渐变，把图柔柔溶进纸色里，那是水彩的语法。
        "--fest-rule": "rgba(51, 44, 38, .72)",
        "--fest-rule-thin": "rgba(200, 64, 47, .55)",
        "--fest-today-grad": "rgba(255, 249, 241, .9)",
        "--fest-today-cell": "#c8402f",
        "--fest-today-line": "#9c2a1c",
        // 底图下缘最终落的那个纸色。body::before 这一层的 background-color 要用它，
        // 不能用 --bg：图高只有 33.4vw，图以外的地方是这层底色，两者差一点就会看到一条横线。
        "--fest-paper": "#fbf2e4",
        "--fest-chip": "rgba(255, 251, 244, .72)",
        "--fest-frame-soft": "rgba(255, 246, 232, .5)",
        "--fest-sub-ink": "#87735f",
      },
      dark: {
        "--bg": "#1d1917",
        "--card": "#26211d",
        "--ink": "#efe6d4",
        "--muted": "#a3937c",
        "--primary": "#d1584a",
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
        "--fest-surface": "rgba(48, 40, 35, .86)",
        "--fest-surface-strong": "rgba(56, 47, 41, .9)",
        "--fest-line": "rgba(239, 230, 212, .28)",
        "--fest-rule": "rgba(239, 230, 212, .6)",
        "--fest-rule-thin": "rgba(209, 88, 74, .45)",
        "--fest-today-grad": "rgba(52, 42, 37, .88)",
        "--fest-today-cell": "rgba(94, 62, 47, .5)",
        "--fest-today-line": "#7d5a45",
        "--fest-paper": "#2a221a",
        "--fest-chip": "rgba(52, 43, 38, .78)",
        "--fest-frame-soft": "rgba(72, 58, 45, .35)",
        "--fest-sub-ink": "#b3a390",
      },
    },
    background: {
      light: "assets/festivals/chunjie/light.webp",
      dark: "assets/festivals/chunjie/dark.webp",
      // 门厅是竖条窗口（宽三四百、高七八百），横披 cover 进去只剩中间一块空纸。
      // 两张竖版是单画给门厅的：门笺横排只压顶部，两缘各一条回纹带贯穿全高。
      hall: {
        light: "assets/festivals/chunjie/hall-light.webp",
        dark: "assets/festivals/chunjie/hall-dark.webp",
      },
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
