// 拾光记 · 工具：把一条待办勾成已完成
//
// 她随口一句"维生素 D 吃了"就该落到账上，而不是还要她打开 App 点一下。
// 只做完成这一件事：改标题、改时间、删待办都不走这里。
// 认 id 或标题；标题对不上时会把最近几条在办的摆出来，让助手当场改口重问。

import { getSharedUserData } from "../lib/shared-data.js";
import { completeTodo } from "../lib/todo-complete.js";

function getData(context = null) {
  return getSharedUserData(context?.dataDir || context?.pluginContext?.dataDir || context?.ctx?.dataDir);
}

export const name = "shiguangji_complete_todo";
export const description =
  "把她刚说已经做完的那条待办勾成已完成。参数：id 或 title（二选一，优先用 id）。"
  + "只在她的原话确实表示这件事已经做完时才用；她说“待会儿做”“等一下”“快好了”不算完成，不要调。"
  + "对不上时工具会回候选待办，照着候选再问一句，不要自己猜是哪一条。"
  // 下面这两句是硬规矩，不能只靠助手记性：工具调用在界面上是看不见的，
  // 助手不开口说，她就会以为压根没记上——这个坑真踩过（说了「浇完啦」，
  // 账上一动没动，伙伴却已经把话说圆了）。所以成功与失败都必须出声。
  + "调用成功后，必须在回复里明确告诉她「已经把这条勾上了」：她看不见你调了什么，"
  + "你不说她就只能自己回去看。不确定算不算做完了，就不调，然后直接跟她说这件事还没记上——"
  + "不要沉默，也不要用“待会儿帮你记”这种含糊话糊过去。";
export const sessionPermission = { readOnly: false };
export const parameters = {
  type: "object",
  properties: {
    id: { type: "string", description: "待办 id；拿不准就别传" },
    title: { type: "string", description: "待办名称原文，如“吃维生素d”" },
  },
};

/**
 * 成功回包里的那句。它不是给数据用的，是给读它的那个模型的：
 * 她在界面上看不到工具调用，这句是她能知道账已动的唯一途径。
 * 单独导出来是为了能直接测它，不用假数据跑一遗 execute。
 */
export function doneText(result) {
  return result.alreadyDone
    ? `「${result.todo.title}」本来就已经是完成状态。回复里顺口提一句这条已结。`
    : `已勾掉「${result.todo.title}」${result.reminderWarning || ""}。请在回复里明确告诉她这一条已经打上完成。`;
}

/** 没勾成的回包。吃了静默的亏之后，这条不能省。 */
export function notDoneText(reason, errorMessage = "") {
  if (reason === "empty") return "没说要勾哪一条：请传 id 或待办名称。回复里问清是哪一条。";
  return `没勾成：${errorMessage || reason}。回复里要如实说这条还没记上，别当作已经处理了。`;
}

/** 认不准时回候选：不替她挑。 */
export function candidatesText(reason, candidates = []) {
  const names = (candidates || [])
    .map((row) => `${row.title}（${row.date}${row.at ? ` ${row.at}` : ""}）`)
    .join("、");
  return `${reason === "ambiguous" ? "有几条都像" : "没找到对应的那条"}。${names ? `现在是这些："${names}"。` : ""}照着问清是哪一条，不要自己挑。`;
}

export async function execute(input = {}, options = {}) {
  try {
    const data = getData(options);
    const result = await completeTodo({
      data,
      id: input.id,
      title: input.title,
      now: options?.now instanceof Date ? options.now : new Date(),
      eventChanged: options.eventChanged,
    });
    if (result.ok) {
      return { content: [{ type: "text", text: doneText(result) }] };
    }
    if (result.reason === "empty") {
      return { content: [{ type: "text", text: notDoneText("empty") }] };
    }
    return { content: [{ type: "text", text: candidatesText(result.reason, result.candidates) }] };
  } catch (e) {
    // 没勾成也要出声。吃了静默的亏之后，这条不能省。
    return { content: [{ type: "text", text: notDoneText("error", e.message) }] };
  }
}
