// 拾光记 · 拾性（性格补全）纯逻辑
// 与「用户情绪链」（lib/mood.js）、「伙伴心情线」（lib/partner-mood.js）并列的第三条线。
// 根本差别：
// - 情绪线锚「某天某个时段的心情」，短、快、每天一条；
// - 拾性锚「同一名字下长期反复出现的行为」，慢、稳、要攒够才说话。
// 三条铁律：
// 1. 只写可观察的行为，不替伙伴说内心。「讨厌被命令」越界，「被下命令时会先反问一句再照做」才是事实。
// 2. 证据必须能从原文摘出，摘不出就丢。宁可漏，不可编。
// 3. 样本不够就不成条。宁缺毋滥，空白比错判好。
// 本文件不碰存储、不碰网络、不碰界面，只做纯函数，方便直接单测。

// ── 条目分两类 ──
// pattern（一贯做法）：ta 反复在做同一件事，是 ta 的稳定习惯。
// deviation（反常的一刻）：ta 这次没按平时的样子来。它天生低频，门槛另算。
// 两者性质相反，绝不混进同一条目（见 applyRollup）。
export const XINGJI_ENTRY_KINDS = Object.freeze(["pattern", "deviation"]);
export function normalizeEntryKind(value) {
  return String(value || "").trim() === "deviation" ? "deviation" : "pattern";
}

// ── 观察与性格设定的关系 ──
// described：设定里写过这件事，ta 确实这么做的（设定活出来了）。
// unwritten：设定里没写，但 ta 一贯这样（这是补全的那一笔）。
// 空串：老数据没有这一栏，界面上不标，不当成任何一类。
// 注意这里没有「符合/违背」两档：设定里的形容词抓不住具体动作，
// 一个人写着「温柔」也照样会直接指错，判成「违背」等于拿刻板印象当尺子。
export const XINGJI_RELATIONS = Object.freeze(["described", "unwritten"]);
export function normalizeRelation(value) {
  const text = String(value || "").trim();
  return XINGJI_RELATIONS.includes(text) ? text : "";
}

// ── 门槛（2026-10-19 定，覆盖 2026-10-17 版）──
// 旧版把「跨 21 天」当成成条的一票否决，实际是个伪指标：
// 归纳是 7 天节律，日常每批喂进来的证据日期跨度天然不超过 7 天，
// 于是 138 天里 106 条有 81 条永远卡在 insufficient，一页都显示不出来。
// 现在只看证据条数 + 落在多少个不同的日子；distinctDays 本身已经挡住
// 「同一天重复三次」，跨度只留在 evaluated 里给界面展示，不再卡门槛。
export const XINGJI_MIN_POSITIVES = 3;
export const XINGJI_MIN_DISTINCT_DAYS = 2;
// 从「可能」升到「常见」，用日子数代替跨度。
export const XINGJI_LIKELY_POSITIVES = 5;
export const XINGJI_LIKELY_DISTINCT_DAYS = 5;
// 偏离档：低频事件，2 条 / 2 个日子就让它冒头，宁可少也别让它长不出来。
export const XINGJI_DEVIATION_MIN_POSITIVES = 2;
export const XINGJI_DEVIATION_MIN_DISTINCT_DAYS = 2;
export const XINGJI_DEVIATION_LIKELY_POSITIVES = 4;
export const XINGJI_DEVIATION_LIKELY_DISTINCT_DAYS = 4;

// ── 注入 ──
// 注入只接 pattern，deviation 一律不接：把「反常的一刻」喂回伙伴，
// 等于教 ta 把越界、破格当惯例重复。安全底线写死在 pickInjectableEntries 里。
// 只取等级最高的几条（likely 优先），避免十几条把上下文撑爆。
export const XINGJI_INJECT_MAX_ENTRIES = 3;

// 性格是慢变量：日采集只存观察，周汇总才归纳成条目。
export const XINGJI_ROLLUP_EVERY_DAYS = 7;

// ── 本地零 Token 事件预筛 ──
// 不是判性格，只是从一天的对话里挑出「可能暴露行为模式」的瞬间，交给模型再看。
// 挑不准的代价只是白花一次模型注意力，挑漏的代价是档案偏薄，两边都不致命。
export const CHARACTER_EVENT_KINDS = Object.freeze([
  "refuse", // 伙伴拒绝、反对、顶回去
  "self_correct", // 伙伴认错、改口、自我修正
  "joke", // 自嘲、玩笑
  "deep_dive", // 明显展开、认真到底的长回复
  "terse", // 极短收尾
  "comfort", // 用户低落时伙伴的应对
  "challenge", // 伙伴主动追问、质疑
  "warm", // 生活场景里带角色感的回应（称呼、语气、陪伴）
  "casual", // 生活场景里的随口闲聊
]);

const REFUSE_RE = /^(?:不|别|不行|那不行|我不同意|这不行|算了)|(?:但是|不过|可是)[^。！？\n]{0,6}我(?:不|没)/u;
const SELF_CORRECT_RE = /(?:我说错|我说得不对|我刚才说错|我改|改一下|重新说|上一条|收回|更正|不对，我|我纠正)/u;
const JOKE_RE = /(?:哈哈|嘿嘿|笑死|自嘲|开个玩笑|逗你)/u;
const USER_LOW_RE = /(?:累|难过|烦|哭|崩溃|撑不住|不想活|没意思|好丧|委屈|难受|焦虑|睡不着)/u;

// 「先认下再转正题」：模型被纠正时的通用反应，跨伙伴都一样，不是谁的性格。
const ACK_PIVOT_RE = /^(?:你(?:说的|说得)?(?:对|没错)|确实是我|是我(?:没|疏忽|的问题|弄错|搞错)|是我的问题|我错了|错了[。，,]).{0,80}(?:但|不过|不过话|先|现在|让我|我先把|接下来)/su;

