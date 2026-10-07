// 工具文本契约：规矩要写在工具里，不能只指望助手记性。
// 背景实机坑：她在茶话会说了「浇完啦」，账本一个字没动，伙伴却回了「账和记录都对上了」——
// 界面里看不见工具调用，不开口说，她就只能自己回去看。所以成功与失败都必须出声。
import test from "node:test";
import assert from "node:assert/strict";

import { candidatesText, description, doneText, name, notDoneText } from "../tools/complete-todo.js";

test("工具说明里写死了两条硬规矩：成功要出声，失败也要出声", () => {
  assert.equal(name, "shiguangji_complete_todo");

  // 成功路径
  assert.match(description, /必须在回复里明确告诉她/);
  assert.match(description, /她看不见你调了什么/);

  // 失败路径：不许沉默，不许拿“待会儿帮你记”糊弄
  assert.match(description, /不确定算不算做完了，就不调/);
  assert.match(description, /不要沉默/);
  assert.match(description, /不要用“待会儿帮你记”这种含糊话糊过去/);

  // 这次是追加，判定纪律不能被挤掉
  assert.match(description, /只在她的原话确实表示这件事已经做完时才用/);
  assert.match(description, /不要自己猜是哪一条/);
});

test("成功回包自带「说给她听」，模型想省都省不掉", () => {
  const ok = doneText({ ok: true, alreadyDone: false, todo: { title: "给薄荷浇水" } });
  assert.match(ok, /已勾掉「给薄荷浇水」/);
  assert.match(ok, /请在回复里明确告诉她这一条已经打上完成/);

  // 撤不掉提醒时那句话也在（提醒失败不等于勾失败）
  const warn = doneText({ ok: true, alreadyDone: false, reminderWarning: "；但提醒还没撤下来", todo: { title: "喂鱼" } });
  assert.match(warn, /提醒还没撤下来/);
  assert.match(warn, /请在回复里明确告诉她/);

  // 重复勾也要出声，不能静默
  const again = doneText({ ok: true, alreadyDone: true, todo: { title: "吃维生素d" } });
  assert.match(again, /已经是完成状态/);
  assert.match(again, /回复里顺口提一句这条已结/);
});

test("失败回包：如实说没记上，并给候选而不是替她挑", () => {
  const err = notDoneText("error", "没有许可");
  assert.match(err, /没勾成：没有许可/);
  assert.match(err, /如实说这条还没记上/);

  const empty = notDoneText("empty");
  assert.match(empty, /没说要勾哪一条/);
  assert.match(empty, /问清是哪一条/);

  const many = candidatesText("ambiguous", [
    { title: "买维生素d", date: "2026-10-06", at: "08:00" },
    { title: "买维生素c", date: "2026-10-06", at: "" },
  ]);
  assert.match(many, /有几条都像/);
  assert.match(many, /买维生素d（2026-10-06 08:00）/);
  assert.match(many, /不要自己挑/);

  const none = candidatesText("not-found", []);
  assert.match(none, /没找到对应的那条/);
  assert.doesNotMatch(none, /现在是这些/);
});
