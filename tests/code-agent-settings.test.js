// 拾光记 · Code 窗口「单独关闭」名单测试
// 覆盖：名单归一化、resolver（总闸 / 单伙伴 / 取消关闭）、旧 codeAgentSettings 只迁 enabled:false、
// 数据层存取与首个规范名单落地、路由校验与回读、页面产物与勾选逻辑。

import { test, before } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";

import {
  DEFAULT_CODE_INJECTION_ITEMS,
  normalizeCodeInjectionDisabledAgentIds,
  readCodeInjectionDisabledAgentIds,
  resolveCodeInjection,
} from "../lib/code-mode.js";
import { UserData } from "../lib/data.js";
import { renderPage } from "../lib/page-template.js";

const BASE_DIR = path.join(os.tmpdir(), `sgj-code-disabled-${Date.now()}`);
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

test("名单：只收字符串 ID，去空白、去重，对象数字不当 ID", () => {
  assert.deepEqual(normalizeCodeInjectionDisabledAgentIds(undefined), []);
  assert.deepEqual(normalizeCodeInjectionDisabledAgentIds(null), []);
  assert.deepEqual(normalizeCodeInjectionDisabledAgentIds("hanako"), [], "单个字符串不是名单");
  assert.deepEqual(normalizeCodeInjectionDisabledAgentIds({ hanako: true }), [], "旧 map 形状不是名单");

  assert.deepEqual(
    normalizeCodeInjectionDisabledAgentIds([" hanako ", "hanako", "", "  ", 42, { id: "mikan" }, "mikan"]),
    ["hanako", "mikan"],
    "前后空白当同一个人，数字和对象不进门",
  );
});

test("名单：__proto__ / constructor / prototype 不许进门，对象原型不受影响", () => {
  const clean = normalizeCodeInjectionDisabledAgentIds(JSON.parse('["__proto__","constructor","prototype","hanako"]'));
  assert.deepEqual(clean, ["hanako"]);
  assert.equal({}.enabled, undefined, "对象原型不能被改");
  assert.equal(resolveCodeInjection({ codeInjectionDisabledAgentIds: ["__proto__"] }, "__proto__").enabled, true);
});

// ── resolver ──

test("resolver：不传伙伴时形状与旧行为一致，内容和频率只跟全局", () => {
  const base = resolveCodeInjection({});
  assert.deepEqual(base, {
    enabled: true,
    items: { ...DEFAULT_CODE_INJECTION_ITEMS },
    mode: "balanced",
    intervalHours: 4,
  });
  assert.deepEqual(resolveCodeInjection(), base, "连不传参数也保持旧形状");

  const custom = {
    codeInjectionItems: { weather: true },
    codeInjectMode: "always",
    codeInjectIntervalHours: 1,
  };
  assert.deepEqual(resolveCodeInjection(custom), {
    enabled: true,
    items: { ...DEFAULT_CODE_INJECTION_ITEMS, weather: true },
    mode: "always",
    intervalHours: 1,
  });
});

test("resolver：屏蔽 A 不影响 B，A 的 ID 前后空白也算同一个", () => {
  const settings = { codeInjectionDisabledAgentIds: ["agent-a"] };
  assert.equal(resolveCodeInjection(settings, "agent-a").enabled, false);
  assert.equal(resolveCodeInjection(settings, " agent-a ").enabled, false);
  assert.equal(resolveCodeInjection(settings, "agent-b").enabled, true, "B 不能被 A 连坐");
  assert.equal(resolveCodeInjection(settings, "").enabled, true, "认不出伙伴时只看总闸");
  assert.equal(resolveCodeInjection(settings, "somebody").enabled, true);
});

test("resolver：总闸关着就全关，名单里有谁都一样", () => {
  const off = { codeInjectionEnabled: false, codeInjectionDisabledAgentIds: [] };
  assert.equal(resolveCodeInjection(off, "agent-a").enabled, false);
  assert.equal(resolveCodeInjection(off, "agent-b").enabled, false);
  assert.equal(resolveCodeInjection(off).enabled, false);

  // 重新开总闸：名单仍然照旧生效
  const on = { codeInjectionEnabled: true, codeInjectionDisabledAgentIds: ["agent-a"] };
  assert.equal(resolveCodeInjection(on, "agent-a").enabled, false);
  assert.equal(resolveCodeInjection(on, "agent-b").enabled, true);
});

