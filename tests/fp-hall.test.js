// 拾光记 · 左侧门厅（功能面板）测试
// 覆盖：清单声明、门厅页面文件与脚本、主页面接信号的派发、后端信号的存取与白名单。
// 不触碰真实用户数据：只读源码与清单，页面脚本仅解析不执行。
process.env.TZ = "Asia/Shanghai";

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const APP_DIR = path.resolve(".");
const MANIFEST = JSON.parse(fs.readFileSync(path.join(APP_DIR, "manifest.json"), "utf8"));
const ACTIONS = ["calendar", "summary", "moodline", "period"];

test("清单：整页卡把功能面板指向门厅", () => {
  const card = MANIFEST.contributes.cards.find((c) => c.id === "calendar");
  assert.ok(card, "应有 calendar 整页卡");
  assert.equal(card.fpFullPanel, true, "整页卡应独占功能面板");
  assert.ok(card.functionPanel, "应声明 functionPanel，否则左侧会留成空态");
  assert.equal(card.functionPanel.id, "hall");
  assert.equal(card.functionPanel.route, "/hall.html");
  assert.ok(fs.existsSync(path.join(APP_DIR, "ui", "hall.html")), "门厅页面文件要存在");
});

test("门厅：脚本可解析，点位与自动刷新都在", () => {
  const html = fs.readFileSync(path.join(APP_DIR, "ui", "hall.html"), "utf8");
  const scripts = [...html.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
  assert.ok(scripts.length >= 1, "门厅应有内联脚本");
  for (const code of scripts) new Function(code);
  ACTIONS.forEach((action) => {
    assert.match(html, new RegExp('data-action="' + action + '"'), "缺入口：" + action);
  });
  assert.match(html, /data-action="settings"/, "设置入口应在");
  assert.match(html, /api\/fp-signal/, "点位要发给 App 自己的后端");
  assert.match(html, /X-Hana-App-Surface-Session/, "请求要带 App 页面凭证");
  assert.match(html, /setInterval\(load/, "门厅要能自己刷新");
  assert.match(html, /data-repeat-complete/, "周期欠账要提供整组批量处理入口");
  assert.match(html, /complete-overdue/, "批量勾选要走独立的完成接口");
  assert.match(html, /没做的别一起勾/, "展开后要提醒只勾确实完成的日期");
});

// 回归锁：v0.0.40/v0.0.41 的门厅把四个入口写死，不认「生理期」开关，
// 用户在设置里关掉后左侧入口还在，点进去是空的（issue #2）。
// 断言只钉行为（认不认开关、入口会不会消失），不钉函数名，免得以后重构就假红。
test("门厅：入口要跟着「生理期」开关消失", () => {
  const html = fs.readFileSync(path.join(APP_DIR, "ui", "hall.html"), "utf8");
  assert.match(html, /api\/settings/, "门厅要读设置，才知道开关关了没");
  assert.match(html, /showPeriod/, "门厅要按 showPeriod 判断生理期入口的显隐");
  assert.match(html, /data-action="period"/, "生理期入口应在");
  assert.match(html, /classList\.toggle\(\s*['"]hidden['"]/, "入口要能整体隐藏");
  // 设置是在主页那边改的，门厅主轮询 60 秒太长，得单独盯开关
  assert.match(html, /api\/settings[\s\S]{0,400}setInterval|setInterval[\s\S]{0,400}api\/settings/,
    "门厅要单独盯设置，否则关完开关要等一分钟才生效");
});

test("门厅：待办可点完成，且完成后通知主页面刷新", () => {
  const html = fs.readFileSync(path.join(APP_DIR, "ui", "hall.html"), "utf8");
  assert.match(html, /data-todo-id/, "待办要带 id 才能勾");
  assert.match(html, /\/toggle/, "门厅要能直接调勾选接口");
  assert.match(html, /signal\(\s*['"]refresh['"]\s*\)/, "勾完要通知主页面刷新，别让两边显示不一样");
});

test("主页面：能接住门厅的信号并派发到对应动作", async () => {
  const { renderPage } = await import("../lib/page-template.js");
  const html = renderPage("test-token");
  const script = html.split("<script>").slice(1)
    .map((part) => part.split("</script>")[0])
    .find((part) => part.includes("function loadMonth"));
  assert.ok(script, "页面主脚本应包含 loadMonth");
  assert.match(script, /function runFpSignal/);
  assert.match(script, /api\/fp-signal\?since=/, "要按时间戳取新信号，不能重复执行旧的");
  assert.match(script, /openSettingsModal\(\)/);
  assert.match(script, /switchTab\('summary'\)/);
  assert.match(script, /switchTab\('moodline'\)/);
  assert.match(script, /togglePeriodPattern\(\)/);
  assert.match(script, /action === ['"]refresh['"]/, "要能接门厅勾完待办后的刷新指令");
});

test("后端：信号只认白名单动作，取走要带时间戳", () => {
  const src = fs.readFileSync(path.join(APP_DIR, "routes", "ui.js"), "utf8");
  assert.match(src, /const FP_SIGNAL_ACTIONS = new Set\(/);
  assert.match(src, /app\.post\("\/api\/fp-signal"/);
  assert.match(src, /app\.get\("\/api\/fp-signal"/);
  assert.match(src, /不认识的指令/);
  assert.match(src, /fpSignal\.at > since/);
  const line = src.match(/const FP_SIGNAL_ACTIONS = new Set\(([^)]*)\)/);
  assert.ok(line, "应有信号白名单");
  assert.match(line[1], /["']refresh["']/, "白名单要认 refresh，否则门厅勾完待办主页不会跟着更新");
});
