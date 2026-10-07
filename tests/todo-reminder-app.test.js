import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TODO_REMINDER_TASK_TYPE, todoReminderKey } from '../lib/todo-reminder.js';
import { TodoReminderScheduler, setTodoReminderScheduler, getTodoReminderScheduler, __resetTodoReminderSchedulerForTest } from '../lib/todo-reminder-scheduler.js';

const clock = () => new Date(2026,9,5,10).getTime();
function todo(id='one',time='10:00') { return {id,title:'买牛奶',type:'todo',date:'2026-10-05',reminderStart:time,reminderEnd:time,done:false,repeatYearly:false}; }
function harness({event=todo(), state=null, schedules=[], show=async()=>({shown:true})}={}) {
  const events=new Map(event?[[event.id,event]]:[]), states=new Map(state?[[event.id,state]]:[]);
  const calls={register:[],list:0,schedule:[],update:[],unschedule:[],bus:[],notifications:[]};
  let handler, sequence=0, at=clock();
  const records=schedules.map(v=>structuredClone(v));
  const data={listEvents:()=>[...events.values()],getEvent:id=>events.get(id),getTodoReminder:id=>states.get(id),
    async saveTodoReminder(id,value){states.set(id,structuredClone(value));return value;},async removeTodoReminder(id){states.delete(id);}};
  const ctx={tasks:{
    async registerHandler(key,value){calls.register.push(key);handler=value;},
    async listSchedules(){calls.list++;return records;},
    async schedule(value){calls.schedule.push(value);const record={...value,scheduleId:`schedule-${++sequence}`};records.push(record);return record;},
    async updateSchedule(id,patch){assert.ok(Object.keys(patch).every(key=>['payload','label','runAt'].includes(key)),'仅使用公开SDK允许的更新字段');calls.update.push({id,patch});const record=records.find(r=>r.scheduleId===id);Object.assign(record,patch);return record;},
    async unschedule(id){calls.unschedule.push(id);}},
    bus:{async request(verb){calls.bus.push(verb);if(verb==='app:capabilities')return {capabilities:['app/tasks.manage','app/notifications.show','app/agents.read'].map(capability=>({capability,status:'always'}))};throw new Error('不得创建会话或调用模型：'+verb);}},
    notifications:{async show(value){calls.notifications.push(value);return show(value);}},
    logger:{info(){},warn(){}}};
  const scheduler=new TodoReminderScheduler({ctx,data,now:()=>at});
  return {ctx,data,events,states,calls,records,scheduler,get handler(){return handler;},advance(ms){at+=ms;},input(){return {eventId:event.id,key:todoReminderKey(events.get(event.id)),runAt:at};}};
}

 test('App apply 只登记处理器，权限/计划恢复在装载后，不启动新计划',async()=>{
  const h=harness({event:null});await h.scheduler.registerAppTaskHandler();
  assert.deepEqual(h.calls.register,[TODO_REMINDER_TASK_TYPE]);assert.equal(h.calls.list,0);assert.deepEqual(h.calls.bus,[]);
  await h.scheduler.restoreAppSchedules();assert.equal(h.calls.list,1);assert.equal(h.calls.schedule.length,0);
  __resetTodoReminderSchedulerForTest(h.scheduler);
});

test('App 待办增改删：使用公开任务接口，编辑不重复创建，删除撤销',async()=>{
  const h=harness({event:todo('one','11:00')});await h.scheduler.registerAppTaskHandler();
  await h.scheduler.eventChanged(h.events.get('one'));assert.equal(h.calls.schedule.length,1);
  const edited=todo('one','12:00');h.events.set('one',edited);await h.scheduler.eventChanged(edited);
  assert.equal(h.calls.schedule.length,1);assert.equal(h.calls.update.length,1);
  h.events.delete('one');await h.scheduler.eventChanged(null,'one');assert.deepEqual(h.calls.unschedule,['schedule-1']);
  __resetTodoReminderSchedulerForTest(h.scheduler);
});