test("resolver：旧表里的逐伙伴参数不再生效，只认 enabled:false 的屏蔽", () => {
  const legacy = {
    codeInjectionItems: { time: true, peak: true, weather: false },
    codeInjectMode: "balanced",
    codeInjectIntervalHours: 4,
    codeAgentSettings: {
      hanako: { enabled: false, items: { weather: true }, mode: "always", intervalHours: 0.5 },
      mikan: { enabled: true, items: { todos: true } },
    },
  };
  const hanako = resolveCodeInjection(legacy, "hanako");
  assert.equal(hanako.enabled, false, "旧 enabled:false 迁成屏蔽");
  assert.equal(hanako.items.weather, false, "旧 items 不再叠加");
  assert.equal(hanako.mode, "balanced", "旧 mode 不再生效");
  assert.equal(hanako.intervalHours, 4, "旧 intervalHours 不再生效");

  const mikan = resolveCodeInjection(legacy, "mikan");
  assert.equal(mikan.enabled, true, "旧 enabled:true 什么都不改");
  assert.equal(mikan.items.todos, false, "旧 enabled:true 的 items 也不生效");
});

test("名单读取：新字段只要是数组就以它为准，[] 解除屏蔽且不复活", () => {
  const legacyMap = { hanako: { enabled: false } };
  assert.deepEqual(
    readCodeInjectionDisabledAgentIds({ codeAgentSettings: legacyMap }),
    ["hanako"],
    "没有新字段时从旧表迁一次",
  );
  assert.deepEqual(
    readCodeInjectionDisabledAgentIds({ codeAgentSettings: legacyMap, codeInjectionDisabledAgentIds: [] }),
    [],
    "新 [] 优先：解除的屏蔽不能被旧表合回来",
  );
  assert.deepEqual(
    readCodeInjectionDisabledAgentIds({ codeAgentSettings: legacyMap, codeInjectionDisabledAgentIds: ["mikan"] }),
    ["mikan"],
  );
  // 新字段形状写坏了等于旧配置：退回去迁一次，不至于整张名单消失
  assert.deepEqual(
    readCodeInjectionDisabledAgentIds({ codeAgentSettings: legacyMap, codeInjectionDisabledAgentIds: "hanako" }),
    ["hanako"],
  );
});

// ── 数据层 ──

test("数据层：默认空名单，旧 map 的 false 迁过来，旧其他字段不生效", async () => {
  const data = makeData();
  assert.deepEqual(data.getSettings().codeInjectionDisabledAgentIds, [], "旧配置没有名单时是空的");

  await data.settings.update((d) => {
    d.codeAgentSettings = {
      hanako: { enabled: false, items: { weather: true }, mode: "always", intervalHours: 1 },
      mikan: { enabled: true },
      "--": { mode: "always" },
    };
  });
  const migrated = data.getSettings();
  assert.deepEqual(migrated.codeInjectionDisabledAgentIds, ["hanako"]);
  assert.equal("codeAgentSettings" in migrated, false, "API 不再暴露旧 map");

  // 第一次不相关保存：名单落成规范数组，旧表从存盘里删掉
  const saved = await data.updateSettings({ autoSummary: true });
  assert.deepEqual(saved.codeInjectionDisabledAgentIds, ["hanako"], "迁移结果不能被顺手保存弄丢");
  const raw = data.settings.read();
  assert.equal("codeAgentSettings" in raw, false, "旧表要真删掉，不能只藏起来");
  assert.deepEqual(raw.codeInjectionDisabledAgentIds, ["hanako"]);

  // 再存一次不相关设置：名单还在
  assert.deepEqual((await data.updateSettings({ summaryShared: true })).codeInjectionDisabledAgentIds, ["hanako"]);
});

