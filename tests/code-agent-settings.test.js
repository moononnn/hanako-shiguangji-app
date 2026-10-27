// 拾光记 · Code 页「按伙伴单独调」测试
// 覆盖：稀疏覆盖的归一化、resolver 向后兼容与合并语义、原型链污染防护、
// 数据层存取、路由校验（部分保存保留整张表 / 拒收非法值）、页面产物与草稿逻辑。

import { test, before } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";

import {
  DEFAULT_CODE_INJECTION_ITEMS,
  codeAgentOverrideFor,
  normalizeCodeAgentSettings,
  resolveCodeInjection,
} from "../lib/code-mode.js";
import { UserData } from "../lib/data.js";
import { renderPage } from "../lib/page-template.js";

const BASE_DIR = path.join(os.tmpdir(), `sgj-code-agent-${Date.now()}`);
let counter = 0;

before(() => {
  fs.mkdirSync(BASE_DIR, { recursive: true });
});

function makeData() {
  counter += 1;
  return new UserData(path.join(BASE_DIR, `case-${counter}`));
}

// ── 归一化 ──

test("按伙伴的设置：只留认得出的字段，没动手的地方不写值", () => {
  assert.deepEqual(normalizeCodeAgentSettings(undefined), {});
  assert.deepEqual(normalizeCodeAgentSettings(null), {});
  assert.deepEqual(normalizeCodeAgentSettings("坏数据"), {});
  assert.deepEqual(normalizeCodeAgentSettings([{ enabled: false }]), {});
  // 旧配置里那张空表就该是空表，行为跟以前一样
  assert.deepEqual(normalizeCodeAgentSettings({}), {});

  const map = normalizeCodeAgentSettings({
    hanako: { enabled: false, mode: "ALWAYS", intervalHours: "1", items: { weather: true, bogus: true } },
    yumi: { mode: "乱写", intervalHours: 3, enabled: "关闭", items: "不是对象" },
    xiaohua: { note: "不认识的字段" },
  });
  assert.deepEqual(map.hanako, { enabled: false, mode: "always", intervalHours: 1, items: { weather: true } });
  assert.equal("yumi" in map, false, "写坏的字段一个都不该落地");
  assert.equal("xiaohua" in map, false, "没一个认得出的字段就等于没设置");
  assert.equal(map.hanako.items.bogus, undefined, "清单外的注入项不收");
});

test("按伙伴的设置：__proto__ / constructor 之类不许进门", () => {
  const polluted = JSON.parse('{"__proto__":{"enabled":false},"constructor":{"mode":"always"},"prototype":{"enabled":false},"hanako":{"enabled":true}}');
  const map = normalizeCodeAgentSettings(polluted);
  assert.deepEqual(Object.keys(map), ["hanako"], "危险键全部丢掉");
  assert.deepEqual(map.hanako, { enabled: true });
  assert.equal({}.enabled, undefined, "对象原型不能被改");
  // 整张表本身被塞了 __proto__ 也不能影响判定
  const resolved = resolveCodeInjection({ codeAgentSettings: polluted }, "__proto__");
  assert.equal(resolved.enabled, true, "用 __proto__ 当 ID 不该改到开关");
});

// ── resolver ──

test("resolver：不传伙伴时形状与旧行为一模一样", () => {
  const legacy = resolveCodeInjection({});
  assert.deepEqual(legacy, {
    enabled: true,
    items: { ...DEFAULT_CODE_INJECTION_ITEMS },
    mode: "balanced",
    intervalHours: 4,
  });
  assert.deepEqual(resolveCodeInjection(), legacy, "连不传参数也保持旧形状");

  const custom = { codeInjectionEnabled: false, codeInjectionItems: { weather: true }, codeInjectMode: "always", codeInjectIntervalHours: 1 };
  assert.deepEqual(resolveCodeInjection(custom), resolveCodeInjection(custom, ""), "空 ID 等于没传");
  assert.deepEqual(resolveCodeInjection(custom), {
    enabled: false,
    items: { ...DEFAULT_CODE_INJECTION_ITEMS, weather: true },
    mode: "always",
    intervalHours: 1,
  });
});

