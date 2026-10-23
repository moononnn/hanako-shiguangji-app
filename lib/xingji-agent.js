// 拾光记 · 拾性：读伙伴自己的性格设定，只当「已经写过什么」的排除清单。
// 为什么单独一个文件：lib/day-summary.js 有一条明确边界——只读公开显示名，不碰 identity/ishiki。
// 拾性需要读到设定本身才能判断「这条算不算新发现」，所以单独放开，且只给拾性用，
// 不改变做册总结原来的读取边界。
// 两个约定：
// 1. 只读不写。任何情况下都不改写伙伴的性格文件。
// 2. 只取开头一段做排除清单，不把全文塞进模型。

import fs from "node:fs";
import path from "node:path";

// 只取开头，够判断「设定里写过没有」就行；太长会把注意力从当天的观察上带走。
const MAX_BASELINE_CHARS = 2400;

const PERSONA_FILES = ["identity.md", "ishiki.md"];

function stripMarkdown(text) {
  return String(text || "")
    .replace(/^---[\s\S]*?---\s*/m, "") // 去掉 frontmatter
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/^\s{0,3}#{1,6}\s*/gm, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * 读某个伙伴的性格设定文本。
 * 返回 { text, files }；text 可能为空字符串（没装、无权限、文件不存在），调用方按「没有排除清单」处理。
 */
export function readAgentPersonaBaseline(agentsDir, agentId) {
  const id = String(agentId || "").trim();
  const dir = String(agentsDir || "").trim();
  if (!id || !dir || /[\\/]/.test(id)) return { text: "", files: [] };
  const files = [];
  const parts = [];
  for (const name of PERSONA_FILES) {
    try {
      const raw = fs.readFileSync(path.join(dir, id, name), "utf-8");
      const text = stripMarkdown(raw);
      if (!text) continue;
      files.push(name);
      parts.push(`${name === "identity.md" ? "性格设定" : "行事准则"}：${text}`);
    } catch {
      // 文件不存在或读不到就跳过，不需要报错：没有设定也要能观察。
    }
  }
  const joined = parts.join("\n");
  return { text: joined.slice(0, MAX_BASELINE_CHARS), files };
}
