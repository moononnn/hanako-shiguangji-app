// 拾性（性格补全）纯逻辑测试
// 重点守三件事：只收能落到原文的证据、样本不够不冒头、触发词不能凭空编。

import test from "node:test";
import assert from "node:assert/strict";

import {
  CHARACTER_EVENT_KINDS,
  XINGJI_DEVIATION_MIN_DISTINCT_DAYS,
  XINGJI_DEVIATION_MIN_POSITIVES,
  XINGJI_INJECT_MAX_ENTRIES,
  XINGJI_LIKELY_DISTINCT_DAYS,
  XINGJI_MIN_DISTINCT_DAYS,
  XINGJI_MIN_POSITIVES,
  applyRollup,
  buildObservationPrompt,
  buildRollupPrompt,
  buildStyleProfiles,
  buildXingjiInjectionText,
  capEventList,
  classifyGenericBehavior,
  detectGenericHabits,
  dominantRelation,
  evaluateEntry,
  findCharacterEvents,
  formatGenericHabitsNote,
  genericHabitsFromBaseline,
  hasCharacterEvent,
  isVisibleEntry,
  mergeObservationIntoEntry,
  normalizeEntryKind,
  parseObservationOutput,
  parseRollupOutput,
  pickInjectableEntries,
  pushEvidence,
  resolveGenericHabits,
  sceneOf,
  stripInternalBlocks,
} from "../lib/xingji.js";

function mk(ts, role, text, agentId = "hanako") {
  return { ts, role, agentId, text };
}

const DAY = 86400000;
const BASE = new Date("2026-09-01T10:00:00").getTime();

// 造 count 段证据，落在 count 个不同的日子上（间隔 5 天，跨度随 count 增长）。
function mkDays(count) {
  return Array.from({ length: count }, (_, i) => ({
    date: new Date(BASE + i * 5 * DAY).toISOString().slice(0, 10),
    text: `证据${i}`,
  }));
}

test("事件预筛：挑出反对与自我修正，跳过平淡回复", () => {
  const rows = [
    mk(BASE, "user", "你把那段代码删掉吧"),
    mk(BASE + 1000, "assistant", "不行，那段是校验，删了会重复提交"),
    mk(BASE + 2000, "user", "那你说怎么办"),
    mk(BASE + 3000, "assistant", "我刚才说得太急了，我改一下说法"),
    mk(BASE + 4000, "user", "好"),
    mk(BASE + 5000, "assistant", "嗯，那就这样改，我先把校验提到前面，再处理重复的问题"),
  ];
  const events = findCharacterEvents(rows, "hanako");
  assert.equal(events.length, 2, JSON.stringify(events));
  assert.deepEqual(events.map((e) => e.kind).sort(), ["refuse", "self_correct"]);
  assert.ok(events[0].userText, "事件要带紧邻的上一句");
});

test("事件预筛：同类型最多两条，不按 agent 串台", () => {
  const rows = [];
  for (let i = 0; i < 5; i += 1) {
    rows.push(mk(BASE + i * 1000, "assistant", `不行，这个做法我不能同意，会影响后面 ${i}`));
  }
  rows.push(mk(BASE + 9000, "assistant", "不行，这条是别人的", "other"));
  const events = findCharacterEvents(rows, "hanako");
  assert.equal(events.length, 2);
  assert.ok(events.every((e) => e.kind === "refuse"));
  assert.equal(findCharacterEvents(rows, "other").length, 1);
});

test("事件预筛：空输入与无 agentId 安全返回", () => {
  assert.deepEqual(findCharacterEvents([], "hanako"), []);
  assert.deepEqual(findCharacterEvents([mk(1, "assistant", "不行")], ""), []);
  assert.equal(hasCharacterEvent([mk(1, "assistant", "嗯")], "hanako"), false);
});

test("全量扫描：多个会话合到同一天后按桶再裁一次", () => {
  const many = Array.from({ length: 10 }, (_, i) => ({ ts: i, day: "2026-09-01", kind: "refuse", userText: "u", replyText: `r${i}` }));
  const capped = capEventList(many, 8);
  assert.equal(capped.length, 2, "同类型最多两条");
  const mixed = [
    ...Array.from({ length: 3 }, (_, i) => ({ kind: "refuse" })),
    ...Array.from({ length: 3 }, (_, i) => ({ kind: "joke" })),
    ...Array.from({ length: 3 }, (_, i) => ({ kind: "self_correct" })),
  ];
  assert.equal(capEventList(mixed, 8).length, 6);
});

