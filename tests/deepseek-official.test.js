import test from "node:test";
import assert from "node:assert/strict";

import { buildDeepSeekContext } from "../lib/inject.js";
import { decideDeepSeekNotice, isOfficialDeepSeek, scopedPeriodLabel } from "../lib/deepseek-peak.js";

// 2026-11-23 是周一，11:00 落在工作日上午高峰里。
const NOW = new Date("2026-11-23T11:00:00+08:00");

test("官方通道只认接口地址，不认模型名", () => {
  assert.equal(isOfficialDeepSeek({
    model: { provider: "deepseek", baseUrl: "https://api.deepseek.com/v1", id: "deepseek-v4.1-flash" },
  }), true);
  assert.equal(isOfficialDeepSeek({
    model: { provider: "command-code", baseUrl: "https://api.commandcode.ai/v1", id: "deepseek-v4.1-flash" },
  }), false);
  assert.equal(isOfficialDeepSeek({
    model: {
      provider: "dashscope-token-plan",
      baseUrl: "https://token-plan.cn-beijing.maas.aliyuncs.com/compatible-mode/v1",
      id: "deepseek-v4.1-flash-1017",
    },
  }), false);
  // 没有地址可看时退回官方那两个 provider id；转售商不会把自己叫 deepseek。
  assert.equal(isOfficialDeepSeek({ provider: "deepseek", id: "deepseek-chat" }), true);
  assert.equal(isOfficialDeepSeek({ provider: "openrouter", id: "deepseek/deepseek-v4-flash" }), false);
});

test("第三方通道把话说成条件句，不说它没有峰谷", () => {
  const notice = { kind: "detected", period: "valley", periodLabel: "谷时段", official: false, toneIndex: 0 };
  const text = buildDeepSeekContext(notice, "小满");
  assert.match(text, /走的不是官方接口/);
  assert.match(text, /按官方价走的这会儿便宜/);
  assert.match(text, /固定价或自己另定时段的渠道不受影响/);
  // Command Code 就是非官方却有峰谷的，不能把它说成「可能没有峰谷」
  assert.equal(text.includes("可能没有峰谷"), false);
});

test("第三方在高峰期同样给出可按官方价对号的口径", () => {
  const notice = { kind: "detected", period: "peak", periodLabel: "高峰时段", official: false, toneIndex: 0 };
  const text = buildDeepSeekContext(notice, "小满");
  assert.match(text, /走的不是官方接口/);
  assert.match(text, /按官方价转售的这会儿也贵/);
});

test("官方通道不挂第三方那句条件句", () => {
  const notice = { kind: "detected", period: "valley", periodLabel: "谷时段", official: true, toneIndex: 0 };
  const text = buildDeepSeekContext(notice, "小满");
  assert.equal(text.includes("走的不是官方接口"), false);
  assert.match(text, /DeepSeek/);
});

test("decideDeepSeekNotice 把官方判定带进 notice", () => {  const official = decideDeepSeekNotice({
    model: { model: { provider: "deepseek", baseUrl: "https://api.deepseek.com", id: "deepseek-v4.1-flash" } },
    now: NOW,
  });
  assert.equal(official.notice.official, true);

  const third = decideDeepSeekNotice({
    model: { model: { provider: "opencode", baseUrl: "https://opencode.ai/inference", id: "deepseek-v4.1-flash" } },
    now: NOW,
  });
  assert.equal(third.notice.official, false);
});

test("时间行的时段标签：官方照旧，第三方加「官方」二字", () => {
  // 时间行是模型每轮都看得见的底线信息；不带限定的话，它会把官方时段直接说成自己这家的账。
  assert.equal(scopedPeriodLabel("谷时段", true), "谷时段");
  assert.equal(scopedPeriodLabel("谷时段", false), "官方谷时段");
  assert.equal(scopedPeriodLabel("高峰时段", false), "官方高峰时段");
  assert.equal(scopedPeriodLabel("", false), "");
});