test("resolver：总闸压在所有伙伴头上，伙伴自己的开关只能再关一次", () => {
  const on = { codeInjectionEnabled: true, codeAgentSettings: { hanako: { enabled: true } } };
  assert.equal(resolveCodeInjection(on, "hanako").enabled, true);
  const off = { codeInjectionEnabled: false, codeAgentSettings: { hanako: { enabled: true } } };
  assert.equal(resolveCodeInjection(off, "hanako").enabled, false, "总闸关着，伙伴选开也不生效");

  const partnerOff = { codeInjectionEnabled: true, codeAgentSettings: { hanako: { enabled: false } } };
  assert.equal(resolveCodeInjection(partnerOff, "hanako").enabled, false);
  assert.equal(resolveCodeInjection(partnerOff, "yumi").enabled, true, "别的伙伴不受影响");
});

test("resolver：内容是「全局 + 这位伙伴改过的那几项」，方式和间隔各自回退", () => {
  const settings = {
    codeInjectionItems: { time: true, peak: true, weather: false, todos: true },
    codeInjectMode: "always",
    codeInjectIntervalHours: 8,
    codeAgentSettings: {
      hanako: { items: { weather: true, peak: false }, mode: "economical" },
      yumi: { intervalHours: 0.5 },
    },
  };
  const hanako = resolveCodeInjection(settings, "hanako");
  assert.deepEqual(hanako.items, { time: true, peak: false, weather: true, special: false, todos: true, archive: false, xingji: false });
  assert.equal(hanako.mode, "economical");
  assert.equal(hanako.intervalHours, 8, "没单独设间隔就跟全局");

  const yumi = resolveCodeInjection(settings, "yumi");
  assert.equal(yumi.intervalHours, 0.5);
  assert.equal(yumi.mode, "always", "没单独设方式就跟全局");
  assert.equal(yumi.items.todos, true, "没单独设内容就跟全局");

  const unknown = resolveCodeInjection(settings, "somebody");
  assert.equal(unknown.mode, "always");
  assert.equal(unknown.enabled, true);
  assert.equal(unknown.items.weather, false);

  // ID 前后空白当同一个伙伴
  assert.deepEqual(resolveCodeInjection(settings, " hanako "), hanako);
  assert.deepEqual(codeAgentOverrideFor(settings, "hanako"), { items: { weather: true, peak: false }, mode: "economical" });
  assert.equal(codeAgentOverrideFor(settings, "nobody"), null);
});

test("resolver：存盘里写坏的覆盖不会把全局挤坏", () => {
  const settings = {
    codeInjectionItems: { weather: true },
    codeInjectMode: "balanced",
    codeAgentSettings: {
      hanako: { enabled: "关", mode: "乱写", intervalHours: 3, items: { weather: "true", bogus: true } },
    },
  };
  assert.deepEqual(resolveCodeInjection(settings, "hanako"), {
    enabled: true,
    items: { ...DEFAULT_CODE_INJECTION_ITEMS, weather: true },
    mode: "balanced",
    intervalHours: 4,
  });
});

// ── 数据层 ──

