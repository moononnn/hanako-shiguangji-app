// 拾光记 · 会话档案取模型的单元测试
// 覆盖：正常读取、多次切换取最近一条、坏行跳过、文件不存在/损坏不抛、
// 长会话（档案涨到几 MB）仍能读到开头的记录、追加增量能发现新切换。

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { readLatestModelChange, findSessionFile, readLatestModelChangeViaResources, primeSessionModel, getPrimedModel, __clearSessionModelCacheForTest, __setSessionRootForTest } from "../lib/session-model.js";
import { configureDebugLog } from "../lib/debug-log.js";

const TMP = path.join(os.tmpdir(), `sgj-session-model-${Date.now()}`);
fs.mkdirSync(TMP, { recursive: true });
// 库里的告警日志默认会落到配置好的数据目录；测试里改到临时目录，别往真实 debug.log 里掺测试噪音。
configureDebugLog(TMP);
// 会话目录根指向临时目录：宿主会清理真实会话文件，拿真实文件名当断言必然变红。
__setSessionRootForTest(path.join(TMP, "agents"));

function makeSession(lines, name) {
  const file = path.join(TMP, `${name}.jsonl`);
  fs.writeFileSync(file, lines.map((line) => (typeof line === "string" ? line : JSON.stringify(line))).join("\n"), "utf8");
  return file;
}

const MODEL_A = { type: "model_change", timestamp: "2026-10-12T04:06:13.776Z", provider: "minimax", modelId: "MiniMax-M3.1-Flash-Preview" };
const MODEL_B = { type: "model_change", timestamp: "2026-10-12T05:10:00.000Z", provider: "deepseek", modelId: "deepseek-v4-flash" };
const CHAT = (i, size = 20) => ({ type: "message", id: `m${i}`, message: { role: "user", content: "字".repeat(size) } });

test("会话档案：读到最近一条 model_change", () => {
  __clearSessionModelCacheForTest();
  const file = makeSession([MODEL_A, CHAT(1)], "basic");
  const found = readLatestModelChange(file);
  assert.equal(found.provider, "minimax");
  assert.equal(found.modelId, "MiniMax-M3.1-Flash-Preview");
});

test("会话档案：多次切换取时间最近的那条，不是第一条", () => {
  __clearSessionModelCacheForTest();
  const file = makeSession([MODEL_A, CHAT(1), MODEL_B], "switched");
  assert.equal(readLatestModelChange(file).modelId, "deepseek-v4-flash");
});

test("会话档案：末行写到一半的坏 JSON 跳过，继续往前找", () => {
  __clearSessionModelCacheForTest();
  const file = makeSession([MODEL_B, CHAT(1)], "torn");
  fs.appendFileSync(file, '\n{"type":"message","id":"m2","mess', "utf8");
  assert.equal(readLatestModelChange(file).modelId, "deepseek-v4-flash");
});

test("会话档案：没有任何 model_change 时返回 null", () => {
  __clearSessionModelCacheForTest();
  assert.equal(readLatestModelChange(makeSession([CHAT(1)], "none")), null);
});

test("会话档案：文件不存在、路径为空、目录路径都只返回 null 不抛", () => {
  __clearSessionModelCacheForTest();
  assert.equal(readLatestModelChange(path.join(TMP, "missing.jsonl")), null);
  assert.equal(readLatestModelChange(""), null);
  assert.equal(readLatestModelChange(null), null);
  assert.equal(readLatestModelChange(TMP), null);
});

test("会话档案：找不到档案文件时只返回 null 不抛", () => {
  __clearSessionModelCacheForTest();
  assert.equal(findSessionFile("hanako", "根本没有这个会话-0000"), null);
  assert.equal(findSessionFile("", ""), null);
  assert.equal(findSessionFile(null, null), null);
});

test("会话档案：按 agentId + sessionId 能在会话目录里定位到档案", () => {
  __clearSessionModelCacheForTest();
  const dir = path.join(TMP, "agents", "hanako", "sessions");
  fs.mkdirSync(dir, { recursive: true });
  const sessionId = "0000aaaa-bbbb-cccc-dddd-eeeeffff0000";
  const target = path.join(dir, `2026-10-12T04-51-43-520Z_${sessionId}.jsonl`);
  fs.writeFileSync(target, JSON.stringify(MODEL_A), "utf8");

  const found = findSessionFile("hanako", sessionId);
  assert.ok(found, "没找到刚写进去的会话档案");
  assert.ok(fs.statSync(found).isFile());
  assert.equal(readLatestModelChange(found).provider, "minimax");
});

test("会话档案：伙伴不匹配时不会误捞别人家的会话", () => {
  __clearSessionModelCacheForTest();
  assert.equal(findSessionFile("xiansheng", "0000aaaa-bbbb-cccc-dddd-eeeeffff0000"), null);
});

