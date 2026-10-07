// 拾光记 · 从插件版搬数据（一次性，幂等，绝不覆盖）
//
// 背景：插件版（plugins/shiguangji）的数据在 <HANA_HOME>/plugin-data/shiguangji/，
// App 版在 <HANA_HOME>/app-data/shiguangji-app/。App 进程的裸 fs 只能碰安装目录与
// 自己的数据目录（Node 权限模型），读插件目录必须走宿主资源接口 ctx.resources.read。
//
// 因此搬法不是「复制文件」，是「解出来再按自己的密钥重新写一遍」：
//   旧 .sgj.key + 旧密文 → 明文 → 本应用自己的密钥 → 新密文
// 这样应用自己的密钥不变（UserData 实例手里的 key 一直有效），也不存在两套密钥打架。
//
// 规矩（顺序即优先级）：
//   ① 目标已经存在同名文件 → 一个都不覆盖，跳过；
//   ② 目标已经有她自己的内容数据（日子/时光册/心情）时，探测阶段就劝退自动搬迁；
//   ③ 搬过就写报告，重复调用不重复搬；失败项允许重试，成功项不重搬；
//   ④ 任何失败都只回报，不抛给调用方，更不打断应用启动。
//
// 什么时候能调：路由或工具里（受权限保护的接口不能在 apply() 装载期调用，
// 否则宿主会判定装载失败并回滚安装记录）。见知识卡片「v2 App 读伙伴资料与记忆单向阀」。

import fs from "node:fs";
import path from "node:path";

import { decryptJson, encryptJson } from "./crypto-store.js";
import { logInfo, logWarn } from "./debug-log.js";

/** 旧版加密存储文件（与 lib/data.js 的 EncryptedStore 一一对应，搬的是同一本账） */
export const LEGACY_ENCRYPTED_FILES = [
  "user-events.dat",
  "todo-reminders.dat",
  "daily-summaries.dat",
  "summary-jobs.dat",
  "moods.dat",
  "mood-harvests.dat",
  "partner-moods.dat",
  "partner-mood-harvests.dat",
  "partner-mood-jobs.dat",
  "settings.dat",
  "data-rev.dat",
  "weather-cache.dat",
  "festival-hint-state.dat",
  "injection-state.dat",
  "deepseek-peak.dat",
];

/** 旧版明文文件：对外快照，本来就是给别的应用读的 */
export const LEGACY_PLAIN_FILES = ["public-today.json"];

export const LEGACY_KEY_FILE = ".sgj.key";

/** 搬迁报告文件名（写在应用自己的数据目录里） */
export const MIGRATION_REPORT_FILE = "migration-report.json";

/**
 * 判定「应用这边已经有她自己的数据」的凭据文件。
 * 只认真的记了东西才会出现的文件：设置、注入状态这类打开就写的不算，
 * 否则她刚装好应用、随手保存一次设置，就会把自己的老账挡在门外。
 */
export const TARGET_CONTENT_FILES = [
  "user-events.dat",
  "daily-summaries.dat",
  "moods.dat",
  "partner-moods.dat",
  "todo-reminders.dat",
];

/** 探测旧目录时先看哪几个：能读到任意一个，就说明「那边有数据」 */
const LEGACY_PROBE_FILES = [
  LEGACY_KEY_FILE,
  "user-events.dat",
  "daily-summaries.dat",
  "moods.dat",
  "settings.dat",
];

/** 旧数据目录：<HANA_HOME>/plugin-data/shiguangji（应用数据目录的上两级就是 HANA_HOME） */
export function resolveLegacyDir(dataDir) {
  const base = String(dataDir || "").trim();
  if (!base) return "";
  return path.resolve(base, "..", "..", "plugin-data", "shiguangji");
}

/** 旧的密钥文本 → 32 字节 Buffer；格式不对返回 null */
export function parseLegacyKey(raw) {
  const text = typeof raw === "string" ? raw.trim() : "";
  if (!text.startsWith("sgj1:")) return null;
  const buf = Buffer.from(text.slice("sgj1:".length), "hex");
  return buf.length === 32 ? buf : null;
}

/** 宿主资源接口的返回内容 → 文本（string / Uint8Array / Buffer 都能认） */
export function toText(value) {
  if (value == null) return null;
  if (typeof value === "string") return value;
  if (value instanceof Uint8Array) return Buffer.from(value).toString("utf8");
  if (typeof value === "object" && typeof value.toString === "function") {
    const text = value.toString("utf8");
    return typeof text === "string" ? text : null;
  }
  return null;
}

/** 读失败的原因分类：被权限挡 vs 文件不存在 vs 其他 */
export function classifyReadFailure(error) {
  const code = String(error?.code || error?.name || "");
  const message = String(error?.message || error || "");
  if (/DENIED|EACCES|EPERM|ACCESS/i.test(code) || /denied|restricted|权限|被拒绝/i.test(message)) return "denied";
  if (/ENOENT|NOT_FOUND|NO_SUCH|not found|不存在/i.test(code + " " + message)) return "missing";
  return "error";
}

