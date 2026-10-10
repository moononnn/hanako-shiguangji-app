// 拾光记 · 工具：查询今天是什么日子
// 助手在对话中调用，感知当天情境（节假日/纪念日/生理期/待办）。

import { getSharedUserData } from "../lib/shared-data.js";
import { getBuiltinFestivals, isWorkday } from "../lib/festivals.js";
import { filterDueTodos, isTodoOverdue } from "../lib/data.js";

function getData(context = null) {
  return getSharedUserData(context?.dataDir || context?.pluginContext?.dataDir || context?.ctx?.dataDir);
}

export const name = "shiguangji_today";
export const description =
  "查询今天是什么日子：节假日、纪念日、待办、生理期等（拾光记插件）。需要了解今天是否为特殊日子时调用。";
export const sessionPermission = { readOnly: true };
export const parameters = {
  type: "object",
  properties: {},
};

export async function execute(_input = {}, context = {}) {
  const now = new Date();
  const builtin = getBuiltinFestivals(now);
  const data = getData(context);
  const settings = data.getSettings();
  // 待办不混进「今天有」：下面另有「待办：」一行，且那一行才看勾没勾。
  // 年度重复的待办进不了到期待办线，仍留在这里当日程。
  const userEvents = data.eventsOnDate(now).filter((e) => e.type !== "period" && !(e.type === "todo" && !e.repeatYearly));
  const periods = settings.showPeriod === false
    ? []
    : data.periodsWithDayOn(now).filter((p) => !p.predicted).map((p) => p.event);
  const workday = isWorkday(now);

  const lines = [];
  lines.push(
    `今天是 ${now.getFullYear()}年${now.getMonth() + 1}月${now.getDate()}日 星期${["日", "一", "二", "三", "四", "五", "六"][now.getDay()]}`
  );

  const specials = [];
  for (const f of builtin) specials.push(`${f.name}(${f.source})`);
  for (const e of userEvents) specials.push(e.title);
  for (const p of periods) specials.push("生理期");
  if (workday) specials.push("调休上班日");
  lines.push(specials.length ? `今天有：${specials.join("、")}` : "今天没有特殊日子");

  const todos = filterDueTodos(data.listEvents(), now);
  const overdue = todos.filter((e) => isTodoOverdue(e, now));
  const overdueRepeats = new Map();
  const overdueSingles = [];
  for (const todo of overdue) {
    if (todo.seriesId && todo.repeatRule) {
      overdueRepeats.set(todo.seriesId, { title: todo.title, count: (overdueRepeats.get(todo.seriesId)?.count || 0) + 1 });
    } else overdueSingles.push(todo.title);
  }
  const todoLabels = todos.filter(todo => !isTodoOverdue(todo, now)).map(todo => todo.title).concat(overdueSingles);
  for (const group of overdueRepeats.values()) todoLabels.push(`${group.title}（逾期 ${group.count} 次）`);
  lines.push(todos.length ? `待办：${todoLabels.join("、")}` : "今天没有到期待办");
  if (overdue.length) lines.push(`其中 ${overdue.length} 次已经逾期`);

  return { content: [{ type: "text", text: lines.join("\n") }] };
}
