// 拾光记 · 子代理会话注入测试
// 宿主把子代理的会话落在 agents/<伙伴>/subagent-sessions/<kind>/ 下，
// 那条路上的对话是派出去干活的，不该收到「今日时光」这类情境注入。
// 覆盖：路径判定、适配层完全不注入（连会话快照/模型/天气都不查）、普通窗口不受影响。

import { test, before } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { UserData } from "../lib/data.js";
import { __setSharedUserDataForTest } from "../lib/shared-data.js";
import { isSubagentSessionPath } from "../lib/session-kind.js";
import { __clearInjectTrackersForTest, __setInjectNowForTest } from "../extensions/inject.js";
import { attachInject } from "../lib/inject-app.js";

const BASE_DIR = path.join(os.tmpdir(), `sgj-subagent-${Date.now()}`);
const FIXED_NOW = new Date(2026, 9, 26, 9, 30, 0);

before(() => {
  fs.mkdirSync(BASE_DIR, { recursive: true });
  __setInjectNowForTest(() => FIXED_NOW);
});

function makeData(tag) {
  const data = new UserData(path.join(BASE_DIR, `${tag}-${Math.random().toString(36).slice(2)}`));
  __setSharedUserDataForTest(data);
  return data;
}

// 适配层要的宿主面：bus 记录每一次被问到的 RPC，hooks 只收 onDecision。
function makeHost(data) {
  const hooks = {};
  const asked = [];
  const ctx = {
    dataDir: data.dataDir,
    resources: null,
    bus: {
      async request(name) {
        asked.push(name);
        if (name === "session:entries") return { entries: [], leafId: null };
        if (name === "session:get") return { session: { namespace: "home", title: "聊天" } };
        return null;
      },
    },
    hooks: { onDecision(name, fn) { hooks[name] = fn; } },
  };
  return { ctx, hooks, asked };
}

const SUBAGENT_PATH =
  "C:\\Users\\laotv\\.hanako\\agents\\hanako\\subagent-sessions\\direct\\2026-10-26T05-20-00-000Z_01a176aa-1111-2222-3333-444455556666.jsonl";

test("子代理路径判定：两侧分隔符、大小写都认，普通会话不吃这套", () => {
  assert.equal(isSubagentSessionPath(SUBAGENT_PATH), true);
  assert.equal(
    isSubagentSessionPath("C:/Users/laotv/.hanako/agents/hanako/subagent-sessions/direct/a.jsonl"),
    true
  );
  assert.equal(
    isSubagentSessionPath("C:\\Users\\laotv\\.hanako\\agents\\hanako\\SUBAGENT-SESSIONS\\direct\\a.jsonl"),
    true
  );
  assert.equal(
    isSubagentSessionPath("C:\\Users\\laotv\\.hanako\\agents\\hanako\\sessions\\2026-10-26T05-00-00-000Z_a.jsonl"),
    false
  );
  // 只是文件名里带这串字，不是段，不算子代理。
  assert.equal(isSubagentSessionPath("C:\\hana\\agents\\hanako\\sessions\\subagent-sessions-notes.jsonl"), false);
  for (const empty of ["", null, undefined, 0, {}]) {
    assert.equal(isSubagentSessionPath(empty), false);
  }
});

test("适配层：子代理会话一句都不注入，也不去问宿主要快照、模型和天气", async () => {
  __clearInjectTrackersForTest();
  const data = makeData("subagent-skip");
  await data.addEvent({ title: "子代理不该看见的日子", type: "event", date: "2026-10-26" });
  const { ctx, hooks, asked } = makeHost(data);
  attachInject(ctx, () => {});

  const out = await hooks["agent/before-start"]({
    session: { sessionId: "01a176aa-1111-2222-3333-444455556666", sessionPath: SUBAGENT_PATH },
    model: { provider: "deepseek", id: "deepseek-chat" },
  });

  assert.equal(out, undefined, "子代理会话不该拿到任何注入");
  assert.deepEqual(asked, [], "判定要在所有宿主查询之前完成，一次都不该问");
});

test("适配层：同一套钩子，普通会话照样拿到今日时光", async () => {
  __clearInjectTrackersForTest();
  const data = makeData("subagent-home");
  const { ctx, hooks } = makeHost(data);
  attachInject(ctx, () => {});

  const out = await hooks["agent/before-start"]({
    session: {
      sessionId: "sess_subagent_control",
      sessionPath: "C:\\Users\\laotv\\.hanako\\agents\\hanako\\sessions\\2026-10-26T05-20-00-000Z_01a176bb.jsonl",
    },
    model: { provider: "openai", id: "gpt-5.6" },
  });

  assert.ok(out?.message?.content?.includes("【今日时光】"), "普通会话不能被子代理那条判定牵连");
});