test('App 提醒成功：只发原生通知，记确认发出，不改待办完成态、不创建聊天或调用模型',async()=>{
  const h=harness();await h.scheduler.registerAppTaskHandler();
  assert.deepEqual(await h.handler.run({input:h.input()}),{delivered:true});
  assert.equal(h.calls.notifications.length,1);assert.match(h.calls.notifications[0].body,/买牛奶/);
  assert.deepEqual(h.calls.bus,[]);assert.equal(h.states.get('one').notificationState,'confirmed');
  assert.equal(h.events.get('one').done,false);
  assert.deepEqual(await h.handler.run({input:h.input()}),{skipped:true,reason:'already-delivered'});
  assert.equal(h.calls.notifications.length,1);__resetTodoReminderSchedulerForTest(h.scheduler);
});

test('App 明确未发出：持久化失败与重试，后续成功只确认通知',async()=>{
  let allowed=false;const h=harness({show:async()=>({shown:allowed})});await h.scheduler.registerAppTaskHandler();
  assert.deepEqual(await h.handler.run({input:h.input()}),{delivered:false});
  assert.equal(h.states.get('one').status,'pending');assert.equal(h.calls.schedule.length,1);
  allowed=true;h.advance(61_000);assert.deepEqual(await h.handler.run({input:h.input()}),{delivered:true});
  assert.equal(h.calls.notifications.length,2);assert.equal(h.states.get('one').status,'delivered');assert.deepEqual(h.calls.bus,[]);
  __resetTodoReminderSchedulerForTest(h.scheduler);
});

test('App 通知超时：结果未知不自动重发，用户主动重试才重新安排',async t=>{
  let reply=()=>new Promise(()=>{});const h=harness({show:()=>reply()});await h.scheduler.registerAppTaskHandler();
  t.mock.timers.enable({apis:['setTimeout']});const pending=h.handler.run({input:h.input()});
  await new Promise(resolve=>setImmediate(resolve));t.mock.timers.tick(3001);await pending;
  assert.equal(h.states.get('one').status,'notification-unknown');assert.equal(h.calls.schedule.length,0);
  h.advance(61_000);await h.handler.run({input:h.input()});assert.equal(h.calls.notifications.length,1);
  reply=async()=>({shown:true});await h.scheduler.retryNotification(h.events.get('one'));
  assert.equal(h.calls.schedule.length,1);h.advance(20);await h.handler.run({input:h.input()});
  assert.equal(h.calls.notifications.length,2);assert.equal(h.states.get('one').status,'delivered');
  __resetTodoReminderSchedulerForTest(h.scheduler);
});

test('App 重启：发送中未结算视为未知，已确认发出的不重复',async()=>{
  const item=todo();const h=harness({event:item,state:{key:todoReminderKey(item),status:'sending',notificationState:'sending'}});
  await h.scheduler.registerAppTaskHandler();await h.scheduler.restoreAppSchedules();
  assert.equal(h.states.get('one').status,'notification-unknown');await h.handler.run({input:h.input()});assert.equal(h.calls.notifications.length,0);
  h.states.set('one',{key:todoReminderKey(item),status:'delivered',deliveredAt:new Date(clock()).toISOString(),notificationState:'confirmed'});
  await h.handler.run({input:h.input()});assert.equal(h.calls.notifications.length,0);__resetTodoReminderSchedulerForTest(h.scheduler);
});

test('App 旧计划/完成待办：不得发出已删除、已完成或时间已变的提醒',async()=>{
  const h=harness();await h.scheduler.registerAppTaskHandler();const old=h.input();
  h.events.set('one',todo('one','11:00'));assert.deepEqual(await h.handler.run({input:old}),{skipped:true,reason:'stale-plan'});
  h.events.get('one').done=true;await h.handler.run({input:h.input()});assert.equal(h.calls.notifications.length,0);
  h.events.delete('one');await h.handler.run({input:old});assert.equal(h.calls.notifications.length,0);__resetTodoReminderSchedulerForTest(h.scheduler);
});

