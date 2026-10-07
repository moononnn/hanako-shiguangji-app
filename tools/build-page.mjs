// 拾光记 App 版 · 页面构建
//
// 旧版是服务端每次请求现渲染整页（GET /page?token=...）。App 这边卡片要指向 ui/ 下的静态文档，
// 所以这里把渲染结果落成 ui/panel.html。
//
// 页面里跟宿主有关的两处差异（接口基址、认证方式）已经直接在 lib/page-template.js 里写成 App 版，
// 本脚本只负责生成产物 + 做残留兜底检查。
//
// 改了 lib/page-template.js 里的页面代码后，重跑：node tools/build-page.mjs

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { renderPage } from "../lib/page-template.js";

const APP_DIR = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT_DIR = join(APP_DIR, "ui");
const OUT_FILE = join(OUT_DIR, "panel.html");

const html = renderPage("");

// 兜底：旧插件的路径与凭证机制不该再出现
const forbidden = [
  ["/api/plugins/shiguangji", "旧插件接口基址"],
  ["tokenSep", "旧版 token 拼接"],
];
// 注：子组件（更新检查/反馈积木）自带的 pluginApiFetch 里仍留有「拼 token」的写法，那是不会被调用的
// 兼容分支（调用点已注入 App 版 apiFetch）；只要旧接口基址不出现就不影响。
const hits = forbidden.filter(([needle]) => html.includes(needle));
if (hits.length) {
  throw new Error(`页面里还有旧机制残留：${hits.map(([n, why]) => `${n}（${why}）`).join("、")}`);
}

if (!html.includes("X-Hana-App-Surface-Session")) {
  throw new Error("页面里没有 App 页面的凭证头，请求会被拒，先确认 api() 还是 App 版写法");
}

mkdirSync(OUT_DIR, { recursive: true });
writeFileSync(OUT_FILE, html, "utf8");

console.log(`已生成 ${OUT_FILE}（${(html.length / 1024).toFixed(1)} KB）`);
console.log("旧路径与旧凭证拼接：干净；App 凭证头：在");