test("数据层：默认空表，存稀疏覆盖，读回来还是稀疏的", async () => {
  const data = makeData();
  assert.deepEqual(data.getSettings().codeAgentSettings, {}, "旧配置没有这张表时是空表");

  const saved = await data.updateSettings({
    codeAgentSettings: { hanako: { enabled: false, mode: "always", items: { weather: true }, note: "多余字段" } },
  });
  assert.deepEqual(saved.codeAgentSettings, { hanako: { enabled: false, mode: "always", items: { weather: true } } });
  assert.deepEqual(data.getSettings().codeAgentSettings, { hanako: { enabled: false, mode: "always", items: { weather: true } } });

  // 别的设置照常保存，这张表不被碰
  await data.updateSettings({ autoSummary: true });
  assert.deepEqual(data.getSettings().codeAgentSettings, { hanako: { enabled: false, mode: "always", items: { weather: true } } });

  // resolver 直接吃 getSettings 的结果
  const resolved = resolveCodeInjection(data.getSettings(), "hanako");
  assert.equal(resolved.enabled, false);
  assert.equal(resolved.mode, "always");
  assert.equal(resolved.items.weather, true);
  assert.equal(resolved.items.peak, true, "没单独改的项还是全局默认");
});

test("数据层：写进去的垃圾不会崩，也不会变成污染源", async () => {
  const data = makeData();
  const saved = await data.updateSettings({ codeAgentSettings: JSON.parse('{"__proto__":{"enabled":false},"hanako":"坏了"}') });
  assert.deepEqual(saved.codeAgentSettings, {});
  assert.equal(resolveCodeInjection(saved, "__proto__").enabled, true);
});

// ── 路由 ──