// ── 内部思考块：不是给用户看的话，不能当素材 ──
// 每个伙伴的标签都不一样（mood / reflect / pulse / think），但它们都是内心嘀咕。
// 实测这部分在部分伙伴身上占到回复字数的七成，混进来会把「长篇回复」直接染成噪音。
const INTERNAL_BLOCK_TAGS = [
  "mood", "reflect", "reflection", "pulse", "think", "thinking", "thought",
  "analysis", "scratchpad", "internal", "echo", "premise", "conduct", "initvar",
];
const INTERNAL_BLOCK_RE = new RegExp(
  `<(${INTERNAL_BLOCK_TAGS.join("|")})\\b[^>]*>[\\s\\S]*?<\\/\\1>`,
  "gi",
);

/** 去掉回复里的内部思考块，只留下真正说出口的话。 */
export function stripInternalBlocks(text) {
  return String(text == null ? "" : text).replace(INTERNAL_BLOCK_RE, " ");
}

export const MAX_EVENTS_PER_AGENT = 8;
// 「长篇回复」不进主配额：它只说明这个模型话多，不说明 ta 是谁。
// 只有当天其他类型都凑不满名额时，才拿它兜底。
export const FALLBACK_EVENT_KINDS = Object.freeze(["deep_dive"]);
// 生活场景的卡优先占名额：人情味在碎话里，不在流程里。
// 但也不能全占，得留位置给干活时的反应（拒绝、认错、被顶回去）。
export const LIFE_EVENT_KINDS = Object.freeze(["warm", "casual", "comfort", "joke"]);
const MAX_EVENT_CARD_CHARS = 320;
const MIN_TEXT_CHARS = 2;

function clean(text) {
  return String(text == null ? "" : text).replace(/\s+/g, " ").trim();
}

