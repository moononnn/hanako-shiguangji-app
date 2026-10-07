// 拾光记 · 从插件版搬数据（migrate-legacy）测试
//
// 守四件事：
//  ① 只在她自己还没记东西的时候才自动搬（避免覆盖应用里已有的账）；
//  ② 一个文件都不覆盖，逐文件判断；
//  ③ 旧密文用旧密钥解开、再用应用自己的密钥重新写，搬完应用能正常读到；
//  ④ 读不到、解不开、坏文件都只回报不炸，重复调用不重复搬。
process.env.TZ = "Asia/Shanghai";

import { test } from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import fs from "node:fs";
import { mkdtempSync } from "node:fs";

import { decryptJson, encryptJson } from "../lib/crypto-store.js";
import {
  LEGACY_KEY_FILE,
  MIGRATION_REPORT_FILE,
  TARGET_CONTENT_FILES,
  classifyReadFailure,
  parseLegacyKey,
  probeLegacyMigration,
  resolveLegacyDir,
  runLegacyMigration,
  toText,
} from "../lib/migrate-legacy.js";

const OLD_KEY = Buffer.alloc(32, 7);
const LEGACY_KEY_TEXT = `sgj1:${OLD_KEY.toString("hex")}`;
const silentLog = { info() {}, warn() {} };

/** 造一套「HANA_HOME + 插件数据目录 + 应用数据目录」的临时现场 */
function makeHome({ legacy = {}, target = {}, deny = false, readFails = {} } = {}) {
  const home = mkdtempSync(path.join(os.tmpdir(), "shiguangji-migrate-"));
  const legacyDir = path.join(home, "plugin-data", "shiguangji");
  const dataDir = path.join(home, "app-data", "shiguangji-app");
  fs.mkdirSync(legacyDir, { recursive: true });
  fs.mkdirSync(dataDir, { recursive: true });
  for (const [name, content] of Object.entries(legacy)) fs.writeFileSync(path.join(legacyDir, name), content);
  for (const [name, content] of Object.entries(target)) fs.writeFileSync(path.join(dataDir, name), content);
  const ctx = {
    resources: {
      async read({ path: filePath }) {
        if (deny) {
          throw Object.assign(new Error("Access to this API has been restricted"), { code: "APP_RESOURCE_DENIED" });
        }
        const base = path.basename(filePath);
        if (readFails[base]) throw Object.assign(new Error("boom"), { code: readFails[base] });
        return { content: fs.readFileSync(filePath, "utf-8") };
      },
    },
  };
  return { home, legacyDir, dataDir, ctx };
}

// ── 纯函数 ──

test("旧目录按应用数据目录的上两级推出来", () => {
  const derived = resolveLegacyDir(path.join("C:", "hana", "app-data", "shiguangji-app"));
  assert.equal(path.basename(derived), "shiguangji");
  assert.equal(path.basename(path.dirname(derived)), "plugin-data");
  assert.equal(resolveLegacyDir(""), "");
});

test("旧密钥只认 sgj1: 前缀的 32 字节十六进制", () => {
  assert.ok(parseLegacyKey(LEGACY_KEY_TEXT));
  assert.equal(parseLegacyKey(LEGACY_KEY_TEXT).length, 32);
  assert.equal(parseLegacyKey("sgj1:abcd"), null);
  assert.equal(parseLegacyKey("随便一串"), null);
  assert.equal(parseLegacyKey(undefined), null);
});

test("读失败分得清「被权限挡」和「文件不存在」", () => {
  assert.equal(classifyReadFailure(Object.assign(new Error("Access denied"), { code: "APP_RESOURCE_DENIED" })), "denied");
  assert.equal(classifyReadFailure(Object.assign(new Error("no such file"), { code: "ENOENT" })), "missing");
  assert.equal(classifyReadFailure(new Error("说不清哪里不对")), "error");
});

test("宿主返回的内容形态都能转成文本", () => {
  assert.equal(toText("abc"), "abc");
  assert.equal(toText(Buffer.from("中文", "utf-8")), "中文");
  assert.equal(toText(null), null);
});

// ── 探测 ──

test("探测：插件目录有数据、应用这边还空着 → 建议搬", async () => {
  const { dataDir, ctx } = makeHome({
    legacy: { [LEGACY_KEY_FILE]: LEGACY_KEY_TEXT, "user-events.dat": encryptJson(OLD_KEY, { events: { a: 1 } }) },
  });
  const probe = await probeLegacyMigration({ ctx, dataDir });
  assert.equal(probe.available, true);
  assert.equal(probe.denied, false);
  assert.equal(probe.advice, "migrate");
  assert.deepEqual(probe.targetContentFiles, []);
});

test("探测：读插件目录被挡下来时如实说被挡，不冒充「没有数据」", async () => {
  const { dataDir, ctx } = makeHome({ legacy: { [LEGACY_KEY_FILE]: LEGACY_KEY_TEXT }, deny: true });
  const probe = await probeLegacyMigration({ ctx, dataDir });
  assert.equal(probe.advice, "blocked");
  assert.equal(probe.denied, true);
  assert.equal(probe.available, false);
  assert.match(probe.detail, /读不到插件版数据目录|权限被挡/);
});

