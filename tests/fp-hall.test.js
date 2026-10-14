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

test("门厅：常用目标选择伙伴后须确认开始，运行中显示动态状态", () => {
  const html = fs.readFileSync(path.join(APP_DIR, "ui", "hall.html"), "utf8");
  assert.match(html, /id="focus-quick-content"/);
  assert.match(html, /api\('api\/focus'\)/);
  assert.match(html, /api\('api\/focus\/favorites\/select'/);
  assert.match(html, /api\('api\/focus\/start'/);
  assert.match(html, /data-focus-goal/);
  assert.match(html, /data-focus-partner/);
  assert.match(html, /data-focus-confirm/);
  assert.match(html, /aria-pressed=/, "伙伴选择要能显示当前选中状态");
  assert.match(html, /focus-quick-partner\.is-selected/, "已选伙伴要有可见的选中样式");
  assert.match(html, /function chooseFocusQuickPartner/);
  assert.match(html, /favoriteGoals/);
  assert.match(html, /longBreakEnabled \? config\.longBreakEvery : 0/);
  assert.match(html, /function updateFocusQuickClock/);
  assert.match(html, /api\('api\/focus\/advance'/);
  assert.match(html, /focus-active-card/);
  assert.match(html, /data-action="focus"/);
  assert.match(html, /setInterval\(updateFocusQuickClock, 1000\)/);
  assert.match(html, /requestRevision !== focusQuickRevision/, "旧的读取响应不能覆盖刚开始或刚推进后的状态");
  assert.match(html, /focusQuickWarning/, "开始接口返回的提醒/陪伴警告不能被吞掉");
  assert.match(html, /focusQuickLoadError/, "状态同步失败时要明确标出旧快照");
  assert.match(html, /打开专注页调整详细设置/, "有常用目标时也要保留详细设置入口");
  assert.match(html, /focusQuickWarningSetId/, "提醒警告要随专注组切换清理");
  assert.match(html, /focusQuickConfigKey/, "目标设置轮询要能匹配当前标签");
  const clickHandler = html.slice(html.indexOf('function handleFocusQuickClick'), html.indexOf('function load()'));
  assert.match(clickHandler, /button = ev\.target\.closest\('\[data-focus-partner\]'\);\s*if \(button\) \{ chooseFocusQuickPartner\(button\.getAttribute\('data-focus-partner'\)\); return; \}/,
    "点伙伴只应更新选择状态，不应直接开始计时");
  assert.match(clickHandler, /button = ev\.target\.closest\('\[data-focus-confirm\]'\);\s*if \(button\) \{ startFocusQuick\(\); return; \}/,
    "只有点确认按钮才调用快捷开始");
  const startHandler = html.slice(html.indexOf('function startFocusQuick'));
  assert.match(startHandler, /!focusQuickPartnerChosen/, "未作选择不能进入快捷开始");
  assert.ok(startHandler.indexOf("api('api/focus/favorites/select'") < startHandler.indexOf("api('api/focus/start'"),
    "确认开始前要重读目标专属设置，避免沿用过期配置");
});

test("门厅：快捷计划摘要显示短休、长休时长与触发轮次", () => {
  const html = fs.readFileSync(path.join(APP_DIR, "ui", "hall.html"), "utf8");
  assert.match(html, /body\s*\{[^}]*font-size: 14px/);
  const textSizes = [...html.matchAll(/font-size:\s*([\d.]+)px/g)].map((match) => Number(match[1]));
  assert.ok(textSizes.every((size) => size >= 12), "窄栏正文和辅助文字不低于 12px");
  assert.match(html, /\.focus-quick-goal, \.focus-quick-partner, \.focus-quick-link \{[^}]*font-size: 12px/);
  assert.match(html, /\.focus-quick-config \{[^}]*font-size: 13px[^}]*white-space: pre-line/);
  assert.match(html, /\.focus-quick-choice \{[^}]*font-size: 13px[^}]*white-space: pre-line/);
  const helper = html.match(/function focusQuickConfigText\(config\) \{[\s\S]*?\n  \}/)?.[0];
  assert.ok(helper, "应有快捷计划摘要函数");
  const summary = new Function("config", helper + "\nreturn focusQuickConfigText(config);");
  assert.equal(summary({ focusMinutes: 45, totalRounds: 3, shortBreakMinutes: 7, longBreakEnabled: true, longBreakEvery: 2, longBreakMinutes: 20 }),
    "专注：45 分钟 × 3 轮\n短休：7 分钟（轮间，末轮后不休）\n长休：每隔 2 轮 · 20 分钟");
  assert.equal(summary({ focusMinutes: 25, totalRounds: 2, shortBreakMinutes: 5, longBreakEnabled: true, longBreakEvery: 2, longBreakMinutes: 15 }),
    "专注：25 分钟 × 2 轮\n短休：5 分钟（轮间，末轮后不休）\n长休：每隔 2 轮 · 15 分钟（本组不会触发）");
  assert.equal(summary({ focusMinutes: 25, totalRounds: 1, shortBreakMinutes: 5, longBreakEnabled: false, longBreakEvery: 2, longBreakMinutes: 15 }),
    "专注：25 分钟 × 1 轮\n短休：5 分钟（本组不会触发）\n长休：关闭");
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
  assert.match(script, /Array\.isArray\(res\.signals\)/, "短时间连续动作要按序逐个派发，不能互相覆盖");
  assert.match(script, /signals\.forEach\(function \(signal\)/);
  assert.match(script, /openSettingsModal\(\)/);
  assert.match(script, /switchTab\('focus'\)/);
  assert.match(script, /switchTab\('summary'\)/);
  assert.match(script, /switchTab\('moodline'\)/);
  assert.match(script, /togglePeriodPattern\(\)/);
  assert.match(script, /action === ['"]refresh['"]/, "要能接门厅勾完待办后的刷新指令");
});

test("后端：信号只认白名单动作，连续信号按序返回", () => {
  const src = fs.readFileSync(path.join(APP_DIR, "routes", "ui.js"), "utf8");
  assert.match(src, /const FP_SIGNAL_ACTIONS = new Set\(/);
  assert.match(src, /app\.post\("\/api\/fp-signal"/);
  assert.match(src, /app\.get\("\/api\/fp-signal"/);
  assert.match(src, /不认识的指令/);
  assert.match(src, /fpSignals\.filter\(signal => signal\.at > since\)/);
  assert.match(src, /fpSignals\.push\(\{ action, at \}\)/);
  assert.match(src, /fpSignals\.length > 64/, "信号队列应有上限，避免长期累积");
  assert.match(src, /signal: signals\[0\] \|\| null, signals/, "调用方要能顺序拿到同一轮询间隔内的多个动作");
  const line = src.match(/const FP_SIGNAL_ACTIONS = new Set\(([^)]*)\)/);
  assert.ok(line, "应有信号白名单");
  assert.match(line[1], /["']refresh["']/, "白名单要认 refresh，否则门厅勾完待办主页不会跟着更新");
  assert.match(line[1], /["']focus["']/, "白名单要认 focus，门厅状态牌才能打开专注页");
});
