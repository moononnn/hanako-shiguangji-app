// 聊天工具与页面、注入共用同一个 App 账本，宿主不自动添加工具名前缀。
import * as today from '../tools/today.js';
import * as addEvent from '../tools/add-event.js';
import * as completeTodo from '../tools/complete-todo.js';

export function registerDaybookTools(ctx, eventChanged = () => {}) {
  ctx.tools.register({
    name: today.name,
    description: today.description.replace('拾光记插件', '拾光记'),
    parameters: today.parameters,
    sessionPermission: today.sessionPermission,
    execute: input => today.execute(input, { dataDir: ctx.dataDir }),
  });
  ctx.tools.register({
    name: addEvent.name,
    description: addEvent.description,
    parameters: addEvent.parameters,
    // 添加记录是写操作，使用宿主默认审阅档，不能标为只读免审阅。
    execute: input => addEvent.execute(input, { dataDir: ctx.dataDir, eventChanged }),
  });
  ctx.tools.register({
    name: completeTodo.name,
    description: completeTodo.description,
    parameters: completeTodo.parameters,
    execute: input => completeTodo.execute(input, { dataDir: ctx.dataDir, eventChanged }),
  });
}