test("探测：应用这边已经有她自己的记录 → 自动搬迁劝退", async () => {
  const { dataDir, ctx } = makeHome({
    legacy: { [LEGACY_KEY_FILE]: LEGACY_KEY_TEXT, "user-events.dat": encryptJson(OLD_KEY, { events: {} }) },
    target: { "daily-summaries.dat": encryptJson(Buffer.alloc(32, 1), { summaries: {} }) },
  });
  const probe = await probeLegacyMigration({ ctx, dataDir });
  assert.equal(probe.advice, "target-has-data");
  assert.deepEqual(probe.targetContentFiles, ["daily-summaries.dat"]);
});

test("探测：插件目录什么都没有 → 无数据可搬", async () => {
  const { dataDir, ctx } = makeHome({});
  const probe = await probeLegacyMigration({ ctx, dataDir });
  assert.equal(probe.advice, "nothing-to-migrate");
  assert.equal(probe.available, false);
});

// ── 搬迁 ──

test("搬迁：旧密文搬过来后能用应用自己的密钥正常解开，内容一字不差", async () => {
  const events = { events: { "ev-1": { id: "ev-1", title: "给薄荷浇水", type: "todo", date: "2026-10-05" } } };
  const summaries = { summaries: { "2026-10-04": { byAgent: { hanako: "那天聊了很多" } } } };
  const { dataDir, ctx } = makeHome({
    legacy: {
      [LEGACY_KEY_FILE]: LEGACY_KEY_TEXT,
      "user-events.dat": encryptJson(OLD_KEY, events),
      "daily-summaries.dat": encryptJson(OLD_KEY, summaries),
    },
  });
  const result = await runLegacyMigration({ ctx, dataDir, log: silentLog });
  assert.equal(result.ok, true);
  assert.deepEqual(result.migrated.sort(), ["daily-summaries.dat", "user-events.dat"]);
  assert.deepEqual(result.failed, []);

  // 应用自己的密钥（搬之前就有了，没被换掉）能读出新写的那份
  const { loadOrCreateKey } = await import("../lib/crypto-store.js");
  const targetKey = loadOrCreateKey(dataDir);
  assert.deepEqual(decryptJson(targetKey, fs.readFileSync(path.join(dataDir, "user-events.dat"), "utf-8")), events);
  assert.deepEqual(decryptJson(targetKey, fs.readFileSync(path.join(dataDir, "daily-summaries.dat"), "utf-8")), summaries);
  // 旧密钥没被改：目标目录里的密钥还是应用自己那份，不等于旧密钥
  assert.notEqual(fs.readFileSync(path.join(dataDir, LEGACY_KEY_FILE), "utf-8").trim(), LEGACY_KEY_TEXT);
  assert.equal(decryptJson(OLD_KEY, fs.readFileSync(path.join(dataDir, "user-events.dat"), "utf-8")), null);
});

test("搬迁：目标已有同名文件时不搬、不覆盖", async () => {
  const mine = encryptJson(Buffer.alloc(32, 9), { events: { mine: { id: "mine" } } });
  const theirs = encryptJson(OLD_KEY, { events: { theirs: { id: "theirs" } } });
  const { dataDir, ctx } = makeHome({
    legacy: { [LEGACY_KEY_FILE]: LEGACY_KEY_TEXT, "user-events.dat": theirs },
    target: { "user-events.dat": mine },
  });
  const result = await runLegacyMigration({ ctx, dataDir, log: silentLog });
  assert.equal(result.advice, "target-has-data");
  assert.deepEqual(result.migrated, []);
  assert.equal(fs.readFileSync(path.join(dataDir, "user-events.dat"), "utf-8"), mine);
});

test("搬迁：读写密钥对不上时只报失败，不写坏文件", async () => {
  const wrongKey = Buffer.alloc(32, 3);
  const { dataDir, ctx } = makeHome({
    legacy: {
      [LEGACY_KEY_FILE]: LEGACY_KEY_TEXT,
      "moods.dat": encryptJson(wrongKey, { moods: { "2026-10-05": [] } }),
    },
  });
  const result = await runLegacyMigration({ ctx, dataDir, log: silentLog });
  assert.equal(result.migrated.length, 0);
  assert.equal(result.failed.length, 1);
  assert.match(result.failed[0].reason, /解不开/);
  assert.equal(fs.existsSync(path.join(dataDir, "moods.dat")), false);
});

