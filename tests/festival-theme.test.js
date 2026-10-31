// 拾光记 · 节日换肤测试
// 覆盖：主题判定（只认真节日当天）、主题表结构与背景图资源、两个页面的换肤脚本行为。
// 不触碰真实用户数据。
process.env.TZ = "Asia/Shanghai";

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

import { getFestivalTheme, listFestivalThemeNames } from "../lib/festival-themes.js";

const APP_DIR = path.resolve(".");

/** 造一个够用的 documentElement 假件，记录脚本写进来的属性和 CSS 变量。 */
function fakeRoot() {
  const attrs = new Map();
  const vars = new Map();
  return {
    attrs,
    vars,
    getAttribute: (name) => (attrs.has(name) ? attrs.get(name) : null),
    setAttribute: (name, value) => attrs.set(name, String(value)),
    removeAttribute: (name) => attrs.delete(name),
    style: {
      setProperty: (name, value) => vars.set(name, String(value)),
      removeProperty: (name) => vars.delete(name),
    },
  };
}

/** 从页面 HTML 里切出换肤那段脚本，在假沙箱里跑起来。 */
function loadThemeScript(html, startMarker, endMarker) {
  const start = html.indexOf(startMarker);
  const end = html.indexOf(endMarker);
  assert.ok(start >= 0, `页面里找不到换肤脚本起点：${startMarker}`);
  assert.ok(end > start, `页面里找不到换肤脚本终点：${endMarker}`);
  const code = html.slice(start, end);
  const root = fakeRoot();
  const sandbox = {
    document: { documentElement: root },
    setTimeout: (fn) => fn(),
  };
  const run = new Function("document", "window", "setTimeout", code + "\nreturn { applyFestivalTheme: applyFestivalTheme, paintFestivalTheme: paintFestivalTheme, state: function () { return festivalTheme; } };");
  return { root, api: run(sandbox.document, undefined, sandbox.setTimeout) };
}

test("主题判定：只认真节日当天，假期里的其余日子不换肤", () => {
  const festivalDay = getFestivalTheme(new Date("2026-02-17T00:00:00"));
  assert.ok(festivalDay, "2026 春节正日子该有主题");
  assert.equal(festivalDay.key, "chunjie");
  assert.equal(festivalDay.festivalName, "春节");
  assert.equal(festivalDay.kind, "legal");

  // 春节假期区间内的非正日子：名字是「春节假期」，不换肤
  const holiday = getFestivalTheme(new Date("2026-02-18T00:00:00"));
  assert.equal(holiday, null, "假期第二天不该换肤，否则整个长假天天变色");

  // 农历春节（没有法定安排的那一年）也要认
  const lunar = getFestivalTheme(new Date("2027-02-06T00:00:00"));
  assert.ok(lunar, "2027 春节按农历表也要有主题");
  assert.equal(lunar.key, "chunjie");

  // 平常日子没有主题
  assert.equal(getFestivalTheme(new Date("2026-10-31T00:00:00")), null, "万圣节没配主题就不该换肤");
});

test("主题表：每个节日都要有明暗两套配色和两张背景图，背景图文件得真的在", () => {
  const names = listFestivalThemeNames();
  assert.ok(names.includes("春节"), "春节该在主题表里");
  for (const name of names) {
    const theme = getFestivalTheme(new Date("2026-02-17T00:00:00"));
    assert.ok(theme.palette.light && theme.palette.dark, `${name} 要有明暗两套配色`);
    for (const key of ["--bg", "--card", "--ink", "--primary", "--accent", "--line"]) {
      assert.ok(theme.palette.light[key], `${name} 亮色缺 ${key}`);
      assert.ok(theme.palette.dark[key], `${name} 暗色缺 ${key}`);
    }
    for (const mode of ["light", "dark"]) {
      const rel = theme.background[mode];
      assert.ok(rel, `${name} 缺 ${mode} 背景图`);
      // 静态资源的根是 App 的 ui/ 目录（宿主把 /panel.html 映射到 ui/panel.html）
      const file = path.join(APP_DIR, "ui", rel);
      assert.ok(fs.existsSync(file), `${mode} 背景图不在 ui/ 下：${file}`);
      assert.ok(fs.statSync(file).size > 0, `${mode} 背景图是空的`);
    }
  }
});

test("主页面：有节日就上色上背景，没节日就干净退回", () => {
  const html = fs.readFileSync(path.join(APP_DIR, "ui", "panel.html"), "utf8");
  const { root, api } = loadThemeScript(html, "var festivalTheme = null;", "/* ── 今日概览 ── */");

  assert.equal(root.getAttribute("data-festival-theme"), null, "一开始不该有主题");
  assert.equal(root.vars.size, 0, "一开始不该写变量");

  const theme = getFestivalTheme(new Date("2026-02-17T00:00:00"));
  api.applyFestivalTheme(theme);
  assert.equal(root.getAttribute("data-festival-theme"), "chunjie");
  assert.equal(root.vars.get("--primary"), "#c0574d", "亮色主色要写进内联变量");
  assert.match(String(root.vars.get("--fest-bg")), /assets\/festivals\/chunjie\/light\.webp/);
  assert.match(html, /html\[data-festival-theme\] body::before/, "背景那层纸要有节日规则");

  // 切到暗色：同一套主题要换成暗色那一份
  root.setAttribute("data-appearance", "dark");
  api.paintFestivalTheme();
  assert.equal(root.vars.get("--primary"), "#cf6b5f", "暗色主色要跟上");
  assert.match(String(root.vars.get("--fest-bg")), /dark\.webp/);

  // 节日过了：清干净，别留着上一次的变量
  api.applyFestivalTheme(null);
  assert.equal(root.getAttribute("data-festival-theme"), null);
  assert.equal(root.vars.size, 0, "撤掉主题后变量要清干净");
});

test("门厅：跟主页面一样认主题", () => {
  const html = fs.readFileSync(path.join(APP_DIR, "ui", "hall.html"), "utf8");
  const { root, api } = loadThemeScript(html, "var festivalTheme = null;", "function renderFests(builtin) {");
  api.applyFestivalTheme(getFestivalTheme(new Date("2026-02-17T00:00:00")));
  assert.equal(root.getAttribute("data-festival-theme"), "chunjie");
  assert.equal(root.vars.get("--bg"), "#fbf1e7");
  assert.match(html, /html\[data-festival-theme\] body::before/, "门厅也要有背景那层纸");
  assert.match(html, /applyFestivalTheme\(day\.festivalTheme \|\| null\)/, "门厅拿到当天数据后要应用主题");
});

test("后端：当天接口带上主题字段，翻历史日期不带", () => {
  const src = fs.readFileSync(path.join(APP_DIR, "routes", "ui.js"), "utf8");
  assert.match(src, /festivalTheme: dk === today \? getFestivalTheme\(d\) : null/,
    "只有当天才给主题，翻历史不改配色");
});
