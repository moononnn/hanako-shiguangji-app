// 拾光记 · 闲聊窗口「单独关闭」名单测试
//
// 闲聊是第三扇门（聊天、Code 之外），它的按伙伴屏蔽名单也单独一份：
// 聊天那边的 injectionDisabledAgentIds 是全局的（连聊天一起关），
// 这一份只管闲聊那一扇门。
// 覆盖：名单归一化、数据层存取、路由读写与校验、页面产物。

import { test, before } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";

import { UserData, normalizeCasualInjectionDisabledAgentIds } from "../lib/data.js";
import { renderPage } from "../lib/page-template.js";

const BASE_DIR = path.join(os.tmpdir(), `sgj-casual-list-${Date.now()}`);
const PAGE_HTML = renderPage("");
let counter = 0;

before(() => {
  fs.mkdirSync(BASE_DIR, { recursive: true });
});

function makeData() {
  counter += 1;
  return new UserData(path.join(BASE_DIR, `case-${counter}`));
}

// ── 名单归一化 ──

test("名单：只收字符串 ID，去空白、去重，别的当没给", () => {
  assert.deepEqual(normalizeCasualInjectionDisabledAgentIds(undefined), []);
  assert.deepEqual(normalizeCasualInjectionDisabledAgentIds(null), []);
  assert.deepEqual(normalizeCasualInjectionDisabledAgentIds("hanako"), [], "单个字符串不是名单");
  assert.deepEqual(normalizeCasualInjectionDisabledAgentIds({ hanako: true }), [], "旧 map 形状不是名单");
  assert.deepEqual(
    normalizeCasualInjectionDisabledAgentIds([" hanako ", "hanako", "", "  ", 42, { id: "mikan" }, "mikan"]),
    ["hanako", "mikan"],
    "前后空白当同一个人，数字和对象不进门",
  );
});

// ── 数据层 ──

test("数据层：旧配置没有这个键时是空名单，存进去能读回来", async () => {
  const data = makeData();
  assert.deepEqual(data.getSettings().casualInjectionDisabledAgentIds, []);
  await data.updateSettings({ casualInjectionDisabledAgentIds: ["hanako", "mikan"] });
  assert.deepEqual(data.getSettings().casualInjectionDisabledAgentIds, ["hanako", "mikan"]);
  await data.updateSettings({ casualInjectionDisabledAgentIds: [] });
  assert.deepEqual(data.getSettings().casualInjectionDisabledAgentIds, []);
});

// ── 路由 ──

test("路由：GET 给名单，POST 能存能清空，坏格式拒收，省略时不动它", () => {
  const isolatedHome = fs.mkdtempSync(path.join(os.tmpdir(), "sgj-casual-list-route-"));
  const routeUrl = pathToFileURL(path.resolve("routes/ui.js")).href;
  const childCode = `
    import registerRoutes from ${JSON.stringify(routeUrl)};
    const routes = [];
    const app = {
      get(path, handler) { routes.push({ method: "GET", path, handler }); },
      post(path, handler) { routes.push({ method: "POST", path, handler }); },
      put(path, handler) { routes.push({ method: "PUT", path, handler }); },
      delete(path, handler) { routes.push({ method: "DELETE", path, handler }); },
    };
    registerRoutes(app, { log: { info() {}, warn() {}, error() {} } });
    const post = routes.find((item) => item.method === "POST" && item.path === "/api/settings");
    const get = routes.find((item) => item.method === "GET" && item.path === "/api/settings");
    if (!post || !get) throw new Error("设置路由未注册");
    const callPost = (body) => post.handler({ req: { async json() { return body; } }, json(value) { return value; } });
    const callGet = async () => (await get.handler({ json(value) { return value; } })).settings;
    const check = (cond, message) => { if (!cond) throw new Error(message); };

    let settings = await callGet();
    check(Array.isArray(settings.casualInjectionDisabledAgentIds), "GET 没给名单");
    check(settings.casualInjectionDisabledAgentIds.length === 0, "旧配置应当是空名单");

    const saved = await callPost({ casualInjectionDisabledAgentIds: [" hanako ", "hanako", "mikan"] });
    check(saved?.ok, "名单没存上：" + JSON.stringify(saved));
    settings = await callGet();
    check(JSON.stringify(settings.casualInjectionDisabledAgentIds) === JSON.stringify(["hanako", "mikan"]),
      "落盘的名单不对：" + JSON.stringify(settings.casualInjectionDisabledAgentIds));

    // 省略这个键 = 不动它（顺手保存别的设置不能把名单清空）
    const partial = await callPost({ autoSummary: true });
    check(partial?.ok, "只改别的设置被拒：" + JSON.stringify(partial));
    check(JSON.stringify((await callGet()).casualInjectionDisabledAgentIds) === JSON.stringify(["hanako", "mikan"]),
      "省略名单时不该动存着的那份");

    const cleared = await callPost({ casualInjectionDisabledAgentIds: [] });
    check(cleared?.ok, "清空名单被拒：" + JSON.stringify(cleared));
    check((await callGet()).casualInjectionDisabledAgentIds.length === 0, "[] 没清空名单");

    const rejects = [
      ["名单不是数组", { casualInjectionDisabledAgentIds: "hanako" }],
      ["名单是对象", { casualInjectionDisabledAgentIds: { hanako: true } }],
    ];
    for (const [why, body] of rejects) {
      const res = await callPost(body);
      check(res?.ok === false, "应当拒收：" + why);
    }
    check((await callGet()).casualInjectionDisabledAgentIds.length === 0, "拒收的那几次不该改到名单");
    console.log(JSON.stringify({ ok: true }));
  `;
  const result = spawnSync(process.execPath, ["--input-type=module", "-e", childCode], {
    encoding: "utf8",
    env: { ...process.env, USERPROFILE: isolatedHome, HOME: isolatedHome, HANA_HOME: path.join(isolatedHome, ".hanako") },
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /"ok":true/);
});

// ── 页面产物 ──

test("页面产物：闲聊那屏有单独关闭名单，和聊天、Code 那两屏同一套做法", () => {
  assert.ok(PAGE_HTML.includes('id="casual-injection-agent-picker"'), "页面里缺闲聊的名单容器");
  assert.match(PAGE_HTML, /function renderCasualInjectionAgents/);
  assert.match(PAGE_HTML, /function getCasualInjectionDisabledAgentIdsFromUI/);
  assert.match(PAGE_HTML, /function syncCasualInjectionUi/);
  assert.ok(
    PAGE_HTML.includes("body.casualInjectionDisabledAgentIds = getCasualInjectionDisabledAgentIdsFromUI();"),
    "保存时要带上闲聊那份名单",
  );
  assert.ok(
    PAGE_HTML.includes("renderCasualInjectionAgents(s.summaryAgents || [], s.casualInjectionDisabledAgentIds);"),
    "读设置时要渲染闲聊那份名单",
  );
  // 闲聊总闸关着时，勾选该灰掉：不让白勾
  assert.ok(
    PAGE_HTML.includes("document.querySelectorAll('.casual-injection-agent-check').forEach(function (check) { check.disabled = !enabled; });"),
    "闲聊总闸关着时名单勾选应被禁用",
  );
  assert.match(PAGE_HTML, /勾选的伙伴，在闲聊窗口里不会收到拾光记情境/);
});