test("搬迁：明文快照照搬，坏 JSON 不搬", async () => {
  const snapshot = JSON.stringify({ schemaVersion: 1, today: { date: "2026-10-05" } });
  const { dataDir, ctx } = makeHome({
    legacy: {
      [LEGACY_KEY_FILE]: LEGACY_KEY_TEXT,
      "public-today.json": snapshot,
      "weather-cache.dat": encryptJson(OLD_KEY, { weather: { temp: 22 } }),
    },
  });
  const broken = makeHome({
    legacy: { [LEGACY_KEY_FILE]: LEGACY_KEY_TEXT, "public-today.json": "{坏掉的" },
  });
  const result = await runLegacyMigration({ ctx, dataDir, log: silentLog });
  assert.ok(result.migrated.includes("public-today.json"));
  assert.equal(fs.readFileSync(path.join(dataDir, "public-today.json"), "utf-8"), snapshot);

  const brokenResult = await runLegacyMigration({ ctx: broken.ctx, dataDir: broken.dataDir, log: silentLog });
  assert.equal(brokenResult.migrated.includes("public-today.json"), false);
  assert.match(brokenResult.failed.map((item) => item.reason).join(" "), /合法的 JSON/);
});

test("搬迁：写一份报告；再跑一次不重复搬", async () => {
  const { dataDir, ctx } = makeHome({
    legacy: { [LEGACY_KEY_FILE]: LEGACY_KEY_TEXT, "user-events.dat": encryptJson(OLD_KEY, { events: {} }) },
  });
  const first = await runLegacyMigration({ ctx, dataDir, log: silentLog });
  assert.equal(first.migrated.length, 1);
  const report = JSON.parse(fs.readFileSync(path.join(dataDir, MIGRATION_REPORT_FILE), "utf-8"));
  assert.equal(report.migratedCount, 1);
  assert.equal(report.keyRead, true);

  const second = await runLegacyMigration({ ctx, dataDir, log: silentLog });
  assert.equal(second.advice, "already-migrated");
  assert.equal(second.migrated.length, 0);

  const probe = await probeLegacyMigration({ ctx, dataDir });
  assert.equal(probe.advice, "already-migrated");
});

test("搬迁：她自己点了搬时，应用已有数据也把缺的那些补上，已存在的仍不动", async () => {
  const mine = encryptJson(Buffer.alloc(32, 5), { moods: { "2026-10-06": [] } });
  const { dataDir, ctx } = makeHome({
    legacy: {
      [LEGACY_KEY_FILE]: LEGACY_KEY_TEXT,
      "user-events.dat": encryptJson(OLD_KEY, { events: { old: { id: "old" } } }),
      "daily-summaries.dat": encryptJson(OLD_KEY, { summaries: { "2026-09-01": { byAgent: {} } } }),
    },
    target: { "daily-summaries.dat": mine },
  });
  const auto = await runLegacyMigration({ ctx, dataDir, log: silentLog });
  assert.equal(auto.migrated.length, 0);
  assert.equal(auto.advice, "target-has-data");

  const forced = await runLegacyMigration({ ctx, dataDir, force: true, log: silentLog });
  assert.deepEqual(forced.migrated, ["user-events.dat"]);
  assert.deepEqual(forced.skipped, ["daily-summaries.dat"]);
  assert.equal(fs.readFileSync(path.join(dataDir, "daily-summaries.dat"), "utf-8"), mine);
});

test("搬迁：探测到的那几个凭据文件就是「她已经有数据」的判据", () => {
  assert.deepEqual(TARGET_CONTENT_FILES, ["user-events.dat", "daily-summaries.dat", "moods.dat", "partner-moods.dat", "todo-reminders.dat"]);
});

test("搬迁不在装载期发生：主入口里不出现受权限保护的资源调用", () => {
  // apply() 里调 ctx.resources.* 会让宿主判定装载失败并回滚安装记录，
  // 所以读插件目录只能待在路由里。这条断言防以后顺手把它挪回装载期。
  const appRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1")), "..");
  const source = fs.readFileSync(path.join(appRoot, "index.js"), "utf-8");
  const applyBody = source.slice(source.indexOf("export async function apply"));
  assert.equal(/ctx\.resources/.test(applyBody), false);
  assert.ok(fs.readFileSync(path.join(appRoot, "routes", "ui.js"), "utf-8").includes("runLegacyMigration"));
});

test("界面：搬数据那一块默认隐藏，只在有插件版数据时才露面", () => {
  // 这是一次性的功能，不该在没数据的人面前常驻。改成常驻之前先让这条测试拦一下。
  const appRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1")), "..");
  const source = fs.readFileSync(path.join(appRoot, "lib", "page-template.js"), "utf-8");
  assert.match(source, /class="set-group hidden" id="legacy-migration-group"/);
  assert.match(source, /classList\.toggle\('hidden',[^)]*nothing-to-migrate/);
  // 也不留首页横幅那类插入式入口
  assert.equal(/legacy-banner/.test(source), false);
  // 给用户看的那几行文案里不许出现内部文件名
  const uiText = source.slice(source.indexOf("function legacyProbeText"), source.indexOf("function legacyLinkText"));
  assert.equal(/\.dat|\.sgj\.key|targetContentFiles/.test(uiText), false);
});
