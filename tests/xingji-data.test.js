// 拾性数据层：加密落盘、幂等、观察消费、人工纠错
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { UserData } from "../lib/data.js";
import { listAllSessionFiles } from "../lib/day-summary.js";

function tmpDir(tag) {
  return fs.mkdtempSync(path.join(os.tmpdir(), `shiguangji-xingji-${tag}-`));
}

test("拾性扫描：归档子目录里的会话也会被列出", () => {
  const dir = tmpDir("list-sessions");
  const sessions = path.join(dir, "hanako", "sessions");
  fs.mkdirSync(path.join(sessions, "archived"), { recursive: true });
  fs.writeFileSync(path.join(sessions, "2026-06-01T00-00-00-000Z_a.jsonl"), "");
  fs.writeFileSync(path.join(sessions, "archived", "2026-05-31T00-00-00-000Z_b.jsonl"), "");
  fs.writeFileSync(path.join(sessions, "archived", "x.jsonl.repair.json"), "{}");
  fs.writeFileSync(path.join(sessions, "session-meta.json"), "{}");
  const files = listAllSessionFiles({ agentsDir: dir });
  assert.equal(files.length, 2);
  assert.ok(files.some((file) => file.sessionPath.includes("archived")));
  assert.ok(files.every((file) => file.agentId === "hanako"));
});
test("拾性：默认关，观察与注入是两个开关", () => {
  const ud = new UserData(tmpDir("defaults"));
  const s = ud.getSettings();
  assert.equal(s.xingjiEnabled, false);
  assert.equal(s.xingjiInjectionEnabled, false);
});

test("拾性：观察追加去重、加密落盘、重启可读", async () => {
  const dir = tmpDir("observations");
  const ud = new UserData(dir);
  await ud.addXingjiObservations("hanako", [
    { id: "o1", day: "2026-09-01", situation: "要删校验", behavior: "先拦下", evidence: "删了会重复提交" },
    { id: "o1", day: "2026-09-01", situation: "要删校验", behavior: "先拦下", evidence: "删了会重复提交" },
  ]);
  await ud.addXingjiObservations("hanako", [
    { id: "o2", day: "2026-09-08", situation: "被夸", behavior: "先自嘲一句", evidence: "哈哈我今天也就那样" },
  ]);
  const profile = ud.getXingjiProfile("hanako");
  assert.equal(profile.pending.length, 2, "同 id 不应重复写");

  const raw = fs.readFileSync(path.join(dir, "xingji.dat"), "utf-8");
  assert.ok(!raw.includes("删了会重复提交"), "观察原文必须加密");

  const restored = new UserData(dir).getXingjiProfile("hanako");
  assert.equal(restored.pending.length, 2);
  assert.equal(restored.pending[0].evidence, "删了会重复提交");
});

test("拾性：归纳落库后消费掉引用的观察，其余留着", async () => {
  const ud = new UserData(tmpDir("rollup"));
  await ud.addXingjiObservations("hanako", [
    { id: "o1", day: "2026-09-01", situation: "s1", behavior: "b1", evidence: "e1" },
    { id: "o2", day: "2026-09-08", situation: "s2", behavior: "b2", evidence: "e2" },
  ]);
  await ud.saveXingjiRollup("hanako", {
    entries: [{ id: "xj-1", situation: "s1", behavior: "b1", positives: [{ date: "2026-09-01", text: "e1" }], negatives: [] }],
    consumedIds: ["o1"],
    rolledAt: "2026-09-10T00:00:00.000Z",
  });
  const profile = ud.getXingjiProfile("hanako");
  assert.equal(profile.entries.length, 1);
  assert.equal(profile.pending.length, 1, "没被消费的观察要继续攒");
  assert.equal(profile.pending[0].id, "o2");
  assert.equal(profile.lastRollupAt, "2026-09-10T00:00:00.000Z");
});

test("拾性：人工拉黑后条目留在库里但标记为 rejected", async () => {
  const ud = new UserData(tmpDir("reject"));
  await ud.saveXingjiRollup("hanako", {
    entries: [{ id: "xj-1", situation: "s", behavior: "b", positives: [], negatives: [] }],
    consumedIds: [],
    rolledAt: "2026-09-10T00:00:00.000Z",
  });
  const updated = await ud.updateXingjiEntry("hanako", "xj-1", { status: "rejected", rejectedReason: "不像它" });
  assert.equal(updated.status, "rejected");
  assert.equal(ud.getXingjiProfile("hanako").entries[0].rejectedReason, "不像它");
});

test("拾性：日采状态幂等，重启后仍读得到", async () => {
  const dir = tmpDir("harvest");
  const ud = new UserData(dir);
  await ud.updateXingjiHarvestState("2026-09-01", "hanako", { status: "completed", observationCount: 2 });
  const restored = new UserData(dir).getXingjiHarvestState("2026-09-01", "hanako");
  assert.equal(restored.status, "completed");
  assert.equal(restored.observationCount, 2);
  assert.equal(ud.getXingjiHarvestState("2026-09-01", "other"), null);
});

test("拾性：日志最新在前且按伙伴可筛", async () => {
  const ud = new UserData(tmpDir("logs"));
  await ud.appendXingjiLog({ agentId: "hanako", type: "entry-reject", detail: "a" });
  await ud.appendXingjiLog({ agentId: "other", type: "entry-edit", detail: "b" });
  assert.equal(ud.listXingjiLogs().length, 2);
  const mine = ud.listXingjiLogs("hanako");
  assert.equal(mine.length, 1);
  assert.equal(mine[0].type, "entry-reject");
});