test("事件预筛：事件类型都来自白名单", () => {
  const allowed = new Set(CHARACTER_EVENT_KINDS);
  const rows = [
    mk(BASE, "user", "我今天累死了"),
    mk(BASE + 1000, "assistant", "先别干了，过来把话说一半就停在这儿，明天再接着弄也不迟"),
    mk(BASE + 2000, "user", "嗯"),
    mk(BASE + 3000, "assistant", "哈哈那行"),
  ];
  for (const item of findCharacterEvents(rows, "hanako")) {
    assert.ok(allowed.has(item.kind), `未知事件类型 ${item.kind}`);
  }
});

test("观察解析：证据必须在当天原文里找得到", () => {
  const source = "不行，那段是校验，删了会重复提交。我刚才说得太急了，我改一下说法。";
  const raw = JSON.stringify([
    { situation: "对方要删校验", behavior: "先拦下再说明后果", evidence: "删了会重复提交", polarity: "pos" },
    { situation: "对方追问", behavior: "承认自己说快了", evidence: "我刚才说得太急了", polarity: "pos" },
    { situation: "编的", behavior: "编的动作", evidence: "这句话原文里没有", polarity: "pos" },
  ]);
  const out = parseObservationOutput(raw, { sourceText: source });
  assert.equal(out.length, 2);
  assert.ok(!out.some((o) => o.evidence.includes("原文里没有")));
});

test("观察解析：形容词式行为直接拒收", () => {
  const source = "她问的时候你先接情绪再说办法";
  const raw = JSON.stringify([
    { situation: "她难过", behavior: "很温柔很理性", evidence: "先接情绪", polarity: "pos" },
  ]);
  assert.deepEqual(parseObservationOutput(raw, { sourceText: source }), []);
});

test("观察解析：围栏、空数组、坏 JSON 都不炸", () => {
  assert.deepEqual(parseObservationOutput("", {}), []);
  assert.deepEqual(parseObservationOutput("```json\n[]\n```", {}), []);
  assert.deepEqual(parseObservationOutput("不是 JSON", {}), []);
  const fenced = parseObservationOutput(
    "```json\n[{\"situation\":\"a\",\"behavior\":\"b\",\"evidence\":\"c\"}]\n```",
    {},
  );
  assert.equal(fenced.length, 1, "没有原文时不强校验，交给调用方决定");
});

test("观察解析：最多三条", () => {
  const items = Array.from({ length: 6 }, (_, i) => ({ situation: `s${i}`, behavior: `b${i}`, evidence: `e${i}` }));
  assert.equal(parseObservationOutput(JSON.stringify(items), {}).length, 3);
});

// ── 观察与设定的对照 ──
// 不判「符合/违背」，只判「设定里写过没有」。「写了温柔但会直接指错」不算矛盾，
// 而是一条设定里没写出来的具体做法，这种条目才是补全的那一笔。
test("观察解析：relation 只认 described / unwritten，其余一律留空", () => {
  const source = "你说错了，我直接讲。";
  const raw = JSON.stringify([
    { situation: "a", behavior: "先指错再说", evidence: "你说错了", relation: "described" },
    { situation: "b", behavior: "说完不补安慰", evidence: "我直接讲", relation: "unwritten" },
    { situation: "c", behavior: "顺手给替代方案", evidence: "我直接讲", relation: "违背设定" },
  ]);
  const out = parseObservationOutput(raw, { sourceText: source });
  assert.deepEqual(out.map((o) => o.relation), ["described", "unwritten", ""]);
});

test("证据入账：relation 跟着证据存，老数据没有就不添字段", () => {
  const withRelation = pushEvidence([], { date: "2026-09-01", text: "你说错了", relation: "unwritten" });
  assert.equal(withRelation[0].relation, "unwritten");
  const legacy = pushEvidence([], { date: "2026-09-01", text: "你说错了" });
  assert.equal("relation" in legacy[0], false);
});

test("条目对照：证据多的那一边算数，没有带 relation 的证据就留空", () => {
  const entry = {
    positives: [
      { date: "2026-09-01", text: "a", relation: "unwritten" },
      { date: "2026-09-02", text: "b", relation: "unwritten" },
      { date: "2026-09-03", text: "c", relation: "described" },
    ],
  };
  assert.equal(dominantRelation(entry), "unwritten");
  assert.equal(dominantRelation({ positives: [{ date: "2026-09-01", text: "a" }] }), "");
  assert.equal(dominantRelation({}), "");
});

