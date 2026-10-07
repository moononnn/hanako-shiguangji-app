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
});

test("后端：信号只认白名单动作，取走要带时间戳", () => {
  const src = fs.readFileSync(path.join(APP_DIR, "routes", "ui.js"), "utf8");
  assert.match(src, /const FP_SIGNAL_ACTIONS = new Set\(/);
  assert.match(src, /app\.post\("\/api\/fp-signal"/);
  assert.match(src, /app\.get\("\/api\/fp-signal"/);
  assert.match(src, /不认识的指令/);
  assert.match(src, /fpSignal\.at > since/);
});
