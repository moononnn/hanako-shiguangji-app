import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const moduleUrl = name => pathToFileURL(path.resolve(name)).href;
test('App 做册：不用旧会话文件，关面板/重启后按持久任务快照恢复且不重做已完成项', () => {
  const home = mkdtempSync(path.join(tmpdir(), 'sgj-app-summary-resume-'));
  const code = `
    import assert from 'node:assert/strict';
    import path from 'node:path';
    import { UserData } from ${JSON.stringify(moduleUrl('lib/data.js'))};
    import { setAgentCatalog } from ${JSON.stringify(moduleUrl('lib/day-summary.js'))};
    import registerRoutes from ${JSON.stringify(moduleUrl('routes/ui.js'))};
    const dataDir = path.join(process.env.HANA_HOME, 'app-data', 'shiguangji-app');
    const data = new UserData(dataDir);
    await data.updateSettings({ autoSummary: false, moodDiscoveryMode: 'off', summaryAgentIds: [] });
    await data.createSummaryJob({ id: 'resume-app', dates: ['2026-10-03','2026-10-04'],
      outcomes: [{ date: '2026-10-03', status: 'completed', ok: true }],
      status: 'running', currentDate: '2026-10-04', summaryAgentIds: ['sample-partner'] });
    setAgentCatalog([{ id: 'sample-partner', name: '测试伙伴' }]);
    const requests = [];
    let modelCalls = 0;
    const ctx = { dataDir,
      models: { async list() { return []; }, async stream() { throw new Error('不应改选模型'); },
        async utility() { modelCalls++; return { text: '记录下这一天的小事。' }; } },
      bus: { async request(verb, payload) { requests.push({verb,payload});
        if (verb === 'session:list') return { sessions: [{sessionId:'test-session', agentId:'sample-partner', modified:'2026-10-05T00:00:00+08:00'}] };
        if (verb === 'session:entries') return { entries: [
          { type:'message', timestamp:'2026-10-04T10:00:00+08:00', message:{role:'user',content:'今天喝了一杯茶。'} },
          { type:'message', timestamp:'2026-10-04T10:01:00+08:00', message:{role:'assistant',content:'茶香很轻。'} } ] };
        throw new Error('未知调用 '+verb); } },
      log: {info(){},warn(){},error(){}} };
    const routes=[];
    const app=Object.fromEntries(['get','post','put','delete'].map(method => [method,(route,handler)=>routes.push({method,route,handler})]));
    registerRoutes(app,ctx);
    // 没有创建页面实例，只等待后台任务结算；不靠固定延迟判成功。
    const read=routes.find(r=>r.method==='get'&&r.route==='/api/summaries/jobs/:id').handler;
    const request={req:{param:()=> 'resume-app'},json:v=>v};
    const deadline=Date.now()+5000;
    let result;
    do { await new Promise(resolve=>setTimeout(resolve,20)); result=await read(request); }
    while(result.job.status==='running'&&Date.now()<deadline);
    assert.equal(result.job.status,'completed',JSON.stringify(result));
    assert.ok(new UserData(dataDir).getAgentSummary('2026-10-04','sample-partner'));
    assert.equal(modelCalls,1,'不重做已完成日期，也不跑关闭的情绪链');
    assert.ok(requests.some(r=>r.verb==='session:entries'&&r.payload.scope==='all'));
    console.log('APP-RESUME-OK');
  `;
  const result = spawnSync(process.execPath, ['--input-type=module', '-e', code], {
    encoding: 'utf8', timeout: 12000,
    env: { ...process.env, HANA_HOME: path.join(home, '.hanako'), USERPROFILE: home, HOME: home },
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /APP-RESUME-OK/);
});