test('App 缺少公开任务接口：停用，不回退旧总线或轮询',async()=>{
  const h=harness();delete h.ctx.tasks;assert.equal(await h.scheduler.registerAppTaskHandler(),false);
  assert.equal(h.scheduler.mode,'disabled');assert.equal(h.scheduler.pollTimer,null);assert.deepEqual(h.calls.bus,[]);
  __resetTodoReminderSchedulerForTest(h.scheduler);
});

test('App 任务权限被拒：记录保存和提醒计划分开，向入口返回明确失败',async()=>{
  const h=harness();h.ctx.tasks.schedule=async()=>{throw new Error('APP_CAPABILITY_DENIED');};
  await h.scheduler.registerAppTaskHandler();await assert.rejects(h.scheduler.eventChanged(h.events.get('one')),/app\/tasks.manage/);
  assert.equal(h.calls.notifications.length,0);__resetTodoReminderSchedulerForTest(h.scheduler);
});

test('App 通知已确认但结算写入失败：不得当明确未发出自动重发',async()=>{
  const h=harness();const save=h.data.saveTodoReminder;
  h.data.saveTodoReminder=async(id,value)=>{if(value.notificationState==='confirmed')throw new Error('结算写入失败');return save(id,value);};
  await h.scheduler.registerAppTaskHandler();await h.handler.run({input:h.input()});
  assert.equal(h.states.get('one').status,'notification-unknown');assert.equal(h.calls.schedule.length,0);
  h.advance(61_000);await h.handler.run({input:h.input()});assert.equal(h.calls.notifications.length,1);
  __resetTodoReminderSchedulerForTest(h.scheduler);
});

test('App 删除发生在创建计划等待中：迟到回包不能复活已删除提醒状态',async()=>{
  const h=harness({event:todo('one','11:00')});const schedule=h.ctx.tasks.schedule;
  let finish;const gate=new Promise(resolve=>{finish=resolve;});
  h.ctx.tasks.schedule=async value=>{await gate;return schedule(value);};
  await h.scheduler.registerAppTaskHandler();const adding=h.scheduler.eventChanged(h.events.get('one'));
  await new Promise(resolve=>setImmediate(resolve));h.events.delete('one');h.states.delete('one');
  const removing=h.scheduler.eventChanged(null,'one');finish();await Promise.all([adding,removing]);
  assert.equal(h.states.has('one'),false);assert.deepEqual(h.calls.unschedule,['schedule-1']);
  __resetTodoReminderSchedulerForTest(h.scheduler);
});

test('App 在途旧通知不吞掉编辑后的新时间任务',async()=>{
  let finish;let count=0;const gate=new Promise(resolve=>{finish=resolve;});
  const h=harness({show:async()=>{if(++count===1)await gate;return {shown:true};}});
  await h.scheduler.registerAppTaskHandler();const old=h.handler.run({input:h.input()});await new Promise(r=>setImmediate(r));
  h.events.set('one',{...todo('one','10:01'),title:'买菜'});await h.scheduler.eventChanged(h.events.get('one'));h.advance(20);
  const busy=await h.handler.run({input:h.input()});assert.equal(busy.deferred,true);assert.ok(h.states.get('one').nextRetryAt>clock());
  finish();await old;h.advance(61_000);await h.handler.run({input:h.input()});
  assert.equal(h.calls.notifications.length,2);assert.match(h.calls.notifications[1].body,/买菜/);assert.equal(h.states.get('one').status,'delivered');
  __resetTodoReminderSchedulerForTest(h.scheduler);
});

test('App 恢复账本明确提醒意图：缺计划及过期失败重试均补排，不触发真实通知',async()=>{
  const item=todo();const h=harness({event:item,state:{key:todoReminderKey(item),status:'pending',lastError:'以前排程失败',nextRetryAt:clock()-1000}});
  h.events.set('two',todo('two','12:00'));await h.scheduler.registerAppTaskHandler();await h.scheduler.restoreAppSchedules();
  assert.equal(h.calls.schedule.length,2);assert.equal(h.calls.notifications.length,0);assert.ok(h.states.get('one').scheduleId);assert.ok(h.states.get('two').scheduleId);
  __resetTodoReminderSchedulerForTest(h.scheduler);
});

