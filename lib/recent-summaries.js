// 拾光记 · 近期总结选择器
// 先给当前伙伴一个固定的近期底座；更老的档案只有在当前话题有词汇关联时才渐进式带入。
// 这里做纯函数筛选，不让主模型每轮自由决定是否翻阅，避免隐私边界和 token 预算失控。

import { finishedLifeDayKey, shiftDateKey } from "./day-summary.js";

export const RECENT_BASE_DAYS = 3;
export const RECENT_LOOKBACK_DAYS = 30;
export const RECENT_CHAR_BUDGET = 1800;
const TECHNICAL_AGENT_RE = /(?:^|[-_])(probe|test)(?:[-_]|$)/i;

function usableAgentId(agentId) {
  const id = String(agentId || "").trim();
  return !!id && !TECHNICAL_AGENT_RE.test(id);
}

function usable(entry) {
  return !!entry && !entry.empty && !!String(entry.text || "").trim();
}

const GENERIC_TERMS = ["应用", "插件", "测试", "发布", "更新", "功能", "项目", "版本", "开发", "问题", "情况", "事情", "东西"];
const CHAT_FILLERS = ["早上好", "晚上好", "早安", "午安", "晚安", "早哇", "你好", "哈喽", "谢谢", "我来啦", "我来了", "来啦", "闺蜜", "哥哥", "姐姐", "亲爱的", "宝贝", "伙伴", "助手", "用户", "怎么样", "咋样", "咋个", "怎么", "怎样", "有没有", "是不是", "能不能", "可不可以", "告诉我", "帮我", "看看", "聊聊", "说说", "以前", "之前", "做过", "一起", "最近", "后来", "现在", "这个", "那个", "一些", "一下", "什么", "今天", "昨天", "明天", "上次", "我们", "咱们", "你们", "他们"];
const ENGLISH_FILLERS = new Set(["hello", "hi", "hey", "thanks", "please", "app", "apps", "plugin", "plugins", "test", "testing", "release", "update", "version", "we", "you"]);
const PARTICLES = /^[的了呢吧嘛哈呀哇啦啊呐过吗哦呗咯喔噢]+$/;

function replaceWords(text, words) {
  let value = text;
  for (const word of [...new Set(words.map((word) => String(word || "").trim().toLowerCase()).filter(Boolean))].sort((a, b) => b.length - a.length)) {
    value = value.split(word).join(" ");
  }
  return value;
}

function topicText(text, ignoredNames = []) {
  return replaceWords(replaceWords(String(text || "").toLowerCase(), ignoredNames), CHAT_FILLERS)
    .replace(/\d{4}-\d{2}-\d{2}/g, " ")
    .replace(/(^|\s)的+/g, "$1 ")
    .replace(/[的了呢吧嘛哈呀哇啦啊呐吗哦呗咯喔噢]+(?=[^\u4e00-\u9fff]|$)/g, " ");
}

export function promptTerms(text, { ignoredNames = [] } = {}) {
  const value = topicText(text, ignoredNames);
  const terms = new Set();
  // 保留原文连续词组，陌生项目名也能精确匹配；全由泛词组成的句子不算话题。
  for (const run of value.match(/[\u4e00-\u9fff]{2,}/g) || []) {
    const concrete = replaceWords(run, GENERIC_TERMS).replace(/[的了呢吧嘛哈呀哇啦啊呐过吗哦呗咯喔噢\s]/g, "");
    if (concrete) terms.add(run);
  }
  // 泛词先隔开再切片，避免“应用测试”及其交界碎片独立命中。
  for (const run of replaceWords(value, GENERIC_TERMS).match(/[\u4e00-\u9fff]{2,}/g) || []) {
    for (const size of [2, 3]) {
      for (let i = 0; i <= run.length - size; i++) {
        const term = run.slice(i, i + size);
        if (!PARTICLES.test(term)) terms.add(term);
      }
    }
  }
  for (const term of value.match(/[a-z][a-z0-9_-]+/g) || []) {
    if (!ENGLISH_FILLERS.has(term)) terms.add(term);
  }
  return [...terms];
}

function hasTopicMatch(terms, matched, prompt) {
  if (!matched.length) return false;
  if (terms.length === 1 || matched.some((term) => term.length >= 3 || /[a-z]/.test(term))) return true;
  // 两个二字主题必须在查询中各占独立位置，不能把重叠切片算两次。
  const ranges = [];
  for (const term of matched) {
    const start = prompt.indexOf(term);
    const end = start + term.length;
    if (start >= 0 && ranges.every(([a, b]) => end <= a || start >= b)) ranges.push([start, end]);
  }
  return ranges.length >= 2;
}

export function recentLifeDayKeys(now = new Date(), boundaryHour = 4, count = RECENT_BASE_DAYS) {
  const n = Math.max(0, Number(count) || 0);
  const first = finishedLifeDayKey(now, boundaryHour);
  return Array.from({ length: n }, (_, index) => shiftDateKey(first, -index)).filter(Boolean);
}