function describeFailure(kind, error) {
  const detail = String(error?.message || error || "").trim();
  if (kind === "denied") return `读不到插件目录（权限被挡）${detail ? "：" + detail : ""}`;
  if (kind === "missing") return "文件不存在";
  return detail || "读取失败";
}

/** 读报告（没有或坏掉都返回 null） */
export function readMigrationReport(dataDir) {
  try {
    const raw = fs.readFileSync(path.join(dataDir, MIGRATION_REPORT_FILE), "utf-8");
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

function writeMigrationReport(dataDir, report) {
  try {
    const file = path.join(dataDir, MIGRATION_REPORT_FILE);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const tmp = `${file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(report, null, 2), "utf-8");
    fs.renameSync(tmp, file);
    return true;
  } catch (error) {
    logWarn(`搬迁报告没写成（不影响数据本身）：${error?.message || error}`);
    return false;
  }
}

function targetFileNames(dataDir) {
  try {
    return new Set(fs.readdirSync(dataDir));
  } catch {
    return new Set();
  }
}

/**
 * 探测：旧目录有没有东西、能不能读、应用这边是不是已经有她自己的数据。
 * 只读，不写盘。
 */
export async function probeLegacyMigration({ ctx, dataDir }) {
  const legacyDir = resolveLegacyDir(dataDir);
  const result = {
    ok: true,
    legacyDir,
    available: false,
    denied: false,
    present: [],
    missing: [],
    targetContentFiles: [],
    report: readMigrationReport(dataDir),
    advice: "nothing-to-migrate",
    detail: "",
  };
  if (!legacyDir) {
    result.ok = false;
    result.detail = "拿不到应用数据目录，定位不了插件版数据在哪。";
    return result;
  }
  if (!ctx?.resources?.read) {
    result.ok = false;
    result.advice = "blocked";
    result.detail = "当前宿主没有提供资源读取接口，读不到插件版数据。";
    return result;
  }

  const files = targetFileNames(dataDir);
  result.targetContentFiles = TARGET_CONTENT_FILES.filter((name) => files.has(name));

  let denied = 0;
  for (const name of LEGACY_PROBE_FILES) {
    try {
      const raw = await ctx.resources.read({ kind: "local-file", path: path.join(legacyDir, name) });
      const text = toText(raw?.content ?? raw);
      if (text == null) {
        result.missing.push(name);
        continue;
      }
      result.present.push(name);
    } catch (error) {
      const kind = classifyReadFailure(error);
      if (kind === "denied") {
        denied += 1;
        result.detail = describeFailure(kind, error);
      } else if (kind === "missing") {
        result.missing.push(name);
      } else {
        result.missing.push(name);
        result.detail = describeFailure(kind, error);
      }
    }
  }

  result.available = result.present.length > 0;
  result.denied = denied > 0 && result.present.length === 0;

  const reported = Number(result.report?.migratedCount || 0);
  if (result.report && reported > 0 && !(result.report.failed || []).length) {
    result.advice = "already-migrated";
    result.detail = result.detail || `上次已经搬过 ${reported} 项（${result.report.at || "时间未知"}）。`;
    return result;
  }
  if (result.denied) {
    result.advice = "blocked";
    result.detail = result.detail || "读不到插件版数据目录。";
    return result;
  }
  if (!result.available) {
    result.advice = "nothing-to-migrate";
    result.detail = result.detail || "没找到插件版留下的数据。";
    return result;
  }
  if (result.targetContentFiles.length) {
    result.advice = "target-has-data";
    result.detail = `应用这边已经有自己的记录（${result.targetContentFiles.join("、")}），自动搬迁不会动它们。`;
    return result;
  }
  result.advice = "migrate";
  result.detail = `发现插件版数据：${result.present.join("、")}。`;
  return result;
}

/**
 * 执行搬迁。
 * @param {object} opts
 * @param {object} opts.ctx 应用 ctx（用 ctx.resources.read）
 * @param {string} opts.dataDir 应用自己的数据目录
 * @param {boolean} [opts.force] 她手动点了「搬」：即使应用这边已有数据也逐文件补搬缺的那些（仍然不覆盖）
 * @param {Function} [opts.log] 日志钩子 { info, warn }
 */
export async function runLegacyMigration({ ctx, dataDir, force = false, log = { info: logInfo, warn: logWarn } }) {
  const probe = await probeLegacyMigration({ ctx, dataDir });
  const outcome = {
    ok: false,
    advice: probe.advice,
    legacyDir: probe.legacyDir,
    migrated: [],
    skipped: [],
    failed: [],
    detail: probe.detail,
    report: probe.report,
  };
  if (!probe.ok && probe.advice !== "blocked") return outcome;
  if (!probe.available) {
    outcome.detail = probe.detail || "没找到插件版留下的数据。";
    return outcome;
  }
  if (probe.advice === "already-migrated" && !force) {
    outcome.detail = probe.detail || "之前已经搬过了。";
    return outcome;
  }
  if (probe.advice === "target-has-data" && !force) {
    outcome.detail = probe.detail;
    return outcome;
  }
  if (!ctx?.resources?.read) {
    outcome.detail = "当前宿主没有提供资源读取接口，搬不了。";
    return outcome;
  }

  const legacyDir = probe.legacyDir;
  const readLegacy = async (name) => {
    const raw = await ctx.resources.read({ kind: "local-file", path: path.join(legacyDir, name) });
    return toText(raw?.content ?? raw);
  };

  // 旧密钥：解密用。读不到就没法解旧密文，明文文件仍可以搬。
  let legacyKey = null;
  try {
    const rawKey = await readLegacy(LEGACY_KEY_FILE);
    legacyKey = parseLegacyKey(rawKey);
    if (!legacyKey) outcome.failed.push({ file: LEGACY_KEY_FILE, reason: "旧密钥格式不认识，加密的数据解不开" });
  } catch (error) {
    outcome.failed.push({ file: LEGACY_KEY_FILE, reason: describeFailure(classifyReadFailure(error), error) });
  }

  // 应用自己的密钥：由 UserData 构造时生成/读取，这里再取一次同样拿到它
  let targetKey = null;
  try {
    const { loadOrCreateKey } = await import("./crypto-store.js");
    targetKey = loadOrCreateKey(dataDir);
  } catch (error) {
    outcome.failed.push({ file: "(应用的密钥)", reason: `应用自己的密钥没准备好：${error?.message || error}` });
    return outcome;
  }

  const writeTarget = (name, text) => {
    const file = path.join(dataDir, name);
    fs.mkdirSync(dataDir, { recursive: true });
    const tmp = `${file}.tmp`;
    fs.writeFileSync(tmp, text, "utf-8");
    fs.renameSync(tmp, file);
  };

  for (const name of LEGACY_ENCRYPTED_FILES) {
    if (targetFileNames(dataDir).has(name)) {
      outcome.skipped.push(name);
      continue;
    }
    let cipher = null;
    try {
      cipher = await readLegacy(name);
    } catch (error) {
      const kind = classifyReadFailure(error);
      if (kind === "missing") continue; // 旧版没有这份，正常
      outcome.failed.push({ file: name, reason: describeFailure(kind, error) });
      continue;
    }
    if (!cipher) continue; // 文件不存在（读返回空）
    if (!legacyKey) {
      outcome.failed.push({ file: name, reason: "读不到旧密钥，这份解不开" });
      continue;
    }
    const plain = decryptJson(legacyKey, cipher.trim());
    if (!plain) {
      outcome.failed.push({ file: name, reason: "解不开（旧密钥不匹配或文件已损坏）" });
      continue;
    }
    try {
      writeTarget(name, encryptJson(targetKey, plain));
      outcome.migrated.push(name);
    } catch (error) {
      outcome.failed.push({ file: name, reason: `写入失败：${error?.message || error}` });
    }
  }

  for (const name of LEGACY_PLAIN_FILES) {
    if (targetFileNames(dataDir).has(name)) {
      outcome.skipped.push(name);
      continue;
    }
    let text = null;
    try {
      text = await readLegacy(name);
    } catch (error) {
      const kind = classifyReadFailure(error);
      if (kind === "missing") continue;
      outcome.failed.push({ file: name, reason: describeFailure(kind, error) });
      continue;
    }
    if (!text) continue;
    try {
      JSON.parse(text); // 明文快照：坏 JSON 不搬，免得把坏数据带进来
      writeTarget(name, text.trim());
      outcome.migrated.push(name);
    } catch {
      outcome.failed.push({ file: name, reason: "内容不是合法的 JSON，跳过" });
    }
  }

  const succeeded = outcome.migrated.length > 0 && outcome.failed.length === 0;
  const report = {
    version: 1,
    at: new Date().toISOString(),
    source: legacyDir,
    migrated: outcome.migrated,
    migratedCount: outcome.migrated.length,
    skipped: outcome.skipped,
    failed: outcome.failed,
    keyRead: !!legacyKey,
  };
  const reportWritten = writeMigrationReport(dataDir, report);
  outcome.report = report;
  outcome.reportWritten = reportWritten;
  outcome.ok = succeeded || (outcome.migrated.length > 0 && !outcome.failed.length && probe.advice === "already-migrated");
  outcome.detail = outcome.failed.length
    ? `搬进来 ${outcome.migrated.length} 项，${outcome.failed.length} 项没搬成：${outcome.failed.map((item) => `${item.file}（${item.reason}）`).join("；")}`
    : `搬进来 ${outcome.migrated.length} 项${outcome.skipped.length ? `，${outcome.skipped.length} 项这边已有、没动` : ""}。`;

  if (outcome.migrated.length) log.info?.(`[拾光记] 从插件版搬入 ${outcome.migrated.length} 项：${outcome.migrated.join("、")}`);
  if (outcome.failed.length) log.warn?.(`[拾光记] 插件版数据没搬全：${outcome.detail}`);
  if (!outcome.migrated.length && !outcome.failed.length) log.info?.("[拾光记] 插件版数据没有可搬的项。");
  return outcome;
}