test('App 首次排程失败持久化可见错误，下一轮授权恢复后能补排',async()=>{
  const h=harness();const original=h.ctx.tasks.schedule;h.ctx.tasks.schedule=async()=>{throw new Error('APP_CAPABILITY_DENIED');};
  await h.scheduler.registerAppTaskHandler();await assert.rejects(h.scheduler.eventChanged(h.events.get('one')));
  assert.ok(h.states.get('one').lastError);assert.equal(h.states.get('one').planState,'failed');
  h.ctx.tasks.schedule=original;h.advance(61_000);await h.scheduler.restoreAppSchedules();
  assert.equal(h.states.get('one').planState,'scheduled');assert.equal(h.states.get('one').lastError,'');
  __resetTodoReminderSchedulerForTest(h.scheduler);
});

test('App 手动重试排程失败：保留原未知状态与可见重试入口',async()=>{
  const item=todo();const h=harness({event:item,state:{key:todoReminderKey(item),status:'notification-unknown',notificationState:'unknown',lastError:'上次通知超时'}});
  h.ctx.tasks.schedule=async()=>{throw new Error('APP_CAPABILITY_DENIED');};await h.scheduler.registerAppTaskHandler();
  await assert.rejects(h.scheduler.retryNotification(item));assert.equal(h.states.get('one').status,'notification-unknown');assert.ok(h.states.get('one').lastError);
  __resetTodoReminderSchedulerForTest(h.scheduler);
});

test('App 排程超时：原请求未结算不重复创建，迟到成功后先对账找到唯一计划',async t=>{
  const h=harness({event:todo('one','11:00')});let finish,attempts=0;const gate=new Promise(r=>{finish=r;});const original=h.ctx.tasks.schedule;
  h.ctx.tasks.schedule=async value=>{attempts++;await gate;return original(value);};await h.scheduler.registerAppTaskHandler();
  t.mock.timers.enable({apis:['setTimeout']});const creating=h.scheduler.eventChanged(h.events.get('one'));const rejected=assert.rejects(creating);
  await new Promise(r=>setImmediate(r));t.mock.timers.tick(8001);await rejected;
  assert.equal(h.states.get('one').planState,'unknown');await assert.rejects(h.scheduler.eventChanged(h.events.get('one')));assert.equal(attempts,1);
  await assert.rejects(h.scheduler.retryNotification(h.events.get('one')));assert.equal(h.states.get('one').planState,'unknown','手动重试也不能丢掉尚未确认的原安排');
  finish();await new Promise(r=>setImmediate(r));await h.scheduler.eventChanged(h.events.get('one'));
  assert.equal(attempts,1);assert.equal(h.records.length,1);assert.equal(h.states.get('one').planState,'scheduled');
  __resetTodoReminderSchedulerForTest(h.scheduler);
});

test('App SDK通知正文遵守4096字节上限，中文表情安全截断且原记录不裁',async()=>{
  const item={...todo(),title:'🧁中'.repeat(3000)};const h=harness({event:item});await h.scheduler.registerAppTaskHandler();await h.handler.run({input:h.input()});
  assert.ok(Buffer.byteLength(h.calls.notifications[0].body,'utf8')<=4096);assert.ok(Buffer.byteLength(h.calls.notifications[0].title,'utf8')<=256);
  assert.equal(h.events.get('one').title,item.title);assert.equal(h.states.get('one').status,'delivered');__resetTodoReminderSchedulerForTest(h.scheduler);
});

