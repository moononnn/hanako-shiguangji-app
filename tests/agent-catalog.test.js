// 伙伴名单不再只在装载时抓一次：宿主那边新建的伙伴，拾光记这边刷新一次就该看见。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { configureAgentCatalog, refreshAgentCatalog } from '../lib/agent-catalog.js';
import { listSummaryAgents, setAgentCatalog } from '../lib/day-summary.js';

test('伙伴名单：刷新一次就把宿主新建的伙伴带进来', async () => {
  setAgentCatalog([{ id: 'old-partner', name: '老伙伴' }]);
  const calls = [];
  configureAgentCatalog({
    bus: {
      async request(verb, payload) {
        calls.push([verb, payload]);
        return { agents: [{ id: 'old-partner', name: '老伙伴' }, { id: 'new-partner', name: '新伙伴' }] };
      },
    },
  });
  const count = await refreshAgentCatalog({ force: true });
  assert.equal(count, 2);
  assert.equal(calls[0][0], 'agent:list');
  const ids = listSummaryAgents('').map((row) => row.agentId);
  assert.ok(ids.includes('new-partner'), '新建的伙伴应该在名单里');
});

test('伙伴名单：宿主问不动时沿用旧名单，不把已有的伙伴清空', async () => {
  setAgentCatalog([{ id: 'old-partner', name: '老伙伴' }]);
  configureAgentCatalog({ bus: { async request() { throw new Error('总线不通'); } } });
  const count = await refreshAgentCatalog({ force: true });
  assert.equal(count, 0);
  assert.deepEqual(listSummaryAgents('').map((row) => row.agentId), ['old-partner']);
});

test('伙伴名单：间隔内的重复刷新不再问宿主', async () => {
  let asked = 0;
  configureAgentCatalog({
    bus: { async request() { asked += 1; return { agents: [{ id: 'old-partner', name: '老伙伴' }] }; } },
  });
  await refreshAgentCatalog({ force: true });
  await refreshAgentCatalog({ ttlMs: 60_000 });
  assert.equal(asked, 1);
});

test('设置接口：读到的是刚刷新过的名单', () => {
  const isolatedHome = fs.mkdtempSync(path.join(os.tmpdir(), 'sgj-agent-catalog-route-'));
  const routeUrl = pathToFileURL(path.resolve('routes/ui.js')).href;
  const childCode = `
    import path from 'node:path';
    import registerRoutes from ${JSON.stringify(routeUrl)};
    const routes = [];
    const app = {
      get(p, handler) { routes.push({ method: 'GET', path: p, handler }); },
      post() {}, put() {}, delete() {},
    };
    registerRoutes(app, {
      log: { info() {}, warn() {}, error() {} },
      bus: { async request(verb) {
        if (verb !== 'agent:list') throw new Error('不该问别的：' + verb);
        return { agents: [{ id: 'brand-new', name: '刚建的她' }] };
      } },
    });
    const get = routes.find((item) => item.method === 'GET' && item.path === '/api/settings');
    const read = await get.handler({ json(value) { return value; } });
    const ids = (read.settings.summaryAgents || []).map((row) => row.agentId);
    if (!ids.includes('brand-new')) throw new Error('设置接口没带上刚建的伙伴：' + JSON.stringify(ids));
    console.log(JSON.stringify({ ids }));
  `;
  const result = spawnSync(process.execPath, ['--input-type=module', '-e', childCode], {
    encoding: 'utf8',
    env: { ...process.env, USERPROFILE: isolatedHome, HOME: isolatedHome, HANA_HOME: path.join(isolatedHome, '.hanako') },
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /brand-new/);
});

test('页面产物：设置里有个手动刷名单的按钮', () => {
  const html = fs.readFileSync(path.resolve('ui/panel.html'), 'utf8');
  assert.ok(html.includes('id="refresh-agent-list-btn"'), '设置里缺手动刷名单的按钮');
  assert.match(html, /function refreshAgentLists/);
  assert.match(html, /api\('api\/settings\?refresh=agents'\)/);
});

test('设置接口：手动刷名单会强制再问一遍宿主', () => {
  const isolatedHome = fs.mkdtempSync(path.join(os.tmpdir(), 'sgj-agent-catalog-force-'));
  const routeUrl = pathToFileURL(path.resolve('routes/ui.js')).href;
  const childCode = `
    import path from 'node:path';
    import registerRoutes from ${JSON.stringify(routeUrl)};
    const routes = [];
    const app = {
      get(p, handler) { routes.push({ method: 'GET', path: p, handler }); },
      post() {}, put() {}, delete() {},
    };
    let asked = 0;
    registerRoutes(app, {
      log: { info() {}, warn() {}, error() {} },
      bus: { async request(verb) {
        if (verb !== 'agent:list') throw new Error('不该问别的：' + verb);
        asked += 1;
        return { agents: asked === 1
          ? [{ id: 'first', name: '第一位' }]
          : [{ id: 'first', name: '第一位' }, { id: 'second', name: '第二位' }] };
      } },
    });
    const get = routes.find((item) => item.method === 'GET' && item.path === '/api/settings');
    const call = async (url) => {
      const res = await get.handler({ req: { url }, json(value) { return value; } });
      return (res.settings.summaryAgents || []).map((row) => row.agentId);
    };
    const first = await call('http://localhost/api/settings');
    const forced = await call('http://localhost/api/settings?refresh=agents');
    if (first.length !== 1) throw new Error('第一次读到的名单不对：' + JSON.stringify(first));
    if (forced.length !== 2) throw new Error('手动刷新没拉到新名单：' + JSON.stringify(forced));
    console.log(JSON.stringify({ first, forced }));
  `;
  const result = spawnSync(process.execPath, ['--input-type=module', '-e', childCode], {
    encoding: 'utf8',
    env: { ...process.env, USERPROFILE: isolatedHome, HOME: isolatedHome, HANA_HOME: path.join(isolatedHome, '.hanako') },
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /"first":\["first"\]/);
  assert.match(result.stdout, /"forced":\["(first|second)","(first|second)"\]/);
});