test("路由：按伙伴的设置能存能读，部分保存保留整张表，非法值整单拒收", () => {
  const isolatedHome = fs.mkdtempSync(path.join(os.tmpdir(), "sgj-code-agent-route-"));
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

    check(Object.keys((await callGet()).codeAgentSettings).length === 0, "旧配置应当是空表");

    const saved = await callPost({ codeAgentSettings: {
      hanako: { enabled: false, items: { weather: true }, mode: "always", intervalHours: 1 },
    } });
    check(saved?.ok, "按伙伴的设置没存上：" + JSON.stringify(saved));
    let settings = await callGet();
    check(JSON.stringify(settings.codeAgentSettings.hanako) === JSON.stringify({
      enabled: false, items: { weather: true }, mode: "always", intervalHours: 1,
    }), "落盘的覆盖不对：" + JSON.stringify(settings.codeAgentSettings));

    // 只改一个字段：其余字段和别的伙伴都不能被抹掉
    await callPost({ codeAgentSettings: { yumi: { enabled: false } } });
    const partial = await callPost({ codeAgentSettings: { hanako: { mode: "economical" } } });
    check(partial?.ok, "部分保存被拒：" + JSON.stringify(partial));
    settings = await callGet();
    check(settings.codeAgentSettings.hanako.mode === "economical", "方式没改到");
    check(settings.codeAgentSettings.hanako.enabled === false, "没传的字段被写坏了");
    check(settings.codeAgentSettings.hanako.items.weather === true, "注入项被写坏了");
    check(settings.codeAgentSettings.hanako.intervalHours === 1, "间隔被写坏了");
    check(settings.codeAgentSettings.yumi.enabled === false, "别的伙伴被抹掉了");

    // 存别的设置（比如主页的一键开关）不该动这张表
    await callPost({ codeInjectionEnabled: false });
    settings = await callGet();
    check(settings.codeInjectionEnabled === false, "总闸没落盘");
    check(settings.codeAgentSettings.hanako.mode === "economical", "一键开关把按伙伴的表弄丢了");

    // null = 这位伙伴恢复跟随默认，别人不受影响
    const removed = await callPost({ codeAgentSettings: { hanako: null } });
    check(removed?.ok, "恢复默认被拒：" + JSON.stringify(removed));
    settings = await callGet();
    check(!("hanako" in settings.codeAgentSettings), "恢复默认没删掉");
    check(settings.codeAgentSettings.yumi.enabled === false, "恢复默认误伤了别的伙伴");

    // 一个字段都没写的空壳等于没设置
    await callPost({ codeAgentSettings: { soraru: {} } });
    check(!("soraru" in (await callGet()).codeAgentSettings), "空壳不该留档");

    const rejects = [
      ["整张表不是对象", "nope"],
      ["整张表是数组", []],
      ["伙伴 ID 为空", { "  ": { enabled: false } }],
      ["伙伴 ID 是 __proto__", JSON.parse('{"__proto__":{"enabled":false}}')],
      ["伙伴 ID 是 constructor", { constructor: { enabled: false } }],
      ["值是数字", { hanako: 5 }],
      ["开关不是布尔", { hanako: { enabled: "yes" } }],
      ["方式不认识", { hanako: { mode: "乱写" } }],
      ["间隔不在档位上", { hanako: { intervalHours: 3 } }],
      ["间隔是字符串", { hanako: { intervalHours: "1" } }],
      ["注入项不是对象", { hanako: { items: "全部" } }],
      ["注入项不认识", { hanako: { items: { bogus: true } } }],
      ["注入项不是布尔", { hanako: { items: { weather: "true" } } }],
      ["多余字段", { hanako: { note: "顺手塞的" } }],
    ];
    for (const [why, body] of rejects) {
      const res = await callPost({ codeAgentSettings: body });
      check(res?.ok === false, "应当拒收：" + why);
    }
    check({}.enabled === undefined, "拒收之后对象原型是干净的");
    settings = await callGet();
    check(settings.codeInjectionEnabled === false, "拒收的那几次不该改到已有设置");
    check(settings.codeAgentSettings.yumi.enabled === false, "拒收的那几次不该动已有表");
    console.log(JSON.stringify({ ok: true }));
  `;
  const result = spawnSync(process.execPath, ["--input-type=module", "-e", childCode], {
    encoding: "utf8",
    env: { ...process.env, USERPROFILE: isolatedHome, HOME: isolatedHome, HANA_HOME: path.join(isolatedHome, ".hanako") },
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /"ok":true/);
});

// ── 页面：产物与草稿逻辑 ──

const PAGE_HTML = renderPage("");

/** 把页面里「按伙伴单独调」那一段脚本切出来，配上最小 DOM 假件跑一遍。 */
function loadCodeAgentPage({ agents, appSettings: settings, globalItems }) {
  const marker = "/* ── Code 页：按伙伴单独调 ── */";
  const start = PAGE_HTML.indexOf(marker);
  const end = PAGE_HTML.indexOf("function toggleInjectionQuick() {", start);
  assert.ok(start > 0 && end > start, "页面里找不到按伙伴那一段脚本");
  const slice = PAGE_HTML.slice(start, end);

  const segs = {};
  const elements = new Map();
  const checks = ["time", "peak", "weather", "special", "todos", "archive", "xingji"].map((id) => ({
    id,
    checked: false,
    disabled: false,
    getAttribute() { return id; },
  }));

  function makeEl(id) {
    const classes = new Set();
    return {
      id,
      checked: false,
      disabled: false,
      value: "",
      innerHTML: "",
      classList: {
        toggle(name, on) { if (on) classes.add(name); else classes.delete(name); },
        contains(name) { return classes.has(name); },
      },
    };
  }

  const document = {
    getElementById(id) {
      if (!elements.has(id)) elements.set(id, makeEl(id));
      return elements.get(id);
    },
    querySelectorAll(selector) {
      return selector === ".code-agent-item-check" ? checks : [];
    },
  };

  function segVal(id) { return segs[id] || ""; }
  function setSeg(id, val) { segs[id] = String(val); }
  function renderCodeAgentItems(items) {
    const on = items && typeof items === "object" ? items : {};
    for (const check of checks) {
      check.checked = (check.id === "peak" || check.id === "time") ? on[check.id] !== false : on[check.id] === true;
    }
  }
  const toasts = [];
  // 默认区那组勾选：测试里直接换这个值，模拟「页面上刚改过、还没保存」
  let currentGlobalItems = globalItems || {};

  const factory = new Function(
    "document", "esc", "segVal", "setSeg", "summaryAgents", "appSettings", "refreshOneSelect", "toast", "renderCodeAgentItems", "codeInjectionItemsFromUI",
    `${slice}
    return {
      switchCodeAgentTarget: switchCodeAgentTarget,
      resetCodeAgentOverride: resetCodeAgentOverride,
      applyCodeAgentSettingsFromServer: applyCodeAgentSettingsFromServer,
      codeAgentSettingsForSave: codeAgentSettingsForSave,
      codeAgentEntryFromEditor: codeAgentEntryFromEditor,
      state: function () { return { map: codeAgentMap, base: codeAgentBase, target: codeAgentTarget, dirty: codeAgentDirty }; },
      markDirty: function () { codeAgentDirty = true; },
    };`,
  );

  const api = factory(
    document,
    (value) => String(value),
    segVal,
    setSeg,
    agents,
    settings,
    () => {},
    (message) => { toasts.push(String(message)); },
    renderCodeAgentItems,
    () => currentGlobalItems,
  );

  return {
    ...api,
    segs,
    segVal,
    setSeg,
    elements,
    checks,
    toasts,
    setGlobalItems(items) { currentGlobalItems = items; },
    itemCheck(id) { return checks.find((check) => check.id === id); },
  };
}

test("页面产物：有伙伴选择器和单独编辑区，脚本能解析", () => {
  for (const id of ["code-agent-select", "code-agent-editor", "code-agent-enabled-seg", "code-agent-mode-seg",
    "code-agent-interval-row", "code-agent-interval-seg", "code-agent-items-override", "code-agent-items", "code-agent-reset-btn"]) {
    assert.ok(PAGE_HTML.includes(`id="${id}"`), `页面里缺 ${id}`);
  }
  assert.match(PAGE_HTML, /function switchCodeAgentTarget/);
  assert.match(PAGE_HTML, /function codeAgentSettingsForSave/);
  assert.match(PAGE_HTML, /codeAgentSettings/);
  assert.match(PAGE_HTML, /总闸管所有伙伴/, "总闸该说清管所有伙伴");
  assert.match(PAGE_HTML, /对 Code 页不起作用/, "聊天那屏的屏蔽只管聊天");
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

test("页面逻辑：草稿在切伙伴时不丢，恢复默认发 null，看不到的伙伴照样保留", () => {
  const agents = [{ agentId: "hanako", agentName: "花子" }, { agentId: "yumi", agentName: "悠米" }];
  const page = loadCodeAgentPage({
    agents,
    appSettings: { codeInjectionItems: { time: true, peak: true, weather: false }, codeInjectMode: "balanced" },
  });

  page.applyCodeAgentSettingsFromServer({
    hanako: { enabled: false, mode: "always" },
    ghost: { enabled: true, intervalHours: 8 },
  });
  let state = page.state();
  assert.equal(state.target, "hanako", "默认选中第一位伙伴");
  assert.deepEqual(state.map.hanako, { enabled: false, mode: "always" });
  assert.equal(page.segVal("code-agent-enabled-seg"), "false");
  assert.equal(page.segVal("code-agent-mode-seg"), "always");
  assert.equal(page.elements.get("code-agent-interval-row").classList.contains("hidden"), true, "常在档不用摆间隔");

  // 改一下再切伙伴：改动收进草稿，切回来还在
  page.setSeg("code-agent-mode-seg", "economical");
  page.switchCodeAgentTarget("yumi");
  assert.deepEqual(page.state().map.hanako, { enabled: false, mode: "economical" }, "切走时把草稿收进表里");
  assert.equal(page.segVal("code-agent-mode-seg"), "inherit", "另一位是跟随默认");
  assert.equal(page.elements.get("code-agent-interval-row").classList.contains("hidden"), false, "跟默认的相伴档要摆间隔");
  page.switchCodeAgentTarget("hanako");
  assert.equal(page.segVal("code-agent-mode-seg"), "economical", "切回来草稿还在");

  // 恢复跟随默认：表里删掉，保存时发 null；看不到的 ghost 原样保留
  page.resetCodeAgentOverride();
  state = page.state();
  assert.equal("hanako" in state.map, false);
  const payload = page.codeAgentSettingsForSave();
  assert.equal(payload.hanako, null, "恢复默认要显式发 null，否则后端无从知道");
  assert.deepEqual(payload.ghost, { enabled: true, intervalHours: 8 }, "看不到的伙伴不该被抹掉");
  assert.equal(page.toasts.length, 1, "恢复默认要给一句回执");
});

test("roundtrip：UI 发的清空标记真能把后端旧值清掉（方式 / 注入项 / 间隔）", () => {
  const agents = [{ agentId: "hanako", agentName: "花子" }];
  const page = loadCodeAgentPage({
    agents,
    appSettings: { codeInjectionItems: { time: true, peak: true, weather: false }, codeInjectMode: "balanced" },
  });
  // 后端已有：单独关了这位伙伴、方式常在、间隔 1 小时、只给它开了天气
  page.applyCodeAgentSettingsFromServer({
    hanako: { enabled: false, mode: "always", intervalHours: 1, items: { weather: true } },
  });

  // 用户在编辑区：方式切回跟随默认、取消「单独设带哪些」、间隔也回跟随默认；启用保持「关」
  page.setSeg("code-agent-mode-seg", "inherit");
  page.setSeg("code-agent-interval-seg", "inherit");
  page.elements.get("code-agent-items-override").checked = false;
  page.markDirty();

  const uiPayload = page.codeAgentSettingsForSave();
  assert.deepEqual(uiPayload, {
    hanako: { enabled: false, mode: null, intervalHours: null, items: null },
  }, "回到跟随默认的字段要显式发 null，只保留还改着的 enabled");

  const isolatedHome = fs.mkdtempSync(path.join(os.tmpdir(), "sgj-code-agent-roundtrip-"));
  const routeUrl = pathToFileURL(path.resolve("routes/ui.js")).href;
  const codeModeUrl = pathToFileURL(path.resolve("lib/code-mode.js")).href;
  const childCode = `
    import registerRoutes from ${JSON.stringify(routeUrl)};
    import { resolveCodeInjection } from ${JSON.stringify(codeModeUrl)};
    const uiPayload = ${JSON.stringify(uiPayload)};
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
    const callPost = (body) => post.handler({ req: { async json() { return body; } }, json(value) { return value; } });
    const callGet = async () => (await get.handler({ json(value) { return value; } })).settings;
    const check = (cond, message) => { if (!cond) throw new Error(message); };

    const seeded = await callPost({ codeAgentSettings: { hanako: { enabled: false, mode: "always", intervalHours: 1, items: { weather: true } } } });
    check(seeded?.ok, "初始设置没存上：" + JSON.stringify(seeded));

    const applied = await callPost({ codeAgentSettings: uiPayload });
    check(applied?.ok, "清空提交被拒：" + JSON.stringify(applied));
    let settings = await callGet();
    check(JSON.stringify(settings.codeAgentSettings) === JSON.stringify({ hanako: { enabled: false } }),
      "清空后只应剩下 enabled：" + JSON.stringify(settings.codeAgentSettings));

    let resolved = resolveCodeInjection(settings, "hanako");
    check(resolved.enabled === false, "这位伙伴单独关着不该被改回来");
    check(resolved.mode === "balanced", "方式该回全局的相伴，实际：" + resolved.mode);
    check(resolved.intervalHours === 4, "间隔该回全局的 4 小时，实际：" + resolved.intervalHours);
    check(resolved.items.weather === false, "天气该回全局默认（不带），实际：" + resolved.items.weather);
    check(resolved.items.peak === true, "别拿清空顺手把别的项弄丢");

    // 单项清除：items 里单个 null 只拿掉那一项
    await callPost({ codeAgentSettings: { hanako: { items: { weather: true, todos: true } } } });
    await callPost({ codeAgentSettings: { hanako: { items: { weather: null } } } });
    settings = await callGet();
    check(JSON.stringify(settings.codeAgentSettings.hanako.items) === JSON.stringify({ todos: true }),
      "单项清除不对：" + JSON.stringify(settings.codeAgentSettings.hanako.items));

    // 最后一个字段也清掉：整条覆盖消失
    await callPost({ codeAgentSettings: { hanako: { enabled: null, items: null } } });
    settings = await callGet();
    check(!("hanako" in settings.codeAgentSettings), "清到空要整条删掉：" + JSON.stringify(settings.codeAgentSettings));
    resolved = resolveCodeInjection(settings, "hanako");
    check(resolved.enabled === true && resolved.mode === "balanced" && resolved.items.todos === false,
      "删干净后该完全跟全局：" + JSON.stringify(resolved));
    console.log(JSON.stringify({ ok: true }));
  `;
  const result = spawnSync(process.execPath, ["--input-type=module", "-e", childCode], {
    encoding: "utf8",
    env: { ...process.env, USERPROFILE: isolatedHome, HOME: isolatedHome, HANA_HOME: path.join(isolatedHome, ".hanako") },
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /"ok":true/);
});

test("页面逻辑：切伙伴时继承展示取表单上未保存的默认勾选", () => {
  const agents = [{ agentId: "hanako", agentName: "花子" }, { agentId: "yumi", agentName: "悠米" }];
  // 用户在默认区刚把天气勾上，还没点保存
  const page = loadCodeAgentPage({
    agents,
    appSettings: { codeInjectionItems: { time: true, peak: true, weather: false }, codeInjectMode: "balanced" },
    globalItems: { time: true, peak: true, weather: true, todos: false },
  });
  page.applyCodeAgentSettingsFromServer({});
  assert.equal(page.itemCheck("weather").checked, true, "继承展示要看表单上刚勾的天气，不是存着的旧值");
  page.switchCodeAgentTarget("yumi");
  assert.equal(page.itemCheck("weather").checked, true, "切到另一位也是同一份未保存默认");

  // 默认区还没渲染（没有勾选元素）时退回存着的全局值
  const fresh = loadCodeAgentPage({
    agents,
    appSettings: { codeInjectionItems: { time: true, peak: true, weather: false }, codeInjectMode: "balanced" },
    globalItems: {},
  });
  fresh.applyCodeAgentSettingsFromServer({});
  assert.equal(fresh.itemCheck("weather").checked, false, "拿不到表单勾选时退回存着的默认");
  assert.equal(fresh.itemCheck("time").checked, true);
});

test("页面逻辑：没初始化好时不拿空表盖掉已有设置，有草稿时不被服务器覆盖", () => {
  const agents = [{ agentId: "hanako", agentName: "花子" }];
  const page = loadCodeAgentPage({ agents, appSettings: { codeInjectionItems: {}, codeInjectMode: "balanced" } });

  page.applyCodeAgentSettingsFromServer(undefined);
  assert.deepEqual(page.state().map, {}, "没有这张表的响应不改动任何东西");

  page.applyCodeAgentSettingsFromServer({ hanako: { mode: "always" } });
  assert.deepEqual(page.state().map.hanako, { mode: "always" });

  // 有未保存草稿时：服务端那份不能把草稿盖掉
  page.markDirty();
  page.setSeg("code-agent-mode-seg", "economical");
  page.applyCodeAgentSettingsFromServer({ hanako: { mode: "balanced" } });
  assert.deepEqual(page.state().map.hanako, { mode: "always" }, "草稿优先于服务器那份");
  assert.deepEqual(page.state().base.hanako, { mode: "balanced" }, "基线还是要更新，免得下次多删一份");
});