test("会话档案：长会话（十几 MB）仍能读到开头的 model_change", () => {
  __clearSessionModelCacheForTest();
  const filler = Array.from({ length: 40000 }, (_, i) => CHAT(i, 60));
  const file = makeSession([MODEL_A, ...filler], "big");
  assert.ok(fs.statSync(file).size > 8 * 1024 * 1024, "样本要真的超过旧上限才有意义");
  assert.equal(readLatestModelChange(file).provider, "minimax");
});

test("会话档案：只扫新增段也能发现后来切的那次模型", () => {
  __clearSessionModelCacheForTest();
  const file = makeSession([MODEL_A, CHAT(1), CHAT(2)], "growing");
  assert.equal(readLatestModelChange(file).provider, "minimax");

  fs.appendFileSync(file, "\n" + JSON.stringify(CHAT(3)) + "\n", "utf8");
  assert.equal(readLatestModelChange(file).provider, "minimax", "只是聊天记录，沿用上次的模型");

  fs.appendFileSync(file, JSON.stringify(MODEL_B) + "\n", "utf8");
  assert.equal(readLatestModelChange(file).provider, "deepseek", "新增段里出现了 model_change，要更新");
});

// ── 走宿主 ctx.resources 的那一条（1.1.0-beta 实测跑通的正门）──

const RES_ROOT = path.join(TMP, "agents-root");

/** 假 resources：files 是绝对路径 → 内容的映射，模拟宿主 list/read 两种返回形状。 */
function makeResources(files, shape = "items") {
  return {
    async list({ path: dir }) {
      const names = [...files.keys()]
        .filter((p) => path.dirname(p) === dir)
        .map((p) => path.basename(p));
      const items = names.map((name) => ({ name, isDirectory: false, size: files.get(path.join(dir, name)).length }));
      return shape === "array" ? items : { resource: { kind: "local-file" }, items };
    },
    async read({ path: p }) {
      if (!files.has(p)) throw new Error("resource is not a file");
      return shape === "content" ? { content: files.get(p) } : files.get(p);
    },
  };
}

function resSession(name, content) {
  const file = path.join(RES_ROOT, "hanako", "sessions", name);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content, "utf8");
  return file;
}

test("resources 正门：经 list + read 读到当前会话的模型", async () => {
  __clearSessionModelCacheForTest();
  const sessionId = "aaaa0000-1111-2222-3333-444444444444";
  const content = [JSON.stringify(MODEL_B), JSON.stringify(CHAT(1))].join("\n");
  const files = new Map();
  files.set(resSession(`2026-10-13T00-40-00-000Z_${sessionId}.jsonl`, content), content);

  const found = await readLatestModelChangeViaResources(makeResources(files), {
    agentId: "hanako", sessionId, sessionsRoot: RES_ROOT,
  });
  assert.equal(found.provider, "deepseek");
  assert.equal(found.modelId, "deepseek-v4-flash");
});

test("resources 正门：list 返回数组、read 返回 {content} 也认", async () => {
  __clearSessionModelCacheForTest();
  const sessionId = "bbbb0000-1111-2222-3333-444444444444";
  const content = JSON.stringify(MODEL_A);
  const files = new Map();
  files.set(resSession(`2026-10-13T00-41-00-000Z_${sessionId}.jsonl`, content), content);

  const found = await readLatestModelChangeViaResources(makeResources(files, "array"), {
    agentId: "hanako", sessionId, sessionsRoot: RES_ROOT,
  });
  assert.equal(found.provider, "minimax");
});

test("resources 正门：会话不存在 / 读抛错 / 没给 resources，都只返回 null 不抛", async () => {
  __clearSessionModelCacheForTest();
  const content = JSON.stringify(MODEL_A);
  const files = new Map();
  files.set(resSession("2026-10-13T00-42-00-000Z_cccc0000-1111-2222-3333-444444444444.jsonl", content), content);
  const resources = makeResources(files);

  assert.equal(await readLatestModelChangeViaResources(resources, {
    agentId: "hanako", sessionId: "根本不存在的会话", sessionsRoot: RES_ROOT,
  }), null);
  assert.equal(await readLatestModelChangeViaResources(null, { agentId: "hanako", sessionId: "x" }), null);
  assert.equal(await readLatestModelChangeViaResources(resources, { agentId: "", sessionId: "" }), null);

  // 目录里有文件但 read 报错（例如正被写），应静默降级。
  const broken = { async list() { return [{ name: "zz.jsonl", isDirectory: false, size: 1 }]; }, async read() { throw new Error("busy"); } };
  assert.equal(await readLatestModelChangeViaResources(broken, {
    agentId: "hanako", sessionId: "任何", sessionsRoot: RES_ROOT,
  }), null);
});