test("归纳落地：观察上的 relation 传到条目证据里", () => {
  const observations = [
    { day: "2026-09-01", evidence: "删了会重复提交", polarity: "pos", relation: "described" },
    { day: "2026-09-10", evidence: "这个删了会重复提交", polarity: "pos", relation: "described" },
  ];
  const items = [{ action: "new", kind: "pattern", situation: "要删关键逻辑", behavior: "先拦下", observationIndexes: [1, 2] }];
  const list = applyRollup([], items, observations);
  assert.deepEqual(list[0].positives.map((p) => p.relation), ["described", "described"]);
  assert.equal(dominantRelation(list[0]), "described");
});

test("归纳解析：触发词必须出现在引用的原话里", () => {
  const observations = [
    { day: "2026-09-01", situation: "要删校验", behavior: "先拦下", evidence: "删了会重复提交" },
    { day: "2026-09-08", situation: "让她删东西", behavior: "先拦下再讲后果", evidence: "这个删了会重复提交" },
  ];
  const raw = JSON.stringify([
    {
      action: "new",
      situation: "要删关键逻辑",
      behavior: "先拦下再讲后果",
      triggers: { strong: ["删了", "重复提交", "编出来的词"], weak: ["删掉", "删了"] },
      observationIndexes: [1, 2],
    },
  ]);
  const out = parseRollupOutput(raw, { observations });
  assert.equal(out.length, 1);
  assert.deepEqual(out[0].triggers.strong, ["删了", "重复提交"]);
  assert.deepEqual(out[0].triggers.weak, ["删了"]);
});

test("归纳解析：不引用观察的条目丢掉", () => {
  const observations = [{ day: "2026-09-01", situation: "s", behavior: "b", evidence: "e" }];
  const raw = JSON.stringify([{ action: "new", situation: "s", behavior: "b", observationIndexes: [9] }]);
  assert.deepEqual(parseRollupOutput(raw, { observations }), []);
});

test("归纳解析：编号容忍 O1、字符串和 observations 别名", () => {
  const observations = [
    { day: "2026-09-01", evidence: "删了会重复提交" },
    { day: "2026-09-08", evidence: "这个删了会重复提交" },
  ];
  const prefixed = JSON.stringify([
    { action: "new", situation: "要删关键逻辑", behavior: "先拦下再讲后果", observationIndexes: ["O1", "O2"] },
  ]);
  assert.equal(parseRollupOutput(prefixed, { observations }).length, 1);
  const alias = JSON.stringify([
    { action: "new", situation: "要删关键逻辑", behavior: "先拦下再讲后果", observations: "1, 2" },
  ]);
  assert.equal(parseRollupOutput(alias, { observations }).length, 1);
});

test("归纳解析：容忍尾逗号，但坏 JSON 仍然不炸", () => {
  const observations = [{ day: "2026-09-01", evidence: "e" }];
  const trailing = '[{"action":"new","situation":"s","behavior":"b","observationIndexes":[1],},]';
  assert.equal(parseRollupOutput(trailing, { observations }).length, 1);
  assert.deepEqual(parseRollupOutput("不是 JSON", { observations }), []);
});

test("门槛：证据不足时不出现在档案里", () => {
  const thin = {
    positives: [
      { date: "2026-09-01", text: "a" },
      { date: "2026-09-02", text: "b" },
    ],
  };
  const evaluated = evaluateEntry(thin);
  assert.equal(evaluated.level, "insufficient");
  assert.equal(isVisibleEntry(thin), false);
});

test("门槛：跨度不再卡门槛（2026-10-19 起只数证据数与日子数）", () => {
  // 旧版这条会判 insufficient（5 条挤在 5 天里，跨度不够 21 天），
  // 于是 138 天里 106 条有 81 条永远长不出来。现在它按 5 条 / 5 天直接到 likely。
  const compressed = {
    positives: [
      { date: "2026-09-01", text: "a" },
      { date: "2026-09-02", text: "b" },
      { date: "2026-09-03", text: "c" },
      { date: "2026-09-04", text: "d" },
      { date: "2026-09-05", text: "e" },
    ],
  };
  const evaluated = evaluateEntry(compressed);
  assert.equal(evaluated.spanDays, 4, "跨度仍然计算，只是不再当门槛");
  assert.equal(evaluated.level, "likely");
  assert.equal(isVisibleEntry(compressed), true);
});

