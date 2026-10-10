// 拾光记周期待办：只处理日历日期，不碰提醒或存储。
// JavaScript getDay() 的星期编号沿用：周日 0，周一 1，……周六 6。

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const OCCURRENCE_MARKER = "@";

function parseDateKey(value) {
  const match = DATE_RE.exec(String(value || ""));
  if (!match) return null;
  const year = Number(match[1]), month = Number(match[2]), day = Number(match[3]);
  const date = new Date(year, month - 1, day, 12, 0, 0, 0);
  if (date.getFullYear() !== year || date.getMonth() + 1 !== month || date.getDate() !== day) return null;
  return { year, month, day, date };
}

function dateKey(date) {
  const pad = value => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function addCalendarDays(key, amount) {
  const parts = parseDateKey(key);
  if (!parts) return "";
  parts.date.setDate(parts.date.getDate() + amount);
  return dateKey(parts.date);
}

export function normalizeTodoRepeatRule(value) {
  if (value == null || value === "" || value === false) return null;
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("重复方式不正确");
  const frequency = String(value.frequency || "").trim().toLowerCase();
  if (frequency === "daily") return { frequency: "daily" };
  if (frequency !== "weekly") throw new Error("重复方式只能选每天或每周");
  if (!Array.isArray(value.weekdays)) throw new Error("请选择每周重复的星期");
  const weekdays = [...new Set(value.weekdays.map(Number))]
    .filter(day => Number.isInteger(day) && day >= 0 && day <= 6)
    .sort((a, b) => a - b);
  if (!weekdays.length || weekdays.length !== new Set(value.weekdays.map(Number)).size) {
    throw new Error("每周重复的星期不正确");
  }
  return { frequency: "weekly", weekdays };
}

export function isRecurringTodo(event) {
  if (!event || event.type !== "todo") return false;
  try { return !!normalizeTodoRepeatRule(event.repeatRule); }
  catch { return false; }
}

export function occurrenceMatches(event, date) {
  if (!isRecurringTodo(event)) return false;
  const target = String(date || "");
  if (!parseDateKey(target) || target < String(event.date || "")) return false;
  const rule = normalizeTodoRepeatRule(event.repeatRule);
  if (rule.frequency === "daily") return true;
  const parsed = parseDateKey(target);
  return rule.weekdays.includes(parsed.date.getDay());
}

export function todoOccurrenceId(seriesId, date) {
  const id = String(seriesId || "").trim();
  const key = String(date || "");
  return id && parseDateKey(key) ? `${id}${OCCURRENCE_MARKER}${key}` : "";
}

export function parseTodoOccurrenceId(value) {
  const id = String(value || "").trim();
  const marker = id.lastIndexOf(OCCURRENCE_MARKER);
  if (marker <= 0) return null;
  const seriesId = id.slice(0, marker);
  const date = id.slice(marker + 1);
  return seriesId && parseDateKey(date) ? { seriesId, date } : null;
}

export function buildTodoOccurrence(event, date, { preserveId = false } = {}) {
  if (!occurrenceMatches(event, date)) return null;
  const id = String(event.id || "");
  const completedDates = Array.isArray(event.completedDates) ? event.completedDates : [];
  const occurrence = {
    ...event,
    id: preserveId ? id : todoOccurrenceId(id, date),
    seriesId: id,
    seriesStartDate: String(event.date || ""),
    occurrenceDate: date,
    date,
    done: completedDates.includes(date),
    repeatRule: normalizeTodoRepeatRule(event.repeatRule),
  };
  delete occurrence.completedDates;
  return occurrence;
}

export function occurrenceDates(event, fromDate, toDate) {
  if (!isRecurringTodo(event)) return [];
  const start = parseDateKey(String(fromDate || ""));
  const end = parseDateKey(String(toDate || ""));
  if (!start || !end || fromDate > toDate) return [];
  let cursor = String(fromDate) < String(event.date || "") ? String(event.date) : String(fromDate);
  const result = [];
  // 日期逐日按本地日历递增，不用固定毫秒数，跨夏令时也不会漂一天。
  while (cursor <= toDate) {
    if (occurrenceMatches(event, cursor)) result.push(cursor);
    cursor = addCalendarDays(cursor, 1);
    if (!cursor) break;
  }
  return result;
}

export function nextTodoOccurrenceDate(event, afterDate, { inclusive = false } = {}) {
  if (!isRecurringTodo(event)) return "";
  const after = parseDateKey(String(afterDate || ""));
  const anchor = parseDateKey(String(event.date || ""));
  if (!after || !anchor) return "";
  let cursor = String(afterDate) < String(event.date) ? String(event.date)
    : inclusive ? String(afterDate) : addCalendarDays(String(afterDate), 1);
  if (!cursor) return "";
  // 每周规则最多检查七天；多看一天可覆盖锚点落在所选星期之前的情形。
  for (let i = 0; i < 8; i += 1) {
    if (cursor < String(event.date)) cursor = String(event.date);
    if (occurrenceMatches(event, cursor)) return cursor;
    cursor = addCalendarDays(cursor, 1);
    if (!cursor) return "";
  }
  return "";
}

export function todoRepeatRuleLabel(rule) {
  let normalized;
  try { normalized = normalizeTodoRepeatRule(rule); }
  catch { return ""; }
  if (!normalized) return "";
  if (normalized.frequency === "daily") return "每天";
  const names = ["日", "一", "二", "三", "四", "五", "六"];
  return `每周${normalized.weekdays.map(day => names[day]).join("、")}`;
}
