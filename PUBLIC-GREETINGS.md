# 拾光记 · 对外契约 `greetings`（节日问候完成台账）

回答一个问题：**某位伙伴在某一天，有没有把当天那个重大节日的问候真正说出口。**

- 发布方：拾光记（`shiguangji-app`），经 `ctx.publicData.publish` 发布给获授权的消费方。
- key：`greetings`，与 `today` 同一条发布通道，两个 key 各自判重，互不覆盖。
- 授权：`app/public-data.publish`（manifest 已声明，不用改版本号）。
- 契约文档：`greetings` 这一份写在这里；`today` 那份的文档在发布它的宿主侧，本仓库没有 `PUBLIC-TODAY.md`。
- 消费方示例：闲不住。

## 格式

```json
{
  "schemaVersion": 1,
  "updatedAt": "2026-10-25T09:12:00+08:00",
  "entries": [
    {
      "agentId": "hanako",
      "date": "2026-10-25",
      "festival": "重阳节",
      "completedAt": "2026-10-25T09:10:00+08:00"
    }
  ]
}
```

| 字段 | 类型 | 含义 |
| --- | --- | --- |
| `schemaVersion` | number | 恒为 `1`。字段含义变了会涨版本，消费方按版本读。 |
| `updatedAt` | string | 这份契约组装时的本地时刻，带时区偏移的 ISO 串。 |
| `entries` | array | 已完成的节日问候记录，按 `date` 倒序、同日按 `completedAt` 倒序。 |
| `entries[].agentId` | string | 伙伴身份，取自会话上下文（`resolveAgentId`）。**判不出就不写这一条**，绝不会出现空串或 `unknown`。 |
| `entries[].date` | string | 完成日期 `YYYY-MM-DD`（本地日历日）。同一天同一个节日只记一条；跨天由这个字段区分，是另一条。 |
| `entries[].festival` | string | 节日名，与 `lib/festivals.js` 的 `name` 一致（如「重阳节」）。 |
| `entries[].completedAt` | string | 真正确认说出口的时刻，带时区偏移的 ISO 串。 |

## 规则

1. **一条 entry = 一位伙伴在一个日期完成了一个节日的问候。**
2. **只保留最近 7 天**（含今天）。消费方只关心今天，窗口外的记录在这一层就不摊出来。
3. **判定口径不重写**：是否真的问候过，沿用 `lib/festival-hints.js` 的 `didMentionFestival`——
   只认助手可见正文，`<mood>` 思考块会被剥掉不算数；关键词表也只有那一份。
4. **失败静默降级**：没有 `publicData` 通道、发布被拒、台账读不出来，一律不抛，
   既不影响 App 启动，也不影响对话注入；下一轮刷新还会再试。

## 去抖与刷新

- 问候确认完成时写入台账，并排一次 2 秒去抖发布；短时间内的多次确认合成一次发布。
- App 启动时强制发一份，之后由「数据变动 / 每分钟定时」按内容指纹补发：内容没变就不重复发。
- 宿主那边撤权清掉快照后，即使内容没变也会补发回来。

## 本地存储

台账落在数据目录下的加密存储 `festival-greetings.dat`（与 injection state 同级，走 `EncryptedStore`，
AES-256-GCM），不是明文文件。内部字段 `ts`（毫秒时间戳）只用于排序，对外摊的是 `completedAt` 字符串。