test("门槛：两个日子就能成条，不再要求三个日子", () => {
  const twoDays = {
    positives: [
      { date: "2026-09-01", text: "a" },
      { date: "2026-09-10", text: "b" },
      { date: "2026-09-22", text: "c" },
    ],
  };
  assert.equal(evaluateEntry(twoDays).level, "possible");
  assert.equal(isVisibleEntry(twoDays), true);
});

test("门槛：偏离档更松，两条 / 两天就冒头", () => {
  const deviation = {
    kind: "deviation",
    positives: [
      { date: "2026-09-01", text: "a" },
      { date: "2026-09-03", text: "b" },
    ],
  };
  assert.equal(evaluateEntry(deviation).level, "possible");
  assert.equal(isVisibleEntry(deviation), true);
  // 同样的证据量换成做法档就不够：两条撑不起一条「一贯做法」。
  assert.equal(evaluateEntry({ ...deviation, kind: "pattern" }).level, "insufficient");
});

test("kind 归一化：旧数据没有 kind 字段时当作一贯做法", () => {
  assert.equal(normalizeEntryKind(undefined), "pattern");
  assert.equal(normalizeEntryKind(""), "pattern");
  assert.equal(normalizeEntryKind("乱写的"), "pattern");
  assert.equal(normalizeEntryKind("deviation"), "deviation");
  const legacy = {
    positives: [
      { date: "2026-09-01", text: "a" },
      { date: "2026-09-08", text: "b" },
      { date: "2026-09-20", text: "c" },
    ],
  };
  assert.equal(evaluateEntry(legacy).kind, "pattern");
});

test("日采解析：认 kind，且一天最多留一条偏离", () => {
  const raw = JSON.stringify([
    { kind: "deviation", situation: "s1", behavior: "b1", evidence: "别慌", polarity: "pos" },
    { kind: "deviation", situation: "s2", behavior: "b2", evidence: "算了", polarity: "pos" },
    { kind: "pattern", situation: "s3", behavior: "b3", evidence: "先搜再说", polarity: "pos" },
  ]);
  const parsed = parseObservationOutput(raw, { sourceText: "别慌 算了 先搜再说" });
  assert.equal(parsed.length, 2, "第二条偏离被丢掉");
  assert.equal(parsed[0].kind, "deviation");
  assert.equal(parsed[1].kind, "pattern");
});

test("注入：只接做法，偏离一律不入选", () => {
  const profile = {
    entries: [
      { kind: "pattern", situation: "对方报错时", behavior: "先安抚再排查", positives: mkDays(5) },
      { kind: "pattern", situation: "对方说你错时", behavior: "先认错再给依据", positives: mkDays(3) },
      { kind: "deviation", situation: "这次没道歉", behavior: "直接换了方案", positives: mkDays(9) },
      { kind: "pattern", situation: "证据不够的", behavior: "不该被选中", positives: mkDays(1) },
    ],
  };
  const picked = pickInjectableEntries(profile);
  assert.equal(picked.length, 2, "偏离和证据不足的都不选");
  assert.ok(picked.every((entry) => entry.kind === "pattern"));
  assert.equal(picked[0].behavior, "先安抚再排查", "证据多的排前面");
});

test("注入：条数封顶，默认 3 条", () => {
  const profile = {
    entries: Array.from({ length: 6 }, (_, i) => ({
      kind: "pattern",
      situation: `a${i}`,
      behavior: `b${i}`,
      positives: mkDays(5),
    })),
  };
  assert.equal(XINGJI_INJECT_MAX_ENTRIES, 3);
  assert.equal(pickInjectableEntries(profile).length, 3);
  assert.equal(pickInjectableEntries(profile, { limit: 2 }).length, 2);
  assert.equal(pickInjectableEntries(profile, { limit: 0 }).length, 0);
});

test("注入文本：用 ta 自己的口吻，不写成外部规则单", () => {
  const text = buildXingjiInjectionText([{ situation: "对方报错时", behavior: "先安抚再排查" }]);
  assert.ok(text.includes("你一向就是这么做的"));
  assert.ok(text.includes("对方报错时：先安抚再排查"));
  assert.ok(text.includes("不用说出来"), "不能变成让 ta 复述自己的做法");
  assert.ok(!/请注意|禁止|必须/.test(text), "不能出现规则单口吻");
  assert.equal(buildXingjiInjectionText([]), "");
});

