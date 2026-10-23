import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const home = fs.mkdtempSync(path.join(os.tmpdir(), 'sgj-visitor-compat-'));
process.env.HANA_HOME = home;
process.env.APPDATA = path.join(home, 'appdata');
const summary = await import('../lib/day-summary.js');
const agents = path.join(home, 'agents');
const stateFile = path.join(process.env.APPDATA, 'hanabrew', 'state.json');
function state(value) {
  fs.mkdirSync(path.dirname(stateFile), { recursive: true });
  fs.writeFileSync(stateFile, JSON.stringify(value));
}
function agent(id, name) {
  fs.mkdirSync(path.join(agents, id), { recursive: true });
  fs.writeFileSync(path.join(agents, id, 'config.yaml'), `agent:\n  name: ${name}\n`);
}

test('无旧花酿源码也读取旧状态、合并访客；普通伙伴保持原身份', () => {
  agent('hanabrew-visitor-a', '临时访客');
  agent('partner', '正常伙伴');
  state({ visitors: [
    { agentId: 'hanabrew-visitor-a', characterName: '访客甲', status: 'active' },
    { agentId: 'partner', characterName: '错误映射', status: 'active' },
  ] });
  const before = fs.readFileSync(stateFile, 'utf8');
  assert.equal(summary.readHanabrewVisitorAliases(agents).get('hanabrew-visitor-a'), '访客甲');
  assert.equal(summary.resolveSummaryPartner(agents, 'hanabrew-visitor-a').agentId,
    'hanabrew-character-' + encodeURIComponent('访客甲'));
  assert.deepEqual(summary.resolveSummaryPartner(agents, 'partner'), {
    agentId: 'partner', agentName: '正常伙伴', sourceAgentIds: ['partner'], enhanced: false,
  });
  assert.ok(summary.listSummaryAgents(agents).some(row => row.agentName === '访客甲'));
  state({ visitors: [{ agentId: 'hanabrew-visitor-a', characterName: '访客甲', status: 'departed' }] });
  assert.equal(summary.listSummaryAgents(agents).some(row => row.agentName === '访客甲'), false);
  fs.writeFileSync(stateFile, before);
  summary.groupSummaryMessages([{ agentId: 'hanabrew-visitor-a', role: 'assistant', text: '来访记录' }], { agentsDir: agents });
  assert.equal(fs.readFileSync(stateFile, 'utf8'), before, '兼容解析不得写旧状态');
});

test('缺旧源码及状态时，保留档案内身份映射；坏状态不影响普通伙伴', () => {
  fs.rmSync(stateFile, { force: true });
  const groups = summary.groupHistoricalSummaryEntries([
    { agentId: 'hanabrew-visitor-gone', agentName: '访客乙', text: '来访聊天记录' },
    { agentId: 'partner', agentName: '正常伙伴', text: '普通伙伴记录不应被卷入' },
  ], { agentsDir: agents });
  assert.equal(groups.length, 1);
  assert.equal(groups[0].agentName, '访客乙');
  fs.writeFileSync(stateFile, 'broken json');
  assert.equal(summary.readHanabrewVisitorAliases(agents).size, 0);
  assert.equal(summary.resolveSummaryPartner(agents, 'partner').agentId, 'partner');
});

test('调用方不再以旧 manifest 阻断历史访客重整', () => {
  const source = fs.readFileSync(new URL('../routes/ui.js', import.meta.url), 'utf8');
  const fn = source.slice(source.indexOf('function hasStaleHanabrewSummary('), source.indexOf('function startSummaryTimer('));
  assert.doesNotMatch(fn, /isHanabrewInstalled/);
});

test.after(() => fs.rmSync(home, { recursive: true, force: true }));
