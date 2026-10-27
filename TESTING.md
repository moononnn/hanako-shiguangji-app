# 拾光记 App 自动测试与实机验收

当前版本以 manifest.json 为准；开发期间不修改版本号。

## 峰谷与情境解耦、Code 按伙伴覆盖（2026-10-27，本地开发）

- 保留另一窗口已有改动，以开发副本基线 `9181af7` 继续；安装前已通过正式导出保留完整目录，核对原 9 个改动、Git HEAD、本地笔记和探针均与导出包一致。
- 修复聊天情境开关切换后的峰谷重复提示、同 hash 去重时未定义变量；峰谷状态统一使用独立内存/持久化记录，旧情境字段只作兼容回退。
- 峰谷和天气提醒独立触发时只带提醒，不夹带生活情境、不推进常规刷新时间及天气软提及冷却。聊天开场/预告与补报的强弱文案一致；Code 使用技术任务优先的简短费用文案。
- Code 新增 `codeAgentSettings[agentId]` 稀疏覆盖：启用状态、注入项、方式、间隔。旧配置作为默认值，Code 总闸覆盖全部伙伴；聊天伙伴屏蔽与 Code 分离。API 支持字段级 `null` 恢复默认，界面切换伙伴保留草稿和暂不可见 ID。
- App 优先采用宿主 `session.agentId` / `agentId`，路径只作后备。分区未知时本轮跳过，且不预取快照/模型/天气；只有已确认的分区使用长缓存，只有标题或未知分区使用短负缓存并继续尝试路径。
- 主代理定向集成验证：14 个相关测试文件，**299/299 通过**，0 失败/取消/跳过（`final-related-tests.log`）。范围：Code 设置与路由、注入冲突/扩展/文案/子代理、待办提示、天气提醒、数据目录、App 入口、core、模型与分区解析。未运行全应用测试。
- `node --check` 检查 14 个变更/新增 JS 文件通过；`git diff --check` 通过；页面产物与 `renderPage('')` 完全一致，3 段内联脚本解析通过。
- 浏览器验证：通过本地静态页面与合成伙伴数据，真实 DOM 事件验证切换伙伴保留草稿、单项切回继承生成 `mode:null`。该环境未连接 App 后端，截图显示面不可用；不算宿主内实机视觉验收。
- 独立只读复核已完成；发现的契约外测试字段、继承清除协议、标题误入长缓存均已修复并纳入上述回归。
- 尚待：正式本地更新与重载后的宿主运行状态核对、真实聊天/Code 请求及设置页视觉验收。未改版本号，未 push 或发布。

## Code 页不再每轮都带时间：跟聊天窗口一样按频率注入（2026-10-27，本地开发）

- 起因：玥儿发现 Code 页每轮都被塞一条「【今日时光】2026年10月27日星期二 08:28」，助手随即在回复里强调时间（“08:28 这会儿正好”）。查 `app-data/shiguangji-app/debug.log` 确认这是拾光记 10-26 新加的 Code 页精简注入造成的，不是 Hana 系统注入；那句页脚「这一轮按需自然带一句就好」等于给了模型许可。
- 判定：Code 页以前根本不走 `shouldInject`，自己 `force: true` 每轮递时间，只靠 hash 去重挡同一分钟。这是一条与聊天窗口不同的特例，等于「给 Code 做了特殊分类」。
- 范围：`lib/code-mode.js` 加 `codeInjectMode`（适时/相伴/常在）、`codeInjectIntervalHours`（30分钟/1小时/4小时/8小时）及对应归一化；`lib/data.js` 新增两个设置项与默认值（相伴 / 4 小时）；`extensions/inject.js` 的 `decideCodeModeInjection` 改走聊天窗口同一个 `shouldInject`（各自读各自那屏的值），另加 `buildCodeContextKey` 作为 Code 那屏的设置指纹——改了 Code 的设置下一轮立刻生效，不等间隔；`lib/inject.js` 的 `buildInjectionText` 加 `includeTimeBlock` 参数（Code 页时间没勾选时整行「今日时光」都不进）；`routes/ui.js` 存取新设置项，非法方式与非法间隔拒收；设置页 Code 那屏新增「带入方式」「回来多久后更新」两个控件。
- 语义对齐：Code 页的「适时 / 相伴 / 常在」与聊天窗口完全同一套含义。峰谷关照仍是硬触发（换班窗口错过没下次），不吃频率。同一分钟同一份内容仍不重复塞。
- 定向：`node --test --test-concurrency=1 tests/code-mode.test.js` → **24/24 通过**。新增 8 条（默认相伴间隔内不注入且间隔到了才带、常在每轮带且同分钟去重、适时同一天不再带、时间没勾选时整行不进、适时档只给日期不给钟点、页脚不再请她报时间、改设置下一轮立即生效、时间块关掉时整轮不注入），改写 1 条旧用例（旧用例写死了「换一分钟就带新的时间」，那是每轮都带时代的规则）。
- 全量：`node --test --test-concurrency=1`（tests 目录 51 个文件）→ **755 条全部通过**，0 失败/取消/跳过。
- 实机（App 重载后，用真实 `app-data/shiguangji-app` 数据目录直跑扩展本体）：`mode=balanced interval=4` 下第 1 轮注入、第 2 轮不注入；`economical` 下只给日期不给钟点；取消勾选时间后整轮不注入。验证后设置已还原为 `balanced / 4 小时 / 带时间和峰谷`。
- 页面产物：`node tools/build-page.mjs` 生成 395.0 KB，旧路径与旧凭证拼接检查干净。
- 未验证：没有等到一次真实的 Code 页模型请求（重载后该窗口没再发消息），实机是直跑扩展本体 + 真实数据目录验的；设置页那两个新控件只做了产物断言，没在浏览器里点过。

## Code 页的时间并入多选清单；页脚不再请模型报时间（2026-10-27，本地开发）

- 起因：玥儿看完上一版后说「把这个时间也当做多选项放进下面就行，不用专门拎出来当做一个开关」，并问了一个组合：「如果我没勾选时间，但上面我又选了适时，会发生啥」。讨论后顺着这个问题挖出两个真问题。
- 问题一（时间不是「状态」是「读数」）：天气、待办、纪念日带一次能管半天，时间带了就会过期。若按同一套频率节流，「勾时间 + 适时」就变成只在开新窗口那天带一次钟点，之后一整天助手手里那个时刻都是过期的——它可能下午三点还在说「现在是早上八点半」。这比不带时间更糟。聊天窗口早就绕开了这个坑：它的「适时」档只带日期不带钟点（`includeTime: settings.injectMode !== "economical"`），因为它 4 小时才刷一次、钟点照样会过期。Code 页适时档注入更稀有，带钟点过期得更狠。
- 问题二（页脚是发令枪）：Code 页页脚原写「以上是此刻的时间与背景，这一轮按需自然带一句就好」——「自然带一句」等于每轮请模型报一次钟点，这正是「每轮都强调时间」的直接来源。聊天窗口的页脚是「按下方要求融入对话即可」，没有请它主动报时间。
- 改法（三处）：
  1. **时间并入多选清单**：`lib/code-mode.js` 的 `CODE_INJECTION_ITEMS` 增加 `time` 项（排在第一位），`DEFAULT_CODE_INJECTION_ITEMS` 默认 `time: true`；独立设置项 `codeInjectTime` 整个删掉（`lib/data.js`、`routes/ui.js`、`lib/page-template.js` 里的存取一并移除）。旧配置没有 `time` 键时按默认带时间算，不需要迁移。设置页那行独立的「带当前时间」开关删掉，时间变成「带哪些」清单里的一项。
  2. **适时档只给日期不给钟点**：`extensions/inject.js` 的 Code 分支按 `codeMode !== "economical"` 决定带不带钟点，与聊天窗口同一条规矩。
  3. **页脚撤掉发令枪**：`lib/inject.js` 的 Code 页页脚从「按需自然带一句就好」改成「需要时自己拿来判断就行，不必在回复里专门报时间」，并按「有钟点 / 只给日期 / 整块没时间」分三种说法，不再谎称「此刻的时间」而实际没给。
- 「没勾时间 + 适时」的实际行为：适时这个档的语义是「只在四种时刻注入一次：新会话、跨天、拾光记内容变了、你改了 Code 那屏设置」，其余时间完全静默。所以这个组合 = 那四种时刻会来一次，但那次里没有日期和时刻；若那一刻别的块也没内容（天气没勾、今天没待办、峰谷不触发），就一次都不注入——彻底哑掉。这个组合自洽，但要真「有东西」得至少再勾一项。
- 定向：`node --test --test-concurrency=1 tests/code-mode.test.js` → **24/24 通过**（较上一版 +4：清单默认带时间、时间块关掉时整轮不注入、只给日期时页脚说清是日期、页脚不再请她报时间）。
- 全量：`node --test --test-concurrency=1`（tests 目录 51 个文件）→ **755 条全部通过**，0 失败/取消/跳过。
- 实机（App 重载后，真实数据目录直跑扩展本体）：默认 `balanced` 第 1 轮注入「【今日时光】2026年10月27日星期二 09:26 / 以上是此刻的时间与背景，需要时自己拿来判断就行，不必在回复里专门报时间」，第 2 轮不注入；`economical` → 「【今日时光】2026年10月27日星期二 / 以上是今天的日期与背景…」；取消勾选时间 → 整轮不注入。验证后设置已还原。
- 语法 121 个 JS 文件 0 失败；官方 `validate-app.mjs --dir` 0 error / 1 条常规 warning；`git diff --check` 干净。
- 未验证：设置页那两个新控件与新清单项没在浏览器里点过（只做了产物断言）；没等到一次真实 Code 页模型请求。

## 子代理会话不注入、待办横幅不跟过去（2026-10-26，本地开发）