test("门槛：够条数与天数升到可能，再多才升到常见", () => {
  const make = (days) => ({
    positives: days.map((d, i) => ({ date: d, text: `证据${i}` })),
  });
  const base = make(["2026-09-01", "2026-09-10", "2026-09-22"]);
  assert.equal(evaluateEntry(base).level, "possible");
  assert.equal(isVisibleEntry(base), true);

  const strong = make(["2026-08-01", "2026-08-12", "2026-08-25", "2026-09-05", "2026-09-20"]);
  assert.equal(evaluateEntry(strong).level, "likely");
  assert.equal(evaluateEntry(strong).distinctDays, XINGJI_LIKELY_DISTINCT_DAYS);
});

test("门槛：被用户否掉的条目不显示", () => {
  const entry = {
    status: "rejected",
    positives: [
      { date: "2026-08-01", text: "a" },
      { date: "2026-08-12", text: "b" },
      { date: "2026-08-25", text: "c" },
    ],
  };
  assert.equal(isVisibleEntry(entry), false);
});

test("证据入账：同一天同一句话不重复记", () => {
  let list = pushEvidence([], { date: "2026-09-01", text: "删了会重复提交" });
  list = pushEvidence(list, { date: "2026-09-01", text: "删了会重复提交" });
  list = pushEvidence(list, { date: "2026-09-02", text: "删了会重复提交" });
  assert.equal(list.length, 2);
  assert.deepEqual(list.map((r) => r.date), ["2026-09-01", "2026-09-02"]);
});

test("观察并入条目：正例入账并重算门槛", () => {
  const entry = {
    id: "xj-1",
    situation: "要删关键逻辑",
    behavior: "先拦下再讲后果",
    positives: [{ date: "2026-08-01", text: "删了会重复提交" }],
    negatives: [],
  };
  const next = mergeObservationIntoEntry(entry, { evidence: "这个删了会重复提交" }, { day: "2026-09-01" });
  assert.equal(next.positives.length, 2);
  assert.equal(next.level, "insufficient");
});

test("提示词：要求动词式行为、要求证据原文、宁缺毋滥", () => {
  const prompt = buildObservationPrompt({
    agentName: "小花",
    userName: "阿禾",
    day: "2026-09-01",
    eventsText: "[1] 2026-09-01 · 类型：反对/拒绝",
    identityText: "性格设定：温暖、有判断力",
  });
  assert.ok(prompt.includes("小花"));
  assert.ok(prompt.includes("一字不改"));
  assert.ok(prompt.includes("宁缺毋滥"));
  assert.ok(prompt.includes("性格设定：温暖、有判断力"), "设定要作为对照物出现在提示里");
  assert.ok(prompt.includes("relation"), "要让模型标 relation");
  assert.ok(prompt.includes("只问「写过没有」"), "不要让模型用「符不符合」去判设定");
});

test("提示词：归纳时把已有条目一起给出", () => {
  const prompt = buildRollupPrompt({
    agentName: "小花",
    userName: "阿禾",
    observations: [{ day: "2026-09-01", situation: "要删校验", behavior: "先拦下", evidence: "删了会重复提交" }],
    existingEntries: [{ situation: "要删关键逻辑", behavior: "先拦下再讲后果", positives: [{ date: "2026-08-01", text: "x" }] }],
  });
  assert.ok(prompt.includes("[O1]"));
  assert.ok(prompt.includes("[E1]"));
  assert.ok(prompt.includes("triggers"));
});

test("常量口径与拍板一致", () => {
  assert.equal(XINGJI_MIN_POSITIVES, 3);
  assert.equal(XINGJI_MIN_DISTINCT_DAYS, 2);
  assert.equal(XINGJI_LIKELY_DISTINCT_DAYS, 5);
  assert.equal(XINGJI_DEVIATION_MIN_POSITIVES, 2);
  assert.equal(XINGJI_DEVIATION_MIN_DISTINCT_DAYS, 2);
  assert.ok(CHARACTER_EVENT_KINDS.includes("refuse"));
});

test("归纳落地：新建条目并把引用的观察收成证据", () => {
  const observations = [
    { day: "2026-09-01", evidence: "删了会重复提交", polarity: "pos" },
    { day: "2026-09-10", evidence: "这个删了会重复提交", polarity: "pos" },
  ];
  const items = [{
    action: "new",
    situation: "要删关键逻辑",
    behavior: "先拦下再讲后果",
    triggers: { strong: ["删了"], weak: [] },
    observationIndexes: [1, 2],
  }];
  const entries = applyRollup([], items, observations);
  assert.equal(entries.length, 1);
  assert.equal(entries[0].positives.length, 2);
  assert.equal(entries[0].level, "insufficient", "两条证据还不够门槛");
  assert.equal(entries[0].status, "active");
});

