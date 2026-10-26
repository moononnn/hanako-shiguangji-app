// 拾光记 · 页面模板（服务端渲染，手帐风重制版）
// 独立成模块，避免 routes/ui.js 过胖。
// ⚠️ 注意：此文件整体是模板字符串，内部前端 JS 禁止使用反引号模板的 ${} 插值
//   （会被服务端模板解析吞掉），一律用字符串拼接。
// 文件预算豁免：服务端页面模板集中承载页面结构与资源拼接，拆分会破坏模板上下文。

import path from "node:path";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { MOOD_LINE_META, MOOD_LINE_SEGMENTS } from "./mood-line.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BS_DIR = path.join(__dirname, "beautify-select");
const TODO_TIME_CLIENT_FILE = path.join(__dirname, "todo-time-client.js");
const FB_UI_DIR = path.join(__dirname, "feedback", "ui");

export function renderPage(token) {
  // beautify-select 手帐风下拉组件（内联，避免外部资源鉴权问题）
  let bsCss = "";
  let bsJs = "";
  let todoTimeClientJs = "";
  let fbCss = "";
  let fbJs = "";
  try {
    bsCss = readFileSync(path.join(BS_DIR, "beautify-select.css"), "utf-8");
    bsJs = readFileSync(path.join(BS_DIR, "beautify-select.js"), "utf-8").replace(/<\/script>/gi, "<\\/script>");
  } catch {
    // 读不到不影响页面主体
  }
  try {
    todoTimeClientJs = readFileSync(TODO_TIME_CLIENT_FILE, "utf-8").replace(/<\/script>/gi, "<\\/script>");
  } catch {
    // 自动识别不可用时，手动选时间仍可正常使用
  }
  try {
    fbCss = readFileSync(path.join(FB_UI_DIR, "feedback.css"), "utf-8");
    fbJs = readFileSync(path.join(FB_UI_DIR, "feedback.js"), "utf-8").replace(/<\/script>/gi, "<\\/script>");
  } catch {
    // 反馈窗不可用时，设置页仍可正常使用
  }

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>拾光记</title>
<style>
  :root {
    --bg: #faf6ec;
    --card: #fffdf8;
    --ink: #4a463e;
    --muted: #948b7a;
    --primary: #7fb8a0;
    --primary-light: #b9d6c8;
    --primary-deep: #4d8a70;
    --primary-soft: #e7f1eb;
    --accent: #e89bb0;
    --accent-light: #f2cdd8;
    --accent-deep: #c96f87;
    --accent-soft: #f9e9ee;
    --warm: #dd9f6f;
    --warm-light: #e9cdab;
    --warm-soft: #f9ecdf;
    --period: #d98a96;
    --period-soft: #f8e4e7;
    /* Code 页那屏的配色：雾蓝，跟聊天窗口的薄荷绿拉开距离 */
    --code-accent: #5c7fa6;
    --code-deep: #47688c;
    --code-soft: #eef3f9;
    --code-line: rgba(92, 127, 166, .22);
    --line: #efe7d8;
    --shadow: 0 8px 22px rgba(96, 74, 40, 0.07);
    --shadow-up: 0 12px 30px rgba(96, 74, 40, 0.12);
    --radius: 20px;
    --radius-sm: 12px;
  }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  html, body { height: 100%; }
  body {
    font-family: "霞鹜文楷", "Kaiti SC", "STKaiti", "Noto Sans SC", sans-serif;
    background: var(--bg);
    color: var(--ink);
    padding: 22px 22px 40px;
    min-height: 100vh;
  }
  /* 极淡的手帐纸纹：细横线 + 一点暖调。
     以前写在 body 的 background-attachment: fixed 上，滚动时浏览器要每帧重画整个视口背景，
     长页面滚起来明显发顿。改成一层 position: fixed 的伪元素：同样不跟着滚，
     但它是独立一层，不用跟着正文一起重绘。 */
  body::before {
    content: "";
    position: fixed;
    inset: 0;
    z-index: -1;
    pointer-events: none;
    background-image:
      repeating-linear-gradient(0deg, transparent, transparent 27px, rgba(190, 168, 130, 0.05) 27px, rgba(190, 168, 130, 0.05) 28px),
      linear-gradient(180deg, #fcf8f0, var(--bg));
  }
  button { font-family: inherit; }

  /* ── 头部 ── */
  .header {
    display: flex; align-items: flex-end; justify-content: space-between;
    gap: 12px; margin-bottom: 18px; flex-wrap: wrap;
  }
  .brand { display: flex; align-items: baseline; gap: 12px; }
  .brand h1 {
    font-size: 28px; font-weight: 600; letter-spacing: 4px; color: var(--ink);
    position: relative;
  }
  .brand h1::after {
    content: ""; position: absolute; left: 2px; right: 2px; bottom: -3px;
    height: 6px; border-radius: 99px;
    background: linear-gradient(90deg, var(--primary) 0 42%, var(--accent) 42% 58%, transparent 58%);
    opacity: 0.55;
  }
  .brand .sub { color: var(--muted); font-size: 13px; letter-spacing: 1px; }
  .go-today-btn {
    border: 1px solid var(--line); background: var(--card); color: var(--primary-deep);
    padding: 6px 16px; border-radius: 99px; font-size: 13px; cursor: pointer;
    transition: all .18s;
  }
  .go-today-btn:hover { border-color: var(--primary); box-shadow: var(--shadow); transform: translateY(-1px); }
  .header-actions { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; justify-content: flex-end; }
  .settings-btn {
    border: 1px solid var(--line); background: transparent; color: var(--muted);
    padding: 6px 14px; border-radius: 99px; font-size: 13px; cursor: pointer;
    transition: all .18s;
  }
  .settings-btn:hover { border-color: var(--primary); color: var(--primary-deep); background: var(--primary-soft); }
  .context-toggle-btn {
    border: 1px solid #cfe5d8; background: var(--primary-soft); color: var(--primary-deep);
    padding: 6px 12px; border-radius: 99px; font-size: 13px; cursor: pointer;
    transition: all .18s;
  }
  .context-toggle-btn:hover { border-color: var(--primary); box-shadow: var(--shadow); transform: translateY(-1px); }
  .context-toggle-btn.off { border-color: var(--line); background: transparent; color: var(--muted); }
  .context-toggle-btn:disabled { opacity: .58; cursor: wait; transform: none; }
  /* Code 页那个开关用雾蓝，一眼分得出管的是哪边 */
  .context-toggle-btn.code { border-color: var(--code-line); background: var(--code-soft); color: var(--code-deep); }
  .context-toggle-btn.code:hover { border-color: var(--code-accent); }
  .context-toggle-btn.code.off { border-color: var(--line); background: transparent; color: var(--muted); }

  /* ── 今日概览卡（手帐的「今日页」） ── */
  .today-card {
    position: relative;
    background: linear-gradient(135deg, #f2f9f5 0%, #fbf7ee 70%);
    border: 1px solid #e3ecdf;
    border-radius: var(--radius);
    padding: 20px 22px 18px;
    margin-bottom: 18px;
    box-shadow: var(--shadow);
    overflow: hidden;
    display: flex; gap: 20px; align-items: center; flex-wrap: wrap;
    cursor: pointer;
    transition: box-shadow .18s, transform .18s;
  }
  .today-card:hover { box-shadow: 0 8px 24px rgba(93, 174, 142, .12); transform: translateY(-1px); }
  .today-card:focus-visible { outline: 2px solid var(--primary); outline-offset: 2px; }
  .today-card::before {
    content: ""; position: absolute; left: 0; top: 0; bottom: 0; width: 5px;
    background: linear-gradient(180deg, var(--primary), var(--accent));
    opacity: .85;
  }
  .today-date { display: flex; align-items: center; gap: 12px; }
  .today-date .big-day {
    font-size: 56px; line-height: 1; font-weight: 600; color: var(--primary-deep);
    font-family: "Poppins", "Segoe UI", "霞鹜文楷", sans-serif;
    font-variant-numeric: tabular-nums; letter-spacing: -2px;
  }
  .today-date .ym { display: flex; flex-direction: column; gap: 2px; }
  .today-date .ym .year { font-size: 13px; color: var(--muted); letter-spacing: 2px; }
  .today-date .ym .month { font-size: 16px; color: var(--ink); letter-spacing: 1px; }
  .today-body { flex: 1; min-width: 220px; display: flex; flex-direction: column; gap: 8px; }
  .today-fest, .today-events { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; }
  .today-fest .chip, .today-events .chip {
    font-size: 12px; padding: 3px 10px; border-radius: 99px; white-space: nowrap;
  }
  .today-fest .chip { background: var(--primary-soft); color: var(--primary-deep); }
  .today-events .chip.ep-anniversary { background: var(--accent-soft); color: var(--accent-deep); }
  .today-events .chip.ep-todo { background: var(--warm-soft); color: #b97a45; }
  .today-events .chip.ep-period { background: var(--period-soft); color: var(--period); }
  .today-events .chip.ep-event { background: var(--primary-soft); color: var(--primary-deep); }
  .today-quiet { font-size: 13px; color: var(--muted); letter-spacing: 1px; }
  .today-quiet em { font-style: normal; color: var(--primary-deep); }
  .today-weather-icon {
    position: absolute; right: 16px; top: 14px; opacity: .7; pointer-events: none;
    color: #e89bb0; transition: color .25s ease, transform .25s ease;
  }
  .today-weather-icon.weather-moon { color: #7893b4; }
  .today-weather-icon.weather-partly { color: #9b9c8a; }
  .today-weather-icon.weather-cloud { color: #86a49f; }
  .today-weather-icon.weather-rain { color: #6f9fb8; }
  .today-weather-icon.weather-snow { color: #8ba9c0; }
  .today-weather-icon.weather-fog { color: #a69186; }
  .today-weather-icon.weather-storm { color: #806c99; }

  /* ── 导航 ── */
  .nav-tabs { display: flex; gap: 6px; margin-bottom: 16px; flex-wrap: wrap; }
  .nav-tabs button {
    border: 1px solid transparent; background: transparent; color: var(--muted);
    font-size: 15px; padding: 7px 18px; border-radius: 99px; cursor: pointer;
    transition: all .18s; letter-spacing: 1px;
  }
  .nav-tabs button:hover { color: var(--primary-deep); background: var(--primary-soft); }
  .nav-tabs button small, .set-label small, .xingji-hero-title small { font-size: 11px; letter-spacing: 0; opacity: .7; margin-left: 3px; font-weight: normal; }
  .nav-tabs button.active {
    background: var(--primary); color: #fff; box-shadow: var(--shadow);
  }
  .focus-mini-indicator {
    border: 1px solid #cfe5d8; background: var(--primary-soft); color: var(--primary-deep);
    padding: 6px 11px; border-radius: 99px; font-size: 12px; cursor: pointer; white-space: nowrap;
  }
  .focus-overview { display: flex; align-items: baseline; justify-content: space-between; gap: 12px; flex-wrap: wrap; max-width: 980px; margin: 0 auto 14px; }
  .focus-overview-title { font-size: 20px; color: var(--primary-deep); letter-spacing: 2px; }
  .focus-overview-tip { color: var(--muted); font-size: 13px; }
  .focus-layout { display: grid; grid-template-columns: minmax(0, 1fr); gap: 16px; max-width: 980px; margin: 0 auto; }
  .focus-card { min-width: 0; padding: 18px 20px; background: var(--card); border: 1px solid var(--line); border-radius: var(--radius); box-shadow: var(--shadow); }
  .focus-timer-card { text-align: left; }
  #panel-focus button, #panel-focus summary { touch-action: manipulation; }
  #panel-focus button:focus-visible, #panel-focus input:focus-visible, #panel-focus summary:focus-visible { outline: 2px solid var(--primary); outline-offset: 3px; }
  #panel-focus .btn { min-height: 44px; white-space: nowrap; }
  #panel-focus .focus-session-actions button { min-height: 44px; }
  #panel-focus .btn:active, #panel-focus .focus-preset:active { transform: translateY(1px); }
  #panel-focus input { min-width: 0; width: 100%; min-height: 44px; }
  .focus-prepare-grid { display: grid; grid-template-columns: minmax(0, 3fr) minmax(0, 2fr); grid-template-areas: 'goal companion' 'duration companion'; gap: 18px 24px; }
  .focus-goal { grid-area: goal; }
  .focus-companions { grid-area: companion; padding-left: 24px; border-left: 1px solid var(--line); }
  .focus-duration { grid-area: duration; container-type: inline-size; }
  .focus-prepare-grid.without-companions { grid-template-columns: minmax(0, 1fr); grid-template-areas: 'goal' 'duration'; }
  .focus-companions { container-type: inline-size; }
  #panel-focus .focus-companion-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px; }
  .focus-companion-grid.expanded { max-height: 280px; overflow-y: auto; overscroll-behavior: contain; }
  #panel-focus .focus-companion-grid .mood-cell { display: flex; align-items: center; gap: 8px; min-height: 52px; min-width: 0; max-width: 100%; padding: 8px; text-align: left; }
  #panel-focus .focus-companion-grid span { white-space: normal; overflow-wrap: anywhere; }
  .focus-avatar { position: relative; display: inline-flex; align-items: center; justify-content: center; flex: none; width: 36px; height: 36px; border-radius: 12px; overflow: hidden; background: var(--primary-soft); color: var(--primary-deep); }
  .focus-avatar img { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; }
  .focus-companion-name-tag { flex: 1; min-width: 0; }
  .focus-companion-check { flex: none; color: var(--primary-deep); }
  .focus-companion-card { display: flex; align-items: center; gap: 12px; padding: 12px; border-radius: var(--radius-sm); background: var(--primary-soft); }
  .focus-companion-card-body { min-width: 0; overflow-wrap: anywhere; }
  .focus-companion-card-body p { font-size: 12px; color: var(--primary-deep); margin-top: 4px; }
  .focus-companion-links { display: flex; gap: 8px; flex-wrap: wrap; margin-top: 8px; }
  #panel-focus .focus-companion-link { border: 0; background: transparent; color: var(--primary-deep); padding: 8px 4px; min-height: 44px; cursor: pointer; font: inherit; font-size: 13px; border-radius: 8px; }
  #panel-focus .focus-companion-link:hover { background: var(--primary-soft); }
  @container (max-width: 300px) { #panel-focus .focus-companion-grid { grid-template-columns: minmax(0, 1fr); } }
  .focus-break-option { display: flex; align-items: center; gap: 12px; margin-top: 12px; color: var(--muted); font-size: 13px; }
  .focus-break-option .focus-preset { min-height: 36px; padding: 6px 10px; }
  .focus-plan-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px 18px; margin-top: 16px; }
  @container (max-width: 460px) { #panel-focus .focus-plan-grid { grid-template-columns: minmax(0, 1fr); } }
  .focus-plan-setting { display: flex; align-items: center; justify-content: space-between; gap: 8px; min-width: 0; color: var(--muted); font-size: 12px; }
  .focus-stepper { display: inline-flex; align-items: center; gap: 7px; flex: none; }
  #panel-focus .focus-stepper button { width: 36px; min-height: 36px; border: 1px solid var(--line); border-radius: 9px; background: var(--card); color: var(--primary-deep); font: inherit; font-size: 17px; cursor: pointer; }
  #panel-focus .focus-stepper button:disabled { opacity: .45; cursor: not-allowed; }
  .focus-step-value { min-width: 38px; color: var(--ink); text-align: center; font-variant-numeric: tabular-nums; }
  .focus-favorite-save { border: 0; background: transparent; color: var(--primary-deep); padding: 6px 2px; min-height: 36px; cursor: pointer; font: inherit; font-size: 12px; }
  .focus-favorite-save:disabled { opacity: .5; cursor: not-allowed; }
  .focus-favorites { display: flex; align-items: center; flex-wrap: wrap; gap: 6px; margin-top: 8px; }
  .focus-favorites:empty { display: none; }
  .focus-favorite-chip { display: inline-flex; align-items: center; border: 1px solid var(--line); border-radius: 8px; overflow: hidden; background: var(--card); }
  #panel-focus .focus-favorite-chip button { border: 0; background: transparent; color: var(--primary-deep); font: inherit; font-size: 12px; min-height: 36px; padding: 6px 10px; cursor: pointer; }
  #panel-focus .focus-favorite-chip .focus-favorite-remove { padding: 6px 9px; border-left: 1px solid var(--line); color: var(--muted); }
  .focus-submit { margin-top: 18px; }
  .focus-feedback { color: var(--muted); font-size: 13px; line-height: 1.6; overflow-wrap: anywhere; margin-top: 8px; }
  .focus-feedback:empty { display: none; }
  .focus-live-paper { position: relative; display: flex; align-items: center; gap: 24px; padding: 18px 20px; background: var(--bg); border: 1px solid var(--line); border-radius: var(--radius-sm); }
  .focus-live-paper::before { content: ''; position: absolute; left: 0; top: 14px; bottom: 14px; width: 4px; border-radius: 2px; background: var(--primary); }
  .focus-live-clock-wrap { flex: none; min-width: 150px; }
  .focus-live-clock-label { display: block; margin-bottom: 4px; color: var(--primary-deep); font-size: 11px; letter-spacing: 2px; }
  .focus-live .focus-clock { flex: none; margin: 0; font-size: 56px; line-height: 1; font-weight: 600; }
  .focus-live-body { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 9px; }
  .focus-live .focus-phase { display: inline-flex; align-items: center; gap: 8px; align-self: flex-start; padding: 4px 9px; border-radius: 99px; background: var(--primary-soft); color: var(--primary-deep); font-weight: 600; }
  .focus-live .focus-phase::before { content: ''; width: 7px; height: 7px; flex: none; border-radius: 50%; background: var(--primary); }
  .focus-live .focus-task-name { margin: 0; font-size: 18px; font-weight: 600; }
  .focus-live .focus-companion-name { overflow-wrap: anywhere; }
  .focus-live .focus-companion-name:empty { display: none; }
  #panel-focus .focus-session-meta { overflow-wrap: anywhere; }
  #panel-focus .focus-live-companion { display: flex; align-items: flex-start; gap: 10px; min-height: 44px; margin-top: 14px; padding: 11px 14px; border: 1px solid #dce9dc; border-radius: 14px; background: var(--primary-soft); color: var(--primary-deep); font-size: 13px; line-height: 1.55; overflow-wrap: anywhere; }
  #panel-focus .focus-live-companion:empty { display: none; }
  #panel-focus .focus-live-companion::before { content: '✓'; display: grid; place-items: center; flex: none; width: 20px; height: 20px; margin-top: 1px; border-radius: 50%; background: var(--card); color: var(--primary-deep); font-size: 12px; font-weight: 700; }
  #panel-focus .focus-live-companion[data-state='unconfirmed'] { border-color: #eadfc9; background: var(--warm-soft); color: #8a6748; }
  #panel-focus .focus-live-companion[data-state='unconfirmed']::before { content: '↗'; color: #9b7651; }
  #panel-focus .focus-live-companion[data-state='unknown'] { border-color: var(--line); background: var(--card); color: var(--ink); }
  #panel-focus .focus-live-companion[data-state='unknown']::before { content: '·'; color: var(--muted); font-size: 18px; }
  #panel-focus .focus-live-companion[data-state='warning'] { border-color: #edd8ce; background: #fbefea; color: #986b59; }
  #panel-focus .focus-live-companion[data-state='warning']::before { content: '!'; color: #986b59; }
  .focus-live .focus-actions { margin-top: 18px; }
  .focus-settlement { margin-top: 18px; }
  #panel-focus .focus-settlement .a-agent { margin-left: 0; overflow-wrap: anywhere; }
  #panel-focus .focus-settlement .a-text { white-space: pre-wrap; overflow-wrap: anywhere; }
  #panel-focus .focus-settlement .archive-actions button { min-height: 44px; border-radius: 8px; }
  .focus-settlement:empty { display: none; }
  .focus-records { padding: 0 4px; min-width: 0; }
  .focus-records > summary { cursor: pointer; min-height: 44px; color: var(--muted); padding: 12px 0; }
  .focus-records-body { padding: 18px 20px; background: var(--card); border: 1px solid var(--line); border-radius: var(--radius); box-shadow: var(--shadow); }
  .focus-records-body .focus-card-title { margin-top: 16px; }
  #panel-focus .focus-note { max-width: 980px; }
  #panel-focus .focus-note summary { min-height: 44px; padding: 12px 0; cursor: pointer; }
  @media (prefers-reduced-motion: reduce) { #panel-focus *, #panel-focus *::before { transition: none !important; animation: none !important; } }
  @media (max-width: 380px) {
    #panel-focus .focus-actions { gap: 6px; }
    #panel-focus .focus-actions .btn { padding-left: 10px; padding-right: 10px; }
    #panel-focus .focus-preset-row { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); }
    #panel-focus .focus-break-option .focus-preset-row { display: flex; }
    #panel-focus .focus-session-row { display: block; }
    #panel-focus .focus-session-actions { margin-top: 8px; }
  }
  .focus-card-title { margin: 0; color: var(--ink); font-size: 17px; letter-spacing: 1px; }
  .focus-phase { color: var(--muted); font-size: 13px; }
  .focus-clock { margin: 8px 0 10px; color: var(--primary-deep); font: 500 52px/1.15 "Poppins", "Segoe UI", sans-serif; font-variant-numeric: tabular-nums; letter-spacing: -2px; }
  .focus-task-name { min-height: 22px; margin: 0 0 16px; color: var(--ink); font-size: 15px; overflow-wrap: anywhere; }
  .focus-control { min-width: 0; text-align: left; }
  .focus-control-label { display: block; margin-bottom: 7px; color: var(--muted); font-size: 12px; }
  .focus-preset-row { display: flex; gap: 6px; flex-wrap: wrap; }
  .focus-preset { border: 1px solid var(--line); background: transparent; color: var(--muted); border-radius: 10px; padding: 7px 12px; min-height: 44px; font-size: 13px; cursor: pointer; white-space: nowrap; }
  .focus-preset:hover { border-color: var(--primary); color: var(--primary-deep); }
  .focus-preset.active { border-color: var(--primary); background: var(--primary-soft); color: var(--primary-deep); font-weight: 600; }
  .focus-actions { display: flex; justify-content: flex-end; gap: 8px; flex-wrap: nowrap; }
  #panel-focus .focus-card-caption { color: var(--muted); font-size: 12px; line-height: 1.6; }
  #panel-focus .focus-card-caption:empty { display: none; }
  .focus-actions .btn { flex: none; min-width: 100px; }
  .focus-week-summary { margin: 0 0 12px; color: var(--ink); font-size: 13px; }
  .focus-week-summary b { color: var(--primary-deep); font-weight: 600; }
  .focus-week-bars { display: grid; grid-template-columns: repeat(7, minmax(0, 1fr)); gap: 6px; align-items: end; height: 78px; }
  .focus-week-day { display: flex; height: 100%; min-width: 0; flex-direction: column; align-items: center; justify-content: flex-end; gap: 4px; color: var(--muted); font-size: 10px; }
  .focus-week-track { display: flex; width: 100%; height: 52px; align-items: flex-end; overflow: hidden; border-radius: 7px 7px 3px 3px; background: #f5f1e7; }
  .focus-week-fill { width: 100%; min-height: 0; border-radius: 7px 7px 3px 3px; background: var(--primary-light); }
  .focus-week-day.today .focus-week-fill { background: var(--primary); }
  .focus-session-list { display: flex; flex-direction: column; gap: 8px; }
  .focus-session-row { display: flex; align-items: flex-start; justify-content: space-between; gap: 10px; padding: 9px 0; border-bottom: 1px solid var(--line); }
  .focus-session-row:last-child { border-bottom: 0; }
  .focus-session-main { min-width: 0; flex: 1; }
  .focus-session-name { color: var(--ink); font-size: 13px; overflow-wrap: anywhere; }
  .focus-session-meta { margin-top: 3px; color: var(--muted); font-size: 11px; line-height: 1.5; }
  .focus-session-actions { display: flex; flex: none; gap: 4px; }
  .focus-session-actions button { border: 0; border-radius: 8px; padding: 5px 7px; background: var(--primary-soft); color: var(--primary-deep); font: inherit; font-size: 11px; cursor: pointer; white-space: nowrap; }
  .focus-note { max-width: 980px; margin: 10px auto 0; color: var(--muted); font-size: 11px; line-height: 1.6; }
  .focus-day-records { margin: 12px 0; padding: 12px 14px; border: 1px solid #e1ece3; border-radius: 14px; background: #f5faf6; }
  .focus-day-records h4 { margin-bottom: 6px; color: var(--primary-deep); font-size: 13px; }
  .focus-day-row { display: flex; align-items: baseline; gap: 8px; padding: 5px 0; color: var(--ink); font-size: 12px; }
  .focus-day-row span:first-child { flex: 1; min-width: 0; overflow-wrap: anywhere; }
  .focus-day-row small { flex: none; color: var(--muted); font-size: 11px; }
  @media (max-width: 720px) {
    .focus-prepare-grid { grid-template-columns: minmax(0, 1fr); grid-template-areas: 'goal' 'companion' 'duration'; }
    .focus-companions { padding-left: 0; border-left: 0; }
    .focus-live-paper { align-items: stretch; flex-direction: column; gap: 12px; }
      .focus-live-clock-wrap { min-width: 0; }
    .focus-live .focus-clock { font-size: 48px; }
  }
  @media (max-width: 420px) {
    .focus-card, .focus-records-body { padding: 14px; }
    .focus-live-paper { padding: 14px; }
    .focus-live .focus-clock { font-size: 44px; }
    .focus-mini-indicator { padding: 5px 8px; font-size: 11px; }
  }

  /* ── 月导航条 ── */
  .month-bar {
    display: flex; align-items: center; gap: 10px; flex-wrap: wrap;
    margin-bottom: 12px; padding: 0 2px;
  }
  .month-bar .month-title {
    font-size: 18px; letter-spacing: 2px; min-width: 120px; text-align: center;
    font-weight: 600; color: var(--ink);
  }
  .icon-btn {
    width: 32px; height: 32px; border-radius: 99px;
    border: 1px solid var(--line); background: var(--card); color: var(--primary-deep);
    font-size: 16px; cursor: pointer; transition: all .18s; line-height: 1;
    display: inline-flex; align-items: center; justify-content: center;
  }
  .icon-btn:hover { border-color: var(--primary); box-shadow: var(--shadow); transform: translateY(-1px); }
  /* 左右箭头改用样式画，不再靠 ‹ › 这两个字符：它们字形天生偏心，
     即使把字符盒子弹性居中，看着仍然是歪的。 */
  .icon-btn.nav-prev, .icon-btn.nav-next { font-size: 0; }
  .icon-btn.nav-prev::before, .icon-btn.nav-next::before {
    content: ''; width: 7px; height: 7px;
    border-left: 1.7px solid currentColor; border-bottom: 1.7px solid currentColor;
    border-radius: 1px;
  }
  .icon-btn.nav-prev::before { transform: rotate(45deg) translate(1.4px, -1.4px); }
  .icon-btn.nav-next::before { transform: rotate(225deg) translate(1.4px, -1.4px); }

  /* ── 日历 ── */
  .calendar {
    display: grid; grid-template-columns: repeat(7, 1fr); gap: 7px;
    background: var(--card); padding: 13px;
    border-radius: var(--radius); border: 1px solid var(--line); box-shadow: var(--shadow);
    max-width: 980px; margin: 0 auto;
  }
  .calendar-guide {
    max-width: 980px; margin: 10px auto 0; text-align: center;
    font-size: 13px; color: var(--muted); letter-spacing: 1px;
    padding: 10px 16px; border-radius: 99px; background: var(--primary-soft);
  }
  .cal-head { text-align: center; font-size: 12px; color: var(--muted); padding: 2px 0 6px; letter-spacing: 2px; }
  .cal-head.weekend { color: var(--warm); }
  .cal-head.sunday { color: var(--accent-deep); }
  .cal-day {
    height: 70px; min-height: 0; max-height: 70px;
    border: 1px solid var(--line); border-radius: var(--radius-sm);
    padding: 6px 7px; cursor: pointer; position: relative;
    background: #fffdf9;
    transition: all .16s;
    display: flex; flex-direction: column; align-self: start;
    overflow: hidden;
  }
  .cal-day:hover { border-color: var(--primary); transform: translateY(-2px); box-shadow: var(--shadow); }
  .cal-day.empty { border: none; background: transparent; cursor: default; box-shadow: none; transform: none; }
  .cal-day.today { background: var(--accent-soft); border-color: #f0c7d2; }
  .cal-day.today:hover { border-color: var(--accent); }
  .cal-day.selected {
    border: 2px solid var(--primary-deep); padding: 5px 6px;
    background: #f1faf5;
    box-shadow: 0 0 0 3px rgba(77, 138, 112, 0.16), var(--shadow);
  }
  .cal-day.selected .num { color: var(--primary-deep); font-weight: 700; }
  .cal-day.selected .tags { padding-right: 18px; }
  .cal-day.selected::after {
    content: "✓"; position: absolute; right: 6px; bottom: 6px;
    width: 15px; height: 15px; display: inline-flex; align-items: center; justify-content: center;
    border-radius: 99px; background: var(--primary-deep); color: #fff;
    font: 600 10px/1 "Segoe UI", sans-serif;
  }
  .cal-day.today.selected {
    background: #fff3f5; border-color: var(--accent-deep);
    box-shadow: 0 0 0 3px rgba(201, 111, 135, 0.18), var(--shadow);
  }
  .cal-day.today.selected .num { color: var(--accent-deep); }
  .cal-day.today.selected::after { background: var(--accent-deep); }
  .cal-day .num {
    font-size: 13px; color: var(--muted);
    font-family: "Poppins", "Segoe UI", "霞鹜文楷", sans-serif; font-variant-numeric: tabular-nums;
    display: flex; align-items: center; justify-content: space-between;
  }
  .cal-day .num .weekend-num { color: var(--warm); }
  .cal-day.today .num { color: var(--accent-deep); font-weight: 700; }
  .cal-day .today-tag {
    font-size: 9px; color: var(--accent-deep); background: var(--accent);
    color: #fff; border-radius: 99px; padding: 1px 6px; font-weight: 400; letter-spacing: 1px;
  }
  .cal-day .sum-tag {
    font-size: 10px; color: var(--primary-deep); opacity: .8;
    line-height: 1; padding-right: 1px;
  }
  .cal-day.today .sum-tag { color: var(--primary-deep); opacity: .95; }
  .cal-day .tags {
    margin-top: auto; display: flex; flex-direction: column; gap: 2px;
    min-height: 0; max-height: 40px; overflow: hidden;
  }
  .cal-day .tag {
    font-size: 10px; padding: 0 6px; border-radius: 6px; line-height: 1.15;
    white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
  }
  .cal-day .tag.builtin { background: var(--primary-soft); color: var(--primary-deep); }
  .cal-day .tag.todo { background: var(--warm-soft); color: #b97a45; }
  .cal-day .tag.period { background: var(--period-soft); color: var(--period); }
  .cal-day .tag.period.predicted { background: transparent; border: 1px dashed #e3b7be; color: #b88790; }
  .cal-day .tag.anniversary { background: var(--accent-soft); color: var(--accent-deep); }
  .cal-day .tag.event { background: var(--primary-soft); color: var(--primary-deep); }
  .cal-day .tag.more { color: var(--muted); background: #f3ede1; }
  .cal-day .period-dot {
    display: inline-block; width: 6px; height: 6px; border-radius: 99px;
    background: var(--period); margin-left: 2px; vertical-align: 1px;
  }
  .cal-day .mood-tag {
    font-size: 11px; line-height: 1; padding: 0;
    position: absolute; right: 7px; bottom: 6px; opacity: .92;
    filter: saturate(.9); pointer-events: none;
  }
  .cal-day .mood-tag .mood-seg {
    font-size: 8px; color: var(--muted); vertical-align: 1px; margin-right: 1px;
  }
  .cal-day.selected .mood-tag { bottom: 8px; }
  @media (max-width: 560px) {
    .cal-day .mood-tag { right: 4px; bottom: 4px; }
    .cal-day.selected .mood-tag { bottom: 6px; }
  }

  /* ── 心情行（记一笔当下的心情） ── */
  .mood-line {
    display: flex; align-items: center; gap: 6px; flex-wrap: wrap;
    margin: 2px 0 0; padding: 8px 12px;
    background: var(--card); border: 1px solid var(--line); border-radius: 12px;
  }
  .mood-line.today-mood { margin-bottom: 10px; }
  .mood-fab {
    display: inline-flex; align-items: center; gap: 5px;
    border: 1px solid #cfe0d2; background: var(--primary-soft); color: var(--primary-deep);
    border-radius: 99px; padding: 5px 12px; font-size: 12.5px; cursor: pointer;
    font-family: inherit; letter-spacing: .5px; transition: all .15s;
  }
  .mood-fab:hover { background: #dcefe3; transform: translateY(-1px); }
  .mood-fab .fab-emoji { font-size: 15px; }
  .mood-pill {
    display: inline-flex; align-items: center; gap: 4px;
    background: #f5efe2; border-radius: 99px; padding: 3px 9px;
    font-size: 12px; color: #6b6252; border: 1px solid #ece2cd;
  }
  .mood-pill .pill-emoji { font-size: 14px; }
  .mood-pill .pill-seg { color: var(--muted); font-size: 11px; }
  .mood-pill .pill-source, .mood-timeline .tl-source, .moodline-entry .entry-source { color: #a0917f; font-size: 10px; letter-spacing: .2px; }
  .mood-pill .pill-del {
    border: none; background: none; color: #c2b6a0; cursor: pointer;
    font-size: 12px; line-height: 1; padding: 0 1px;
  }
  .mood-pill .pill-del:hover { color: var(--accent-deep); }
  .mood-open {
    flex-basis: 100%; display: flex; flex-direction: column; gap: 8px;
    padding-top: 4px;
  }
  .mood-grid { display: flex; flex-wrap: wrap; gap: 6px; }
  .mood-cell {
    display: inline-flex; align-items: center; gap: 3px;
    border: 1px solid #e6ddcb; background: #fff; border-radius: 10px;
    padding: 4px 9px; cursor: pointer; font-family: inherit; font-size: 12.5px;
    color: #5a5346; transition: all .12s;
  }
  .mood-cell:hover { border-color: #bcd8c4; background: #f2f8f2; transform: translateY(-1px); }
  .mood-cell.picked { border-color: var(--primary-deep); background: var(--primary-soft); color: var(--primary-deep); }
  .mood-cell .e { font-size: 15px; }
  .mood-reason-row { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
  .mood-reason-row input {
    flex: 1; min-width: 180px; border: 1px solid #e6ddcb; border-radius: 99px;
    padding: 5px 12px; font-family: inherit; font-size: 12px; color: #5a5346; outline: none;
    background: #fff;
  }
  .mood-reason-row input:focus { border-color: #a9cbb4; }
  .mood-open-actions { display: flex; align-items: center; justify-content: flex-end; gap: 6px; flex-wrap: wrap; }
  .mood-open-actions .hint { font-size: 11px; color: var(--muted); margin-right: auto; }
  .mood-hint-line { font-size: 11px; color: var(--muted); }

  /* ── 心情时间线（日期详情 / 时光册一页） ── */
  .mood-timeline {
    display: flex; flex-wrap: wrap; align-items: center; gap: 4px 6px;
    font-size: 12.5px; color: var(--ink); line-height: 1.8;
  }
  .mood-timeline .tl-arrow { color: #d8cbb2; }
  .mood-timeline .tl-manual .tl-emoji { filter: none; }
  .mood-timeline .tl-auto { color: #8a9a8f; }
  .mood-timeline .tl-auto .tl-emoji { opacity: .75; filter: saturate(.55); }
  .mood-timeline .tl-seg { color: var(--muted); font-size: 11px; }
  .mood-timeline .tl-note { color: var(--muted); }
  .mood-block {
    margin-top: 10px; padding-top: 10px; border-top: 1px solid var(--line);
  }
  .mood-block .mood-block-title {
    font-size: 12px; color: var(--muted); letter-spacing: 2px; margin-bottom: 5px;
    display: flex; align-items: center; gap: 6px;
  }
  .mood-block .mood-block-title::after { content: ""; flex: 1; height: 1px; background: var(--line); }
  .mood-timeline .mood-tl-item { display: inline-flex; align-items: center; gap: 3px; }
  .mood-timeline .mood-tl-del {
    border: none; background: none; color: #d0c4ac; cursor: pointer;
    font-size: 11px; padding: 0 2px; line-height: 1;
  }
  .mood-timeline .mood-tl-del:hover { color: var(--accent-deep); }
  .mood-timeline .tl-empty-note { color: var(--muted); font-size: 11px; }

  /* ── 拾性 ── */
  .xingji-page { max-width: 1080px; margin: 0 auto; }
  .xingji-hero { display: flex; align-items: flex-end; justify-content: space-between; gap: 16px; flex-wrap: wrap; margin: 0 0 14px; }
  .xingji-hero-main { min-width: 0; }
  .xingji-hero-title { font-size: 20px; color: var(--primary-deep); letter-spacing: 2px; }
  .xingji-hero-tip { display: block; margin-top: 6px; color: var(--muted); font-size: 13px; line-height: 1.75; max-width: 640px; }
  .xingji-hero-actions { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
  .xingji-stats { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 10px; margin: 0 0 16px; }
  .xingji-stat { padding: 12px 14px; background: var(--card); border: 1px solid var(--line); border-radius: 16px; box-shadow: var(--shadow); }
  .xingji-stat b { display: block; font-size: 24px; line-height: 1.1; color: var(--ink); font-weight: 600; font-variant-numeric: tabular-nums; }
  .xingji-stat span { display: block; margin-top: 4px; color: var(--muted); font-size: 12px; }
  .xingji-stat.is-accent b { color: var(--accent-deep); }
  .xingji-stat.is-warm b { color: #b97a45; }
  .xingji-layout { display: grid; grid-template-columns: minmax(0, 1fr) 296px; gap: 16px; align-items: start; }
  .xingji-main { min-width: 0; display: flex; flex-direction: column; gap: 12px; }
  .xingji-agent-card { padding: 16px 18px 14px; background: var(--card); border: 1px solid var(--line); border-radius: 20px; box-shadow: var(--shadow); }
  .xingji-agent-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 10px; }
  .xingji-agent-who { display: flex; align-items: center; gap: 10px; min-width: 0; }
  .xingji-avatar { position: relative; flex: none; width: 38px; height: 38px; border-radius: 13px; display: inline-flex; align-items: center; justify-content: center; background: var(--primary-soft); color: var(--primary-deep); font-size: 15px; overflow: hidden; }
  .xingji-avatar img { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; }
  .xingji-agent-card.tone-1 .xingji-avatar { background: var(--accent-soft); color: var(--accent-deep); }
  .xingji-agent-card.tone-2 .xingji-avatar { background: var(--warm-soft); color: #b97a45; }
  .xingji-agent-name { font-size: 15px; font-weight: 600; color: var(--ink); letter-spacing: .5px; }
  .xingji-agent-meta { margin-top: 3px; color: var(--muted); font-size: 11.5px; line-height: 1.5; }
  .xingji-pill { flex: none; padding: 3px 9px; border-radius: 99px; font-size: 11px; letter-spacing: .5px; background: var(--primary-soft); color: var(--primary-deep); }
  .xingji-pill.warm { background: var(--warm-soft); color: #b97a45; }
  .xingji-pill.quiet { background: #f4efe4; color: var(--muted); }
  .xingji-section-label { display: flex; align-items: center; gap: 8px; margin: 14px 0 6px; color: var(--muted); font-size: 11px; letter-spacing: 1px; }
  .xingji-section-label::after { content: ""; flex: 1; height: 1px; background: var(--line); }
  .xingji-entry { padding: 11px 0 2px; border-top: 1px dashed var(--line); }
  .xingji-entry:first-of-type { border-top: 0; padding-top: 2px; }
  .xingji-entry-top { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
  .xingji-level { padding: 2px 8px; border-radius: 99px; font-size: 10.5px; background: var(--primary-soft); color: var(--primary-deep); }
  .xingji-level.likely { background: var(--accent-soft); color: var(--accent-deep); }
  .xingji-kind-tag { padding: 2px 8px; border-radius: 99px; font-size: 10.5px; background: var(--warn-soft, var(--primary-soft)); color: var(--warn-deep, var(--primary-deep)); }
  .xingji-relation-tag { padding: 2px 8px; border-radius: 99px; font-size: 10.5px; background: #f4efe4; color: var(--muted); }
  .xingji-relation-tag.is-written { background: var(--primary-soft); color: var(--primary-deep); }
  .xingji-entry-line { font-size: 13.5px; line-height: 1.8; margin-top: 5px; }
  .xingji-situation { color: var(--muted); }
  .xingji-arrow { margin: 0 7px; color: var(--accent); }
  .xingji-behavior { font-weight: 600; color: var(--ink); }
  .xingji-entry-meta { margin-top: 4px; color: var(--muted); font-size: 11.5px; }
  .xingji-evidence { margin-top: 5px; }
  .xingji-evidence summary { cursor: pointer; color: var(--muted); font-size: 12px; }
  .xingji-evidence ul { margin: 6px 0 0; padding-left: 18px; }
  .xingji-evidence li { font-size: 12px; line-height: 1.75; color: var(--muted); }
  .xingji-evidence li.xingji-neg { opacity: .72; }
  .xingji-reject { margin-top: 7px; border: 1px solid var(--line); background: var(--card); color: var(--muted); font-size: 11.5px; cursor: pointer; padding: 3px 9px; border-radius: 99px; text-decoration: none; }
  .xingji-reject:hover { border-color: var(--accent); color: var(--accent-deep); background: var(--accent-soft); }
  .xingji-candidates { margin-top: 12px; padding: 10px 12px 4px; background: #fbf7ee; border: 1px dashed #e6d9c4; border-radius: 14px; }
  .xingji-candidates summary { cursor: pointer; list-style: none; display: flex; align-items: center; gap: 8px; color: #9a7c52; font-size: 12.5px; font-weight: 600; }
  .xingji-candidates summary::-webkit-details-marker { display: none; }
  .xingji-candidates summary::before { content: "›"; display: inline-block; transition: transform .15s; }
  .xingji-candidates[open] summary::before { transform: rotate(90deg); }
  .xingji-candidates-tip { margin: 6px 0 2px; color: var(--muted); font-size: 11.5px; line-height: 1.65; }
  .xingji-candidate { padding: 9px 0; border-top: 1px dashed #eadfcd; }
  .xingji-candidate:first-of-type { border-top: 0; }
  .xingji-meter-row { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 6px; margin-top: 7px; }
  .xingji-meter { min-width: 0; }
  .xingji-meter-label { display: flex; align-items: baseline; justify-content: flex-start; gap: 4px; color: var(--muted); font-size: 10.5px; }
  .xingji-meter-label b { color: var(--ink); font-weight: 600; font-variant-numeric: tabular-nums; }
  .xingji-meter-track { height: 5px; margin-top: 3px; border-radius: 99px; background: #efe6d6; overflow: hidden; }
  .xingji-meter-fill { display: block; height: 100%; border-radius: 99px; background: linear-gradient(90deg, var(--warm-light), var(--warm)); }
  .xingji-agent-foot { margin-top: 13px; padding-top: 11px; border-top: 1px solid var(--line); display: flex; align-items: flex-end; justify-content: space-between; gap: 10px; flex-wrap: wrap; }
  .xingji-agent-foot p { flex: 1 1 280px; color: var(--muted); font-size: 12px; line-height: 1.7; }
  .xingji-agent-foot .btn { flex: none; }
  .xingji-empty { padding: 16px 2px 6px; color: var(--muted); font-size: 12.5px; line-height: 1.8; }
  .xingji-rail { display: flex; flex-direction: column; gap: 12px; position: sticky; top: 16px; }
  .xingji-guide { padding: 16px; background: linear-gradient(160deg, #f4faf5, #fbf7ee 70%); border: 1px solid #dfeade; border-radius: 18px; box-shadow: var(--shadow); }
  .xingji-guide h3 { font-size: 13px; color: var(--primary-deep); letter-spacing: 1px; margin-bottom: 10px; }
  .xingji-guide ol { list-style: none; display: flex; flex-direction: column; gap: 10px; }
  .xingji-guide li { position: relative; padding-left: 24px; color: var(--muted); font-size: 12px; line-height: 1.7; }
  .xingji-guide li b { display: block; color: var(--ink); font-size: 12.5px; font-weight: 600; margin-bottom: 1px; }
  .xingji-guide-num { position: absolute; left: 0; top: 0; width: 16px; height: 16px; border-radius: 50%; display: inline-flex; align-items: center; justify-content: center; background: var(--primary-soft); color: var(--primary-deep); font-size: 10px; font-weight: 600; }
  .xingji-example { margin-top: 12px; padding: 10px 11px; background: #fffdf8; border: 1px solid var(--line); border-radius: 12px; }
  .xingji-example-label { display: inline-block; padding: 1px 6px; border-radius: 99px; background: var(--accent-soft); color: var(--accent-deep); font-size: 10px; }
  .xingji-example p { margin-top: 6px; color: var(--muted); font-size: 11.5px; line-height: 1.7; }
  .xingji-example b { color: var(--ink); font-weight: 600; }
  .xingji-privacy { padding: 12px 14px; border: 1px solid var(--line); border-radius: 14px; background: var(--card); color: var(--muted); font-size: 11.5px; line-height: 1.7; }
  .xingji-job-slot:empty { display: none; }
  .xingji-job-done { margin: 0 0 12px; padding: 8px 12px; display: flex; align-items: baseline; justify-content: space-between; gap: 8px 12px; flex-wrap: wrap; background: var(--primary-soft); border: 1px solid #d8e8dd; border-radius: 12px; color: var(--primary-deep); font-size: 12px; }
  .xingji-job-card { margin: 0 0 14px; padding: 14px 16px; background: linear-gradient(135deg, #f4faf5, #fffdf8); border: 1px solid #d8e8dd; border-radius: 18px; box-shadow: var(--shadow); }
  .xingji-job-card.is-warn { background: linear-gradient(135deg, #fdf4ec, #fffdf8); border-color: #edd9c2; }
  .xingji-job-head { display: flex; align-items: baseline; justify-content: space-between; gap: 10px; flex-wrap: wrap; }
  .xingji-job-title { font-size: 14px; font-weight: 600; color: var(--primary-deep); letter-spacing: .5px; }
  .xingji-job-card.is-warn .xingji-job-title { color: #a96d3f; }
  .xingji-job-sub { color: var(--muted); font-size: 11.5px; }
  .xingji-job-steps { display: flex; gap: 6px; flex-wrap: wrap; margin: 9px 0 7px; }
  .xingji-job-step { padding: 2px 8px; border-radius: 99px; background: #f1ede4; color: var(--muted); font-size: 10.5px; }
  .xingji-job-step.is-done { background: var(--primary-soft); color: var(--primary-deep); }
  .xingji-job-step.is-active { background: var(--primary); color: #fff; }
  .xingji-job-bar { height: 6px; border-radius: 99px; background: #e9e2d5; overflow: hidden; }
  .xingji-job-bar i { display: block; height: 100%; border-radius: 99px; background: linear-gradient(90deg, var(--primary-light), var(--primary)); transition: width .4s ease; }
  .xingji-job-bar.is-indeterminate i { width: 34% !important; animation: xingji-indeterminate 1.4s ease-in-out infinite; }
  @keyframes xingji-indeterminate { 0% { transform: translateX(-100%); } 100% { transform: translateX(320%); } }
  .xingji-job-line { margin-top: 7px; color: var(--ink); font-size: 12px; line-height: 1.65; }
  .xingji-job-hint { margin-top: 2px; color: var(--muted); font-size: 11.5px; line-height: 1.6; }
  .xingji-job-actions { display: flex; gap: 7px; flex-wrap: wrap; margin-top: 9px; }
  .xingji-empty-page { padding: 22px 20px; text-align: center; }
  .xingji-empty-page h3 { font-size: 16px; color: var(--ink); letter-spacing: 1px; margin-bottom: 6px; }
  .xingji-empty-page p { color: var(--muted); font-size: 12.5px; line-height: 1.8; max-width: 560px; margin: 0 auto; }
  .xingji-empty-page .btn { margin-top: 12px; }
  .xingji-disabled { border-color: #eadfcd; background: linear-gradient(160deg, #fdf7ee, #fffdf8); }
  .xingji-disabled .xingji-empty-page h3 { color: #a96d3f; }
  .xingji-dialog-lead { color: var(--ink); font-size: 13px; line-height: 1.8; }
  .xingji-range { display: flex; flex-direction: column; gap: 8px; }
  .xingji-range-label { color: var(--muted); font-size: 12px; }
  .xingji-range .seg { align-self: flex-start; flex-wrap: wrap; }
  .xingji-range-note { color: var(--muted); font-size: 11.5px; line-height: 1.7; }
  .xingji-cost-note { padding: 10px 12px; background: #fbf7ee; border: 1px solid var(--line); border-radius: 12px; }
  .xingji-cost-note p { color: var(--muted); font-size: 12px; line-height: 1.7; }
  .xingji-cost-note p + p { margin-top: 4px; }
  .xingji-cost-note b { color: var(--ink); }
  .xingji-dialog-foot { display: flex; justify-content: flex-end; gap: 8px; flex-wrap: wrap; margin-top: 4px; }
  .xingji-dialog-error { color: #b26d78; font-size: 12px; line-height: 1.6; min-height: 1em; }
  .xingji-dialog-error:empty { display: none; }
  .xingji-backfill-panel { width: min(520px, calc(100vw - 40px)); }
  @media (max-width: 920px) {
    .xingji-layout { grid-template-columns: minmax(0, 1fr); }
    .xingji-rail { position: static; display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); }
  }
  @media (max-width: 640px) {
    .xingji-rail { grid-template-columns: minmax(0, 1fr); }
    .xingji-hero { align-items: flex-start; }
    .xingji-agent-foot { align-items: flex-start; }
    .xingji-meter-row { grid-template-columns: minmax(0, 1fr); }
  }
  @media (max-width: 420px) {
    .xingji-stats { grid-template-columns: minmax(0, 1fr); }
  }
  @media (prefers-reduced-motion: reduce) {
    .xingji-job-bar.is-indeterminate i { animation: none; width: 100% !important; opacity: .4; }
    .xingji-candidates summary::before { transition: none; }
  }

  /* ── 心情线 ── */
  .moodline-overview {
    display: flex; align-items: baseline; justify-content: space-between;
    gap: 12px; flex-wrap: wrap; margin: 0 0 14px;
  }
  .moodline-overview-title { font-size: 20px; color: var(--primary-deep); letter-spacing: 2px; }
  .moodline-overview-tip { color: var(--muted); font-size: 13px; }
  .moodline-toolbar {
    display: flex; align-items: center; gap: 8px; flex-wrap: wrap;
    margin: 0 0 12px; padding: 0 2px;
  }
  .moodline-toolbar .seg { margin-left: auto; }
  .moodline-date-nav { display: inline-flex; align-items: center; gap: 7px; }
  .moodline-date-label { min-width: 150px; text-align: center; font-size: 13px; color: var(--ink); letter-spacing: 1px; }
  .moodline-range-seg.hidden { display: none; }
  /* 周期规律：把已经发生的周期排成一条能看出长短的横条 */
  .period-pattern {
    max-width: 980px; margin: 14px auto 0; padding: 4px 6px;
    background: var(--card); border: 1px solid var(--line); border-radius: var(--radius);
    box-shadow: var(--shadow);
  }
  .period-pattern.hidden { display: none; }
  /* 平时只是一行入口，点开才摊开规律 */
  .pp-toggle {
    width: 100%; display: flex; align-items: center; gap: 10px;
    border: none; background: none; cursor: pointer; text-align: left;
    padding: 10px 12px; border-radius: 12px; transition: background .15s; font-family: inherit;
  }
  .pp-toggle:hover { background: var(--primary-soft); }
  .pp-toggle .pp-title { font-size: 15px; color: var(--primary-deep); font-weight: 700; letter-spacing: 1px; }
  .pp-hint { color: var(--muted); font-size: 12px; margin-left: auto; }
  .pp-arrow {
    flex: none; width: 8px; height: 8px; margin: 0 2px 3px 2px;
    border-right: 2px solid var(--primary-deep); border-bottom: 2px solid var(--primary-deep);
    transform: rotate(45deg); transition: transform .2s;
  }
  .pp-toggle[aria-expanded="true"] .pp-arrow { transform: rotate(-135deg); margin-bottom: -3px; }
  .pp-body { padding: 2px 14px 14px; }
  .pp-body.hidden { display: none; }
  .pp-head {
    display: flex; align-items: baseline; justify-content: space-between;
    gap: 10px; flex-wrap: wrap; margin-bottom: 12px;
  }
  .pp-title { font-size: 17px; color: var(--ink); letter-spacing: 1px; }
  .pp-caption { color: var(--muted); font-size: 12px; }
  .pp-now { font-size: 13px; color: var(--ink); margin-bottom: 12px; letter-spacing: .5px; }
  .pp-now b { color: var(--period); font-size: 16px; }
  .pp-now-dot {
    display: inline-block; width: 7px; height: 7px; border-radius: 50%;
    background: var(--period); margin-right: 6px; vertical-align: middle;
  }
  .pp-now.overdue { color: var(--warm); }
  .pp-bars { display: flex; flex-direction: column; gap: 7px; margin-bottom: 14px; }
  .pp-row { display: grid; grid-template-columns: 52px 1fr 54px; align-items: center; gap: 9px; }
  .pp-row-label { font-size: 12px; color: var(--muted); letter-spacing: .5px; }
  .pp-row-track { background: var(--period-soft); border-radius: 999px; height: 14px; overflow: hidden; }
  .pp-row-fill { display: block; height: 100%; border-radius: 999px; background: linear-gradient(90deg, var(--accent-light), var(--period)); }
  .pp-row-val { font-size: 12px; color: var(--muted); text-align: right; }
  .pp-stats { display: flex; flex-wrap: wrap; gap: 10px; margin-bottom: 12px; }
  .pp-stat { flex: 1 1 150px; background: var(--period-soft); border-radius: var(--radius-sm); padding: 9px 12px; }
  .pp-stat-label { display: block; font-size: 11px; color: var(--muted); margin-bottom: 3px; }
  .pp-stat-value { font-size: 14px; color: var(--ink); letter-spacing: .5px; }
  .pp-stat-value b { color: var(--period); font-size: 17px; }
  .pp-next {
    font-size: 13px; color: var(--ink); line-height: 1.9; padding: 9px 12px;
    background: var(--warm-soft); border-radius: var(--radius-sm);
  }
  .pp-next b { color: var(--accent-deep); }
  .pp-thin { color: var(--muted); font-size: 12px; }
  @media (max-width: 640px) {
    .pp-row { grid-template-columns: 44px 1fr 48px; }
  }
  .moodline-card {
    max-width: 980px; margin: 0 auto; padding: 18px 20px 16px;
    background: var(--card); border: 1px solid var(--line); border-radius: var(--radius);
    box-shadow: var(--shadow);
  }
  .moodline-card-head {
    display: flex; align-items: baseline; justify-content: space-between;
    gap: 10px; flex-wrap: wrap; margin-bottom: 10px;
  }
  .moodline-card-title { font-size: 17px; color: var(--ink); letter-spacing: 1px; }
  .moodline-card-caption { color: var(--muted); font-size: 12px; }
  .moodline-plot {
    position: relative; width: 100%; overflow: hidden; border: 1px solid var(--line); border-radius: 16px;
    background: #fffdf9; padding: 8px 8px 3px;
  }
  .moodline-svg { display: block; width: 100%; height: auto; min-height: 218px; }
  .moodline-svg .moodline-guide { fill: none; stroke: var(--line); stroke-width: 1; }
  .moodline-svg .moodline-guide.minor { opacity: .58; }
  .moodline-svg .moodline-path {
    fill: none; stroke: url(#moodline-grad); stroke-width: 3;
    stroke-linecap: round; stroke-linejoin: round;
  }
  .moodline-svg .moodline-wash { fill: url(#moodline-wash); stroke: none; pointer-events: none; }
  .moodline-svg .moodline-axis { fill: var(--muted); font-size: 11px; }
  .moodline-svg .moodline-x-label { fill: var(--muted); font-size: 10.5px; }
  .moodline-svg .moodline-point { cursor: pointer; outline: none; }
  .moodline-svg .moodline-dot { stroke: #fffdf9; stroke-width: 3; transition: stroke .14s, stroke-width .14s, filter .14s; }
  .moodline-svg .moodline-point.light .moodline-dot { fill: var(--primary); }
  .moodline-svg .moodline-point.light.auto .moodline-dot { fill: var(--primary-light); }
  .moodline-svg .moodline-point.steady .moodline-dot { fill: var(--warm); }
  .moodline-svg .moodline-point.steady.auto .moodline-dot { fill: var(--warm-light); }
  .moodline-svg .moodline-point.heavy .moodline-dot { fill: var(--accent); }
  .moodline-svg .moodline-point.heavy.auto .moodline-dot { fill: var(--accent-light); }
  /* 伙伴线：与用户的线同轴并排，空心圆点 + 专属描边色，曲线细一号 */
  .moodline-svg .moodline-path.partner { fill: none; stroke-width: 2.2; }
  .moodline-svg .moodline-point.partner .moodline-dot { fill: #fffdf9; stroke-width: 2.6; }
  .moodline-legend-item .moodline-legend-mark.partner { border-radius: 50%; background: transparent; }
  .moodline-svg .moodline-point:focus-visible .moodline-dot,
  .moodline-svg .moodline-point:focus .moodline-dot,
  .moodline-svg .moodline-point:hover .moodline-dot { stroke: #fffdf9; stroke-width: 4; filter: drop-shadow(0 0 2px rgba(232, 155, 176, .78)); }
  .moodline-hover-tip {
    position: absolute; z-index: 3; pointer-events: none; max-width: min(360px, calc(100% - 16px));
    padding: 5px 9px; border: 1px solid #efc1ce; border-radius: 10px;
    background: var(--accent-soft); color: var(--accent-deep); box-shadow: 0 4px 12px rgba(201, 111, 135, .16);
    font-size: 10px; line-height: 1.45; white-space: normal; overflow-wrap: anywhere; text-align: left;
    opacity: 0; transform: translate(-50%, -100%); transition: opacity .12s ease, transform .12s ease;
  }
  .moodline-hover-tip.visible { opacity: 1; }
  .moodline-svg .moodline-point-label { fill: var(--ink); font-size: 11px; text-anchor: middle; }
  .moodline-svg .moodline-point-source { fill: var(--muted); font-size: 9px; text-anchor: middle; }
  .moodline-svg .moodline-count { fill: var(--muted); font-size: 9px; text-anchor: middle; }
  /* 伙伴线末端的名字：像终点站站牌，白描边保证压在彩线上也读得清 */
  .moodline-svg .moodline-partner-label {
    font-size: 10.5px; stroke: #fffdf9; stroke-width: 2.6px; paint-order: stroke;
    stroke-linejoin: round; pointer-events: none;
  }
  .moodline-below {
    display: flex; align-items: center; justify-content: space-between;
    gap: 10px; flex-wrap: wrap; margin-top: 10px;
  }
  .moodline-legend { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; color: var(--muted); font-size: 11px; }
  .moodline-legend-item { display: inline-flex; align-items: center; gap: 4px; }
  .moodline-legend-mark { width: 9px; height: 9px; border-radius: 99px; display: inline-block; background: var(--primary); }
  .moodline-legend-mark.auto { background: var(--primary-light); }
  /* 伙伴图例是可点的开关：点一下把这条际遇线（曲线、圆点、下面的条目）收起来，再点展开 */
  .moodline-legend-toggle {
    border: 1px solid var(--line); background: #fffdf9; color: var(--muted);
    border-radius: 99px; padding: 3px 9px; font: inherit; font-size: 11px; line-height: 1.5;
    cursor: pointer; transition: all .14s;
  }
  .moodline-legend-toggle:hover { border-color: var(--primary); background: var(--primary-soft); color: var(--primary-deep); }
  .moodline-legend-toggle.off { filter: grayscale(1); opacity: .5; }
  .moodline-legend-toggle.off:hover { opacity: .72; }
  .moodline-legend-note { color: var(--muted); font-size: 11px; }
  .moodline-note { color: var(--muted); font-size: 11px; }
  .mood-view-link {
    border: 1px solid #d8e7dc; background: transparent; color: var(--primary-deep);
    border-radius: 99px; padding: 4px 9px; font: inherit; font-size: 11px;
    cursor: pointer; transition: all .14s;
  }
  .mood-view-link:hover { border-color: var(--primary); background: var(--primary-soft); transform: translateY(-1px); }
  .moodline-entries {
    display: flex; flex-wrap: wrap; gap: 6px; margin-top: 10px;
    padding-top: 10px; border-top: 1px solid var(--line);
  }
  .moodline-entry {
    display: inline-flex; align-items: center; gap: 4px; border: 1px solid #e6ddcb;
    background: #fff; color: #625a4d; border-radius: 99px; padding: 4px 9px;
    font: inherit; font-size: 12px; cursor: pointer; transition: all .14s;
  }
  .moodline-entry:hover { border-color: var(--primary); background: var(--primary-soft); transform: translateY(-1px); }
  .moodline-entry.auto { color: #8a8174; border-style: dashed; background: #fcfaf4; }
  .moodline-entry .entry-seg { color: var(--muted); font-size: 10px; }
  .moodline-empty { padding: 42px 18px; text-align: center; color: var(--muted); font-size: 13px; line-height: 1.9; }
  .moodline-empty b { color: var(--primary-deep); font-weight: 400; }
  @media (max-width: 560px) {
    .moodline-card { padding: 14px 10px 12px; }
    .moodline-toolbar .seg { margin-left: 0; }
    .moodline-date-label { min-width: 122px; font-size: 12px; }
    .moodline-svg { min-height: 190px; }
    .moodline-plot { padding: 5px 3px 1px; }
  }
  @media (prefers-reduced-motion: reduce) {
    .moodline-entry, .mood-view-link, .moodline-dot, .moodline-hover-tip, .moodline-legend-toggle { transition: none; }
    .moodline-entry:hover, .mood-view-link:hover { transform: none; }
  }

  /* ── 详情面板 ── */
  .detail {
    background: var(--card); border: 1px solid var(--line);
    border-radius: var(--radius); padding: 18px 20px; margin-top: 14px;
    box-shadow: var(--shadow);
  }
  .detail-head {
    display: flex; flex-wrap: wrap; align-items: baseline; gap: 10px; margin-bottom: 12px;
    border-bottom: 1px solid var(--line); padding-bottom: 10px;
  }
  .detail-head h3 { font-size: 17px; letter-spacing: 1px; }
  .detail-head .wk { font-size: 13px; color: var(--muted); }
  /* 节日归到标题行：它是「那天是什么日子」，跟日期同层的小注脚，不做成按钮模样 */
  .detail-head .detail-fests { display: inline-flex; flex-wrap: wrap; gap: 8px; align-items: baseline; }
  .detail-head .detail-fests:empty { display: none; }
  .detail-head .detail-fest { font-size: 12.5px; color: var(--primary-deep); letter-spacing: .3px; }
  .detail-head .detail-fest.legal { color: #3f7d63; }
  .detail .empty { color: var(--muted); font-size: 13px; line-height: 1.8; }
  .fest-row { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 12px; }
  .fest-chip {
    font-size: 12px; padding: 3px 10px; border-radius: 99px;
    background: var(--primary-soft); color: var(--primary-deep);
  }
  .fest-chip.legal { background: #e3f0ea; color: #3f7d63; }
  .workday-note { font-size: 12px; color: #b97a45; background: var(--warm-soft); border-radius: 8px; padding: 5px 10px; margin-bottom: 12px; display: inline-block; }
  .event-row {
    display: flex; align-items: center; gap: 10px;
    padding: 9px 4px; border-bottom: 1px dashed var(--line);
  }
  .event-row:last-child { border-bottom: none; }
  .event-row .bar { width: 3px; height: 22px; border-radius: 99px; flex: none; }
  .event-row .bar.b-event { background: var(--primary); }
  .event-row .bar.b-anniversary { background: var(--accent); }
  .event-row .bar.b-todo { background: var(--warm); }
  .event-row .bar.b-period { background: var(--period); }
  .event-row .type { font-size: 11px; padding: 2px 7px; border-radius: 6px; flex: none; }
  .event-row .type.t-event { background: var(--primary-soft); color: var(--primary-deep); }
  .event-row .type.t-anniversary { background: var(--accent-soft); color: var(--accent-deep); }
  .event-row .type.t-todo { background: var(--warm-soft); color: #b97a45; }
  .event-row .type.t-period { background: var(--period-soft); color: var(--period); }
  .event-row .title { flex: 1; font-size: 14px; }
  .event-row .title .note { color: var(--muted); font-size: 12px; margin-left: 6px; }
  .event-row .title .todo-time {
    display: inline-block; margin-left: 7px; padding: 2px 6px; border-radius: 6px;
    background: var(--warm-soft); color: #b97a45; font-size: 11px; white-space: nowrap;
  }
  .event-row .title .todo-time.missing { color: #b88790; background: #fdf0f2; }
  .event-row .del {
    border: none; background: none; color: #c9bfae; cursor: pointer;
    font-size: 13px; padding: 4px 8px; min-width: 30px; min-height: 30px; border-radius: 99px; transition: all .15s;
  }
  .event-row .del:hover { color: var(--accent-deep); background: var(--accent-soft); }
  .event-row .focus-start-link { flex: none; border: 0; border-radius: 8px; padding: 5px 8px; background: var(--primary-soft); color: var(--primary-deep); font: inherit; font-size: 12px; cursor: pointer; }

  /* ── 生理期快捷区 ── */
  .period-quick {
    display: flex; align-items: center; gap: 8px; flex-wrap: wrap;
    background: transparent; border: none; border-left: 2px solid rgba(217, 138, 150, 0.4);
    border-radius: 0; padding: 2px 0 2px 10px; margin-bottom: 10px;
  }
  .period-quick.on { background: transparent; border-left-color: rgba(217, 138, 150, 0.65); }
  .period-quick .pq-dot {
    width: 8px; height: 8px; border-radius: 99px; background: var(--period); flex: none;
    box-shadow: 0 0 0 3px rgba(217, 138, 150, 0.18);
  }
  .period-quick .pq-text { font-size: 13px; color: #a05b66; flex: 1; }
  .period-quick .pq-text b { font-size: 16px; font-family: "Poppins", "Segoe UI", sans-serif; }
  .period-quick .pq-btn {
    border: 1px solid rgba(217, 138, 150, 0.4); background: #fff; color: #a05b66;
    font-size: 12px; padding: 4px 12px; border-radius: 99px; cursor: pointer; transition: all .15s;
  }
  .period-quick .pq-btn:hover { background: var(--period-soft); border-color: var(--period); }
  .period-quick .pq-btn.primary { background: var(--period); border-color: var(--period); color: #fff; }
  .period-quick .pq-btn.primary:hover { background: #cf7a87; }
  .period-quick .pq-picker { display: inline-flex; gap: 6px; align-items: center; }
  .period-quick .pq-picker.hidden { display: none; }
  .period-quick .pq-picker input[type="date"] {
    font-family: inherit; border: 1px solid rgba(217, 138, 150, 0.4); border-radius: 8px;
    padding: 3px 8px; font-size: 12px; background: #fff; color: var(--ink);
  }

  /* ── 记什么：三格并排，选中的一眼看得出 ── */
  .type-tabs { display: flex; gap: 6px; margin-bottom: 6px; }
  .type-tab {
    flex: 1 1 auto; border: 1px solid var(--line); background: #fff; color: var(--muted);
    font-size: 13px; padding: 9px 6px; border-radius: 12px; cursor: pointer; transition: all .15s; white-space: nowrap;
  }
  .type-tab:hover { border-color: var(--primary); color: var(--primary-deep); }
  .type-tab.active { background: var(--primary-soft); border-color: var(--primary); color: var(--primary-deep); font-weight: 600; }
  .type-tab:disabled { opacity: .5; cursor: default; }
  .type-tab:disabled:hover { border-color: var(--line); color: var(--muted); }
  .type-tip {
    font-size: 12px; color: var(--muted); letter-spacing: .5px;
    padding: 0 2px 10px; line-height: 1.6;
  }

  /* ── 待办勾选 ── */
  .todo-check {
    width: 18px; height: 18px; border-radius: 99px; border: 2px solid #d8c9b4;
    background: #fff; cursor: pointer; flex: none; position: relative; transition: all .15s;
  }
  .todo-check:hover { border-color: var(--warm); }
  .todo-check.checked { background: var(--warm); border-color: var(--warm); }
  .todo-check.checked::after {
    content: ""; position: absolute; left: 5px; top: 2px; width: 4px; height: 8px;
    border: solid #fff; border-width: 0 2px 2px 0; transform: rotate(45deg);
  }
  .event-row.done .title { color: #b7ab97; text-decoration: line-through; }
  .event-row.done .type { opacity: .6; }
  .todo-due {
    margin-left: 5px; padding: 1px 7px; border-radius: 99px;
    background: var(--accent-soft); color: var(--accent-deep); font-size: 11px; white-space: nowrap;
  }
  .todo-repeat-tag { display: inline-block; margin-left: 5px; padding: 1px 7px; border-radius: 99px; background: #edf5ef; color: var(--primary-deep); font-size: 10px; white-space: nowrap; }

  /* ── 记一笔：一张自己的卡，先选类型再填内容 ── */
  .add-card {
    margin-top: 14px; padding: 14px 16px;
    background: var(--card); border: 1px solid #cfe5d8; border-radius: var(--radius);
    box-shadow: var(--shadow);
  }
  .add-head {
    display: flex; align-items: baseline; justify-content: space-between;
    gap: 10px; flex-wrap: wrap; margin-bottom: 10px;
  }
  .add-title { color: var(--primary-deep); font-size: 15px; font-weight: 700; letter-spacing: 1px; }
  .add-form { display: block; }
  .add-form input {
    font-family: inherit; border: 1px solid var(--line); border-radius: 10px;
    padding: 8px 12px; font-size: 13px; background: #fff; color: var(--ink);
    transition: border-color .15s;
  }
  .add-form input:not(.todo-time-input) { width: 100%; box-sizing: border-box; }
  .add-form input:focus { outline: none; border-color: var(--primary); }
  .add-form input::placeholder { color: #c9bfae; }
  .add-form #new-title { margin-bottom: 8px; }
  .add-form #new-note { margin-bottom: 8px; }
  .add-actions {
    display: flex; align-items: center; justify-content: flex-end; gap: 8px;
    flex-wrap: nowrap; margin-top: 12px;
  }
  .add-actions .btn { flex: none; }
  .add-date-note { color: var(--muted); font-size: 12px; white-space: nowrap; }
  .add-date-note.past-note { color: #b88790; white-space: normal; }
  .todo-reminder {
    flex-basis: 100%; display: flex; align-items: center; gap: 7px; flex-wrap: wrap;
    padding: 8px 10px; background: var(--warm-soft);
    border: 1px solid rgba(203, 157, 101, 0.32); border-radius: 12px;
  }
  .todo-reminder.hidden { display: none; }
  .todo-reminder-label { color: #a96f3f; font-size: 12px; font-weight: 600; }
  .todo-time-label { color: var(--muted); font-size: 11px; white-space: nowrap; }
  .todo-time-input {
    width: 86px; margin-left: 3px; padding: 5px 7px; font: 12px "Poppins", "Segoe UI", sans-serif;
    color: var(--ink); background: #fff; border: 1px solid rgba(203, 157, 101, 0.4); border-radius: 8px;
  }
  .add-form .todo-time-input { flex: none; min-width: 0; }
  .todo-time-input:focus { outline: none; border-color: var(--warm); }
  .todo-time-sep { color: #b97a45; font-size: 12px; }
  .todo-time-preview { color: #b97a45; font-size: 11px; line-height: 1.5; }
  .todo-repeat { flex-basis: 100%; display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
  .todo-repeat-label { color: var(--muted); font-size: 12px; }
  .todo-repeat select { border: 1px solid var(--line); border-radius: 8px; padding: 5px 8px; color: var(--ink); background: #fff; font: inherit; font-size: 12px; }
  .todo-repeat .dd {
    --accent: var(--primary); --accent-deep: var(--primary-deep); --accent-soft: var(--primary-soft);
    --dd-ring: rgba(93, 174, 142, .16);
    width: 148px; flex: none;
  }
  .todo-repeat .dd-trigger { min-height: 32px; padding: 6px 10px; font-size: 12px; }
  .todo-repeat .dd-trigger:focus-visible { outline: 2px solid var(--primary); outline-offset: 2px; }
  .todo-repeat .dd.disabled .dd-trigger { opacity: .58; cursor: not-allowed; }
  .todo-repeat .dd.disabled .dd-trigger:hover { border-color: var(--line); background-color: var(--card); }
  .todo-repeat-days { display: flex; align-items: center; gap: 5px; flex-wrap: wrap; }
  .todo-repeat-days.hidden { display: none; }
  .todo-repeat-day { display: inline-flex; align-items: center; justify-content: center; width: 28px; height: 28px; border: 1px solid #d9e7dc; border-radius: 50%; color: var(--muted); background: #fff; font-size: 11px; cursor: pointer; }
  .todo-repeat-day input { position: absolute; opacity: 0; pointer-events: none; }
  .todo-repeat-day:has(input:checked) { border-color: var(--primary); background: var(--primary-soft); color: var(--primary-deep); font-weight: 700; }
  .todo-repeat-note { color: var(--faint); font-size: 11px; flex-basis: 100%; }
  .todo-time-error {
    flex-basis: 100%; color: #b26d78; font-size: 12px; line-height: 1.5; padding: 0 2px;
  }
  .todo-time-error.hidden { display: none; }
  .btn {
    border: 1px solid var(--line); background: var(--card); color: var(--ink);
    padding: 7px 16px; border-radius: 10px; cursor: pointer; font-size: 13px;
    transition: all .15s;
  }
  .btn:hover { border-color: var(--primary); color: var(--primary-deep); }
  .btn.primary { background: var(--primary); color: #fff; border-color: var(--primary); }
  .btn.primary:hover { background: #6daa90; color: #fff; transform: translateY(-1px); box-shadow: var(--shadow); }
  .btn:disabled { opacity: .55; cursor: default; transform: none; box-shadow: none; }

  /* ── 时光册页面 ── */
  .summary-msg { color: var(--muted); font-size: 13px; }
  .summary-batch { margin: 14px auto 0; padding: 12px 14px; background: var(--primary-soft); border: 1px solid #cfe5d8; border-radius: 14px; max-width: 760px; }
  .summary-batch.hidden { display: none; }
  .summary-batch-head { display: flex; align-items: baseline; justify-content: space-between; gap: 10px; flex-wrap: wrap; margin-bottom: 8px; }
  .summary-batch-title { color: var(--primary-deep); font-size: 14px; font-weight: 700; }
  .summary-batch-tip { color: var(--muted); font-size: 12px; }
  .summary-batch-dates { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; min-height: 26px; }
  .summary-batch-dates.empty { color: var(--muted); font-size: 12px; }
  .summary-batch-chip { display: inline-flex; align-items: center; gap: 5px; padding: 4px 8px 4px 10px; border: 1px solid #b9d9c6; border-radius: 99px; background: #fff; color: var(--primary-deep); font: 12px "Poppins", "Segoe UI", sans-serif; }
  .summary-batch-chip button { border: none; background: none; color: var(--muted); padding: 0; cursor: pointer; font-size: 15px; line-height: 1; }
  .summary-batch-actions { position: sticky; bottom: 0; display: flex; align-items: center; justify-content: flex-end; gap: 7px; flex-wrap: wrap; margin-top: 9px; padding-top: 7px; background: var(--primary-soft); }
  .summary-batch-count { color: var(--muted); font-size: 12px; margin-right: auto; }
  .summary-batch-actions .btn { padding: 5px 11px; }
  .summary-batch-toggle { margin-left: auto; white-space: nowrap; }
  .cal-day.batch-selected { border: 2px solid var(--primary-deep); padding: 5px 6px; background: #f1faf5; box-shadow: 0 0 0 3px rgba(77, 138, 112, 0.16), var(--shadow); }
  .cal-day.batch-selected .num { color: var(--primary-deep); font-weight: 700; }
  .cal-day.batch-selected::after { content: "✓"; position: absolute; right: 6px; bottom: 6px; width: 15px; height: 15px; display: inline-flex; align-items: center; justify-content: center; border-radius: 99px; background: var(--primary-deep); color: #fff; font: 600 10px/1 "Segoe UI", sans-serif; }
  .cal-day.batch-disabled { opacity: .42; cursor: default; }
  .cal-day.batch-disabled:hover { border-color: var(--line); box-shadow: none; transform: none; }
  @media (max-width: 560px) {
    .calendar { gap: 4px; padding: 8px; }
    .cal-day { height: 58px; min-height: 0; max-height: 58px; padding: 5px 4px; border-radius: 10px; }
    .cal-day .tags { max-height: 34px; }
    .cal-day .num { font-size: 12px; }
    .cal-day .today-tag { font-size: 8px; padding: 1px 3px; letter-spacing: 0; }
    .cal-day .tag { font-size: 9px; padding: 1px 3px; }
    .cal-day .tag.more { display: none; }
    .cal-day.selected, .cal-day.batch-selected { padding: 4px 3px; }
    .cal-day.selected .tags { padding-right: 14px; }
    .cal-day.selected::after, .cal-day.batch-selected::after { right: 3px; bottom: 3px; width: 13px; height: 13px; }
    .month-bar .month-title { min-width: 96px; font-size: 16px; }
    .summary-batch-actions { justify-content: flex-start; }
    .summary-batch-count { width: 100%; margin-right: 0; }
    .todo-reminder { gap: 6px; }
    .todo-time-input { width: 78px; }
    .todo-time-preview { flex-basis: 100%; margin-left: 2px; }
  }
  @media (max-width: 380px) {
    .todo-reminder { flex-direction: column; align-items: flex-start; gap: 4px; }
    .todo-time-preview { flex-basis: auto; margin-left: 0; }
    .todo-time-sep { margin-left: 18px; }
  }
  .summary-overview { display: flex; align-items: baseline; justify-content: space-between; gap: 12px; flex-wrap: wrap; margin: 0 0 14px; }
  .summary-overview-title { font-size: 20px; color: var(--primary-deep); letter-spacing: 2px; }
  .summary-overview-tip { color: var(--muted); font-size: 13px; }
  .summary-jobs { max-width: 980px; margin: 18px auto 14px; padding: 11px 14px; border: 1px solid var(--line); border-radius: 14px; background: var(--card); }
/* 两个提示栏相邻时不要叠成两倍间距（进度卡下面又跟一张待补/自动整理卡） */
.summary-jobs + .summary-jobs { margin-top: 10px; }
  .summary-jobs.hidden { display: none; }
  .summary-job-head { display: flex; align-items: center; justify-content: space-between; gap: 10px; color: var(--primary-deep); font-size: 13px; font-weight: 700; }
  .summary-job-status { color: var(--muted); font-size: 12px; font-weight: 400; }
  .summary-job-track { height: 7px; margin: 9px 0 6px; border-radius: 99px; background: #e9efe9; overflow: hidden; }
  .summary-job-progress { height: 100%; border-radius: inherit; background: var(--primary); transition: width .25s ease; }
  .summary-job-detail { color: var(--muted); font-size: 12px; line-height: 1.6; }
  .summary-job-error { margin-top: 3px; color: var(--accent-deep); font-size: 12px; }
  .summary-job-failed { margin-top: 8px; display: flex; flex-direction: column; gap: 4px; }
  .summary-job-failed-item { font-size: 12px; color: var(--muted); line-height: 1.5; }
  .summary-job-failed-item::before { content: '✗ '; color: var(--accent-deep); }
  .summary-job-actions { margin-top: 8px; display: flex; gap: 8px; flex-wrap: wrap; }
  .summary-job-retry-btn, .summary-job-cancel-btn, .summary-job-dismiss-btn { margin-top: 0; }
  .summary-auto-note { margin-top: 10px; padding-top: 9px; border-top: 1px solid #eef3ee; }
  .summary-auto-note.paused .summary-job-status { color: var(--accent-deep); }
  .summary-auto-head { display: flex; align-items: center; justify-content: space-between; gap: 10px; color: var(--primary-deep); font-size: 13px; font-weight: 700; }
  .summary-auto-detail { margin-top: 4px; color: var(--muted); font-size: 12px; line-height: 1.6; }
  .archive { display: flex; flex-direction: column; gap: 10px; }
  /* 按月 → 按天 → 按伙伴 三级分组：天的小节标题（像日记本翻页） */
  .day-title {
    display: flex; align-items: center; gap: 8px;
    margin: 8px 2px 2px; padding: 6px 2px 4px;
    border-bottom: 1px solid var(--line);
  }
  .day-title::before {
    content: ''; width: 4px; height: 14px; border-radius: 2px;
    background: var(--primary); flex-shrink: 0;
  }
  .day-title .day-date {
    font-size: 15px; font-weight: 600; color: var(--ink);
    letter-spacing: 1px; font-variant-numeric: tabular-nums;
    font-family: "Poppins", "Segoe UI", sans-serif;
  }
  .day-title .day-label {
    font-size: 12px; color: var(--muted); letter-spacing: 2px;
  }
  .archive-item {
    background: var(--card); border: 1px solid var(--line); border-radius: var(--radius);
    padding: 14px 18px; box-shadow: var(--shadow); transition: all .16s;
  }
  .archive-item:hover { box-shadow: var(--shadow-up); transform: translateY(-1px); }
  .archive-item .a-date {
    display: inline-block; font-size: 12px; color: #fff; background: var(--primary);
    border-radius: 99px; padding: 2px 12px; margin-bottom: 8px; letter-spacing: 1px;
    font-family: "Poppins", "Segoe UI", sans-serif; font-variant-numeric: tabular-nums;
  }
  .archive-item .a-agent { display: inline-block; margin: 0 0 8px 6px; padding: 2px 9px; border-radius: 99px; background: var(--primary-soft); color: var(--primary-deep); font-size: 12px; }
  .archive-item .a-agent.legacy { background: #f3eee5; color: var(--muted); }
  .archive-item .a-moods {
    margin: 0 0 6px 6px; padding: 7px 10px 6px;
    background: #fbf6ea; border: 1px solid #efe4cd; border-radius: 10px;
  }
  .archive-item .a-moods .mood-block-title { display: inline-flex; margin-right: 6px; font-size: 11px; }
  .archive-item .a-moods .mood-block-title::after { display: none; }
  .archive-item .a-text { font-size: 14px; line-height: 1.9; color: #5a5549; }
  .archive-actions { display: flex; gap: 7px; margin-top: 10px; flex-wrap: wrap; }
  .archive-actions button { border: none; background: var(--primary-soft); color: var(--primary-deep); padding: 4px 10px; border-radius: 99px; cursor: pointer; font-family: inherit; }
  .archive-actions button.danger { background: var(--accent-soft); color: var(--accent-deep); }
  .archive-editor { width: 100%; min-height: 92px; border: 1px solid var(--line); border-radius: 10px; padding: 10px; font: inherit; color: var(--ink); background: #fff; resize: vertical; }
  .archive-empty {
    background: var(--card); border: 1px dashed var(--line); border-radius: var(--radius);
    padding: 34px 20px; text-align: center; color: var(--muted); font-size: 13px; line-height: 2;
  }

  /* ── 详情面板内的这一页区块 ── */
  .sum-block {
    margin-top: 14px; background: var(--card); border: 1px solid var(--line);
    border-radius: 12px; padding: 12px 14px; box-shadow: var(--shadow);
  }
  .sum-block.empty { background: transparent; border: 1px dashed var(--line); box-shadow: none; }
  .sum-block .sum-head { display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-bottom: 8px; }
  .sum-block .sum-actions { display: flex; align-items: center; gap: 2px; flex-wrap: wrap; justify-content: flex-end; }
  .sum-block .sum-title { font-size: 13px; font-weight: 700; color: var(--primary-deep); }
  .sum-block .sum-link { border: none; background: none; color: var(--primary-deep); font-size: 12px; cursor: pointer; font-family: inherit; padding: 2px 6px; border-radius: 6px; }
  .sum-block .sum-link:hover { background: var(--primary-soft); }
  .sum-block .sum-link:disabled { opacity: .58; cursor: wait; }
  .sum-block .sum-text {
    font-size: 13px; color: var(--ink); line-height: 1.85; white-space: pre-wrap;
    max-height: 220px; overflow-y: auto;
  }
  .sum-agent + .sum-agent { margin-top: 10px; padding-top: 10px; border-top: 1px solid var(--line); }
  .sum-agent-name { display: block; margin-bottom: 4px; color: var(--primary-deep); font-size: 12px; font-weight: 700; }
  .sum-block .sum-text.muted { color: var(--muted); }
  .sum-block .sum-msg { display: inline-block; margin-left: 8px; font-size: 12px; color: var(--muted); }
  .sum-block .sum-preview {
    margin-top: 10px; white-space: pre-wrap; background: var(--primary-soft);
    border-radius: 10px; padding: 10px 12px; color: var(--primary-deep); font-size: 12px; line-height: 1.7;
  }
  .sum-block .sum-preview.hidden { display: none; }
  .archive-empty b { color: var(--primary-deep); font-weight: 500; }

  /* ── 和小花聊聊：对话式修订小窗 ── */
  .summary-chat-panel {
    position: relative; width: min(520px, calc(100vw - 28px)); height: min(650px, 84vh);
    background: var(--card); border-radius: 22px;
    box-shadow: 0 18px 54px rgba(60, 45, 25, 0.26); overflow: hidden;
    display: flex; flex-direction: column;
  }
  .summary-chat-head { flex: 0 0 auto; align-items: flex-start; }
  .summary-chat-heading { min-width: 0; }
  .summary-chat-subtitle { display: block; margin-top: 3px; color: var(--muted); font-size: 11px; letter-spacing: 0; }
  .summary-chat-context {
    flex: 0 0 auto; position: relative; z-index: 2;
    margin: 10px 16px 0; padding: 7px 10px; border: 1px solid var(--line); border-radius: 10px;
    color: var(--muted); font-size: 11px; background: var(--card);
  }
  .summary-chat-context summary { cursor: pointer; color: var(--primary-deep); }
  .summary-chat-original { margin-top: 7px; max-height: 82px; overflow-y: auto; white-space: pre-wrap; line-height: 1.65; color: var(--ink); }
  .summary-chat-messages {
    flex: 1 1 auto; min-height: 0; overflow-y: auto;
    padding: 14px 16px; display: flex; flex-direction: column; gap: 9px;
  }
  .summary-chat-bubble {
    max-width: 84%; padding: 9px 12px; border-radius: 14px;
    font-size: 13px; line-height: 1.65; white-space: pre-wrap; word-break: break-word;
  }
  .summary-chat-bubble.assistant { align-self: flex-start; background: var(--primary-soft); color: var(--primary-deep); border-bottom-left-radius: 5px; }
  .summary-chat-bubble.user { align-self: flex-end; background: #f5e8dd; color: var(--ink); border-bottom-right-radius: 5px; }
  .summary-chat-bubble.thinking { align-self: flex-start; color: var(--muted); background: #f4f0e9; }
  .summary-chat-bubble.error { align-self: flex-start; color: var(--accent-deep); background: var(--accent-soft); }
  .summary-chat-suggestion {
    flex: 0 1 42%; min-height: 0; margin: 0 16px 10px; padding: 11px 12px;
    border: 1px solid #b9d7c8; border-radius: 14px; background: #f2faf6;
    display: flex; flex-direction: column; gap: 8px; overflow: hidden;
  }
  .summary-chat-suggestion[hidden] { display: none; }
  .summary-chat-suggestion-title { color: var(--primary-deep); font-size: 13px; font-weight: 700; }
  .summary-chat-diff { flex: 1 1 auto; min-height: 0; overflow-y: auto; display: grid; gap: 7px; }
  .summary-chat-version { padding: 8px 9px; border-radius: 9px; background: rgba(255,255,255,.72); }
  .summary-chat-version b { display: block; margin-bottom: 4px; color: var(--muted); font-size: 11px; }
  .summary-chat-version.after b { color: var(--primary-deep); }
  .summary-chat-version-text { color: var(--ink); font-size: 12px; line-height: 1.65; white-space: pre-wrap; }
  .summary-chat-suggestion-actions { display: flex; justify-content: flex-end; gap: 8px; padding-top: 2px; }
  .summary-chat-composer { padding: 11px 16px 14px; border-top: 1px solid var(--line); background: var(--card); }
  .summary-chat-composer-row { display: flex; gap: 8px; align-items: flex-end; }
  .summary-chat-input {
    flex: 1; min-height: 42px; max-height: 96px; resize: none;
    border: 1px solid var(--line); border-radius: 12px; padding: 9px 11px;
    background: #fff; color: var(--ink); font: inherit; font-size: 13px; line-height: 1.5;
  }
  .summary-chat-input:focus { outline: none; border-color: var(--primary); }
  .summary-chat-hint { margin-top: 5px; color: var(--muted); font-size: 10px; }

  /* ── 设置弹窗（无边框 + 柔和阴影，内部 1px 细线分隔） ── */
  .set-modal { position: fixed; inset: 0; z-index: 9999; display: flex; align-items: center; justify-content: center; }
  .set-modal[hidden] { display: none; }
  /* 遮罩不叠 backdrop-filter：模糊要对着背后整页实时重算，点开和滚动弹窗都跟着卡。
     2px 的模糊几乎看不出来，改用略深一点的半透明色，观感几乎一样，开销只是填一层矩形。 */
  .set-modal-mask { position: absolute; inset: 0; background: rgba(58, 48, 36, 0.5); }
  .set-modal-panel {
    position: relative;
    width: min(460px, calc(100vw - 40px));
    max-height: 84vh;
    display: flex; flex-direction: column;
    background: var(--card);
    border-radius: 22px;
    box-shadow: 0 18px 54px rgba(60, 45, 25, 0.26);
    overflow: hidden;
  }
  .set-modal-head {
    display: flex; align-items: center; justify-content: space-between;
    padding: 15px 20px;
    border-bottom: 1px solid var(--line);
  }
  .set-modal-title { font-size: 16px; font-weight: 600; letter-spacing: 2px; }
  .set-modal-close {
    border: none; background: none; font-size: 22px; line-height: 1;
    color: var(--muted); cursor: pointer; padding: 2px 8px; border-radius: 99px; transition: all .15s;
  }
  .set-modal-close:hover { color: var(--accent-deep); background: var(--accent-soft); }
  .set-modal-body {
    padding: 16px 20px 20px;
    overflow-y: auto;
    display: flex; flex-direction: column; gap: 16px;
  }
  .set-group {
    border: 1px solid var(--line); border-radius: 16px; padding: 14px 16px;
  }
  .set-group h3 { font-size: 15px; letter-spacing: 1px; margin-bottom: 4px; }
  .set-desc { font-size: 12px; color: var(--muted); margin-bottom: 10px; line-height: 1.7; }
  .set-row { display: flex; align-items: center; gap: 12px; padding: 6px 0; font-size: 14px; flex-wrap: wrap; }
  .set-label { width: 86px; flex: none; color: var(--ink); }
  .set-label-sub { width: auto; color: var(--muted); font-size: 13px; }
  .set-tip { font-size: 12px; color: var(--muted); line-height: 1.6; }
  /* 反馈入口：检查更新下线后只剩一栏，双栏外壳一并收掉 */
  .uc-fb-body { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; min-height: 30px; }
  .uc-fb-note { font-size: 12px; color: var(--muted); line-height: 1.6; margin-top: 8px; }
  .summary-agent-picker { flex: 1 1 360px; min-width: 220px; }
  .summary-agent-options { display: grid; grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); gap: 6px; }
  .summary-agent-option {
    display: flex; align-items: center; gap: 7px; min-width: 0;
    border: 1px solid var(--line); border-radius: 10px; padding: 7px 9px;
    background: var(--card); color: var(--ink); font-size: 12px; cursor: pointer;
  }
  .summary-agent-option:hover { border-color: var(--primary); background: var(--primary-soft); }
  .summary-agent-option input { flex: none; accent-color: var(--primary); }
  .summary-agent-option span { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .summary-agent-actions { display: flex; gap: 12px; margin-top: 7px; }
  .set-input, .set-select {
    font-family: inherit; border: 1px solid var(--line);
    border-radius: 10px; padding: 7px 11px; font-size: 13px;
    background: #fff; color: var(--ink); flex: 1; min-width: 130px;
  }
  .set-input:focus, .set-select:focus { outline: none; border-color: var(--primary); }
  .mc-key-control { display: flex; align-items: center; gap: 8px; flex: 1; min-width: 220px; }
  .mc-key-control .set-input { min-width: 0; }
  .mc-key-toggle {
    flex: none; border: 1px solid var(--line); background: var(--card);
    color: var(--muted); border-radius: 8px; padding: 6px 10px;
    font: inherit; font-size: 12px; cursor: pointer;
  }
  .mc-key-toggle:hover { border-color: var(--primary); color: var(--primary-deep); background: var(--primary-soft); }
  .weather-region-selects {
    flex: 1 1 360px; min-width: 250px; display: flex; gap: 8px; flex-wrap: wrap;
  }
  .weather-region-field {
    flex: 1 1 105px; min-width: 100px; display: flex; flex-direction: column; gap: 4px;
    color: var(--muted); font-size: 11px;
  }
  .weather-region-field .dd { width: 100%; max-width: none; }
  .weather-region-field .dd-trigger { width: 100%; }
  .weather-region-field .dd-trigger:disabled,
  .weather-region-field .dd.disabled .dd-trigger { opacity: .52; cursor: not-allowed; }
  .weather-clear-btn { flex: none; align-self: flex-end; }
  .seg { display: inline-flex; gap: 6px; }
  .seg-btn {
    font-family: inherit;
    border: 1px solid var(--line); background: var(--card);
    color: var(--muted); padding: 5px 15px; border-radius: 99px;
    font-size: 13px; cursor: pointer; transition: all .15s;
  }
  .seg-btn:hover { border-color: var(--primary); color: var(--primary-deep); }
  .seg-btn.active { background: var(--primary); border-color: var(--primary); color: #fff; box-shadow: var(--shadow); }
  /* 聊天 / Code 两屏切换：填充色就是状态，薄荷绿=聊天窗口，雾蓝=Code 页 */
  .context-mode-switch .seg-btn[data-mode="chat"].active { background: var(--primary); border-color: var(--primary); }
  .context-mode-switch .seg-btn[data-mode="code"].active { background: var(--code-accent); border-color: var(--code-accent); }
  .context-mode-note {
    margin: 2px 0 10px; padding: 7px 11px; border-radius: 10px;
    font-size: 12px; line-height: 1.65;
    background: var(--primary-soft); color: var(--primary-deep);
    transition: background .18s, color .18s;
  }
  .context-mode-note[data-mode="code"] {
    background: var(--code-soft); color: var(--code-deep);
    border: 1px solid var(--code-line);
  }
  /* 整块面板跟着换底，切到哪屏一眼看得出 */
  #context-mode-panel {
    border: 1px solid var(--line); border-radius: 14px;
    padding: 8px 12px 2px; background: var(--card);
    transition: background .18s, border-color .18s;
  }
  #context-mode-panel[data-mode="code"] { background: var(--code-soft); border-color: var(--code-line); }
  #context-mode-panel[data-mode="code"] .set-tip { color: var(--code-deep); opacity: .8; }
  #context-mode-panel[data-mode="code"] .summary-agent-option { background: #fff; }
  #context-mode-panel[data-mode="code"] .summary-agent-option:hover { border-color: var(--code-accent); background: #fff; }
  .save-btn { margin-top: 8px; }
  .link-btn {
    border: none; background: none; padding: 0; font-size: 12px;
    color: var(--warm); text-decoration: underline; cursor: pointer;
  }
  .link-btn:hover { color: #b97a45; }
  /* 模型配置 */
  .mc-warn {
    margin: 0 0 12px; padding: 9px 13px;
    border-left: 3px solid var(--warm);
    background: rgba(217, 154, 90, 0.10); border-radius: 10px;
    font-size: 12.5px; line-height: 1.75; color: #a9713c;
  }
  .mc-current {
    margin-bottom: 12px; padding: 9px 13px;
    border-left: 3px solid var(--primary);
    background: var(--primary-soft); border-radius: 10px;
    font-size: 13px; color: var(--primary-deep);
  }
  .mc-sources { display: flex; gap: 6px; margin-bottom: 12px; }
  .mc-source-btn {
    font-family: inherit; flex: 1 1 auto; min-width: 0;
    border: 1px solid var(--line); background: var(--card);
    color: var(--muted); padding: 8px 6px; border-radius: 10px;
    font-size: 12.5px; cursor: pointer; transition: all .15s;
    white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
  }
  .mc-source-btn:hover { border-color: var(--primary); color: var(--primary-deep); }
  .mc-source-btn.active {
    background: var(--primary-soft); border-color: var(--primary); color: var(--primary-deep); font-weight: 600;
  }
  .mc-actions {
    display: flex; align-items: center; gap: 10px;
    margin-top: 14px; padding-top: 13px; border-top: 1px solid var(--line); flex-wrap: nowrap;
  }
  .mc-actions .spacer { flex: 1; }
  .mc-actions .btn { flex: none; }
  /* 测试结果独立成行：文字再长也不挤压按钮，按钮位置保持固定 */
  .mc-test-result {
    margin: 9px 0 0; font-size: 12px; color: var(--muted);
    line-height: 1.6; white-space: pre-wrap; overflow-wrap: anywhere;
  }
  .mc-test-result:empty { display: none; }
  .mc-hana-fields { display: flex; gap: 12px; align-items: flex-end; flex-wrap: wrap; }
  .mc-hana-fields .mc-field { flex: 1 1 170px; min-width: 140px; max-width: 220px; font-size: 12px; color: var(--muted); }
  .mc-hana-fields .dd { width: 100%; }
  .mc-hana-fields .dd-trigger { min-height: 34px; padding: 6px 10px; font-size: 13px; }
  .set-row .dd { flex: 1; max-width: 220px; }
  .set-row .weather-region-field .dd { max-width: none; }

  /* ── 滚动条（细薄荷圆条） ── */
  *::-webkit-scrollbar { width: 8px; height: 8px; }
  *::-webkit-scrollbar-track { background: transparent; }
  *::-webkit-scrollbar-thumb { background: #c9dfd3; border-radius: 99px; border: 2px solid var(--bg); }
  *::-webkit-scrollbar-thumb:hover { background: var(--primary); }
  * { scrollbar-width: thin; scrollbar-color: #c9dfd3 transparent; }
  .set-modal-body::-webkit-scrollbar-thumb { border-color: var(--card); }
  .settings-save-sticky { position: sticky; bottom: 0; z-index: 8; width: 100%; padding: 10px 16px; box-shadow: 0 -8px 18px rgba(96, 74, 40, .08); }

  .hidden { display: none !important; }
  .toast {
    position: fixed; bottom: 26px; left: 50%; transform: translateX(-50%);
    background: var(--ink); color: #fff; padding: 10px 22px;
    border-radius: 12px; font-size: 13px; opacity: 0;
    transition: opacity .3s; pointer-events: none; z-index: 99999;
    box-shadow: 0 8px 24px rgba(0,0,0,.18); letter-spacing: 1px;
  }
  .toast.show { opacity: 1; }
  ${bsCss}
  ${fbCss}
  /* 反馈弹窗盖在设置弹窗之上（z-index 提升一层） */
  .fb-modal { z-index: 10001; }
</style>
</head>
<body>

<!-- 头部 -->
<div class="header">
  <div class="brand">
    <h1>拾光记</h1>
    <span class="sub">捡拾起每一天的光</span>
  </div>
  <div class="header-actions">
    <button class="go-today-btn" onclick="goToday()">回到今天</button>
    <button class="focus-mini-indicator hidden" id="focus-mini-indicator" onclick="switchTab('focus')" type="button"></button>
    <button class="context-toggle-btn" id="context-toggle-btn" onclick="toggleInjectionQuick()" aria-pressed="true">聊天情境·开</button>
    <button class="context-toggle-btn code" id="code-context-toggle-btn" onclick="toggleCodeInjectionQuick()" aria-pressed="true">Code 情境·开</button>
    <button class="settings-btn" onclick="openSettingsModal()">设置</button>
  </div>
</div>

<!-- 今日概览：整体可点击，点了展开今天详情（记一笔的替代入口） -->
<section class="today-card" id="today-card" role="button" tabindex="0" onclick="goToday()" onkeydown="if(event.key==='Enter'||event.key===' '){goToday()}">
  <svg id="today-weather-icon" class="today-weather-icon weather-sun" width="46" height="46" viewBox="0 0 46 46" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-label="当前天气">
    <circle cx="23" cy="23" r="7" fill="currentColor" opacity=".18"/>
    <path d="M23 5v5M23 36v5M5 23h5M36 23h5M10.5 10.5l3.5 3.5M32 32l3.5 3.5M35.5 10.5L32 14M14 32l-3.5 3.5"/>
  </svg>
  <div class="today-date">
    <span class="big-day" id="today-bigday">--</span>
    <div class="ym">
      <span class="year" id="today-year"></span>
      <span class="month" id="today-month"></span>
    </div>
  </div>
  <div class="today-body">
    <div class="today-fest" id="today-fest"></div>
    <div class="today-events" id="today-events"></div>
    <div class="today-quiet hidden" id="today-weather"></div>
    <div class="today-quiet hidden" id="today-quiet">今天没什么特别的日子，但也是好日子<em> ✿</em></div>
  </div>
</section>

<!-- 导航 -->
<div class="nav-tabs">
  <button id="tab-calendar" class="active" onclick="switchTab('calendar')">日历</button>
  <button id="tab-focus" onclick="switchTab('focus')">专注</button>
  <button id="tab-summary" onclick="switchTab('summary')">时光册</button>
  <button id="tab-moodline" onclick="switchTab('moodline')">心情线</button>
  <button id="tab-xingji" onclick="switchTab('xingji')">拾性<small>（实验性）</small></button>
</div>

<!-- 日历页 -->
<div id="panel-calendar">
  <div class="month-bar">
    <button class="icon-btn nav-prev" onclick="shiftMonth(-1)" title="上个月">‹</button>
    <span class="month-title" id="month-title"></span>
    <button class="icon-btn nav-next" onclick="shiftMonth(1)" title="下个月">›</button>
    <button class="btn summary-batch-toggle" id="summary-batch-toggle" onclick="toggleSummaryBatchMode()">选几天做成册</button>
  </div>
  <div class="calendar" id="calendar"></div>
  <div class="calendar-guide hidden" id="calendar-guide">点任意日期，记下那天的事 ✿</div>
  <div class="summary-batch hidden" id="summary-batch-panel">
    <div class="summary-batch-head">
      <span class="summary-batch-title">选几天做成册</span>
      <span class="summary-batch-tip">只处理已经结束的日子；还没翻篇的昨天和以后的日子选不了。点日期可以反复选择。</span>
    </div>
    <div class="summary-batch-dates empty" id="summary-batch-dates">还没选日期</div>
    <div class="summary-batch-actions">
      <span class="summary-batch-count" id="summary-batch-count">已选 0 天</span>
      <span class="summary-msg" id="summary-batch-msg"></span>
      <button class="btn" onclick="clearSummaryBatchDates()">清空</button>
      <button class="btn primary" id="summary-batch-run-btn" onclick="runSummaryBatch()">做成册</button>
      <button class="btn hidden" id="partner-mood-backfill-btn" onclick="runPartnerMoodBackfill()" title="给选中的日子补伙伴的际遇心情线；只收情绪，不会改动已定稿的总结页">补记伙伴心情</button>
      <button class="btn" onclick="toggleSummaryBatchMode(false)">取消</button>
    </div>
  </div>
  <div class="summary-jobs hidden" id="summary-jobs-calendar"></div>
  <div class="summary-jobs hidden" id="partner-mood-jobs-calendar"></div>
  <div class="detail hidden" id="detail">
    <div class="detail-head">
      <h3 id="detail-title">点一个日子看看</h3>
      <span class="wk" id="detail-wk"></span>
      <span class="detail-fests" id="detail-fests"></span>
    </div>
    <div id="detail-body" class="empty">选一天，看看那天有什么好日子。</div>
  </div>
  <!-- 周期规律：只把已经发生过的周期摆出来，够次数才给汇总与预计。平时收成一行，点开才摊开 -->
  <section class="period-pattern hidden" id="period-pattern">
    <button class="pp-toggle" id="pp-toggle" type="button" onclick="togglePeriodPattern()" aria-expanded="false" aria-controls="pp-body">
      <span class="pp-title">生理期规律</span>
      <span class="pp-hint" id="pp-hint"></span>
      <span class="pp-arrow" aria-hidden="true"></span>
    </button>
    <div class="pp-body hidden" id="pp-body">
      <div class="pp-caption">只看已经记下的，不给你打分</div>
      <div class="pp-now" id="pp-now"></div>
      <div class="pp-bars" id="pp-bars"></div>
      <div class="pp-stats" id="pp-stats"></div>
      <div class="pp-next" id="pp-next"></div>
    </div>
  </section>
</div>

<!-- 心情线页：把一天与连续日期的心情变化画成一条柔和的手绘线 -->
<div id="panel-moodline" class="hidden">
  <div class="moodline-overview">
    <div>
      <h2 class="moodline-overview-title">心情线</h2>
      <span class="moodline-overview-tip">看一天，也看一段日子；只记变化，不给心情打分。</span>
    </div>
    <button class="btn" onclick="switchTab('calendar')">回到日历</button>
  </div>
  <div class="moodline-toolbar">
    <div class="moodline-date-nav">
      <button class="icon-btn nav-prev" onclick="shiftMoodLine(-1)" title="往前看">‹</button>
      <span class="moodline-date-label" id="moodline-date-label"></span>
      <button class="icon-btn nav-next" onclick="shiftMoodLine(1)" title="往后看">›</button>
    </div>
    <div class="seg" id="moodline-mode-seg">
      <button class="seg-btn active" data-mode="day" onclick="switchMoodLineMode('day')">一天</button>
      <button class="seg-btn" data-mode="range" onclick="switchMoodLineMode('range')">连续</button>
    </div>
    <div class="seg moodline-range-seg hidden" id="moodline-range-seg">
      <button class="seg-btn active" data-days="7" onclick="switchMoodLineRange(7)">7 天</button>
      <button class="seg-btn" data-days="14" onclick="switchMoodLineRange(14)">14 天</button>
      <button class="seg-btn" data-days="30" onclick="switchMoodLineRange(30)">30 天</button>
    </div>
  </div>
  <div class="moodline-card" id="moodline-card">
    <div class="moodline-empty">正在把这段心情铺开…</div>
  </div>
</div>

<!-- 拾性页：从一个名字下反复出现的行为里，慢慢看出 ta 是什么样 -->
<div id="panel-xingji" class="hidden">
  <div class="xingji-page">
    <div class="xingji-hero">
      <div class="xingji-hero-main">
        <h2 class="xingji-hero-title">拾性<small>（实验性）</small></h2>
        <p class="xingji-hero-tip">不评价性格，也不猜心。只把 ta 反复做过的动作，连同当时的原话，慢慢攒成一条条看得见的做法；再拿这些做法跟你给 ta 写的性格设定对一遍，看哪些已经活出来了，哪些是设定里没写、但 ta 本来就这样。</p>
      </div>
      <div class="xingji-hero-actions">
        <button class="btn primary" type="button" id="xingji-backfill-btn" onclick="openXingjiBackfill()">补记以前的</button>
        <button class="btn" type="button" onclick="switchTab('calendar')">回到日历</button>
      </div>
    </div>

    <div class="xingji-stats" id="xingji-stats">
      <div class="xingji-stat"><b id="xingji-stat-agents">–</b><span>位伙伴在看</span></div>
      <div class="xingji-stat is-warm"><b id="xingji-stat-pending">–</b><span>段观察还没归类</span></div>
      <div class="xingji-stat is-accent"><b id="xingji-stat-standing">–</b><span>条已经长成</span></div>
    </div>

    <div id="xingji-job-slot"></div>

    <div class="xingji-layout">
      <div class="xingji-main" id="xingji-body">
        <div class="moodline-card"><div class="moodline-empty">正在翻这些日子…</div></div>
      </div>
      <aside class="xingji-rail" aria-label="拾性说明">
        <section class="xingji-guide">
          <h3>一条是怎么长出来的</h3>
          <ol>
            <li><span class="xingji-guide-num">1</span><b>每天翻篇时</b>从往来里挑几个瞬间，记下「什么情况下、ta 怎么做」。</li>
            <li><span class="xingji-guide-num">2</span><b>攒够才成条</b>同一个做法至少落在 3 个不同日子、跨满 21 天，才写进档案。</li>
            <li><span class="xingji-guide-num">3</span><b>你说了算</b>每条都能点开原话；觉得不对就拉掉，不会影响伙伴。</li>
          </ol>
          <div class="xingji-example">
            <span class="xingji-example-label">一条长这样</span>
            <p><span>被催的时候</span> → <b>先应一声，再按自己的节奏做完</b></p>
            <p>后面挂着几次原话，来自不同的日子。</p>
          </div>
        </section>
        <section class="xingji-privacy">
          拾性只在本机记账，默认不会把这里写下的东西塞回对话，也不影响伙伴怎么回应你。
        </section>
      </aside>
    </div>
  </div>
</div>

<!-- 专注页：计时与日常记录连在一起，不另造任务清单 -->
<div id="panel-focus" class="hidden">
  <div class="focus-overview">
    <div>
      <h2 class="focus-overview-title">专注</h2>
      <span class="focus-overview-tip">留一小段时间，安心做眼前这件事。</span>
    </div>
    <button class="btn" onclick="switchTab('calendar')">回到日历</button>
  </div>
  <div class="focus-layout">
    <section class="focus-card focus-timer-card" id="focus-timer-card" aria-label="专注计时"></section>
    <details class="focus-records" id="focus-records">
      <summary>专注足迹 · 今天与近 7 天</summary>
      <div class="focus-records-body">
        <p class="focus-week-summary" id="focus-week-summary">正在整理专注记录…</p>
        <div class="focus-week-bars" id="focus-week-bars"></div>
        <h3 class="focus-card-title">今天的专注</h3>
        <div class="focus-session-list" id="focus-session-list"><div class="empty">正在读取…</div></div>
      </div>
    </details>
  </div>
  <details class="focus-note"><summary>记录本机加密；选伙伴时同步目标、时长与约定</summary><p>选择伙伴后，拾光记会把这次的目标、时长和陪伴约定同步给茶话会；茶话会里的对话不会回显在拾光记。相关信息只用于这次联动，不进入主对话或通用情境。专注时暂停普通主动消息，暂停或结束后恢复；聊天只触发少量提醒，不读取其他伙伴的聊天正文。记录加密保存在本机，心情由你决定。</p></details>
</div>

<!-- 时光册页：整体浏览与管理已经做好的页面 -->
<div id="panel-summary" class="hidden">
  <div class="summary-overview">
    <div>
      <h2 class="summary-overview-title">时光册</h2>
      <span class="summary-overview-tip">一天一页，几天成册；已经做好的时光都放在这里。</span>
    </div>
    <button class="btn" onclick="switchTab('calendar')">回到日历</button>
  </div>
  <div class="summary-jobs hidden" id="summary-jobs"></div>
  <p class="set-tip">这里可以翻看、编辑和管理每一天的页面；想新做一页，回到日历点选日期。</p>
  <div class="archive" id="summaries-list"></div>
</div>

<div class="toast" id="toast"></div>

<!-- 拾性补记：先说清范围、花费和能不能中途离开，再开始 -->
<div class="set-modal" id="xingji-backfill-modal" hidden>
  <div class="set-modal-mask" onclick="closeXingjiBackfill()"></div>
  <div class="set-modal-panel xingji-backfill-panel" role="dialog" aria-modal="true" aria-labelledby="xingji-backfill-title">
    <div class="set-modal-head">
      <span class="set-modal-title" id="xingji-backfill-title">补记以前的时光</span>
      <button class="set-modal-close" type="button" onclick="closeXingjiBackfill()" title="关闭">×</button>
    </div>
    <div class="set-modal-body">
      <p class="xingji-dialog-lead">拾性平时只在每天翻篇时慢慢看。补记会把以前的会话翻一遍，再逐天请模型看，补上错过的那些日子。</p>
      <div class="xingji-range" id="xingji-range-block">
        <span class="xingji-range-label" id="xingji-range-label">补哪一段</span>
        <div class="seg" id="xingji-range-seg">
          <button class="seg-btn active" type="button" data-range="30" onclick="setXingjiRange('30')">最近 30 天</button>
          <button class="seg-btn" type="button" data-range="90" onclick="setXingjiRange('90')">最近 90 天</button>
          <button class="seg-btn" type="button" data-range="all" onclick="setXingjiRange('all')">从最早开始</button>
        </div>
        <p class="xingji-range-note" id="xingji-range-note"></p>
      </div>
      <div class="xingji-cost-note">
        <p><b>翻会话不花钱。</b>逐天观察会调用模型；有你们往来的日子才会问，每位伙伴一天最多一次。</p>
        <p id="xingji-cost-estimate"></p>
        <p>已经补过的日子会跳过，不会重复问模型。</p>
      </div>
      <div class="xingji-dialog-foot">
        <button class="btn" type="button" onclick="closeXingjiBackfill()">先不补</button>
        <button class="btn primary" type="button" id="xingji-backfill-start" onclick="startXingjiBackfill()">开始补记</button>
      </div>
      <p class="xingji-dialog-error" id="xingji-backfill-error"></p>
    </div>
  </div>
</div>

<div class="set-modal" id="confirm-modal" hidden>
  <div class="set-modal-mask" onclick="closeConfirm()"></div>
  <div class="set-modal-panel" style="max-width:420px;height:auto;max-height:none">
    <div class="set-modal-head"><span class="set-modal-title">确认一下</span><button class="set-modal-close" onclick="closeConfirm()">×</button></div>
    <div class="set-modal-body">
      <p id="confirm-text" style="line-height:1.8"></p>
      <div style="display:flex;justify-content:flex-end;gap:8px">
        <button class="btn" onclick="closeConfirm()">取消</button>
        <button class="btn primary" onclick="confirmYes()">确定</button>
      </div>
    </div>
  </div>
</div>

<!-- 对话式修订：自然语言聊清楚 → 建议预览 → 用户确认后才落库 -->
<div class="set-modal" id="summary-chat-modal" hidden>
  <div class="set-modal-mask"></div>
  <div class="summary-chat-panel" role="dialog" aria-modal="true" aria-labelledby="summary-chat-title">
    <div class="set-modal-head summary-chat-head">
      <div class="summary-chat-heading">
        <span class="set-modal-title" id="summary-chat-title">和小花聊聊这一页</span>
        <span class="summary-chat-subtitle" id="summary-chat-subtitle"></span>
      </div>
      <button class="set-modal-close" onclick="closeSummaryChat()" title="关闭">×</button>
    </div>
    <details class="summary-chat-context">
      <summary>看看当前这一页</summary>
      <div class="summary-chat-original" id="summary-chat-original"></div>
    </details>
    <div class="summary-chat-messages" id="summary-chat-messages"></div>
    <div class="summary-chat-suggestion" id="summary-chat-suggestion" hidden>
      <div class="summary-chat-suggestion-title">我们说好的修改建议</div>
      <div class="summary-chat-diff">
        <div class="summary-chat-version"><b>修改前</b><div class="summary-chat-version-text" id="summary-chat-before"></div></div>
        <div class="summary-chat-version after"><b>修改后</b><div class="summary-chat-version-text" id="summary-chat-after"></div></div>
      </div>
      <div class="summary-chat-suggestion-actions">
        <button class="btn" onclick="continueSummaryChat()">继续聊聊</button>
        <button class="btn primary" id="summary-chat-confirm" onclick="confirmSummaryChat()">确认修改</button>
      </div>
    </div>
    <div class="summary-chat-composer">
      <div class="summary-chat-composer-row">
        <textarea class="summary-chat-input" id="summary-chat-input" maxlength="1000" placeholder="告诉小花哪里不对、想怎么改…"></textarea>
        <button class="btn primary" id="summary-chat-send" onclick="sendSummaryChat()">发送</button>
      </div>
      <div class="summary-chat-hint">Enter 发送，Shift + Enter 换行；没点确认前不会修改。</div>
    </div>
  </div>
</div>

<!-- 设置弹窗（二级弹窗） -->
<div class="set-modal" id="set-modal" hidden>
  <div class="set-modal-mask" onclick="closeSettingsModal()"></div>
  <div class="set-modal-panel">
    <div class="set-modal-head">
      <span class="set-modal-title">设置</span>
      <button class="set-modal-close" onclick="closeSettingsModal()" title="关闭">×</button>
    </div>
    <div class="set-modal-body">
      <div class="set-group">
        <h3>情境注入</h3>
        <p class="set-desc">聊天窗口和 Code 页共用这一组，切到哪屏就在配哪屏；两屏颜色不一样，一眼看得出在哪边。</p>
        <div class="set-row">
          <div class="seg context-mode-switch" id="context-mode-seg">
            <button class="seg-btn active" data-mode="chat" aria-selected="true">聊天窗口</button>
            <button class="seg-btn" data-mode="code" aria-selected="false">Code 页</button>
          </div>
        </div>
        <p class="context-mode-note" id="context-mode-note" data-mode="chat">聊天窗口：日子、天气、待办和峰谷按下面这套带。</p>
        <div id="context-mode-panel" data-mode="chat">
          <div id="context-panel-chat">
            <div class="set-row">
              <span class="set-label">聊天情境</span>
              <div class="seg" id="injection-enabled-seg">
                <button class="seg-btn active" data-val="true">开</button>
                <button class="seg-btn" data-val="false">关</button>
              </div>
            </div>
            <p class="set-tip hidden" id="injection-disabled-tip">当前不带入聊天对话；Code 页有自己的开关，不受这里影响。峰谷关照是单独的开关，也不受这里影响。</p>
            <div class="set-row">
              <span class="set-label">单独关闭</span>
              <div class="summary-agent-picker" id="injection-agent-picker"><span class="set-tip">读取中…</span></div>
            </div>
            <p class="set-tip">勾选的伙伴不会收到拾光记情境；其他伙伴和全局设置不受影响。</p>
            <div id="injection-options">
              <div class="set-row">
                <span class="set-label">带入方式</span>
                <div class="seg" id="mode-seg">
                  <button class="seg-btn" data-mode="economical">适时</button>
                  <button class="seg-btn active" data-mode="balanced">相伴</button>
                  <button class="seg-btn" data-mode="always">常在</button>
                </div>
              </div>
              <div class="set-row" id="mode-tip-row"><span class="set-tip" id="mode-tip"></span></div>
              <div class="set-row hidden" id="interval-row">
                <span class="set-label">回来多久后更新</span>
                <div class="seg" id="interval-seg">
                  <button class="seg-btn" data-val="0.5">30 分钟</button>
                  <button class="seg-btn" data-val="1">1 小时</button>
                  <button class="seg-btn active" data-val="4">4 小时</button>
                  <button class="seg-btn" data-val="8">8 小时</button>
                </div>
              </div>
              <div class="set-row hidden" id="interval-extra-row">
                <span class="set-tip" id="interval-tip"></span>
              </div>
            </div>
            <div class="set-row">
              <span class="set-label">峰谷关照</span>
              <div class="seg" id="peak-seg">
                <button class="seg-btn active" data-val="true">开</button>
                <button class="seg-btn" data-val="false">关</button>
              </div>
            </div>
            <p class="set-tip">只对 DeepSeek 系模型生效：认出当前会话用的模型后，在费用更高的时段自然提醒一句。它和上面的情境开关是两回事，关掉情境也能单独留着。Code 页那边由那屏勾选里的「峰谷关照」单独管。</p>
            <div class="set-row">
              <button class="btn" onclick="previewInjection()">看看今天会收到什么</button>
            </div>
            <div class="preview-box hidden" id="inject-preview"></div>
          </div>
          <div id="context-panel-code" class="hidden">
            <div class="set-row">
              <span class="set-label">Code 页注入</span>
              <div class="seg" id="code-injection-seg">
                <button class="seg-btn active" data-val="true">开</button>
                <button class="seg-btn" data-val="false">关</button>
              </div>
            </div>
            <p class="set-tip hidden" id="code-injection-off-tip">一键关掉后，Code 页一句话都不带，连峰谷关照也停着。</p>
            <div class="set-row">
              <span class="set-label">带哪些</span>
              <div class="summary-agent-picker">
                <div class="summary-agent-options" id="code-injection-items"></div>
              </div>
            </div>
            <p class="set-tip">时间不用勾，Code 页每轮都会带；勾上的才带。日记、生理期、做好的回顾默认都不进去。</p>
          </div>
        </div>
      </div>

      <div class="set-group">
        <h3>每日做册</h3>
        <p class="set-desc">一天完整结束后，按伙伴分别把前一天的可见对话做成一页，收进加密时光册；内容会交给你选的模型处理。</p>
        <div class="set-row">
          <span class="set-label">自动做册</span>
          <div class="seg" id="autosum-seg">
            <button class="seg-btn active" data-val="false">关</button>
            <button class="seg-btn" data-val="true">开</button>
          </div>
        </div>
        <div class="set-row">
          <span class="set-label">自动发现情绪</span>
          <div class="seg" id="mood-discovery-seg">
            <button class="seg-btn" data-val="off">关</button>
            <button class="seg-btn active" data-val="economical">轻量</button>
            <button class="seg-btn" data-val="detailed">细致</button>
          </div>
        </div>
        <p class="set-tip" id="mood-discovery-tip" aria-live="polite"></p>
        <div class="set-row" id="partner-mood-row">
          <span class="set-label">伙伴心情线</span>
          <div class="seg" id="partner-mood-seg">
            <button class="seg-btn active" data-val="false">关</button>
            <button class="seg-btn" data-val="true">开</button>
          </div>
        </div>
        <p class="set-tip" id="partner-mood-tip">打开后，每天翻篇时会为做册选中的伙伴整理一条「际遇心情线」，跟你的心情线并排回看：它记的是伙伴那天经历了什么（被夸、被谢、被晾、被需要），每个点都带着能回看的证据，猜不出来就不写。自动情绪发现关着时它也不会跑。</p>
        <div class="set-row" id="xingji-row">
          <span class="set-label">拾性<small>（实验性）</small></span>
          <div class="seg" id="xingji-seg">
            <button class="seg-btn active" data-val="false">关</button>
            <button class="seg-btn" data-val="true">开</button>
          </div>
        </div>
        <p class="set-tip" id="xingji-tip">实验性功能，默认关。打开后会自动收集：每天翻篇时，拾性从你和伙伴的往来里挑几个瞬间，记成两条线：「一贯的做法」记 ta 反复在做的事，「反常的一刻」记 ta 这次没按平时的样子来。记的时候会拿你写的性格设定对照一下，标出这条是设定里写过的、还是设定里没写但 ta 一贯如此。只记看得见的动作，不猜心理，每条都挂着原话；样本不够时只会标成「还在长」，不会写成结论，宁可缺也不硬凑。</p>
        <div class="set-row" id="xingji-inject-row">
          <span class="set-label set-label-sub">把做法接回对话</span>
          <div class="seg" id="xingji-inject-seg">
            <button class="seg-btn active" data-val="false">关</button>
            <button class="seg-btn" data-val="true">开</button>
          </div>
        </div>
        <p class="set-tip" id="xingji-inject-tip">默认关。打开后，每次情境注入会把 ta 那几条一贯的做法写进对话背景，让 ta 照自己平时的样子来。只接做法，「反常的一刻」永远不接——那是记给你看的，不是让 ta 重复的事。关掉情境注入总开关、或把这位伙伴单独屏蔽时，这里也不会生效。</p>
        <div class="set-row" id="boundary-row">
          <span class="set-label">一天何时翻篇</span>
          <select id="boundary-select" class="set-select">
            <option value="0">午夜</option>
            <option value="2">凌晨 2 点</option>
            <option value="4">凌晨 4 点</option>
          </select>
        </div>
        <div class="set-row">
          <span class="set-label">近期动态</span>
          <div class="seg" id="summary-shared-seg">
            <button class="seg-btn active" data-val="false">各自保留</button>
            <button class="seg-btn" data-val="true">共享动态</button>
          </div>
        </div>
        <p class="set-tip">默认每个伙伴只带自己的最近三天；打开后，近期做好的页面才会让其他伙伴也看到。更早的内容只在话题相关时带入。</p>
        <div class="set-row">
          <span class="set-label">做册伙伴</span>
          <div class="summary-agent-picker" id="summary-agent-picker"><span class="set-tip">读取中…</span></div>
        </div>
        <p class="set-tip">这是全局范围，不随日期变化。默认全选；保存后，点击任意日期的「做成一页」只会调用选中的伙伴。</p>
      </div>

      <div class="set-group">
        <h3>生理期记录</h3>
        <p class="set-desc">在日历上记录生理期周期。不想要这个功能就关掉。</p>
        <div class="set-row">
          <span class="set-label">生理期</span>
          <div class="seg" id="period-seg">
            <button class="seg-btn active" data-val="true">开</button>
            <button class="seg-btn" data-val="false">关</button>
          </div>
        </div>
        <p class="set-tip">关闭后日历、添加表单和带进对话的情境里都不会出现生理期，已记的数据会保留。</p>

      </div>

      <div class="set-group">
        <h3>今日天气</h3>
        <p class="set-desc">打开后，主页今日卡会显示天气；情境注入也打开时，天气会成为伙伴收到的今日情境。关掉后不查询，已选地点会保留。</p>
        <div class="set-row">
          <span class="set-label">今日天气</span>
          <div class="seg" id="weather-seg">
            <button class="seg-btn active" data-val="true">开</button>
            <button class="seg-btn" data-val="false">关</button>
          </div>
        </div>
        <div class="set-row">
          <span class="set-label">居住地</span>
          <div class="weather-region-selects" id="weather-region-selects">
            <label class="weather-region-field">省份
              <select id="weather-province" class="set-select">
                <option value="">选择省份</option>
              </select>
            </label>
            <label class="weather-region-field">城市
              <select id="weather-city" class="set-select" disabled>
                <option value="">先选省份</option>
              </select>
            </label>
            <label class="weather-region-field">区县
              <select id="weather-district" class="set-select" disabled>
                <option value="">先选城市</option>
              </select>
            </label>
          </div>
          <button class="btn weather-clear-btn" type="button" onclick="clearWeatherRegion()">清除</button>
        </div>
        <p class="set-tip" id="weather-legacy-note"></p>
        <p class="set-tip">天气会按区县中心点查询，精度到区域附近，不代表具体门牌。Open-Meteo 免费查询，无需配置。</p>
        <div class="set-row">
          <span class="set-label">天气提醒</span>
          <div class="seg" id="weather-alert-seg">
            <button class="seg-btn active" data-val="true">开</button>
            <button class="seg-btn" data-val="false">关</button>
          </div>
        </div>
        <p class="set-tip">只在值得留意时才开口：恶劣天气、大风、明显降温或升温。提醒会在聊天里自然带一句，不发系统通知；同一件事只提一次。</p>
        <button class="btn" id="weather-test-btn" onclick="testWeather()">测试一下</button>
        <span class="summary-msg" id="weather-test-msg"></span>
      </div>

      <div class="set-group">
        <h3>做册用的模型</h3>
        <p class="set-desc">做成一页要走一次模型，选个顺手的。</p>
        <div class="mc-current" id="mc-current">当前使用：读取中…</div>
        <div class="mc-warn hidden" id="mc-thinking-warn"></div>
        <div class="mc-sources">
          <button class="mc-source-btn active" data-source="agent" onclick="mcSetSource('agent')">跟随伙伴</button>
          <button class="mc-source-btn" data-source="hana" onclick="mcSetSource('hana')">从 Hana 模型列表选择</button>
          <button class="mc-source-btn" data-source="custom" onclick="mcSetSource('custom')">自定义 API</button>
        </div>
        <div class="mc-form" id="mc-form-agent">
          <p class="set-tip">使用 Hana 的工具模型；工具模型留空时，才会回落到当前伙伴的主对话模型。</p>
        </div>
        <div class="mc-form" id="mc-form-hana" style="display:none">
          <div class="mc-hana-fields">
            <label class="mc-field">供应商
              <select id="mc-provider" class="set-select"><option value="">加载中…</option></select>
            </label>
            <label class="mc-field">模型
              <select id="mc-model" class="set-select"><option value="">先选供应商</option></select>
            </label>
          </div>
          <p class="set-tip">从 Hana 已配置的模型里选择。插件会读取该供应商的运行时凭据并直连所选模型，不需要另填 Key。列表里没有的供应商，可改用“自定义 API”。</p>
          <p class="set-tip" id="mc-hana-import-detail">选好模型后会显示当前选择。</p>
        </div>
        <div class="mc-form" id="mc-form-custom" style="display:none">
          <div class="set-row">
            <span class="set-label">API 地址</span>
            <input id="mc-custom-url" class="set-input" placeholder="https://api.example.com/v1">
          </div>
          <div class="set-row">
            <span class="set-label">API Key</span>
            <div class="mc-key-control">
              <input type="password" id="mc-custom-key" class="set-input" placeholder="留空表示不修改" autocomplete="off" spellcheck="false">
              <button type="button" class="mc-key-toggle" id="mc-custom-key-toggle" aria-controls="mc-custom-key" aria-pressed="false" onclick="mcToggleKey('mc-custom-key', 'mc-custom-key-toggle')">显示</button>
            </div>
          </div>
          <div class="set-row">
            <span class="set-label">模型名</span>
            <input id="mc-custom-model" class="set-input" placeholder="如 gpt-4o-mini">
          </div>
          <div class="set-row">
            <span class="set-label">接口格式</span>
            <select id="mc-custom-api" class="set-select">
              <option value="openai-completions">OpenAI 兼容（chat/completions）</option>
              <option value="openai-responses">OpenAI 新版（responses）</option>
              <option value="anthropic-messages">Anthropic 格式</option>
            </select>
          </div>
          <p class="set-tip">已预置 OpenAI / Anthropic / DeepSeek / Kimi / 智谱 / MiniMax / 火山 / 百炼 / 硅基流动等常见服务域名；名单外的域名可在插件目录 manifest.json 的 network.allowedHosts 里添加后重启 HanaAgent 生效。</p>
          <p class="set-tip" id="mc-key-hint"></p>
          <div class="set-row">
            <button class="link-btn hidden" id="mc-clear-key-btn" onclick="mcClearKey()">清除已存 Key</button>
          </div>
        </div>
        <div class="mc-actions">
          <button class="btn primary" id="mc-test-btn" onclick="mcTest()">测试一下</button>
          <span class="spacer"></span>
          <button class="btn primary" id="mc-save-btn" onclick="mcSave()">保存模型</button>
        </div>
        <p class="mc-test-result" id="mc-test-result"></p>
      </div>

      <div class="set-group">
        <h3>反馈</h3>
        <div class="uc-fb-body">
          <button type="button" class="fb-open-btn" id="fb-open-btn">反馈</button>
        </div>
        <div class="uc-fb-note">想说啥用大白话讲，它帮你整理成一份清楚的反馈再提交</div>
      </div>
      <div class="set-group hidden" id="legacy-migration-group">
        <h3>从插件版搬数据</h3>
        <p class="set-desc">以前用插件版拾光记记下的日子、待办、时光册和心情，可以搬到这一版来。搬的时候只读旧的，不删也不改；这一版里已经有的文件一个都不覆盖。</p>
        <p class="set-tip" id="legacy-setting-status">正在看看插件版有没有数据…</p>
        <div class="set-row">
          <button class="link-btn" id="legacy-setting-btn" onclick="runLegacyMigrationNow()">检查一下</button>
        </div>
      </div>

      <button class="btn primary settings-save-sticky" onclick="saveAllSettings()">保存全部日常设置</button>
    </div>
  </div>
</div>

<!-- 反馈小助手弹窗（独立于设置弹窗，避免被 overflow 裁切） -->
<div class="fb-modal" id="fb-modal" hidden role="dialog" aria-modal="true" aria-labelledby="fb-modal-title">
  <div class="fb-modal-mask" data-fb-close></div>
  <div class="fb-modal-panel">
    <div class="fb-modal-head">
      <div class="fb-modal-titles"><span class="fb-modal-title" id="fb-modal-title">反馈整理</span><span class="fb-modal-sub">想说啥用大白话讲，它帮你整理成一份清楚的反馈再提交</span></div>
      <button type="button" class="fb-modal-close" data-fb-close aria-label="关闭反馈窗口">×</button>
    </div>
    <div class="fb-messages" id="fb-messages"></div>
    <div class="fb-issue-preview" id="fb-issue-preview" hidden></div>
    <div class="fb-input-row">
      <textarea id="fb-input" placeholder="比如：更新完设置就打不开了…" rows="2"></textarea>
      <button type="button" class="fb-send-btn" id="fb-send-btn">发送</button>
    </div>
    <div class="fb-actions" id="fb-actions" hidden>
      <a class="fb-btn fb-btn-primary" id="fb-submit-link" target="_blank" rel="noopener" hidden>生成提交页</a>
      <button type="button" class="fb-btn" id="fb-copy-btn">复制文案</button>
      <span class="fb-actions-hint" id="fb-actions-hint">检查整理好的内容后再提交</span>
    </div>
  </div>
</div>

<script>${bsJs}</script>
<script>${fbJs}</script>
<script>
${todoTimeClientJs}
// iframe 握手：告诉宿主页面加载完成（宿主不要求时忽略，无害）
window.parent.postMessage({ protocol: 'hana.plugin.ui', version: 1, kind: 'event', type: 'hana.ready' }, '*');
window.__TOKEN = ${JSON.stringify(token)};
var MOOD_LINE_META = ${JSON.stringify(MOOD_LINE_META)};
var MOOD_LINE_SEGMENTS = ${JSON.stringify(MOOD_LINE_SEGMENTS)};
var BASE = '/api/apps/shiguangji-app/routes';
// App 页面走宿主签发的 surface session：宿主随 iframe URL 的 query 下发，请求时用 header 回传。
// （旧版靠 URL 里的 token 参数，App 这套不认。）
function appSurfaceSession() {
  try {
    var m = /[?&]appSurfaceSession=([^&]+)/.exec(window.location.search || '');
    return m ? decodeURIComponent(m[1]) : '';
  } catch (e) { return ''; }
}
function api(path, opts) {
  return apiFetch(path, opts).then(function (r) { return r.json().catch(function () { return { ok: false }; }); });
}
// 带 App 凭证的裸请求，供需要自己处理响应的组件（反馈小助手等）直接注入使用。
function apiFetch(path, init) {
  var options = Object.assign({}, init || {});
  var headers = Object.assign({}, options.headers || {});
  var surface = appSurfaceSession();
  if (surface) headers['X-Hana-App-Surface-Session'] = surface;
  options.headers = headers;
  return fetch(BASE + '/' + String(path || '').replace(/^\\/+/, ''), options);
}

var curYear = new Date().getFullYear();
var curMonth = new Date().getMonth() + 1;
var selectedDate = null;
var editingEventId = '';
var editingTodoNeedsReminderTime = false;
var editingRecurringTodo = false;
var todoReminderManual = false;
// autofilled=true 只表示当前时间值来自标题识别；用户触碰时间输入后必须清零并锁定手动值。
var todoReminderAutofilled = false;
var todoReminderAutofilling = false;
var dayEventCache = {};
var appSettings = { showPeriod: true, injectionEnabled: true, weatherEnabled: true, weatherAlertEnabled: true, moodDiscoveryMode: 'economical', partnerMoodEnabled: false, deepseekPeakEnabled: true, codeInjectionEnabled: true }; // 全局设置缓存（启动时从后端同步）
var focusSnapshot = { active: null, sessions: [], groups: [], favoriteGoals: [], favoriteGoalConfigs: {}, focusConfig: null, stats: null, taskOptions: [] };
var focusSelectedTaskId = '';
var focusSelectedCompanionId = '';
var focusFreeTitle = '';
var focusMinutes = 25;
var focusTotalRounds = 4;
var breakMinutes = 5;
var focusLongBreakEnabled = true;
var focusLongBreakEvery = 4;
var focusLongBreakMinutes = 15;
var focusSettingsInitialized = false;
var focusSettingsTouched = false;
var focusSelectedFavoriteTitle = '';
var focusConfigSaveQueue = Promise.resolve();
var focusConfigSaveSequence = 0;
var focusFavoritePending = false;
var focusTicker = null;
var focusActionPending = false;
var focusAdvancePending = false;
var focusAdvanceRetryAt = 0;
var focusStatusNotice = '';
var focusLastRefreshAt = 0;

var weatherRegions = [];
var weatherRegionsPromise = null;
var summaryAgents = [];
var summaryAgentSelectionLoaded = false;
var injectionAgentSelectionLoaded = false;
var summaryBatchDates = [];
var summarySelectMode = false;
var summaryJobsTimer = null;
var summaryJobWasActive = false;
var partnerMoodJobsTimer = null;
var partnerMoodJobWasActive = false;
var moodLineMode = 'day';
var moodLineDays = 7;
var moodLineAnchorDate = null;
// 连续视图自己的窗口右端，和「一天」看的日期分开：点过哪天不该把这一整段带偏
var moodLineRangeEnd = null;
var moodLineRequestSeq = 0;
// 心情线图例的开关：被收起的伙伴线（key=agentId）。只在当前页面会话内有效，刷新后恢复全显示。
var moodLineHiddenAgents = {};
// 最近一次渲染的入参；点图例收起或展开时原地重绘，不重新拉接口。
var moodLineLastRender = null;
var monthRequestSeq = 0;
var todayRequestSeq = 0;
var todayRefreshTimer = null;
var weatherSettingsState = { location: '', area: null };
var weatherSelectionTouched = false;
var WEEK = ['日', '一', '二', '三', '四', '五', '六'];
var TYPE_NAME = { event: '日子', anniversary: '纪念日', todo: '待办', period: '生理' };
// 新增表单：不同类型的名称占位提示与一句话讲解（切换类型时联动）。
// 按钮名统一两个字：随记 / 纪念 / 待办。
var NEW_TITLE_PLACEHOLDER = {
  event: '记下这一天发生的事',
  anniversary: '每年都会再来的日子',
  todo: '要做的事，标题里的时间会自动填入',
};
var TYPE_TIPS = {
  event: '只记这一天，过了就过了',
  anniversary: '每年都到，比如生日、纪念日',
  todo: '标题里有明确时间会自动填入；也可以设成每天，或每周挑几天重复',
};
function todoRepeatLabel(rule) {
  if (!rule || typeof rule !== 'object') return '';
  if (rule.frequency === 'daily') return '每天';
  if (rule.frequency !== 'weekly' || !Array.isArray(rule.weekdays)) return '';
  return '每周' + rule.weekdays.map(function (day) { return WEEK[Number(day)]; }).filter(Boolean).join('、');
}
var WEATHER_ICON_SVG = {
  sun: '<circle cx="23" cy="23" r="7" fill="currentColor" opacity=".18"></circle>' +
    '<path d="M23 5v5M23 36v5M5 23h5M36 23h5M10.5 10.5l3.5 3.5M32 32l3.5 3.5M35.5 10.5L32 14M14 32l-3.5 3.5"></path>',
  moon: '<path d="M30 8C23 10 19 16 19 23c0 8 6 14 14 14 3 0 6-1 8-3-2 5-7 8-13 8-11 0-19-8-19-18S17 8 27 8c1 0 2 0 3 .2Z" fill="currentColor" opacity=".18"></path>' +
    '<path d="M30 8C23 10 19 16 19 23c0 8 6 14 14 14 3 0 6-1 8-3"></path>',
  partly: '<circle cx="17" cy="16" r="5" fill="currentColor" opacity=".16"></circle>' +
    '<path d="M17 7v3M8 16h3M10.5 9.5l2 2M23.5 9.5l-2 2"></path>' +
    '<path d="M13 36h22c4 0 7-3 7-7s-3-7-7-7c-1 0-2 .2-3 .6C35 17 31 14 26 14c-6 0-10 4-11 9.5C11 23.7 8 26.4 8 30c0 3 2 6 5 6Z" fill="currentColor" opacity=".18"></path>' +
    '<path d="M13 36h22c4 0 7-3 7-7s-3-7-7-7c-1 0-2 .2-3 .6C35 17 31 14 26 14c-6 0-10 4-11 9.5C11 23.7 8 26.4 8 30c0 3 2 6 5 6Z"></path>',
  cloud: '<path d="M8 35h28c4 0 7-3 7-7s-3-7-7-7c-1 0-2 .2-3 .6C32 17 28 14 23 14c-6 0-10 4-11 9.5C8 23.7 5 26.4 5 30c0 3 1 5 3 5Z" fill="currentColor" opacity=".18"></path>' +
    '<path d="M8 35h28c4 0 7-3 7-7s-3-7-7-7c-1 0-2 .2-3 .6C32 17 28 14 23 14c-6 0-10 4-11 9.5C8 23.7 5 26.4 5 30c0 3 1 5 3 5Z"></path>',
  rain: '<path d="M8 31h28c4 0 7-3 7-7s-3-7-7-7c-1 0-2 .2-3 .6C32 13 28 10 23 10c-6 0-10 4-11 9.5C8 19.7 5 22.4 5 26c0 3 1 5 3 5Z" fill="currentColor" opacity=".18"></path>' +
    '<path d="M8 31h28c4 0 7-3 7-7s-3-7-7-7c-1 0-2 .2-3 .6C32 13 28 10 23 10c-6 0-10 4-11 9.5C8 19.7 5 22.4 5 26c0 3 1 5 3 5ZM15 36l-2 5M24 36l-2 5M33 36l-2 5"></path>',
  snow: '<path d="M8 31h28c4 0 7-3 7-7s-3-7-7-7c-1 0-2 .2-3 .6C32 13 28 10 23 10c-6 0-10 4-11 9.5C8 19.7 5 22.4 5 26c0 3 1 5 3 5Z" fill="currentColor" opacity=".18"></path>' +
    '<path d="M8 31h28c4 0 7-3 7-7s-3-7-7-7c-1 0-2 .2-3 .6C32 13 28 10 23 10c-6 0-10 4-11 9.5C8 19.7 5 22.4 5 26c0 3 1 5 3 5ZM16 36v8M12 40h8M13.2 37.2l5.6 5.6M18.8 37.2l-5.6 5.6M30 36v8M26 40h8M27.2 37.2l5.6 5.6M32.8 37.2l-5.6 5.6" stroke-width="2.4"></path>',
  fog: '<path d="M11 16h24M8 24h30M11 32h24M15 40h16"></path>',
  storm: '<path d="M8 31h28c4 0 7-3 7-7s-3-7-7-7c-1 0-2 .2-3 .6C32 13 28 10 23 10c-6 0-10 4-11 9.5C8 19.7 5 22.4 5 26c0 3 1 5 3 5Z" fill="currentColor" opacity=".18"></path>' +
    '<path d="M8 31h28c4 0 7-3 7-7s-3-7-7-7c-1 0-2 .2-3 .6C32 13 28 10 23 10c-6 0-10 4-11 9.5C8 19.7 5 22.4 5 26c0 3 1 5 3 5ZM24 30l-4 7h5l-3 7 8-10h-5l4-4"></path>',
};

function pad(n) { return String(n).padStart(2, '0'); }
function dk(y, m, d) { return y + '-' + pad(m) + '-' + pad(d); }

function weatherIsDay(weather) {
  if (weather && typeof weather.isDay === 'boolean') return weather.isDay;
  if (weather && (weather.isDay === 1 || weather.isDay === 0)) return weather.isDay === 1;
  var line = String(weather && weather.line || '');
  if (line.indexOf('天已经黑') >= 0 || line.indexOf('夜') >= 0) return false;
  if (line.indexOf('清晨') >= 0 || line.indexOf('正午') >= 0 || line.indexOf('傍晚') >= 0) return true;
  var hour = new Date().getHours();
  return hour >= 6 && hour < 20;
}

function weatherIconKind(weather) {
  var rawCode = weather && weather.code;
  var code = rawCode === '' || rawCode == null ? NaN : Number(rawCode);
  if (!Number.isFinite(code)) {
    var line = String(weather && weather.line || '');
    if (/雷|冰雹/.test(line)) return 'storm';
    if (/雨/.test(line)) return 'rain';
    if (/雪|米雪/.test(line)) return 'snow';
    if (/雾|雾凇/.test(line)) return 'fog';
    if (/多云|阴天/.test(line)) return 'cloud';
  }
  if (code === 45 || code === 48) return 'fog';
  if ((code >= 71 && code <= 77) || (code >= 85 && code <= 86)) return 'snow';
  if (code >= 95 && code <= 99) return 'storm';
  if ((code >= 51 && code <= 67) || (code >= 80 && code <= 82)) return 'rain';
  if (code === 1) return weatherIsDay(weather) ? 'partly' : 'moon';
  if (code === 2 || code === 3) return 'cloud';
  return weatherIsDay(weather) ? 'sun' : 'moon';
}

function renderTodayWeatherIcon(weather) {
  var icon = document.getElementById('today-weather-icon');
  if (!icon) return;
  var kind = weatherIconKind(weather);
  icon.setAttribute('class', 'today-weather-icon weather-' + kind + (appSettings.weatherEnabled === false ? ' hidden' : ''));
  icon.innerHTML = WEATHER_ICON_SVG[kind] || WEATHER_ICON_SVG.sun;
  icon.setAttribute('aria-label', weather && weather.line ? weather.line : '当前时段');
}

function applyTodayWeather(weather) {
  var weatherEl = document.getElementById('today-weather');
  renderTodayWeatherIcon(weather);
  if (weather && weather.line) {
    weatherEl.textContent = '窗外：' + weather.line;
    weatherEl.classList.remove('hidden');
    return true;
  }
  weatherEl.textContent = '';
  weatherEl.classList.add('hidden');
  return false;
}

function toast(msg) {
  var t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.add('show');
  setTimeout(function () { t.classList.remove('show'); }, 2200);
}

// ── 从插件版搬数据 ──
// 插件版的数据存在插件目录里，这一版的进程读不到那个目录的裸文件，
// 只能请应用自己的后端去读、去解、再用本应用的密钥写回来。
// 探测与执行都只在看得见的交互里发生（页面打开后探一次 / 她点按钮时执行）。
var legacyProbeState = null;

function legacyFailedTail(probe) {
  var failed = Number(probe && probe.failedCount) || 0;
  if (!failed) return '';
  return '上次还有 ' + failed + ' 项没搬成，再点一次可以补搬。';
}

function legacyProbeText(probe) {
  var advice = probe && probe.advice;
  if (advice === 'migrate') {
    return '发现插件版留下的数据，可以搬进这一版。只读旧的，不删不改；这边已经有的文件一个都不覆盖。' + legacyFailedTail(probe);
  }
  if (advice === 'already-migrated') {
    var moved = (probe.report && probe.report.migratedCount) || 0;
    return '上次已经从插件版搬过 ' + moved + ' 项数据。想再补搬一次也可以，已经搬过来的一样不会重复。' + legacyFailedTail(probe);
  }
  if (advice === 'target-has-data') {
    return '这一版里已经有你自己记下的东西了，所以没有自动搬。想补搬插件版里这边还没有的那些，点下面就行，已经有的一个都不会动。' + legacyFailedTail(probe);
  }
  if (advice === 'blocked') {
    return '读不到插件版的数据目录：' + (probe.detail || '宿主没给资源读取权限') + '。可以到「设置 → 安全 → 应用能力」里确认拾光记的读取权限已经打开。';
  }
  return '没找到插件版留下的数据，不用搬。';
}

function legacyLinkText(probe) {
  var advice = probe && probe.advice;
  if (advice === 'migrate') return '搬进来';
  if (advice === 'already-migrated') return '再补搬一次';
  if (advice === 'target-has-data') return '补搬缺的那些';
  if (advice === 'blocked') return '再试一次';
  return '再检查一次';
}

function setLegacySettingStatus(probe) {
  legacyProbeState = probe || null;
  var advice = probe && probe.advice;
  // 只在有话要说时才露面：有插件版数据可搬、已经搬过、或者搬不成需要她去看权限。
  // 没装过插件版的人，设置里连这一块都看不到。
  var group = document.getElementById('legacy-migration-group');
  if (group) group.classList.toggle('hidden', !advice || advice === 'nothing-to-migrate');
  var el = document.getElementById('legacy-setting-status');
  if (el) el.textContent = legacyProbeText(probe);
  var btn = document.getElementById('legacy-setting-btn');
  if (btn && !btn.disabled) btn.textContent = legacyLinkText(probe);
}

function checkLegacyMigration() {
  api('api/legacy-migration').then(function (res) {
    if (!res || res.ok === false) { setLegacySettingStatus({ advice: 'blocked', detail: (res && res.error) || '' }); return; }
    setLegacySettingStatus(res);
  }).catch(function () {
    setLegacySettingStatus({ advice: 'blocked', detail: '这一次没连上后端' });
  });
}

function runLegacyMigrationNow() {
  var settingBtn = document.getElementById('legacy-setting-btn');
  if (settingBtn) { settingBtn.disabled = true; settingBtn.textContent = '正在搬…'; }
  var restore = function (probe) {
    if (settingBtn) { settingBtn.disabled = false; settingBtn.textContent = legacyLinkText(probe || legacyProbeState); }
  };
  api('api/legacy-migration/run', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ force: true })
  }).then(function (res) {
    if (!res || (res.error && !res.migrated)) {
      toast((res && res.error) || '没搬成，稍后再试一次');
      restore(res);
      setLegacySettingStatus({ advice: 'blocked', detail: (res && res.error) || '' });
      return;
    }
    var moved = (res.migrated || []).length;
    var missed = (res.failed || []).length;
    if (moved) {
      // 只搬成一部分时也要把没搬成的说出来，别让人以为整本账都过来了
      toast(missed
        ? '搬进来 ' + moved + ' 项，还有 ' + missed + ' 项没搬成，刷新后可以再补一次'
        : '搬进来 ' + moved + ' 项，正在刷新…');
      setTimeout(function () { window.location.reload(); }, missed ? 2200 : 1200);
      return;
    }
    if ((res.failed || []).length) {
      toast((res.detail || '有文件没搬成').slice(0, 60));
    } else {
      toast(res.detail || '没有可搬的项');
    }
    setLegacySettingStatus(Object.assign({ advice: res.advice }, legacyProbeState || {}));
    restore(legacyProbeState);
  }).catch(function () {
    toast('搬的时候出错了，稍后再试一次');
    restore(legacyProbeState);
  });
}

var confirmCallback = null;
function askConfirm(text, callback) {
  confirmCallback = callback;
  document.getElementById('confirm-text').textContent = text;
  document.getElementById('confirm-modal').hidden = false;
}
function closeConfirm() {
  confirmCallback = null;
  document.getElementById('confirm-modal').hidden = true;
}
function confirmYes() {
  var fn = confirmCallback;
  closeConfirm();
  if (typeof fn === 'function') fn();
}

function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
  });
}

// 事件类型只允许进白名单：拼进 class / 文案前先归一，防脏数据把任意字符串带进 HTML。
var EVENT_TYPE_WHITELIST = { event: true, anniversary: true, todo: true, period: true };
function safeType(t) {
  return EVENT_TYPE_WHITELIST[t] ? t : 'event';
}

// ── 左侧门厅发来的信号 ──
// 门厅是另一个文档，它那边点了什么只能经 App 后端转过来；起步取的是本次加载时间，
// 所以不会把上一轮留下的旧信号当成新指令再执行一遍。
var fpSignalAt = Date.now();
function runFpSignal(action) {
  // 门厅里直接勾了待办，主页面这边跟着重画，别让两边显示不一样
  if (action === 'refresh') {
    loadMonth(); selectDay(selectedDate); loadToday();
    return;
  }
  if (action === 'settings') { openSettingsModal(); return; }
  if (action === 'today') { goToday(); return; }
  if (action === 'focus') { switchTab('focus'); return; }
  if (action === 'calendar') { switchTab('calendar'); return; }
  if (action === 'summary') { switchTab('summary'); return; }
  if (action === 'moodline') { switchTab('moodline'); return; }
  if (action === 'period') {
    switchTab('calendar');
    var btn = document.getElementById('pp-toggle');
    var body = document.getElementById('pp-body');
    if (btn && body && btn.getAttribute('aria-expanded') !== 'true') togglePeriodPattern();
    return;
  }
}
setInterval(function () {
  if (document.hidden) return;
  api('api/fp-signal?since=' + fpSignalAt).then(function (res) {
    if (!res || !res.ok) return;
    var signals = Array.isArray(res.signals) ? res.signals : (res.signal ? [res.signal] : []);
    signals.forEach(function (signal) {
      if (!signal || !(signal.at > fpSignalAt)) return;
      fpSignalAt = signal.at;
      runFpSignal(signal.action);
    });
  }).catch(function () {});
}, 2500);

function switchTab(tab) {
  if (tab !== 'calendar' && summarySelectMode) toggleSummaryBatchMode(false);
  var tabs = document.querySelectorAll('.nav-tabs button');
  for (var i = 0; i < tabs.length; i++) tabs[i].classList.remove('active');
  var activeTab = document.getElementById('tab-' + tab);
  if (activeTab) activeTab.classList.add('active');
  document.getElementById('panel-calendar').classList.toggle('hidden', tab !== 'calendar');
  document.getElementById('panel-focus').classList.toggle('hidden', tab !== 'focus');
  document.getElementById('panel-summary').classList.toggle('hidden', tab !== 'summary');
  document.getElementById('panel-moodline').classList.toggle('hidden', tab !== 'moodline');
  document.getElementById('panel-xingji').classList.toggle('hidden', tab !== 'xingji');
  if (tab !== 'xingji') stopXingjiPoll();
  if (tab === 'calendar') loadMonth();
  if (tab === 'focus') loadFocus();
  if (tab === 'summary') loadSummaries();
  if (tab === 'xingji') loadXingji();
  if (tab === 'moodline') {
    if (!moodLineAnchorDate) moodLineAnchorDate = selectedDate || todayMoodLineDate();
    loadMoodLine();
  }
}

function focusTodayKey() {
  var now = new Date();
  return dk(now.getFullYear(), now.getMonth() + 1, now.getDate());
}
function focusConfigKey(title) {
  var normalized = String(title || '').trim().toLocaleLowerCase();
  return normalized ? 'goal:' + normalized : '';
}
function focusCurrentConfig() {
  return { focusMinutes: focusMinutes, totalRounds: focusTotalRounds, shortBreakMinutes: breakMinutes,
    longBreakEnabled: focusLongBreakEnabled, longBreakEvery: focusLongBreakEvery, longBreakMinutes: focusLongBreakMinutes };
}
function focusApplyConfig(config) {
  if (!config || typeof config !== 'object') return;
  if ([15, 25, 30, 45].indexOf(Number(config.focusMinutes)) >= 0) focusMinutes = Number(config.focusMinutes);
  if (Number.isInteger(Number(config.totalRounds)) && Number(config.totalRounds) >= 1 && Number(config.totalRounds) <= 20) focusTotalRounds = Number(config.totalRounds);
  if (Number.isInteger(Number(config.shortBreakMinutes)) && Number(config.shortBreakMinutes) >= 1 && Number(config.shortBreakMinutes) <= 60) breakMinutes = Number(config.shortBreakMinutes);
  if (typeof config.longBreakEnabled === 'boolean') focusLongBreakEnabled = config.longBreakEnabled;
  if (Number.isInteger(Number(config.longBreakEvery)) && Number(config.longBreakEvery) >= 1 && Number(config.longBreakEvery) <= 20) focusLongBreakEvery = Number(config.longBreakEvery);
  if (Number.isInteger(Number(config.longBreakMinutes)) && Number(config.longBreakMinutes) >= 1 && Number(config.longBreakMinutes) <= 60) focusLongBreakMinutes = Number(config.longBreakMinutes);
}
function focusSaveCurrentConfig() {
  if (focusSnapshot.active || focusActionPending) return focusConfigSaveQueue;
  var sequence = ++focusConfigSaveSequence;
  var config = focusCurrentConfig();
  var title = focusSelectedFavoriteTitle && focusConfigKey(focusSelectedFavoriteTitle) === focusConfigKey(focusFreeTitle) ? focusSelectedFavoriteTitle : '';
  var options = { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ focusConfig: config, favoriteGoalTitle: title }) };
  focusConfigSaveQueue = focusConfigSaveQueue.catch(function () {}).then(function () { return api('api/focus/settings', options); }).then(function (res) {
    if (!res || !res.ok) throw new Error(res && res.error || '专注设置没能保存');
    if (sequence !== focusConfigSaveSequence) return;
    focusSnapshot.focusConfig = res.focusConfig || config;
    focusSnapshot.favoriteGoalConfigs = res.favoriteGoalConfigs || focusSnapshot.favoriteGoalConfigs || {};
    focusStatusNotice = title ? '已记住「' + title + '」的专属设置' : '专注设置已记住';
    renderFocusPage();
  }).catch(function () {
    if (sequence !== focusConfigSaveSequence) return;
    focusStatusNotice = '专注设置暂未保存，稍后再试';
    renderFocusPage();
  });
  return focusConfigSaveQueue;
}
function focusSettingsChanged() {
  focusSettingsTouched = true;
  focusSaveCurrentConfig();
}
function focusApplyInitialConfig() {
  if (focusSettingsInitialized) return;
  focusSettingsInitialized = true;
  if (focusSettingsTouched) focusSaveCurrentConfig();
  else focusApplyConfig(focusSnapshot.focusConfig);
}

function focusFormatDuration(value) {
  var ms = Math.max(0, Number(value) || 0);
  var minutes = Math.floor(ms / 60000);
  if (!minutes) return ms > 0 ? '不到 1 分钟' : '0 分钟';
  if (minutes < 60) return minutes + ' 分钟';
  var hours = Math.floor(minutes / 60);
  var rest = minutes % 60;
  return hours + ' 小时' + (rest ? ' ' + rest + ' 分钟' : '');
}

function focusFormatClock(value) {
  var seconds = Math.max(0, Math.floor((Number(value) || 0) / 1000));
  var hours = Math.floor(seconds / 3600);
  var minutes = Math.floor((seconds % 3600) / 60);
  var rest = seconds % 60;
  var pad = function (n) { return String(n).padStart(2, '0'); };
  return hours ? pad(hours) + ':' + pad(minutes) + ':' + pad(rest) : pad(minutes) + ':' + pad(rest);
}

function focusFormatTime(value) {
  var date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return String(date.getHours()).padStart(2, '0') + ':' + String(date.getMinutes()).padStart(2, '0');
}

function focusFormatRange(session) {
  var start = new Date(session && session.startedAt);
  var end = new Date(session && session.endedAt);
  var startLabel = focusFormatTime(session && session.startedAt);
  var endLabel = focusFormatTime(session && session.endedAt);
  if (!Number.isNaN(start.getTime()) && !Number.isNaN(end.getTime()) && dk(start.getFullYear(), start.getMonth() + 1, start.getDate()) !== dk(end.getFullYear(), end.getMonth() + 1, end.getDate())) {
    endLabel = String(end.getMonth() + 1) + '/' + String(end.getDate()) + ' ' + endLabel;
  }
  return startLabel + '–' + endLabel;
}

function focusUpdateMini() {
  var button = document.getElementById('focus-mini-indicator');
  var active = focusSnapshot.active;
  if (!button) return;
  if (!active) { button.classList.add('hidden'); return; }
  button.classList.remove('hidden');
  var remaining = active.pausedAt
    ? Math.max(0, Number(active.remainingMs) || 0)
    : Math.max(0, Date.parse(String(active.targetAt || '')) - Date.now());
  button.textContent = active.phase === 'break'
    ? (active.breakKind === 'long' ? '长休 ' : '短休 ') + focusFormatClock(remaining)
    : (active.pausedAt ? '专注已暂停 ' : '专注 ') + focusFormatClock(remaining);
}

function focusNormalizeGroups(rows) {
  var items = Array.isArray(rows) ? rows : [];
  if (items.some(function (row) { return Array.isArray(row.sessions); })) return items;
  var groups = new Map();
  items.forEach(function (row) {
    var id = String(row.setId || row.id);
    if (!groups.has(id)) groups.set(id, { id: id, setId: id, sessions: [] });
    groups.get(id).sessions.push(row);
  });
  return Array.from(groups.values()).map(function (group) {
    group.sessions.sort(function (a, b) { return Date.parse(a.startedAt) - Date.parse(b.startedAt); });
    var first = group.sessions[0];
    var last = group.sessions[group.sessions.length - 1];
    group.date = first.setDate || first.date || focusTodayKey();
    group.startedAt = first.startedAt;
    group.endedAt = last.endedAt;
    group.taskTitle = first.taskTitle || '';
    group.totalRounds = Math.max.apply(null, group.sessions.map(function (row) { return Number(row.totalRounds) || 1; }).concat([1]));
    group.focusMinutes = Number(first.plannedMinutes) || 0;
    group.completedRounds = group.sessions.filter(function (row) { return row.status === 'completed'; }).length;
    group.totalFocusMs = group.sessions.reduce(function (sum, row) { return sum + Math.max(0, Number(row.durationMs) || 0); }, 0);
    group.partialFocusMs = group.sessions.filter(function (row) { return row.status !== 'completed'; }).reduce(function (sum, row) { return sum + Math.max(0, Number(row.durationMs) || 0); }, 0);
    group.planStatus = group.sessions.some(function (row) { return row.planStatus === 'interrupted' || row.status === 'interrupted'; }) ? 'interrupted'
      : group.sessions.every(function (row) { return row.status === 'completed'; }) ? 'completed' : 'active';
    return group;
  });
}

function focusRenderSessions(rows) {
  var groups = focusNormalizeGroups(rows).slice().sort(function (a, b) {
    return Date.parse(b.startedAt) - Date.parse(a.startedAt);
  });
  if (!groups.length) return '<div class="empty">今天还没有专注记录。</div>';
  return groups.map(function (group) {
    var date = String(group.date || focusTodayKey());
    var totalRounds = Math.max(1, Number(group.totalRounds) || 1);
    var completedRounds = Math.max(0, Number(group.completedRounds) || 0);
    var status = group.planStatus === 'completed' ? '整组完成'
      : group.planStatus === 'active' || group.active ? '进行中'
        : '提前结束';
    var title = group.taskTitle || '自由专注';
    var progress = completedRounds + '/' + totalRounds + ' 轮';
    var detail = group.partialFocusMs > 0
      ? '已完成 ' + completedRounds + ' 轮，未完成轮实记 ' + focusFormatDuration(group.partialFocusMs)
      : '共专注 ' + focusFormatDuration(group.totalFocusMs) + '（计划 ' + (Number(group.focusMinutes) || 0) * totalRounds + ' 分钟）';
    var actions = '<button type="button" onclick="focusOpenDay(' + jsArg(date) + ')">看这天</button>';
    if (date === focusTodayKey()) actions += '<button type="button" onclick="focusOpenMood()">记心情</button>';
    return '<div class="focus-session-row"><div class="focus-session-main"><div class="focus-session-name">' + esc(title) + ' · ' + status + ' · ' + esc(progress) + '</div>' +
      '<div class="focus-session-meta">' + esc(focusFormatRange(group)) + ' · ' + esc(detail) + '</div></div>' +
      '<div class="focus-session-actions">' + actions + '</div></div>';
  }).join('');
}

function focusRenderWeek(stats) {
  var summary = document.getElementById('focus-week-summary');
  var bars = document.getElementById('focus-week-bars');
  if (!summary || !bars) return;
  var data = stats && Array.isArray(stats.days) ? stats : { days: [], totalDurationMs: 0, count: 0, completedCount: 0 };
  summary.innerHTML = '近 7 天专注 <b>' + esc(focusFormatDuration(data.totalDurationMs)) + '</b>，共 ' +
    esc(String(data.count || 0)) + ' 组；完整走完 ' + esc(String(data.completedCount || 0)) + ' 组。';
  var max = Math.max.apply(null, data.days.map(function (day) { return Number(day.durationMs) || 0; }).concat([0]));
  bars.classList.toggle('hidden', !data.count);
  bars.innerHTML = data.days.map(function (day) {
    var date = String(day.date || '');
    var weekday = date ? WEEK[new Date(date + 'T00:00:00').getDay()] : ' ';
    var amount = Number(day.durationMs) || 0;
    var height = max ? Math.max(3, Math.round(amount / max * 100)) : 0;
    return '<div class="focus-week-day' + (date === focusTodayKey() ? ' today' : '') + '" title="' + esc(date + ' · ' + focusFormatDuration(amount)) + '">' +
      '<div class="focus-week-track"><div class="focus-week-fill" style="height:' + height + '%"></div></div><span>' + esc(weekday) + '</span></div>';
  }).join('');
}

// 准备表单只在进入准备状态时创建；轮询不替换输入节点。
function focusSetHtml(id, html) {
  var node = document.getElementById(id);
  if (node && node.innerHTML !== html) node.innerHTML = html;
}

var focusCompanionExpanded = false;
var focusCompanionChanging = false;
var focusSelectedCompanion = null;
var focusAvatarCache = new Map();
var focusSoloReminderHidden = false;
function focusCompanionStatus() {
  var options = focusSnapshot.companionOptions;
  if (!options) return 'unavailable';
  if (['available', 'empty', 'absent', 'unavailable'].indexOf(options.status) >= 0) return options.status;
  return options.available ? ((options.partners || []).length ? 'available' : 'empty') : 'unavailable';
}
function focusReminderStatus() {
  var active = focusSnapshot.active;
  if (active && !active.companionId) return null;
  var latest = (focusSnapshot.sessions || [])[0];
  if (!active && (focusSoloReminderHidden || latest && latest.companionId === '')) return null;
  return focusSnapshot.companionOptions && focusSnapshot.companionOptions.reminderStatus;
}
function focusCompanionNotice(active) {
  if (!active || !active.companionId) return { state: '', text: '' };
  var name = String(active.companionName || '所选伙伴');
  var notice = String(focusStatusNotice || '');
  if (/茶话会|陪读/.test(notice)) {
    return { state: 'warning', text: /没能生成|没能送达/.test(notice) ? '陪读提醒没能送达，专注计时仍会继续。' : '茶话会暂时未接通，专注计时仍会继续。' };
  }
  var status = focusReminderStatus();
  if (status && status.sessionId === active.id) {
    if (active.phase === 'focus' && status.start === 'failed') return { state: 'warning', text: '开始提醒未能送达，专注计时仍会继续。' };
    if (active.phase === 'break' && status.end === 'failed') return { state: 'warning', text: '收尾提醒未能送达，专注计时仍会继续。' };
    if (status.failed) return { state: 'warning', text: '有陪读提醒没能送达，专注计时仍会继续。' };
    if (active.phase === 'focus' && status.start === 'sent') return { state: 'sent', text: '已把这次专注安排告诉' + name + '。' };
    if (active.phase === 'focus' && (status.start === 'pending' || status.start === 'waiting')) return { state: 'unconfirmed', text: '开始提醒是否已送达茶话会，暂未确认。' };
    if (active.phase === 'focus' && status.start === 'stale') return { state: 'warning', text: '开始提醒状态已过期，暂时无法确认是否送达。' };
    if (active.phase === 'break' && status.end === 'sent') return { state: 'sent', text: '这段专注的收尾安排已告诉' + name + '。' };
    if (active.phase === 'break' && (status.end === 'pending' || status.end === 'waiting')) return { state: 'unconfirmed', text: '收尾提醒是否已送达茶话会，暂未确认。' };
    if (active.phase === 'break' && status.end === 'stale') return { state: 'warning', text: '收尾提醒状态已过期，暂时无法确认是否送达。' };
  }
  if (focusCompanionStatus() !== 'available') return { state: 'warning', text: '暂时联系不上茶话会，专注计时仍在本机继续。' };
  return { state: 'unknown', text: '本次陪读伙伴：' + name + '。这段联动状态尚未确认。' };
}
function focusAvatarHtml(partner) {
  var initial = Array.from(String(partner.name || '伙伴'))[0];
  return '<span class="focus-avatar" aria-hidden="true"><span>' + esc(initial) + '</span>' +
    (partner.avatar ? '<img hidden data-focus-avatar="' + esc(partner.id) + '" alt="">' : '') + '</span>';
}
function focusLoadAvatars() {
  document.getElementById('focus-companions').querySelectorAll('img[data-focus-avatar]').forEach(function (img) {
    if (img.dataset.loading) return;
    img.dataset.loading = 'true';
    var id = img.dataset.focusAvatar;
    if (!focusAvatarCache.has(id)) {
      focusAvatarCache.set(id, apiFetch('api/focus/avatar/' + encodeURIComponent(id), { signal: AbortSignal.timeout(5000) }).then(function (res) {
        if (!res.ok) throw new Error('avatar unavailable');
        return res.blob();
      }).then(function (blob) { return URL.createObjectURL(blob); }).catch(function () { return ''; }));
    }
    focusAvatarCache.get(id).then(function (src) {
      if (!src) return;
      img.onload = function () { img.hidden = false; };
      img.onerror = function () { img.hidden = true; img.removeAttribute('src'); };
      img.src = src;
    });
  });
}
function changeFocusCompanion() {
  if (focusActionPending || focusSnapshot.active) return;
  focusCompanionChanging = true;
  focusCompanionExpanded = (focusSnapshot.companionOptions && focusSnapshot.companionOptions.partners || []).length > 10;
  focusUpdatePreparation();
}
function expandFocusCompanions() {
  if (focusActionPending || focusSnapshot.active) return;
  focusCompanionExpanded = true;
  focusUpdatePreparation();
}
function focusPreparationHint() {
  var options = focusSnapshot.companionOptions;
  if (focusSelectedCompanionId) {
    if (focusLoadError || focusCompanionStatus() !== 'available') return '所选伙伴暂不可用，请重试、更换伙伴或选择自己专注。';
    if (!(options.partners || []).some(function (p) { return p.id === focusSelectedCompanionId; })) return '所选伙伴已不在名单中，请更换伙伴或选择自己专注。';
  }
  if (!focusFreeTitle.trim()) return '写下这次想做什么。';
  return '准备好了，开始 ' + focusTotalRounds + ' 轮；休息结束会自动接上下一轮。';
}

function focusUpdatePreparation() {
  var options = focusSnapshot.companionOptions || { available: false, partners: [] };
  var input = document.getElementById('focus-free-title');
  var configPending = focusActionPending || focusFavoritePending;
  // 显式日历入口可以预填；普通轮询不写入输入框，保留焦点和光标。
  if (input.value !== focusFreeTitle) input.value = focusFreeTitle;
  input.disabled = configPending;
  var status = focusCompanionStatus();
  document.getElementById('focus-companions').classList.toggle('hidden', status === 'absent');
  document.getElementById('focus-prepare-grid').classList.toggle('without-companions', status === 'absent');
  var absentSolo = document.getElementById('focus-absent-solo');
  absentSolo.classList.toggle('hidden', status !== 'absent' || !focusSelectedCompanionId);
  absentSolo.disabled = focusActionPending;
  var partners = status === 'available' ? (options.partners || []) : [];
  var selected = partners.find(function (p) { return p.id === focusSelectedCompanionId; });
  if (selected) focusSelectedCompanion = selected;
  var collapsed = !!focusSelectedCompanionId && !focusCompanionChanging;
  var many = partners.length > 10;
  var list = document.getElementById('focus-companion-list');
  list.classList.toggle('hidden', collapsed);
  list.classList.toggle('expanded', many && focusCompanionExpanded);
  var visible = many && !focusCompanionExpanded ? partners.slice(0, 10) : partners;
  focusSetHtml('focus-companion-list', visible.map(function (p) {
    var picked = p.id === focusSelectedCompanionId;
    return '<button type="button" class="mood-cell focus-task-option' + (picked ? ' picked active' : '') + '" aria-pressed="' + picked + '" title="' + esc(p.name) + '" onclick="chooseFocusCompanion(' + esc(jsArg(p.id)) + ')"' + (focusActionPending ? ' disabled' : '') + '>' + focusAvatarHtml(p) + '<span class="focus-companion-name-tag">' + esc(p.name) + '</span>' + (picked ? '<span class="focus-companion-check" aria-hidden="true">✓</span>' : '') + '</button>';
  }).join(''));
  var chosen = document.getElementById('focus-companion-selected');
  chosen.classList.toggle('hidden', !collapsed);
  var partner = selected || focusSelectedCompanion || { id: focusSelectedCompanionId, name: '所选伙伴' };
  focusSetHtml('focus-companion-selected', collapsed ? '<div class="focus-companion-card">' + focusAvatarHtml(partner) + '<div class="focus-companion-card-body"><strong>' + esc(partner.name) + '</strong><p>陪你专注这段时间</p></div></div>' : '');
  var all = document.getElementById('focus-companion-all');
  all.classList.toggle('hidden', collapsed || !many || focusCompanionExpanded);
  all.disabled = focusActionPending;
  all.textContent = '查看全部伙伴（共' + partners.length + '位）';
  document.getElementById('focus-companion-change').classList.toggle('hidden', !collapsed);
  document.getElementById('focus-companion-change').disabled = focusActionPending;
  document.getElementById('focus-companion-solo').disabled = focusActionPending;
  document.getElementById('focus-companion-solo').textContent = focusSelectedCompanionId ? '自己专注' : '自己专注 · 不选伙伴';
  var companionError = focusLoadError || (status === 'unavailable' ? '伙伴暂不可用，可以自己开始专注。' : status === 'empty' || !partners.length && status === 'available' ? '暂无可选伙伴，可以自己开始专注。' : '');
  document.getElementById('focus-companion-error').textContent = companionError;
  focusLoadAvatars();
  var retry = document.getElementById('focus-companion-retry');
  retry.classList.toggle('hidden', !companionError);
  retry.disabled = focusActionPending || focusCompanionRetryPending;
  retry.textContent = focusCompanionRetryPending ? '正在获取伙伴…' : '重试';
  [15, 25, 30, 45].forEach(function (value) {
    var button = document.getElementById('focus-pick-' + value);
    var picked = focusMinutes === value;
    button.classList.toggle('active', picked);
    button.disabled = configPending;
    button.setAttribute('aria-pressed', String(picked));
  });
  document.getElementById('focus-round-count').textContent = focusTotalRounds + ' 轮';
  document.getElementById('focus-short-count').textContent = breakMinutes + ' 分';
  document.getElementById('focus-long-every-count').textContent = '每隔 ' + focusLongBreakEvery + ' 轮';
  document.getElementById('focus-long-minutes-count').textContent = focusLongBreakMinutes + ' 分';
  document.getElementById('focus-round-minus').disabled = configPending || focusTotalRounds <= 1;
  document.getElementById('focus-round-plus').disabled = configPending || focusTotalRounds >= 20;
  document.getElementById('focus-short-minus').disabled = configPending || breakMinutes <= 1;
  document.getElementById('focus-short-plus').disabled = configPending || breakMinutes >= 60;
  document.getElementById('focus-long-every-minus').disabled = configPending || focusLongBreakEvery <= 1 || !focusLongBreakEnabled;
  document.getElementById('focus-long-every-plus').disabled = configPending || focusLongBreakEvery >= 20 || !focusLongBreakEnabled;
  document.getElementById('focus-long-minutes-minus').disabled = configPending || focusLongBreakMinutes <= 1 || !focusLongBreakEnabled;
  document.getElementById('focus-long-minutes-plus').disabled = configPending || focusLongBreakMinutes >= 60 || !focusLongBreakEnabled;
  var longToggle = document.getElementById('focus-long-toggle');
  longToggle.classList.toggle('active', focusLongBreakEnabled);
  longToggle.setAttribute('aria-pressed', String(focusLongBreakEnabled));
  longToggle.disabled = configPending;
  longToggle.textContent = focusLongBreakEnabled ? '长休：开' : '长休：关';
  var favorites = focusSnapshot.favoriteGoals || [];
  focusSetHtml('focus-favorites', favorites.map(function (title) {
    return '<span class="focus-favorite-chip"><button type="button" onclick="chooseFocusFavorite(' + esc(jsArg(title)) + ')"' + (focusFavoritePending ? ' disabled' : '') + '>' + esc(title) + '</button><button type="button" class="focus-favorite-remove" aria-label="移除常用目标 ' + esc(title) + '" onclick="removeFocusFavorite(' + esc(jsArg(title)) + ')"' + (focusFavoritePending ? ' disabled' : '') + '>×</button></span>';
  }).join(''));
  var saveFavorite = document.getElementById('focus-save-favorite');
  var alreadyFavorite = favorites.some(function (title) { return title.toLowerCase() === focusFreeTitle.trim().toLowerCase(); });
  saveFavorite.disabled = focusFavoritePending || !focusFreeTitle.trim() || alreadyFavorite;
  saveFavorite.textContent = focusFavoritePending ? '保存中…' : alreadyFavorite ? '已存常用' : '存为常用';
  var start = document.getElementById('focus-start-button');
  start.disabled = configPending;
  start.textContent = focusActionPending ? '正在开始…' : '开始 ' + focusTotalRounds + ' 轮 · 每轮 ' + focusMinutes + ' 分钟';
  document.getElementById('focus-preparation-hint').textContent = focusPreparationHint();
  document.getElementById('focus-status-notice').textContent = focusStatusNotice;
  var reminder = focusReminderStatus();
  document.getElementById('focus-last-reminder').textContent = reminder && (reminder.failed ? '上一段有陪读消息没能送达，不会自动重试或切换模型。' : reminder.end === 'pending' ? '上一段的收尾提醒暂未确认送达。' : '') || '';
}

function setFocusRounds(value) {
  if (focusActionPending || focusFavoritePending || focusSnapshot.active) return;
  focusTotalRounds = Math.max(1, Math.min(20, Math.floor(Number(value) || 1)));
  focusSettingsChanged();
  renderFocusPage();
}
function setBreakMinutes(value) {
  if (focusActionPending || focusFavoritePending || focusSnapshot.active) return;
  breakMinutes = Math.max(1, Math.min(60, Math.floor(Number(value) || 1)));
  focusSettingsChanged();
  renderFocusPage();
}
function setFocusLongBreakEvery(value) {
  if (focusActionPending || focusFavoritePending || focusSnapshot.active) return;
  focusLongBreakEvery = Math.max(1, Math.min(20, Math.floor(Number(value) || 1)));
  focusSettingsChanged();
  renderFocusPage();
}
function setFocusLongBreakMinutes(value) {
  if (focusActionPending || focusFavoritePending || focusSnapshot.active) return;
  focusLongBreakMinutes = Math.max(1, Math.min(60, Math.floor(Number(value) || 1)));
  focusSettingsChanged();
  renderFocusPage();
}
function toggleFocusLongBreak() {
  if (focusActionPending || focusFavoritePending || focusSnapshot.active) return;
  focusLongBreakEnabled = !focusLongBreakEnabled;
  focusSettingsChanged();
  renderFocusPage();
}
function chooseFocusFavorite(title) {
  if (focusActionPending || focusFavoritePending || focusSnapshot.active) return Promise.resolve(false);
  var selectedTitle = String(title || '').trim();
  var hasConfig = Object.prototype.hasOwnProperty.call(focusSnapshot.favoriteGoalConfigs || {}, focusConfigKey(selectedTitle));
  focusFavoritePending = true;
  focusStatusNotice = '正在读取常用目标设置…';
  focusUpdatePreparation();
  var request = focusConfigSaveQueue.catch(function () {}).then(function () {
    return api('api/focus/favorites/select', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title: selectedTitle }) });
  });
  return request.then(function (res) {
    if (!res || !res.ok || !res.focusConfig) throw new Error(res && res.error || '常用目标设置暂时读不到');
    focusFreeTitle = selectedTitle;
    focusSelectedTaskId = '';
    focusSelectedFavoriteTitle = selectedTitle;
    focusSnapshot.focusConfig = res.focusConfig;
    focusSnapshot.favoriteGoalConfigs = res.favoriteGoalConfigs || focusSnapshot.favoriteGoalConfigs || {};
    focusApplyConfig(res.focusConfig);
    focusSettingsInitialized = true;
    focusSettingsTouched = true;
    focusStatusNotice = hasConfig ? '已恢复「' + selectedTitle + '」的专属设置' : '「' + selectedTitle + '」没有专属设置，已沿用并绑定上次设置';
    renderFocusPage();
    var input = document.getElementById('focus-free-title');
    if (input) input.focus({ preventScroll: true });
    return true;
  }).catch(function (error) {
    focusStatusNotice = error.message || '常用目标设置暂时读不到';
    toast(focusStatusNotice);
    renderFocusPage();
    return false;
  }).finally(function () {
    focusFavoritePending = false;
    renderFocusPage();
  });
}
function saveFocusFavorite() {
  var title = focusFreeTitle.trim();
  if (!title || focusFavoritePending || focusSnapshot.active) return;
  focusFavoritePending = true;
  focusUpdatePreparation();
  api('api/focus/favorites/add', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title: title, focusConfig: focusCurrentConfig() }) })
    .then(function (res) {
      if (!res || !res.ok) throw new Error(res && res.error || '常用目标没能保存');
      focusSnapshot.favoriteGoals = res.favoriteGoals || [];
      focusSnapshot.favoriteGoalConfigs = res.favoriteGoalConfigs || focusSnapshot.favoriteGoalConfigs || {};
      focusSnapshot.focusConfig = focusCurrentConfig();
      focusSelectedFavoriteTitle = title;
      focusSettingsTouched = true;
      focusStatusNotice = '「' + title + '」已保存，并绑定当前设置';
      toast('已存进常用目标');
    }).catch(function (error) { toast(error.message || '常用目标没能保存'); })
    .finally(function () { focusFavoritePending = false; renderFocusPage(); });
}
function removeFocusFavorite(title) {
  if (focusFavoritePending || focusSnapshot.active) return;
  focusFavoritePending = true;
  focusUpdatePreparation();
  api('api/focus/favorites/remove', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title: title }) })
    .then(function (res) {
      if (!res || !res.ok) throw new Error(res && res.error || '常用目标没能移除');
      focusSnapshot.favoriteGoals = res.favoriteGoals || [];
      focusSnapshot.favoriteGoalConfigs = res.favoriteGoalConfigs || {};
      if (focusConfigKey(focusSelectedFavoriteTitle) === focusConfigKey(title)) focusSelectedFavoriteTitle = '';
      toast('已从常用目标移除');
    }).catch(function (error) { toast(error.message || '常用目标没能移除'); })
    .finally(function () { focusFavoritePending = false; renderFocusPage(); });
}

var focusCompanionRetryPending = false;
var focusLoadError = '';
function retryFocusCompanions() {
  if (focusActionPending || focusCompanionRetryPending) return;
  focusCompanionRetryPending = true;
  focusUpdatePreparation();
  loadFocus().finally(function () {
    focusCompanionRetryPending = false;
    if (!focusSnapshot.active) focusUpdatePreparation();
  });
}
function editFocusTitle(value) {
  if (focusActionPending || focusFavoritePending || focusSnapshot.active) return;
  focusFreeTitle = String(value || '');
  if (focusSelectedFavoriteTitle && focusConfigKey(focusFreeTitle) !== focusConfigKey(focusSelectedFavoriteTitle)) focusSelectedFavoriteTitle = '';
  // 后端关联待办时优先采用待办标题；手改目标必须解除关联。
  focusSelectedTaskId = '';
  focusStatusNotice = '';
  focusUpdatePreparation();
}
function renderFocusPreparation(card) {
  if (card.dataset.mode !== 'prepare') {
    card.dataset.mode = 'prepare';
    card.classList.remove('focus-live');
    card.classList.add('focus-prepare');
    var picks = [15, 25, 30, 45].map(function (value) {
      return '<button id="focus-pick-' + value + '" type="button" class="focus-preset" onclick="setFocusMinutes(' + value + ')">' + value + ' 分钟</button>';
    }).join('');
    card.innerHTML = '<div class="add-head"><h3 class="focus-card-title">开始前，安排一下</h3><span class="focus-card-caption">到点记下；中途结束按实际时长记录</span></div>' +
      '<div class="focus-prepare-grid" id="focus-prepare-grid"><div class="focus-control focus-goal add-form"><label class="focus-control-label" for="focus-free-title">这次想做什么？</label>' +
      '<input id="focus-free-title" maxlength="120" placeholder="比如：读一章书、整理资料" value="' + esc(focusFreeTitle) + '" oninput="editFocusTitle(this.value)"><button id="focus-save-favorite" type="button" class="focus-favorite-save" onclick="saveFocusFavorite()">存为常用</button><div id="focus-favorites" class="focus-favorites" aria-label="常用目标"></div></div>' +
      '<div class="focus-control focus-companions" id="focus-companions"><div class="focus-control-label" id="focus-companion-label">谁陪你专注？<span class="focus-card-caption">（可选）</span></div>' +
      '<div id="focus-companion-selected" class="hidden"></div>' +
      '<div class="mood-grid focus-companion-grid" id="focus-companion-list" role="group" aria-labelledby="focus-companion-label"></div>' +
      '<div class="focus-companion-links"><button id="focus-companion-all" type="button" class="focus-companion-link hidden" onclick="expandFocusCompanions()">查看全部伙伴</button><button id="focus-companion-change" type="button" class="focus-companion-link hidden" onclick="changeFocusCompanion()">更换伙伴</button><button id="focus-companion-solo" type="button" class="focus-companion-link" onclick="chooseFocusCompanion(\\'\\')">自己专注</button></div>' +
      '<p class="focus-feedback" id="focus-companion-error" role="status"></p><button id="focus-companion-retry" class="btn hidden" type="button" onclick="retryFocusCompanions()">重试</button></div>' +
      '<div class="focus-control focus-duration"><div class="focus-control-label">每轮专注多久？</div><div class="focus-preset-row" role="group" aria-label="专注时长">' + picks + '</div>' +
      '<div class="focus-plan-grid">' +
      '<div class="focus-plan-setting"><span>总轮数</span><div class="focus-stepper"><button id="focus-round-minus" type="button" aria-label="减少轮数" onclick="setFocusRounds(focusTotalRounds - 1)">−</button><span id="focus-round-count" class="focus-step-value"></span><button id="focus-round-plus" type="button" aria-label="增加轮数" onclick="setFocusRounds(focusTotalRounds + 1)">＋</button></div></div>' +
      '<div class="focus-plan-setting"><span>短休时长</span><div class="focus-stepper"><button id="focus-short-minus" type="button" aria-label="缩短短休" onclick="setBreakMinutes(breakMinutes - 1)">−</button><span id="focus-short-count" class="focus-step-value"></span><button id="focus-short-plus" type="button" aria-label="延长短休" onclick="setBreakMinutes(breakMinutes + 1)">＋</button></div></div>' +
      '<div class="focus-plan-setting"><button id="focus-long-toggle" type="button" class="focus-preset" onclick="toggleFocusLongBreak()" aria-pressed="true">长休：开</button><div class="focus-stepper"><button id="focus-long-every-minus" type="button" aria-label="减少长休间隔" onclick="setFocusLongBreakEvery(focusLongBreakEvery - 1)">−</button><span id="focus-long-every-count" class="focus-step-value"></span><button id="focus-long-every-plus" type="button" aria-label="增加长休间隔" onclick="setFocusLongBreakEvery(focusLongBreakEvery + 1)">＋</button></div></div>' +
      '<div class="focus-plan-setting"><span>长休时长</span><div class="focus-stepper"><button id="focus-long-minutes-minus" type="button" aria-label="缩短长休" onclick="setFocusLongBreakMinutes(focusLongBreakMinutes - 1)">−</button><span id="focus-long-minutes-count" class="focus-step-value"></span><button id="focus-long-minutes-plus" type="button" aria-label="延长长休" onclick="setFocusLongBreakMinutes(focusLongBreakMinutes + 1)">＋</button></div></div></div>' +
      '<p class="focus-card-caption">长休按设定轮数触发；最后一轮结束后不再休息。</p></div></div>' +
      '<div class="add-actions focus-submit"><button id="focus-start-button" type="button" class="btn primary" aria-describedby="focus-preparation-hint" onclick="startFocusTimer()">开始专注</button></div>' +
      '<p class="focus-feedback" id="focus-preparation-hint"></p><button id="focus-absent-solo" type="button" class="focus-companion-link hidden" onclick="chooseFocusCompanion(\\'\\')">改为自己专注</button><p class="focus-feedback" id="focus-status-notice" role="status"></p><p class="focus-feedback" id="focus-last-reminder" role="status"></p>';
  }
  focusUpdatePreparation();
}

function focusRenderSettlement(active) {
  var sessions = (focusSnapshot.sessions || []).slice();
  (focusSnapshot.groups || []).forEach(function (group) { (group.sessions || []).forEach(function (row) { if (!sessions.some(function (item) { return item.id === row.id; })) sessions.push(row); }); });
  var session = sessions.find(function (row) { return row.id === active.id; });
  if (!session) return '<p class="focus-card-caption">这段的结算记录暂未返回；先歇一歇。</p>';
  var duration = session.durationMs != null && Number.isFinite(Number(session.durationMs))
    ? '实际专注 ' + focusFormatDuration(session.durationMs) : '实际时长暂未返回';
  var status = session.status === 'completed' ? '计时到点' : '中途结束';
  var actions = session.date ? '<button type="button" onclick="focusOpenDay(' + jsArg(session.date) + ')">看这天</button>' : '';
  if (session.date === focusTodayKey()) actions += '<button type="button" onclick="focusOpenMood()">记心情</button>';
  return '<div class="day-title"><span class="day-date">' + esc(session.date || '') + '</span><span class="day-label">刚才这一段 · ' + status + '</span></div>' +
    '<article class="archive-item">' + (session.companionName ? '<span class="a-agent">' + esc(session.companionName) + '</span>' : '') +
    '<div class="a-text">' + esc(session.taskTitle || '自由专注') + '</div>' +
    '<p class="focus-session-meta">' + esc(focusFormatRange(session)) + ' · ' + esc(duration) + '</p>' +
    '<p class="focus-card-caption">计时记录不代表待办已完成。</p>' +
    '<div class="archive-actions">' + actions + '</div></article>';
}

function renderFocusPage() {
  var card = document.getElementById('focus-timer-card');
  var history = document.getElementById('focus-session-list');
  if (!card || !history) return;
  var active = focusSnapshot.active;
  if (!active) {
    renderFocusPreparation(card);
  } else {
    var remaining = active.pausedAt
      ? Math.max(0, Number(active.remainingMs) || 0)
      : Math.max(0, Date.parse(String(active.targetAt || '')) - Date.now());
    var phaseText = active.phase === 'break' ? (active.breakKind === 'long' ? '长休时间' : '短休时间') : (active.pausedAt ? '这一轮已暂停' : '正在专注');
    var taskText = active.phase === 'break' ? '接下来继续：' + (active.taskTitle || '自由专注') : (active.taskTitle || '自由专注');
    var companionNotice = focusCompanionNotice(active);
    // 暂停、请求等待与轮询只更新现有节点；仅换段或切换专注/休息时重建。
    var liveKey = JSON.stringify([active.id, active.phase]);
    if (card.dataset.mode !== liveKey) {
      card.dataset.mode = liveKey;
      card.classList.remove('focus-prepare');
      card.classList.add('focus-live');
      var actionHtml = active.phase === 'break'
        ? '<button id="focus-end-button" type="button" class="btn" onclick="confirmEndFocusSet()">结束本组并保留记录</button>'
        : '<button id="focus-pause-button" type="button" class="btn primary">暂停</button><button id="focus-end-button" type="button" class="btn" onclick="confirmEndFocusSet()">提前结束本组并保存</button>';
      card.innerHTML = '<div class="focus-live-paper"><div class="focus-live-clock-wrap"><span class="focus-live-clock-label">还剩</span><div class="big-day focus-clock" id="focus-clock" aria-live="off">' + focusFormatClock(remaining) + '</div></div>' +
        '<div class="today-body focus-live-body"><div class="focus-phase" id="focus-live-phase"></div><h3 class="focus-task-name" id="focus-live-task"></h3>' +
        '<p class="focus-session-meta" id="focus-live-plan"></p><p class="focus-session-meta focus-companion-name" id="focus-live-name"></p></div></div>' +
        '<div class="add-actions focus-actions">' + actionHtml + '</div>' +
        '<p class="focus-feedback" id="focus-live-status" role="status"></p><p class="focus-feedback focus-live-companion" id="focus-live-companion" role="status"></p>' +
        (active.phase === 'break' ? '<div class="focus-settlement" id="focus-settlement"></div>' : '');
    }
    document.getElementById('focus-live-phase').textContent = phaseText;
    document.getElementById('focus-live-task').textContent = taskText;
    document.getElementById('focus-live-plan').textContent = active.phase === 'break'
      ? '第 ' + String(active.roundIndex || 1) + '/' + String(active.totalRounds || 1) + ' 轮完成 · ' + String(active.breakMinutes || 0) + ' 分钟后自动开始第 ' + String((Number(active.roundIndex) || 1) + 1) + ' 轮。'
      : '第 ' + String(active.roundIndex || 1) + '/' + String(active.totalRounds || 1) + ' 轮 · 计划 ' + String(active.plannedMinutes || 0) + ' 分钟';
    document.getElementById('focus-live-name').textContent = active.companionName ? '陪伴：' + active.companionName : '';
    var focusedId = card.contains(document.activeElement) ? document.activeElement.id : '';
    if (focusActionPending && focusedId) card.dataset.focusReturn = focusedId;
    var pause = document.getElementById('focus-pause-button');
    if (active.phase === 'focus' && pause) {
      pause.textContent = active.pausedAt ? '继续专注' : '暂停';
      pause.setAttribute('onclick', 'focusRequest(' + jsArg(active.pausedAt ? 'resume' : 'pause') + ')');
    }
    ['focus-pause-button', 'focus-end-button'].forEach(function (id) {
      var button = document.getElementById(id);
      if (button) button.disabled = focusActionPending;
    });
    if (!focusActionPending && card.dataset.focusReturn) {
      var focusReturn = document.getElementById(card.dataset.focusReturn);
      if (focusReturn && !focusReturn.disabled && (!document.activeElement || !document.activeElement.id)) focusReturn.focus({ preventScroll: true });
      delete card.dataset.focusReturn;
    }
    if (active.phase === 'break') focusSetHtml('focus-settlement', focusRenderSettlement(active));
    var statusNotice = document.getElementById('focus-live-status');
    statusNotice.textContent = active.companionId && /茶话会|陪读/.test(focusStatusNotice) ? '' : focusStatusNotice;
    var companionNode = document.getElementById('focus-live-companion');
    companionNode.textContent = companionNotice.text;
    companionNode.setAttribute('data-state', companionNotice.state);
  }
  focusRenderWeek(focusSnapshot.stats);
  focusSetHtml('focus-session-list', focusRenderSessions(focusSnapshot.groups && focusSnapshot.groups.length ? focusSnapshot.groups : focusSnapshot.sessions));
  focusUpdateMini();
  focusTick();
}

var focusRequestSeq = 0;
var focusLoadSeq = 0;
function loadFocus() {
  if (focusActionPending) return;
  var requestSeq = ++focusLoadSeq;
  return api('api/focus').then(function (res) {
    if (requestSeq !== focusLoadSeq) return;
    if (!res || !res.ok) {
      focusStatusNotice = res && res.error ? res.error : '专注记录暂时读不到';
      focusLoadError = focusStatusNotice + '，请检查连接后重试。';
      renderFocusPage();
      return;
    }
    focusSnapshot = { active: res.active || null, sessions: res.sessions || [], groups: res.groups || [], favoriteGoals: res.favoriteGoals || [], favoriteGoalConfigs: res.favoriteGoalConfigs || {}, focusConfig: res.focusConfig || null, stats: res.stats || null, taskOptions: res.taskOptions || [], companionOptions: res.companionOptions || null };
    focusApplyInitialConfig();
    focusLoadError = '';
    focusStatusNotice = '';
    renderFocusPage();
  }).catch(function () {
    if (requestSeq !== focusLoadSeq) return;
    focusStatusNotice = '专注记录暂时读不到，检查一下连接';
    focusLoadError = '暂时无法获取陪伴伙伴，请检查茶话会连接后重试。';
    renderFocusPage();
  });
}

function confirmEndFocusSet() {
  if (focusActionPending) return;
  askConfirm('提前结束这组专注？已完成轮次和当前真实专注时长都会保留。', function () {
    focusRequest('end');
  });
}

function focusRequest(action, body, quiet) {
  if (focusActionPending) return;
  focusActionPending = true;
  focusLoadSeq++;
  var requestSeq = ++focusRequestSeq;
  var beforeActive = focusSnapshot.active;
  var wasFocus = beforeActive && beforeActive.phase === 'focus';
  var wasBreak = beforeActive && beforeActive.phase === 'break';
  var wasFinalRound = wasFocus && Number(beforeActive.roundIndex || 1) >= Number(beforeActive.totalRounds || 1);
  var wasSolo = beforeActive && !beforeActive.companionId;
  var reloadAfterFailure = false;
  focusStatusNotice = action === 'advance' ? '计时到啦，正在收好这一段…' : (action === 'start' ? '正在开始计时…' : '正在保存计时状态…');
  renderFocusPage();
  var options = { method: 'POST' };
  if (body) {
    options.headers = { 'Content-Type': 'application/json' };
    options.body = JSON.stringify(body);
  }
  api('api/focus/' + action, options).then(function (res) {
    if (requestSeq !== focusRequestSeq) return;
    if (!res || !res.ok) {
      focusStatusNotice = res && res.error ? res.error : '计时状态暂时没同步';
      if (!quiet) toast(focusStatusNotice);
      if (action === 'advance') focusAdvanceRetryAt = Date.now() + 5000;
      reloadAfterFailure = true;
      return;
    }
    focusSnapshot = { active: res.active || null, sessions: res.sessions || [], groups: res.groups || [], favoriteGoals: res.favoriteGoals || [], favoriteGoalConfigs: res.favoriteGoalConfigs || {}, focusConfig: res.focusConfig || null, stats: res.stats || null, taskOptions: res.taskOptions || [], companionOptions: res.companionOptions || null };
    focusApplyInitialConfig();
    if (action === 'start') focusSoloReminderHidden = !body.companionId;
    else if (wasSolo) focusSoloReminderHidden = true;
    focusStatusNotice = res.warning || '';
    if (res.warning && action !== 'start') toast(res.warning);
    if (action === 'start') toast(res.warning || '开始这组专注啦');
    else if (action === 'pause') toast('先停一停');
    else if (action === 'resume') toast('继续专注');
    else if ((action === 'end' || action === 'cancel') && res.ended && res.ended.session && res.ended.session.status === 'completed' && res.ended.session.planStatus === 'interrupted') toast('这一组提前结束，已完成轮次保留');
  else if ((action === 'end' || action === 'cancel') && res.ended && res.ended.session && res.ended.session.status === 'completed') toast('这一组完成啦，已记下专注时间');
    else if ((action === 'end' || action === 'cancel') && res.ended && res.ended.session) toast('这一组提前结束，已按实际时长记下');
    else if ((action === 'end' || action === 'cancel') && res.ended && res.ended.phase === 'break') toast('这一组已结束，已完成轮次保留');
    else if ((action === 'end' || action === 'cancel') && res.ended && res.ended.phase === 'none') toast('这组计时已经结束');
    else if (action === 'cancel' && res.session) toast('已提前结束，实际专注时间保留了');
    else if (action === 'cancel' && res.completed) toast('这一轮到点完成啦');
    else if (action === 'cancel' && res.cancelled) toast('这一组已结束，已完成轮次保留');
    else if (action === 'advance' && wasFocus) toast(wasFinalRound ? '这一组完成啦，最后一轮没有追加休息' : '这一轮完成，休息结束会自动开始下一轮');
    else if (action === 'advance' && wasBreak && res.active && res.active.phase === 'focus') toast('休息结束，开始第 ' + String(res.active.roundIndex) + ' 轮');
    renderFocusPage();
    if ((action === 'end' && res.ended && (res.ended.session || res.ended.phase === 'break')) || (action === 'cancel' && (res.completed || res.session)) || (action === 'advance' && (wasFocus || wasBreak))) focusRefreshDay();
  }).catch(function () {
    if (requestSeq !== focusRequestSeq) return;
    focusStatusNotice = '计时状态暂时没同步，稍后会再试';
    if (action === 'advance') focusAdvanceRetryAt = Date.now() + 5000;
    if (!quiet) toast(focusStatusNotice);
    reloadAfterFailure = true;
  }).finally(function () {
    if (requestSeq !== focusRequestSeq) return;
    focusActionPending = false;
    if (action === 'advance') focusAdvancePending = false;
    renderFocusPage();
    if (reloadAfterFailure) loadFocus();
  });
}

function focusRefreshDay() {
  var today = focusTodayKey();
  if (selectedDate === today) selectDay(today);
}

function setFocusMinutes(value) {
  if ([15, 25, 30, 45].indexOf(Number(value)) < 0 || focusSnapshot.active || focusActionPending || focusFavoritePending) return;
  focusMinutes = Number(value);
  focusSettingsChanged();
  renderFocusPage();
}

function chooseFocusCompanion(id) {
  if (focusSnapshot.active) return;
  if (focusActionPending) return;
  var partner = (focusSnapshot.companionOptions && focusSnapshot.companionOptions.partners || []).find(function (p) { return p.id === id; });
  if (id && (focusCompanionStatus() !== 'available' || !partner)) return;
  focusSelectedCompanionId = String(id || '');
  focusSelectedCompanion = partner || null;
  focusCompanionChanging = false;
  focusCompanionExpanded = false;
  focusStatusNotice = id ? '陪伴伙伴已选中' : '这段自己专注';
  renderFocusPage();
}

function startFocusTimer() {
  if (focusActionPending || focusFavoritePending || focusSnapshot.active) return;
  var options = focusSnapshot.companionOptions;
  var validCompanion = !focusSelectedCompanionId || !focusLoadError && options && focusCompanionStatus() === 'available' && (options.partners || []).some(function (p) { return p.id === focusSelectedCompanionId; });
  if (!validCompanion || !focusFreeTitle.trim()) {
    focusStatusNotice = focusPreparationHint();
    renderFocusPage();
    toast(focusStatusNotice);
    if (!validCompanion) {
      var companion = document.getElementById('focus-companion-list').querySelector('button');
      var retry = document.getElementById('focus-companion-retry');
      if (companion) companion.focus({ preventScroll: true });
      else if (!retry.classList.contains('hidden')) retry.focus({ preventScroll: true });
    } else document.getElementById('focus-free-title').focus({ preventScroll: true });
    return;
  }
  focusRequest('start', { taskId: focusSelectedTaskId, taskTitle: focusFreeTitle, companionId: focusSelectedCompanionId, focusMinutes: focusMinutes, breakMinutes: breakMinutes, shortBreakMinutes: breakMinutes, totalRounds: focusTotalRounds, longBreakEvery: focusLongBreakEnabled ? focusLongBreakEvery : 0, longBreakMinutes: focusLongBreakMinutes,
    focusConfig: focusCurrentConfig(), favoriteGoalTitle: focusSelectedFavoriteTitle && focusConfigKey(focusSelectedFavoriteTitle) === focusConfigKey(focusFreeTitle) ? focusSelectedFavoriteTitle : '' });
}

function startFocusForTodo(id, title) {
  if (focusActionPending) return;
  if (focusSnapshot.active) {
    switchTab('focus');
    toast('先结束当前这段专注或休息');
    return;
  }
  focusSelectedTaskId = String(id || '');
  focusSelectedFavoriteTitle = '';
  var task = (focusSnapshot.taskOptions || []).find(function (t) { return t.id === focusSelectedTaskId; });
  focusFreeTitle = String(title !== undefined ? title : (task && task.title || ''));
  focusStatusNotice = focusSelectedTaskId ? '已关联这件待办；修改目标后将解除关联。' : '';
  switchTab('focus');
  renderFocusPage();
  toast('目标已填好，可以直接开始，也可以选一位伙伴');
}

function focusTick() {
  focusUpdateMini();
  var reminderStatus = focusReminderStatus();
  if ((focusSnapshot.active || reminderStatus && reminderStatus.end === 'pending') && Date.now() - focusLastRefreshAt > 15000 && !document.getElementById('panel-focus').classList.contains('hidden') && !focusActionPending) {
    focusLastRefreshAt = Date.now();
    loadFocus();
  }
  var active = focusSnapshot.active;
  if (!active) return;
  var remaining = active.pausedAt
    ? Math.max(0, Number(active.remainingMs) || 0)
    : Math.max(0, Date.parse(String(active.targetAt || '')) - Date.now());
  var clock = document.getElementById('focus-clock');
  if (clock) clock.textContent = focusFormatClock(remaining);
  if (remaining <= 0 && !active.pausedAt && !focusAdvancePending && !focusActionPending && Date.now() >= focusAdvanceRetryAt) {
    focusAdvancePending = true;
    focusRequest('advance', null, true);
  }
}

function startFocusTicker() {
  if (focusTicker) return;
  focusTicker = setInterval(focusTick, 1000);
}

function focusOpenDay(date) {
  var day = new Date(String(date || focusTodayKey()) + 'T00:00:00');
  curYear = day.getFullYear();
  curMonth = day.getMonth() + 1;
  switchTab('calendar');
  loadMonth();
  selectDay(dk(curYear, curMonth, day.getDate()), true);
}

function focusOpenMood() {
  var today = focusTodayKey();
  moodPanelOpen = true;
  moodPicked = '';
  moodReasonDraft = '';
  switchTab('calendar');
  selectDay(today);
  loadMoodMetaOnce().then(function () {
    if (moodPanelOpen && selectedDate === today) selectDay(today);
  });
}

/* ── 今日概览 ── */
function loadToday() {
  var requestId = ++todayRequestSeq;
  var now = new Date();
  var key = dk(now.getFullYear(), now.getMonth() + 1, now.getDate());
  var weatherRequest = appSettings.weatherEnabled !== false && appSettings.weatherLocation
    ? api('api/weather/current').catch(function () { return { ok: false }; })
    : Promise.resolve({ ok: false });
  document.getElementById('today-bigday').textContent = pad(now.getDate());
  document.getElementById('today-year').textContent = now.getFullYear();
  document.getElementById('today-month').textContent =
    now.getMonth() + 1 + ' 月 · 星期' + WEEK[now.getDay()];
  api('api/events/' + key).then(function (res) {
    if (requestId !== todayRequestSeq || !res.ok || !res.day) return;
    var day = res.day;
    var fest = document.getElementById('today-fest');
    var evs = document.getElementById('today-events');
    var quiet = document.getElementById('today-quiet');
    fest.innerHTML = '';
    evs.innerHTML = '';
    var has = false;
    (day.builtin || []).forEach(function (f) {
      fest.innerHTML += '<span class="chip">' + esc(f.emoji) + ' ' + esc(f.name) + '</span>';
      has = true;
    });
    var showPeriod = appSettings.showPeriod !== false;
    var all = (day.userEvents || []).concat((showPeriod ? (day.periods || []) : []).map(function (p) {
      var x = Object.assign({}, p); x.type = 'period';
      if (p.predicted) x.title = '预计生理期';
      return x;
    }));
    all.forEach(function (e) {
      var cls = 'ep-' + (e.type || 'event');
      var label = TYPE_NAME[e.type] ? '[' + TYPE_NAME[e.type] + '] ' : '';
      evs.innerHTML += '<span class="chip ' + cls + '">' + esc(label + e.title) + '</span>';
      has = true;
    });
    if (applyTodayWeather(day.weather)) has = true;
    var overdue = day.overdueTodos || [];
    if (overdue.length) {
      evs.innerHTML += '<span class="chip ep-todo">有 ' + overdue.length + ' 次待办已经逾期</span>';
      has = true;
    }
    quiet.classList.toggle('hidden', has);
    weatherRequest.then(function (weatherRes) {
      if (requestId !== todayRequestSeq || !weatherRes || !weatherRes.ok || !weatherRes.weather) return;
      applyTodayWeather(weatherRes.weather);
      quiet.classList.add('hidden');
    });
  });
}

/* ── 日历 ── */
function syncSelectedCellState() {
  var cells = document.querySelectorAll('.cal-day[data-date]');
  for (var i = 0; i < cells.length; i++) {
    var date = cells[i].getAttribute('data-date');
    var selected = !summarySelectMode && date === selectedDate;
    var batchSelected = summarySelectMode && summaryBatchDates.indexOf(date) >= 0;
    cells[i].classList.toggle('selected', selected);
    cells[i].classList.toggle('batch-selected', batchSelected);
    cells[i].setAttribute('aria-pressed', selected || batchSelected ? 'true' : 'false');
  }
}

function shiftMonth(d) {
  curMonth += d;
  if (curMonth < 1) { curMonth = 12; curYear--; }
  if (curMonth > 12) { curMonth = 1; curYear++; }
  selectedDate = null;
  moodLineAnchorDate = null;
  syncSelectedCellState();
  document.getElementById('detail-title').textContent = '点一个日子看看';
  document.getElementById('detail-wk').textContent = '';
  var festsResetEl = document.getElementById('detail-fests');
  if (festsResetEl) festsResetEl.innerHTML = '';
  document.getElementById('detail').classList.add('hidden');
  document.getElementById('detail-body').innerHTML = '<div class="empty">选一天，看看那天有什么好日子。</div>';
  loadMonth();
}

function goToday() {
  var n = new Date();
  curYear = n.getFullYear(); curMonth = n.getMonth() + 1;
  loadMonth();
  if (summarySelectMode) {
    selectedDate = null;
    document.getElementById('detail-title').textContent = '点一个日子看看';
    document.getElementById('detail-wk').textContent = '';
    document.getElementById('detail').classList.add('hidden');
    document.getElementById('detail-body').innerHTML = '<div class="empty">选一天，看看那天有什么好日子。</div>';
    return;
  }
  selectDay(dk(curYear, curMonth, n.getDate()));
}

function startTodayRefresher() {
  if (todayRefreshTimer) return;
  // 天气后台按自己的缓存间隔刷新；页面定期重读，让最新缓存及时反映到今日卡。
  todayRefreshTimer = setInterval(loadToday, 15 * 60 * 1000);
}

function loadMonth() {
  var requestId = ++monthRequestSeq;
  document.getElementById('month-title').textContent = curYear + ' 年 ' + curMonth + ' 月';
  api('api/month/' + curYear + '/' + curMonth).then(function (res) {
    if (requestId !== monthRequestSeq) return;
    if (!res.ok) {
      document.getElementById('calendar').innerHTML = '<div style="grid-column:1/-1;color:var(--muted);padding:20px">加载失败，稍后再试</div>';
      return;
    }
    renderCalendar(res.days);
    renderEmptyGuide(res.hasAnyRecord === false);
    loadPeriodPattern();
  });
}

function renderCalendar(days) {
  var first = new Date(curYear, curMonth - 1, 1);
  var lead = first.getDay();
  var now = new Date();
  var todayStr = dk(now.getFullYear(), now.getMonth() + 1, now.getDate());
  var html = '';
  for (var w = 0; w < 7; w++) {
    var cls = 'cal-head' + (w === 0 ? ' sunday' : (w === 6 ? ' weekend' : ''));
    html += '<div class="' + cls + '">' + WEEK[w] + '</div>';
  }
  for (var i = 0; i < lead; i++) html += '<div class="cal-day empty"></div>';
  days.forEach(function (d) {
    var isToday = d.date === todayStr;
    var isSelected = !summarySelectMode && d.date === selectedDate;
    var isBatchSelected = summarySelectMode && summaryBatchDates.indexOf(d.date) >= 0;
    var canBatch = d.canBatchSummary !== false;
    var dt = new Date(d.date + 'T00:00:00');
    var wd = dt.getDay();
    var numCls = (wd === 0 || wd === 6) ? ' weekend-num' : '';
    var showPeriod = appSettings.showPeriod !== false;
    var userList = (d.user || []).filter(function (u) { return showPeriod || u.type !== 'period'; });
    var periodCount = showPeriod ? (d.periods || 0) : 0;
    var predictedPeriodCount = showPeriod ? (d.predictedPeriods || 0) : 0;
    var tags = [];
    if (d.builtin && d.builtin.length) {
      var b = d.builtin[0];
      tags.push('<span class="tag builtin">' + esc(b.emoji) + ' ' + esc(b.name) + '</span>');
    }
    var userShown = 0;
    var periodShown = false;
    userList.forEach(function (u) {
      if (u.type === 'period') { periodShown = true; return; }
      if (userShown >= 2) return;
      tags.push('<span class="tag ' + esc(u.type || 'event') + '">' + esc(u.title) + '</span>');
      userShown++;
    });
    if (periodCount > 0 && !periodShown) {
      var dot = '<span class="period-dot"></span>';
      if (tags.length < 3) tags.push('<span class="tag period">' + dot + '生理期</span>');
      else tags[tags.length - 1] += dot;
    } else if (predictedPeriodCount > 0 && !periodShown && tags.length < 3) {
      tags.push('<span class="tag period predicted">预计生理期</span>');
    }
    var total = (d.builtin ? d.builtin.length : 0) + userList.length + (periodCount || predictedPeriodCount ? 1 : 0);
    if (total > tags.length) {
      tags.push('<span class="tag more">+' + (total - tags.length) + '</span>');
    }
    var cellClass = 'cal-day' + (isToday ? ' today' : '') + (isSelected ? ' selected' : '') + (isBatchSelected ? ' batch-selected' : '');
    if (summarySelectMode && !canBatch) cellClass += ' batch-disabled';
    var pressed = summarySelectMode ? isBatchSelected : isSelected;
    var onclick = summarySelectMode
      ? (canBatch ? 'toggleSummaryBatchDate(' + jsArg(d.date) + ')' : 'return false')
      : 'selectDay(' + jsArg(d.date) + ', true)';
    var keyAction = summarySelectMode
      ? (canBatch ? "if(event.key==='Enter'||event.key===' '){toggleSummaryBatchDate(" + jsArg(d.date) + ')}' : 'return false')
      : "if(event.key==='Enter'||event.key===' '){selectDay(" + jsArg(d.date) + ',true)}';
    var cellTitle = summarySelectMode && !canBatch ? '这一天还没结束，暂时不能做成册' : '';
    html += '<div class="' + cellClass + '" data-date="' + esc(d.date) + '" role="button" aria-pressed="' + (pressed ? 'true' : 'false') + '" aria-disabled="' + (summarySelectMode && !canBatch ? 'true' : 'false') + '" tabindex="0" title="' + cellTitle + '" onclick="' + onclick + '" onkeydown="' + keyAction + '">' +
      '<div class="num"><span class="' + numCls + '">' + d.date.slice(8) + '</span>' +
      (isToday ? '<span class="today-tag">今天</span>' : '') +
      (d.hasSummary ? '<span class="sum-tag" title="这天已收进时光册">✦</span>' : '') + '</div>' +
      (d.hasMood && d.moodEmoji ? '<span class="mood-tag" title="这天记了心情">' + esc(d.moodEmoji) + '</span>' : '') +
      '<div class="tags">' + tags.slice(0, 3).join('') + '</div>' +
      '</div>';
  });
  document.getElementById('calendar').innerHTML = html;
}

// 新手引导：当月完全没有记录时，告诉新用户点日期就能记。
// 一旦任何一天有了记录，引导自动消失，不再打扰。
function renderEmptyGuide(empty) {
  var guide = document.getElementById('calendar-guide');
  if (!guide) return;
  if (empty) {
    guide.classList.remove('hidden');
  } else {
    guide.classList.add('hidden');
  }
}

/* ── 周期规律：把已经记下的生理期整理成能看出规律的横条 ── */
var periodPatternRequestSeq = 0;

function loadPeriodPattern() {
  var el = document.getElementById('period-pattern');
  if (!el) return;
  if (appSettings.showPeriod === false) { el.classList.add('hidden'); return; }
  var requestId = ++periodPatternRequestSeq;
  api('api/period-pattern').then(function (res) {
    // 月份或设置切得快时，丢掉旧回包
    if (requestId !== periodPatternRequestSeq) return;
    if (!res || !res.ok || res.hidden) { el.classList.add('hidden'); return; }
    renderPeriodPattern(res.pattern);
  }).catch(function () {
    el.classList.add('hidden');
  });
}

function fmtMonthDay(key) {
  var parts = String(key || '').split('-');
  if (parts.length !== 3) return String(key || '');
  return Number(parts[1]) + '月' + Number(parts[2]) + '日';
}

function renderPeriodPattern(p) {
  var el = document.getElementById('period-pattern');
  var nowEl = document.getElementById('pp-now');
  var barsEl = document.getElementById('pp-bars');
  var statsEl = document.getElementById('pp-stats');
  var nextEl = document.getElementById('pp-next');
  var hintEl = document.getElementById('pp-hint');
  if (!el || !nowEl || !barsEl || !statsEl || !nextEl) return;
  if (!p || !p.total) { el.classList.add('hidden'); return; }
  el.classList.remove('hidden');

  // 今天走到第几天；预计的日子早过了就如实说，不硬编一个正常态
  if (p.current && p.current.overdueDays) {
    nowEl.className = 'pp-now overdue';
    nowEl.innerHTML = '预计的日子已经过去 <b>' + p.current.overdueDays + '</b> 天了，可能这几天忘了记';
  } else if (p.current) {
    nowEl.className = 'pp-now';
    nowEl.innerHTML = '<span class="pp-now-dot"></span>今天 · 第 <b>' + p.current.day + '</b> 天';
  } else {
    nowEl.className = 'pp-now';
    nowEl.innerHTML = '';
  }

  // 长短条：条长按真实间隔比例，不为了好看拉平差异
  var bars = (p.cycles || []).filter(function (c) { return c.interval; });
  if (bars.length) {
    var maxIv = Math.max.apply(null, bars.map(function (c) { return c.interval; }));
    barsEl.innerHTML = bars.map(function (c) {
      var pct = Math.max(12, Math.round(c.interval / maxIv * 100));
      return '<div class="pp-row">' +
        '<span class="pp-row-label">' + esc(c.start.slice(5).replace('-', '/')) + '</span>' +
        '<span class="pp-row-track"><span class="pp-row-fill" style="width:' + pct + '%"></span></span>' +
        '<span class="pp-row-val">' + c.interval + ' 天</span>' +
        '</div>';
    }).join('');
  } else {
    barsEl.innerHTML = '';
  }

  if (p.enough && p.stats) {
    var span = p.stats.minInterval === p.stats.maxInterval
      ? '一直很稳'
      : p.stats.minInterval + ' ~ ' + p.stats.maxInterval + ' 天';
    statsEl.innerHTML =
      '<div class="pp-stat"><span class="pp-stat-label">一般多久来一次</span><span class="pp-stat-value"><b>' + p.stats.medianInterval + '</b> 天</span></div>' +
      '<div class="pp-stat"><span class="pp-stat-label">一般来几天</span><span class="pp-stat-value"><b>' + p.stats.medianDays + '</b> 天</span></div>' +
      '<div class="pp-stat"><span class="pp-stat-label">长短起伏</span><span class="pp-stat-value">' + esc(span) + '</span></div>';
    var n = p.next || {};
    var nextText;
    if (n.earliest && n.earliest === n.latest) {
      nextText = '下次预计 <b>' + fmtMonthDay(n.likely) + '</b> 前后';
    } else {
      nextText = '下次预计在 <b>' + fmtMonthDay(n.earliest) + ' ~ ' + fmtMonthDay(n.latest) + '</b> 之间，最可能是 <b>' + fmtMonthDay(n.likely) + '</b>';
    }
    nextEl.innerHTML = nextText + '<span class="pp-thin"> · 按你自己这几次的节奏推的，参考就好</span>';
  } else {
    statsEl.innerHTML = '';
    nextEl.innerHTML = '还差 ' + p.needMore + ' 次记录，就能看出你的规律了' +
      '<span class="pp-thin"> · 现在记了 ' + p.total + ' 次</span>';
  }

  // 收着的时候也留一句最要紧的：今天走到第几天，或者下次大概什么时候
  if (hintEl) {
    var hintText = '';
    if (p.current && p.current.overdueDays) hintText = '已经晚 ' + p.current.overdueDays + ' 天';
    else if (p.current) hintText = '今天第 ' + p.current.day + ' 天';
    else if (p.enough && p.next) hintText = '下次预计 ' + fmtMonthDay(p.next.likely);
    else if (p.needMore) hintText = '还差 ' + p.needMore + ' 次记录';
    hintEl.textContent = hintText;
  }
}

/** 生理期规律平时收成一行，点一下才摊开；不记展开状态，进页面都是收着的。 */
function togglePeriodPattern() {
  var btn = document.getElementById('pp-toggle');
  var body = document.getElementById('pp-body');
  if (!btn || !body) return;
  var open = btn.getAttribute('aria-expanded') === 'true';
  btn.setAttribute('aria-expanded', open ? 'false' : 'true');
  body.classList.toggle('hidden', open);
}

/* ── 点天详情 ── */
function selectDay(date, userInitiated) {
  selectedDate = date;
  moodLineAnchorDate = date;
  document.getElementById('detail').classList.remove('hidden');
  syncSelectedCellState();
  var dt = new Date(date + 'T00:00:00');
  document.getElementById('detail-title').textContent = date.slice(5).replace('-', ' 月 ') + ' 日';
  document.getElementById('detail-wk').textContent = '星期' + WEEK[dt.getDay()];
  var festsClearEl = document.getElementById('detail-fests');
  if (festsClearEl) festsClearEl.innerHTML = '';
  api('api/events/' + date).then(function (res) {
    if (!res.ok) {
      document.getElementById('detail-body').innerHTML = '<div class="empty">加载失败</div>';
      return;
    }
    renderDetail(res.day);
    if (userInitiated) {
      setTimeout(function () { document.getElementById('detail').scrollIntoView({ behavior: 'smooth', block: 'start' }); }, 30);
    }
  });
}

/** 今天这条待办已经到点、又还没勾掉：页面上标一眼，不能只靠一闪而过的通知。 */
function todoDueNow(event) {
  if (!event || event.type !== 'todo' || event.done) return false;
  var now = new Date();
  var todayStr = dk(now.getFullYear(), now.getMonth() + 1, now.getDate());
  if (String(event.date || '') !== todayStr) return false;
  var parts = String(event.reminderStart || '').split(':');
  if (parts.length !== 2) return false;
  var minutes = Number(parts[0]) * 60 + Number(parts[1]);
  if (!isFinite(minutes)) return false;
  return (now.getHours() * 60 + now.getMinutes()) >= minutes;
}

function focusDayRecordsHtml(rows) {
  var groups = focusNormalizeGroups(rows);
  if (!groups.length) return '';
  return '<div class="focus-day-records"><h4>这一天的专注</h4>' + groups.map(function (group) {
    var status = group.planStatus === 'completed' ? '整组完成' : group.planStatus === 'active' ? '进行中' : '提前结束';
    var progress = String(group.completedRounds || 0) + '/' + String(group.totalRounds || 1) + ' 轮';
    var detail = group.partialFocusMs > 0
      ? '未完成轮实记 ' + focusFormatDuration(group.partialFocusMs)
      : '共专注 ' + focusFormatDuration(group.totalFocusMs);
    return '<div class="focus-day-row"><span>' + esc(group.taskTitle || '自由专注') + ' · ' + status + ' · ' + progress + '</span><small>' +
      esc(focusFormatRange(group)) + ' · ' + esc(detail) + '</small></div>';
  }).join('') + '</div>';
}

function renderDetail(day) {
  editingTodoNeedsReminderTime = false;
  editingRecurringTodo = false;
  todoReminderManual = false;
  todoReminderAutofilled = false;
  todoReminderAutofilling = false;
  var html = '';
  // ── 记一笔当下的心情（顶部心情行） ──
  // ── 节日归到标题行：它是“那天是什么日子”，跟日期同层，不是一项操作 ──
  var festsEl = document.getElementById('detail-fests');
  if (festsEl) {
    festsEl.innerHTML = (day.builtin || []).map(function (f) {
      var cls = 'detail-fest' + (f.kind === 'legal' ? ' legal' : '');
      return '<span class="' + cls + '">' + esc(f.emoji) + ' ' + esc(f.name) + ' · ' + esc(f.source) + '</span>';
    }).join('');
  }
  // ── 记一笔当下的心情（顶部心情行） ──
  html += renderMoodPanel(day);
  if (day.workday) {
    html += '<span class="workday-note">调休上班日，记得定闹钟</span>';
  }
  var showPeriod = appSettings.showPeriod !== false;
  var userList = (day.userEvents || []).filter(function (u) { return showPeriod || u.type !== 'period'; });
  var periods = (showPeriod ? (day.periods || []) : []);
  var canAddTodo = day.canAddTodo !== false;
  // 当前/未来生活日更偏向安排接下来要做的事；已翻篇的日子默认补记随记。
  var defaultType = canAddTodo ? 'todo' : 'event';
  var hasHistoricalTodo = userList.some(function (event) { return event.type === 'todo'; });

  // ── 生理期快捷区 ──
  if (showPeriod) {
    if (periods.length) {
      var p = periods[0];
      var dayN = p.day || 1;
      var todayKey = dk(new Date().getFullYear(), new Date().getMonth() + 1, new Date().getDate());
      var prefix = selectedDate === todayKey ? '今天' : '这天';
      var periodText = p.predicted
        ? '预计是生理期第 <b>' + dayN + '</b> 天'
        : prefix + '是生理期第 <b>' + dayN + '</b> 天';
      var periodAction = p.predicted
        ? '<button class="pq-btn primary" onclick="markPeriod(\\'' + selectedDate + '\\')">确认这天</button>'
        : '<button class="pq-btn" onclick="unmarkPeriod(\\'' + selectedDate + '\\')">从这天结束</button>';
      html += '<div class="period-quick on">' +
        '<span class="pq-dot"></span>' +
        '<span class="pq-text">' + periodText + '</span>' + periodAction +
        '</div>';
    } else {
      // 不在生理期内：按日期相对今天分时态给动作
      var todayStr = dk(new Date().getFullYear(), new Date().getMonth() + 1, new Date().getDate());
      var isToday = selectedDate === todayStr;
      var isFuture = selectedDate > todayStr; // YYYY-MM-DD 字符串可直接比较
      var prevConfirmed = (day.prevPeriods || []).some(function (p) { return !p.predicted; });
      var recentPeriod = (day.prevPeriods || []).length > 0;
      // 已确认结束：昨天/最近在周期内且周期已确认结束（confirmedThrough < 今天）→ 显示「已结束」确认条
      var endedOn = '';
      var prevPeriods = day.prevPeriods || [];
      for (var pi = 0; pi < prevPeriods.length; pi++) {
        var pp = prevPeriods[pi];
        if (pp.confirmedThrough && pp.confirmedThrough < todayStr) {
          endedOn = pp.confirmedThrough;
          break;
        }
      }
      var htmlBtn = '';
      if (isToday && endedOn) {
        // 今天已确认结束：显示结束确认条，不再给操作按钮
        htmlBtn = '';
        html += '<div class="period-quick on">' +
          '<span class="pq-dot"></span>' +
          '<span class="pq-text">生理期已于 <b>' + endedOn.slice(5) + '</b> 结束 ✦</span>' +
          '</div>';
      } else if (isToday && prevConfirmed) {
        htmlBtn = '<button class="pq-btn primary" onclick="markPeriod(\\'' + selectedDate + '\\')">今天也是生理期</button>' +
          '<button class="pq-btn" onclick="endPeriod(\\'' + selectedDate + '\\')">今天结束了</button>';
      } else if (isToday && recentPeriod) {
        // 昨天在周期内、今天不在：今天已结束，给「确认结束」入口，不误删昨天
        htmlBtn = '<button class="pq-btn primary" onclick="endPeriod(\\'' + selectedDate + '\\')">今天结束了</button>';
      } else if (isToday) {
        htmlBtn = '<button class="pq-btn primary" onclick="markPeriod(\\'' + selectedDate + '\\')">今天开始生理期</button>';
      } else if (isFuture) {
        htmlBtn = '<button class="pq-btn primary" onclick="markPeriod(\\'' + selectedDate + '\\')">预计这天开始生理期</button>';
      }
      // 补记开始日：今天与过去显示；未来只有预计，不显示补记
      var showPick = !isFuture && !endedOn;
      if (!(isToday && endedOn)) {
        html += '<div class="period-quick">' +
          '<span class="pq-dot"></span>' +
          htmlBtn +
          (showPick ? '<button class="pq-btn" onclick="togglePeriodPicker()">补记开始日</button>' : '') +
          '<span class="pq-picker hidden" id="period-picker">' +
          '<input type="date" id="period-start" value="' + selectedDate + '">' +
          '<button class="pq-btn" onclick="markPeriodFromPicker()">确定</button>' +
          '</span>' +
          '</div>';
      }
    }
  }

  // ── 事件列表 ──
  dayEventCache = {};
  var all = userList.concat(periods.map(function (p) {
    var x = Object.assign({}, p); x.type = 'period'; return x;
  }));
  if (all.length) {
    all.forEach(function (e) {
      dayEventCache[e.id] = e;
      var t = e.type || 'event';
      var titleHtml = esc(e.title);
      if (t === 'period') titleHtml = (e.predicted ? '预计生理期' : '生理期') + (e.day ? ' · 第' + e.day + '天' : '');
      var todoTimeText = '';
      if (t === 'todo') {
        var timeStart = String(e.reminderStart || '');
        var timeEnd = String(e.reminderEnd || '');
        if (timeStart && timeEnd) {
          todoTimeText = timeStart === timeEnd ? timeStart + ' 准点' : timeStart + '–' + timeEnd;
        } else {
          todoTimeText = '待补提醒时间';
        }
      }
      var left = '';
      if (t === 'todo') {
        var done = e.done ? ' checked' : '';
        left = '<button class="todo-check' + done + '" onclick="toggleTodo(\\'' + e.id + '\\')" title="完成/取消"></button>';
      } else {
        left = '<span class="bar b-' + safeType(t) + '"></span>';
      }
      var startFocusAction = t === 'todo' && !e.done
        ? '<button type="button" class="focus-start-link" onclick="startFocusForTodo(' + jsArg(e.id) + ',' + jsArg(e.title) + ')">专注</button>'
        : '';
      var actions = t === 'period'
        ? ''
        : startFocusAction + '<button class="del" onclick="startEditEvent(\\'' + e.id + '\\')" title="编辑">改</button>' +
          '<button class="del" onclick="delEvent(\\'' + e.id + '\\')" title="删除">✕</button>';
      html += '<div class="event-row' + (e.done ? ' done' : '') + '">' +
        left +
        '<span class="type t-' + safeType(t) + '">' + (TYPE_NAME[t] || '日子') + '</span>' +
        '<span class="title">' + titleHtml +
        (t === 'todo' ? '<span class="todo-time' + (todoTimeText === '待补提醒时间' ? ' missing' : '') + '">' + esc(todoTimeText) + '</span>' + (todoRepeatLabel(e.repeatRule) ? '<span class="todo-repeat-tag">' + esc(todoRepeatLabel(e.repeatRule)) + '</span>' : '') + (todoDueNow(e) ? '<span class="todo-due">到点了</span>' : '') : '') +
        (e.note && t !== 'period' ? '<span class="note">' + esc(e.note) + '</span>' : '') + '</span>' + actions +
        '</div>';
    });
  }

  // 生理期走上面的快捷区；新增时日期沿用刚刚点选的这一天，编辑时才展开改日期。
  var todoTab = canAddTodo
    ? '<button class="type-tab' + (defaultType === 'todo' ? ' active' : '') + '" data-type="todo">待办</button>'
    : (hasHistoricalTodo ? '<button class="type-tab" data-type="todo" disabled title="历史待办保留在记录里，编辑时可以保留">待办（已有）</button>' : '');
  var dateStateNote = canAddTodo ? '' : '<span class="add-date-note past-note">这天已翻篇，只能补记</span>';
  var selectedWeekday = new Date(selectedDate + 'T00:00:00').getDay();
  var repeatDayOptions = WEEK.map(function (day, index) {
    return '<label class="todo-repeat-day"><input type="checkbox" value="' + index + '"' + (index === selectedWeekday ? ' checked' : '') + '><span>' + day + '</span></label>';
  }).join('');
  html += '<div class="add-card">' +
    '<div class="add-head">' +
    '<span class="add-title">记一笔</span>' +
    '<span class="add-date-note" id="new-date-note">记到 ' + esc(selectedDate) + '</span>' +
    dateStateNote +
    '</div>' +
    '<div class="add-form">' +
    '<div class="type-tabs" id="type-tabs">' +
    '<button class="type-tab' + (defaultType === 'event' ? ' active' : '') + '" data-type="event">随记</button>' +
    '<button class="type-tab" data-type="anniversary">纪念</button>' +
    todoTab +
    '</div>' +
    '<div class="type-tip" id="new-type-tip">' + TYPE_TIPS[defaultType] + '</div>' +
    '<input id="new-title" placeholder="' + NEW_TITLE_PLACEHOLDER[defaultType] + '" maxlength="40">' +
    '<input id="new-note" placeholder="备注（可不填）" maxlength="80">' +
    '<input type="date" id="new-date" class="hidden" value="' + selectedDate + '">' +
    '<div class="todo-reminder' + (defaultType === 'todo' ? '' : ' hidden') + '" id="todo-reminder">' +
      '<span class="todo-reminder-label">提醒时间</span>' +
      '<label class="todo-time-label">从 <input type="time" id="new-reminder-start" class="todo-time-input" aria-label="提醒开始时间"></label>' +
      '<span class="todo-time-sep">到</span>' +
      '<label class="todo-time-label"><input type="time" id="new-reminder-end" class="todo-time-input" aria-label="提醒结束时间"></label>' +
      '<span class="todo-time-preview" id="todo-time-preview">标题里写明确时间（如“下午三点”或“9点”）会自动填入；当天白天写“两点”会按下午两点；有“提醒”时优先它旁边的时间</span>' +
    '</div>' +
    '<div class="todo-repeat" id="todo-repeat-settings">' +
      '<span class="todo-repeat-label">重复</span>' +
      '<select id="new-todo-repeat"><option value="none">不重复</option><option value="daily">每天</option><option value="weekly">每周选几天</option></select>' +
      '<div class="todo-repeat-days hidden" id="todo-repeat-days">' + repeatDayOptions + '</div>' +
      '<span class="todo-repeat-note" id="todo-repeat-note">没勾掉也会照原来的日期继续；欠下的次数可在左侧门厅整理。</span>' +
    '</div>' +
    '<div class="todo-time-error hidden" id="todo-time-error"></div>' +
    '<div class="add-actions">' +
    '<button class="btn primary" id="event-save-btn" onclick="saveEvent()">记下</button>' +
    '<button class="btn hidden" id="event-cancel-btn" onclick="cancelEditEvent()">取消编辑</button>' +
    '</div>' +
    '</div>' +
    '</div>';
  // 这一天的这一页：先把记笔的地方摆好，翻看放在后面
  html += renderSummaryBlock(day);
  document.getElementById('detail-body').innerHTML = html;
  syncTodoReminderUI(defaultType);
  syncTodoRepeatUI(defaultType);
}

// ── 记一笔当下的心情（页面端） ──
var MOOD_META_CACHE = [];
var moodPanelOpen = false;
var moodPicked = '';
var moodReasonDraft = '';

function loadMoodMetaOnce() {
  if (MOOD_META_CACHE.length) return Promise.resolve(MOOD_META_CACHE);
  return api('api/moods/meta').then(function (res) {
    MOOD_META_CACHE = (res && res.ok && res.moods) ? res.moods : [];
    return MOOD_META_CACHE;
  }).catch(function () { return []; });
}

function moodLineHasSegment(id) {
  for (var i = 0; i < MOOD_LINE_SEGMENTS.length; i++) if (MOOD_LINE_SEGMENTS[i].id === id) return true;
  return false;
}

function moodLineSegmentForHour(hour) {
  var h = Number(hour);
  if (!Number.isFinite(h)) return 'noon';
  if (h >= 4 && h < 8) return 'dawn';
  if (h >= 8 && h < 12) return 'morning';
  if (h >= 12 && h < 14) return 'noon';
  if (h >= 14 && h < 18) return 'afternoon';
  if (h >= 18 && h < 20) return 'dusk';
  if (h >= 20 && h < 24) return 'evening';
  return 'night';
}

function moodLineExactTimestamp(entry) {
  if (!entry || typeof entry !== 'object') return '';
  if (entry.source === 'auto') {
    return entry.timePrecision === 'turn' && entry.observedAt && !Number.isNaN(new Date(entry.observedAt).getTime()) ? entry.observedAt : '';
  }
  return entry.recordedAt && !Number.isNaN(new Date(entry.recordedAt).getTime()) ? entry.recordedAt : '';
}

function moodLineSegmentForEntry(entry) {
  var item = entry || {};
  if (moodLineHasSegment(item.lineSegment)) return item.lineSegment;
  // 自动发现只有抄回真实消息分钟时才展开；普通 recordedAt 仍只是合稿时间。
  var exact = moodLineExactTimestamp(item);
  if (exact) {
    var timestamp = new Date(exact);
    if (!Number.isNaN(timestamp.getTime())) return moodLineSegmentForHour(timestamp.getHours());
  }
  var legacy = ({ morning: 'morning', afternoon: 'afternoon', evening: 'evening', day: 'noon' })[item.segment];
  return moodLineHasSegment(legacy) ? legacy : 'noon';
}

function moodLineHasExactTime(entry) {
  return !!moodLineExactTimestamp(entry);
}

function moodLineLifeMinute(entry) {
  var value = moodLineExactTimestamp(entry);
  if (!value) return null;
  var timestamp = new Date(value);
  var minutes = timestamp.getHours() * 60 + timestamp.getMinutes() + timestamp.getSeconds() / 60;
  return (minutes - 4 * 60 + 24 * 60) % (24 * 60);
}

function moodLineSegmentCenterMinute(segment) {
  var item = MOOD_LINE_SEGMENTS.find(function (candidate) { return candidate.id === segment; }) || MOOD_LINE_SEGMENTS.find(function (candidate) { return candidate.id === 'noon'; });
  var start = ((item.startHour - 4 + 24) % 24) * 60;
  var end = item.endHour === 24 ? 24 * 60 : ((item.endHour - 4 + 24) % 24) * 60;
  if (end <= start) end += 24 * 60;
  return (start + end) / 2;
}

function moodLineSegmentLabelForEntry(entry) {
  if (entry && entry.lineSegmentLabel && !(entry.source === 'auto' && entry.timePrecision === 'turn')) return entry.lineSegmentLabel;
  if (entry && entry.source === 'auto' && entry.segment === 'day' && !moodLineHasExactTime(entry)) return '白天';
  return moodLineSegmentLabel(moodLineSegmentForEntry(entry));
}

function moodLineEntryTimeLabel(entry) {
  var segment = moodLineSegmentLabelForEntry(entry);
  if (!moodLineHasExactTime(entry)) return segment;
  var timestamp = new Date(moodLineExactTimestamp(entry));
  return segment + ' ' + String(timestamp.getHours()).padStart(2, '0') + ':' + String(timestamp.getMinutes()).padStart(2, '0');
}

function moodSegLabel(seg, entry) {
  return entry ? moodLineSegmentLabelForEntry(entry) : moodLineSegmentLabel(seg);
}

function moodPillHtml(entry) {
  var seg = moodLineEntryTimeLabel(entry);
  return '<span class="mood-pill" title="' + esc(moodLineEntryTitle(entry)) + '">' +
    '<span class="pill-emoji">' + esc(entry.emoji || '') + '</span>' +
    '<span>' + esc(entry.label || '') + '</span>' +
    (entry.source === 'auto' ? '<span class="pill-source">候选</span>' : '') +
    (seg ? '<span class="pill-seg">' + esc(seg) + '</span>' : '') +
    '<button class="pill-del" onclick="deleteMood(\\'' + esc(entry.id) + '\\', this)" title="删掉这条">×</button>' +
    '</span>';
}

function renderMoodPanel(day) {
  var moods = day.moods || [];
  var isToday = selectedDate === dk(new Date().getFullYear(), new Date().getMonth() + 1, new Date().getDate());
  var html = '<div class="mood-line">';
  if (isToday) {
    html += '<button class="mood-fab" onclick="toggleMoodPanel()" type="button" aria-expanded="' + (moodPanelOpen ? 'true' : 'false') + '">' +
      '<span class="fab-emoji">' + (moods.length ? esc(moods[moods.length - 1].emoji || '◍') : '◍') + '</span>' +
      '记一笔当下的心情</button>';
    moods.forEach(function (entry) { html += moodPillHtml(entry); });
    if (moods.length) html += '<button type="button" class="mood-view-link" onclick="openMoodLine(selectedDate)">看这天的心情线</button>';
    if (moodPanelOpen) html += renderMoodOpenPanel();
  } else if (moods.length) {
    // 非今天（已翻篇）：只显示小表情时间线（带删，可回看可修正）
    html += '<span class="mood-timeline" style="flex:1">';
    moods.forEach(function (entry) {
      var seg = moodLineEntryTimeLabel(entry);
      html += '<span class="mood-tl-item' + (entry.source === 'auto' ? ' tl-auto' : '') + '" title="' + esc(moodLineEntryTitle(entry)) + '">' +
        '<span class="tl-seg">' + esc(seg) + '</span>' +
        '<span class="tl-emoji">' + esc(entry.emoji || '') + '</span>' +
        '<span>' + esc(entry.label || '') + '</span>' +
        (entry.source === 'auto' ? '<span class="tl-source">候选</span>' : '') +
        '<button class="mood-tl-del" onclick="deleteMood(\\'' + esc(entry.id) + '\\')" title="删掉这条">×</button>' +
        '</span>';
    });
    html += '</span>';
    html += '<button type="button" class="mood-view-link" onclick="openMoodLine(selectedDate)">看这天的心情线</button>';
  } else {
    return ''; // 没有心情记录的过去/未来日子不占地方
  }
  html += '</div>';
  return html;
}

function renderMoodOpenPanel() {
  var html = '<div class="mood-open">' +
    '<div class="mood-grid" id="mood-grid">';
  (MOOD_META_CACHE || []).forEach(function (m) {
    html += '<button type="button" class="mood-cell' + (moodPicked === m.id ? ' picked' : '') + '" data-mood="' + esc(m.id) + '" onclick="pickMood(\\'' + esc(m.id) + '\\')">' +
      '<span class="e">' + esc(m.emoji) + '</span><span>' + esc(m.label) + '</span></button>';
  });
  html += '</div>' +
    '<div class="mood-reason-row">' +
    '<span class="mood-hint-line">想补一句原因？</span>' +
    '<input id="mood-reason" maxlength="80" placeholder="想写就写，比如：和慧慧逛街超开心~" value="' + esc(moodReasonDraft) + '" oninput="moodReasonDraft=this.value">' +
    '</div>' +
    '<div class="mood-open-actions">' +
    '<span class="hint" id="mood-hint">选一个心情，自动带上当前时段</span>' +
    '<button type="button" class="btn" onclick="cancelMoodPanel()">取消</button>' +
    '<button type="button" class="btn primary" id="mood-save-btn" disabled onclick="saveMood()">记下</button>' +
    '</div></div>';
  return html;
}

function toggleMoodPanel() {
  moodPanelOpen = !moodPanelOpen;
  if (moodPanelOpen) {
    moodPicked = '';
    moodReasonDraft = '';
    if (MOOD_META_CACHE.length) { selectDay(selectedDate); }
    else {
      loadMoodMetaOnce().then(function () {
        if (moodPanelOpen) selectDay(selectedDate);
      });
      // 缓存还没回来：先渲染骨架，meta 到了再补一次（避免展开空面板）
      selectDay(selectedDate);
    }
  } else {
    cancelMoodPanel();
  }
}

function cancelMoodPanel() {
  moodPanelOpen = false;
  moodPicked = '';
  moodReasonDraft = '';
  selectDay(selectedDate);
}

function pickMood(id) {
  moodPicked = id;
  var cells = document.querySelectorAll('#mood-grid .mood-cell');
  cells.forEach(function (cell) { cell.classList.toggle('picked', cell.getAttribute('data-mood') === id); });
  var save = document.getElementById('mood-save-btn');
  if (save) save.disabled = false;
  var hint = document.getElementById('mood-hint');
  if (hint) hint.textContent = '选好了，点「记下」就存到今天';
}

function saveMood() {
  if (!moodPicked) return;
  var save = document.getElementById('mood-save-btn');
  if (save) save.disabled = true;
  api('api/moods', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ mood: moodPicked, reason: moodReasonDraft || '' }),
  }).then(function (res) {
    if (res.ok) {
      toast('记下了今天的心情 ✿');
      moodPanelOpen = false;
      moodPicked = '';
      moodReasonDraft = '';
      selectDay(selectedDate);
      loadMonth();
    } else {
      toast(res.error || '这条心情没记上');
      if (save) save.disabled = false;
    }
  }).catch(function () {
    toast('这条心情没记上，检查一下连接');
    if (save) save.disabled = false;
  });
}

function deleteMood(id) {
  if (!selectedDate) return;
  askConfirm('要删掉这条心情记录吗？', function () {
    api('api/moods/' + selectedDate + '/' + encodeURIComponent(id), { method: 'DELETE' }).then(function (res) {
      if (res.ok) { toast('删掉了'); selectDay(selectedDate); loadMonth(); }
      else toast(res.error || '没删掉');
    }).catch(function () { toast('没删掉，检查一下连接'); });
  });
}

// ── 拾性（性格补全）──
// 页面只做三件事：把门槛说人话、把正在长的东西摆出来、让补记和整理随时看得见。
var xingjiState = {
  data: null,
  job: null,
  // deviation 是另一档门槛（2 条 / 2 天），页面上分开报，不跟做法混着算。
  thresholds: {
    positives: 3,
    distinctDays: 2,
    deviation: { positives: 2, distinctDays: 2 },
  },
  range: { earliest: '', latest: '' },
  backfill: { range: '30', dates: null, resume: false },
  busy: {},
  pollTimer: null,
  toastOnComplete: false,
};

function xingjiShiftDate(date, delta) {
  var dt = new Date(String(date || '') + 'T12:00:00');
  if (Number.isNaN(dt.getTime())) dt = new Date();
  dt.setDate(dt.getDate() + Number(delta || 0));
  return dk(dt.getFullYear(), dt.getMonth() + 1, dt.getDate());
}

function xingjiDateText(date) {
  var dt = new Date(String(date || '') + 'T12:00:00');
  if (Number.isNaN(dt.getTime())) return String(date || '');
  return (dt.getMonth() + 1) + ' 月 ' + dt.getDate() + ' 日';
}

function xingjiTimeText(iso) {
  if (!iso) return '';
  var dt = new Date(iso);
  if (Number.isNaN(dt.getTime())) return '';
  var now = new Date();
  var same = dt.getFullYear() === now.getFullYear() && dt.getMonth() === now.getMonth() && dt.getDate() === now.getDate();
  var hm = ('0' + dt.getHours()).slice(-2) + ':' + ('0' + dt.getMinutes()).slice(-2);
  return same ? ('今天 ' + hm) : ((dt.getMonth() + 1) + ' 月 ' + dt.getDate() + ' 日 ' + hm);
}

function xingjiDaysBetween(from, to) {
  var a = new Date(String(from || '') + 'T12:00:00');
  var b = new Date(String(to || '') + 'T12:00:00');
  if (Number.isNaN(a.getTime()) || Number.isNaN(b.getTime()) || b < a) return 0;
  return Math.round((b.getTime() - a.getTime()) / 86400000) + 1;
}

function xingjiLevelLabel(level) {
  if (level === 'likely') return '常见';
  if (level === 'possible') return '看得出';
  return '还在看';
}

function xingjiJobActive() {
  var job = xingjiState.job;
  return !!(job && (job.status === 'queued' || job.status === 'running' || job.status === 'scanning'));
}

function xingjiMeter(label, value, target) {
  var v = Math.max(0, Number(value) || 0);
  var t = Math.max(1, Number(target) || 1);
  var pct = Math.min(100, Math.round(v / t * 100));
  return '<div class="xingji-meter"><div class="xingji-meter-label"><span>' + label + '</span><b>' + v + '/' + t + '</b></div>'
    + '<div class="xingji-meter-track"><i class="xingji-meter-fill" style="width:' + pct + '%"></i></div></div>';
}

function xingjiEvidenceHtml(entry) {
  var evidence = Array.isArray(entry.positives) ? entry.positives : [];
  var negatives = Array.isArray(entry.negatives) ? entry.negatives : [];
  if (!evidence.length && !negatives.length) return '';
  var html = '<details class="xingji-evidence"><summary>看原话</summary><ul>';
  evidence.forEach(function (item) {
    html += '<li>' + esc(item.date) + '　' + esc(item.text) + '</li>';
  });
  negatives.forEach(function (item) {
    html += '<li class="xingji-neg">' + esc(item.date) + '　（这次不是）' + esc(item.text) + '</li>';
  });
  return html + '</ul></details>';
}

function xingjiRejectButton(agentId, entryId) {
  return '<button type="button" class="xingji-reject" onclick="rejectXingjiEntry(\\'' + esc(agentId) + '\\',\\'' + esc(entryId) + '\\')">这条不对</button>';
}

function xingjiRelationTag(entry) {
  var relation = String((entry && entry.relation) || '');
  // 老档案没这一栏，就不硬贴标签；新数据才分「设定里有」和「设定里没写」。
  if (relation === 'unwritten') return '<span class="xingji-relation-tag">设定里没写</span>';
  if (relation === 'described') return '<span class="xingji-relation-tag is-written">设定里写着</span>';
  return '';
}

function xingjiEntryHtml(agent, entry) {
  var stats = entry.stats || {};
  var html = '<article class="xingji-entry">';
  html += '<div class="xingji-entry-top"><span class="xingji-level ' + esc(entry.level) + '">' + esc(xingjiLevelLabel(entry.level)) + '</span>';
  if (xingjiIsDeviation(entry)) html += '<span class="xingji-kind-tag">反常</span>';
  html += xingjiRelationTag(entry);
  html += '</div>';
  html += '<p class="xingji-entry-line"><span class="xingji-situation">' + esc(entry.situation) + '</span><span class="xingji-arrow">→</span><span class="xingji-behavior">' + esc(entry.behavior) + '</span></p>';
  html += '<p class="xingji-entry-meta">' + (stats.positives || 0) + ' 条证据 · 落在 ' + (stats.distinctDays || 0) + ' 个日子 · 跨 ' + (stats.spanDays || 0) + ' 天';
  if (stats.negatives) html += ' · 也有 ' + stats.negatives + ' 次不是这样';
  html += '</p>';
  html += xingjiEvidenceHtml(entry);
  html += xingjiRejectButton(agent.agentId, entry.id);
  return html + '</article>';
}

function xingjiIsDeviation(entry) {
  return String((entry && entry.kind) || '') === 'deviation';
}

function xingjiThresholdsFor(entry) {
  var t = xingjiState.thresholds || {};
  return xingjiIsDeviation(entry) ? (t.deviation || t) : t;
}

function xingjiCandidateHtml(agent, entry) {
  var stats = entry.stats || {};
  var t = xingjiThresholdsFor(entry);
  var deviation = xingjiIsDeviation(entry);
  var html = '<article class="xingji-candidate">';
  html += '<p class="xingji-entry-line"><span class="xingji-situation">' + esc(entry.situation) + '</span><span class="xingji-arrow">→</span><span class="xingji-behavior">' + esc(entry.behavior) + '</span></p>';
  html += '<div class="xingji-meter-row">';
  html += xingjiMeter('证据', stats.positives || 0, t.positives);
  html += xingjiMeter('不同日子', stats.distinctDays || 0, t.distinctDays);
  html += '</div>';
  html += xingjiEvidenceHtml(entry);
  html += xingjiRejectButton(agent.agentId, entry.id);
  return html + '</article>';
}

function xingjiAvatarHtml(agent) {
  var initial = Array.from(String(agent.name || '伙伴'))[0] || '伙';
  return '<span class="xingji-avatar" aria-hidden="true"><span>' + esc(initial) + '</span>'
    + '<img hidden data-xingji-avatar="' + esc(agent.agentId) + '" alt=""></span>';
}

function xingjiLoadAvatars() {
  var imgs = document.querySelectorAll('img[data-xingji-avatar]');
  for (var i = 0; i < imgs.length; i++) {
    (function (img) {
      if (img.dataset.loading) return;
      img.dataset.loading = 'true';
      var id = img.dataset.xingjiAvatar;
      if (!focusAvatarCache.has(id)) {
        focusAvatarCache.set(id, apiFetch('api/focus/avatar/' + encodeURIComponent(id), { signal: AbortSignal.timeout(5000) }).then(function (res) {
          if (!res.ok) throw new Error('avatar unavailable');
          return res.blob();
        }).then(function (blob) { return URL.createObjectURL(blob); }).catch(function () { return ''; }));
      }
      focusAvatarCache.get(id).then(function (src) {
        if (!src) return;
        img.onload = function () { img.hidden = false; };
        img.onerror = function () { img.hidden = true; img.removeAttribute('src'); };
        img.src = src;
      });
    })(imgs[i]);
  }
}

function renderXingjiAgent(agent, index) {
  var entries = Array.isArray(agent.entries) ? agent.entries : [];
  var candidates = Array.isArray(agent.candidates) ? agent.candidates : [];
  var pending = Number(agent.pending) || 0;
  var pendingDays = Number(agent.pendingDays) || 0;
  var tone = index % 3;
  var status = entries.length ? ('看出 ' + entries.length + ' 条') : (candidates.length ? (candidates.length + ' 条还在长') : (pending ? '在攒观察' : '还没遇到'));
  var statusClass = entries.length ? '' : (candidates.length ? ' warm' : ' quiet');
  var meta = [];
  if (agent.lastRollupAt) meta.push('最近整理 ' + xingjiTimeText(agent.lastRollupAt));
  else meta.push('还没整理过');
  var html = '<section class="xingji-agent-card tone-' + tone + '">';
  html += '<header class="xingji-agent-head"><div class="xingji-agent-who">';
  html += xingjiAvatarHtml(agent);
  html += '<div><div class="xingji-agent-name">' + esc(agent.name) + '</div><div class="xingji-agent-meta">' + esc(meta.join(' · ')) + '</div></div>';
  html += '</div><span class="xingji-pill' + statusClass + '">' + esc(status) + '</span></header>';

  // 一贯做法与反常的一刻分开摆：前者是 ta 的习惯，后者只是一次样本，
  // 混在一列里会让低频的偏离看起来像「应当重复的做法」。
  var patternEntries = entries.filter(function (entry) { return !xingjiIsDeviation(entry); });
  var deviationEntries = entries.filter(xingjiIsDeviation);
  var patternCandidates = candidates.filter(function (entry) { return !xingjiIsDeviation(entry); });
  var deviationCandidates = candidates.filter(xingjiIsDeviation);

  if (patternEntries.length) {
    html += '<div class="xingji-section-label">一贯的做法</div>';
    patternEntries.forEach(function (entry) { html += xingjiEntryHtml(agent, entry); });
  }

  if (deviationEntries.length) {
    html += '<div class="xingji-section-label">反常的几回</div>';
    html += '<p class="xingji-candidates-tip">这几处 ta 跟平时不一样。这里只是记下来给你看，不是要 ta 重复做的事。</p>';
    deviationEntries.forEach(function (entry) { html += xingjiEntryHtml(agent, entry); });
  }

  if (patternCandidates.length) {
    var open = (patternEntries.length || deviationEntries.length) ? '' : ' open';
    html += '<details class="xingji-candidates"' + open + '>';
    html += '<summary>还在长 · ' + (patternCandidates.length + deviationCandidates.length) + ' 条还不算数</summary>';
    html += '<p class="xingji-candidates-tip">这些是过程，还没到「写进档案」的门槛。可以看看，觉得不对也能先拉掉。</p>';
    if (patternCandidates.length) patternCandidates.forEach(function (entry) { html += xingjiCandidateHtml(agent, entry); });
    if (deviationCandidates.length) {
      html += '<div class="xingji-section-label">其中的反常</div>';
      deviationCandidates.forEach(function (entry) { html += xingjiCandidateHtml(agent, entry); });
    }
    html += '</details>';
  } else if (deviationCandidates.length) {
    html += '<details class="xingji-candidates" open>';
    html += '<summary>还在长 · ' + deviationCandidates.length + ' 条还不算数</summary>';
    html += '<p class="xingji-candidates-tip">这些是过程，还没到「写进档案」的门槛。</p>';
    deviationCandidates.forEach(function (entry) { html += xingjiCandidateHtml(agent, entry); });
    html += '</details>';
  }

  if (!entries.length && !candidates.length && !pending) {
    html += '<p class="xingji-empty">还没有遇到能反复出现的做法。等你们多相处几天，这里会自己长出来。</p>';
  }

  html += '<div class="xingji-agent-foot">';
  if (pending) {
    html += '<p>还有 <b style="color:var(--ink)">' + pending + '</b> 段观察没归类' + (pendingDays ? ('，来自 ' + pendingDays + ' 个日子') : '') + '。整理一次会问一次模型，看看它们能不能拼成一条。</p>';
    var rollupDisabled = '';
    if (xingjiJobActive()) rollupDisabled = ' disabled title="补记正在跑，等它跑完再整理"';
    else if (!(xingjiState.data && xingjiState.data.enabled === true)) rollupDisabled = ' disabled title="先在设置里打开拾性"';
    html += '<button type="button" class="btn" onclick="rollupXingjiAgent(\\'' + esc(agent.agentId) + '\\', this)"' + rollupDisabled + '>整理这些观察</button>';
  } else if (entries.length || candidates.length) {
    html += '<p>最近没有新的观察。等下一次翻篇，拾性会自己接着看。</p>';
  } else {
    html += '<p>拾性会在每天翻篇后自己看，不用手动整理。</p>';
  }
  html += '</div></section>';
  return html;
}

function renderXingji(res) {
  var box = document.getElementById('xingji-body');
  if (!box) return;
  if (!res || !res.ok) {
    box.innerHTML = '<div class="moodline-card"><div class="xingji-empty-page"><p>没读到拾性档案，可能是连接还没缓过来。</p><button type="button" class="btn" onclick="loadXingji()">再试一次</button></div></div>';
    return;
  }
  xingjiState.thresholds = res.thresholds || xingjiState.thresholds;
  xingjiState.range = res.range || xingjiState.range;
  var agents = Array.isArray(res.agents) ? res.agents : [];
  var totals = res.totals || {};
  var totalPending = Number(totals.pending);
  var totalVisible = Number(totals.visible);
  if (!Number.isFinite(totalPending)) totalPending = agents.reduce(function (n, a) { return n + (Number(a.pending) || 0); }, 0);
  if (!Number.isFinite(totalVisible)) totalVisible = agents.reduce(function (n, a) { return n + ((a.entries || []).length); }, 0);
  var statAgents = document.getElementById('xingji-stat-agents');
  var statPending = document.getElementById('xingji-stat-pending');
  var statStanding = document.getElementById('xingji-stat-standing');
  if (statAgents) statAgents.textContent = String(agents.length);
  if (statPending) statPending.textContent = String(totalPending);
  if (statStanding) statStanding.textContent = String(totalVisible);

  if (!res.enabled) {
    box.innerHTML = '<div class="moodline-card xingji-disabled"><div class="xingji-empty-page"><h3>拾性还关着</h3><p>关着的时候不会继续观察，但已经记下的东西还在。打开后，ta 会在每天翻篇时慢慢接着看；默认只在本机记账，不会把内容接回对话。</p><button type="button" class="btn primary" onclick="openXingjiSettings()">去设置里打开</button></div></div>'
      + agents.map(function (agent, index) { return renderXingjiAgent(agent, index); }).join('');
    xingjiLoadAvatars();
    return;
  }
  if (!agents.length) {
    box.innerHTML = '<div class="moodline-card"><div class="xingji-empty-page"><h3>还没开始记</h3><p>等今天翻篇，拾性会从你和伙伴的往来里挑几个瞬间。第一天通常只有几段观察，不会马上成条；这里会慢慢长出东西来。</p><button type="button" class="btn primary" onclick="openXingjiBackfill()">补记以前的</button></div></div>';
    return;
  }
  box.innerHTML = agents.map(function (agent, index) { return renderXingjiAgent(agent, index); }).join('');
  xingjiLoadAvatars();
}

function xingjiJobStats(job) {
  var dates = Array.isArray(job.dates) ? job.dates : [];
  var done = Array.isArray(job.done) ? job.done : [];
  var failed = Array.isArray(job.failed) ? job.failed : [];
  return { dates: dates, done: done, failed: failed, total: dates.length, finished: done.length };
}

function xingjiJobSteps(phase) {
  var order = ['scan', 'model', 'rollup'];
  var labels = ['翻会话', '逐天看', '整理成条'];
  var index = order.indexOf(phase);
  if (index < 0) index = 0;
  return '<div class="xingji-job-steps">' + labels.map(function (label, i) {
    var cls = i < index ? ' is-done' : (i === index ? ' is-active' : '');
    return '<span class="xingji-job-step' + cls + '">' + label + '</span>';
  }).join('') + '</div>';
}

function renderXingjiJob() {
  var slot = document.getElementById('xingji-job-slot');
  if (!slot) return;
  var job = xingjiState.job;
  if (!job) { slot.innerHTML = ''; return; }
  var s = xingjiJobStats(job);
  var html = '';
  if (job.status === 'scanning' || job.status === 'queued') {
    var sp = job.scanProgress || {};
    var total = Number(sp.total) || 0;
    var index = Number(sp.index) || 0;
    var pct = total ? Math.min(100, Math.round(index / total * 100)) : 0;
    html += '<section class="xingji-job-card">';
    html += '<div class="xingji-job-head"><span class="xingji-job-title">正在补记以前的日子</span><span class="xingji-job-sub">' + esc(s.dates[0] || '') + ' → ' + esc(s.dates[s.dates.length - 1] || '') + '</span></div>';
    html += xingjiJobSteps('scan');
    html += '<div class="xingji-job-bar' + (total ? '' : ' is-indeterminate') + '"><i style="width:' + (total ? pct : 34) + '%"></i></div>';
    html += '<p class="xingji-job-line" role="status">' + (total ? ('已经翻到第 ' + index + '/' + total + ' 个会话，挑出 ' + (Number(sp.events) || 0) + ' 个瞬间') : '正在列出要翻的会话…') + '</p>';
    html += '<p class="xingji-job-hint">这一步只读本机会话，不调用模型，也不花钱。可以离开这一页，补记会在后台继续。</p>';
    html += '</section>';
  } else if (job.status === 'running') {
    var phase = job.phase === 'rollup' ? 'rollup' : 'model';
    var pct2 = s.total ? Math.min(100, Math.round(s.finished / s.total * 100)) : 0;
    html += '<section class="xingji-job-card">';
    html += '<div class="xingji-job-head"><span class="xingji-job-title">正在补记以前的日子</span><span class="xingji-job-sub">' + esc(s.dates[0] || '') + ' → ' + esc(s.dates[s.dates.length - 1] || '') + '</span></div>';
    html += xingjiJobSteps(phase);
    html += '<div class="xingji-job-bar"><i style="width:' + pct2 + '%"></i></div>';
    if (phase === 'rollup') {
      html += '<p class="xingji-job-line" role="status">' + s.total + ' 天都看完了，正在把观察整理成条目…</p>';
    } else {
      html += '<p class="xingji-job-line" role="status">已检查 ' + s.finished + '/' + s.total + ' 天' + (job.currentDate ? (' · 正在看 ' + esc(job.currentDate)) : '') + '</p>';
    }
    html += '<p class="xingji-job-hint">逐天观察会调用模型，有你们往来的日子才会问，每位伙伴一天最多一次。可以离开这一页，进度会留在上面。</p>';
    html += '</section>';
  } else if (job.status === 'interrupted') {
    var failedSet = {};
    s.failed.forEach(function (item) { if (item && item.date) failedSet[item.date] = true; });
    var remaining = s.dates.filter(function (date) { return s.done.indexOf(date) < 0 || failedSet[date]; });
    html += '<section class="xingji-job-card is-warn">';
    html += '<div class="xingji-job-head"><span class="xingji-job-title">上次补记断在第 ' + s.finished + ' 天</span><span class="xingji-job-sub">' + esc(job.currentDate || (job.interruptedAt ? xingjiTimeText(job.interruptedAt) : '')) + '</span></div>';
    var statusLine = remaining.length
      ? ('已经检查过 ' + s.finished + ' 天，还有 ' + remaining.length + ' 天要补。')
      : ('已经检查过 ' + s.finished + ' 天，只差把观察整理成条。');
    html += '<p class="xingji-job-line">' + statusLine + '可能是 App 重载或关掉了；已经补好的不会重来。</p>';
    html += '<div class="xingji-job-actions">';
    if (remaining.length) html += '<button type="button" class="btn primary" onclick="openXingjiBackfill({resume:true})">接着补 ' + remaining.length + ' 天</button>';
    html += '<button type="button" class="btn" onclick="openXingjiBackfill()">重新选范围</button></div>';
    html += '</section>';
  } else if (job.status === 'failed') {
    html += '<section class="xingji-job-card is-warn">';
    html += '<div class="xingji-job-head"><span class="xingji-job-title">补记断了</span><span class="xingji-job-sub">' + esc(job.error || '原因不明') + '</span></div>';
    html += '<p class="xingji-job-line">已经检查过 ' + s.finished + '/' + s.total + ' 天。可以重新补一次，已经补好的日子不会重复观察。</p>';
    html += '<div class="xingji-job-actions"><button type="button" class="btn primary" onclick="openXingjiBackfill({resume:true})">接着补</button><button type="button" class="btn" onclick="openXingjiBackfill()">重新选范围</button></div>';
    html += '</section>';
  } else if (job.status === 'completed') {
    var finishedAt = job.finishedAt ? new Date(job.finishedAt).getTime() : 0;
    if (finishedAt && Date.now() - finishedAt < 12 * 3600 * 1000) {
      html += '<div class="xingji-job-done"><span>上次补记完成</span><span class="xingji-job-sub">' + esc(xingjiTimeText(job.finishedAt)) + ' · 检查了 ' + s.finished + ' 天' + (s.failed.length ? ('，有 ' + s.failed.length + ' 处没补上') : '') + '</span></div>';
    }
  }
  slot.innerHTML = html;
}

function stopXingjiPoll() {
  if (xingjiState.pollTimer) { clearInterval(xingjiState.pollTimer); xingjiState.pollTimer = null; }
}

function pollXingjiJob() {
  if (xingjiState.pollTimer) return;
  xingjiState.pollTimer = setInterval(function () {
    api('/api/xingji/job').then(function (res) {
      var job = res && res.job ? res.job : null;
      var wasActive = xingjiJobActive();
      xingjiState.job = job;
      renderXingjiJob();
      if (!job || !xingjiJobActive()) {
        stopXingjiPoll();
        if (job && job.status === 'completed') {
          if (xingjiState.toastOnComplete) {
            xingjiState.toastOnComplete = false;
            toast('补记跑完了');
          }
          loadXingji();
        } else if (wasActive && job && (job.status === 'interrupted' || job.status === 'failed')) {
          toast('补记断在半路，可以接着补');
          loadXingji();
        }
      }
    }).catch(function () {});
  }, 3500);
}

function loadXingji() {
  var box = document.getElementById('xingji-body');
  if (!box) return;
  Promise.all([
    api('/api/xingji').catch(function () { return null; }),
    api('/api/xingji/job').catch(function () { return null; }),
  ]).then(function (rows) {
    var res = rows[0];
    var jobRes = rows[1];
    xingjiState.job = jobRes && jobRes.job ? jobRes.job : null;
    renderXingjiJob();
    if (res && res.ok) {
      xingjiState.data = res;
      renderXingji(res);
    } else {
      box.innerHTML = '<div class="moodline-card"><div class="xingji-empty-page"><p>没读到拾性档案，可能是连接还没缓过来。</p><button type="button" class="btn" onclick="loadXingji()">再试一次</button></div></div>';
    }
    if (xingjiJobActive()) pollXingjiJob();
  });
}

function rollupXingjiAgent(agentId, btn) {
  if (!agentId || xingjiState.busy[agentId]) return;
  xingjiState.busy[agentId] = true;
  var oldText = btn ? btn.textContent : '';
  if (btn) { btn.disabled = true; btn.textContent = '整理中…'; }
  var done = function () {
    xingjiState.busy[agentId] = false;
    if (btn) { btn.disabled = false; btn.textContent = oldText; }
  };
  api('/api/xingji/rollup', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ agentId: agentId }),
  }).then(function (res) {
    done();
    if (!res || !res.ok) { toast((res && res.error) || '没整理成，再试一次'); return; }
    var r = res.result || {};
    if (r.ok === false) { toast(r.error || '没整理成，再试一次'); return; }
    var consumed = Number(r.consumed) || 0;
    var remaining = Number(r.remaining);
    if (r.skipped) {
      if (r.reason === 'no-pending') toast('还没有要整理的观察');
      else if (r.reason === 'no-entry') toast('这次没归出新的条目，观察先留着');
      else toast('这次先没整理');
    } else if (!consumed) {
      toast('这次没归出新的条目，观察先留着');
    } else {
      var msg = '整理了 ' + consumed + ' 段观察';
      if (Number.isFinite(remaining)) msg += '，还剩 ' + remaining + ' 段没归类';
      toast(msg);
    }
    loadXingji();
  }).catch(function () {
    done();
    toast('没整理成，检查一下连接');
  });
}

function rejectXingjiEntry(agentId, entryId) {
  // 不用原生 confirm：App 页面里可能被拦掉，表现成点了没反应。拉黑可逆，直接执行。
  api('/api/xingji/entry', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ agentId: agentId, entryId: entryId, action: 'reject' }),
  }).then(function (res) {
    if (res && res.ok) {
      toast('记下了，这条不算了');
      loadXingji();
    } else {
      toast((res && res.error) || '没记上，再试一次');
    }
  }).catch(function () {
    toast('没记上，再试一次');
  });
}

function xingjiLatestDay() {
  return (xingjiState.range && xingjiState.range.latest) || todayMoodLineDate();
}

function xingjiEarliestDay() {
  var latest = xingjiLatestDay();
  var earliest = xingjiState.range && xingjiState.range.earliest;
  var floor = xingjiShiftDate(latest, -179);
  if (earliest && earliest > floor && earliest <= latest) return earliest;
  return floor;
}

function xingjiBackfillFromTo() {
  var latest = xingjiLatestDay();
  var mode = xingjiState.backfill.range;
  if (mode === 'all') {
    var allFrom = xingjiEarliestDay();
    return { from: allFrom <= latest ? allFrom : latest, to: latest };
  }
  var days = Number(mode) || 30;
  return { from: xingjiShiftDate(latest, -(days - 1)), to: latest };
}

function xingjiBackfillPreview() {
  var note = document.getElementById('xingji-range-note');
  var estimate = document.getElementById('xingji-cost-estimate');
  var seg = document.getElementById('xingji-range-seg');
  var label = document.getElementById('xingji-range-label');
  if (!note || !estimate) return;
  var b = xingjiState.backfill;
  var agentCount = Math.max(1, ((xingjiState.data && xingjiState.data.agents) || []).length);
  if (b.dates && b.dates.length) {
    if (seg) seg.classList.add('hidden');
    if (label) label.textContent = '接着上次补';
    note.textContent = '要补的 ' + b.dates.length + ' 天：' + xingjiDateText(b.dates[0]) + ' 到 ' + xingjiDateText(b.dates[b.dates.length - 1]) + '。已经补好的日子不会重来。';
    estimate.textContent = '最多约 ' + (b.dates.length * agentCount) + ' 次观察调用；没有往来的日子会跳过。';
    return;
  }
  if (seg) seg.classList.remove('hidden');
  if (label) label.textContent = '补哪一段';
  var range = xingjiBackfillFromTo();
  var days = xingjiDaysBetween(range.from, range.to);
  note.textContent = '从 ' + xingjiDateText(range.from) + ' 到 ' + xingjiDateText(range.to) + '，共 ' + days + ' 天。';
  estimate.textContent = '最多约 ' + (days * agentCount) + ' 次观察调用（' + agentCount + ' 位伙伴）；没有往来的日子会跳过。';
}

function setXingjiRange(mode) {
  xingjiState.backfill.range = mode;
  xingjiState.backfill.dates = null;
  xingjiState.backfill.resume = false;
  var seg = document.getElementById('xingji-range-seg');
  if (seg) {
    var btns = seg.querySelectorAll('button');
    for (var i = 0; i < btns.length; i++) btns[i].classList.toggle('active', btns[i].getAttribute('data-range') === mode);
  }
  xingjiBackfillPreview();
}

function openXingjiBackfill(opts) {
  if (xingjiJobActive()) {
    toast('正在补记，进度就在页面上方');
    var slot = document.getElementById('xingji-job-slot');
    if (slot) slot.scrollIntoView({ block: 'center', behavior: 'smooth' });
    return;
  }
  if (!xingjiState.data) {
    toast('正在读拾性档案，等一下再点');
    loadXingji();
    return;
  }
  if (xingjiState.data.enabled !== true) {
    toast('拾性还关着，先去设置里打开');
    openXingjiSettings();
    return;
  }
  var options = opts || {};
  var job = xingjiState.job;
  var dates = null;
  if (options.resume && job && Array.isArray(job.dates) && Array.isArray(job.done)) {
    var doneSet = {};
    job.done.forEach(function (d) { doneSet[d] = true; });
    var failedSet = {};
    (Array.isArray(job.failed) ? job.failed : []).forEach(function (item) {
      if (item && item.date) failedSet[item.date] = true;
    });
    dates = job.dates.filter(function (d) { return !doneSet[d] || failedSet[d]; });
  }
  xingjiState.backfill.dates = dates && dates.length ? dates : null;
  xingjiState.backfill.resume = !!(dates && dates.length);
  xingjiState.backfill.range = '30';
  var seg = document.getElementById('xingji-range-seg');
  if (seg) {
    var btns = seg.querySelectorAll('button');
    for (var i = 0; i < btns.length; i++) btns[i].classList.toggle('active', btns[i].getAttribute('data-range') === '30');
  }
  var err = document.getElementById('xingji-backfill-error');
  if (err) err.textContent = '';
  xingjiBackfillPreview();
  var modal = document.getElementById('xingji-backfill-modal');
  if (modal) modal.hidden = false;
}

function closeXingjiBackfill() {
  var modal = document.getElementById('xingji-backfill-modal');
  if (modal) modal.hidden = true;
}

function startXingjiBackfill() {
  var btn = document.getElementById('xingji-backfill-start');
  var err = document.getElementById('xingji-backfill-error');
  if (err) err.textContent = '';
  var body = {};
  if (xingjiState.backfill.dates && xingjiState.backfill.dates.length) {
    body.dates = xingjiState.backfill.dates.slice();
  } else {
    var range = xingjiBackfillFromTo();
    body.from = range.from;
    body.to = range.to;
  }
  if (btn) { btn.disabled = true; btn.textContent = '正在提交…'; }
  api('/api/xingji/backfill', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }).then(function (res) {
    if (btn) { btn.disabled = false; btn.textContent = '开始补记'; }
    if (!res || !res.ok) {
      if (err) err.textContent = (res && res.error) || '没启动起来，再试一次';
      return;
    }
    xingjiState.job = res.job || xingjiState.job;
    xingjiState.toastOnComplete = true;
    closeXingjiBackfill();
    renderXingjiJob();
    if (xingjiState.data) renderXingji(xingjiState.data);
    toast('开始补记了，进度会显示在页面上方');
    pollXingjiJob();
  }).catch(function () {
    if (btn) { btn.disabled = false; btn.textContent = '开始补记'; }
    if (err) err.textContent = '没启动起来，检查一下连接';
  });
}

function openXingjiSettings() {
  openSettingsModal();
  setTimeout(function () {
    var row = document.getElementById('xingji-row');
    if (row) row.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }, 160);
}

// ── 心情线 ──
var MOOD_LINE_SEGMENT_X = { dawn: 0.08, morning: 0.22, noon: 0.36, afternoon: 0.50, dusk: 0.64, evening: 0.78, night: 0.92 };

function todayMoodLineDate() {
  var now = new Date();
  return dk(now.getFullYear(), now.getMonth() + 1, now.getDate());
}

function moodLineDateShift(date, delta) {
  var dt = new Date(String(date || '') + 'T00:00:00');
  if (Number.isNaN(dt.getTime())) dt = new Date();
  dt.setDate(dt.getDate() + Number(delta || 0));
  return dk(dt.getFullYear(), dt.getMonth() + 1, dt.getDate());
}

function moodLineDateText(date) {
  var dt = new Date(String(date || '') + 'T00:00:00');
  if (Number.isNaN(dt.getTime())) return String(date || '');
  return dt.getMonth() + 1 + ' 月 ' + dt.getDate() + ' 日 · 星期' + WEEK[dt.getDay()];
}

function moodLineRangeDates(endDate, count) {
  var rows = [];
  for (var i = Number(count || 7) - 1; i >= 0; i--) rows.push(moodLineDateShift(endDate, -i));
  return rows;
}

// 连续视图只看「到今天为止」这一段：未来的日子还没有记录，不该被铺进轴里。
function moodLineRangeEndDate() {
  var today = todayMoodLineDate();
  var end = moodLineRangeEnd ? String(moodLineRangeEnd) : today;
  return end > today ? today : end;
}

function moodLineSegmentRank(segment) {
  for (var i = 0; i < MOOD_LINE_SEGMENTS.length; i++) {
    if (MOOD_LINE_SEGMENTS[i].id === segment) return Number(MOOD_LINE_SEGMENTS[i].rank || 0);
  }
  return 1;
}

function moodLineSegmentLabel(segment) {
  for (var i = 0; i < MOOD_LINE_SEGMENTS.length; i++) {
    if (MOOD_LINE_SEGMENTS[i].id === segment) return MOOD_LINE_SEGMENTS[i].label || '';
  }
  return '';
}

function moodLineSort(entries) {
  function exactTime(entry) {
    var value = moodLineExactTimestamp(entry);
    return value ? new Date(value).getTime() : NaN;
  }
  return (Array.isArray(entries) ? entries : [])
    .filter(function (entry) { return entry && typeof entry === 'object'; })
    .map(function (entry, index) { return { entry: entry, index: index }; })
    .sort(function (a, b) {
      var segmentDelta = moodLineSegmentRank(moodLineSegmentForEntry(a.entry)) - moodLineSegmentRank(moodLineSegmentForEntry(b.entry));
      if (segmentDelta) return segmentDelta;
      var at = exactTime(a.entry);
      var bt = exactTime(b.entry);
      if (Number.isFinite(at) && Number.isFinite(bt) && at !== bt) return at - bt;
      if (Number.isFinite(at) !== Number.isFinite(bt)) return Number.isFinite(at) ? -1 : 1;
      var timeDelta = String(a.entry.recordedAt || '').localeCompare(String(b.entry.recordedAt || ''));
      return timeDelta || a.index - b.index;
    })
    .map(function (item) { return item.entry; });
}

function moodLinePrimary(entries) {
  var list = Array.isArray(entries) ? entries : [];
  return list.find(function (entry) { return entry.source === 'manual'; }) || list[list.length - 1] || null;
}

function moodLineMetaFor(entry) {
  return (entry && MOOD_LINE_META && MOOD_LINE_META[entry.mood]) || { band: 'steady', bandLabel: '安安稳稳', level: 6 };
}

function moodLineY(level) {
  var n = Number(level);
  if (!Number.isFinite(n)) n = 4;
  n = moodLineClamp(n, 0, 8);
  return 192 - n * (134 / 8);
}

function moodLineBuildGroups(entries) {
  var sorted = moodLineSort(entries);
  var groups = [];
  MOOD_LINE_SEGMENTS.forEach(function (segment) {
    var list = sorted.filter(function (entry) { return moodLineSegmentForEntry(entry) === segment.id; });
    if (!list.length) return;
    var exact = list.filter(moodLineHasExactTime);
    var broad = list.filter(function (entry) { return !moodLineHasExactTime(entry); });
    exact.forEach(function (entry, index) {
      groups.push({
        id: segment.id + ':' + (entry.id || entry.recordedAt || index),
        segmentId: segment.id,
        label: segment.label,
        rank: segment.rank,
        exactTime: true,
        entries: [entry],
        primary: entry,
      });
    });
    if (broad.length) groups.push({ id: segment.id, segmentId: segment.id, label: segment.label, rank: segment.rank, entries: broad, primary: moodLinePrimary(broad) });
  });
  groups.sort(function (a, b) {
    var aMinute = a.exactTime ? moodLineLifeMinute(a.primary) : moodLineSegmentCenterMinute(a.segmentId);
    var bMinute = b.exactTime ? moodLineLifeMinute(b.primary) : moodLineSegmentCenterMinute(b.segmentId);
    return aMinute - bMinute;
  });
  return { entries: sorted, groups: groups, primary: moodLinePrimary(sorted) };
}

var MOOD_LINE_SEGMENT_SLOT_SPAN = 0.12;
function moodLinePointX(entry, segmentId, left, width) {
  var center = MOOD_LINE_SEGMENT_X[segmentId] || 0.5;
  var exact = moodLineLifeMinute(entry);
  if (exact === null) return left + width * center;
  var segment = MOOD_LINE_SEGMENTS.find(function (item) { return item.id === segmentId; });
  if (!segment) return left + width * center;
  var start = ((segment.startHour - 4 + 24) % 24) * 60;
  var end = segment.endHour === 24 ? 24 * 60 : ((segment.endHour - 4 + 24) % 24) * 60;
  if (end <= start) end += 24 * 60;
  var ratio = moodLineClamp((exact - start) / Math.max(1, end - start), 0, 1);
  return left + width * (center + (ratio - 0.5) * MOOD_LINE_SEGMENT_SLOT_SPAN);
}

function showMoodLineTooltip(point) {
  var tip = document.getElementById('moodline-hover-tip');
  var plot = point && point.closest ? point.closest('.moodline-plot') : null;
  var dot = point && point.querySelector ? point.querySelector('.moodline-dot') : null;
  if (!tip || !plot || !dot) return;
  tip.textContent = point.getAttribute('data-tooltip') || '';
  tip.classList.add('visible');
  var plotRect = plot.getBoundingClientRect();
  var dotRect = dot.getBoundingClientRect();
  var tipRect = tip.getBoundingClientRect();
  var left = dotRect.left - plotRect.left + dotRect.width / 2;
  var half = tipRect.width / 2;
  left = moodLineClamp(left, half + 6, Math.max(half + 6, plotRect.width - half - 6));
  var above = dotRect.top - plotRect.top - 7;
  if (above - tipRect.height < 5) {
    tip.style.top = (dotRect.bottom - plotRect.top + 7) + 'px';
    tip.style.transform = 'translate(-50%, 0)';
  } else {
    tip.style.top = above + 'px';
    tip.style.transform = 'translate(-50%, -100%)';
  }
  tip.style.left = left + 'px';
}

function hideMoodLineTooltip() {
  var tip = document.getElementById('moodline-hover-tip');
  if (!tip) return;
  tip.classList.remove('visible');
  tip.style.transform = 'translate(-50%, -100%)';
}

function moodLinePoint(entry, x, date, sequence, rank) {
  var meta = moodLineMetaFor(entry);
  return {
    x: x, y: moodLineY(meta.level), date: date, sequence: sequence, rank: rank,
    entry: entry, band: meta.band, bandLabel: meta.bandLabel,
  };
}

function moodLineClamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

// 两个锚点也保留一点轻微弧度，避免数据少时退化成普通直线图。
function moodLinePairPath(a, b) {
  var dx = b.x - a.x;
  var dy = b.y - a.y;
  var length = Math.sqrt(dx * dx + dy * dy) || 1;
  var offset = Math.min(17, Math.max(7, length * 0.035));
  var sign = (Math.abs(Number(a.rank || 0)) + Math.abs(Number(b.rank || 0)) + Math.abs(Number(a.sequence || 0))) % 2 === 0 ? -1 : 1;
  var nx = -dy / length * offset * sign;
  var ny = dx / length * offset * sign;
  var cp1x = a.x + dx * 0.30 + nx;
  var cp1y = moodLineClamp(a.y + dy * 0.30 + ny, 42, 208);
  var cp2x = a.x + dx * 0.70 + nx;
  var cp2y = moodLineClamp(a.y + dy * 0.70 + ny, 42, 208);
  return 'M ' + a.x + ' ' + a.y + ' C ' + cp1x + ' ' + cp1y + ', ' + cp2x + ' ' + cp2y + ', ' + b.x + ' ' + b.y;
}

function moodLineSmoothPath(points) {
  if (!points || !points.length) return '';
  if (points.length === 1) return 'M ' + points[0].x + ' ' + points[0].y;
  if (points.length === 2) return moodLinePairPath(points[0], points[1]);
  var d = 'M ' + points[0].x + ' ' + points[0].y;
  for (var i = 1; i < points.length; i++) {
    var p0 = points[i - 2] || points[i - 1];
    var p1 = points[i - 1];
    var p2 = points[i];
    var p3 = points[i + 1] || p2;
    var tangent1x = (p2.x - p0.x) / 6;
    var tangent1y = (p2.y - p0.y) / 6;
    var tangent2x = (p3.x - p1.x) / 6;
    var tangent2y = (p3.y - p1.y) / 6;
    var beforeDelta = p1.y - p0.y;
    var afterDelta = p2.y - p1.y;
    var nextDelta = p3.y - p2.y;
    // 最高点/最低点的切线放平，转折会像一小段抛物线一样圆润。
    if (i > 1 && ((beforeDelta > 0 && afterDelta < 0) || (beforeDelta < 0 && afterDelta > 0))) tangent1y = 0;
    if (i < points.length - 1 && ((afterDelta > 0 && nextDelta < 0) || (afterDelta < 0 && nextDelta > 0))) tangent2y = 0;
    var cp1x = p1.x + tangent1x;
    var cp1y = moodLineClamp(p1.y + tangent1y, 42, 208);
    var cp2x = p2.x - tangent2x;
    var cp2y = moodLineClamp(p2.y - tangent2y, 42, 208);
    d += ' C ' + cp1x + ' ' + cp1y + ', ' + cp2x + ' ' + cp2y + ', ' + p2.x + ' ' + p2.y;
  }
  return d;
}

// 伙伴线色板：刻意避开主线用到的薄荷绿(#7fb8a0)、浅绿(#b9d6c8)、暖橙(#dd9f6f)、粉(#e89bb0)，
// 免得伙伴线跟自己的心情线糊成一片。七个色相位分散开，同屏最多七位伙伴不重色。
var PARTNER_MOOD_COLORS = ['#5b84c4', '#9b7abf', '#c2665f', '#c2953f', '#4f9aa8', '#c2739e', '#3f5f8f'];

/** 伙伴 id 的稳定散列：只用来定颜色，不参与任何持久化。 */
function partnerMoodHash(agentId) {
  var id = String(agentId || '');
  var hash = 0;
  for (var i = 0; i < id.length; i++) hash = (hash * 31 + id.charCodeAt(i)) % 1000003;
  return hash;
}

// 页面级的颜色分配表：伙伴线颜色一旦定下就不再变。
// 以前是每次渲染重新算（集合一变就可能整体挪位），同一人在「一天」和「连续」里可能两个颜色。
var moodLinePartnerColorMap = {};

/** 给一位伙伴定颜色：先到先挑自己的哈希位，被占了就往后找空位；定下后永不再改。 */
function moodLinePartnerColorAssign(agentId) {
  var id = String(agentId || '');
  if (!id) return '';
  if (moodLinePartnerColorMap[id]) return moodLinePartnerColorMap[id];
  var used = {};
  Object.keys(moodLinePartnerColorMap).forEach(function (key) {
    used[moodLinePartnerColorMap[key]] = true;
  });
  var slot = partnerMoodHash(id) % PARTNER_MOOD_COLORS.length;
  // 撞位就往后找空位；最多绕色板一圈，人比色板多时接受重色，不能转不出来。
  for (var guard = 0; used[PARTNER_MOOD_COLORS[slot]] && guard < PARTNER_MOOD_COLORS.length; guard++) {
    slot = (slot + 1) % PARTNER_MOOD_COLORS.length;
  }
  moodLinePartnerColorMap[id] = PARTNER_MOOD_COLORS[slot];
  return moodLinePartnerColorMap[id];
}

/** 给一组伙伴取颜色：没定过的先定下，已经定过的原样拿回。 */
function moodLinePartnerColors(agentIds) {
  var ids = (Array.isArray(agentIds) ? agentIds : [])
    .map(function (id) { return String(id || ''); })
    .filter(Boolean);
  var colors = {};
  ids.forEach(function (id) { colors[id] = moodLinePartnerColorAssign(id); });
  return colors;
}

function moodLineLegendHtml(series) {
  var html = '<div class="moodline-legend">' +
    '<span class="moodline-legend-item"><i class="moodline-legend-mark"></i>你记的</span>' +
    '<span class="moodline-legend-item"><i class="moodline-legend-mark auto"></i>小花发现的候选（浅一号）</span>';
  (series || []).forEach(function (s) {
    if (!s || !s.points || !s.points.length) return;
    var id = String(s.agentId || '');
    var name = s.name || '伙伴';
    var mark = '<i class="moodline-legend-mark partner" style="border:1.6px solid;border-color:' + esc(s.color || '') + '"></i>';
    if (!id) {
      html += '<span class="moodline-legend-item">' + mark + esc(name) + '的际遇</span>';
      return;
    }
    var hidden = moodLineSeriesHidden(s);
    html += '<button type="button" class="moodline-legend-item moodline-legend-toggle' + (hidden ? ' off' : '') + '"' +
      ' aria-pressed="' + (hidden ? 'false' : 'true') + '"' +
      ' title="' + esc(hidden ? '点一下重新显示' + name + '的际遇线' : '点一下收起' + name + '的际遇线') + '"' +
      ' onclick="toggleMoodLineSeries(&quot;' + esc(id) + '&quot;)">' +
      mark + esc(name) + '的际遇</button>';
  });
  html += '<span class="moodline-legend-note">空白处不补点</span>';
  return html + '</div>';
}

/** 这位伙伴的际遇线是不是被用户收起了。 */
function moodLineSeriesHidden(series) {
  var id = series && series.agentId ? String(series.agentId) : '';
  return !!(id && moodLineHiddenAgents[id]);
}

/** 图例上还亮着的伙伴线（曲线、圆点、下面的际遇条目都用它）。 */
function moodLineVisibleSeries(series) {
  return (series || []).filter(function (s) {
    return s && s.agentId && s.points && s.points.length && !moodLineSeriesHidden(s);
  });
}

/** 点图例：收起或展开一位伙伴的际遇线，然后按上次的入参原地重绘。 */
function toggleMoodLineSeries(agentId) {
  var id = String(agentId || '');
  if (!id) return;
  if (moodLineHiddenAgents[id]) delete moodLineHiddenAgents[id];
  else moodLineHiddenAgents[id] = true;
  var last = moodLineLastRender;
  if (!last) return;
  if (last.kind === 'day') renderMoodLineDay(last.date, last.moods, last.partners);
  else if (last.kind === 'range') renderMoodLineRange(last.dates, last.dayMap, last.partnerSeries);
}

function moodLineEntryTitle(entry) {
  var auto = entry && entry.source === 'auto';
  var source = auto ? '小花发现的候选' : '你记的';
  var certainty = auto ? ({ clear: '证据较直接', possible: '可能', uncertain: '存疑' }[entry.certainty] || '存疑') : '';
  var evidenceType = auto ? ({ explicit: '原话', context: '上下文' }[entry.evidenceType] || '依据待确认') : '';
  var detail = String((entry && (entry.reason || entry.note)) || '').trim();
  var evidence = auto ? String((entry && entry.evidence) || '').trim() : '';
  var parts = [source, moodLineEntryTimeLabel(entry)];
  if (certainty) parts.push(certainty);
  if (evidenceType) parts.push(evidenceType);
  if (detail && (!auto || !evidence)) parts.push(detail);
  if (evidence) parts.push('依据：“' + evidence + '”');
  return parts.filter(Boolean).join(' · ');
}

function renderMoodLineEntries(entries, date, sourceLabel) {
  var list = moodLineSort(entries);
  if (!list.length) return '';
  return '<div class="moodline-entries">' + list.map(function (entry) {
    var auto = entry.source === 'auto' ? ' auto' : '';
    var title = esc(sourceLabel ? partnerMoodLineEntryTitle(entry, sourceLabel) : moodLineEntryTitle(entry));
    var sourceText = entry.source === 'auto' ? (sourceLabel ? '际遇' : '候选') : '';
    return '<button type="button" class="moodline-entry' + auto + '" title="' + title + '" onclick="openMoodLine(&quot;' + esc(date) + '&quot;)">' +
      '<span>' + esc(entry.emoji || '') + '</span><span>' + esc(entry.label || '') + '</span>' +
      (sourceText ? '<span class="entry-source">' + esc(sourceText) + '</span>' : '') +
      '<span class="entry-seg">' + esc(moodLineEntryTimeLabel(entry)) + '</span></button>';
  }).join('') + '</div>';
}

/** 伙伴条目的提示：谁是主角 + 时段 + 确定度 + 际遇短注 + 原话依据。 */
function partnerMoodLineEntryTitle(entry, ownerLabel) {
  var certainty = ({ clear: '证据较直接', possible: '可能', uncertain: '存疑' })[entry && entry.certainty] || '存疑';
  var evidenceType = ({ explicit: '原话', context: '上下文' })[entry && entry.evidenceType] || '依据待确认';
  var detail = String((entry && (entry.reason || entry.note)) || '').trim();
  var evidence = String((entry && entry.evidence) || '').trim();
  var parts = [String(ownerLabel || '伙伴') + '的际遇', moodLineEntryTimeLabel(entry), certainty, evidenceType];
  if (detail && !evidence) parts.push(detail);
  if (evidence) parts.push('依据：“' + evidence + '”');
  return parts.filter(Boolean).join(' · ');
}

function renderMoodLineSvg(points, rows, mode, title, extras) {
  var out = '<svg class="moodline-svg" viewBox="0 0 760 250" role="img" aria-label="' + esc(title) + '">' +
    '<defs>' +
    '<linearGradient id="moodline-grad" x1="0" y1="0" x2="0" y2="1">' +
    '<stop offset="0" stop-color="#8fbfa8"></stop>' +
    '<stop offset=".48" stop-color="#cfb48e"></stop>' +
    '<stop offset="1" stop-color="#eba8bc"></stop>' +
    '</linearGradient>' +
    '<linearGradient id="moodline-wash" x1="0" y1="0" x2="0" y2="1">' +
    '<stop offset="0" stop-color="#a9cdb9" stop-opacity=".07"></stop>' +
    '<stop offset=".55" stop-color="#eeddb6" stop-opacity=".04"></stop>' +
    '<stop offset="1" stop-color="#f6d6de" stop-opacity=".08"></stop>' +
    '</linearGradient>' +
    '</defs>';
  [
    { level: 8, label: '幸福满满' },
    { level: 7, label: '挺高兴' },
    { level: 6, label: '安安稳稳' },
    { level: 5, label: '乏了' },
    { level: 4, label: '心里悬' },
    { level: 3, label: '有点烦' },
    { level: 2, label: '委屈巴巴' },
    { level: 1, label: '想哭' },
    { level: 0, label: '很低落' },
  ].forEach(function (axis, index) {
    var y = moodLineY(axis.level);
    var guideClass = index === 0 || index === 4 || index === 8 ? '' : ' minor';
    out += '<line class="moodline-guide' + guideClass + '" x1="54" x2="738" y1="' + y + '" y2="' + y + '"></line>';
    out += '<text class="moodline-axis" x="5" y="' + (y + 4) + '">' + axis.label + '</text>';
  });

  if (points.length >= 2) {
    // 时段或日期没有记录时仍保持一条连续曲线，但不虚构新的心情点。
    var curveD = moodLineSmoothPath(points);
    var head = points[0], tail = points[points.length - 1];
    // 极淡的水色晕垫在曲线下，只做一点纸面晕染的氛围，不形成实心块。
    out += '<path class="moodline-wash" d="' + curveD + ' L ' + tail.x + ' 200 L ' + head.x + ' 200 Z"></path>';
    out += '<path class="moodline-path" d="' + curveD + '"></path>';
  }

  // 伙伴曲线：叠在主线上方，不画晕染，只留一条细线。
  (extras || []).forEach(function (series) {
    var sp = (series && series.points) || [];
    if (sp.length < 2) return;
    out += '<path class="moodline-path partner" d="' + moodLineSmoothPath(sp) + '" style="stroke:' + esc(series.color || '') + '"></path>';
  });

  points.forEach(function (point) {
    var entry = point.entry || {};
    var pointTitle = (point.date || '') + ' · ' + (entry.label || '') + ' · ' + moodLineEntryTitle(entry);
    var cls = 'moodline-point ' + (point.band || 'steady') + (entry.source === 'auto' ? ' auto' : '');
    var label = mode === 'day'
      ? '<text class="moodline-point-label" x="' + point.x + '" y="' + (point.y <= 90 ? point.y + 28 : point.y - 17) + '">' + esc(entry.label || '') + '</text>'
      : '';
    var count = point.count > 1 ? '<text class="moodline-count" x="' + (point.x + 13) + '" y="' + (point.y - 8) + '">+' + (point.count - 1) + '</text>' : '';
    var dateArg = esc(point.date || '');
    out += '<g class="' + cls + '" tabindex="0" role="button" onclick="openMoodLine(&quot;' + dateArg + '&quot;)" onkeydown="if(event.key===&quot;Enter&quot;||event.key===&quot; &quot;){openMoodLine(&quot;' + dateArg + '&quot;)}" onmouseenter="showMoodLineTooltip(this)" onmouseleave="hideMoodLineTooltip()" onfocus="showMoodLineTooltip(this)" onblur="hideMoodLineTooltip()" data-tooltip="' + esc(pointTitle) + '" aria-label="' + esc(pointTitle) + '">' +
      '<circle class="moodline-dot" cx="' + point.x + '" cy="' + point.y + '" r="' + (entry.source === 'auto' ? 6.6 : 8) + '"></circle>' + label + count + '</g>';
  });

  out += moodLinePartnerPointsHtml(extras);
  out += moodLinePartnerLabelsHtml(extras);

  (rows || []).forEach(function (row, index) {
    var step = mode === 'day' ? 1 : (rows.length <= 7 ? 1 : (rows.length <= 14 ? 2 : 5));
    if (index % step !== 0 && index !== rows.length - 1) return;
    var text = mode === 'day' ? row.label : String(row.date || '').slice(5).replace('-', '/');
    out += '<text class="moodline-x-label" x="' + row.x + '" y="232" text-anchor="middle">' + esc(text) + '</text>';
  });
  return out + '</svg>';
}

/** 伙伴线末端的名字标签：像线路图的终点站，不用点开关也能一眼认出谁是谁。
 *  只给还亮着的伙伴画，位置跟这条线最后一个有记录的点走。 */
function moodLinePartnerLabelsHtml(extras) {
  var labels = [];
  (extras || []).forEach(function (series) {
    var sp = (series && series.points) || [];
    if (!sp.length) return;
    var last = sp[sp.length - 1];
    labels.push({ x: last.x, y: last.y, name: series.name || '', color: series.color || '' });
  });
  if (!labels.length) return '';
  // 避让：横向挨近的标签在竖向上找最近的空位，不叠在一起，也不飘离自己的线。
  labels.sort(function (a, b) { return a.x - b.x || a.y - b.y; });
  var OFFSETS = [0, -13, 13, -26, 26, -39, 39, -52, 52, -65, 65, -78, 78, -91, 91];
  var placed = [];
  labels.forEach(function (label) {
    var labelY = moodLineClamp(label.y, 34, 214);
    for (var i = 0; i < OFFSETS.length; i++) {
      labelY = moodLineClamp(label.y + OFFSETS[i], 34, 214);
      var hit = placed.some(function (p) {
        return Math.abs(p.x - label.x) < 40 && Math.abs(p.y - labelY) < 13;
      });
      if (!hit) break;
    }
    label.labelY = labelY;
    placed.push({ x: label.x, y: label.labelY });
  });
  return labels.map(function (label) {
    // 贴到右边缘的点把名字放左边，不然会出画。
    var onLeft = label.x > 648;
    var x = onLeft ? label.x - 9 : label.x + 9;
    return '<text class="moodline-partner-label" x="' + x + '" y="' + (label.labelY + 4) + '"' +
      (onLeft ? ' text-anchor="end"' : '') +
      ' fill="' + esc(label.color) + '">' + esc(label.name) + '</text>';
  }).join('');
}

/** 伙伴点渲染：空心圆环，描边用各自专属色；悬停可看那天它经历了什么。 */
function moodLinePartnerPointsHtml(extras) {
  var out = '';
  (extras || []).forEach(function (series) {
    var sp = (series && series.points) || [];
    if (!sp.length) return;
    var color = series.color || '';
    var name = series.name || '';
    sp.forEach(function (point) {
      var entry = point.entry || {};
      var pointTitle = esc(partnerMoodPointTitle(name, point.date, entry));
      var dateArg = esc(point.date || '');
      out += '<g class="moodline-point partner" tabindex="0" role="button" onclick="openMoodLine(&quot;' + dateArg + '&quot;)" onkeydown="if(event.key===&quot;Enter&quot;||event.key===&quot; &quot;){openMoodLine(&quot;' + dateArg + '&quot;)}" onmouseenter="showMoodLineTooltip(this)" onmouseleave="hideMoodLineTooltip()" onfocus="showMoodLineTooltip(this)" onblur="hideMoodLineTooltip()" data-tooltip="' + pointTitle + '" aria-label="' + pointTitle + '" style="color:' + esc(color) + '">' +
        '<circle class="moodline-dot" cx="' + point.x + '" cy="' + point.y + '" r="5.6" style="stroke:' + esc(color) + '"></circle></g>';
    });
  });
  return out;
}

/** 伙伴点提示：名字 + 时段 + 确定度/证据类型 + 际遇短注 + 原话依据。 */
function partnerMoodPointTitle(name, date, entry) {
  var certainty = ({ clear: '证据较直接', possible: '可能', uncertain: '存疑' })[entry && entry.certainty] || '存疑';
  var evidenceType = ({ explicit: '原话', context: '上下文' })[entry && entry.evidenceType] || '依据待确认';
  var detail = String((entry && (entry.reason || entry.note)) || '').trim();
  var evidence = String((entry && entry.evidence) || '').trim();
  var parts = [String(name || '伙伴') + '的际遇', moodLineEntryTimeLabel(entry), certainty, evidenceType];
  if (detail && !evidence) parts.push(detail);
  if (evidence) parts.push('依据：“' + evidence + '”');
  return parts.filter(Boolean).join(' · ');
}

function moodLineBuildDayPoints(moods, date, left, width) {
  var model = moodLineBuildGroups(moods);
  if (!model.entries.length) return { points: [], model: model };
  var points = model.groups.map(function (group) {
    var segmentId = group.segmentId || group.id;
    var p = moodLinePoint(group.primary, moodLinePointX(group.primary, segmentId, left, width), date, group.rank, group.rank);
    p.count = group.entries.length;
    return p;
  });
  return { points: points, model: model };
}

function renderMoodLineDay(date, moods, partners) {
  var card = document.getElementById('moodline-card');
  if (!card) return;
  var left = 54, width = 684;
  moodLineLastRender = { kind: 'day', date: date, moods: moods, partners: partners };
  var owner = moodLineBuildDayPoints(moods, date, left, width);
  var rawSeries = (Array.isArray(partners) ? partners : []).map(function (partner) {
    var entries = moodLineSort(partner.entries || []);
    return {
      agentId: String(partner.agentId || ''),
      name: partner.agentName,
      entries: entries,
      points: moodLineBuildDayPoints(entries, date, left, width).points,
    };
  });
  var dayColors = moodLinePartnerColors(rawSeries.map(function (s) { return s.agentId; }));
  var series = rawSeries.map(function (s) {
    s.color = dayColors[s.agentId] || PARTNER_MOOD_COLORS[0];
    return s;
  });
  var hasAny = owner.model.entries.length || series.some(function (s) { return s.points.length; });
  if (!hasAny) {
    card.innerHTML = '<div class="moodline-card-head"><span class="moodline-card-title">' + esc(moodLineDateText(date)) + '</span></div>' +
      '<div class="moodline-empty">这天还没留下心情。<br><b>想起时，回到日历记一笔就好。</b></div>';
    return;
  }
  var rows = MOOD_LINE_SEGMENTS.map(function (segment) {
    return { id: segment.id, label: segment.label };
  });
  rows = rows.map(function (row) {
    return { x: left + width * (MOOD_LINE_SEGMENT_X[row.id] || 0.5), label: row.label, date: date };
  });
  var captionParts = [owner.model.entries.length + ' 笔心情'];
  series.forEach(function (s) {
    if (s.points.length) captionParts.push(s.name + ' ' + s.points.length + ' 笔际遇');
  });
  captionParts.push('高低只负责形成画面节奏');
  var caption = captionParts.join(' · ');
  var legendSeries = series.filter(function (s) { return s.points.length; });
  var shownSeries = moodLineVisibleSeries(legendSeries);
  card.innerHTML = '<div class="moodline-card-head"><span class="moodline-card-title">' + esc(moodLineDateText(date)) + '</span><span class="moodline-card-caption">' + esc(caption) + '</span></div>' +
    '<div class="moodline-plot"><div class="moodline-hover-tip" id="moodline-hover-tip" role="tooltip"></div>' + renderMoodLineSvg(owner.points, rows, 'day', moodLineDateText(date), shownSeries) + '</div>' +
    '<div class="moodline-below">' + moodLineLegendHtml(legendSeries) + '<span class="moodline-note">点心情点可以回到这一天；点名字可以收起某位伙伴</span></div>' +
    renderMoodLineEntries(owner.model.entries, date) +
    shownSeries.map(function (s) { return renderMoodLineEntries(s.entries, date, s.name); }).join('');
}

function renderMoodLineRange(dates, dayMap, partnerSeries) {
  var card = document.getElementById('moodline-card');
  if (!card) return;
  moodLineLastRender = { kind: 'range', dates: dates, dayMap: dayMap, partnerSeries: partnerSeries };
  var left = 54, width = 684;
  var rows = (Array.isArray(dates) ? dates : []).map(function (date, index, all) {
    var entries = moodLineSort(dayMap && Array.isArray(dayMap[date]) ? dayMap[date] : []);
    var primary = moodLinePrimary(entries);
    var x = all.length <= 1 ? left + width / 2 : left + width * index / (all.length - 1);
    return { date: date, entries: entries, primary: primary, x: x };
  });
  var marked = rows.filter(function (row) { return !!row.primary; });
  var rawSeries = (Array.isArray(partnerSeries) ? partnerSeries : []).map(function (partner) {
    var srows = (Array.isArray(dates) ? dates : []).map(function (date, index, all) {
      var entries = moodLineSort((partner.dayMap && Array.isArray(partner.dayMap[date])) ? partner.dayMap[date] : []);
      var primary = moodLinePrimary(entries);
      var x = all.length <= 1 ? left + width / 2 : left + width * index / (all.length - 1);
      return { date: date, entries: entries, primary: primary, x: x };
    });
    var sMarked = srows.filter(function (row) { return !!row.primary; });
    var points = sMarked.map(function (row) {
      var p = moodLinePoint(row.primary, row.x, row.date, dates.indexOf(row.date), 0);
      p.count = row.entries.length;
      return p;
    });
    return {
      agentId: String(partner.agentId || ''),
      name: partner.agentName,
      rows: srows,
      points: points,
      dayCount: sMarked.length,
      total: srows.reduce(function (sum, row) { return sum + row.entries.length; }, 0),
    };
  });
  var rangeColors = moodLinePartnerColors(rawSeries.map(function (s) { return s.agentId; }));
  var series = rawSeries.map(function (s) {
    s.color = rangeColors[s.agentId] || PARTNER_MOOD_COLORS[0];
    return s;
  });
  var hasAny = marked.length || series.some(function (s) { return s.points.length; });
  if (!hasAny) {
    card.innerHTML = '<div class="moodline-card-head"><span class="moodline-card-title">' + moodLineDays + ' 天</span></div>' +
      '<div class="moodline-empty">这段日子还没留下心情。<br><b>回到日历，记一笔当下的就好。</b></div>';
    return;
  }
  var points = marked.map(function (row, index) {
    var p = moodLinePoint(row.primary, row.x, row.date, dates.indexOf(row.date), 0);
    p.count = row.entries.length;
    return p;
  });
  var start = dates[0] || '';
  var end = dates[dates.length - 1] || '';
  var label = moodLineDays + ' 天 · ' + start.slice(5).replace('-', '/') + '—' + end.slice(5).replace('-', '/');
  var total = rows.reduce(function (sum, row) { return sum + row.entries.length; }, 0);
  var captionParts = [marked.length + ' 天有记录 · 共 ' + total + ' 笔心情'];
  series.forEach(function (s) {
    if (s.points.length) captionParts.push(s.name + ' ' + s.dayCount + ' 天 · ' + s.total + ' 笔际遇');
  });
  var caption = captionParts.join('；');
  var legendSeries = series.filter(function (s) { return s.points.length; });
  var shownSeries = moodLineVisibleSeries(legendSeries);
  var dayButtons = marked.map(function (row) {
    var entry = row.primary;
    var auto = entry.source === 'auto' ? ' auto' : '';
    return '<button type="button" class="moodline-entry' + auto + '" title="' + esc(moodLineEntryTitle(entry)) + '" onclick="openMoodLine(&quot;' + esc(row.date) + '&quot;)">' +
      '<span>' + esc(row.date.slice(5).replace('-', '/')) + '</span><span>' + esc(entry.emoji || '') + '</span><span>' + esc(entry.label || '') + '</span>' +
      (entry.source === 'auto' ? '<span class="entry-source">候选</span>' : '') +
      '</button>';
  }).join('');
  var partnerButtons = shownSeries.map(function (s) {
    return s.rows.filter(function (row) { return !!row.primary; }).map(function (row) {
      var entry = row.primary;
      return '<button type="button" class="moodline-entry auto" title="' + esc(partnerMoodPointTitle(s.name, row.date, entry)) + '" onclick="openMoodLine(&quot;' + esc(row.date) + '&quot;)">' +
        '<span>' + esc(row.date.slice(5).replace('-', '/')) + '</span><span>' + esc(entry.emoji || '') + '</span><span>' + esc(entry.label || '') + '</span>' +
        '<span class="entry-source">' + esc(s.name) + '</span>' +
        '</button>';
    }).join('');
  }).join('');
  card.innerHTML = '<div class="moodline-card-head"><span class="moodline-card-title">' + esc(label) + '</span><span class="moodline-card-caption">' + esc(caption) + '</span></div>' +
    '<div class="moodline-plot"><div class="moodline-hover-tip" id="moodline-hover-tip" role="tooltip"></div>' + renderMoodLineSvg(points, rows, 'range', label, shownSeries) + '</div>' +
    '<div class="moodline-below">' + moodLineLegendHtml(legendSeries) + '<span class="moodline-note">空白日期不补点，曲线轻轻跨过去；点名字可以收起某位伙伴</span></div>' +
    '<div class="moodline-entries">' + dayButtons + partnerButtons + '</div>';
}

function syncMoodLineToolbar() {
  document.querySelectorAll('#moodline-mode-seg .seg-btn').forEach(function (button) {
    button.classList.toggle('active', button.getAttribute('data-mode') === moodLineMode);
  });
  var range = document.getElementById('moodline-range-seg');
  if (range) range.classList.toggle('hidden', moodLineMode !== 'range');
  document.querySelectorAll('#moodline-range-seg .seg-btn').forEach(function (button) {
    button.classList.toggle('active', Number(button.getAttribute('data-days')) === moodLineDays);
  });
}

function updateMoodLineToolbarLabel() {
  var label = document.getElementById('moodline-date-label');
  if (!label) return;
  if (moodLineMode === 'day') label.textContent = moodLineDateText(moodLineAnchorDate);
  else {
    var dates = moodLineRangeDates(moodLineRangeEndDate(), moodLineDays);
    label.textContent = moodLineDays + ' 天 · ' + dates[0].slice(5).replace('-', '/') + '—' + dates[dates.length - 1].slice(5).replace('-', '/');
  }
}

function moodLineMonths(dates) {
  var found = {};
  (dates || []).forEach(function (date) { found[String(date).slice(0, 7)] = true; });
  return Object.keys(found);
}

function loadMoodLine() {
  var card = document.getElementById('moodline-card');
  if (!card) return;
  if (!moodLineAnchorDate) moodLineAnchorDate = selectedDate || todayMoodLineDate();
  syncMoodLineToolbar();
  updateMoodLineToolbarLabel();
  var requestId = ++moodLineRequestSeq;
  card.innerHTML = '<div class="moodline-empty">正在把这段日子铺开…</div>';
  if (moodLineMode === 'day') {
    var date = moodLineAnchorDate;
    Promise.all([
      api('api/moods/' + date).catch(function () { return null; }),
      api('api/partner-moods/' + date).catch(function () { return null; }),
    ]).then(function (parts) {
      if (requestId !== moodLineRequestSeq) return;
      var owner = parts[0];
      var partner = parts[1];
      if ((!owner || !owner.ok) && (!partner || !partner.ok)) {
        card.innerHTML = '<div class="moodline-empty">这天的心情还没读出来，稍后再试。</div>';
        return;
      }
      renderMoodLineDay(date, (owner && owner.moods) || [], buildPartnerSeriesFromDay(partner));
    });
    return;
  }
  var dates = moodLineRangeDates(moodLineRangeEndDate(), moodLineDays);
  var months = moodLineMonths(dates);
  Promise.all([
    Promise.all(months.map(function (month) {
      return api('api/moods?month=' + month).then(function (res) { return res && res.ok && res.days ? res.days : {}; }).catch(function () { return {}; });
    })),
    Promise.all(months.map(function (month) {
      return api('api/partner-moods?month=' + month).then(function (res) { return res && res.ok ? res : null; }).catch(function () { return null; });
    })),
  ]).then(function (parts) {
    if (requestId !== moodLineRequestSeq) return;
    var dayMap = {};
    (parts[0] || []).forEach(function (map) { Object.assign(dayMap, map); });
    var agents = {};
    var byAgent = {};
    (parts[1] || []).forEach(function (res) {
      if (!res) return;
      Object.assign(agents, res.agents || {});
      Object.keys(res.days || {}).forEach(function (date) {
        Object.keys(res.days[date] || {}).forEach(function (agentId) {
          if (!byAgent[agentId]) byAgent[agentId] = {};
          byAgent[agentId][date] = res.days[date][agentId];
        });
      });
    });
    var partnerSeries = Object.keys(byAgent).sort().map(function (agentId) {
      return { agentId: agentId, agentName: agents[agentId] || agentId, dayMap: byAgent[agentId] };
    });
    renderMoodLineRange(dates, dayMap, partnerSeries);
  }).catch(function () {
    if (requestId === moodLineRequestSeq) card.innerHTML = '<div class="moodline-empty">这段心情还没读出来，稍后再试。</div>';
  });
}

/** 把某天的伙伴心情接口结果转成前端 series（按 agentId 排序，颜色稳定）。 */
/** 把某天的伙伴心情接口结果转成前端 series（颜色由渲染层按 agentId 统一分配）。 */
function buildPartnerSeriesFromDay(partnerRes) {
  if (!partnerRes || !partnerRes.ok) return [];
  var agents = partnerRes.agents || {};
  var partners = partnerRes.partners || {};
  return Object.keys(partners).sort().map(function (agentId) {
    return {
      agentId: agentId,
      agentName: agents[agentId] || agentId,
      entries: partners[agentId] || [],
    };
  });
}

function switchMoodLineMode(mode) {
  moodLineMode = mode === 'range' ? 'range' : 'day';
  if (moodLineMode === 'range') {
    // 连续视图跟着自己的窗口走，不受日历选中日和点过的心情点影响
    moodLineRangeEnd = moodLineRangeEndDate();
  } else if (!moodLineAnchorDate) {
    moodLineAnchorDate = selectedDate || todayMoodLineDate();
  }
  syncMoodLineToolbar();
  loadMoodLine();
}

function switchMoodLineRange(days) {
  var allowed = [7, 14, 30];
  moodLineDays = allowed.indexOf(Number(days)) >= 0 ? Number(days) : 7;
  moodLineMode = 'range';
  moodLineRangeEnd = moodLineRangeEndDate();
  syncMoodLineToolbar();
  loadMoodLine();
}

function shiftMoodLine(direction) {
  var step = Number(direction || 0);
  if (moodLineMode === 'range') {
    // 连续视图只往更早的日子翻；已经在最近一段时不再往未来空走
    var moved = moodLineDateShift(moodLineRangeEndDate(), step * moodLineDays);
    var today = todayMoodLineDate();
    moodLineRangeEnd = moved > today ? today : moved;
  } else {
    moodLineAnchorDate = moodLineDateShift(moodLineAnchorDate || todayMoodLineDate(), step);
  }
  loadMoodLine();
}

function openMoodLine(date) {
  moodLineAnchorDate = String(date || selectedDate || todayMoodLineDate());
  moodLineMode = 'day';
  syncMoodLineToolbar();
  switchTab('moodline');
}

// ── 这一天的这一页 ──
function renderSummaryBlock(day) {
  var entries = day.summaries || (day.summary ? [day.summary] : []);
  var canSum = day.canSummary;
  var isToday = selectedDate === dk(new Date().getFullYear(), new Date().getMonth() + 1, new Date().getDate());
  var html = '';
  if (entries.length) {
    html += '<div class="sum-block">' +
      '<div class="sum-head">' +
      '<span class="sum-title">这一页</span>' +
      '<div class="sum-actions">' +
      '<button class="sum-link" onclick="openSummaryTab(\\'' + selectedDate + '\\')">查看时光册</button>' +
      '<button class="sum-link" onclick="runSummaryFromDay(\\'' + selectedDate + '\\', this)">重新做这一页</button>' +
      '</div></div><span class="sum-msg" id="detail-summary-msg"></span>';
    entries.forEach(function (entry) {
      var key = summaryDomKey(selectedDate, entry.agentId || '');
      html += '<div class="sum-agent">' +
        '<span class="sum-agent-name">' + esc(entry.agentName || (entry.agentId ? entry.agentId : '未分类的一页')) + '</span>' +
        '<div class="sum-text" id="archive-text-' + key + '">' + esc(entry.text) + '</div>' +
        '<div class="archive-actions">' +
        '<button onclick="editSummary(\\'' + selectedDate + '\\',' + jsArg(entry.agentId || '') + ')">修改</button>' +
        '<button onclick="openSummaryChat(\\'' + selectedDate + '\\',' + jsArg(entry.agentId || '') + ',' + jsArg(entry.agentName || (entry.agentId ? entry.agentId : '未分类的一页')) + ')">和小花聊聊</button>' +
        '</div>' +
        '</div>';
    });
    html += '</div>';
  } else if (canSum) {
    html += '<div class="sum-block empty">' +
      '<div class="sum-text muted">这一天还没有做成一页。把和伙伴们做过的事收进来，日后翻看会很有味道。</div>' +
      '<button class="btn primary" onclick="runSummaryFromDay(\\'' + selectedDate + '\\')">做成这一页</button>' +
      '<span class="sum-msg" id="detail-summary-msg"></span>' +
      '</div>';
  } else if (isToday) {
    html += '<div class="sum-block empty">' +
      '<div class="sum-text muted">今天还没结束，可以先看看这一页到目前为止的回忆。</div>' +
      '<button class="btn" onclick="previewDay(\\'' + selectedDate + '\\')">预看这一页</button>' +
      '<div class="sum-preview hidden" id="detail-summary-preview"></div>' +
      '</div>';
  }
  html += focusDayRecordsHtml(day.focusGroups || day.focusSessions);
  return html;
}

function runSummaryFromDay(date, trigger) {
  var msgEl = document.getElementById('detail-summary-msg');
  queueSummaryDates([date], msgEl, false, trigger);
}

function previewDay(date) {
  var box = document.getElementById('detail-summary-preview');
  api('api/summaries/run', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ date: date, preview: true }),
  }).then(function (res) {
    if (res.ok && res.text) {
      // 把预览内容直接显示在这一页区块里
      if (box) {
        box.classList.remove('hidden');
        box.textContent = res.text;
        box.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      } else {
        toast('这一页已预看，切到时光册查看');
        loadMonth(); selectDay(selectedDate);
      }
    } else toast(res.error || '预览失败');
  });
}

function openSummaryTab(date) {
  switchTab('summary');
  if (date) {
    setTimeout(function () {
      var item = document.querySelector('.archive-item[data-summary-date="' + date + '"]');
      if (item) item.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }, 200);
  }
}

// 类型切换联动：更新输入框占位提示和一句话讲解。
function updateTypeGuide(type) {
  var kind = TYPE_TIPS[type] ? type : 'event';
  var titleInput = document.getElementById('new-title');
  if (titleInput) titleInput.placeholder = NEW_TITLE_PLACEHOLDER[kind] || NEW_TITLE_PLACEHOLDER.event;
  var tip = document.getElementById('new-type-tip');
  if (tip) tip.textContent = TYPE_TIPS[kind] || TYPE_TIPS.event;
  syncTodoReminderUI(kind);
  syncTodoRepeatUI(kind);
  if (kind === 'todo') autofillTodoReminderFromTitle();
}

function todoTimeMinutes(value) {
  var parts = String(value || '').split(':');
  if (parts.length !== 2) return NaN;
  var hour = Number(parts[0]);
  var minute = Number(parts[1]);
  if (!Number.isInteger(hour) || !Number.isInteger(minute) || hour < 0 || hour > 23 || minute < 0 || minute > 59) return NaN;
  return hour * 60 + minute;
}

function autofillTodoReminderFromTitle() {
  var typeTab = document.querySelector('#type-tabs .type-tab.active');
  if (!typeTab || typeTab.getAttribute('data-type') !== 'todo' || todoReminderManual) return;
  var titleInput = document.getElementById('new-title');
  var start = document.getElementById('new-reminder-start');
  var end = document.getElementById('new-reminder-end');
  if (!titleInput || !start || !end || typeof parseTodoReminderText !== 'function') return;
  var parsed = null;
  try { parsed = parseTodoReminderText(titleInput.value, { now: new Date(), targetDate: selectedDate || '' }); } catch (_) { parsed = null; }
  if (!parsed) {
    if (todoReminderAutofilled) {
      todoReminderAutofilling = true;
      start.value = '';
      end.value = '';
      todoReminderAutofilling = false;
      todoReminderAutofilled = false;
      syncTodoReminderUI('todo');
    }
    return;
  }
  if ((start.value || end.value) && !todoReminderAutofilled) return;
  todoReminderAutofilling = true;
  start.value = parsed.reminderStart;
  end.value = parsed.reminderEnd;
  todoReminderAutofilling = false;
  todoReminderAutofilled = true;
  syncTodoReminderUI('todo');
}

function syncTodoRepeatUI(type) {
  var isTodo = type === 'todo';
  var box = document.getElementById('todo-repeat-settings');
  var select = document.getElementById('new-todo-repeat');
  var days = document.getElementById('todo-repeat-days');
  var note = document.getElementById('todo-repeat-note');
  var dayInputs = document.querySelectorAll('#todo-repeat-days input[type="checkbox"]');
  if (box) box.classList.toggle('hidden', !isTodo);
  if (days) days.classList.toggle('hidden', !isTodo || !select || select.value !== 'weekly');
  refreshOneSelect('new-todo-repeat');
  if (select) {
    select.disabled = isTodo && editingRecurringTodo;
    var selectWrap = select.closest ? select.closest('.dd') : null;
    if (selectWrap) {
      selectWrap.classList.toggle('disabled', !!select.disabled);
      var trigger = selectWrap.querySelector('.dd-trigger');
      if (trigger) trigger.disabled = !!select.disabled;
    }
  }
  dayInputs.forEach(function (input) { input.disabled = isTodo && editingRecurringTodo; });
  if (note) note.textContent = editingRecurringTodo
    ? '改名称或提醒会作用整组；起始日期和重复星期暂不支持改，删除会连同完成记录一起移除。'
    : '没勾掉也会照原来的日期继续；欠下的次数可在左侧门厅整理。';
}

function setTodoRepeatUI(rule) {
  var select = document.getElementById('new-todo-repeat');
  var dayInputs = document.querySelectorAll('#todo-repeat-days input[type="checkbox"]');
  if (!select) return;
  var frequency = rule && rule.frequency;
  select.value = frequency === 'daily' ? 'daily' : frequency === 'weekly' ? 'weekly' : 'none';
  var selected = Array.isArray(rule && rule.weekdays) ? rule.weekdays.map(Number) : [];
  dayInputs.forEach(function (input) { input.checked = selected.indexOf(Number(input.value)) >= 0; });
  var activeTab = document.querySelector('#type-tabs .type-tab.active');
  syncTodoRepeatUI(activeTab ? activeTab.getAttribute('data-type') : 'event');
}

function syncTodoReminderUI(type) {
  var isTodo = type === 'todo';
  var box = document.getElementById('todo-reminder');
  var error = document.getElementById('todo-time-error');
  var preview = document.getElementById('todo-time-preview');
  var start = document.getElementById('new-reminder-start');
  var end = document.getElementById('new-reminder-end');
  var save = document.getElementById('event-save-btn');
  if (box) box.classList.toggle('hidden', !isTodo);
  if (!isTodo) {
    if (error) error.classList.add('hidden');
    if (preview) preview.textContent = '';
    if (save) save.disabled = false;
    return;
  }
  var startValue = start ? start.value : '';
  var endValue = end ? end.value : '';
  var startMinutes = todoTimeMinutes(startValue);
  var endMinutes = todoTimeMinutes(endValue);
  var valid = Boolean(startValue && endValue && Number.isFinite(startMinutes) && Number.isFinite(endMinutes) && startMinutes <= endMinutes);
  if (preview) {
    var autoNote = todoReminderAutofilled && !todoReminderManual ? '（已从标题识别）' : '';
    if (!startValue || !endValue) preview.textContent = '标题里写明确时间（如“下午三点”或“9点”）会自动填入；当天白天写“两点”会按下午两点；有“提醒”时优先它旁边的时间，也可以手动选';
    else if (startValue === endValue) preview.textContent = startValue + ' · 准点提醒' + autoNote;
    else preview.textContent = startValue + '–' + endValue + ' · 按时段提醒' + autoNote;
  }
  if (error) {
    var untouched = !startValue && !endValue;
    if (editingTodoNeedsReminderTime) {
      error.textContent = '这条旧待办还没设过提醒时间，请补上后再保存。';
    }
    else if (!startValue || !endValue) {
      error.textContent = '请选择提醒时间，选同一时间表示准点提醒。';
    }
    else if (startMinutes > endMinutes) error.textContent = '开始时间不能晚于结束时间。';
    // 新记一笔时两端都空属于还没开始填，不是填错：不挂红字，保存按钮照样禁用。
    // 以前这里只看 valid，导致每次重画卡片、或切到待办类型时都先给她一个红脸。
    var showError = !valid && (editingTodoNeedsReminderTime || !untouched);
    error.classList.toggle('hidden', !showError);
  }
  if (save) save.disabled = !valid;
}

function saveEvent() {
  var title = document.getElementById('new-title').value.trim();
  if (!title) { toast('写个名称吧'); return; }
  var typeTab = document.querySelector('#type-tabs .type-tab.active');
  var type = typeTab ? typeTab.getAttribute('data-type') : 'event';
  var dateInput = document.getElementById('new-date');
  var date = (dateInput && dateInput.value) || selectedDate;
  var note = document.getElementById('new-note').value.trim();
  var body = { title: title, type: type, date: date, note: note, repeatYearly: type === 'anniversary' };
  if (type === 'todo') {
    var repeatMode = (document.getElementById('new-todo-repeat') || {}).value || 'none';
    if (repeatMode === 'daily') body.repeatRule = { frequency: 'daily' };
    else if (repeatMode === 'weekly') {
      var weekdays = Array.from(document.querySelectorAll('#todo-repeat-days input[type="checkbox"]:checked'))
        .map(function (input) { return Number(input.value); });
      if (!weekdays.length) { toast('每周至少选一天'); return; }
      body.repeatRule = { frequency: 'weekly', weekdays: weekdays };
    } else body.repeatRule = null;
    var startInput = document.getElementById('new-reminder-start');
    var endInput = document.getElementById('new-reminder-end');
    var reminderStart = startInput ? startInput.value : '';
    var reminderEnd = endInput ? endInput.value : '';
    if (!reminderStart || !reminderEnd || todoTimeMinutes(reminderStart) > todoTimeMinutes(reminderEnd)) {
      syncTodoReminderUI(type);
      return;
    }
    body.reminderStart = reminderStart;
    body.reminderEnd = reminderEnd;
  }
  var route = editingEventId ? 'api/events/' + editingEventId : 'api/events';
  api(route, {
    method: editingEventId ? 'PUT' : 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }).then(function (res) {
    if (res.ok) {
      toast(editingEventId ? '改好了' : '记下了「' + title + '」');
      resetAddCardState();
      loadMonth(); selectDay(date); loadToday();
    } else toast(res.error || '没存上');
  });
}

function startEditEvent(id) {
  var e = dayEventCache[id];
  if (!e) return;
  editingEventId = id;
  editingRecurringTodo = Boolean(e.type === 'todo' && e.repeatRule);
  editingTodoNeedsReminderTime = e.type === 'todo' && (!e.reminderStart || !e.reminderEnd);
  var existingReminderStart = String(e.reminderStart || '');
  var existingReminderEnd = String(e.reminderEnd || '');
  var parsedTitleReminder = null;
  if (e.type === 'todo' && typeof parseTodoReminderText === 'function') {
    try { parsedTitleReminder = parseTodoReminderText(e.title || '', { now: new Date(), targetDate: e.date || selectedDate || '' }); } catch (_) { parsedTitleReminder = null; }
  }
  var reminderMatchesTitle = Boolean(
    existingReminderStart && existingReminderEnd && parsedTitleReminder &&
    parsedTitleReminder.reminderStart === existingReminderStart && parsedTitleReminder.reminderEnd === existingReminderEnd
  );
  todoReminderManual = Boolean(existingReminderStart || existingReminderEnd) && !reminderMatchesTitle;
  todoReminderAutofilled = reminderMatchesTitle;
  document.getElementById('new-title').value = e.title || '';
  var dateInput = document.getElementById('new-date');
  if (dateInput) {
    dateInput.value = e.seriesStartDate || e.date || selectedDate;
    dateInput.disabled = editingRecurringTodo;
    dateInput.classList.remove('hidden');
  }
  var dateNote = document.getElementById('new-date-note');
  if (dateNote) dateNote.classList.add('hidden');
  var todoTab = document.querySelector('#type-tabs .type-tab[data-type="todo"]');
  if (todoTab && todoTab.disabled) {
    todoTab.disabled = false;
    todoTab.textContent = '待办';
    todoTab.removeAttribute('title');
  }
  document.getElementById('new-note').value = e.note || '';
  var reminderStartInput = document.getElementById('new-reminder-start');
  var reminderEndInput = document.getElementById('new-reminder-end');
  if (reminderStartInput) reminderStartInput.value = e.reminderStart || '';
  if (reminderEndInput) reminderEndInput.value = e.reminderEnd || '';
  document.querySelectorAll('#type-tabs .type-tab').forEach(function (b) {
    var isCurrentType = b.getAttribute('data-type') === (e.type || 'event');
    b.classList.toggle('active', isCurrentType);
    b.disabled = editingRecurringTodo && !isCurrentType;
  });
  updateTypeGuide(e.type || 'event');
  setTodoRepeatUI(e.repeatRule || null);
  document.getElementById('event-save-btn').textContent = '保存修改';
  document.getElementById('event-cancel-btn').classList.remove('hidden');
  document.getElementById('new-title').focus();
}

function cancelEditEvent() {
  resetAddCardState();
  selectDay(selectedDate);
}

/**
 * 记一笔卡片收工：把编辑态与识别态都清干净。
 * 这几个是模块级变量，不随卡片重画而复位；漏清时下一次重画会带着上一条的痕迹
 * （比如编辑过一条缺时间的旧待办后，普通记一笔也会被告知「还没设过提醒时间」）。
 */
function resetAddCardState() {
  editingEventId = '';
  editingTodoNeedsReminderTime = false;
  editingRecurringTodo = false;
  var dateInput = document.getElementById('new-date');
  if (dateInput) dateInput.disabled = false;
  document.querySelectorAll('#type-tabs .type-tab').forEach(function (button) { button.disabled = false; });
  todoReminderManual = false;
  todoReminderAutofilled = false;
}

// ── 生理期快捷动作 ──
function markPeriod(date) {
  api('api/periods', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ date: date }),
  }).then(function (res) {
    if (res.ok) {
      var msg = res.created ? '记下生理期啦' : (res.extended ? '今天也记上啦，连着昨天' : (res.confirmed ? '确认这天啦' : '这天已经记过了'));
      toast(msg);
      loadMonth(); selectDay(selectedDate); loadToday();
    } else toast(res.error || '没记成');
  });
}

function unmarkPeriod(date) {
  askConfirm('从这天起结束这段生理期记录吗？', function () {
    api('api/periods?date=' + date, { method: 'DELETE' }).then(function (res) {
      if (res.ok) { toast('已从这天结束'); loadMonth(); selectDay(selectedDate); loadToday(); }
      else toast(res.error || '没改动');
    });
  });
}

// 「今天结束了」：确认这段生理期到此为止（截断到今天，或确认昨天为止），不删已记的天。
function endPeriod(date) {
  askConfirm('这段生理期到今天结束了吗？已记的日期都会保留。', function () {
    api('api/periods/end', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ date: date }),
    }).then(function (res) {
      if (res.ok) {
        toast(res.changed ? '记好啦，这段生理期到此为止' : '这段生理期已经结束了');
        loadMonth(); selectDay(selectedDate); loadToday();
      } else toast(res.error || '没改动');
    });
  });
}

function togglePeriodPicker() {
  var el = document.getElementById('period-picker');
  if (!el) return;
  el.classList.toggle('hidden');
}

function markPeriodFromPicker() {
  var v = document.getElementById('period-start').value;
  if (!v) { toast('选个日期吧'); return; }
  api('api/periods', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ date: v }),
  }).then(function (res) {
    if (res.ok) { toast('记下生理期啦'); loadMonth(); selectDay(selectedDate); loadToday(); }
    else toast(res.error || '没记成');
  });
}

function toggleTodo(id) {
  api('api/events/' + id + '/toggle', { method: 'POST' }).then(function (res) {
    if (res.ok) { toast(res.event.done ? '完成啦' : '取消完成'); loadMonth(); selectDay(selectedDate); loadToday(); }
    else toast(res.error || '没改动');
  });
}

function delEvent(id) {
  var event = dayEventCache[id];
  var message = event && event.repeatRule
    ? '这会删掉整组周期待办和它的完成记录，无法恢复。确定继续吗？'
    : '要删掉这条吗？删掉后无法恢复。';
  askConfirm(message, function () {
    api('api/events/' + id, { method: 'DELETE' }).then(function (res) {
      if (res.ok) { toast('删掉了'); loadMonth(); selectDay(selectedDate); loadToday(); }
      else toast(res.error || '没删掉');
    });
  });
}

function summaryDomKey(date, agentId) {
  return encodeURIComponent(String(date || '') + '|' + String(agentId || 'legacy'));
}

function jsArg(value) {
  var slash = String.fromCharCode(92);
  return "'" + String(value == null ? '' : value)
    .split(slash).join(slash + slash)
    .split("'").join(slash + "'")
    .split(String.fromCharCode(13)).join(slash + 'r')
    .split(String.fromCharCode(10)).join(slash + 'n') + "'";
}

function jsArgs(date, agentId) {
  return jsArg(date) + ',' + jsArg(agentId);
}

function loadSummaries(skipJobs) {
  if (!skipJobs) loadSummaryJobs();
  api('api/summaries').then(function (res) {
    var list = document.getElementById('summaries-list');
    if (!res.ok) return;
    var arr = res.summaries || [];
    if (!arr.length) {
      list.innerHTML = '<div class="archive-empty">时光册还空着。<br>先回到日历，把已经结束的日子做成一页吧。</div>';
      return;
    }
    // 时光册跨月：情绪速览按整个时间范围拉（后端按月聚合，这里前端按需多拉几个月也可；简化：按月分次拉）
    var months = {};
    arr.forEach(function (s) { months[s.date.slice(0, 7)] = true; });
    var moodFetches = Object.keys(months).map(function (m) {
      return api('api/moods?month=' + m).then(function (r) {
        return (r && r.ok && r.days) ? r.days : {};
      }).catch(function () { return {}; });
    });
    Promise.all(moodFetches).then(function (monthMaps) {
      var moodDays = {};
      monthMaps.forEach(function (map) { Object.assign(moodDays, map); });
      renderSummariesHtml(arr, moodDays);
    });
  }).catch(function () {
    var list = document.getElementById('summaries-list');
    if (list) list.innerHTML = '<div class="archive-empty">时光册加载失败，稍后再试。</div>';
  });
}

function renderSummariesHtml(arr, moodDays) {
  var list = document.getElementById('summaries-list');
  var month = '';
  var day = '';
  var moodRendered = {};
  var html = '';
  arr.forEach(function (s) {
    var key = summaryDomKey(s.date, s.agentId);
    var m = s.date.slice(0, 7);
    if (m !== month) { month = m; html += '<div class="month-title">' + esc(m.replace('-', ' 年 ') + ' 月') + '</div>'; }
    // 按天分组：同一天的条目收进同一个小节，日期标题只出现一次
    if (s.date !== day) {
      day = s.date;
      html += '<div class="day-title"><span class="day-date">' + esc(s.date.slice(5)) + '</span><span class="day-label">这一天</span></div>';
    }
    html += '<div class="archive-item" id="archive-' + key + '" data-summary-date="' + esc(s.date) + '">';
    // 情绪时间线只在同一天第一页上方出现一次（情绪是自己的维度，不属于某位伙伴）
    var moodList = (moodDays[s.date] || []);
    if (moodList.length && !moodRendered[s.date]) {
      moodRendered[s.date] = true;
      html += '<div class="a-moods" id="archive-moods-' + esc(s.date) + '">' +
        renderMoodTimelineInline(moodList, s.date) + '</div>';
    }
    html += '<span class="a-agent' + (s.unclassified ? ' legacy' : '') + '">' + esc(s.agentName || (s.unclassified ? '未分类的一页' : s.agentId)) + '</span>' +
      '<div class="a-text" id="archive-text-' + key + '">' + esc(s.text) + '</div>' +
      '<div class="archive-actions">' +
      '<button onclick="editSummary(' + jsArgs(s.date, s.agentId) + ')">编辑</button>' +
      '<button onclick="openSummaryChat(' + jsArgs(s.date, s.agentId) + ',' + jsArg(s.agentName || (s.agentId ? s.agentId : '未分类的一页')) + ')">和小花聊聊</button>' +
      '<button class="danger" onclick="deleteSummary(' + jsArgs(s.date, s.agentId) + ',' + jsArg(s.agentName || '这位伙伴') + ')">删除</button>' +
      '</div></div>';
  });
  list.innerHTML = html;
}

function renderMoodTimelineInline(moods, date) {
  var items = moods.slice().sort(function (a, b) {
    return moodLineSegmentRank(moodLineSegmentForEntry(a)) - moodLineSegmentRank(moodLineSegmentForEntry(b));
  }).map(function (entry) {
    var seg = moodLineEntryTimeLabel(entry);
    return '<span class="mood-tl-item' + (entry.source === 'auto' ? ' tl-auto' : '') + '" title="' + esc(moodLineEntryTitle(entry)) + '">' +
      '<span class="tl-seg">' + esc(seg) + '</span>' +
      '<span class="tl-emoji">' + esc(entry.emoji || '') + '</span>' +
      '<span>' + esc(entry.label || '') + '</span>' +
      (entry.reason ? '<span class="tl-note">（' + esc(entry.reason) + '）</span>' : '') +
      (entry.note ? '<span class="tl-note">' + esc(entry.note) + '</span>' : '') +
      '</span>';
  });
  return '<span class="mood-timeline"><span class="mood-block-title" style="letter-spacing:1px">心情</span>' + items.join('<span class="tl-arrow">→</span>') + '</span>';
}

function summaryJobStatusText(status) {
  return ({ queued: '排队中', running: '正在做成册', completed: '这本册子做好啦', completed_with_errors: '有几页没做好', failed: '这次没做成' })[status] || '正在做';
}

// 汇总失败页明细：哪些日期没做好、原因是什么。
function summaryJobFailedItems(job) {
  var list = Array.isArray(job.outcomes) ? job.outcomes : [];
  return list.filter(function (item) { return item && item.status === 'failed'; });
}

function renderSummaryJobs(jobs, autoRetry) {
  var boxes = [document.getElementById('summary-jobs'), document.getElementById('summary-jobs-calendar')].filter(function (box) { return !!box; });
  if (!boxes.length) return;
  var list = Array.isArray(jobs) ? jobs : [];
  lastSummaryJobs = list;
  // 已经确认收下或取消重做的任务不再显示进度卡。
  // 只认「正在跑的那一个」和「最近一次」：取消掉最近一次之后，
  // 不该把更早的历史失败任务顶上来（那会让人以为取消没生效）。
  var isHiddenSummaryJob = function (item) {
    if (!item) return true;
    if (locallyCancelledSummaryJobs[String(item.id || '')]) return true;
    if (locallyDismissedSummaryJobs[String(item.id || '')]) return true;
    return !!(item.cancelledAt || (item.status === 'completed' && item.dismissedAt));
  };
  var activeJob = list.find(function (item) { return item && (item.status === 'queued' || item.status === 'running'); });
  var latestJob = list.length ? list[0] : null;
  var job = activeJob || (isHiddenSummaryJob(latestJob) ? null : latestJob);
  // 自动整理失败/等待重试/停摆时，跟进度卡一起显示一条说明；没有后台任务时它自己也能撑起这张卡。
  // 真有任务在跑时，不再并列显示「自动整理」的待补说明：那次跑多半就是在补它，
  // 两张卡一起摆，人只会不知道该听谁。真没补上，它下一轮会自己再冒出来。
  var autoHtml = (job && (job.status === 'running' || job.status === 'queued'))
    ? ''
    : renderAutomaticRetryNote(autoRetry);
  if (!job) {
    boxes.forEach(function (box) {
      if (autoHtml) { box.innerHTML = autoHtml; box.classList.remove('hidden'); }
      else { box.classList.add('hidden'); box.innerHTML = ''; }
    });
    return;
  }
  var progress = job.progress || {};
  var done = Number(progress.done || 0);
  var total = Number(progress.total || (job.dates || []).length || 0);
  var percent = total ? Math.max(0, Math.min(100, Math.round(done * 100 / total))) : 0;
  var detail;
  if (job.status === 'completed' || job.status === 'completed_with_errors') {
    detail = total > 1 ? '共 ' + total + ' 天，已做好 ' + done + ' 页' : (done ? '这一页已经做好' : '这一页没做好');
  } else {
    detail = total > 1 ? '共 ' + total + ' 天，已做好 ' + done + ' 页' : (done ? '这一页已经做好' : '正在准备');
  }
  // 正在跑的时候把阶段说出来：只显示“正在准备”会让人以为卡住了。
  if ((job.status === 'running' || job.status === 'queued') && job.stage) {
    detail = '正在做：' + job.stage;
    if (job.currentDate) detail += ' · ' + job.currentDate;
  } else if (job.currentDate) {
    detail += ' · 当前 ' + job.currentDate;
  }
  var error = job.error ? '<div class="summary-job-error">' + esc(job.error) + '</div>' : '';
  var retryHtml = '';
  if (job.status === 'completed_with_errors') {
    var failedItems = summaryJobFailedItems(job);
    var failedLines = failedItems.map(function (item) {
      var reason = item.error ? '：' + item.error : '';
      return '<div class="summary-job-failed-item">' + esc(item.date) + reason + '</div>';
    }).join('');
    retryHtml = '<div class="summary-job-failed">' + failedLines + '</div>' +
      '<div class="summary-job-actions">' +
      '<button type="button" class="btn primary summary-job-retry-btn" onclick="retrySummaryJobFailed(' + jsArg(job.id) + ', this)">重新生成失败部分</button>' +
      '<button type="button" class="btn summary-job-cancel-btn" onclick="cancelSummaryJobRetry(' + jsArg(job.id) + ', this)">取消重做</button>' +
      '</div>';
  } else if (job.status === 'failed') {
    retryHtml = '<div class="summary-job-actions">' +
      '<button type="button" class="btn summary-job-cancel-btn" onclick="cancelSummaryJobRetry(' + jsArg(job.id) + ', this)">取消重做</button>' +
      '</div>';
  } else if (job.status === 'completed') {
    retryHtml = '<button type="button" class="btn summary-job-dismiss-btn" onclick="dismissSummaryJob(' + jsArg(job.id) + ')">知道了</button>';
  }
  var html = '<div class="summary-job-head"><span>做成册进度</span><span class="summary-job-status">' + esc(summaryJobStatusText(job.status)) + '</span></div>' +
    '<div class="summary-job-track"><div class="summary-job-progress" style="width:' + percent + '%"></div></div>' +
    '<div class="summary-job-detail">' + esc(detail) + '</div>' + error + retryHtml + autoHtml;
  boxes.forEach(function (box) {
    box.innerHTML = html;
    box.classList.remove('hidden');
  });
}

// 自动整理的状态条：失败等重试 / 今天停摆 / 伙伴链没补完。
// 文案由后端拼好（describeAutomaticRetry），这里只负责展示与给一个手动入口。
function renderAutomaticRetryNote(info) {
  if (!info || !info.active || !info.message) return '';
  var levelText = info.level === 'paused' ? '已熔断' : (info.level === 'cooldown' ? '等重试' : '待补完');
  var buttonText = info.level === 'paused' ? '手动做成这一页' : '现在就手动做';
  return '<div class="summary-auto-note ' + esc(info.level) + '">' +
    '<div class="summary-auto-head"><span>自动整理</span><span class="summary-job-status">' + esc(levelText) + '</span></div>' +
    '<div class="summary-auto-detail">' + esc(info.message) + '</div>' +
    '<div class="summary-job-actions">' +
    '<button type="button" class="btn summary-auto-run-btn" onclick="runAutoRetryNow(' + jsArg(info.day) + ', this)">' + esc(buttonText) + '</button>' +
    '</div></div>';
}

// 不等冷却了，直接手动把这一天补成册（做册会带上当天还没跑的伙伴际遇链）。
function runAutoRetryNow(date, trigger) {
  queueSummaryDates([date], null, false, trigger);
}

// 重新生成失败部分：只重做上一次任务里没做好的页，成功页不动。
function retrySummaryJobFailed(jobId, trigger) {
  markSummaryTriggerPending(trigger, '正在重新排队…');
  toast('正在把失败的部分放回后台…');
  api('api/summaries/jobs/' + encodeURIComponent(jobId) + '/retry-failed', { method: 'POST' }).then(function (res) {
    if (!res.ok) {
      restoreSummaryTrigger(trigger);
      if (res.job) { loadSummaryJobs(); toast(res.error || '重新生成失败'); }
      else toast(res.error || '重新生成失败');
      return;
    }
    toast('失败的部分已经放进后台了，马上重做');
    summaryJobWasActive = true;
    loadSummaryJobs();
  }).catch(function () {
    restoreSummaryTrigger(trigger);
    toast('重新生成失败，稍后再试');
  });
}

// 取消重做：收起这次失败提示，保留旧页面和任务记录。
// 本地先记一笔「这条已经取消」，避免提示卡被下一轮轮询的旧数据重新顶出来。
var locallyCancelledSummaryJobs = {};
var locallyDismissedSummaryJobs = {};
var lastSummaryJobs = [];
function cancelSummaryJobLocally(jobId) {
  if (jobId) locallyCancelledSummaryJobs[String(jobId)] = true;
}
function cancelSummaryJobRetry(jobId, trigger) {
  markSummaryTriggerPending(trigger, '正在收起…');
  api('api/summaries/jobs/' + encodeURIComponent(jobId) + '/cancel-retry', { method: 'POST' }).then(function (res) {
    if (!res.ok) {
      restoreSummaryTrigger(trigger);
      toast(res.error || '取消重做失败');
      return;
    }
    toast('这次重做已取消，已有页面保留');
    cancelSummaryJobLocally(jobId);
    // 先用手上这份列表重画一次，提示卡立即收起；再拉一次跟后端对齐。
    renderSummaryJobs(lastSummaryJobs);
    loadSummaryJobs();
  }).catch(function () {
    restoreSummaryTrigger(trigger);
    toast('取消重做失败，稍后再试');
  });
}

// 知道了：确认收下这本册子。
// 先本地收起再发接口：以前是等两趟来回（确认 + 重新拉列表）才消失，点了要等好一会。
// 接口真失败就把框放回来，不制造假象。
function dismissSummaryJob(jobId) {
  var key = String(jobId || '');
  locallyDismissedSummaryJobs[key] = true;
  renderSummaryJobs(lastSummaryJobs);
  api('api/summaries/jobs/' + encodeURIComponent(jobId) + '/dismiss', { method: 'POST' }).then(function (res) {
    if (!res.ok) {
      delete locallyDismissedSummaryJobs[key];
      renderSummaryJobs(lastSummaryJobs);
      toast(res.error || '确认失败');
      return;
    }
    loadSummaryJobs();
  }).catch(function () {
    delete locallyDismissedSummaryJobs[key];
    renderSummaryJobs(lastSummaryJobs);
    toast('确认失败，稍后再试');
  });
}

function loadSummaryJobs() {
  api('api/summaries/jobs').then(function (res) {
    if (!res.ok) return;
    var active = !!res.active;
    var justFinished = summaryJobWasActive && !active;
    summaryJobWasActive = active;
    renderSummaryJobs(res.jobs || [], res.autoRetry);
    if (summaryJobsTimer) { clearTimeout(summaryJobsTimer); summaryJobsTimer = null; }
    if (justFinished) {
      loadSummaries(true);
      loadMonth();
      if (selectedDate) selectDay(selectedDate);
    }
    if (active) {
      summaryJobsTimer = setTimeout(function () { summaryJobsTimer = null; loadSummaryJobs(); }, 1200);
    } else if (res.autoRetry && res.autoRetry.active && res.autoRetry.level === 'cooldown') {
      // 冷却中的自动整理会自己再试一次，慢轮询等它落定，卡片才能自己换成结果。
      summaryJobsTimer = setTimeout(function () { summaryJobsTimer = null; loadSummaryJobs(); }, 45000);
    }
  }).catch(function () {
    if (summaryJobWasActive && !summaryJobsTimer) summaryJobsTimer = setTimeout(function () { summaryJobsTimer = null; loadSummaryJobs(); }, 2000);
  });
}

function toggleSummaryBatchMode(force) {
  var next = typeof force === 'boolean' ? force : !summarySelectMode;
  summarySelectMode = next;
  var panel = document.getElementById('summary-batch-panel');
  var toggle = document.getElementById('summary-batch-toggle');
  var detail = document.getElementById('detail');
  if (panel) panel.classList.toggle('hidden', !next);
  if (toggle) toggle.textContent = next ? '退出多选' : '选几天做成册';
  if (detail) detail.classList.toggle('hidden', next || !selectedDate);
  if (!next) {
    summaryBatchDates = [];
    var msg = document.getElementById('summary-batch-msg');
    if (msg) msg.textContent = '';
  }
  syncSelectedCellState();
  renderSummaryBatchDates();
  loadMonth();
}

function renderSummaryBatchDates() {
  var box = document.getElementById('summary-batch-dates');
  var count = document.getElementById('summary-batch-count');
  var run = document.getElementById('summary-batch-run-btn');
  if (count) count.textContent = '已选 ' + summaryBatchDates.length + ' 天';
  if (run) run.disabled = !summaryBatchDates.length;
  syncPartnerMoodBackfillButton();
  if (!box) return;
  if (!summaryBatchDates.length) {
    box.className = 'summary-batch-dates empty';
    box.textContent = '还没选日期';
    return;
  }
  box.className = 'summary-batch-dates';
  box.innerHTML = summaryBatchDates.map(function (date) {
    return '<span class="summary-batch-chip">' + esc(date) + '<button type="button" title="移除" onclick="removeSummaryBatchDate(' + jsArg(date) + ')">×</button></span>';
  }).join('');
}

function toggleSummaryBatchDate(date) {
  if (!summarySelectMode) return;
  var index = summaryBatchDates.indexOf(date);
  if (index >= 0) summaryBatchDates.splice(index, 1);
  else if (summaryBatchDates.length >= 31) {
    var msg = document.getElementById('summary-batch-msg');
    if (msg) msg.textContent = '一次最多选 31 天';
    return;
  } else summaryBatchDates.push(date);
  summaryBatchDates.sort();
  var msg = document.getElementById('summary-batch-msg');
  if (msg) msg.textContent = '';
  syncSelectedCellState();
  renderSummaryBatchDates();
  loadMonth();
}

function removeSummaryBatchDate(date) {
  summaryBatchDates = summaryBatchDates.filter(function (item) { return item !== date; });
  syncSelectedCellState();
  renderSummaryBatchDates();
  loadMonth();
}

function clearSummaryBatchDates() {
  summaryBatchDates = [];
  syncSelectedCellState();
  renderSummaryBatchDates();
  var msg = document.getElementById('summary-batch-msg');
  if (msg) msg.textContent = '';
  if (summarySelectMode) loadMonth();
}

function markSummaryTriggerPending(trigger, text) {
  if (!trigger) return;
  trigger.dataset.summaryOriginalText = trigger.textContent;
  trigger.disabled = true;
  trigger.textContent = text;
  trigger.setAttribute('aria-busy', 'true');
}

function restoreSummaryTrigger(trigger) {
  if (!trigger) return;
  trigger.disabled = false;
  trigger.textContent = trigger.dataset.summaryOriginalText || trigger.textContent;
  trigger.removeAttribute('aria-busy');
  delete trigger.dataset.summaryOriginalText;
}

function queueSummaryDates(dates, messageEl, clearBatch, trigger) {
  var values = Array.from(new Set((dates || []).filter(Boolean))).sort();
  if (!values.length) {
    restoreSummaryTrigger(trigger);
    if (messageEl) messageEl.textContent = '先选一天'; else toast('先选一天');
    return;
  }
  markSummaryTriggerPending(trigger, '正在放到后台…');
  var pendingText = values.length > 1 ? '正在把这几页放到后台…' : '正在把这一页放到后台…';
  if (messageEl) messageEl.textContent = pendingText;
  else toast(pendingText);
  api('api/summaries/jobs', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ dates: values, force: true }),
  }).then(function (res) {
    if (!res.ok) {
      restoreSummaryTrigger(trigger);
      if (messageEl) messageEl.textContent = res.error || '后台任务没建成'; else toast(res.error || '后台任务没建成');
      return;
    }
    var successText = values.length > 1 ? '这几页已放到后台做成册' : '这一页已放到后台做好';
    if (clearBatch) toggleSummaryBatchMode(false);
    if (messageEl && !clearBatch) messageEl.textContent = successText;
    if (!messageEl || clearBatch) toast(successText);
    if (res.job) renderSummaryJobs([res.job]);
    loadSummaryJobs();
  }).catch(function () {
    restoreSummaryTrigger(trigger);
    if (messageEl) messageEl.textContent = '后台任务没建成，稍后再试';
    else toast('后台任务没建成，稍后再试');
  });
}

function runSummaryBatch() {
  queueSummaryDates(summaryBatchDates, document.getElementById('summary-batch-msg'), true);
}

// ── 伙伴心情历史补档（独立于做成册，只收际遇线）──

function syncPartnerMoodBackfillButton() {
  var btn = document.getElementById('partner-mood-backfill-btn');
  if (!btn) return;
  var enabled = appSettings.partnerMoodEnabled === true;
  btn.classList.toggle('hidden', !enabled || !summarySelectMode);
  btn.disabled = !summaryBatchDates.length;
}

function runPartnerMoodBackfill() {
  var dates = Array.from(new Set((summaryBatchDates || []).filter(Boolean))).sort();
  if (!dates.length) { toast('先选一天'); return; }
  toast('正在把伙伴心情补档放到后台…');
  api('api/partner-moods/backfill', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ dates: dates }),
  }).then(function (res) {
    if (!res.ok) { toast(res.error || '补档任务没建成'); return; }
    partnerMoodJobWasActive = true;
    toggleSummaryBatchMode(false);
    toast('已放到后台补档，跑完会提示你');
    loadPartnerMoodJobs();
  }).catch(function () { toast('补档任务没建成，稍后再试'); });
}

function partnerMoodJobStatusText(status) {
  return ({ queued: '排队中', running: '正在补伙伴心情', completed: '补完啦', completed_with_errors: '有几天没补上', failed: '这次没补成' })[status] || '补档中';
}

function renderPartnerMoodJobs(jobs) {
  var box = document.getElementById('partner-mood-jobs-calendar');
  if (!box) return;
  var list = Array.isArray(jobs) ? jobs : [];
  var visible = list.filter(function (item) { return !(item.status === 'completed' && item.dismissedAt); });
  var job = visible.find(function (item) { return item.status === 'queued' || item.status === 'running'; }) || visible[0];
  if (!job) {
    box.classList.add('hidden');
    box.innerHTML = '';
    return;
  }
  var progress = job.progress || {};
  var done = Number(progress.done || 0);
  var total = Number(progress.total || (job.dates || []).length || 0);
  var percent = total ? Math.max(0, Math.min(100, Math.round(done * 100 / total))) : 0;
  var detail = '共 ' + total + ' 天，已补 ' + done + ' 天';
  if (job.currentDate) detail += ' · 正在补 ' + job.currentDate;
  var foot = '';
  if (job.status === 'completed_with_errors') {
    detail += '，' + (job.failed || 0) + ' 天没补上';
    foot = '<div class="summary-job-error">' + esc(job.error || '有几天没补上，可以重新选那几天再补') + '</div>' +
      '<button type="button" class="btn" onclick="dismissPartnerMoodJob(' + jsArg(job.id) + ')">知道了</button>';
  } else if (job.status === 'completed') {
    foot = '<button type="button" class="btn" onclick="dismissPartnerMoodJob(' + jsArg(job.id) + ')">知道了</button>';
  }
  box.innerHTML = '<div class="summary-job-head"><span>伙伴心情补档</span><span class="summary-job-status">' + esc(partnerMoodJobStatusText(job.status)) + '</span></div>' +
    '<div class="summary-job-track"><div class="summary-job-progress" style="width:' + percent + '%"></div></div>' +
    '<div class="summary-job-detail">' + esc(detail) + '</div>' + foot;
  box.classList.remove('hidden');
}

function loadPartnerMoodJobs() {
  api('api/partner-moods-jobs').then(function (res) {
    if (!res.ok) return;
    var active = !!res.active;
    var justFinished = partnerMoodJobWasActive && !active;
    partnerMoodJobWasActive = active;
    renderPartnerMoodJobs(res.jobs || []);
    if (partnerMoodJobsTimer) { clearTimeout(partnerMoodJobsTimer); partnerMoodJobsTimer = null; }
    if (justFinished) toast('伙伴心情补档跑完了，去心情线看看吧 ✿');
    if (active) partnerMoodJobsTimer = setTimeout(function () { partnerMoodJobsTimer = null; loadPartnerMoodJobs(); }, 1500);
  }).catch(function () { partnerMoodJobWasActive = false; });
}

function dismissPartnerMoodJob(jobId) {
  api('api/partner-moods-jobs/' + encodeURIComponent(jobId) + '/dismiss', { method: 'POST' }).then(function (res) {
    if (!res.ok) { toast(res.error || '确认失败'); return; }
    loadPartnerMoodJobs();
  }).catch(function () { toast('确认失败，稍后再试'); });
}

function editSummary(date, agentId) {
  var key = summaryDomKey(date, agentId);
  var textEl = document.getElementById('archive-text-' + key);
  if (!textEl) return;
  var current = textEl.textContent;
  // 编辑态：把原来的操作按钮（修改/编辑/和小花聊聊/删除）隐藏，只留编辑框 + 保存/取消
  var ops = textEl.nextElementSibling;
  if (ops && ops.classList && ops.classList.contains('archive-actions')) ops.style.display = 'none';
  textEl.innerHTML = '<textarea class="archive-editor" id="archive-editor-' + key + '">' + esc(current) + '</textarea>' +
    '<div class="archive-actions"><button onclick="saveSummaryEdit(' + jsArgs(date, agentId) + ')">保存修改</button>' +
    '<button onclick="cancelSummaryEdit()">取消</button></div>';
}

function saveSummaryEdit(date, agentId) {
  var editor = document.getElementById('archive-editor-' + summaryDomKey(date, agentId));
  var text = editor ? editor.value.trim() : '';
  if (!text) { toast('这一页的内容不能为空'); return; }
  applySummaryText(date, agentId, text);
}

function cancelSummaryEdit() {
  // 详情区块（这一页）有选中日期 → 重新渲染这一天；否则在时光册里 → 重新加载列表
  if (selectedDate) selectDay(selectedDate);
  else loadSummaries();
}

var summaryChatDate = '';
var summaryChatAgentId = '';
var summaryChatAgentName = '';
var summaryChatOriginal = '';
var summaryChatSessionId = '';
var summaryChatSuggestion = '';
var summaryChatRun = 0;
var summaryChatReturnFocus = null;

function appendSummaryChatBubble(role, text) {
  var messages = document.getElementById('summary-chat-messages');
  if (!messages) return null;
  var bubble = document.createElement('div');
  bubble.className = 'summary-chat-bubble ' + role;
  bubble.textContent = text;
  messages.appendChild(bubble);
  messages.scrollTop = messages.scrollHeight;
  return bubble;
}

function openSummaryChat(date, agentId, agentName) {
  var key = summaryDomKey(date, agentId);
  var textEl = document.getElementById('archive-text-' + key);
  if (!textEl) return;
  summaryChatReturnFocus = document.activeElement;
  summaryChatRun += 1;
  summaryChatDate = date;
  summaryChatAgentId = agentId || '';
  summaryChatAgentName = agentName || '未分类的一页';
  summaryChatOriginal = textEl.textContent;
  summaryChatSessionId = '';
  summaryChatSuggestion = '';
  document.getElementById('summary-chat-subtitle').textContent = date + ' · ' + summaryChatAgentName;
  document.getElementById('summary-chat-original').textContent = summaryChatOriginal;
  document.getElementById('summary-chat-messages').innerHTML = '';
  document.getElementById('summary-chat-input').value = '';
  document.getElementById('summary-chat-before').textContent = '';
  document.getElementById('summary-chat-after').textContent = '';
  document.getElementById('summary-chat-suggestion').hidden = true;
  var send = document.getElementById('summary-chat-send');
  send.disabled = false;
  send.textContent = '发送';
  var confirm = document.getElementById('summary-chat-confirm');
  confirm.disabled = false;
  confirm.textContent = '确认修改';
  document.getElementById('summary-chat-modal').hidden = false;
  appendSummaryChatBubble('assistant', '你想把这一页哪里改一改？直接和我说就好。我们聊清楚后，我再整理成修改建议给你确认。');
  setTimeout(function () { document.getElementById('summary-chat-input').focus(); }, 80);
}

function sendSummaryChat() {
  var input = document.getElementById('summary-chat-input');
  var message = input ? input.value.trim() : '';
  if (!message) return;
  var run = summaryChatRun;
  summaryChatSuggestion = '';
  document.getElementById('summary-chat-suggestion').hidden = true;
  appendSummaryChatBubble('user', message);
  input.value = '';
  var send = document.getElementById('summary-chat-send');
  send.disabled = true;
  send.textContent = '想一想…';
  var thinking = appendSummaryChatBubble('thinking', '小花正在认真看这一页…');
  api('api/summaries/' + summaryChatDate + '/revise', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message: message, agentId: summaryChatAgentId, session_id: summaryChatSessionId }),
  }).then(function (res) {
    if (run !== summaryChatRun) return;
    if (thinking) thinking.remove();
    if (!res.ok) { appendSummaryChatBubble('error', res.error || '这轮没聊成，稍后再试'); return; }
    summaryChatSessionId = res.session_id || summaryChatSessionId;
    appendSummaryChatBubble('assistant', res.reply || '我在听。');
    if (res.suggestion) renderSummaryChatSuggestion(res.suggestion, res.original || summaryChatOriginal);
  }).catch(function () {
    if (run !== summaryChatRun) return;
    if (thinking) thinking.remove();
    appendSummaryChatBubble('error', '刚才没连上，再发一次就好。');
  }).finally(function () {
    if (run !== summaryChatRun) return;
    send.disabled = false;
    send.textContent = '发送';
    input.focus();
  });
}

function renderSummaryChatSuggestion(suggestion, original) {
  summaryChatSuggestion = suggestion || '';
  document.getElementById('summary-chat-before').textContent = original || summaryChatOriginal;
  document.getElementById('summary-chat-after').textContent = summaryChatSuggestion;
  document.getElementById('summary-chat-suggestion').hidden = false;
}

function continueSummaryChat() {
  summaryChatSuggestion = '';
  document.getElementById('summary-chat-suggestion').hidden = true;
  document.getElementById('summary-chat-input').focus();
  document.getElementById('summary-chat-messages').scrollTop = document.getElementById('summary-chat-messages').scrollHeight;
}

function confirmSummaryChat() {
  if (!summaryChatSessionId || !summaryChatSuggestion) return;
  var run = summaryChatRun;
  var button = document.getElementById('summary-chat-confirm');
  button.disabled = true;
  button.textContent = '保存中…';
  api('api/summaries/' + summaryChatDate + '/revise/confirm', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ session_id: summaryChatSessionId, agentId: summaryChatAgentId }),
  }).then(function (res) {
    if (run !== summaryChatRun) return;
    if (!res.ok) { appendSummaryChatBubble('error', res.error || '修改没有保存'); return; }
    toast('这一页改好了');
    closeSummaryChat(false);
    loadSummaries();
    if (selectedDate) selectDay(selectedDate);
  }).catch(function () {
    if (run === summaryChatRun) appendSummaryChatBubble('error', '保存时断开了，再点一次确认就好。');
  }).finally(function () {
    if (run !== summaryChatRun) return;
    button.disabled = false;
    button.textContent = '确认修改';
  });
}

function closeSummaryChat(notifyServer) {
  var date = summaryChatDate;
  var agentId = summaryChatAgentId;
  var sessionId = summaryChatSessionId;
  var returnFocus = summaryChatReturnFocus;
  summaryChatRun += 1;
  document.getElementById('summary-chat-modal').hidden = true;
  summaryChatDate = '';
  summaryChatAgentId = '';
  summaryChatAgentName = '';
  summaryChatOriginal = '';
  summaryChatSessionId = '';
  summaryChatSuggestion = '';
  summaryChatReturnFocus = null;
  if (returnFocus && returnFocus.isConnected && typeof returnFocus.focus === 'function') returnFocus.focus();
  if (notifyServer !== false && date && sessionId) {
    api('api/summaries/' + date + '/revise/close', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ session_id: sessionId, agentId: agentId }),
    }).catch(function () {});
  }
}

document.getElementById('summary-chat-input').addEventListener('keydown', function (event) {
  if (event.key === 'Enter' && !event.shiftKey) {
    event.preventDefault();
    if (!document.getElementById('summary-chat-send').disabled) sendSummaryChat();
  }
});

document.getElementById('summary-chat-modal').addEventListener('keydown', function (event) {
  if (event.key !== 'Tab' || this.hidden) return;
  var nodes = Array.from(this.querySelectorAll('button:not([disabled]), textarea:not([disabled]), summary, [tabindex]:not([tabindex="-1"])'));
  if (!nodes.length) return;
  var first = nodes[0];
  var last = nodes[nodes.length - 1];
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
  }
});

function applySummaryText(date, agentId, text) {
  var key = summaryDomKey(date, agentId);
  api('api/summaries/' + date, {
    method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text: text, agentId: agentId || '' }),
  }).then(function (res) {
    if (res.ok) {
      toast('这一页改好了');
      loadSummaries();
      // 详情区块（这一页）也在展示时同步刷新，让改动立刻可见
      if (selectedDate) selectDay(selectedDate);
    }
    else toast(res.error || '没存上');
  });
}

function deleteSummary(date, agentId, agentName) {
  askConfirm('要删除 ' + date + ' 的「' + (agentName || '这一页') + '」吗？', function () {
    var query = '?agentId=' + encodeURIComponent(agentId || '');
    api('api/summaries/' + date + query, { method: 'DELETE' }).then(function (res) {
      if (res.ok) { toast('这一页删掉了'); loadSummaries(); }
      else toast(res.error || '没删掉');
    });
  });
}

/* ── 设置弹窗 ── */
function openSettingsModal() {
  document.getElementById('set-modal').hidden = false;
  loadSettings();
  // 设置里那块「从插件版搬数据」每次打开都对一次现状
  checkLegacyMigration();
}
function closeSettingsModal() {
  document.getElementById('set-modal').hidden = true;
}
document.addEventListener('keydown', function (e) {
  if (e.key === 'Escape') {
    var confirmModal = document.getElementById('confirm-modal');
    if (confirmModal && !confirmModal.hidden) { closeConfirm(); return; }
    var summaryChatModal = document.getElementById('summary-chat-modal');
    if (summaryChatModal && !summaryChatModal.hidden) { closeSummaryChat(); return; }
    var modal = document.getElementById('set-modal');
    if (modal && !modal.hidden) closeSettingsModal();
  }
});

var MODE_LABELS = {
  economical: '适时',
  balanced: '相伴',
  always: '常在',
};
var MODE_TIPS = {
  economical: '新对话、跨天或拾光记内容变化时带一次，平时不重复打扰。',
  balanced: '两次说话之间空档达到下方时长，回来时带一次。',
  always: '你每次开口时都带上今日情境，陪伴感最完整。',
};
var MOOD_DISCOVERY_TIPS = {
  off: '不再自动发现情绪，手动记下的心情照常保留。',
  economical: '只看有明显情绪字眼的日子，较少打扰，但可能漏掉没说出口的情绪。',
  detailed: '每天看完整可见对话，发现更全面；存疑时再谨慎复核。',
};

function syncMoodDiscoveryTip(mode) {
  var tip = document.getElementById('mood-discovery-tip');
  if (tip) tip.textContent = MOOD_DISCOVERY_TIPS[mode] || '';
}

function segVal(segId) {
  var b = document.querySelector('#' + segId + ' .seg-btn.active');
  if (!b) return '';
  return b.getAttribute('data-val') || b.getAttribute('data-mode');
}

function setSeg(segId, val) {
  document.querySelectorAll('#' + segId + ' .seg-btn').forEach(function (b) {
    var v = b.getAttribute('data-val') || b.getAttribute('data-mode');
    b.classList.toggle('active', String(v) === String(val));
  });
}

function updateQuickInjectionToggle() {
  var btn = document.getElementById('context-toggle-btn');
  if (btn) {
    var enabled = appSettings.injectionEnabled !== false;
    btn.textContent = enabled ? '聊天情境·开' : '聊天情境·关';
    btn.classList.toggle('off', !enabled);
    btn.setAttribute('aria-pressed', enabled ? 'true' : 'false');
  }
  // Code 页那个开关单独一面，主页上两个按钮各管各的。
  var codeBtn = document.getElementById('code-context-toggle-btn');
  if (codeBtn) {
    var codeOn = appSettings.codeInjectionEnabled !== false;
    codeBtn.textContent = codeOn ? 'Code 情境·开' : 'Code 情境·关';
    codeBtn.classList.toggle('off', !codeOn);
    codeBtn.setAttribute('aria-pressed', codeOn ? 'true' : 'false');
  }
}

function syncInjectionUi(enabled) {
  var active = enabled !== false;
  var options = document.getElementById('injection-options');
  var disabledTip = document.getElementById('injection-disabled-tip');
  if (options) options.classList.toggle('hidden', !active);
  if (disabledTip) disabledTip.classList.toggle('hidden', active);
}

/* ── Code 页那一套：模式开关 + 总闸 + 项目清单 ── */
var CODE_ITEM_FALLBACK = [
  { id: 'peak', label: '峰谷关照' },
  { id: 'weather', label: '窗外天气' },
  { id: 'special', label: '今天是什么日子' },
  { id: 'todos', label: '今日待办' },
  { id: 'archive', label: '近期动态' },
  { id: 'xingji', label: '拾性的做法' }
];
var codeInjectionItemOptions = CODE_ITEM_FALLBACK.slice();

function renderCodeInjectionItems(items) {
  var box = document.getElementById('code-injection-items');
  if (!box) return;
  var list = codeInjectionItemOptions.length ? codeInjectionItemOptions : CODE_ITEM_FALLBACK;
  var on = items && typeof items === 'object' ? items : {};
  box.innerHTML = list.map(function (item) {
    // 没存过这项时按后端默认：峰谷开，其余关。
    var checked = item.id === 'peak' ? on.peak !== false : on[item.id] === true;
    return '<label class="summary-agent-option"><input type="checkbox" class="code-injection-check" data-item-id="' +
      esc(item.id) + '"' + (checked ? ' checked' : '') + '><span>' + esc(item.label) + '</span></label>';
  }).join('');
}

function codeInjectionItemsFromUI() {
  var out = {};
  document.querySelectorAll('.code-injection-check').forEach(function (check) {
    out[check.getAttribute('data-item-id')] = !!check.checked;
  });
  return out;
}

var contextMode = 'chat';

function syncContextModeUi(mode) {
  contextMode = mode === 'code' ? 'code' : 'chat';
  var isCode = contextMode === 'code';
  var chatPanel = document.getElementById('context-panel-chat');
  var codePanel = document.getElementById('context-panel-code');
  if (chatPanel) chatPanel.classList.toggle('hidden', isCode);
  if (codePanel) codePanel.classList.toggle('hidden', !isCode);
  var panel = document.getElementById('context-mode-panel');
  if (panel) panel.setAttribute('data-mode', contextMode);
  var note = document.getElementById('context-mode-note');
  if (note) {
    note.setAttribute('data-mode', contextMode);
    note.textContent = isCode
      ? 'Code 页：只按勾选的带，默认只有时间和峰谷；关掉总闸就一个字都不带。'
      : '聊天窗口：日子、天气、待办和峰谷按下面这套带。';
  }
  var seg = document.getElementById('context-mode-seg');
  if (seg) {
    seg.querySelectorAll('.seg-btn').forEach(function (btn) {
      btn.setAttribute('aria-selected', btn.getAttribute('data-mode') === contextMode ? 'true' : 'false');
    });
  }
}

function syncCodePanelUi(injectionOn) {
  var on = injectionOn !== false;
  var offTip = document.getElementById('code-injection-off-tip');
  if (offTip) offTip.classList.toggle('hidden', on);
  // 总闸关着时项目就不用让人点了，先灰掉，免得白勾。
  document.querySelectorAll('.code-injection-check').forEach(function (check) { check.disabled = !on; });
}
function toggleInjectionQuick() {
  var next = appSettings.injectionEnabled === false;
  var btn = document.getElementById('context-toggle-btn');
  if (btn) btn.disabled = true;
  api('api/settings', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ injectionEnabled: next }),
  }).then(function (res) {
    if (!res.ok) { toast(res.error || '情境开关没改成'); return; }
    appSettings = Object.assign(appSettings, res.settings || { injectionEnabled: next });
    setSeg('injection-enabled-seg', appSettings.injectionEnabled !== false);
    syncInjectionUi(appSettings.injectionEnabled !== false);
    updateQuickInjectionToggle();
    toast(appSettings.injectionEnabled === false ? '已关掉聊天情境，Code 页不受影响' : '聊天窗口会收到今日情境了');
  }).catch(function () {
    toast('情境开关没改成，检查一下连接');
  }).then(function () {
    if (btn) btn.disabled = false;
  });
}

function toggleCodeInjectionQuick() {
  var next = appSettings.codeInjectionEnabled === false;
  var btn = document.getElementById('code-context-toggle-btn');
  if (btn) btn.disabled = true;
  api('api/settings', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ codeInjectionEnabled: next }),
  }).then(function (res) {
    if (!res.ok) { toast(res.error || 'Code 页开关没改成'); return; }
    appSettings = Object.assign(appSettings, res.settings || { codeInjectionEnabled: next });
    setSeg('code-injection-seg', appSettings.codeInjectionEnabled !== false);
    syncCodePanelUi(appSettings.codeInjectionEnabled !== false);
    updateQuickInjectionToggle();
    toast(appSettings.codeInjectionEnabled === false ? '已关掉 Code 页注入，聊天那边不受影响' : 'Code 页会收到时间和峰谷了');
  }).catch(function () {
    toast('Code 页开关没改成，检查一下连接');
  }).then(function () {
    if (btn) btn.disabled = false;
  });
}

function syncWeatherSettingsUi(enabled) {
  var active = enabled !== false;
  ['weather-province', 'weather-city', 'weather-district'].forEach(function (id) {
    setWeatherSelectDisabled(id, !active);
  });
  var clear = document.querySelector('.weather-clear-btn');
  if (clear) clear.disabled = !active;
  var test = document.getElementById('weather-test-btn');
  if (test) test.disabled = !active;
  // 天气本身关了，预报也就没了，提醒跟着一起停。
  var alertBtns = document.querySelectorAll('#weather-alert-seg .seg-btn');
  for (var i = 0; i < alertBtns.length; i++) alertBtns[i].disabled = !active;
  if (!active) {
    var msg = document.getElementById('weather-test-msg');
    if (msg) msg.textContent = '';
  }
}

function setWeatherSelectDisabled(id, disabled) {
  var sel = document.getElementById(id);
  if (!sel) return;
  sel.disabled = !!disabled;
  var wrap = sel.closest ? sel.closest('.dd') : null;
  if (wrap) {
    wrap.classList.toggle('disabled', !!disabled);
    var trigger = wrap.querySelector('.dd-trigger');
    if (trigger) trigger.disabled = !!disabled;
  }
}

function setWeatherSelectOptions(id, placeholder, options, disabled) {
  var sel = document.getElementById(id);
  if (!sel) return;
  var html = '<option value="">' + esc(placeholder) + '</option>';
  (options || []).forEach(function (option) {
    html += '<option value="' + esc(option.value) + '">' + esc(option.label) + '</option>';
  });
  sel.innerHTML = html;
  setWeatherSelectDisabled(id, disabled);
  refreshOneSelect(id);
}

function uniqueWeatherOptions(items, key) {
  var seen = {};
  var result = [];
  (items || []).forEach(function (item) {
    var value = String(item[key] || '');
    if (!value || seen[value]) return;
    seen[value] = true;
    result.push({ value: value, label: value });
  });
  return result;
}

function weatherRegionByCode(code) {
  var wanted = String(code || '');
  if (!wanted) return null;
  for (var i = 0; i < weatherRegions.length; i++) {
    if (String(weatherRegions[i].code) === wanted) return weatherRegions[i];
  }
  return null;
}

function weatherRegionLabel(region) {
  if (!region) return '';
  return [region.province, region.city, region.district].filter(Boolean).join(' ');
}

function setWeatherLegacyNote(text) {
  var note = document.getElementById('weather-legacy-note');
  if (!note) return;
  note.textContent = text || '';
  note.classList.toggle('hidden', !text);
}

function populateWeatherProvinces(selectedProvince) {
  var provinceSelect = document.getElementById('weather-province');
  var options = uniqueWeatherOptions(weatherRegions, 'province');
  setWeatherSelectOptions('weather-province', '选择省份', options, false);
  if (selectedProvince && options.some(function (item) { return item.value === selectedProvince; })) {
    provinceSelect.value = selectedProvince;
  } else {
    provinceSelect.value = '';
  }
  refreshOneSelect('weather-province');
  populateWeatherCities(provinceSelect.value, '', '');
}

function populateWeatherCities(province, selectedCity, selectedCode) {
  var citySelect = document.getElementById('weather-city');
  var regions = weatherRegions.filter(function (region) { return region.province === province; });
  var options = uniqueWeatherOptions(regions, 'city');
  setWeatherSelectOptions('weather-city', province ? '选择城市' : '先选省份', options, !province);
  if (selectedCity && options.some(function (item) { return item.value === selectedCity; })) {
    citySelect.value = selectedCity;
  } else {
    citySelect.value = '';
  }
  refreshOneSelect('weather-city');
  populateWeatherDistricts(province, citySelect.value, selectedCode || '');
}

function populateWeatherDistricts(province, city, selectedCode) {
  var districtSelect = document.getElementById('weather-district');
  var regions = weatherRegions.filter(function (region) {
    return region.province === province && region.city === city;
  });
  var options = regions.map(function (region) {
    return { value: String(region.code), label: region.district };
  });
  setWeatherSelectOptions('weather-district', city ? '选择区县' : '先选城市', options, !city);
  if (selectedCode && options.some(function (item) { return item.value === String(selectedCode); })) {
    districtSelect.value = String(selectedCode);
  } else {
    districtSelect.value = '';
  }
  refreshOneSelect('weather-district');
}

function selectedWeatherRegion() {
  var district = document.getElementById('weather-district');
  return district ? weatherRegionByCode(district.value) : null;
}

function renderWeatherRegion(area, rawLocation) {
  weatherSettingsState = { location: String(rawLocation || '').trim(), area: area || null };
  weatherSelectionTouched = false;
  if (!weatherRegions.length) {
    setWeatherLegacyNote(rawLocation ? '区县列表还没加载好，原地点会保留；重新打开设置再选。' : '区县列表加载中…');
    return;
  }
  var target = area && weatherRegionByCode(area.code);
  if (target) {
    populateWeatherProvinces(target.province);
    populateWeatherCities(target.province, target.city, target.code);
    setWeatherLegacyNote('');
    return;
  }
  populateWeatherProvinces('');
  if (rawLocation) {
    setWeatherLegacyNote('原来保存的地点是「' + rawLocation + '」，请重新选到区县；在你保存前它会继续保留。');
  } else {
    setWeatherLegacyNote('');
  }
}

function loadWeatherRegions() {
  if (weatherRegions.length) return Promise.resolve(weatherRegions);
  if (weatherRegionsPromise) return weatherRegionsPromise;
  weatherRegionsPromise = api('api/weather/regions').then(function (res) {
    if (!res.ok || !Array.isArray(res.regions)) throw new Error(res.error || '区县列表加载失败');
    weatherRegions = res.regions;
    return weatherRegions;
  }).catch(function (error) {
    weatherRegionsPromise = null;
    setWeatherLegacyNote(error.message || '区县列表加载失败，稍后再试');
    return [];
  });
  return weatherRegionsPromise;
}

function renderInjectionAgents(agents, disabledIds) {
  var picker = document.getElementById('injection-agent-picker');
  injectionAgentSelectionLoaded = true;
  if (!picker) return;
  var available = Array.isArray(agents) ? agents.filter(function (agent) { return agent && agent.agentId; }) : [];
  if (!available.length) {
    picker.innerHTML = '<span class="set-tip">还没有可设置的伙伴。</span>';
    return;
  }
  var disabled = new Set(Array.isArray(disabledIds) ? disabledIds.map(String) : []);
  var options = available.map(function (agent) {
    var id = String(agent.agentId);
    var name = String(agent.agentName || id);
    return '<label class="summary-agent-option"><input type="checkbox" class="injection-agent-check" data-agent-id="' + esc(id) + '"' + (disabled.has(id) ? ' checked' : '') + '><span title="' + esc(name) + '">' + esc(name) + '</span></label>';
  }).join('');
  picker.innerHTML = '<div class="summary-agent-options">' + options + '</div>';
}

function getInjectionDisabledAgentIdsFromUI() {
  if (!injectionAgentSelectionLoaded) return undefined;
  return Array.from(document.querySelectorAll('.injection-agent-check:checked')).map(function (check) {
    return check.getAttribute('data-agent-id') || '';
  }).filter(Boolean);
}

function renderSummaryAgents(agents, selectedIds) {
  var picker = document.getElementById('summary-agent-picker');
  summaryAgents = Array.isArray(agents) ? agents.filter(function (agent) { return agent && agent.agentId; }) : [];
  summaryAgentSelectionLoaded = true;
  if (!picker) return;
  if (!summaryAgents.length) {
    picker.innerHTML = '<span class="set-tip">还没有可做册的伙伴记录。</span>';
    return;
  }
  var selected = Array.isArray(selectedIds)
    ? new Set(selectedIds.map(function (id) { return String(id); }))
    : new Set(summaryAgents.map(function (agent) { return String(agent.agentId); }));
  var options = summaryAgents.map(function (agent) {
    var id = String(agent.agentId);
    var name = String(agent.agentName || id);
    return '<label class="summary-agent-option"><input type="checkbox" class="summary-agent-check" data-agent-id="' + esc(id) + '"' + (selected.has(id) ? ' checked' : '') + '><span title="' + esc(name) + '">' + esc(name) + '</span></label>';
  }).join('');
  picker.innerHTML = '<div class="summary-agent-options">' + options + '</div>' +
    '<div class="summary-agent-actions"><button class="link-btn" type="button" onclick="selectAllSummaryAgents()">全选</button>' +
    '<button class="link-btn" type="button" onclick="clearSummaryAgents()">全不选</button></div>';
}

function selectAllSummaryAgents() {
  document.querySelectorAll('.summary-agent-check').forEach(function (check) { check.checked = true; });
}

function clearSummaryAgents() {
  document.querySelectorAll('.summary-agent-check').forEach(function (check) { check.checked = false; });
}

function getSummaryAgentIdsFromUI() {
  if (!summaryAgentSelectionLoaded || !summaryAgents.length) return undefined;
  var selected = Array.from(document.querySelectorAll('.summary-agent-check:checked')).map(function (check) {
    return check.getAttribute('data-agent-id') || '';
  }).filter(Boolean);
  return selected.length === summaryAgents.length ? null : selected;
}

function loadSettings() {
  Promise.all([api('api/settings'), loadWeatherRegions()]).then(function (parts) {
    var res = parts[0];
    if (!res.ok) return;
    var s = res.settings;
    appSettings = Object.assign(appSettings, s);
    setSeg('injection-enabled-seg', s.injectionEnabled !== false);
    syncInjectionUi(s.injectionEnabled !== false);
    updateQuickInjectionToggle();
    setSeg('mode-seg', s.injectMode);
    setSeg('interval-seg', s.injectIntervalHours);
    setSeg('autosum-seg', s.autoSummary);
    setSeg('mood-discovery-seg', s.moodDiscoveryMode || 'economical');
    syncMoodDiscoveryTip(s.moodDiscoveryMode || 'economical');
    setSeg('partner-mood-seg', s.partnerMoodEnabled === true);
    setSeg('xingji-seg', s.xingjiEnabled === true);
  setSeg('xingji-inject-seg', s.xingjiInjectionEnabled === true);
    setSeg('peak-seg', s.deepseekPeakEnabled !== false);
    setSeg('code-injection-seg', s.codeInjectionEnabled !== false);
    codeInjectionItemOptions = Array.isArray(s.codeInjectionItemOptions) && s.codeInjectionItemOptions.length
      ? s.codeInjectionItemOptions
      : CODE_ITEM_FALLBACK.slice();
    renderCodeInjectionItems(s.codeInjectionItems);
    syncCodePanelUi(s.codeInjectionEnabled !== false);
    syncContextModeUi(contextMode);
    setSeg('summary-shared-seg', s.summaryShared === true);
    var boundary = document.getElementById('boundary-select');
    boundary.value = String(s.dayBoundaryHour == null ? 4 : s.dayBoundaryHour);
    refreshOneSelect('boundary-select');
    document.getElementById('mode-tip').textContent = MODE_TIPS[s.injectMode] || '';
    document.getElementById('mode-tip-row').classList.toggle('hidden', false);
    document.getElementById('interval-row').classList.toggle('hidden', s.injectMode !== 'balanced');
    // 注入间隔提示：解释「间隔 + 数据变化即时刷新」机制，避免用户以为改完要等半天
    var itip = document.getElementById('interval-tip');
    var irow = document.getElementById('interval-extra-row');
    if (itip && irow) {
      itip.textContent = '相伴指「两次说话之间的空档」；达到这里的时长，回来才刷新一次。中途新增日子、确认生理期、生成总结，下一条消息就会带上，不用等。';
      irow.classList.toggle('hidden', s.injectMode !== 'balanced');
    }
    setSeg('period-seg', s.showPeriod !== false);
    setSeg('weather-seg', s.weatherEnabled !== false);
    setSeg('weather-alert-seg', s.weatherAlertEnabled !== false);
    renderSummaryAgents(s.summaryAgents || [], s.summaryAgentIds);
    renderInjectionAgents(s.summaryAgents || [], s.injectionDisabledAgentIds);
    renderWeatherRegion(s.weatherArea || null, s.weatherLocation || '');
    syncWeatherSettingsUi(s.weatherEnabled !== false);
    weatherSettingsState.location = s.weatherLocation || '';
    renderThinkingWarn(s.thinkingUnstoppable, s.thinkingModelKey);
    loadModelConfig();
  });
}

function collectWeatherSettings() {
  if (!weatherSelectionTouched) {
    return {
      weatherLocation: weatherSettingsState.location || '',
      weatherArea: weatherSettingsState.area || null,
    };
  }
  var province = document.getElementById('weather-province').value;
  var city = document.getElementById('weather-city').value;
  var region = selectedWeatherRegion();
  if (!province && !city && !region) return { weatherLocation: '', weatherArea: null };
  if (!region) return { error: '还差最后一步，选到区县再保存嘛' };
  return {
    weatherLocation: weatherRegionLabel(region),
    weatherArea: {
      code: region.code,
      province: region.province,
      city: region.city,
      district: region.district,
      latitude: region.latitude,
      longitude: region.longitude,
    },
  };
}

function clearWeatherRegion() {
  weatherSelectionTouched = true;
  weatherSettingsState = { location: '', area: null };
  populateWeatherProvinces('');
  setWeatherLegacyNote('');
  document.getElementById('weather-test-msg').textContent = '';
}

function saveAllSettings() {
  var weatherPatch = collectWeatherSettings();
  if (weatherPatch.error) { toast(weatherPatch.error); return; }
  var body = Object.assign({
    injectionEnabled: segVal('injection-enabled-seg') !== 'false',
    injectionDisabledAgentIds: getInjectionDisabledAgentIdsFromUI(),
    injectMode: segVal('mode-seg'),
    injectIntervalHours: +segVal('interval-seg'),
    autoSummary: segVal('autosum-seg') === 'true',
    moodDiscoveryMode: segVal('mood-discovery-seg') || 'economical',
    partnerMoodEnabled: segVal('partner-mood-seg') === 'true',
    xingjiEnabled: segVal('xingji-seg') === 'true',
    xingjiInjectionEnabled: segVal('xingji-inject-seg') === 'true',
    deepseekPeakEnabled: segVal('peak-seg') !== 'false',
    codeInjectionEnabled: segVal('code-injection-seg') !== 'false',
    codeInjectionItems: codeInjectionItemsFromUI(),
    dayBoundaryHour: +document.getElementById('boundary-select').value,
    summaryShared: segVal('summary-shared-seg') === 'true',
    showPeriod: segVal('period-seg') === 'true',
    weatherEnabled: segVal('weather-seg') !== 'false',
    weatherAlertEnabled: segVal('weather-alert-seg') !== 'false',
  }, weatherPatch);
  var summaryAgentIds = getSummaryAgentIdsFromUI();
  if (summaryAgentIds !== undefined) body.summaryAgentIds = summaryAgentIds;
  api('api/settings', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }).then(function (res) {
    if (res.ok) {
      appSettings = Object.assign(appSettings, res.settings || body);
      weatherSettingsState = {
        location: (res.settings && res.settings.weatherLocation) || body.weatherLocation || '',
        area: (res.settings && res.settings.weatherArea) || body.weatherArea || null,
      };
      weatherSelectionTouched = false;
      setWeatherLegacyNote('');
      setSeg('injection-enabled-seg', appSettings.injectionEnabled !== false);
      renderInjectionAgents(appSettings.summaryAgents || [], appSettings.injectionDisabledAgentIds);
      setSeg('mood-discovery-seg', appSettings.moodDiscoveryMode || 'economical');
      syncMoodDiscoveryTip(appSettings.moodDiscoveryMode || 'economical');
      setSeg('partner-mood-seg', appSettings.partnerMoodEnabled === true);
      setSeg('xingji-seg', appSettings.xingjiEnabled === true);
      setSeg('xingji-inject-seg', appSettings.xingjiInjectionEnabled === true);
      setSeg('peak-seg', appSettings.deepseekPeakEnabled !== false);
      setSeg('code-injection-seg', appSettings.codeInjectionEnabled !== false);
      if (appSettings.codeInjectionItems) renderCodeInjectionItems(appSettings.codeInjectionItems);
      syncCodePanelUi(appSettings.codeInjectionEnabled !== false);
      syncContextModeUi(contextMode);
      setSeg('weather-seg', appSettings.weatherEnabled !== false);
      setSeg('weather-alert-seg', appSettings.weatherAlertEnabled !== false);
      syncInjectionUi(appSettings.injectionEnabled !== false);
      updateQuickInjectionToggle();
      syncWeatherSettingsUi(appSettings.weatherEnabled !== false);
      loadMonth(); loadToday();
      if (selectedDate) selectDay(selectedDate);
      if (!document.getElementById('panel-xingji').classList.contains('hidden')) loadXingji();
      toast('设置都保存好了');
    } else toast(res.error || '没存上');
  });
}

function previewInjection() {
  var box = document.getElementById('inject-preview');
  box.classList.remove('hidden');
  box.textContent = '正在整理预览…';
  api('api/injection-preview').then(function (res) {
    box.textContent = res.ok ? res.text : (res.error || '预览失败');
  });
}

// ── 天气测试 ──
function testWeather() {
  var msg = document.getElementById('weather-test-msg');
  if (segVal('weather-seg') === 'false') {
    msg.textContent = '今日天气已关闭，打开后才能查询嘛';
    return;
  }
  var region = selectedWeatherRegion();
  if (!region) {
    msg.textContent = weatherRegions.length ? '先选到区县再测试嘛' : '区县列表还没加载好，稍等一下';
    return;
  }
  msg.textContent = '查天气中…';
  api('api/weather/test?code=' + encodeURIComponent(region.code)).then(function (res) {
    if (res.ok && res.weather) {
      msg.textContent = '✓ ' + res.weather.place + '：' + res.weather.line;
    } else {
      msg.textContent = '⚠ ' + (res.error || '没查到，检查网络');
    }
  }).catch(function () {
    msg.textContent = '⚠ 查询失败，检查网络';
  });
}

/* ── 设置 · 三档模型配置 ── */
var mcState = { source: 'agent', hanaModels: [], config: null };
var mcPendingEcho = null;

function mcSetSource(src) {
  mcState.source = src;
  mcResetKeyVisibility();
  document.querySelectorAll('.mc-source-btn').forEach(function (b) {
    b.classList.toggle('active', b.getAttribute('data-source') === src);
  });
  document.getElementById('mc-form-agent').style.display = src === 'agent' ? '' : 'none';
  document.getElementById('mc-form-hana').style.display = src === 'hana' ? '' : 'none';
  document.getElementById('mc-form-custom').style.display = src === 'custom' ? '' : 'none';
  document.getElementById('mc-test-result').textContent = '';
}

function mcResetKeyVisibility() {
  ['mc-custom-key'].forEach(function (id) {
    var input = document.getElementById(id);
    var button = document.getElementById(id + '-toggle');
    if (input) input.type = 'password';
    if (button) {
      button.textContent = '显示';
      button.setAttribute('aria-pressed', 'false');
    }
  });
}

function mcToggleKey(inputId, buttonId) {
  var input = document.getElementById(inputId);
  var button = document.getElementById(buttonId);
  if (!input || !button) return;
  var visible = input.type === 'password';
  input.type = visible ? 'text' : 'password';
  button.textContent = visible ? '隐藏' : '显示';
  button.setAttribute('aria-pressed', String(visible));
}

function mcFillProviders() {
  var sel = document.getElementById('mc-provider');
  sel.innerHTML = '<option value="">请选择</option>' + mcState.hanaModels.map(function (p) {
    var pid = p.providerId || p.provider;
    return '<option value="' + esc(pid) + '">' + esc(p.providerName || pid) + '</option>';
  }).join('');
  refreshMcSelects();
}

function mcSelectedHanaProvider() {
  var providerId = document.getElementById('mc-provider').value;
  return mcState.hanaModels.find(function (p) {
    return (p.providerId || p.provider) === providerId;
  }) || null;
}

function mcFillModels(providerId, selected) {
  var sel = document.getElementById('mc-model');
  var prov = mcState.hanaModels.find(function (m) {
    return (m.providerId || m.provider) === providerId;
  }) || null;
  var list = (prov && Array.isArray(prov.models)) ? prov.models : [];
  sel.innerHTML = '<option value="">请选择</option>' + list.map(function (m) {
    var mid = m.modelId || m.model || m.id;
    return '<option value="' + esc(mid) + '">' + esc(m.label || m.name || mid) + '</option>';
  }).join('');
  if (selected) sel.value = selected;
  mcUpdateHanaImportDetail();
  refreshMcSelects();
}

function mcUpdateHanaImportDetail() {
  var detail = document.getElementById('mc-hana-import-detail');
  var provider = mcSelectedHanaProvider();
  var modelId = document.getElementById('mc-model').value;
  if (!detail) return;
  detail.textContent = provider && modelId
    ? '已选择“' + (provider.providerName || provider.providerId) + '”的模型“' + modelId + '”，测试或保存后会按 Hana 运行时配置直连。'
    : '选好模型后会显示当前选择。';
}

function refreshMcSelects() {
  refreshOneSelect('mc-provider');
  refreshOneSelect('mc-model');
}

function refreshOneSelect(id) {
  if (typeof beautifySelect !== 'function') return;
  var sel = document.getElementById(id);
  if (!sel) return;
  if (sel.dataset.ddReady) {
    var wrap = sel.closest('.dd');
    if (wrap && wrap._ddRefresh) wrap._ddRefresh();
  } else {
    beautifySelect(sel);
  }
}

function mcRenderConfig(cfg) {
  mcState.config = cfg;
  mcSetSource(cfg.source || 'agent');
  var cur = document.getElementById('mc-current');
  var label = '跟随伙伴';
  if (cfg.source === 'hana') {
    label = 'Hana · ' + (cfg.hanaModel && cfg.hanaModel.providerId ? cfg.hanaModel.providerId + ' / ' + cfg.hanaModel.modelId : '未选');
  } else if (cfg.source === 'custom') {
    label = '自定义 · ' + (cfg.customModel && cfg.customModel.model ? cfg.customModel.model : '未填模型');
  }
  cur.textContent = '当前使用：' + label;
  if (cfg.hanaModel && cfg.hanaModel.providerId) {
    mcPendingEcho = { providerId: cfg.hanaModel.providerId, modelId: cfg.hanaModel.modelId };
    document.getElementById('mc-provider').value = cfg.hanaModel.providerId;
    mcFillModels(cfg.hanaModel.providerId, cfg.hanaModel.modelId);
  }
  if (cfg.customModel) {
    document.getElementById('mc-custom-url').value = cfg.customModel.baseUrl || '';
    document.getElementById('mc-custom-key').value = '';
    document.getElementById('mc-custom-model').value = cfg.customModel.model || '';
    document.getElementById('mc-custom-api').value = cfg.customModel.api || 'openai-completions';
    refreshOneSelect('mc-custom-api');
    var hint = document.getElementById('mc-key-hint');
    if (cfg.customModel.apiKeyMask) {
      var mode = cfg.customModel.storageMode || 'none';
      var extra = mode === 'plain' ? '（当前明文，未启用系统加密）' : mode === 'dpapi' ? '（系统加密保护）' : '';
      hint.textContent = '已存 Key：' + cfg.customModel.apiKeyMask + extra + '，留空不修改';
    } else {
      hint.textContent = '还没配置 Key';
    }
    document.getElementById('mc-clear-key-btn').classList.toggle('hidden', !cfg.customModel.apiKeyMask);
  }
}

function loadModelConfig() {
  loadMcConfig();
  loadMcModels();
}

// 当前模型档关不掉思考时谠一口：消耗更多也更慢，建议换一个能关思考的档。
// 这个标记由后端在「要了关思考、它还是想了」时记下，所以只在真碰到过的档上出现。
function renderThinkingWarn(flag, modelKey) {
  var el = document.getElementById('mc-thinking-warn');
  if (!el) return;
  if (!flag) { el.classList.add('hidden'); el.textContent = ''; return; }
  el.classList.remove('hidden');
  el.textContent = '⚠️ 当前模型（' + (modelKey || '未知档位') + '）不支持关闭思考：每次整理都会先思考再作答，消耗的 token 明显更多（实测可达十几到几十倍），也更慢。建议换成能关闭思考的模型，比如 MiniMax 或 DeepSeek 官方档。';
}

function loadMcConfig() {
  api('api/model-config').then(function (res) {
    if (res.ok) mcRenderConfig(res.config);
    else document.getElementById('mc-current').textContent = '当前使用：读取失败';
  }).catch(function () {
    document.getElementById('mc-current').textContent = '当前使用：读取失败';
  });
}

function loadMcModels() {
  api('api/model-config/hana-models').then(function (res) {
    if (res.ok && Array.isArray(res.models)) {
      mcState.hanaModels = res.models;
      mcFillProviders();
      if (mcPendingEcho) {
        document.getElementById('mc-provider').value = mcPendingEcho.providerId;
        mcFillModels(mcPendingEcho.providerId, mcPendingEcho.modelId);
        mcPendingEcho = null;
        refreshMcSelects();
      }
    } else {
      document.getElementById('mc-provider').innerHTML = '<option value="">拉取失败，试试跟随伙伴</option>';
      refreshMcSelects();
    }
  }).catch(function () {
    document.getElementById('mc-provider').innerHTML = '<option value="">拉取失败，试试跟随伙伴</option>';
    refreshMcSelects();
  });
}

function mcCollect() {
  var patch = { source: mcState.source };
  if (mcState.source === 'hana') {
    patch.hanaModel = {
      providerId: document.getElementById('mc-provider').value,
      modelId: document.getElementById('mc-model').value,
    };
  } else if (mcState.source === 'custom') {
    patch.customModel = {
      baseUrl: document.getElementById('mc-custom-url').value.trim(),
      apiKey: document.getElementById('mc-custom-key').value,
      model: document.getElementById('mc-custom-model').value.trim(),
      api: document.getElementById('mc-custom-api').value,
    };
  }
  return patch;
}

function mcSave() {
  var btn = document.getElementById('mc-save-btn');
  btn.disabled = true;
  api('api/model-config', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(mcCollect()),
  }).then(function (res) {
    if (res.ok) { mcRenderConfig(res.config); toast('模型已保存'); }
    else toast(res.error || '保存失败');
  }).catch(function (e) {
    toast('保存失败：' + e.message);
  }).then(function () {
    btn.disabled = false;
  });
}

function mcTest() {
  var patch = mcCollect();
  if (mcState.source === 'hana') {
    if (!patch.hanaModel.providerId || !patch.hanaModel.modelId) {
      document.getElementById('mc-test-result').textContent = '⚠ 请选择供应商和模型。';
      return;
    }
  }
  var btn = document.getElementById('mc-test-btn');
  var old = btn.textContent;
  btn.disabled = true;
  btn.textContent = '测试中…';
  var resultEl = document.getElementById('mc-test-result');
  resultEl.textContent = '';
  api('api/model-config/test', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ source: mcState.source, patch: patch }),
  }).then(function (res) {
    if (res.ok) resultEl.textContent = res.note || '连通了';
    else resultEl.textContent = '⚠ ' + (res.error || '连通失败');
  }).catch(function (e) {
    resultEl.textContent = '⚠ ' + e.message;
  }).then(function () {
    btn.disabled = false;
    btn.textContent = old;
  });
}

function mcClearKey() {
  var patch = mcCollect();
  if (!patch.customModel) patch.customModel = {};
  patch.customModel.clearApiKey = true;
  api('api/model-config', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(patch),
  }).then(function (res) {
    if (res.ok) { mcRenderConfig(res.config); toast('Key 已清除'); }
    else toast(res.error || '清除失败');
  }).catch(function (e) { toast('清除失败：' + e.message); });
}

/* ── 档位切换联动 ── */
document.addEventListener('click', function (e) {
  var segBtn = e.target.closest ? e.target.closest('.seg-btn') : null;
  if (segBtn) {
    var seg = segBtn.closest('.seg');
    if (seg) {
      seg.querySelectorAll('.seg-btn').forEach(function (b) { b.classList.remove('active'); });
      segBtn.classList.add('active');
      if (seg.id === 'mode-seg') {
        var mode = segBtn.getAttribute('data-mode');
        document.getElementById('mode-tip').textContent = MODE_TIPS[mode] || '';
        document.getElementById('interval-row').classList.toggle('hidden', mode !== 'balanced');
        var irow = document.getElementById('interval-extra-row');
        if (irow) irow.classList.toggle('hidden', mode !== 'balanced');
      }
      if (seg.id === 'injection-enabled-seg') {
        syncInjectionUi(segBtn.getAttribute('data-val') === 'true');
      }
      if (seg.id === 'weather-seg') {
        syncWeatherSettingsUi(segBtn.getAttribute('data-val') === 'true');
      }
      if (seg.id === 'context-mode-seg') {
        syncContextModeUi(segBtn.getAttribute('data-mode'));
      }
      if (seg.id === 'code-injection-seg') {
        syncCodePanelUi(segBtn.getAttribute('data-val') === 'true');
      }
      if (seg.id === 'mood-discovery-seg') {
        syncMoodDiscoveryTip(segBtn.getAttribute('data-val'));
      }

    }
    return;
  }
  // 类型快捷标签切换
  var typeTab = e.target.closest ? e.target.closest('.type-tab') : null;
  if (typeTab) {
    var tabs = typeTab.closest('#type-tabs');
    if (!tabs) return;
    tabs.querySelectorAll('.type-tab').forEach(function (b) { b.classList.remove('active'); });
    typeTab.classList.add('active');
    updateTypeGuide(typeTab.getAttribute('data-type'));
    return;
  }
});

document.addEventListener('input', function (e) {
  if (!e.target) return;
  if (e.target.id === 'new-title') {
    autofillTodoReminderFromTitle();
    return;
  }
  if (e.target.id === 'new-reminder-start' || e.target.id === 'new-reminder-end') {
    if (!todoReminderAutofilling) {
      todoReminderManual = true;
      todoReminderAutofilled = false;
    }
    syncTodoReminderUI('todo');
  }
});
document.addEventListener('change', function (e) {
  if (e.target && e.target.id === 'new-todo-repeat') {
    var activeTab = document.querySelector('#type-tabs .type-tab.active');
    syncTodoRepeatUI(activeTab ? activeTab.getAttribute('data-type') : 'event');
    return;
  }
  if (e.target && (e.target.id === 'new-reminder-start' || e.target.id === 'new-reminder-end')) {
    if (!todoReminderAutofilling) {
      todoReminderManual = true;
      todoReminderAutofilled = false;
    }
    syncTodoReminderUI('todo');
  }
});

document.getElementById('mc-provider').addEventListener('change', function () {
  mcFillModels(this.value, '');
});
document.getElementById('mc-model').addEventListener('change', mcUpdateHanaImportDetail);

function initWeatherRegionSelects() {
  var province = document.getElementById('weather-province');
  var city = document.getElementById('weather-city');
  var district = document.getElementById('weather-district');
  if (!province || province.dataset.weatherReady) return;
  province.dataset.weatherReady = '1';
  province.addEventListener('change', function () {
    weatherSelectionTouched = true;
    setWeatherLegacyNote('');
    document.getElementById('weather-test-msg').textContent = '';
    populateWeatherCities(this.value, '', '');
  });
  city.addEventListener('change', function () {
    weatherSelectionTouched = true;
    setWeatherLegacyNote('');
    document.getElementById('weather-test-msg').textContent = '';
    populateWeatherDistricts(province.value, this.value, '');
  });
  district.addEventListener('change', function () {
    weatherSelectionTouched = true;
    setWeatherLegacyNote('');
    document.getElementById('weather-test-msg').textContent = '';
  });
  setWeatherSelectDisabled('weather-city', true);
  setWeatherSelectDisabled('weather-district', true);
}

function initBeautifySelects() {
  if (typeof beautifySelect !== 'function') return;
  document.querySelectorAll('select').forEach(function (sel) {
    if (!sel.dataset.ddReady) beautifySelect(sel);
  });
}
initBeautifySelects();
initWeatherRegionSelects();

// 反馈（积木 ui）。检查更新不在这里做：版本分发归官方应用市场（原则第 22 条）。
if (typeof bindFeedback === 'function') {
  bindFeedback({ apiBase: 'api/feedback', openerId: 'fb-open-btn', onToast: toast, apiFetch: apiFetch });
}

// 启动：先同步全局设置（含生理期开关），再渲染今日卡与日历
function loadAppSettings() {
  api('api/settings').then(function (res) {
    if (res.ok) appSettings = Object.assign(appSettings, res.settings);
    syncInjectionUi(appSettings.injectionEnabled !== false);
    syncWeatherSettingsUi(appSettings.weatherEnabled !== false);
    syncPartnerMoodBackfillButton();
    loadToday();
    startTodayRefresher();
    loadMonth();
    loadSummaryJobs();
    loadPartnerMoodJobs();
  }).catch(function () {
    loadToday();
    startTodayRefresher();
    loadMonth();
    loadSummaryJobs();
    loadPartnerMoodJobs();
  });
}
loadAppSettings();
loadFocus();
startFocusTicker();
</script>
</body>
</html>`;
}
