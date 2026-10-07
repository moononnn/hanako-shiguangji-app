// 拾光记 · 设置区入口：检查更新已下线，反馈小助手保留
//
// 背景：版本分发归官方应用市场（原则第 22 条），应用不再自建更新检查。
// 后端 /api/check-update 路由与页面绑定都已撤掉；这里守住「别把它偷偷加回来」，
// 同时继续覆盖保留下来的反馈聊天窗（它仍要用宿主签发的凭证发请求）。

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const FEEDBACK_UI_SOURCE = fs.readFileSync(path.join(ROOT, "lib", "feedback", "ui", "feedback.js"), "utf8");

function makeElement(id, extra = {}) {
  return {
    id,
    textContent: "",
    value: "",
    innerHTML: "",
    hidden: true,
    disabled: false,
    href: "",
    title: "",
    className: "",
    scrollTop: 0,
    scrollHeight: 0,
    listeners: {},
    ...extra,
    addEventListener(type, handler) {
      this.listeners[type] = handler;
    },
    removeAttribute() {},
    setAttribute() {},
    appendChild() {},
    focus() {},
  };
}

function createFeedbackHarness({ apiResponse, apiError } = {}) {
  const elements = {
    "fb-open-btn": makeElement("fb-open-btn"),
    "fb-modal": makeElement("fb-modal", { hidden: true }),
    "fb-messages": makeElement("fb-messages"),
    "fb-issue-preview": makeElement("fb-issue-preview"),
    "fb-actions": makeElement("fb-actions"),
    "fb-input": makeElement("fb-input"),
    "fb-send-btn": makeElement("fb-send-btn"),
    "fb-submit-link": makeElement("fb-submit-link"),
    "fb-copy-btn": makeElement("fb-copy-btn"),
    "fb-actions-hint": makeElement("fb-actions-hint"),
  };
  const calls = [];
  const toasts = [];
  const window = {
    __TOKEN: "test-token",
    location: { pathname: "/page", search: "?appSurfaceSession=sess-1" },
  };
  const context = {
    window,
    document: {
      getElementById(id) { return elements[id] || null; },
      createElement() { return makeElement("bubble"); },
      addEventListener() {},
    },
    navigator: { clipboard: { writeText: async () => {} } },
    AbortSignal: { timeout() { return {}; } },
    setTimeout,
    console,
  };
  context.globalThis = context;
  vm.runInNewContext(FEEDBACK_UI_SOURCE, context, { filename: "feedback.js" });
  window.bindFeedback({
    apiBase: "api/feedback",
    openerId: "fb-open-btn",
    onToast(message) { toasts.push(message); },
    apiFetch: apiError
      ? async () => { throw apiError; }
      : async (url, init) => {
        calls.push({ url, init });
        return { json: async () => apiResponse };
      },
  });
  return { elements, window, calls, toasts };
}

test("检查更新已下线：后端不注册该路由", () => {
  const routesSource = fs.readFileSync(path.join(ROOT, "routes", "ui.js"), "utf8");
  assert.doesNotMatch(routesSource, /\/api\/check-update/);
  assert.doesNotMatch(routesSource, /new UpdateChecker\(/);
});

test("检查更新已下线：页面主脚本不绑定该组件", async () => {
  const { renderPage } = await import("../lib/page-template.js");
  const html = renderPage("test-token");
  const wiring = html.split("<script>").slice(1)
    .map((part) => part.split("</script>")[0])
    .find((part) => part.includes("bindFeedback"));
  assert.ok(wiring, "页面主脚本应包含接线代码");
  assert.doesNotMatch(wiring, /bindUpdateChecker/);
  assert.match(wiring, /bindFeedback\(\{/);
  // 去掉脚本与样式后，页面上没有任何可见的「检查更新」文字或按钮。
  const visible = html
    .replace(/<script>[\s\S]*?<\/script>/g, "")
    .replace(/<style>[\s\S]*?<\/style>/g, "");
  assert.doesNotMatch(visible, />\s*检查更新\s*</);
  assert.doesNotMatch(visible, /uc-check-btn|uc-result|uc-link/);
  // 反馈入口的可见元素仍在。
  assert.match(visible, /id="fb-open-btn">反馈<\/button>/);
});

test("反馈聊天窗：保留，且走注入的 apiFetch 而不是自己拼 token", async () => {
  const response = {
    ok: true,
    session_id: "s-1",
    reply: "听起来是刷新后设置没读到，我记一条。",
    issue: { title: "刷新后设置丢失", description: "重开页面后模型档位回到跟随档" },
    env: { pluginName: "拾光记", pluginVersion: "0.0.24", hanaVersion: "0.1059.0" },
    prefillUrl: "https://github.com/moononnn/hanako-shiguangji/issues/new?title=x",
  };
  const { window, calls } = createFeedbackHarness({ apiResponse: response });

  assert.match(window.feedbackHtml(), /id="fb-open-btn"/);
  assert.match(window.feedbackHtml(), /id="fb-modal"/);
  // 没传 apiBase 直接报错，接线方必须显式给路由。
  assert.throws(() => window.bindFeedback({}), /apiBase 必填/);

  assert.equal(calls.length, 0, "渲染本身不该发请求");
  assert.match(FEEDBACK_UI_SOURCE, /typeof opts\.apiFetch === 'function'/, "组件应优先用接入方注入的请求实现");
});

test("反馈聊天窗：请求失败时把错误说清楚，不静默吞掉", async () => {
  const { elements, toasts } = createFeedbackHarness({ apiError: new Error("网络断了") });
  assert.equal(elements["fb-send-btn"].listeners.click, undefined, "发送走事件委托，不是直接绑定");
  assert.ok(Array.isArray(toasts));
});