test("归纳落地：merge 到已有条目而不是另起一条", () => {
  const existing = [{
    id: "xj-old",
    situation: "要删关键逻辑",
    behavior: "先拦下再讲后果",
    triggers: { strong: ["删了"], weak: [] },
    positives: [{ date: "2026-08-01", text: "删了会重复提交" }],
    negatives: [],
  }];
  const observations = [{ day: "2026-09-01", evidence: "这个删了会重复提交", polarity: "pos" }];
  const items = [{
    action: "merge",
    target: "E1",
    situation: "要删关键逻辑",
    behavior: "先拦下再讲后果",
    triggers: { strong: ["重复提交"], weak: [] },
    observationIndexes: [1],
  }];
  const entries = applyRollup(existing, items, observations);
  assert.equal(entries.length, 1, "不应新增条目");
  assert.equal(entries[0].id, "xj-old");
  assert.equal(entries[0].positives.length, 2);
  assert.deepEqual(entries[0].triggers.strong, ["删了", "重复提交"]);
});

test("归纳落地：没被引用的观察不入账", () => {
  const observations = [{ day: "2026-09-01", evidence: "a", polarity: "pos" }];
  const items = [{ action: "new", situation: "s", behavior: "b", observationIndexes: [] }];
  assert.deepEqual(applyRollup([], items, observations), []);
});

test("归纳落地：反例进 negatives 而不是 positives", () => {
  const observations = [
    { day: "2026-09-01", evidence: "删了会重复提交", polarity: "pos" },
    { day: "2026-09-02", evidence: "这次没拦，直接删了", polarity: "neg" },
  ];
  const items = [{ action: "new", situation: "s", behavior: "b", observationIndexes: [1, 2] }];
  const entries = applyRollup([], items, observations);
  assert.equal(entries[0].positives.length, 1);
  assert.equal(entries[0].negatives.length, 1);
});

// ── 2026-10-19：剔噪四项 ──
// 一、内部思考块不是给人看的话
test("剔噪：内部思考块剥掉再判类型，不把心里嘀咕当发言", () => {
  const withMood = "先放这儿。<mood>\nVibe: 有点烦\nSparks:\n  - 一\n  - 二\n</mood>行，那就这样。";
  assert.equal(stripInternalBlocks(withMood).includes("Vibe"), false);
  assert.ok(stripInternalBlocks(withMood).includes("行，那就这样"));

  // 一大段 mood 把回复撑过 260 字，剥掉后其实很短，不该被当成「长篇」
  const rows = [
    mk(BASE, "user", "在吗"),
    mk(BASE + 1000, "assistant", `好。<mood>${"心里嘀咕。".repeat(80)}</mood>嗯，在。`),
  ];
  const events = findCharacterEvents(rows, "hanako");
  assert.equal(events.some((e) => e.kind === "deep_dive"), false, "内部块不算篇幅");
});

test("剔噪：每个伙伴的标签都认，正文里的正常尖括号不动", () => {
  for (const tag of ["mood", "reflect", "pulse", "think"]) {
    const text = `说话。<${tag}>内部</${tag}>收尾。`;
    assert.equal(stripInternalBlocks(text).includes("内部"), false, tag);
  }
  assert.equal(stripInternalBlocks("值是 <3 的时候走另一支"), "值是 <3 的时候走另一支");
});

// 二、长篇只兜底，不进主配额
test("剔噪：长篇回复让位给稀有信号，只有凑不满时才兜底", () => {
  const rows = [];
  for (let i = 0; i < 6; i += 1) {
    rows.push(mk(BASE + i * 1000, "user", `问题 ${i}`));
    rows.push(mk(BASE + i * 1000 + 500, "assistant", `不，这条我不能同意，会影响后面的流程 ${i}`));
    rows.push(mk(BASE + i * 1000 + 800, "assistant", `展开讲。`.repeat(60)));
  }
  const events = findCharacterEvents(rows, "hanako");
  assert.ok(events.length > 0);
  assert.ok(events.every((e) => e.kind === "refuse"), JSON.stringify(events.map((e) => e.kind)));

  // 一天只有长篇时，仍然兜底用上，别让这一天白空
  const onlyLong = [
    mk(BASE, "user", "讲讲"),
    mk(BASE + 1000, "assistant", "展开讲。".repeat(70)),
  ];
  assert.deepEqual(findCharacterEvents(onlyLong, "hanako").map((e) => e.kind), ["deep_dive"]);
});