test("拾性：只有空档案不建档", async () => {
  const ud = new UserData(tmpDir("empty"));
  assert.deepEqual(ud.listXingjiAgentIds(), []);
  await ud.addXingjiObservations("hanako", [{ id: "o1", day: "2026-09-01", evidence: "e" }]);
  assert.deepEqual(ud.listXingjiAgentIds(), ["hanako"]);
});

test("拾性补档：单任务、可恢复、不重复开", async () => {
  const dir = tmpDir("job");
  const ud = new UserData(dir);
  assert.equal(ud.getXingjiJob(), null);
  const job = await ud.createXingjiJob({ dates: ["2026-09-01", "2026-09-02", "bad"] });
  assert.deepEqual(job.dates, ["2026-09-01", "2026-09-02"], "非法日期要被过滤掉");
  assert.equal(job.status, "queued");
  await assert.rejects(() => ud.createXingjiJob({ dates: ["2026-09-03"] }), /已经有一项/);
  await ud.updateXingjiJob({ status: "completed", done: ["2026-09-01", "2026-09-02"] });
  const restored = new UserData(dir).getXingjiJob();
  assert.equal(restored.status, "completed");
  assert.deepEqual(restored.done, ["2026-09-01", "2026-09-02"]);
});

test("拾性扫描：按天分桶落盘、只存事件卡、可重启读回", async () => {
  const dir = tmpDir("scan");
  const ud = new UserData(dir);
  await ud.saveXingjiScan({
    days: {
      "2026-09-01": {
        hanako: [{ ts: 1, day: "2026-09-01", kind: "refuse", userText: "删了吧", replyText: "不行，那是校验" }],
      },
      "2026-09-02": { hanako: [{ ts: 2, day: "2026-09-02", kind: "joke", userText: "", replyText: "哈哈尽力了" }] },
      bad: { hanako: [{ ts: 3 }] },
    },
    scannedAt: "2026-10-18T00:00:00.000Z",
    sessionCount: 12,
    eventCount: 2,
  });
  const summary = ud.getXingjiScanSummary();
  assert.equal(summary.dayCount, 2, "非法日期要被过滤");
  assert.equal(summary.firstDay, "2026-09-01");
  assert.equal(summary.lastDay, "2026-09-02");

  const day = new UserData(dir).getXingjiScanDay("2026-09-01");
  assert.equal(day.hanako.length, 1);
  assert.equal(day.hanako[0].replyText, "不行，那是校验");
  assert.deepEqual(ud.getXingjiScanDay("2026-09-09"), {});

  const raw = fs.readFileSync(path.join(dir, "xingji.dat"), "utf-8");
  assert.ok(!raw.includes("不行，那是校验"), "扫描结果也要加密");
});

test("拾性重跑：只清拾性自己的账，设置与其他数据不碰", async () => {
  const dir = tmpDir("reset");
  const ud = new UserData(dir);
  await ud.updateSettings({ xingjiEnabled: true });
  await ud.addXingjiObservations("hanako", [{ id: "o1", day: "2026-09-01", situation: "s", behavior: "b", evidence: "e" }]);
  await ud.saveXingjiRollup("hanako", {
    entries: [{ id: "e1", kind: "pattern", situation: "s", behavior: "b", positives: [{ date: "2026-09-01", text: "x" }], negatives: [] }],
    consumedIds: [],
    rolledAt: "2026-09-02T00:00:00.000Z",
  });
  await ud.updateXingjiHarvestState("2026-09-01", "hanako", { status: "completed" });
  await ud.saveXingjiScan({ days: { "2026-09-01": { hanako: [{ kind: "refuse" }] } }, scannedAt: "x", sessionCount: 1, eventCount: 1 });

  const before = ud.getSettings();
  const stats = await ud.resetXingji();
  assert.equal(stats.entries, 1);
  assert.equal(stats.pending, 1);
  assert.equal(stats.scanDays, 1);

  assert.deepEqual(ud.getXingjiProfile("hanako").entries, []);
  assert.deepEqual(ud.getXingjiProfile("hanako").pending, []);
  assert.equal(ud.getXingjiHarvestState("2026-09-01", "hanako"), null);
  assert.equal(ud.getXingjiScanSummary(), null);
  assert.equal(ud.getXingjiJob(), null);
  assert.equal(ud.getSettings().xingjiEnabled, true, "设置不能被顺手关掉");
  assert.deepEqual(ud.getSettings(), before);
});

test("拾性重跑：清空后重新写入是干净的一遍，旧证据不残留", async () => {
  const dir = tmpDir("reset-reuse");
  const ud = new UserData(dir);
  await ud.addXingjiObservations("hanako", [{ id: "o1", day: "2026-09-01", situation: "s", behavior: "b", evidence: "e" }]);
  await ud.resetXingji();
  await ud.addXingjiObservations("hanako", [{ id: "o2", day: "2026-10-01", situation: "s2", behavior: "b2", evidence: "e2" }]);
  const profile = ud.getXingjiProfile("hanako");
  assert.equal(profile.pending.length, 1);
  assert.equal(profile.pending[0].id, "o2");
});