- 范围：`lib/session-kind.js` 新增 `isSubagentSessionPath`（判据只靠会话路径里的 `subagent-sessions` 段，两侧分隔符都认、大小写不敏感）；`lib/inject-app.js` 在 `agent/before-start` 入口、拿到 sessionId 之后立即判，子代理会话直接返回 undefined，不读会话快照、不预取模型、不查分区、不拉天气，Code 页那套精简注入也一并跳过；`lib/todo-banner.js` 的 `rememberActiveSession` 先认子代理路径，那边说完话不覆盖她的活跃窗口、也不凭空占位。
- 判据来源：宿主的钩子只给 `{sessionId, sessionPath}`，子代理会话 `session:get` 一律返回 `Session manifest not found`，只能看路径（`subagent-threads.json` 的 `childSessionPath` 与本机 `agents\<伙伴>\subagent-sessions\direct\` 目录两侧一致）。
- 定向：`node --test tests/inject-subagent.test.js tests/todo-banner.test.js tests/todo-reminder-app.test.js` → **35/35 通过**；其中新增 4 条（路径正负例、子代理会话一次宿主查询都不发、普通会话照常拿到今日时光、子代理不覆盖活跃会话记录）。
- 全量：`node --test`（源码根目录，含 `lib/feedback/tests/`）→ **781 条全部通过**，51 个测试文件，0 失败/取消/跳过。
- 实机：重载后派了一个真实子代理，`debug.log` 记下 `注入跳过: 子代理会话 01a176a6-…`，同一会话没有任何「注入命中」行；改动前同类会话会记 `注入命中: 301 字 | reason=new-session | 伙伴=? | 窗口=?`。
- 未验证：待办横幅那条只有单元测试覆盖，没等到一次真实的到点提醒去核对挂载位置；宿主日后若改掉子代理会话目录名，该判定会失效（失效时日志表现为子代理又出现「伙伴=? 窗口=?」）。

## Code 页单独一套注入（2026-10-26，本地开发）

- 范围：新增 `lib/code-mode.js`（项目清单与归一化）、`lib/session-kind.js`（`session:get` 的 `namespace` 判断，30 分钟正缓存 / 1 分钟负缓存）、`tests/code-mode.test.js`；`lib/inject.js` 给 `buildInjectionText` 加 `codeMode` 页脚（普通路径不变）；`extensions/inject.js` 增加 Code 页分支（每轮带时间，内容只取勾选项，同一分钟同内容不重发，换班预告不被去重吃掉）；`lib/inject-app.js` 预取分区并递进扩展，Code 页没选天气就跳过天气预取；`lib/data.js` 新增 `codeInjectionEnabled` / `codeInjectionItems`。
- 设置面：聊天窗口与 Code 页共用一组，顶部一个「聊天窗口 / Code 页」切换键（薄荷绿 / 雾蓝双底色，提示条、面板底色、按钮填充一起变），不挂多余标签。Code 那屏只有总闸和六个勾选项，不再摆快捷预设；峰谷从共用行改成聊天那屏的开关，Code 页只看勾选，两屏各管各的。原来独立的「伙伴收到的今日情境」分组收进聊天那屏，再少一个分组。
- 总管关系：拆成两个互不影响的开关，主页头部并排两个胶囊按钮（薄荷绿「聊天情境」、雾蓝「Code 情境」），各自 POST `injectionEnabled` / `codeInjectionEnabled`，与设置里两屏的那两个开关同源。峰谷仍不算情境，两屏各看自己的开关/勾选。
- 默认值：总闸开、清单只留峰谷关照，其余项默认关；Code 页没有「退回普通窗口」那一档了，想全带就逐项勾上。
- 定向：`node --test --test-concurrency=1 --test-reporter=tap tests/code-mode.test.js` → **16/16 通过**（含适配层分区递送、路由存取、页面产物两屏结构、峰谷分屏不牵连、两开关互不影响）。
- 相邻回归：`tests/inject-extension.test.js tests/injection-guidance.test.js tests/data-context.test.js` → **28/28**；`tests/routes.test.js` → **49/49**；`tests/app-entry.test.js tests/core.test.js` → **118/118**。
- 全量：`node --test --test-concurrency=1 "tests/*.test.js"` → **743 条全部通过**，0 失败/取消/跳过。
- 实机：第一版重载后，下一轮 Code 会话的注入已按新路子到达（只有【今日时光】09:45 加一句页脚，没有历史档案，也没有天气/待办）；改完界面后再次重载并校对设置页两屏与配色。

## 对外契约 alerts（2026-10-24，本地开发）

- 范围：新增 `lib/public-alerts.js`（把 `collectWeatherEvents` 的结果摊平）、`PUBLIC-ALERTS.md`、`tests/public-alerts.test.js`；`index.js` 绑定发布通道并挂进三条发布时机（装载首轮、数据变更、每分钟刷新）；`weather-alert.js` 导出 `KIND_LABELS` 供两边共用。
- 顺带修的真 bug：`collectWeatherEvents` 用 `num(currentTemp) ?? num(temps[0])` 取基准温度，而 `Number(null) === 0`，当前天气取不到时基准被当成 0°C，任何 8°C 以上温度都会误报“比现在高 8 度”。现在 null/空串一律回退到预报首个小时。
- 定向：`node --test --test-concurrency=1 tests/public-alerts.test.js tests/weather-alert.test.js` → **27/27 通过**。
- 全量：`node --test --test-concurrency=1 "tests/*.test.js"` → **727 条全部通过**，0 失败/取消/跳过。
- 未做：未重载，未实机看共享快照；`alerts` 是否真被茶话会读到，需要两边都重载后验。

## 天气提醒（2026-10-22，本地开发）

- 改动：新增 `lib/weather-alert.js`（事件判定 + 去重状态）；`lib/weather.js` 增加小时/日预报查询（`forecast_days=2`，含 `precipitation_probability`、`wind_gusts_10m`）与独立预报缓存（默认 1 小时 TTL，与当前天气缓存分开）；`lib/data.js` 新增 `weatherAlertEnabled`、`weatherForecastIntervalHours` 设置项与 `weather-forecast-cache.dat` / `weather-alert.dat` 两个加密存储；`extensions/inject.js` 新增独立一路注入（命中时强制触发行程，段落附在情境之后，自带「这段比情境材料更新」的来源说明），确认逻辑与节日问候共用同一条 `message_end` 钩子（不新增第二个钩子，避免覆盖）；`lib/inject.js` 新增 `buildWeatherAlertContext`；`routes/ui.js` 与设置页新增「天气提醒」开关（天气本身关闭时一并停用）。
- 判定门槛：温差 ≥ 8°C、降水概率 ≥ 60% 且有降水、阵风 ≥ 50 km/h、恶劣天气码取中雨以上/雪/雷暴/冰雹/冻雨/雾（小雨与普通阵雨不算恶劣）。事件指纹带目标日期，同一件事只提一次；伙伴接住即记为已提，一直不接住最多补报一次后放弃。
- 定向命令：`node --test --test-reporter=tap tests/weather-alert.test.js` → **17/17 通过**。相邻回归 `tests/inject-extension.test.js tests/weather-clock.test.js tests/injection-guidance.test.js tests/public-today.test.js tests/public-today-app.test.js tests/data-context.test.js tests/inject-due-nudge.test.js` → **77/77 通过**；`tests/core.test.js tests/routes.test.js` → **164/164 通过**；合并跑 `tests/weather-alert.test.js tests/inject-extension.test.js tests/app-entry.test.js` → **40/40 通过**。
- 真实接口核对（成都武侯区坐标，Open-Meteo 实拉）：`hourly.time/temperature_2m/weather_code/precipitation_probability/wind_gusts_10m` 与 `daily.precipitation_probability_max/wind_gusts_10m_max` 字段都正常返回，时区字符串与本地时间一致，事件判定符合预期。
- 真实数据带出一个排序问题并已修：初版按「严重程度」排，结果「明天凌晨中雨」压过了「今天下午降水概率 75%」，与「先说马上要来的」相反。改为先按时间锚点排（小时级用当小时，全天用当天中午），同一时刻才看严重程度；补了一条回归用例锁住这个顺序。
- 过程中修掉一处真实回归：最初把天气提醒注册成第二个 `message_end` 钩子，而测试侧的假 `pi` 只保留单个 handler，导致节日问候的完成确认被覆盖（`扩展：节日问候保持待完成直到助手可见回复提到节日` 失败）。改为与节日共用一条钩子、各自记账后复验通过。
- 语法：`node --check` 通过 lib/weather-alert.js、lib/weather.js、lib/data.js、lib/inject.js、lib/inject-app.js、extensions/inject.js、routes/ui.js、lib/page-template.js。`node tools/build-page.mjs` 生成 383.7 KB 的 `ui/panel.html`，旧路径/凭证拼接检查干净、App 凭证头存在。宿主静态校验 `validate-app.mjs --dir <App 源码目录> --json` → `ok: true`，0 errors、1 个常规动态依赖警告。
- 未验证：真实宿主里的注入效果（伙伴到底会不会自然带这一句、语气对不对）需要实机跑一轮；未跑全量回归；未改 manifest.version、README、description，未提交、push 或发布。

## 对外契约 greetings（节日问候完成台账，2026-10-21，本地开发）

- 改动：`lib/data.js` 新增加密台账 `festival-greetings.dat`（`EncryptedStore`，与 injection state 同级）+ `FESTIVAL_GREETING_RETENTION_DAYS` / `festivalGreetingWindowStart` / `listFestivalGreetings` / `recordFestivalGreeting`，按伙伴/日期/节日去重、写入时就把 7 天窗口外的旧记录清掉、上限 200 条、判不出 agentId 不入账；新建 `lib/public-greetings.js` 组契约、算 7 天窗口、去抖发布；`lib/public-today.js` 只新增 `enqueuePublicPublish`（与 today 共用同一条 publishQueue，today 那条代码未动）；`extensions/inject.js` 在 `observeFestivalGreeting` 确认完成那一段补记台账并排去抖发布，身份沿用现成 `resolveAgentId`；`index.js` 绑定通道并在启动、保存后、每分钟定时各发一次。契约文档 `PUBLIC-GREETINGS.md`。未改 manifest.version / README / today 契约实现。
- 测试：`tests/public-greetings.test.js` 新增 14 条（完成入账与 agentId、未提及不算完成（含只写在 `<mood>` 里）、toolUse 中断不算、判不出身份跳过、跨天与 7 天窗口、去抖只发一次、撤权后补发、发布失败只记一条警告且不动本地、无通道静默返回、台账读坏发空表）。定向 `node --test --test-reporter=tap tests/public-greetings.test.js` → **14/14 通过**。
- 相邻回归：`tests/app-entry.test.js tests/public-today-app.test.js tests/public-today.test.js tests/app-save-publication.test.js tests/inject-extension.test.js tests/injection-guidance.test.js tests/festival-hints.test.js tests/data-context.test.js`（含新文件）→ **96/96 通过**。全量 `node --test --test-concurrency=1 --test-reporter=tap tests/*.test.js` → **700/700 通过**，0 失败/取消/跳过。
- 现有测试的两处口径调整：`tests/app-entry.test.js`（启动现在发 today + greetings 两个 key）与 `tests/app-save-publication.test.js`（两个 key 同通道，不再按发布顺序取最后一条，改为按 key 取 today）。两处都只是因为多了一个 key，业务断言未改。
- 未验证：真实宿主里 `ctx.publicData.list` 的返回形状按现有 today 那条的用法照搬（`{entries:[{key}]}`），没在实机上核对过；跨午夜的边角（23:59 提示、00:01 才说出口）记的是提示那天的 date；扩展侧没有 publicData 通道，完成确认后的那次发布实际要等 App 侧定时刷新才送出去（内容指纹去抖，不丢）。未改版本号、未提交、push 或发布。

## 拾性与性格设定做对照（2026-10-19，本地开发）

- 改动：`lib/xingji.js` 新增 `XINGJI_RELATIONS` / `normalizeRelation` / `dominantRelation`；日采提示词把 `identityText` 从「这些已经写过的不算新发现，请不要复述」的排除清单，改成对照物，要求模型给每条观察标 `relation: described|unwritten`，并写死「只问写过没有，不问符不符合」；`parseObservationOutput` 只收这两个值，其余（包括「违背」这类写法）一律留空；`pushEvidence` 与 `applyRollup` 把 `relation` 跟着证据一起存，老证据不添字段；`dominantRelation` 按证据多少算条目归属，一条带 relation 的都没有就返回空串。`routes/ui.js` 的 `decorateXingjiEntry` 透出 `relation`。页面标签（`lib/page-template.js` → `ui/panel.html`）：“设定里写着 / 设定里没写”，老档案不贴；拾性页标题和设置说明同步改口径。不注入、不改存储结构、不改版本号。
- 定向命令：`node --test --test-reporter=tap tests/xingji.test.js tests/xingji-data.test.js` → **47/47 通过**（新增 4 条：relation 只认两个值、证据带标存盘、老数据不添字段、按多数证据算归属）；相邻回归 `tests/routes.test.js tests/core.test.js tests/inject-extension.test.js tests/injection-guidance.test.js` → **191/191 通过**。`node --check` 通过 lib/xingji.js、routes/ui.js、lib/page-template.js。`node tools/build-page.mjs` 生成 382.9 KB 的 `ui/panel.html`，旧路径/凭证拼接干净、App 凭证头存在。
- 实际提示词回显已核：设定段现在是「只用来对照……两边不一样很正常」，输出 schema 带 `relation`，规则里有「不问符不符合」。
- 未验证：真实模型对新提示词的产出质量（会不会把「写着温柔但直接指错」稳定标成 unwritten），需要下次日采或补档实跑；页面标签只做了构建与源码核对，没开真实页面截图复验。

## 拾性分两档 + 做法接回对话（2026-10-19，本地开发）

- 改动：`lib/xingji.js` 删掉 `XINGJI_MIN_SPAN_DAYS` / `XINGJI_LIKELY_SPAN_DAYS`，改成 `XINGJI_MIN_DISTINCT_DAYS=2`、`XINGJI_LIKELY_DISTINCT_DAYS=5`，并新增偏离档 `XINGJI_DEVIATION_*`（2/2 起，4/4 到 likely）；条目与观察新增 `kind`（pattern/deviation），`normalizeEntryKind` 把旧数据归为 pattern；`applyRollup` 拒绝把两种 kind 合进同一条目；新增 `pickInjectableEntries`（只接 pattern、只取等级最高 3 条）与 `buildXingjiInjectionText`（ta 第一人称口吻，不写「请注意/禁止/必须」）。`extensions/inject.js` 在 `xingjiInjectionEnabled` 打开且情境注入总开关与按伙伴屏蔽都放行时才取条目，并加进注入上下文指纹，改开关能立即刷新。删除从未有界面入口的 `xingjiInjectionDisabledAgentIds`，按伙伴屏蔽统一复用 `injectionDisabledAgentIds`。
- 定向命令：`node --test --test-reporter=tap tests/xingji.test.js tests/xingji-data.test.js`，**43/43 通过**（新增 8 条：跨度不再卡门槛、两天成条、偏离档更松、kind 归一化、日采认 kind 且一天只留一条偏离、注入只接做法、条数封顶、注入口吻）。相邻回归 `tests/inject-extension.test.js tests/injection-guidance.test.js tests/routes.test.js tests/core.test.js tests/moodline-legend.test.js`，**200/200 通过**；`tests/data-context.test.js tests/app-save-publication.test.js tests/app-entry.test.js tests/public-today.test.js`，**29/29 通过**。
- 语法：`node --check` 通过 lib/xingji.js、lib/data.js、lib/inject.js、extensions/inject.js、routes/ui.js、lib/page-template.js。构建 `node tools/build-page.mjs` 生成 382.2 KB 的 `ui/panel.html`，旧路径/凭证拼接干净；产物 3 段内联脚本语法检查 0 失败。
- 真实档案回算（只读解密 `xingji.dat`，未改数据）：106 条条目在新门槛下可见 **45 条**，旧门槛下 25 条；`likely` 16 条。逐位可见数（此处按伙伴出现顺序编号，不写真名）：10/14、14/19、5/18、6/20、5/11、5/15；另有两位 0/6、0/3（这两人的条目数本身就只有 6 条和 3 条，多为 1~2 条证据，达不到任何门槛）。开启注入后每位够门槛的伙伴各选出 3 条做法条目，措辞已逐条核对。
- 未验证：真实对话中的注入效果（模型是否会照这几句调整说法）需要开了开关实跑才能确认；偏离条目的抽取质量要看接下来几天的日采产出，本轮没有真实偏离样本可测。

## 拾性页重做、归档全量补档与归纳截断修复（2026-10-18，本地开发）

- 覆盖：拾性页从产物补回 `lib/page-template.js` 源；页面改为统计 + 候选条目 + 三条门槛进度（证据/不同日子/跨度）+ 按伙伴手动整理 + 带范围与费用说明的补记弹窗 + 扫描/逐天/整理三阶段进度 + 中断/失败恢复；归纳输出预算从 900 提到 1800，解析容忍 O1/字符串/observations 别名与尾逗号；补档任务在 App 重载后标记 interrupted，可接着补。
- 归档扫描：宿主 `session:list` 在请求上下文里用 `scope:all + lifecycle:all` 可列出 2122 个会话（1834 个 archived），但 `session:entries` 拒绝 archived 路径；App 沙箱的 fs 也碰不到 Hana 家目录。本次用本机脚本直接枚举 `agents/<id>/sessions` 及 `archived` 子目录（按同一套 `findCharacterEvents` 预筛、每伙伴每天最多 8 张事件卡），把 7140 个候选瞬间写成预扫结果；App 补档在 `listAllSessionFiles` 为空时优先沿用已有预扫结果，不覆盖全量桶。
- 定向命令：`node --test --test-reporter=tap tests/xingji.test.js tests/xingji-data.test.js tests/routes.test.js tests/core.test.js`，**200/200 通过**，0 失败/取消/跳过。`node --check` 通过 routes/ui.js、lib/xingji.js、lib/data.js、lib/day-summary.js、lib/page-template.js；`git diff --check` 通过。
- 构建：`node tools/build-page.mjs` 生成 379.5 KB 的 `ui/panel.html`，旧路径/凭证拼接检查干净、App 凭证头存在；产物 3 段内联脚本用 `vm.Script` 语法检查，0 失败。
- 实机全量补档：`POST /api/xingji/backfill {from:"2026-05-31",to:"2026-10-17",skipScan:true}` 在后台跑完，**140 天、0 天失败**；`GET /api/xingji` 首轮返回 8 位伙伴、totals `8/507/16/35`（8 位在看、507 段待归类、16 条长成、35 条还在长）。2026-10-19 追加一轮归纳后 totals 为 `8/312/30/81`；再把其中一位伙伴的四组近义切面合并去重后为 `8/312/25/81`（逐位同序为 6/8/259、11/8/47、5/6/2、1/19/3、1/14/1、1/17/0、0/6/0、0/3/0）。
- 数据覆盖：2122 个会话文件、1834 个归档会话；138 个有料日子，最早 2026-06-01、最晚 2026-10-18；7136~7140 张事件卡（扫描时新会话使数字略有增长）。此前 170 天只是补记日期范围，本次才是把归档文件真正扫了一遍。
- 页面布局：Edge headless 经本机代理加载真实页面，核对桌面 1400px 与 500px 布局；390px 用 CDP `Emulation.setDeviceMetricsOverride` 实测 `innerWidth=390`、`document.documentElement.scrollWidth=390`、`body.scrollWidth=390`，无横向溢出。
- 未跑全量回归；全量补档按用户明确要求在后台执行，真实模型调用已发生（140 天逐日观察 + 8 位伙伴归纳）；未改 manifest.version/README/description，未提交、push 或发布。

## 提个醒专注通知联动（2026-10-14，本地开发）

- 覆盖专注开始/结束走提个醒服务、陪读身份透传、明确缺服务时原生回退、静默 `suppressed` 终态、超时/未分类服务错误与原生异常落 `unknown` 不补发、重复回调与落盘状态，以及原生通知不双弹。
- 定向命令：`node --test --test-reporter=tap tests/focus-reminder.test.js tests/focus-routes.test.js`，**21/21 通过**。`lib/data.js`、`lib/focus-reminder-scheduler.js`、两个相关测试文件共 4 个文件的 `node --check` 通过。
- 仅定向测试，未跑全量。拾光记与提个醒均已通过正式入口 reload，inspect 均为 `host=on / agent=on`；提个醒新增 `app/services.provide` 已通过权限审核。**2026-10-14 作者实测：提个醒可正常联动专注提醒；且在一段 15 分钟专注结束时不打开拾光记页面，提个醒仍正常弹出，跨应用投递与页面关闭时的后台唤醒链路均已走通。**未改版本号、未提交、push 或发布。

## 左侧门厅快捷专注（2026-10-14，本地开发）

- 覆盖常用目标加载、恢复并在开始前重读目标专属设置、全栏字号层级与计划摘要字号/换行、选择伙伴/自己专注后仅选中且须点确认才开始、进行态目标/阶段/轮次/倒计时、到点推进，以及状态牌向主页发送 `focus` 并打开专注页；同时检查旧快照不覆盖新状态、开始 warning 绑定当前专注组、同步失败标记、详细设置入口和连续 FP 信号顺序派发；`看这天`、`记心情` 原入口保留。
- 定向命令：`node --test --test-reporter=tap tests/fp-hall.test.js tests/focus-routes.test.js tests/focus-ui.test.js tests/focus.test.js tests/focus-companion.test.js`，**65/65 通过**。测试发现并修复主页 FP 日历动作分支缺少 `}` 的内联脚本解析错误；快捷专注回归锁验证选择只选中、确认才开始，并核对短休/长休摘要及本组不会触发的边界提示。
- `node tools/build-page.mjs` 生成 338.4 KB 的 `ui/panel.html`；旧路径与凭证拼接检查干净，App 凭证头存在；`git diff --check` 通过。未跑全量回归；用户已查看并接受左侧栏字号/观感，另确认实测快捷启动确认流程、状态牌跳转通过。
- 正式入口已从当前磁盘代码 reload，inspect 为 `host=on / agent=on`。只读交叉复核确认此前的响应覆盖、警告串组、配置过期、信号覆盖与旧快照提示问题均已处理；未改 `manifest.version`，未提交、push 或发布。

## 专注配置记忆与每轮开始提醒（2026-10-14，本地开发）

- `favoriteGoals` 继续保持字符串数组；`lastFocusConfig` 与 `favoriteGoalConfigs` 写入同一加密专注数据。首次选择没有专属配置的旧标签时，沿用上次配置并建立专属绑定；设置变动自动保存，选择常用目标恢复自己的时长、轮数、短休及长休参数。
- 第一轮开始由开始路由发送系统通知；休息阶段推进到下一轮时，由调度器发送。开始通知按每轮独立 ID 加密认领，页面与后台并发只发送一次；暂停继续不重复，重载中断记为 unknown 不盲目补发。日历读取与开始新一组前触发的阶段推进也走同一通知协调流程，避免顺手结算上一段时漏掉结束提醒。
- 定向命令：`node --test --test-reporter=tap tests/focus.test.js tests/focus-reminder.test.js tests/focus-routes.test.js tests/focus-ui.test.js`，**61/61 通过**，0失败/取消/跳过。8个修改JS与测试文件 `node --check` 通过；`node tools/build-page.mjs` 生成 338.1 KB 页面，旧路径/凭证拼接检查干净、App凭证头存在；`git diff --check` 通过。
- 正式入口已从当前磁盘代码 reload；inspect 回报 `host=on / agent=on`。自动验证曾只用模拟宿主，但作者随后于 2026-10-14 实测系统通知弹出及拾光记页面关闭时的后台提醒通过。未跑全量回归；本轮未触碰 `manifest.version`（工作区原值 0.0.64），未提交、push 或发布。

## `focus/state` 多轮投影（2026-10-14，本地开发）

- 覆盖：`ACTIVE_FIELDS` 放行 `setId/roundIndex/totalRounds/breakKind/breakMinutes`，`RECORD_FIELDS` 放行 `roundIndex/totalRounds/planStatus/breakKindAfter/shortBreakMinutes/longBreakMinutes`；断言过界进休息时轮次不变且休息种类算得出、收尾记录带轮次且 `planStatus=active`（还有下一轮）、休息结束自动开下一轮时编号换新轮次加一、`longBreakEvery` 刻意不投影。调用方白名单（只向茶话会）、`sessionId` 契约、专注数据加密落盘范围均未改。
- 语法：`node --check` 通过 lib/focus-companion.js 与 tests/focus-companion.test.js。
- `node --test --test-concurrency=1 --test-reporter=tap tests/focus-companion.test.js tests/focus-routes.test.js tests/focus-reminder.test.js` → **18/20 通过，2 失败**。两处失败与本次改动无关，回退本次改动后同样失败，已复现对照：① `tests/focus-routes.test.js` 用 `spawnSync(node, ['--input-type=module','-e', childCode])` 跑内联代码，代码里 `/第 1\/1 轮开始/` 的转义在模板字符串里被吃掉，eval 时抛 `SyntaxError: Invalid regular expression flags`；② `tests/focus-reminder.test.js` 断言写死 `/第 1\/4 轮开始/`，当前通知文案是「第 1/1 轮开始」。两处属各自测试的转义与断言口径，不在本改动范围，未擅自改。未跑全量。
- 2026-10-14 发布前复验：上述两处失败已不复现，代码侧均已改好（`tests/focus-routes.test.js` 改用 `includes('第 1/1 轮开始')` 字符串断言，不再走正则转义；`tests/focus-reminder.test.js` 的 `/第 1\/4 轮开始/` 与当前夹具的 4 轮计划一致）。按原命令 `node --test --test-concurrency=1 --test-reporter=tap tests/focus-companion.test.js tests/focus-routes.test.js tests/focus-reminder.test.js` → **28/28 通过**；扩到专注相关全部 6 个文件（focus/focus-companion/focus-reminder/focus-routes/focus-ui/fp-hall）→ **84/84 通过**，0 失败/跳过。全量回归仍未跑。

## 多轮专注与常用目标（2026-10-13，本地开发）

- 2026-10-14 视觉微调：常用目标标签从胶囊圆角收敛到 8px；`tests/focus-ui.test.js` **32/32 通过**，模板与测试语法检查通过，页面构建 332.0 KB，旧路径/凭证拼接检查干净，App 凭证头存在，`git diff --check` 通过。正式入口 reload 后 inspect 为 host=on/agent=on；未做嵌入页截图复验。
- 覆盖：多轮组 ID 与每轮独立 ID、整组统计、短休/按间隔长休、末轮无休、休息结束自动开下一轮、后台轮转、常用目标加密保存与去重/移除、提前结束保留完成轮次与当前真实时长；覆盖专注/休息双阶段过界、并发推进时完成通知仍可认领。茶话会服务白名单与 `sessionId` 契约未改。
- 定向命令：`node --test --test-reporter=tap tests/focus.test.js tests/focus-routes.test.js tests/focus-ui.test.js tests/focus-reminder.test.js`，**55/55 通过**，0失败/取消/跳过。
- 只读交互复核发现中间窄屏设置可能溢出；用容器宽度断点改为单列，并把长休频率明确显示为“每隔 N 轮”、隐私标题改为披露跨应用同步字段。8个改动 JS 文件 `node --check` 通过；页面构建 332.1 KB，旧路径/凭证拼接检查干净，App 凭证头存在；`git diff --check` 通过。
- 未跑全量回归、无真实模型/API调用。已通过正式入口从当前磁盘代码 reload；`inspect` 回报 host=on、agent=on。尚未在嵌入页实机检查窄屏布局与实际提醒效果。版本保持 0.0.64，未提交、push 或发布。

## 专注进行态：陪读联动状态与视觉层级（2026-10-13，本地开发）

- 进行态补“还剩”标识、明确的阶段标签和轻量状态便笺；开始提醒只在 `sent` 时写“已把这次专注安排告诉伙伴”；waiting/pending 仅说明送达茶话会的状态尚未确认，不推断已经交接，也不暗示伙伴会回复。stale/failed 明确标为无法确认或未送达。隐私说明补充：茶话会对话不会回显在拾光记。
- 操作行把“暂停”和“结束并记录”收成一组，取消保留“不留记录”字样但改为分隔的轻量文字操作；380px 以下改为两个主操作并排、取消另起左对齐一行。
- `node --test --test-reporter=tap tests/focus-ui.test.js`：**30/30 通过**；`lib/page-template.js`、`tests/focus-ui.test.js` 语法检查通过；页面构建成功（320.3 KB），旧路径与旧凭证拼接检查干净，`git diff --check` 通过。
- 状态映射与 DOM 稳定性由测试覆盖；未做真实宿主截图/窄屏实机验收，需用户查看重载后的实际页面。

## 专注结束后台提醒（2026-10-13，本地开发）

- 开始仍沿用页面内「开始专注啦」轻提示；结束改由 `ctx.tasks` 的一次性 `runAt` 计划触发系统通知，不依赖拾光记页面常开。暂停撤销计划、继续按新目标重排；提前结束/取消清计划。页面结算和后台回调共用加密专注记录的通知认领状态，重载恢复会对账任务并补结算过期专注。
- 定向命令：`node --test --test-reporter=tap tests/focus-reminder.test.js tests/focus-routes.test.js tests/focus-ui.test.js tests/focus.test.js`。
- 自动测试 **46/46 通过**（0失败/取消/跳过），覆盖任务登记与排程、路由开始/暂停/继续/取消、禁用旧计划清理、后台到点结算通知、页面与后台通知幂等、挂起超时、重载恢复（含任务处理器登记失败）。修改的 JS 文件语法检查通过，`node tools/build-page.mjs` 构建成功（316.0 KB），`git diff --check` 通过。
- 未跑全量回归，未做宿主实机通知验收；`listSchedules` 实机回包形状、一次性计划消费后的状态、以及 Hana 是否在拾光记页面关闭时唤醒此 App handler，仍需实机确认。

## 撤搜索·折叠改10·头像尺寸闸（2026-10-13，本地开发）

- 撤掉伙伴搜索输入框、`searchFocusCompanions`、`focusCompanionQuery` 及相关 CSS；折叠阈值 6→10（预览、查看全部、内部滚动同步）。头像侧：茶话会与拾光记两道 `MAX_AVATAR_BYTES` 512KB→6MB。
- 根因：宿主伙伴头像实为 1~2MB，512KB 闸把真图全挡掉、只剩首字；茶话会页面自己那条路由无此闸所以正常。
- 命令：`node --test --test-reporter=tap tests/focus-ui.test.js tests/focus.test.js tests/focus-routes.test.js tests/focus-companion.test.js`，**44/44 通过**，零失败/取消/跳过；4个修改JS语法通过；`node tools/build-page.mjs` 重建 315.9KB 产物，搜索残留清零、阈值 10 已在产物。
- 新增/调整断言：`focus-ui` 人数用例改为 0/1/5/10/11/31（超过10才展开），30人用例去掉搜索步骤；`focus-companion` 尺寸用例改为 1~2MB 正例 + 7MB 超限负例。
- **实机验收（2026-10-13）**：重载后专注页伙伴头像正常显示；本 App 诊断日志印证八位伙伴头像均读到（真图 + 默认脸）。bus 承载 ~3MB base64 载荷已实机确认。无全量、真实模型/API。

## 通用头像选人与独立专注（2026-10-13，本地开发）

- 少人全显；超过6人预览、明确查看全部，完整名单内部滚动并出现搜索。选择收为同桌名片，更换多人名单全部展开并保留勾选。目标/搜索节点与光标不因轮询重建；头像走带App页面凭据的同源fetch/blob，缺图回退首字。
- `companionId`为空独立计时，无需茶话会，不触发陪读sync或显示旧陪读状态；非空选中失效必须明确失败。结束/取消读取不会自动结算的raw active，覆盖陪伴/独立休息结束、恰到点end返回真实completed记录、恰到点cancel保留completed语义。已无active的旧结束不扫描历史误发sync。
- 主会话命令：`node --test --test-reporter=tap tests/focus-ui.test.js tests/focus.test.js tests/focus-routes.test.js tests/focus-companion.test.js tests/public-today.test.js tests/public-today-app.test.js`。最终 **76/76通过**，0失败/取消/跳过；6个修改JS语法通过，生成页3段内联JS可解析，317.0KB产物与模板逐字一致。茶话会头像必要接线相关30/30、3个JS语法通过。
- 头像服务仅给获准调用方和已配置陪读名单；合法id、512KB上限、图类型与魔数一致，不透传异常路径，响应no-store。目录四态available/empty/absent/unavailable，未知错误不伪装成未安装；诊断只记安全code与归类。absent候选错误码未取得宿主实证，无法分辨缺装/停用时仍显示暂不可用并允许独立计时。
- 主会话隔离生成页浏览器实测3/5/30人、420px两列/360px一列、目标节点/焦点/光标、搜索末位/更换勾选、已选后缺装显式改独立、未选服务不可用可提交独立、已选失效不提交。30人展开高度280px内部滚动，无横向溢出，console为空。模拟中发现并修复更换隐藏末位、缺装失效选择缺独立出口、mood-grid覆盖display:grid三项。记录在工作台 `_tmp_拾光记通用选人验收/浏览器验收.md`。
- 中间失败保留：旧路由断言仍要求空伙伴拒绝，与获批独立计时契约冲突，更新为验证独立允许/非空失败；后端补丁曾有重复变量及过短PNG夹具，已更换真实1×1PNG并复验。只读审查发现自动结算快照吞结束记录、MIME与魔数不一致，已补行为回归。
- 本轮无全量回归、真实计时写入、付费模型/API或真实跨App头像验收。模拟通过不代表宿主中文输入法、缺装分类和最终审美认可；重新加载结果另见PROJECT_LOG。

## 专注整体视觉对齐（2026-10-13，本地开发）

- 原页面完整CSS及日历、今日概览、时光册、心情线、设置结构先只读审计，具体视觉契约见PROJECT_LOG。专注只改展示及相关测试：980px上限纸卡/页头、记一笔输入与动作、心情选择伙伴、今日数字/正文组合、时光册结算结构；未改公共字体、全局样式或后端。
- 同下方六文件定向命令，最新66/66通过，零失败/取消/跳过；两文件语法、三段内联JS解析通过，构建产物与模板一致。新增6项覆盖新结构/窄屏顺序、非sticky动作、暂停/等待节点稳定、真实同id结算及缺记录不猜时长。
- 主会话浏览器将当前生成页的心情线/时光册与专注放入相同980px真实iframe，并排截屏对照准备/暂停/休息。全部使用内存fetch桩和明确模拟记录，不访问宿主真实数据或付费模型。目标刷新后节点/焦点/光标保留；暂停不重建计时和按钮，resume/pause点击处理器正确；同id mock实记时长25分钟可呈现，缺记录不推算。420px视口，长伙伴名/长错误无横向溢出，窄屏目标→伙伴→时长顺序及操作不被长错误挤走；console为空。
- 并排截图及检查是源码生成页面的模拟浏览器证据，不能外推成宿主中文输入法、实际模型或最终审美认可。当前宿主卡本轮未响应UI检查，不宣称宿主实屏已验收。字体名只声明在CSS，没有装载证据，未偷偷只改专注字体。

## 专注交互纠偏（2026-10-13，本地开发）

- 撤目标模式切换、伙伴搜索/折叠/常驻刷新与独立深色/编号步骤；保留日历待办入口预填，手改目标解除taskId，跨日期关联不再被当天候选目录清空。没有后端或权限改动。
- 同下方六文件定向命令，最新60/60通过、零失败/取消/跳过；新增UI4条，语法2文件通过，三段生成内联JS解析通过；构建305.8KB。此前24项为focus-ui17+focus7，不能与六文件60项混称。
- 本次生成页面在模拟浏览器实测：8伙伴一开始全显，选择后仍全显；没有搜索框，正常时重试隐藏，连接失败时重试出现。跨日期todo预填“读一本书”并保留id；轮询后输入节点/焦点/光标不变，手改解除关联。420px iframe含长伙伴名无横向溢出。均使用内存fetch桩，没有调用正式计时路由或模型；真实宿主视觉认可及陪读语气仍需使用时验收。

## 专注页交互重做（2026-10-13验收，本地开发）

- 范围仅page-template的专注CSS/HTML/JS、新focus-ui.test.js与重建panel.html；后端、提醒逻辑、权限和版本未改。原专注相关范围43通过；新增13项UI回归。
- 命令：`node --test --test-reporter=tap tests/focus-ui.test.js tests/focus.test.js tests/focus-routes.test.js tests/focus-companion.test.js tests/public-today.test.js tests/public-today-app.test.js`，有效输出56/56通过、零失败/取消/跳过。两个修改JS语法通过，三段生成内联脚本解析通过，最终构建310.1KB，旧路径/旧凭证拼接检查干净。
- 实际浏览器加载本次生成页面，以内存fetch桩提供12位虚构伙伴、长名称及待办，不触碰正式数据或模型：点击专注、输入目标、刷新后节点/焦点/光标保留；选中伙伴后折叠且有准备就绪提示。420px真实iframe视口documentWidth=420、focusWidth=376，无横向溢出；开始按钮宽346px。进行/暂停/休息状态及长错误检查：操作位置不随错误移动，继续按钮文案正确，收尾pending/失败可见；浏览器console日志为空。
- 浏览器小窗口结果是生成页面+模拟数据的布局与交互证据，不是宿主嵌入实机、中文输入法组合事件或真实跨App提醒验收。file协议尝试没有装载脚本，改用仅127.0.0.1的单页内存服务器才取得上述证据。未跑全量、真实模型/API，未调用正式开始/取消/结束路由。

## 本轮：茶话会专注陪伴（2026-10-12，本地开发）

- 范围：已配置陪读伙伴选择、自由目标、30分钟预设、强制茶话会依赖；限定调用方的 focus/state 服务，暂停/继续/结束同步，目录/权限失败明确提示，记录不进入通用公开快照。旧无陪读字段的进行中计时仍可结束，不擅改旧记录。
- 定向命令：`node --test --test-reporter=tap tests/focus.test.js tests/focus-routes.test.js tests/focus-companion.test.js tests/public-today.test.js tests/public-today-app.test.js`。
- 最新相关测试 **43/43通过**；本轮8个JS语法检查通过；最终页面构建298.5KB，三段内联脚本可解析，旧路径与凭证残留检查干净。第一次11项测试10通过/1失败，为新增30分钟后旧测试仍把30当非法值，改用20分钟验证非法预设后复验通过。
- 模拟验证未选伙伴/茶话会不可用拒绝开始、服务回传名字而非客户端伪造名字、跨App只给当前约定和请求指定的结算记录、未知id不返回历史、旧计时不对外暴露。实际Hana授权、跨App服务、真实陪读语气与视觉尚待实机验收；没有真实模型/API请求或全量回归。运行态另见PROJECT_LOG。

## 本轮：专注计时闭环（本地开发，不动版本号）

范围：待办/自由专注开始、预设时长、暂停并跨实例继续、中途结束实记、到点结算与休息状态/提前结束、只开日历时的到点结算、并发结束去重、日期页记录、近 7 天统计；检查专注记录未进入伙伴情境或公开快照。

隔离环境中执行（非全量）：

```powershell
node --test --test-reporter=spec tests/focus.test.js tests/focus-routes.test.js
node --test --test-reporter=spec --test-name-pattern="日期详情接口能正常读取当天数据" tests/routes.test.js
node --test --test-reporter=spec tests/public-today.test.js tests/public-today-app.test.js
node --check lib/data.js
node --check routes/ui.js
node --check lib/page-template.js
node --check tests/focus.test.js
node --check tests/focus-routes.test.js
node tools/build-page.mjs
```

结果：9 + 1 + 32 项相关测试通过（共 42 项，含专注记录不进入公开快照）；新增页面的 3 段内联脚本均可解析；JavaScript 语法检查 5/5 通过；页面构建成功（295.2 KB，旧路径/凭证残留干净，App 凭证头存在）。未跑全量回归；尚未在 Hana 运行中的页面实机操作计时控件。专注计时没有新增系统通知，关闭拾光记期间不会响铃，重新打开后按目标时间结算。

## 本轮：天气缓存时段重绘（v0.0.53）

现象：09:14 的真实注入仍带采集时的“清晨刚亮”。缓存存有整句 line，读取时没有重绘时段。修改前新增 12 条时段用例全部失败；修复后再补未知昼夜幂等用例，共 13 条。

处理：先从旧 line 恢复原观测 code/isDay，再移除新旧时段尾巴并按传入 now 生成“清晨时分/上午时分/午间时分”等中性描述；不从钟点推断日出、光照或月色。未知 isDay 保持 null，二次处理不回改；不修改缓存对象或 fetchedAt。真实注入、缓存读取、试查、日期页、预览、公开快照与纯文本构造均采用同一入口。天气指纹共用尾巴剥离函数，不因换词突破冷却。

隔离环境中执行（非全量）：

```powershell
node --test --test-reporter=tap --test-name-pattern="^(注入|天气|生活日总结|日期语义|DeepSeek)|^路由：.*(注入预览|天气)" tests/core.test.js tests/routes.test.js
node --test --test-reporter=tap tests/weather-clock.test.js tests/injection-guidance.test.js tests/inject-extension.test.js tests/public-today.test.js tests/public-today-app.test.js tests/network-boundary.test.js tests/festival-hints.test.js tests/inject-due-nudge.test.js
```

结果：50 + 109 = 159 条相关测试通过；lib/weather.js、lib/inject.js、lib/public-today.js、extensions/inject.js、routes/ui.js、tests/core.test.js、tests/weather-clock.test.js 语法检查 7/7 通过。首次相关回归只有旧“阳光正好”措辞断言失败；更新为保留晴朗、观测状态与中性清晨时段后复验通过。

关键覆盖：七时段、旧缓存兼容、未知昼夜保持未知、重复正规化幂等、无 code 的事实指纹、冷却不破、有效缓存零网络/零写盘、原天气和温度不变、共享快照/真实注入/预览/日期页、节日与待办调用方。独立只读复核无阻断项。

宿主静态校验 ok:true，0 errors，1 个动态依赖未证明的常规警告；正式 reload 后日志确认 2026-10-12 09:33:48 载入 v0.0.53，状态 host=on、agent=on。

边界：公开快照的时段对应生成时刻，不保证消费者很久以后读取仍是此刻；本轮不扩展消费者刷新机制。不调用真实模型或真实天气接口，未跑全量回归，模型回复体验仍需观察。

## 本轮：旧档案相关性准入（v0.0.52）

目标：保留近 3 个已结束生活日、30 天回溯、1800 字符正文预算和最多 10 条；不删档案、不增加模型调用，只减少与当前话题无关的旧记录。

处理：共用选择器动态排除用户名、伙伴显示名与 ID，排除通用问候/称呼/泛词；保留原文连续词组、明确项目名及具体短主题，组合二字主题需在查询中不重叠。重要程度只给已通过相关性的候选排序。无查询的预览/共享快照仅取近期底座。真实注入与预览传入已有用户称呼，不硬编码本机姓名；素材显示及“相关才提”的原约束不变。

修复前新增 14 条用例中 12 条失败、2 条通过；修复后增加陌生项目名/组合/姓名属格用例；独立审阅发现“浇水吗”会漏召，补用例复现失败后修正常见语气词，共 16 条。隔离环境中按下面命令验证（非全量）：

```powershell
node --test --test-reporter=tap --test-name-pattern="^(注入|生活日总结|日期语义|DeepSeek)|^路由：.*注入预览" tests/core.test.js tests/routes.test.js
node --test --test-reporter=tap tests/recent-summary-relevance.test.js tests/injection-guidance.test.js tests/inject-extension.test.js tests/public-today.test.js tests/public-today-app.test.js
```

结果：38 + 72 = 110 条相关测试通过。lib/recent-summaries.js、extensions/inject.js、routes/ui.js、tests/core.test.js、tests/recent-summary-relevance.test.js 的语法检查 5/5 通过。覆盖问候/姓名/泛词不展开、高分不直通、明确项目与两字主题可命中、组合证据、伙伴隔离、日期与预算、真实注入构造、预览和跨应用快照。

宿主静态校验 ok:true，0 errors，1 个动态依赖未证明的常规警告；独立只读复核无阻断项，常见语气词漏召已复现并修正。已通过正式入口 reload，2026-10-12 09:02:52 宿主日志确认载入 v0.0.52，状态 host=on、agent=on；真实新窗口的注入与模型回复尚待验收。

限制：本地词汇筛选不能等同于完整语义理解，相关记录的词片打分仍有长度偏置；动态姓名过滤以当前可获得的配置与档案元数据为准，未知别名不猜。尚未全量回归或验收真实模型回复质量，不宣称所有自然语言检索都准确。

## 本轮：情境注入规则去重（v0.0.51）

修复前，真实开场背景消息可由旧代码完整复现为 3252 字符，日期硬约束出现两次；新增 6 条用例在修复前 5 条失败、1 条通过，其中旧总结分支还缺少显式档案相对日期说明。

处理：近期总结格式化只提供素材与标签，整条注入末尾统一提供日期和档案使用规则；原素材、伙伴筛选、字符预算、触发频率、天气、节日、待办和模型峰谷关照逻辑不变。保留旧总结调用方及仅有近期回忆的分支。

隔离环境下执行以下定向命令（非全量测试）：

```powershell
node --test --test-reporter=tap --test-name-pattern="^(注入|生活日总结|日期语义|DeepSeek)" tests/core.test.js
node --test --test-reporter=tap tests/injection-guidance.test.js tests/festival-hints.test.js tests/inject-due-nudge.test.js
```

结果：36 + 28 = 64 条相关测试通过；lib/inject.js、lib/recent-summaries.js、tests/core.test.js、tests/injection-guidance.test.js 语法检查 4/4 通过。覆盖单份规则、同日跨窗口/正文与 MOOD 日期归属、旧总结/近期总结混合、无历史素材、天气不强制播报、节日问候与时间边界、待办提醒和 DeepSeek 关照分支。

独立只读复核后，补回“也不能归入生活日”和“不要猜”两处原有边界，并增加断言；上述相关测试重新运行仍为 64/64、语法检查仍为 4/4。

同一真实开场输入最终重建后为 2813 字符，减少 439 字符（约 13.5%，非 token 计数），素材行逐行一致，日期硬约束由 2 份变为 1 份。宿主静态校验 ok:true，0 errors，1 个动态依赖未证明的常规警告。已通过正式 extension_manager reload；启动日志确认 2026-10-12 08:38:11 载入 v0.0.51，App 状态 host=on、agent=on。此对比不调用模型；尚未运行全量回归或验证模型回复质量，不把模板等价当成体验已实机验收。


## 本轮：记一笔重复方式下拉（v0.0.45）

原因：记一笔卡片是异步渲染的，页面启动时的一次性下拉初始化早于待办表单插入，因此“重复方式”漏接现有手帐风自定义下拉，仍弹出 Windows 原生菜单。

处理：在待办重复方式同步时接入已有 `beautify-select` 组件；菜单颜色映射到拾光记的薄荷绿，触发栏尺寸贴合表单，编辑周期任务时同步禁用自定义触发按钮和值载体，程序改选项时同步显示文字。

自动验证：下拉相关路由回归 1/1 通过；`lib/page-template.js` 与 `tests/routes.test.js` 的 `node --check` 2/2 通过；页面重新构建为 278.2 KB，旧路径与旧凭证拼接检查干净。**未运行全量测试，也未重载 App 做实机视觉验收。**

## 本轮：周期待办（v0.0.43）

- 规则保存在原待办上，不把未来日期预先写成一堆事件；日历按本地日历展开每天或每周指定星期的实例。
- 每次完成记在独立日期账本，实例 ID 为 `系列ID@YYYY-MM-DD`。漏勾不阻止下一次出现；提醒成功后续排下一次，不替用户勾完成。
- 门厅把逾期实例按周期任务归组，可逐次勾选，也可明确批量确认昨天及更早已完成的次数；今天和未来不进批量范围。
- 周期规则、起始日期和类型暂不支持编辑；名称与提醒时间可编辑。删除会删除整组及其完成历史。首版不识别法定节假日。

自动验证：定向测试 138/138 通过（8 个待办/路由/门厅相关测试文件 136 条，另从 `tests/core.test.js` 选跑 2 条注入回归）；20 个相关 JavaScript 文件 `node --check` 通过。重新生成 `ui/panel.html` 为 277.3 KB，旧路径与旧凭证拼接检查干净。**没有运行全量测试，也没有重载 App 做实机界面验收。**

主要覆盖：每日/每周跨月跨年展开、逐次完成、跨 App 按实例 ID 勾选、欠账批量边界、工具创建、快照、提醒续排、重启后只恢复当前日期而不重放停机期间的旧提醒、既有通知恢复、页面路由和门厅交互。

## 本轮：从插件版搬数据（v0.0.40）

场景：插件版用户在 `plugin-data/shiguangji/` 里存着日子、待办、时光册和心情。应用版的数据在 `app-data/shiguangji-app/`，而 App 进程的裸 fs 读不到插件目录（宿主只放安装目录与 app-data），所以「搬家」不是复制文件，而是：
读旧密文（`ctx.resources.read`，在路由里由页面触发）→ 用旧 `.sgj.key` 解开 → 用应用自己的密钥重新加密 → 写进应用数据目录。

入口：`GET /api/legacy-migration`（探测）、`POST /api/legacy-migration/run`（执行）；前端入口在设置里，打开设置弹窗时探一次，**没探到插件版数据时整块隐藏**（没装过插件版的人设置里看不见这一节，也不自动搬）。

判据与护栏：

- 应用自己的内容文件（`user-events.dat` / `daily-summaries.dat` / `moods.dat` / `partner-moods.dat` / `todo-reminders.dat`）只要有一个在，自动搬迁就劝退，避免覆盖她已经在应用里记下的东西；`settings.dat` / `data-rev.dat` 这类打开就写的文件不算判据，否则保存过一次设置就把老账挡在门外。
- 逐文件判目标是否存在，存在就跳过，绝不覆盖。
- 搬过写 `migration-report.json`；报告里没有失败项就不再自动重搬；她手动点则只补搬缺的那些。
- **密钥不搬**：旧的 `.sgj.key` 只当解密材料，目标始终是应用自己那把密钥，所以不需要重建数据实例；搬完只调 `data.invalidateAll()` 清内存缓存，页面刷新即可看到老数据。
- 读不到、解不开、坏 JSON 都只回报，不抛给启动，也不写坏文件。读旧目录被宿主挡下时明确回 `blocked`（而不是冒充「没有数据」）。
- 探测与执行都在路由里，装载期不碰受权限保护的接口（不然宿主会判定装载失败并回滚安装记录）。

自动验证：完整 522/522 通过（新增 `tests/migrate-legacy.test.js` 17 条：探测四种结论、旧密钥格式、错误分类、搬迁后新旧密钥的读写关系、不覆盖、密钥不匹配、明文坏 JSON、报告与幂等、force 补搬、「装载期不出现 `ctx.resources`」与界面文案不露内部文件名的回归守卫）。

实机验收（2026-10-07，重载后看设置）：

- ✅ **宿主允许读插件目录**。重载后设置里出现了这一块，探测结果为 `target-has-data`，而该结论的前提是 `available=true`（能读到 `HANA_HOME/plugin-data/shiguangji/` 下的文件）。此前只实测过 `agents/` 与 `user/`，插件目录是头一回碰——所以「读旧密文 → 换密钥重写」这条路可行。
- ✅ **劝退分支真机生效**。这台机器上应用侧已有内容数据（早年手动搬过），界面老老实实回「已经有你自己记下的东西了，所以没有自动搬」，没有动手。
- ⏳ 尚未在实机真正跑过一次搬迁（`migrate` 分支），也尚未验「读不到」的 `blocked` 文案。
- 🔧 首次实机暴露的一个显示问题：`target-has-data` 文案把 `user-events.dat` 这类内部文件名列给了用户，已改成大白话，并新增一条测试守住（用户可见文案里不得出现 `.dat` / `.sgj.key`）。

口径边界：探测与劝退已在实机验过（见上）；**真正的搬迁动作（`migrate` 分支）还没在实机跑过一次**，也还没遇上「读不到」的 `blocked` 场景。想真跑一次，需要一个「应用侧空白 + 插件侧有数据」的现场（例如新机器，或先把应用数据目录腾空）。

## 隔离运行

先将 HANA_HOME、HOME、USERPROFILE、TEMP、TMP 指向工作台的测试临时目录，再进入当前 App 源码目录运行：

```powershell
node --test --test-reporter=spec
```

这是完整测试命令，包含 lib 内的测试；`tests/*.test.js` 只覆盖主测试目录，不能冒充全量。

所有测试和子进程均继承隔离变量，不使用真实用户数据、真实模型、真实会话或真实系统通知。语法检查使用 `node --check`；页面内联脚本通过 `new Function` 仅解析，不执行。宿主静态校验使用当前安装版本的 `scripts/validate-app.mjs --dir <App源码目录> --json`，必须读取非空结构化结果，不能只凭退出码。

目录连接会让 C: 启动路径与 D: 模块真实路径不同；验证脚本应使用 realpath 后的绝对入口。测试快照必须把 workdir 设为自己的快照目录，不能在工作台根目录运行绝对路径测试后把子进程模块定位失败算作源码问题。

## 本轮：做完的待办不再挂在「今天是什么日子」里（v0.0.39）

实机现象：15:00 她说完「浇完啦」、点了确认勾选，待办确实标成完成；但 18:02 那轮注入给伙伴的「今天是：国庆节假期🏖️、8点吃维生素d、3 点给薄荷浇水」里，这条做完的待办还挂着，一个状态标记都没有。伙伴就照它编了一句「我给薄荷补了水，三点那趟拖到现在才补上」。

根因：待办被两条路各捞了一遍。待办专线（`todos` / `todosDue` / `todosPending`）走 `filterDueTodos`，看勾没勾；「今天是什么日子」这条日期线走 `eventsOnDate`，只按日期匹配，不看 `done`。于是一条待办勾掉后从专线消失、在日期线原样留着。注入（`lib/inject.js` 的 specials）与对外共享快照（`lib/public-today.js` 的 `today.events`）都走日期线，所以主对话框和茶话会两边都带着同一个假象，至少躺了两天（10-05 的「4 点给薄荷浇水」同样）。

改法：待办不混进日期线，只走待办专线。三处同源一起改：`lib/inject.js`（「今天是」的 specials 组装）、`lib/public-today.js`（`today.events`）、`tools/today.js`（「今天有」）。过滤口径是 `type === "todo" && !repeatYearly`：年度重复的待办进不了到期待办线（见 `isTodoDue`），仍留在日期行当日程，不丢信息。日历页的 `/api/events/:date` 不动，那是给她自己看的，该看到待办。

自动验证：完整 505/505 通过（新增 `tests/inject-due-nudge.test.js` 一条：待办不进「今天是」、勾掉的也不进、年度重复的仍当日程；新增 `tests/public-today.test.js` 一条：待办不进 `events` 列表，同一口径）。宿主静态校验非空 JSON ok:true、0 errors、1 warning（仅动态依赖未证明）。

口径边界：验的是源码与快照组装结果，**没做实机验收**。v2 无热重载，需在 App Manager 重新装载后再看真实注入；共享快照发出去之后茶话会那边读到什么，要两边都重载后才算数。

## 本轮：「记一笔」保存成功后红字还挂着（v0.0.35）

实机现象：在「记一笔」里填好待办、点「记下」，待办确实存上了，但那行红字（「请选择提醒时间，选同一时间表示准点提醒。」）还挂在表单下面。

根因不在保存链路：`syncTodoReminderUI` 把「还没开始填」当成了「填错了」。它的错误块只要 `valid` 为假就移除 `hidden`，而两端都为空时 `valid` 必然为假，于是写了一行红字上去。这个函数在每次重画今日页（`renderAddCard` 末尾）和切到「待办」类型时都会调（`lib/page-template.js`）。保存成功后要走 `loadToday()` 重画，正好命中；她看到的是重画后的空表单被当成了报错。

改法：新增 `untouched = !startValue && !endValue`，红字只在真填错时显示（`showError = !valid && (editingTodoNeedsReminderTime || !untouched)`）——一头缺失、开始晚于结束、或编辑一条还没设过时间的旧待办时才提示；全新一笔两端都空不挂红字，保存按钮照旧禁用。另新增 `resetAddCardState()`，保存成功与取消编辑都调它，把 `editingEventId`、`editingTodoNeedsReminderTime`、`todoReminderManual`、`todoReminderAutofilled` 一并清掉。这几个是模块级变量，不随卡片重画复位，漏清时编辑过一条缺时间的旧待办、再普通记一笔，会被告知「这条旧待办还没设过提醒时间」。

自动验证：完整 484/484 通过（新增 `tests/routes.test.js` 一条：空表单不挂红字、旧写法 `toggle('hidden', valid)` 不得复现、保存成功与取消编辑都走 `resetAddCardState`）。页面是构建产物，已重跑 `node tools/build-page.mjs`（267.7 KB，旧路径与旧凭证残留检查通过）。

口径边界：验的是源码与产物结构，**没做实屏验收**。v2 无热重载，需在 App Manager 重新装载后再看这一处。

## 本轮：对外快照多一份「到点了」（v0.0.33 / v0.0.34 措辞修正）

茶话会要能「到点主动来找她说一句」，就得先知道哪几件已经到点。快照 `today` 里新增 `todosDue`：

```
today.todosDue = [{ title: "给薄荷浇水", at: "16:00" }]
```

口径：今天到期（不是逾期几天那种）、写了起始钟点、现在已过那个时刻、还没勾掉。`at` 就是 `reminderStart`，最多带 4 条。

**只加字段，没动 `todos`。** `todos` 还是原来那份标题串，旧消费方一个字都不用改。判钟点那段抽到 `lib/data.js` 的 `todoClockPassed`，跟注入那边同一套算法，不再两处各判一份。

自动验证：完整 483/483 通过（`tests/public-today.test.js` 新增 2 条：只收到点未了结且带钟点、没有到点的就是空数组）。

口径边界：快照是**发布给别的 App 读**的，测试只验组装结果，没验真实发布后的读取。茶话会能不能真读到、读到之后会不会真开口，要看两边都重载后的实机。

v0.0.34 措辞修正：茶话会那条链子实机通了（当天伙伴主动提了浇水），但由头里「还没勾掉」被原样抄成「还没勾浇水」，「勾」是记事本的动作，落在嘴里要停顿一下才反应过来。茶话会与注入两处文案一起改：不再用「了结/勾掉」这类记事词，改成「到了时间还没做」，并明说「用你自己的话顺口带一句，别照抄这一行」。测试同步换成新措辞。

## 本轮：待办到点不再只靠一闪而过的通知（v0.0.31）

系统通知飘一下就没了。本轮把提醒铺成三层：

① **输入框上方的横幅**（新 `lib/todo-banner.js`）：通知确认发出后，顺手在她最近开口的那个会话上方挂一条，不自动消失、只认手动关，**只有一句话，不带按钮**（v0.0.32 修正：原先加过一个「让 ta 说一句」按钮，被指出“提醒反倒要她先点一下”，已拆掉）。活跃会话靠 `ctx.bus.subscribe` 的第二个参数记下来（签名固定 `(event, sessionPath)`），六小时内没再露面就不再往那个窗口硬塞；换会话先把旧那条摘掉（横幅全局只留一条）。挂不上（无活跃会话 / 宿主未提供 `ctx.inputBanner`）只记原因，不影响系统通知那条路。横幅由调度器通过构造参数注入，不注入就是空操作，既有 22 条调度器测试不碰宿主。

② **门厅与日历页的标记**：今天过了钟点又还没勾掉的待办，在门厅那行和页面待办行上直接标出来（不只看一眼通知）。

③ **注入里顺口提一句**：`buildInjectionText` 对“今天过了钟点还没了结”的待办单独点名，并说明新窗口 / 隔久才开口时最合适，刚提过或正忙就先放着；没到点、已勾掉、没写钟点的一律不进这一段。

自动验证：完整 481/481 通过（新增 `tests/todo-banner.test.js` 6 条、`tests/inject-due-nudge.test.js` 3 条；v0.0.32 去掉按钮后同数仍全绿，其中横幅那条断言已改为“不带按钮”）。

口径边界：三层都**没有实机验收**。横幅能不能真的挂上（取决于她那时有没有开着的会话、宿主是否提供接口）、按钮点下去是否真起一轮对话、以及“顺口提一句”会不会偏频繁或偏健忘，都要重载后真跑一次才有结论。

未做（第三档后半，跨应用）：把待办提醒发布给茶话会、由关系最高且最近常聊的伙伴主动来找。

## 本轮：左侧门厅（功能面板）（v0.0.30）

整页卡原先只声明了 `fpFullPanel: true` 却没交内容，左侧长期显示宿主的空态「此页尚无清单」。本轮补上 `functionPanel: { id: "hall", label: "拾光记", route: "/hall.html" }` 与门厅页面：今日日期 / 星期 / 节日、今天与逾期的待办、四个跳转入口（日历 / 时光册 / 心情线 / 生理期）、设置入口、一行窗外天气；门厅每 60 秒自刷一次。

联动方式：门厅与主页面是宿主里的两个独立文档，不共享脚本对象，宿主也不给功能面板直接操作主卡的口子。因此点位走 App 自己的后端：`POST /api/fp-signal`（只认白名单动作）写入，主页面每 2.5 秒 `GET /api/fp-signal?since=<ms>` 取新并派发；起步时间是本次加载，不会把上一轮留下的旧信号当新指令重跑。

自动验证：完整 472/472 通过（新增 `tests/fp-hall.test.js` 4 条，覆盖清单声明、页面文件与内联脚本解析、入口与页面凭证、主页面派发、后端白名单与时间戳）。宿主静态校验非空 JSON ok:true、0 errors，`uiRoutes` 同时列出 panel.html 与 hall.html。

口径边界：门厅的实际呈现、点位是否真能驱动主页面、窄栏里的观感，**都还没实机验收**，需重新装载后由使用者打开查看。

## 本轮：这一页区块的框配平（v0.0.29）

「这一页」区块的拼接多了一个 `</div>`，把 `.sum-block` 提前关掉：标题行和两个入口留在框内，伙伴名、正文、修改 / 和小花聊聊按钮全落在框外贴页面底。这个结构从迁移前基线（949e3a7）就在。修法是去掉多余的闭合；同时把一条把错误写法当契约钉住的旧断言改回配平，新增一条 `tests/routes.test.js` 断言守 div 开闭与框内条目。

自动验证：完整 468/468 通过。

## 本轮：今日页重排与规律收起（v0.0.28）

纯前端布局重排，不动数据层与路由。今日页「记一笔」改成独立卡片：类型（随记 / 纪念 / 待办）从底部小胶囊提到最前，做成三格并排；接着是类型说明、填内容、提醒时间、记下，按决定顺序排下来；生理期快捷条从不透明粉块收成一行细提示；空状态那句不再单独占一行；时光册预览让位到记一笔之后。日历页「生理期规律」默认收成一行入口（右边带一句最要紧的提示：今天第几天 / 下次预计 / 还差几次记录），点一下才展开，展开状态不记忆。

自动验证：完整 467/467 通过。新增 `tests/routes.test.js` 一条布局断言，守卡片结构、类型在输入之前、记下在填写之后、预览让位、规律默认收起；旧断言（类型文案、提醒时间 id、窄屏 CSS 片段）全部保留未动。宿主静态校验非空 JSON ok:true、0 errors，仅动态依赖未证明提示。

口径边界：本轮验证的是源码结构与 CSS 契约，**没有实机观感验收**。v2 App 无热重载，需在 App Manager 重新装载后再看真实排版；窄屏（560 / 380 两档）的观感仍需实屏确认。

## 本轮证据

- 修复前主测试目录基线：366 条，356 通过、10 失败。逐项诊断旧接口后适配，保留错误、网络边界、重试、思考预算等保护断言。
- 正式源码完整自动测试：466/466 通过，0 失败、0 跳过。
- 入口、保存后共享与公开数据：包括保存增改删、生理期/天气设置、跨天独立刷新、失败重试、撤权清空后的再授权恢复发布、64 KiB UTF-8 整份 JSON 字节上限、公平保留伙伴最新回顾、本地原档案不裁剪。
- 待办 App 专项：22/22。只用 ctx.tasks 与原生通知；不创建会话、不调用模型。覆盖增改删、重复回调、已完成与陈旧计划、明确未发出的重试、超时未知不自动重发、重启未结算发送、确认通知后的结算写入失败、创建计划等待中删除、任务权限失败与入口共享实例。另覆盖通知在途时编辑新时间、缺计划/过期重试恢复、失败重试状态保留、排程超时不重复创建与迟到对账、4096 字节正文边界、宿主回调早于排程回包、未知旧安排期间改时间和删除后的迟到计划清理。
- 聊天工具：查询/添加实际登记，共用 App 账本；写操作不冒充只读，等待提醒回调；记录保存成功与提醒调度失败分别说明。
- 自动做册恢复：假宿主公开会话/模型接口，无旧会话文件、无页面实例，按持久任务快照只补未完成日期，不重复已完成日期。
- 模型测试包含 MiniMax fake 目录和 fake stream，保留同 provider/model 重试和无正文保护。宿主 NDJSON 当前适配未提供截断原因，因此该测试的思考空正文重试预算为 6000，不再假定旧直连 finish_reason=length 的 8000；没有宣称真实模型关闭思考已验证。
- 茶话会联动侧：完整 1177/1177 通过，读失败/撤权不回退冻结旧文件，只取当前伙伴自己的回顾。
- 拾光记静态校验：非空 JSON ok:true，0 错误，仅 DYNAMIC_DEPENDENCIES_NOT_PROVEN 提示。4 段页面内联脚本均解析通过。

## 提醒状态与宿主边界

App 新建会话被强制设为私有，不进入主列表；消息接纳不证明用户看到回复，因此本轮采用直接系统通知，不申请 app/session.start-turn 或跨归属管理会话权限。

- shown:true：宿主确认发出通知，记 confirmed/delivered；不代表系统一定展示横幅，更不代表用户已读，不自动勾选待办。
- shown:false 或明确拒绝：保持未发出状态，按既有退避重试。
- 超时/空回包/结果未知：notification-unknown，不自动重发，页面提供确认后重试。
- 已确认发出但结算写入失败：confirmed-unsettled，不自动重发；页面说明已发出但记录未结算，重试会提醒重复风险。
- 进程中断时尚为 notificationState=sending：恢复为未知，禁止盲目重发。

主入口 apply 只登记 task handler；权限诊断与计划恢复延后，并通过原有分钟刷新对账已由使用者提交的明确提醒意图。缺计划/已过期的失败重试可补排；同一请求结果未结算不重复创建，未知结果只对账。迟到计划若对应记录已删，继续清理。页面与聊天工具共用主入口实例，保存后调度失败不得让使用者重复新增记录。

## 交叉审查与红基线

独立审查指出通知在途吞掉新计划、恢复漏计划、重试失败丢状态、排程超时重复创建和正文上限问题，均补复现回归。预审源码在同一组 19 例中 12 通过、7 失败；最终专项 22/22 通过。定点二次复核发现更新参数白名单、回调早于回包的终态缓存和发送中逐条恢复隔离问题，已修复并补强测试：updateSchedule 只传 payload/label/runAt，观察到执行后失效缓存重新对账；坏记录恢复失败不堵其他记录。预审源码与日志保留在工作台 `_tmp_shiguangji_finish/native-pre-review-source/` 和 `pre-review-edge-baseline.log`，未删断言凑绿。

当前 0.1059.0 宿主实现对带 runAt 的 updateSchedule 递增版本，旧 once 回调完成时不会覆盖新版本；这是本版实现核实，不能外推所有版本。

## 尚未实机生效的部分

两个 App 的正式 reload 均报告新增权限需要使用者审阅；没有代批、没有绕行。源码保存与自动测试通过不等于运行中的旧版已经切换。

在「设置 → 应用 → 应用权限」中选择对应应用：
- 拾光记：发布 App 数据、自动调用工具、管理后台任务、显示系统通知。
- 茶话会：读取已发布的 App 数据。

路径与中文名来自当前宿主资料/语言资源，未冒充实屏验收。新增权限的重载确认界面标题为「审查权限变更」，批准按钮为「允许并重新加载」（当前 zh.json:3540–3541）；不能由开发工具代点。

待审阅并重载后，还需实机验收：真实工具可见性与调用、共享快照即时刷新/撤权、通知实际显示、自动做册真实跨凌晨/重启和任务取消恢复。测试从未触发真实提醒。

## 拾性剔噪（2026-10-19）

- 拾性纯逻辑：48/48 通过（tests/xingji.test.js）。新增 11 条覆盖内部思考块剥离、长篇降兜底、同类型均匀取样、通用习惯横向对比、单伙伴基线、行为描述拦截、解析层丢弃、抽样剥块、提示词条件句。
- 拾性数据层 + 注入扩展：79/79 通过（xingji.test.js + xingji-data.test.js + inject-extension.test.js）。
- 路由主测试：49/49 通过（tests/routes.test.js）。
- 未验证：真实模型下的日采与周归纳效果，需在页面重跑历史后人工比对；内置基线的 29%~35% 阈值来自当前这批历史，模型换排版习惯后要重测。