test("数据层：新 [] 就是解除，旧 false 不会复活", async () => {
  const data = makeData();
  await data.settings.update((d) => {
    d.codeAgentSettings = { hanako: { enabled: false } };
    d.codeInjectionDisabledAgentIds = [];
  });
  assert.deepEqual(data.getSettings().codeInjectionDisabledAgentIds, [], "新 [] 遮住旧 false");
  const saved = await data.updateSettings({ codeInjectionDisabledAgentIds: [] });
  assert.deepEqual(saved.codeInjectionDisabledAgentIds, []);
  assert.equal(resolveCodeInjection(data.getSettings(), "hanako").enabled, true);
});

test("数据层：名单收敛成字符串 ID，聊天名单独立", async () => {
  const data = makeData();
  const saved = await data.updateSettings({
    codeInjectionDisabledAgentIds: [" hanako ", "hanako", "", 42, "__proto__", "mikan"],
  });
  assert.deepEqual(saved.codeInjectionDisabledAgentIds, ["hanako", "mikan"]);

  // 聊天那屏的名单改了，Code 这边一个字节都不动
  await data.updateSettings({ injectionDisabledAgentIds: ["soraru"] });
  assert.deepEqual(data.getSettings().codeInjectionDisabledAgentIds, ["hanako", "mikan"]);
  assert.deepEqual(resolveCodeInjection(data.getSettings(), "soraru").enabled, true, "聊天静音不牵连 Code");

  // Code 名单改了，聊天那边也不动
  await data.updateSettings({ codeInjectionDisabledAgentIds: ["hanako"] });
  assert.deepEqual(data.getSettings().injectionDisabledAgentIds, ["soraru"]);
});

// ── 路由 ──