/** 秒级时间戳 → 生活日 key（沿用日终链的 day 口径，由调用方传入即可，这里只做兜底）。 */
function stampOf(ts) {
  const n = Number(ts);
  if (!Number.isFinite(n)) return "";
  const d = new Date(n);
  if (Number.isNaN(d.getTime())) return "";
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

// ── 场景判定：先分清「在干活」还是「在过日子」──
// 性格主要露在闲话、情绪、被顶回去的时候；干活场景里露出来的是流程，不是人。
// 但工作场景里也有角色感（比如「磕头我收下了。抬头，把话听完。」），所以不是一刀切掉。
const WORK_TALK_RE = /(报错|错误信息|异常|崩|bug|日志|代码|函数|接口|部署|提交|仓库|版本号|插件|卡片|配置|路径|文件|测试|编译|依赖|参数|字段|路由|数据库|脚本|正则|变量|npm|git|api|json|css|html|js\b|python|node|skill|prompt|提示词|世界书|变量表|报错堆栈|修改|改一下|改成|改成|再改|美化|状态栏|布局|样式|生成|导入|安装|导出|打包|发布|更新|升级|加一个|加个|删掉|删除|写一个|写个|做成|换个|重写|修一下|修复|看看这个|这个功能|怎么用|咋用)/iu;
// 情绪、身体、关系、日常：这些才是看人的窗口
const LIFE_TALK_RE = /(累|困|饿|睡|吃|喝|难受|开心|高兴|烦|郁闷|委屈|想哭|哭|害怕|焦虑|压力|心跳|头疼|胃|身体|生理期|疼|冷|热|天气|下雨|圆宝|散步|逛街|买|礼物|喜欢|讨厌|想你|陪我|抱|亲|晚安|早安|梦|心情|感觉|觉得|好像|有点|不想|算了|呜呜|唉|哈哈|嘿嘿|好吃|好看|可爱)/u;

/** 这句话的场景：life（过日子）| work（干活）| other。 */
export function sceneOf(text) {
  const value = clean(text);
  if (!value) return "other";
  const work = WORK_TALK_RE.test(value);
  const life = LIFE_TALK_RE.test(value);
  // 只要在派活、报错、问技术，就算工作场景，不管顺口带了几个情绪词。
  // 反过来，纯生活碎话里提到「文件」「版本」这种词很少见，不靠它反推。
  if (work) return "work";
  if (life) return "life";
  return "other";
}

/** 这句回应有没有「角色感」：短句里带称呼/语气词/方言/标点情绪，而不是一串流程。 */
const CHARACTER_VOICE_RE = /(嘛|噻|哈|咯|呗|啦|呀|呢|吧|哦|嘛|嗷|呗|了哈)|(～|~|！|…)|(要得|巴适|哦豁|莫|咱|吾|侬)|(我替|陪你|慢慢|先别|不急着|别怕)/u;

function hasCharacterVoice(text) {
  const value = clean(text);
  if (!value) return false;
  if (value.length > 180) return false;
  return CHARACTER_VOICE_RE.test(value);
}

function kindOfReply(row, prevUserRow) {
  const text = clean(row.text);
  if (text.length < MIN_TEXT_CHARS) return "";
  // 生活场景优先：性格主要靠日子里的碎话露出来。
  const userScene = prevUserRow ? sceneOf(prevUserRow.text) : "other";
  const lifeScene = userScene === "life" || sceneOf(text) === "life";
  if (SELF_CORRECT_RE.test(text)) return "self_correct";
  if (REFUSE_RE.test(text) && text.length <= 200) return "refuse";
  const prevText = prevUserRow ? clean(prevUserRow.text) : "";
  if (prevText && USER_LOW_RE.test(prevText) && text.length >= 20) return "comfort";
  if (JOKE_RE.test(text) && text.length <= 200) return "joke";
  // 生活场景里的回应：先看有没有角色感，再看是不是随口闲聊。
  if (lifeScene) {
    if (hasCharacterVoice(text)) return "warm";
    if (text.length <= 120) return "casual";
    return "";
  }
  if (text.length >= 260) return "deep_dive";
  if (/[？?]/u.test(text) && text.length >= 40) return "challenge";
  if (text.length <= 16) return "terse";
  return "";
}

/** 从一组里均匀挑 count 个（而不是只拿最早的几个）。 */
function pickSpread(list, count) {
  const rows = Array.isArray(list) ? list : [];
  const want = Math.max(0, Number(count) || 0);
  if (want <= 0) return [];
  if (rows.length <= want) return rows.slice();
  if (want === 1) return [rows[Math.floor(rows.length / 2)]];
  const out = [];
  for (let i = 0; i < want; i += 1) {
    const at = Math.round((i * (rows.length - 1)) / (want - 1));
    const item = rows[at];
    if (item && !out.includes(item)) out.push(item);
  }
  return out;
}

/**
 * 同类型最多留两条、总数不超过 max 条。
 * 名额分三层：
 *   ① 生活场景的卡（warm/casual/comfort/joke）先占，最多占一半，留位给干活时的反应；
 *   ② 干活场景里的稀有信号（拒绝/认错/追问/极短）；
 *   ③ 「长篇回复」只当兜底。
 * 同类型内部按时间均匀取，不再只拿最早那几条。
 */
export function capEventList(list, max = MAX_EVENTS_PER_AGENT) {
  const all = (Array.isArray(list) ? list : []).filter((item) => item && item.kind);
  const limit = Math.max(1, Number(max) || MAX_EVENTS_PER_AGENT);
  const byKind = new Map();
  for (const item of all) {
    if (!byKind.has(item.kind)) byKind.set(item.kind, []);
    byKind.get(item.kind).push(item);
  }
  const life = [];
  const primary = [];
  const fallback = [];
  for (const [kind, rows] of byKind) {
    if (FALLBACK_EVENT_KINDS.includes(kind)) {
      fallback.push(...pickSpread(rows, 2));
    } else if (LIFE_EVENT_KINDS.includes(kind)) {
      life.push(...pickSpread(rows, 2));
    } else {
      primary.push(...pickSpread(rows, 2));
    }
  }
  const sortByTs = (rows) => rows.slice().sort((a, b) => (Number(a.ts) || 0) - (Number(b.ts) || 0));
  // 生活场景最多占一半，剩下的留给干活时的反应，不然一天就只剩闲聊了。
  const lifeQuota = Math.min(life.length, Math.ceil(limit / 2));
  const chosen = pickSpread(sortByTs(life), lifeQuota);
  const already = new Set(chosen);
  const rest = sortByTs(primary).filter((item) => !already.has(item));
  chosen.push(...pickSpread(rest, Math.min(rest.length, limit - chosen.length)));
  if (chosen.length < limit) {
    const taken = new Set(chosen);
    const filler = sortByTs(fallback).filter((item) => !taken.has(item));
    chosen.push(...pickSpread(filler, limit - chosen.length));
  }
  return sortByTs(chosen);
}

/**
 * 找某个伙伴那天的候选事件卡。
 * rows: collectDayMessages 的原始消息（含 ts/role/agentId/text）
 * 返回 [{ ts, day, kind, userText, replyText }]，同类型最多留两条，总数不超过 MAX_EVENTS_PER_AGENT。
 */
export function findCharacterEvents(rows, agentId) {
  const target = String(agentId || "").trim();
  if (!target) return [];
  const list = (Array.isArray(rows) ? rows : [])
    .filter((row) => row && String(row.agentId || "") === target)
    .sort((a, b) => (Number(a.ts) || 0) - (Number(b.ts) || 0));
  const picked = [];
  let prevUser = null;
  for (const row of list) {
    if (row.role === "user") {
      prevUser = row;
      continue;
    }
    if (row.role !== "assistant") continue;
    // 内部思考块不是说给用户听的话，剥掉再判类型，否则「话多」会被当成性格信号。
    const cleaned = clean(stripInternalBlocks(row.text));
    if (!cleaned) continue;
    const kind = kindOfReply({ ...row, text: cleaned }, prevUser);
    if (!kind) continue;
    const replyText = cleaned.slice(0, MAX_EVENT_CARD_CHARS);
    if (!replyText) continue;
    picked.push({
      ts: Number(row.ts) || null,
      day: stampOf(row.ts),
      kind,
      userText: prevUser ? clean(prevUser.text).slice(0, 160) : "",
      replyText,
    });
    prevUser = null;
  }
  return capEventList(picked, MAX_EVENTS_PER_AGENT);
}

/** 门控：这一天有没有任何值得让模型看一眼的瞬间。 */
export function hasCharacterEvent(rows, agentId) {
  return findCharacterEvents(rows, agentId).length > 0;
}

// ── 通用习惯：跨伙伴都一样写法，不能当任何人的性格证据 ──
// 两种情况要分开：
// 1. 全部伙伴都高频 → 是模型/宿主带的排版与附和习惯，剔除；
// 2. 只有一个伙伴高频 → 才是 ta 自己的特征，留着。
// 这条不写死名单，靠横向对比得出来，所以模型改了排版习惯也不用改代码。
export const STYLE_MARKERS = Object.freeze([
  { id: "bold", label: "加粗强调", test: (text) => /\*\*[^*\n]+\*\*/u.test(text) },
  { id: "bullet", label: "项目符号列表", test: (text) => /^\s*[-*]\s+\S/mu.test(text) },
  { id: "numbered", label: "编号步骤", test: (text) => /^\s*\d+[.、]\s/mu.test(text) },
  { id: "heading", label: "小标题", test: (text) => /^#{2,4}\s/mu.test(text) },
  { id: "ack_pivot", label: "先认了再转正题", test: (text) => ACK_PIVOT_RE.test(text) },
  { id: "say_agreed", label: "先例式认同", test: (text) => /^(?:你说得?(?:对|没错)|确实|是的[，,])/u.test(text.trim()) },
]);

/**
 * 算每个伙伴身上每个排版/附和习惯的出现率。
 * profiles: [{ agentId, texts: string[] }]
 * 返回 { [markerId]: { label, rates: { [agentId]: 0~1 }, generic } }
 */
export function detectGenericHabits(profiles, { minRate = 0.1, minAgents = 2 } = {}) {
  const list = (Array.isArray(profiles) ? profiles : []).filter((p) => p && Array.isArray(p.texts) && p.texts.length);
  const out = {};
  for (const marker of STYLE_MARKERS) {
    const rates = {};
    for (const profile of list) {
      const hits = profile.texts.filter((text) => marker.test(String(text || ""))).length;
      rates[String(profile.agentId || "")] = hits / profile.texts.length;
    }
    const hot = Object.values(rates).filter((rate) => rate >= minRate).length;
    const needed = Math.max(minAgents, Math.ceil(list.length / 2));
    out[marker.id] = { label: marker.label, rates, generic: list.length >= 2 && hot >= needed };
  }
  return out;
}

/**
 * 把横向对比的结果拼成一句提示：哪些习惯在这个账号里算「人人都有」。
 * 只拿真的算通用的那几项，一个都没命中就返回空串（此时提示词不多说一句）。
 */
export function formatGenericHabitsNote(habits) {
  const rows = Object.entries(habits && typeof habits === "object" ? habits : {})
    .filter(([, item]) => item && item.generic === true)
    .map(([, item]) => clean(item.label))
    .filter(Boolean);
  return [...new Set(rows)].join("、");
}

// 只有一个伙伴的用户没法做横向对比，就用内置基线：
// 这批数是从现有历史里量的（五个以上伙伴的加粗率都在 29%~35%，属于宿主/模型自带的排版习惯）。
// 它是兵不是尺，只当“可能普遍”看，命中时仍要说一句是基线判的。
export const BUILTIN_GENERIC_MARKERS = Object.freeze(["bold", "bullet", "numbered", "heading", "ack_pivot"]);

/** 单伙伴时的兵底：按内置基线判，不假装是实测出来的。 */
export function genericHabitsFromBaseline() {
  const out = {};
  for (const marker of STYLE_MARKERS) {
    if (!BUILTIN_GENERIC_MARKERS.includes(marker.id)) continue;
    out[marker.id] = { label: marker.label, rates: {}, generic: true, source: "baseline" };
  }
  return out;
}

/** 给一批对话算通用习惯：伙伴数≥ 2 走实测对比，只有一个伙伴时走内置基线。 */
export function resolveGenericHabits(profiles, options = {}) {
  const list = (Array.isArray(profiles) ? profiles : []).filter((p) => p && Array.isArray(p.texts) && p.texts.length);
  if (list.length >= 2) return detectGenericHabits(list, options);
  return genericHabitsFromBaseline();
}

/**
 * 从当天的原始消息里抽出每个伙伴的发言（已剥掉内部思考块），用来做横向对比。
 * rows: [{ agentId, role, text }]
 */
export function buildStyleProfiles(rows) {
  const map = new Map();
  for (const row of Array.isArray(rows) ? rows : []) {
    if (!row || row.role !== "assistant") continue;
    const agentId = String(row.agentId || "").trim();
    if (!agentId) continue;
    const text = clean(stripInternalBlocks(row.text));
    if (!text) continue;
    if (!map.has(agentId)) map.set(agentId, []);
    map.get(agentId).push(text);
  }
  return [...map.entries()].map(([agentId, texts]) => ({ agentId, texts }));
}

// 描述「通用习惯」本身的行为描述：这些不是性格，是模型的默认反应。
// 认错那两条要收紧：只认「认错/道歉/接受指正」这类明确指错语境，
// 「承认」太宽——「先承认自己不知道再去查」是真性格，不能被误杀。
const GENERIC_BEHAVIOR_RULES = Object.freeze([
  { id: "ack_first", label: "被指错先认下来", test: (text) => /(认错|道歉|认下来|承认(?:自己)?(?:说)?错|接受指正|先肯定对方|先附和)/u.test(text) && /(再|然后|接着|之后|转|回到|继续|改口|改方案)/u.test(text) },
  { id: "ack_alone", label: "被指错就认", test: (text) => /^(?:直接)?(?:认错|道歉|认下来|接受指正)/u.test(text) },
  { id: "format", label: "排版习惯", test: (text) => /(列表|分点|条列|小标题|加粗|分段|编号)/u.test(text) },
  { id: "verbose", label: "话多", test: (text) => /(写得很长|展开篇幅|写得详细|长篇|长篇大论)/u.test(text) },
  // 干活流程：每个伙伴接活都是这一套，谁身上都有，不是性格。
  // 这一条是 2026-10-19 补的：上次重跑长出来的条目五个人四个都是这类，全废了。
  { id: "workflow", label: "干活的通用流程", test: (text) => /(先查日志|查日志|定位根因|定位原因|复述(?:对方|用户|她)?的?要求|先复述|拆解需求|拆解问题|列(?:出)?(?:可选)?方案|给方案|给建议|汇报改动|说明改动|改动清单|报版本号|逐条对照|先给结论|先定位|再动手|再改|改完|拆成几条)/u.test(text) },
]);

/** 这条行为描述是不是在描述「模型通用习惯」；命中就返回原因，否则空串。 */
export function classifyGenericBehavior(behavior) {
  const text = clean(behavior);
  if (!text) return "";
  for (const rule of GENERIC_BEHAVIOR_RULES) {
    if (rule.test(text)) return rule.id;
  }
  return "";
}

/** 事件卡的提示词文本。只给反应和紧邻情境，不给整天流水账。 */
export function formatEventsForPrompt(events) {
  const list = Array.isArray(events) ? events : [];
  if (!list.length) return "（今天没有筛到值得观察的瞬间）";
  const kindLabel = {
    refuse: "反对/拒绝",
    self_correct: "认错/自我修正",
    joke: "玩笑/自嘲",
    deep_dive: "长篇认真展开",
    terse: "极短收尾",
    comfort: "对方低落时的应对",
    challenge: "主动追问/质疑",
  };
  return list
    .map((item, index) => {
      const when = item.day || "时间不明";
      const prev = item.userText ? `对方上一句：${item.userText}` : "对方上一句：（无）";
      return `[${index + 1}] ${when} · 类型：${kindLabel[item.kind] || item.kind}\n${prev}\nta 的回应：${item.replyText}`;
    })
    .join("\n\n");
}

/**
 * 日采集提示词：只从事件卡里认两样东西——
 * pattern（一贯做法，反复在做的那件事）与 deviation（反常的一刻，这次没按平时的样子来）。
 * 不认形容词、不认心理。identityText 是伙伴自己的性格设定，当「对照物」用：
 * 让模型标这条做法在设定里有没有写过，而不是当成「写过的不许再记」的排除清单。
 *
 * 2026-10-19 改：人味不在流程里。要把「怎么干活」和「这个人什么样」分开——
 * 先查日志再改、先复述再拆解，这些是每个伙伴都会的干活路数，不是谁的性格。
 * 真正见人的是：ta 怎么称呼你、什么时候不干活只陪你、被顶回去的第一反应。
 */
export function buildObservationPrompt({ agentName, userName, day, eventsText, identityText = "", genericNote = "" }) {
  const name = String(agentName || "伙伴").trim() || "伙伴";
  const user = String(userName || "对方").trim() || "对方";
  const baseline = String(identityText || "").trim();
  return (
    `你是拾光记的观察员。生活日 ${day} 已经结束，下面是「${name}」和「${user}」当天往来里挑出的几个瞬间。\n` +
    `任务：只从这些瞬间里，找出两种观察，并给每条标明是哪种。\n` +
    `- pattern（一贯做法）：${name}反复在做的同一件事。\n` +
    `- deviation（反常的一刻）：${name}这次没按平时的样子来。比如平时先道歉，这次直接改了方案；平时话多，这次特别短；被${user}纠正之后才改口或才补做；说了跟自己平常立场不一样的话。\n\n` +
    (baseline
      ? `「${name}」自己的性格设定（只用来对照：看看这条做法在设定里有没有写过。设定里的词是壳，实际怎么做才是肉，两边不一样很正常）：\n${baseline}\n\n`
      : "") +
    `今天的候选瞬间：\n${eventsText || "（无）"}\n\n` +
    `输出格式：只输出一个 JSON 数组，不要任何其他文字。\n` +
    `[{ "kind": "pattern|deviation", "situation": "什么情况", "behavior": "ta 具体怎么做（动词开头，不写形容词）", "evidence": "从上面原文里一字不改摘出的短句", "relation": "described|unwritten", "polarity": "pos|neg" }]\n\n` +
    `规则：\n` +
    `- relation 看这条做法在设定里有没有写过：设定里有对应的一句，标 described；设定里没写、但 ta 确实这么做，标 unwritten。${baseline ? "" : "这次没读到设定，全部标 unwritten。"}\n` +
    `- relation 只问「写过没有」，不问「符不符合」。设定写着一个词、ta 做出来的是另一套具体动作，照样标 unwritten，situation 里照实写当时的情况，不要补一句评价。\n` +
    `- 下面这些东西不是性格，一律不要写成观察：写完回复就分点列、加粗、用小标题；被指错就先说「你说得对」再转正题；因为活干得细而写得很长。这些是模型自带的习惯，每个伙伴身上都差不多。\n` +
    (genericNote
      ? `- 这次实测下来，下面这些习惯在这个账号的伙伴身上普遍都有，占比很高，更不要当性格记：${genericNote}\n`
      : "") +
    `- 【最重要的一条】干活的路数不是性格。「先查日志再改」「先复述要求再拆解」「改完报改动清单」「被指错先认再改」「先给结论再分点」——这些是任何伙伴接活都会做的事，谁身上都有，记下来只会让所有人长成同一个人。看到这类，一律不要写。\n` +
    `- 要找的是这个人身上单独有的东西：ta 怎么称呼${user}、用的什么语气词和口头禅；不干活的时候会说什么；${user} 情绪低的时候 ta 的第一反应；被顶回去时是顶回来、讽一句、还是让一步；什么时候不愿多说、什么时候多走一步；有没有忽然跑题、开玩笑、闹别扭、说一句不着调的。\n` +
    `- 允许你记「没在干活的那一面」：一句随口的关心、一个绰号、一次玩笑、一句嫌弃。这些比工作流程更能看出是谁。\n` +
    `- kind 是这次观察最重要的一栏，拿不准就标 pattern；把不是反常的东西标成 deviation 比标反了更糟。\n` +
    `- deviation 是低频的，一天最多 1 条；一天里没有任何反常，就一条 deviation 也不要输出。\n` +
    `- behavior 必须是能看懂动作的描述，比如「先复述一遍对方的要求再回答」「这次没道歉，直接把方案换了」。不许写「温柔」「理性」「高情商」这类形容词，也不许写「ta 其实很在意」。\n` +
    `- evidence 必须能在上面原文里一字不改找到；找不到就整条不要输出。\n` +
    `- polarity 写这条做法是「符合预期」还是「不符合预期」，跟 kind 无关。\n` +
    `- 只观察「${name}」这一方，不要评价${user}。\n` +
    `- 没有任何值得记的，就输出空数组 []。宁缺毋滥。宁可一天只记一条像人的，也不要三条都是干活流程。\n` +
    `- 当天最多输出 3 条。`
  );
}

/** 去掉 markdown 围栏，取第一个 JSON 数组片段。 */
function extractJsonArray(raw) {
  const text = String(raw || "").trim();
  if (!text) return "";
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const body = fenced ? fenced[1].trim() : text;
  const start = body.indexOf("[");
  if (start < 0) return "";
  let depth = 0;
  let inString = false;
  let escape = false;
  for (let i = start; i < body.length; i += 1) {
    const ch = body[i];
    if (escape) {
      escape = false;
      continue;
    }
    if (ch === "\\") {
      escape = true;
      continue;
    }
    if (ch === '"') {
      inString = !inString;
      continue;
    }
    if (inString) continue;
    if (ch === "[") depth += 1;
    else if (ch === "]") {
      depth -= 1;
      if (depth === 0) return body.slice(start, i + 1);
    }
  }
  return "";
}

function squeeze(text) {
  return clean(text).replace(/[「」『』“”"'`]/g, "");
}

/** JSON 解析兜底：模型偶尔会带尾逗号，先按原样解析，失败再清一次。 */
function parseJsonLoose(text) {
  try {
    return JSON.parse(text);
  } catch {
    try {
      return JSON.parse(String(text || "").replace(/,\s*([}\]])/g, "$1"));
    } catch {
      return null;
    }
  }
}

/**
 * 归纳输出里的观察编号：模型可能写成 [1,2]、["O1","O2"]、"1,2" 或 observations 别名。
 * 这里只认数字，编号越界或重复的直接丢掉。
 */
function pickObservationIndexes(value, max) {
  const raw = Array.isArray(value)
    ? value
    : (typeof value === "string" ? value.split(/[^0-9]+/u) : []);
  const out = [];
  const seen = new Set();
  for (const item of raw) {
    const digits = String(item == null ? "" : item).replace(/[^0-9]/g, "");
    if (!digits) continue;
    const n = Number(digits);
    if (!Number.isInteger(n) || n < 1 || n > max || seen.has(n)) continue;
    seen.add(n);
    out.push(n);
  }
  return out;
}

/**
 * 解析日采集输出。evidence 必须能在当天原文里找到（去空白与引号后比对），否则整条丢弃。
 * sourceText: 当天该伙伴相关的原文合集，用来做证据校验。
 */
export function parseObservationOutput(raw, { sourceText = "", maxItems = 3, maxDeviations = 1 } = {}) {
  const json = extractJsonArray(raw);
  if (!json) return [];
  const rows = parseJsonLoose(json);
  if (!Array.isArray(rows)) return [];
  const source = squeeze(sourceText);
  const out = [];
  let deviationCount = 0;
  for (const item of rows) {
    if (!item || typeof item !== "object") continue;
    const situation = clean(item.situation).slice(0, 120);
    const behavior = clean(item.behavior).slice(0, 120);
    const evidence = clean(item.evidence).slice(0, 200);
    if (!situation || !behavior || !evidence) continue;
    if (source && !source.includes(squeeze(evidence))) continue;
    if (/温柔|理性|高情商|善良|聪明|体贴|善良的|的人格|性格是/u.test(behavior)) continue;
    // 模型自带的习惯（被指错先认、分点列、话多）不是性格：
    // 提示词已经拦了一道，这里是代码层兜底，防模型换个说法绕过去。
    if (classifyGenericBehavior(behavior)) continue;
    // 偏离是低频事件，一天最多留 maxDeviations 条，避免模型把普通一天标成反常。
    const kind = normalizeEntryKind(item.kind);
    if (kind === "deviation") {
      if (deviationCount >= maxDeviations) continue;
      deviationCount += 1;
    }
    out.push({ kind, situation, behavior, evidence, relation: normalizeRelation(item.relation), polarity: item.polarity === "neg" ? "neg" : "pos" });
    if (out.length >= maxItems) break;
  }
  return out;
}

/**
 * 周汇总提示词：把攒下的观察归纳成「情境 + 行为」条目。
 * 已有条目一并给出，让模型判断新观察是补充旧条目还是另立新条目。
 */
export function buildRollupPrompt({ agentName, userName, observations, existingEntries = [] }) {
  const name = String(agentName || "伙伴").trim() || "伙伴";
  const kindLabel = { pattern: "一贯做法", deviation: "反常的一刻" };
  const obs = (Array.isArray(observations) ? observations : [])
    .map((item, index) => `[O${index + 1}] ${item.day || "日期不明"} · ${kindLabel[normalizeEntryKind(item.kind)]}｜情境：${item.situation}｜做法：${item.behavior}｜原话：${item.evidence}`)
    .join("\n");
  const old = (Array.isArray(existingEntries) ? existingEntries : [])
    .map((item, index) => `[E${index + 1}] ${kindLabel[normalizeEntryKind(item.kind)]}｜${item.situation}｜${item.behavior}（已有 ${(item.positives || []).length} 条证据）`)
    .join("\n");
  return (
    `你在整理「${name}」的性格补全档案。下面是攒下来的一批观察，以及档案里已有的条目。\n\n` +
    `已有的两类条目：\n${old || "（还没有条目）"}\n\n` +
    `新观察：\n${obs || "（没有新观察）"}\n\n` +
    `请把这些观察归纳成条目。输出一个 JSON 数组，不要任何其他文字。\n` +
    `[{ "action": "new|merge", "target": "合并时的已有编号 E1；新建留空", "kind": "pattern|deviation", "situation": "什么情况下", "behavior": "ta 怎么做（动词开头）", "triggers": { "strong": ["单独出现就代表这种情境的词"], "weak": ["一起出现才代表这种情境的词"] }, "observationIndexes": [1, 3] }]\n\n` +
    `规则：\n` +
    `- kind 照抄观察上的分类，pattern 是一贯做法，deviation 是反常的一刻。\n` +
    `- 只有 kind 相同才能合并。做法和反常的两条绝不能合进同一条目，kind 不同就新建。\n` +
    `- behavior 只写动作，不写形容词，不写心理。\n` +
    `- observationIndexes 写这条条目用到了哪几条观察，编号对应上面的 O 编号。\n` +
    `- triggers 的词必须真的出现在相关观察的原话里，强触发词最多 3 个，弱触发词最多 4 个。\n` +
    `- 一条观察都不沾的条目不要输出。\n` +
    `- situation 和 behavior 各写短一点，不超过 40 个字，别写长段落。\n` +
    `- 最多输出 6 条；宁可少，不要凑。\n` +
    `- deviation 类只输出确实反复反常过的那几条；只有一次就不要立条目。\n` +
    `- 观察太散、指向不了任何稳定做法时，输出空数组 []。\n` +
    `- 不要为了凑数硬合并不同的情境。`
  );
}

/** 解析周汇总输出。triggers 的词必须出现在引用观察的原话里，否则丢掉。 */
export function parseRollupOutput(raw, { observations = [], maxItems = 6 } = {}) {
  const json = extractJsonArray(raw);
  if (!json) return [];
  const rows = parseJsonLoose(json);
  if (!Array.isArray(rows)) return [];
  const obs = Array.isArray(observations) ? observations : [];
  const out = [];
  for (const item of rows) {
    if (!item || typeof item !== "object") continue;
    const situation = clean(item.situation).slice(0, 120);
    const behavior = clean(item.behavior).slice(0, 120);
    if (!situation || !behavior) continue;
    const indexes = pickObservationIndexes(
      item.observationIndexes ?? item.observations ?? item.indexes ?? item.obsIndexes ?? item.observation_indexes,
      obs.length,
    );
    if (!indexes.length) continue;
    const sourceText = indexes.map((n) => String(obs[n - 1]?.evidence || "")).join("\n");
    const pickWords = (value, limit) => {
      const list = Array.isArray(value) ? value : [];
      const seen = new Set();
      const words = [];
      for (const word of list) {
        const w = clean(word).slice(0, 12);
        if (!w || seen.has(w)) continue;
        if (!squeeze(sourceText).includes(squeeze(w))) continue;
        seen.add(w);
        words.push(w);
        if (words.length >= limit) break;
      }
      return words;
    };
    out.push({
      action: item.action === "merge" ? "merge" : "new",
      target: clean(item.target).slice(0, 8),
      kind: normalizeEntryKind(item.kind),
      situation,
      behavior,
      triggers: {
        strong: pickWords(item.triggers?.strong, 3),
        weak: pickWords(item.triggers?.weak, 4),
      },
      observationIndexes: indexes,
    });
    if (out.length >= maxItems) break;
  }
  return out;
}

function daySpan(list) {
  const days = [...new Set(list.map((item) => String(item.day || item.date || "").trim()).filter(Boolean))].sort();
  if (days.length < 2) return 0;
  const first = new Date(`${days[0]}T00:00:00`);
  const last = new Date(`${days[days.length - 1]}T00:00:00`);
  if (Number.isNaN(first.getTime()) || Number.isNaN(last.getTime())) return 0;
  return Math.round((last.getTime() - first.getTime()) / 86400000);
}

/**
 * 门槛判定：这条特征现在够不够格出现在档案里。
 * 返回 { level, kind, distinctDays, spanDays, positives, reason }，level ∈ insufficient | possible | likely
 * 按 kind 分档：做法档严（3 条 / 2 天起），偏离档松（2 条 / 2 天起）。
 */
export function evaluateEntry(entry) {
  const kind = normalizeEntryKind(entry?.kind);
  const positives = Array.isArray(entry?.positives) ? entry.positives.filter((p) => p && String(p.text || "").trim()) : [];
  const negatives = Array.isArray(entry?.negatives) ? entry.negatives.filter((p) => p && String(p.text || "").trim()) : [];
  const distinctDays = new Set(positives.map((p) => String(p.date || "").trim()).filter(Boolean)).size;
  const spanDays = daySpan(positives);
  const minPositives = kind === "deviation" ? XINGJI_DEVIATION_MIN_POSITIVES : XINGJI_MIN_POSITIVES;
  const minDays = kind === "deviation" ? XINGJI_DEVIATION_MIN_DISTINCT_DAYS : XINGJI_MIN_DISTINCT_DAYS;
  const likelyPositives = kind === "deviation" ? XINGJI_DEVIATION_LIKELY_POSITIVES : XINGJI_LIKELY_POSITIVES;
  const likelyDays = kind === "deviation" ? XINGJI_DEVIATION_LIKELY_DISTINCT_DAYS : XINGJI_LIKELY_DISTINCT_DAYS;
  const base = { kind, positives: positives.length, negatives: negatives.length, distinctDays, spanDays };
  if (positives.length < minPositives || distinctDays < minDays) {
    return {
      ...base,
      level: "insufficient",
      reason: kind === "deviation"
        ? `还不够：${positives.length} 条 / ${distinctDays} 天`
        : `证据还不够：${positives.length} 条 / ${distinctDays} 天`,
    };
  }
  if (positives.length >= likelyPositives && distinctDays >= likelyDays) {
    return { ...base, level: "likely", reason: kind === "deviation" ? "反常过几回" : "证据稳定" };
  }
  return { ...base, level: "possible", reason: kind === "deviation" ? "反常过一次" : "基本站得住" };
}

/** 新证据去重：同一天同一句话不重复记。relation 跟着证据一起存，老数据没有这一栏。 */
export function pushEvidence(list, item) {
  const rows = Array.isArray(list) ? list.slice() : [];
  const date = String(item?.date || "").trim();
  const text = clean(item?.text);
  if (!date || !text) return rows;
  if (rows.some((row) => String(row.date || "") === date && squeeze(row.text) === squeeze(text))) return rows;
  const relation = normalizeRelation(item?.relation);
  const row = { date, text: text.slice(0, 200) };
  if (relation) row.relation = relation;
  rows.push(row);
  return rows.sort((a, b) => String(a.date).localeCompare(String(b.date)));
}

/** 把一条新观察并进已有条目：证据入账，触发词补全。 */
export function mergeObservationIntoEntry(entry, observation, { day = "" } = {}) {
  if (!entry) return entry;
  const date = String(day || observation?.day || "").trim();
  const polarity = observation?.polarity === "neg" ? "negatives" : "positives";
  const next = { ...entry };
  next[polarity] = pushEvidence(entry[polarity], { date, text: observation?.evidence, relation: normalizeRelation(observation?.relation) });
  next.updatedAt = new Date().toISOString();
  const evaluated = evaluateEntry(next);
  next.level = evaluated.level;
  next.evaluated = evaluated;
  return next;
}

/**
 * 条目跟设定的关系：看它收进来的证据怎么说，多的那边算数；一条带 relation 的证据都没有
 * （老档案）就返回空串，界面上不标标签，也不当成任何一类。
 */
export function dominantRelation(entry) {
  const counts = { described: 0, unwritten: 0 };
  for (const bucket of [entry?.positives, entry?.negatives]) {
    for (const item of Array.isArray(bucket) ? bucket : []) {
      const relation = normalizeRelation(item?.relation);
      if (relation) counts[relation] += 1;
    }
  }
  if (!counts.described && !counts.unwritten) return "";
  return counts.described >= counts.unwritten ? "described" : "unwritten";
}

/** 条目能否出现在用户眼前（只有够门槛的才展示）。 */
export function isVisibleEntry(entry) {
  return evaluateEntry(entry).level !== "insufficient" && entry?.status !== "rejected";
}

function mergeTriggers(before, incoming) {
  const pick = (value, limit) => {
    const out = [];
    const seen = new Set();
    for (const word of [...(Array.isArray(value) ? value : [])]) {
      const w = clean(word).slice(0, 12);
      if (!w || seen.has(w)) continue;
      seen.add(w);
      out.push(w);
      if (out.length >= limit) break;
    }
    return out;
  };
  return {
    strong: pick([...(before?.strong || []), ...(incoming?.strong || [])], 3),
    weak: pick([...(before?.weak || []), ...(incoming?.weak || [])], 4),
  };
}

function newEntryId(now) {
  return `xj-${now.getTime().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * 把周归纳结果落到条目上。
 * entries: 现有条目；items: parseRollupOutput 的结果；observations: 本次喂给模型的观察（编号从 1 开始）。
 * 只有被引用的观察才会入账，没被引用的留着下次继续攒。
 */
export function applyRollup(entries, items, observations, { now = new Date() } = {}) {
  const list = (Array.isArray(entries) ? entries : []).map((entry) => ({
    ...entry,
    positives: Array.isArray(entry?.positives) ? entry.positives.slice() : [],
    negatives: Array.isArray(entry?.negatives) ? entry.negatives.slice() : [],
  }));
  const obs = Array.isArray(observations) ? observations : [];
  for (const item of Array.isArray(items) ? items : []) {
    if (!item || !item.behavior) continue;
    const picked = (Array.isArray(item.observationIndexes) ? item.observationIndexes : [])
      .map((index) => obs[index - 1])
      .filter(Boolean);
    if (!picked.length) continue;

    let target = null;
    if (item.action === "merge" && item.target) {
      const index = Number(String(item.target).replace(/\D/g, "")) - 1;
      if (Number.isInteger(index) && index >= 0 && index < list.length) target = list[index];
    }
    if (!target) {
      const wanted = squeeze(item.behavior);
      target = list.find((entry) => squeeze(entry.behavior) === wanted) || null;
    }
    // 做法与偏离性质相反，混进同一条目会让门槛判定失去意义（松紧两档套在一条上）。
    // 模型没分清就把这次合并撤销，另立新条目，不污染已有那条。
    if (target && normalizeEntryKind(target.kind) !== normalizeEntryKind(item.kind)) target = null;

    if (!target) {
      target = {
        id: newEntryId(now),
        kind: normalizeEntryKind(item.kind),
        situation: item.situation || "",
        behavior: item.behavior,
        triggers: { strong: [], weak: [] },
        positives: [],
        negatives: [],
        status: "active",
        createdAt: now.toISOString(),
        updatedAt: now.toISOString(),
      };
      list.push(target);
    }

    for (const observation of picked) {
      const date = String(observation.day || "").trim();
      const bucket = observation.polarity === "neg" ? "negatives" : "positives";
      target[bucket] = pushEvidence(target[bucket], { date, text: observation.evidence, relation: normalizeRelation(observation.relation) });
    }
    target.triggers = mergeTriggers(target.triggers, item.triggers);
    target.updatedAt = now.toISOString();
    const evaluated = evaluateEntry(target);
    target.level = evaluated.level;
    target.evaluated = evaluated;
  }
  return list;
}

// ── 拾性注入 ──

/**
 * 挑可以接回对话的条目。
 * 硬约束：deviation 永远不入选——把「反常的一刻」喂回去等于教 ta 把破格当惯例。
 * 另外只取等级最高的几条，等级相同则证据多的优先，避免十几条把上下文撑爆。
 */
export function pickInjectableEntries(profile, { limit = XINGJI_INJECT_MAX_ENTRIES } = {}) {
  const cap = Math.max(0, Number(limit) || 0);
  if (!cap) return [];
  const entries = Array.isArray(profile?.entries) ? profile.entries : [];
  const levelRank = { likely: 2, possible: 1 };
  return entries
    .filter((entry) => entry && normalizeEntryKind(entry.kind) === "pattern")
    .filter((entry) => entry.status !== "rejected" && isVisibleEntry(entry))
    .map((entry) => {
      const evaluated = evaluateEntry(entry);
      return {
        id: entry.id,
        kind: "pattern",
        situation: clean(entry.situation).slice(0, 60),
        behavior: clean(entry.behavior).slice(0, 80),
        rank: levelRank[evaluated.level] || 0,
        weight: Array.isArray(entry.positives) ? entry.positives.length : 0,
        updatedAt: String(entry.updatedAt || ""),
      };
    })
    .filter((entry) => entry.rank > 0 && entry.situation && entry.behavior)
    .sort((a, b) => (b.rank - a.rank) || (b.weight - a.weight) || b.updatedAt.localeCompare(a.updatedAt))
    .slice(0, cap);
}

/**
 * 把挑中的做法拼成一段注入文本。
 * 句子用 ta 自己的口吻写成「你一向这么做」，是指令式的干脆，不是外部规则单：
 * 不写「请注意」「禁止」「应该」，也不写「你曾经……呢」这种软文。
 * 偏离条目不进这里（见 pickInjectableEntries）。
 */
export function buildXingjiInjectionText(entries) {
  const rows = (Array.isArray(entries) ? entries : [])
    .map((entry) => `- ${clean(entry.situation).replace(/[。！？\s]+$/u, "")}：${clean(entry.behavior)}`)
    .filter(Boolean);
  if (!rows.length) return "";
  return (
    `【你一贯的做法】\n` +
    `你一向就是这么做的，不用改，也别刻意表演：\n` +
    `${rows.join("\n")}\n` +
    `这些不用说出来，你照着自己平时的样子来就行。`
  );
}