export function scoreSummaryEntry(entry, { baseDates = new Set(), prompt = "", now = new Date(), boundaryHour = 4, ignoredNames = [] } = {}) {
  if (!usable(entry)) return -Infinity;
  const date = String(entry.date || "");
  const base = baseDates.has(date);
  let score = base ? 1000 : 0;
  const terms = promptTerms(prompt, { ignoredNames });
  const text = replaceWords(String(entry.text || "").toLowerCase(), ignoredNames);
  const matched = terms.filter((term) => text.includes(term));
  // 近期底座照常保留；旧档案先过相关性，再按重要程度排序。
  if (!base && !hasTopicMatch(terms, matched, topicText(prompt, ignoredNames))) return -Infinity;
  score += matched.length * 45;
  if (Number(entry.importance) >= 7) score += 25;
  if (entry.source === "edited") score += 4;

  const first = finishedLifeDayKey(now, boundaryHour);
  const age = Math.max(0, Math.round((new Date(`${first}T12:00:00`).getTime() - new Date(`${date}T12:00:00`).getTime()) / 86400000));
  score += Math.max(0, 30 - age);
  return score;
}

function dateOrder(a, b) {
  if (a.date !== b.date) return a.date < b.date ? 1 : -1;
  if (a.agentId !== b.agentId) return String(a.agentId).localeCompare(String(b.agentId));
  return String(a.text).localeCompare(String(b.text));
}

export function selectRecentSummaries(entries, {
  now = new Date(),
  boundaryHour = 4,
  currentAgentId = "",
  shared = false,
  prompt = "",
  userName = "",
  baseDays = RECENT_BASE_DAYS,
  lookbackDays = RECENT_LOOKBACK_DAYS,
  maxEntries = 10,
  maxChars = RECENT_CHAR_BUDGET,
} = {}) {
  const baseDates = new Set(recentLifeDayKeys(now, boundaryHour, baseDays));
  const first = [...baseDates][0] || finishedLifeDayKey(now, boundaryHour);
  const last = shiftDateKey(first, -(Math.max(1, Number(lookbackDays) || RECENT_LOOKBACK_DAYS) - 1));
  // 没有可靠的当前伙伴身份时，默认模式宁可不注入，也不把别人的档案当成自己的。
  if (!shared && !String(currentAgentId || "").trim()) {
    return { entries: [], baseDates: [...baseDates], expanded: false };
  }

  const list = Array.isArray(entries) ? entries : [];
  const ignoredNames = [userName, currentAgentId, ...list.flatMap((entry) => [entry?.agentName, entry?.agentId])];
  const candidates = list
    .filter((entry) => usable(entry) && usableAgentId(entry.agentId) && (shared || entry.agentId === currentAgentId))
    .filter((entry) => entry.date >= last && entry.date <= first)
    .map((entry) => ({ ...entry, score: scoreSummaryEntry(entry, { baseDates, prompt, now, boundaryHour, ignoredNames }) }))
    .filter((entry) => Number.isFinite(entry.score));

  const base = candidates.filter((entry) => baseDates.has(entry.date)).sort((a, b) => {
    const aCurrent = a.agentId === currentAgentId ? 1 : 0;
    const bCurrent = b.agentId === currentAgentId ? 1 : 0;
    return bCurrent - aCurrent || dateOrder(a, b);
  });
  const expanded = candidates
    .filter((entry) => !baseDates.has(entry.date))
    .sort((a, b) => b.score - a.score || dateOrder(a, b));

  const selected = [];
  const used = new Set();
  let chars = 0;
  for (const entry of [...base, ...expanded]) {
    const key = `${entry.date}\u0000${entry.agentId}`;
    if (used.has(key) || selected.length >= Math.max(1, Number(maxEntries) || 10)) continue;
    const text = String(entry.text || "").trim();
    const remaining = Math.max(0, Number(maxChars) || RECENT_CHAR_BUDGET) - chars;
    if (!remaining) break;
    const clipped = text.slice(0, remaining);
    if (!clipped) break;
    selected.push({ ...entry, text: clipped, expanded: !baseDates.has(entry.date) });
    used.add(key);
    chars += clipped.length;
  }

  return {
    entries: selected,
    baseDates: [...baseDates],
    expanded: selected.some((entry) => entry.expanded),
  };
}

export function formatRecentSummaries(entries, {
  currentAgentId = "",
  shared = false,
  proactiveDate = "",
} = {}) {
  const list = (Array.isArray(entries) ? entries : []).filter((entry) => usable(entry) && usableAgentId(entry.agentId));
  if (!list.length) return "";
  const formatEntry = (entry) => {
    const isOther = shared && entry.agentId !== currentAgentId;
    const who = isOther ? `· ${entry.agentName || entry.agentId}` : "";
    return `${entry.date}${who}：${entry.text}`;
  };
  const proactive = proactiveDate ? list.filter((entry) => entry.date === proactiveDate) : [];
  const background = proactiveDate ? list.filter((entry) => entry.date !== proactiveDate) : list;
  const lines = [];
  if (proactive.length) {
    lines.push(`【历史档案｜生活日 ${proactiveDate}】`);
    lines.push(...proactive.map(formatEntry));
    // 日期与使用规则由 buildInjectionText 在整条背景末尾统一提供，避免重复注入。
  }
  if (background.length) {
    lines.push("【近期回忆】");
    lines.push(...background.map(formatEntry));
    lines.push("这些是按每行开头绝对日期归档的近期生活记录；只有和当前话题自然相关时才带出来，不要主动逐条汇报。");
  }
  return lines.join("\n");
}