test("resources 正门：list 把 junction 换成真实路径时，read 必须用换后的那个", async () => {
  __clearSessionModelCacheForTest();
  const sessionId = "eeee0000-1111-2222-3333-444444444444";
  const content = JSON.stringify(MODEL_B);
  const asked = [];
  const realDir = "D:\\HanaHome\\.hanako\\agents\\hanako\\sessions";
  const requestedDir = path.join(RES_ROOT, "hanako", "sessions");
  // 宿主把入参里的 junction 解析成真实路径才返回，所以只认真实路径的 read。
  const resources = {
    async list({ path: dir }) {
      assert.equal(dir, requestedDir, "先按我们给的路径列一次");
      return { resource: { kind: "local-file", path: realDir }, items: [{ name: `2026-10-13T00-44-00-000Z_${sessionId}.jsonl`, isDirectory: false, size: content.length }] };
    },
    async read({ path: p }) {
      asked.push(p);
      if (p !== path.join(realDir, `2026-10-13T00-44-00-000Z_${sessionId}.jsonl`)) {
        throw new Error("resource is not a file: 路径没走真实位置");
      }
      return content;
    },
  };

  const found = await readLatestModelChangeViaResources(resources, {
    agentId: "hanako", sessionId, sessionsRoot: RES_ROOT,
  });
  assert.equal(found.provider, "deepseek");
  assert.equal(asked.length, 1);
  assert.ok(asked[0].startsWith(realDir), "read 应当用 list 还回来的真实路径");
});

test("resources 正门：read 返回 1.1.0-beta 实测形状（content 里再套一层）也要认", async () => {
  __clearSessionModelCacheForTest();
  const sessionId = "ffff0000-1111-2222-3333-444444444444";
  const content = [JSON.stringify(MODEL_B), JSON.stringify(CHAT(1))].join("\n");
  const asked = [];
  const realDir = "D:\\HanaHome\\.hanako\\agents\\hanako\\sessions";
  const name = `2026-10-13T00-45-00-000Z_${sessionId}.jsonl`;
  const resources = {
    async list({ path: dir }) {
      return { resource: { kind: "local-file", path: realDir }, items: [{ name, isDirectory: false, size: content.length }] };
    },
    async read({ path: p }) {
      asked.push(p);
      // 实测形状：content 是对象，里面还套一层；只认嵌套层的资源才算数。
      if (!p.startsWith(realDir)) throw new Error("路径不对");
      return {
        resourceKey: `local-file:${p}`,
        resource: { kind: "local-file", path: p, filePath: p, provider: "local_fs" },
        content: { text: content, mimeType: "application/x-ndjson" },
        version: { mtimeMs: 1, size: content.length },
        filePath: p,
      };
    },
  };

  const found = await readLatestModelChangeViaResources(resources, {
    agentId: "hanako", sessionId, sessionsRoot: RES_ROOT,
  });
  assert.equal(found.provider, "deepseek");
  assert.equal(found.modelId, "deepseek-v4-flash");
});

test("resources 正门：read 按 UTF-8 字节返回（Uint8Array）要能解码，含中文也不乱", async () => {
  __clearSessionModelCacheForTest();
  const sessionId = "99990000-1111-2222-3333-444444444444";
  const content = [JSON.stringify(MODEL_B), JSON.stringify({ type: "message", message: { role: "user", content: "中文也得能解出来" } })].join("\n");
  const realDir = "D:\\HanaHome\\.hanako\\agents\\hanako\\sessions";
  const name = `2026-10-13T00-46-00-000Z_${sessionId}.jsonl`;
  const resources = {
    async list() {
      return { resource: { kind: "local-file", path: realDir }, items: [{ name, isDirectory: false, size: content.length }] };
    },
    async read() {
      // 实测形状：content 是 Uint8Array（describeShape 打成 {0=number,…}）。
      return {
        resourceKey: `local-file:${realDir}\\${name}`,
        resource: { kind: "local-file", path: `${realDir}\\${name}`, filePath: `${realDir}\\${name}`, provider: "local_fs" },
        content: new TextEncoder().encode(content),
        version: { mtimeMs: 1, size: content.length },
        filePath: `${realDir}\\${name}`,
      };
    },
  };

  const found = await readLatestModelChangeViaResources(resources, {
    agentId: "hanako", sessionId, sessionsRoot: RES_ROOT,
  });
  assert.equal(found.provider, "deepseek");
  assert.equal(found.modelId, "deepseek-v4-flash");
});

test("resources 正门：预取后扩展能同步取到，prime 与 get 必须对得上", async () => {
  __clearSessionModelCacheForTest();
  const sessionId = "dddd0000-1111-2222-3333-444444444444";
  const content = JSON.stringify(MODEL_B);
  const files = new Map();
  files.set(resSession(`2026-10-13T00-43-00-000Z_${sessionId}.jsonl`, content), content);

  assert.equal(getPrimedModel("hanako", sessionId), null, "预取前应当取不到");
  await primeSessionModel(makeResources(files), { agentId: "hanako", sessionId, sessionsRoot: RES_ROOT });
  assert.equal(getPrimedModel("hanako", sessionId).provider, "deepseek");
  assert.equal(getPrimedModel("xiansheng", sessionId), null, "不得串到别的伙伴名下");
});