test('App 宿主回调先于排程回包：不得用旧pending覆盖已确认通知',async()=>{
  const h=harness();const original=h.ctx.tasks.schedule;
  h.ctx.tasks.schedule=async value=>{const result=await original(value);if(h.calls.schedule.length===1){h.advance(value.runAt-clock()+10);await h.handler.run({input:value.payload});result.enabled=false;}return result;};
  await h.scheduler.registerAppTaskHandler();await h.scheduler.eventChanged(h.events.get('one'));
  assert.equal(h.states.get('one').status,'delivered');assert.equal(h.states.get('one').notificationState,'confirmed');
  await h.handler.run({input:h.input()});assert.equal(h.calls.notifications.length,1);
  h.events.set('one',todo('one','11:00'));await h.scheduler.eventChanged(h.events.get('one'));
  assert.equal(h.calls.schedule.length,2,'旧once已终态，新的时间必须建立新计划');assert.equal(h.calls.update.length,0);
  __resetTodoReminderSchedulerForTest(h.scheduler);
});

test('App 旧安排尚未结算时改时间：新key保持可见等待，迟到后只更新同一计划',async t=>{
  const h=harness({event:todo('one','11:00')});let finish;const gate=new Promise(r=>{finish=r;});const original=h.ctx.tasks.schedule;
  h.ctx.tasks.schedule=async value=>{await gate;return original(value);};await h.scheduler.registerAppTaskHandler();t.mock.timers.enable({apis:['setTimeout']});
  const rejected=assert.rejects(h.scheduler.eventChanged(h.events.get('one')));await new Promise(r=>setImmediate(r));t.mock.timers.tick(8001);await rejected;
  h.events.set('one',todo('one','12:00'));await assert.rejects(h.scheduler.eventChanged(h.events.get('one')));
  assert.equal(h.states.get('one').key,todoReminderKey(h.events.get('one')));assert.equal(h.states.get('one').planState,'waiting');assert.ok(h.states.get('one').lastError);
  finish();await new Promise(r=>setImmediate(r));h.advance(61_000);await h.scheduler.restoreAppSchedules();
  assert.equal(h.calls.schedule.length,1);assert.equal(h.calls.update.length,1);assert.equal(h.states.get('one').planState,'scheduled');
  __resetTodoReminderSchedulerForTest(h.scheduler);
});

test('App 超时安排后的删除：报告清理尚未确认，迟到计划在恢复时撤掉不复活记录',async t=>{
  const h=harness({event:todo('one','11:00')});let finish;const gate=new Promise(r=>{finish=r;});const original=h.ctx.tasks.schedule;
  h.ctx.tasks.schedule=async value=>{await gate;return original(value);};await h.scheduler.registerAppTaskHandler();t.mock.timers.enable({apis:['setTimeout']});
  const rejected=assert.rejects(h.scheduler.eventChanged(h.events.get('one')));await new Promise(r=>setImmediate(r));t.mock.timers.tick(8001);await rejected;
  h.events.delete('one');h.states.delete('one');await assert.rejects(h.scheduler.eventChanged(null,'one'),/尚未确认/);
  finish();await new Promise(r=>setImmediate(r));await h.scheduler.restoreAppSchedules();
  assert.deepEqual(h.calls.unschedule,['schedule-1']);assert.equal(h.states.has('one'),false);assert.equal(h.calls.notifications.length,0);
  __resetTodoReminderSchedulerForTest(h.scheduler);
});

test('App 单条sending恢复落盘失败不阻塞其他有效提醒对账',async()=>{
  const item=todo();const h=harness({event:item,state:{key:todoReminderKey(item),status:'sending',notificationState:'sending'}});
  h.events.set('two',todo('two','12:00'));const save=h.data.saveTodoReminder;
  h.data.saveTodoReminder=async(id,value)=>{if(id==='one')throw new Error('单条写入失败');return save(id,value);};
  await h.scheduler.registerAppTaskHandler();await h.scheduler.restoreAppSchedules();
  assert.equal(h.calls.schedule.length,1);assert.equal(h.calls.schedule[0].payload.eventId,'two');assert.equal(h.calls.notifications.length,0);
  __resetTodoReminderSchedulerForTest(h.scheduler);
});

test('页面与工具获取主入口同一调度实例',()=>{
  const h=harness();setTodoReminderScheduler(h.scheduler);assert.equal(getTodoReminderScheduler(),h.scheduler);
  __resetTodoReminderSchedulerForTest(h.scheduler);assert.equal(getTodoReminderScheduler(),null);
});