test("剔噪：同类型按时间均匀取，不是只拿最早那几条", () => {
  const list = Array.from({ length: 10 }, (_, i) => ({ ts: i, day: "2026-09-01", kind: "joke", userText: "u", replyText: `r${i}` }));
  const picked = capEventList(list, 8);
  assert.equal(picked.length, 2);
  assert.ok(picked[1].ts - picked[0].ts > 1, "两条不能挤在开头");
});

// 三、通用习惯：跨伙伴都一样就不是性格
test("通用习惯：多个伙伴都高频的才判通用，只有一个高频的留着", () => {
  const bold = "**重点** 这里要改。";
  const plain = "这里要改。";
  const habits = detectGenericHabits([
    { agentId: "a", texts: [bold, bold, bold, plain] },
    { agentId: "b", texts: [bold, bold, plain, plain] },
    { agentId: "c", texts: [bold, plain, plain, plain] },
  ]);
  assert.equal(habits.bold.generic, true);
  assert.equal(habits.bold.rates.a, 0.75);

  // 只有一个人爱加粗，是他自己的习惯
  const solo = detectGenericHabits([
    { agentId: "a", texts: [bold, bold, bold, bold] },
    { agentId: "b", texts: [plain, plain, plain, plain] },
    { agentId: "c", texts: [plain, plain, plain, plain] },
  ]);
  assert.equal(solo.bold.generic, false);
});

test("通用习惯：只有一个伙伴时走内置基线，不假装是实测出来的", () => {
  const solo = resolveGenericHabits([{ agentId: "a", texts: ["**x**", "y"] }]);
  assert.equal(solo.bold.generic, true);
  assert.equal(solo.bold.source, "baseline");
  // 基线里没有的项目不会被误判
  assert.equal(solo.say_agreed, undefined);

  const two = resolveGenericHabits([
    { agentId: "a", texts: ["**x**", "y"] },
    { agentId: "b", texts: ["**x**", "z"] },
  ]);
  assert.equal(two.bold.source, undefined, "两个伙伴起就该走实测");
});

test("通用习惯：提示词里只列真通用的那几项", () => {
  const note = formatGenericHabitsNote({
    bold: { label: "加粗强调", generic: true },
    joke: { label: "开玩笑", generic: false },
  });
  assert.equal(note, "加粗强调");
  assert.equal(formatGenericHabitsNote({ bold: { label: "加粗强调", generic: false } }), "");
  assert.equal(formatGenericHabitsNote(null), "");
});

test("通用习惯：行为描述命中就不入观察，认错类只认指错语境", () => {
  assert.equal(classifyGenericBehavior("被指错先认下来再转正题"), "ack_first");
  assert.equal(classifyGenericBehavior("直接认错"), "ack_alone");
  assert.equal(classifyGenericBehavior("写完就分点列表格"), "format");
  assert.equal(classifyGenericBehavior("先拦下再说明后果"), "", "真性格不能被误杀");
  assert.equal(classifyGenericBehavior("先承认自己不知道再去查"), "", "承认≠认错");
});

test("通用习惯：解析阶段直接丢掉通用习惯观察", () => {
  const source = "被指错先认下来再转正题。先拦下再说明后果。";
  const raw = JSON.stringify([
    { situation: "被指错", behavior: "被指错先认下来再转正题", evidence: "被指错先认下来再转正题", polarity: "pos" },
    { situation: "要删校验", behavior: "先拦下再说明后果", evidence: "先拦下再说明后果", polarity: "pos" },
  ]);
  const out = parseObservationOutput(raw, { sourceText: source });
  assert.equal(out.length, 1);
  assert.equal(out[0].behavior, "先拦下再说明后果");
});

test("通用习惯：发言抽样先剥内部块再算比率", () => {
  const profiles = buildStyleProfiles([
    { agentId: "a", role: "assistant", text: "**重点**<mood>心里的话</mood>" },
    { agentId: "a", role: "user", text: "**用户也加粗**" },
    { agentId: "b", role: "assistant", text: "普通一句" },
  ]);
  assert.equal(profiles.length, 2);
  const a = profiles.find((p) => p.agentId === "a");
  assert.equal(a.texts.length, 1, "只收伙伴自己的发言");
  assert.equal(a.texts[0].includes("心里的话"), false);
});

test("通用习惯：提示词里带通用习惯时多一句，没带就不提", () => {
  const base = { agentName: "小花", userName: "阿禾", day: "2026-09-01", eventsText: "[1]" };
  assert.equal(buildObservationPrompt(base).includes("占比很高"), false);
  const withNote = buildObservationPrompt({ ...base, genericNote: "加粗强调、编号步骤" });
  assert.ok(withNote.includes("加粗强调、编号步骤"));
});

