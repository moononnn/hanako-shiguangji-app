import { test } from 'node:test';
import assert from 'node:assert/strict';
import { promptTerms, scoreSummaryEntry, selectRecentSummaries, RECENT_BASE_DAYS, RECENT_LOOKBACK_DAYS, RECENT_CHAR_BUDGET } from '../lib/recent-summaries.js';
import { collectSnapshotSummaries } from '../lib/public-today.js';

process.env.TZ = 'Asia/Shanghai';
const now = new Date(2026, 9, 12, 8, 40);
const rows = [
  { date: '2026-10-11', agentId: 'partner-one', agentName: '青禾', text: '青禾和小满整理了日历。' },
  { date: '2026-10-10', agentId: 'partner-one', agentName: '青禾', text: '青禾和小满聊了窗外的小雨。' },
  { date: '2026-10-09', agentId: 'partner-one', agentName: '青禾', text: '青禾和小满喝了茶。' },
  { date: '2026-10-08', agentId: 'partner-one', agentName: '青禾', text: '青禾和小满研究鲜花酿测卡和信任变量。', importance: 8 },
  { date: '2026-10-07', agentId: 'partner-one', agentName: '青禾', text: '青禾和小满处理提个醒通知收不到的问题。', importance: 9 },
  { date: '2026-10-06', agentId: 'partner-one', agentName: '青禾', text: '青禾和小满做了应用测试、插件发布和版本更新。', importance: 10 },
  { date: '2026-10-05', agentId: 'partner-one', agentName: '青禾', text: '青禾和小满给薄荷浇水。', importance: 5 },
];
const pick = (prompt, extra = {}) => selectRecentSummaries(rows, { now, currentAgentId: 'partner-one', userName: '小满', prompt, ...extra });
const dates = result => result.entries.map(row => row.date);

for (const prompt of ['早哇青禾~', '小满来啦，青禾', '你好', '我来了', '', '应用测试、插件发布、版本更新', '之前那个问题咋样了']) {
  test(`旧档案准入：无具体话题不展开（${prompt || '空查询'}）`, () => {
    assert.deepEqual(dates(pick(prompt)), ['2026-10-11', '2026-10-10', '2026-10-09']);
    assert.equal(pick(prompt).expanded, false);
  });
}

test('动态姓名和伙伴 ID 不成为相关性，中文称呼和英文问候同样排除', () => {
  assert.deepEqual(promptTerms('早哇青禾，小满，我来了', { ignoredNames: ['青禾', '小满'] }), []);
  assert.deepEqual(promptTerms('hello partner-one', { ignoredNames: ['partner-one'] }), []);
  assert.deepEqual(dates(pick('partner-one')), ['2026-10-11', '2026-10-10', '2026-10-09']);
});

test('明确项目名能单独命中，实际问题不受问候和称呼影响', () => {
  for (const prompt of ['鲜花酿', '早哇青禾，鲜花酿那个测卡后来咋样了']) {
    const result = pick(prompt);
    assert.ok(dates(result).includes('2026-10-08'));
    assert.ok(!dates(result).includes('2026-10-07'));
    assert.ok(!dates(result).includes('2026-10-06'));
  }
});

test('具体两字主题可单独检索，三字项目名不会被分词切碎', () => {
  assert.ok(dates(pick('浇水')).includes('2026-10-05'));
  assert.ok(dates(pick('测卡呢')).includes('2026-10-08'));
  assert.ok(dates(pick('提个醒的通知')).includes('2026-10-07'));
});

test('自然语气词不挡住具体两字主题，组合准入仍保持严格', () => {
  for (const suffix of ['吗', '哦', '呗', '咯', '喔', '噢']) {
    assert.ok(dates(pick(`浇水${suffix}`)).includes('2026-10-05'), suffix);
  }
});

test('组合查询不能只碰上一个局部二字词，重叠切片不算独立主题', () => {
  const entry = { date: '2026-10-08', agentId: 'partner-one', text: '处理图库报错', importance: 10 };
  assert.equal(scoreSummaryEntry(entry, { now, prompt: '图库推荐' }), -Infinity);
  const adjacent = { ...entry, text: '修了图库推荐' };
  assert.ok(Number.isFinite(scoreSummaryEntry(adjacent, { now, prompt: '图库推荐' })));
});

test('新项目名和组合主题不用固定词库，泛词也不吞掉完整项目名', () => {
  for (const topic of ['星河盒', '应用宝', 'DSHana']) {
    const result = selectRecentSummaries([{ date: '2026-10-08', agentId: 'partner-one', text: `研究了${topic}`, importance: 1 }], { now, currentAgentId: 'partner-one', prompt: topic });
    assert.equal(result.entries.length, 1, topic);
  }
  const result = selectRecentSummaries([{ date: '2026-10-08', agentId: 'partner-one', text: '图库已经接好，还改了推荐评分', importance: 1 }], { now, currentAgentId: 'partner-one', prompt: '图库推荐' });
  assert.equal(result.entries.length, 1);
  assert.ok(dates(pick('小满的浇水')).includes('2026-10-05'));
});

test('重要程度只给相关档案排序，不能越过准入；低分相关记录仍可命中', () => {
  assert.ok(!dates(pick('浇水')).includes('2026-10-06'));
  assert.ok(dates(pick('浇水')).includes('2026-10-05'));
  const entries = [
    { date: '2026-10-08', agentId: 'partner-one', text: '鲜花酿测卡', importance: 8 },
    { date: '2026-10-08', agentId: 'partner-two', text: '鲜花酿测卡', importance: 1 },
  ];
  const result = selectRecentSummaries(entries, { now, currentAgentId: 'partner-one', shared: true, prompt: '鲜花酿' });
  assert.equal(result.entries[0].agentId, 'partner-one');
});

test('默认日期窗口、数量与字符预算保持原值；无可靠身份不泄漏其他伙伴', () => {
  assert.equal(RECENT_BASE_DAYS, 3);
  assert.equal(RECENT_LOOKBACK_DAYS, 30);
  assert.equal(RECENT_CHAR_BUDGET, 1800);
  assert.deepEqual(selectRecentSummaries(rows, { now, prompt: '鲜花酿' }).entries, []);
  const old = { date: '2026-08-01', agentId: 'partner-one', text: '鲜花酿', importance: 10 };
  assert.ok(!selectRecentSummaries([...rows, old], { now, currentAgentId: 'partner-one', prompt: '鲜花酿' }).entries.some(row => row.date === old.date));
  assert.ok(pick('鲜花酿').entries.length <= 10);
  assert.ok(pick('鲜花酿').entries.reduce((sum, row) => sum + row.text.length, 0) <= 1800);
});

test('无查询的跨应用快照也只提供近期底座，不把高分旧档案常驻', () => {
  const result = collectSnapshotSummaries({ listSummaryEntries: () => rows }, { now });
  assert.deepEqual(result['partner-one'].map(row => row.date), ['2026-10-11', '2026-10-10', '2026-10-09']);
});
