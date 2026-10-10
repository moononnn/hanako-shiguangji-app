// 拾光记 · 工具：添加一个特殊日子/纪念日/待办/生理期
// 助手可以在对话中帮用户记下重要日子。

import { getSharedUserData } from "../lib/shared-data.js";
import { formatTodoReminderWindow, parseTodoReminderText } from "../lib/todo-time.js";
import { todoRepeatRuleLabel } from "../lib/todo-repeat.js";

function getData(context = null) {
  return getSharedUserData(context?.dataDir || context?.pluginContext?.dataDir || context?.ctx?.dataDir);
}

export const name = "shiguangji_add_event";
export const description =
  "在拾光记中添加一个特殊日子/纪念日/待办/生理期。参数：date(YYYY-MM-DD 或 MM-DD)、title(名称)、type(event/todo/period/anniversary)、note(备注可选)。待办可选 repeat=none/daily/weekly；每周重复时 weekdays 用 0=周日、1=周一……6=周六。待办标题里写‘下午三点’、‘9点’、‘两点’、‘15:00’等明确时间时会自动填入提醒时间（当天白天裸写‘两点’按下午两点理解）；同一句同时写事情时间和提醒时间时，以“提醒”前紧挨的时间为准；未识别时必须同时传 reminderStart/reminderEnd（HH:MM），精准时间让两者相同。";
export const sessionPermission = { readOnly: false }; // 写自己的日子账本，不能冒充只读。
export const parameters = {
  type: "object",
  properties: {
    date: { type: "string", description: "日期，YYYY-MM-DD 或 MM-DD（每年重复）" },
    title: { type: "string", description: "名称；待办标题中写‘下午三点’、‘9点’、当天白天的‘两点’或‘15:00’等明确时间时会自动填入提醒时间，同一句写了事情时间和提醒时间时以“提醒”前的时间为准" },
    type: {
      type: "string",
      enum: ["event", "todo", "period", "anniversary"],
      description: "类型：event=普通日子，todo=待办，period=生理期，anniversary=纪念日",
    },
    note: { type: "string", description: "备注（可选）" },
    reminderStart: { type: "string", description: "待办提醒开始时间，HH:MM；精准提醒时与 reminderEnd 相同" },
    reminderEnd: { type: "string", description: "待办提醒结束时间，HH:MM；精准提醒时与 reminderStart 相同" },
    repeat: { type: "string", enum: ["none", "daily", "weekly"], description: "待办重复方式，默认 none" },
    weekdays: { type: "array", items: { type: "integer", enum: [0, 1, 2, 3, 4, 5, 6] }, description: "repeat=weekly 时选择星期几；0=周日，1=周一，依此类推" },
  },
  required: ["date", "title"],
};

export async function execute(input = {}, options = {}) {
  try {
    const data = getData(options);
    const inferenceNow = options?.now instanceof Date ? options.now : new Date();
    let ev;
    if (input.type === "period") {
      const d = new Date(String(input.date) + "T00:00:00");
      if (Number.isNaN(d.getTime())) throw new Error("生理期日期要用 YYYY-MM-DD");
      ev = (await data.markPeriod(d)).event;
    } else {
      const inferredReminder = input.type === "todo" && !input.reminderStart && !input.reminderEnd
        ? parseTodoReminderText(input.title, { now: inferenceNow, targetDate: input.date })
        : null;
      const repeatMode = input.repeat || "none";
      if (!['none', 'daily', 'weekly'].includes(repeatMode)) throw new Error("待办重复方式只能选不重复、每天或每周");
      const repeatRule = repeatMode === "daily" ? { frequency: "daily" }
        : repeatMode === "weekly" ? { frequency: "weekly", weekdays: input.weekdays }
          : null;
      ev = await data.addEvent({
        title: input.title,
        type: input.type || "event",
        date: input.date,
        note: input.note || "",
        repeatRule,
        reminderStart: input.reminderStart || inferredReminder?.reminderStart,
        reminderEnd: input.reminderEnd || inferredReminder?.reminderEnd,
      });
    }
    // 记录已落盘后同步提醒计划；调度失败不能把已记下的记录说成失败。
    let scheduleWarning = "";
    if (typeof options.eventChanged === "function") {
      try { await options.eventChanged(ev); }
      catch { scheduleWarning = "；记录已保存，但主动提醒尚未接通，请检查拾光记的应用权限"; }
    }
    const reminderWindow = ev.type === "todo"
      ? formatTodoReminderWindow(ev.reminderStart, ev.reminderEnd)
      : "";
    const reminderText = ev.type !== "todo"
      ? ""
      : reminderWindow
        ? `，${reminderWindow}${ev.reminderStart === ev.reminderEnd ? "提醒" : " 时段提醒"}`
        : "，提醒时间待定";
    const repeatText = ev.type === "todo" && ev.repeatRule ? `，${todoRepeatRuleLabel(ev.repeatRule)}重复` : "";
    return {
      content: [
        {
          type: "text",
          text: `已记下「${ev.title}」（${ev.date}${ev.repeatYearly ? "，每年重复" : ""}${repeatText}${reminderText}）${scheduleWarning}`, 
        },
      ],
    };
  } catch (e) {
    return { content: [{ type: "text", text: `没记成：${e.message}` }] };
  }
}