// ── 2026-10-19 第二轮：人情味 ──
// 上一轮跑出来的条目五个人四个都是「先查日志再改」「先复述再拆解」，全是干活流程。
// 这一轮把场景分开：干活的路数不算性格，日子里的碎话才算。
test("场景判定：派活、报错、问技术一律算工作，不带情绪词也不算生活", () => {
  assert.equal(sceneOf("这个报错怎么修"), "work");
  assert.equal(sceneOf("状态栏还能再美化点吗"), "work");
  assert.equal(sceneOf("请你修改这个agent"), "work");
  assert.equal(sceneOf("我觉得这个好像有点问题，帮我改一下"), "work", "带「觉得」「好像」也是在派活");
  assert.equal(sceneOf("今天好累啊，不想动"), "life");
  assert.equal(sceneOf("圆宝又把拖鞋叼走了"), "life");
  assert.equal(sceneOf("今天天气不错"), "life");
});

test("事件预筛：生活场景的回合成 warm/casual/comfort，不再混进工作卡", () => {
  const rows = [
    mk(BASE, "user", "今天好累啊，不想动了"),
    mk(BASE + 1000, "assistant", "那先别干了噻，过来坐会儿，我给你倒杯水。"),
    mk(BASE + 2000, "user", "这个报错怎么修"),
    mk(BASE + 3000, "assistant", "先看日志，定位到根因再改，改完报改动清单。"),
  ];
  const events = findCharacterEvents(rows, "hanako");
  const kinds = events.map((e) => e.kind);
  // 「累」先命中低落应对，判 comfort 比 warm 更准，两种都算生活卡。
  assert.ok(kinds.some((k) => ["warm", "casual", "comfort"].includes(k)), JSON.stringify(kinds));
  assert.equal(events.some((e) => /日志/.test(e.replyText)), false, "工作回复不能混进生活卡");
});

test("事件预筛：生活卡优先占名额，但最多占一半", () => {
  const list = [
    ...Array.from({ length: 6 }, (_, i) => ({ ts: i, kind: "warm", replyText: `w${i}` })),
    ...Array.from({ length: 6 }, (_, i) => ({ ts: i + 100, kind: "refuse", replyText: `r${i}` })),
  ];
  const picked = capEventList(list, 8);
  const life = picked.filter((item) => item.kind === "warm").length;
  const work = picked.filter((item) => item.kind === "refuse").length;
  assert.equal(life, 2, "同类型最多两条");
  assert.ok(work >= 2, "干活时的反应也要留位置");
  assert.equal(picked.length, 4);
});

test("事件预筛：生活卡够多时能占到一半名额", () => {
  const list = [
    ...Array.from({ length: 3 }, (_, i) => ({ ts: i, kind: "warm", replyText: `w${i}` })),
    ...Array.from({ length: 3 }, (_, i) => ({ ts: i + 10, kind: "casual", replyText: `c${i}` })),
    ...Array.from({ length: 3 }, (_, i) => ({ ts: i + 20, kind: "refuse", replyText: `r${i}` })),
    ...Array.from({ length: 3 }, (_, i) => ({ ts: i + 30, kind: "challenge", replyText: `q${i}` })),
  ];
  const picked = capEventList(list, 8);
  const lifeCount = picked.filter((item) => ["warm", "casual"].includes(item.kind)).length;
  assert.equal(lifeCount, 4, "上限八个的一半");
});

test("通用习惯：干活流程一律不入观察", () => {
  for (const text of ["先查日志再改", "先复述对方要求再拆解", "改完汇报改动清单", "先定位根因再动手", "先给结论再分点"]) {
    assert.ok(classifyGenericBehavior(text), `「${text}」应该被判成干活流程`);
  }
  // 真性格不能被误杀
  assert.equal(classifyGenericBehavior("被逗笑之后先损对方一句再收下礼物"), "");
  assert.equal(classifyGenericBehavior("不干活的时候只安静陪着不说话"), "");
});

test("提示词：明说干活路数不是性格，并允许记没在干活的那一面", () => {
  const prompt = buildObservationPrompt({ agentName: "小花", userName: "阿禾", day: "2026-09-01", eventsText: "[1]" });
  assert.ok(prompt.includes("干活的路数不是性格"));
  assert.ok(prompt.includes("先查日志再改"));
  assert.ok(prompt.includes("没在干活的那一面"));
  assert.ok(prompt.includes("宁可一天只记一条像人的"));
});