test("路由：GET 给新名单，POST 能存能读能清空，坏格式拒收，旧表发来要求刷新", () => {
  const isolatedHome = fs.mkdtempSync(path.join(os.tmpdir(), "sgj-code-disabled-route-"));
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
    check(Array.isArray(settings.codeInjectionDisabledAgentIds), "GET 没给名单：" + JSON.stringify(settings.codeInjectionDisabledAgentIds));
    check(settings.codeInjectionDisabledAgentIds.length === 0, "旧配置应当是空名单");
    check(!("codeAgentSettings" in settings), "GET 还在暴露旧 map");

    const saved = await callPost({ codeInjectionDisabledAgentIds: [" hanako ", "hanako", "mikan"] });
    check(saved?.ok, "名单没存上：" + JSON.stringify(saved));
    settings = await callGet();
    check(JSON.stringify(settings.codeInjectionDisabledAgentIds) === JSON.stringify(["hanako", "mikan"]),
      "落盘的名单不对：" + JSON.stringify(settings.codeInjectionDisabledAgentIds));

    // 省略这个键 = 不动它（顺手保存别的设置不能把名单清空）
    const partial = await callPost({ autoSummary: true });
    check(partial?.ok, "只改别的设置被拒：" + JSON.stringify(partial));
    check(JSON.stringify((await callGet()).codeInjectionDisabledAgentIds) === JSON.stringify(["hanako", "mikan"]),
      "省略名单时不该动存着的那份");

    // 显式 [] = 全部解除
    const cleared = await callPost({ codeInjectionDisabledAgentIds: [] });
    check(cleared?.ok, "清空名单被拒：" + JSON.stringify(cleared));
    check((await callGet()).codeInjectionDisabledAgentIds.length === 0, "[] 没清空名单");

    const rejects = [
      ["名单不是数组", { codeInjectionDisabledAgentIds: "hanako" }],
      ["名单是对象", { codeInjectionDisabledAgentIds: { hanako: true } }],
      ["元素是数字", { codeInjectionDisabledAgentIds: ["hanako", 42] }],
      ["元素是对象", { codeInjectionDisabledAgentIds: [{ id: "hanako" }] }],
    ];
    for (const [why, body] of rejects) {
      const res = await callPost(body);
      check(res?.ok === false, "应当拒收：" + why);
    }
    check((await callGet()).codeInjectionDisabledAgentIds.length === 0, "拒收的那几次不该改到名单");

    // 旧页面还按老协议提交整张 map：明确失败并让她刷新，不能静默当成功
    const legacy = await callPost({ codeAgentSettings: { hanako: { enabled: false } } });
    check(legacy?.ok === false, "旧协议提交应当失败：" + JSON.stringify(legacy));
    check(/刷新页面/.test(String(legacy.error || "")), "旧协议要说清刷新页面：" + legacy.error);
    check((await callGet()).codeInjectionDisabledAgentIds.length === 0, "旧协议提交不该写进任何东西");
    console.log(JSON.stringify({ ok: true }));
  `;
  const result = spawnSync(process.execPath, ["--input-type=module", "-e", childCode], {
    encoding: "utf8",
    env: { ...process.env, USERPROFILE: isolatedHome, HOME: isolatedHome, HANA_HOME: path.join(isolatedHome, ".hanako") },
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /"ok":true/);
});

// ── 页面：产物与勾选逻辑 ──

test("页面产物：Code 那屏是和聊天同款的勾选名单，旧编辑器彻底没了", () => {
  for (const id of ["code-injection-agent-picker", "code-injection-items", "code-mode-seg", "code-interval-seg", "code-injection-seg"]) {
    assert.ok(PAGE_HTML.includes(`id="${id}"`), `页面里缺 ${id}`);
  }
  assert.match(PAGE_HTML, /function renderCodeInjectionAgents/);
  assert.match(PAGE_HTML, /function getCodeInjectionDisabledAgentIdsFromUI/);
  assert.ok(
    PAGE_HTML.includes("body.codeInjectionDisabledAgentIds = getCodeInjectionDisabledAgentIdsFromUI();"),
    "保存时要带上新名单",
  );
  assert.match(PAGE_HTML, /对 Code 窗口不起作用/, "聊天那屏的屏蔽只管聊天");
  // 旧称呼退场，两屏标签就是「聊天窗口 / Code 窗口」
  assert.equal(PAGE_HTML.includes("Code 页"), false, "页面里还有旧称呼「Code 页」");
  assert.ok(
    PAGE_HTML.includes('<button class="seg-btn active" data-mode="chat" aria-selected="true">聊天窗口</button>'),
    "聊天那屏的标签不对",
  );
  assert.ok(
    PAGE_HTML.includes('<button class="seg-btn" data-mode="code" aria-selected="false">Code 窗口</button>'),
    "Code 那屏的标签不对",
  );
  assert.match(PAGE_HTML, /总闸管所有伙伴/);

  // 旧的逐伙伴参数编辑器：HTML、脚本、变量、事件一个都不留
  for (const gone of [
    'id="code-agent-select"',
    'id="code-agent-editor"',
    'id="code-agent-enabled-seg"',
    'id="code-agent-mode-seg"',
    'id="code-agent-interval-row"',
    'id="code-agent-items-override"',
    'id="code-agent-reset-btn"',
    "switchCodeAgentTarget",
    "resetCodeAgentOverride",
    "codeAgentSettings",
    "codeAgentMap",
    "syncCodeAgentEditorUi",
  ]) {
    assert.equal(PAGE_HTML.includes(gone), false, `旧编辑器残留：${gone}`);
  }

  const scripts = [...PAGE_HTML.matchAll(/<script>([\s\S]*?)<\/script>/gi)].map((match) => match[1]);
  assert.ok(scripts.length >= 3);
  scripts.forEach((script, index) => {
    if (!script.trim()) return;
    try { new Function(script); }
    catch (error) { throw new Error("第 " + (index + 1) + " 个内联脚本解析失败：" + error.stack); }
  });
  // 产物要和模板一致（改了 page-template 记得跑 tools/build-page.mjs）
  assert.equal(fs.readFileSync(path.resolve("ui/panel.html"), "utf8"), PAGE_HTML, "panel.html 与模板不一致，重跑 tools/build-page.mjs");
});

/** 把「Code 窗口：单独关闭名单」那一段脚本切出来，配上最小 DOM 假件跑一遍。 */
function loadCodeListPage() {
  const marker = "/* ── Code 窗口：单独关闭名单 ── */";
  const start = PAGE_HTML.indexOf(marker);
  const end = PAGE_HTML.indexOf("function toggleInjectionQuick() {", start);
  assert.ok(start > 0 && end > start, "页面里找不到 Code 名单那一段脚本");
  const slice = PAGE_HTML.slice(start, end);

  const picker = { innerHTML: "" };
  const document = {
    getElementById(id) { return id === "code-injection-agent-picker" ? picker : null; },
    querySelectorAll(selector) {
      const rows = [...picker.innerHTML.matchAll(/<input[^>]*data-agent-id="([^"]*)"([^>]*)>/g)].map((match) => ({
        id: match[1],
        checked: / checked/.test(match[2]),
        getAttribute() { return match[1]; },
      }));
      return selector === ".code-injection-agent-check:checked" ? rows.filter((row) => row.checked) : rows;
    },
  };

  const factory = new Function(
    "document", "esc",
    `${slice}
    return {
      renderCodeInjectionAgents: renderCodeInjectionAgents,
      getCodeInjectionDisabledAgentIdsFromUI: getCodeInjectionDisabledAgentIdsFromUI,
    };`,
  );
  const api = factory(document, (value) => String(value));
  return {
    ...api,
    html: () => picker.innerHTML,
    setChecked(id, on) {
      const pattern = new RegExp(`(data-agent-id="${id}")( checked)?`);
      picker.innerHTML = picker.innerHTML.replace(pattern, (all, head) => head + (on ? " checked" : ""));
    },
  };
}

test("页面逻辑：勾选只改列表里看得见的伙伴，看不见的存着的 ID 留着", () => {
  const page = loadCodeListPage();
  const agents = [{ agentId: "hanako", agentName: "花子" }, { agentId: "mikan", agentName: "米卡" }];

  page.renderCodeInjectionAgents(agents, ["hanako", "ghost"]);
  assert.match(page.html(), /data-agent-id="hanako" checked/);
  assert.ok(!/data-agent-id="mikan" checked/.test(page.html()), "没在名单里的不该勾上");
  assert.deepEqual(page.getCodeInjectionDisabledAgentIdsFromUI(), ["ghost", "hanako"], "看不到的 ghost 要留着");

  // 取消勾选 hanako：只剩 ghost，mikan 不受影响
  page.setChecked("hanako", false);
  assert.deepEqual(page.getCodeInjectionDisabledAgentIdsFromUI(), ["ghost"]);

  // 重新勾上 mikan
  page.setChecked("mikan", true);
  assert.deepEqual(page.getCodeInjectionDisabledAgentIdsFromUI(), ["ghost", "mikan"]);

  // 全部取消：看得见的都解除，看不见的还在
  page.setChecked("mikan", false);
  assert.deepEqual(page.getCodeInjectionDisabledAgentIdsFromUI(), ["ghost"]);
});

test("页面逻辑：不可见 ID 与对象内置键同名也不会被误删", () => {
  const page = loadCodeListPage();
  page.renderCodeInjectionAgents([{ agentId: "hanako", agentName: "花子" }], ["toString", "hasOwnProperty"]);
  assert.deepEqual(page.getCodeInjectionDisabledAgentIdsFromUI(), ["toString", "hasOwnProperty"]);
});

test("页面逻辑：名单没加载好就交回 undefined（保存时不发这个键）", () => {
  const page = loadCodeListPage();
  assert.equal(page.getCodeInjectionDisabledAgentIdsFromUI(), undefined, "没读到服务端那份就不提交空名单");

  // 一个伙伴都没有也算加载过：渲染成空列表，提交的是空名单（而不是 undefined）
  page.renderCodeInjectionAgents([], []);
  assert.match(page.html(), /还没有可设置的伙伴/);
  assert.deepEqual(page.getCodeInjectionDisabledAgentIdsFromUI(), []);
});
