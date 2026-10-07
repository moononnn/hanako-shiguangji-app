// 拾光记 · Hana 用户称呼读取
// 每次读取 users.json，不缓存，让 Hana 配置里的显示名修改后能自然生效。

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const HANA_HOME = process.env.HANA_HOME || path.join(os.homedir(), ".hanako");

// App 版缓存：由 resolveHanaUserName（走宿主资源接口）写入。
// 放在顶部是为了让同步的 readHanaUserName 也能吃到，不必把调用点全改成异步。
let hostUserNameCache = null; // null = 还没读；"" = 读过了但没读到
let hostUserNameReading = null;

export function parseUserNames(json) {
  try {
    const data = JSON.parse(json);
    if (!data || typeof data !== "object") return { displayName: "", username: "" };
    const profile = Array.isArray(data.users)
      ? (data.users.find((user) => user?.userId === data.defaultUserId) || data.users[0] || {})
      : data;
    return {
      displayName: typeof profile.displayName === "string" ? profile.displayName.trim() : "",
      username: typeof profile.username === "string" ? profile.username.trim() : "",
    };
  } catch {
    return { displayName: "", username: "" };
  }
}

export function readHanaUserName(hanaHome = HANA_HOME) {
  // App 环境已经通过宿主接口读过一次（见 resolveHanaUserName），直接吃缓存。
  if (hostUserNameCache) return hostUserNameCache;
  try {
    const usersPath = path.join(hanaHome, "users.json");
    if (!fs.existsSync(usersPath)) return "";
    const { displayName, username } = parseUserNames(fs.readFileSync(usersPath, "utf-8"));
    return (displayName || username || "").replace(/\s+/g, " ").slice(0, 80);
  } catch {
    return "";
  }
}

// ── App 版：走宿主的资源接口读名字 ──
// App 沙箱里不能直接用 fs 碰 Hana 家目录（existsSync 会抛错而不是返回 false），
// 所以这里走 ctx.resources.read。读一次就缓存：做册、注入会反复要名字，
// 不该每次都打一遭宿主；用户在 Hana 里改了显示名，重启应用即生效。
const HOST_NAME_KEYS = ["displayName", "username", "name"];

// ── 持久化：读不到时沿用上次的名字 ──
// 一般用户不会天天改名，所以「读到就存、读不到就用存的」，比每次退化成「对方」稳：
// 接口偶发失败、权限临时没开，也不会把已经收好的册子里的称呼打回原点。
// 存在自己数据目录，不碰盘外；空名字绝不覆盖已存的好名字。
let userNameStoreDir = "";

export function configureUserNameStore(dataDir) {
  userNameStoreDir = String(dataDir || "");
}

function storedUserNamePath() {
  return userNameStoreDir ? path.join(userNameStoreDir, "display-name.json") : "";
}

function readStoredUserName() {
  try {
    const file = storedUserNamePath();
    if (!file || !fs.existsSync(file)) return "";
    const data = JSON.parse(fs.readFileSync(file, "utf-8"));
    return String(data?.name ?? "").trim().slice(0, 80);
  } catch {
    return "";
  }
}

function writeStoredUserName(name) {
  try {
    const file = storedUserNamePath();
    const text = String(name ?? "").trim().slice(0, 80);
    if (!file || !text) return;
    if (readStoredUserName() === text) return;
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify({ name: text, savedAt: new Date().toISOString() }, null, 2), "utf-8");
  } catch {
    /* 存不下不影响这一轮 */
  }
}

function pickNameFromUsers(json) {
  try {
    const data = JSON.parse(json);
    const users = Array.isArray(data?.users) ? data.users : [];
    if (!users.length) return "";
    const wanted = String(data?.defaultUserId ?? "");
    const picked = wanted ? users.find((row) => String(row?.userId ?? "") === wanted) : null;
    const row = picked ?? users[0];
    for (const key of HOST_NAME_KEYS) {
      const text = String(row?.[key] ?? "").trim();
      if (text) return text;
    }
    return "";
  } catch {
    return "";
  }
}

function pickNameFromPreferences(json) {
  try {
    return String(JSON.parse(json)?.userName ?? "").trim();
  } catch {
    return "";
  }
}

async function readHostText(ctx, relPath) {
  try {
    const result = await ctx?.resources?.read?.({ kind: "local-file", path: relPath });
    const content = result?.content;
    if (typeof content === "string") return content;
    if (content) return Buffer.from(content).toString("utf8");
    return "";
  } catch {
    return "";
  }
}

/** App 环境用：异步拿用户名；拿不到返回空串，由调用方决定退化成什么。 */
export async function resolveHanaUserName(ctx, hanaHome = "") {
  if (hostUserNameCache !== null) return hostUserNameCache;
  if (hostUserNameReading) return hostUserNameReading;
  hostUserNameReading = (async () => {
    // 家目录多路试：App 里 env 不一定给正确值，实在不行就用启动目录往上推。
    const homes = [];
    if (hanaHome) homes.push(hanaHome);
    if (process.env.HANA_HOME) homes.push(process.env.HANA_HOME);
    try {
      homes.push(path.resolve(process.cwd(), "..", ".."));
    } catch {
      /* 忽略 */
    }
    try {
      homes.push(path.join(os.homedir(), ".hanako"));
    } catch {
      /* 忽略 */
    }
    for (const home of [...new Set(homes.filter(Boolean))]) {
      let name = pickNameFromUsers(await readHostText(ctx, path.join(home, "users.json")));
      if (!name) {
        name = pickNameFromPreferences(await readHostText(ctx, path.join(home, "user", "preferences.json")));
      }
      if (name) {
        hostUserNameCache = name.replace(/\s+/g, " ").slice(0, 80);
        // 读到就存下来：下次万一读不到，也不至于把称呼打回「对方」。
        writeStoredUserName(hostUserNameCache);
        hostUserNameReading = null;
        return hostUserNameCache;
      }
    }
    // 一个候选都没读到：沿用上次存下来的名字（一般用户不会总改名）。
    hostUserNameCache = readStoredUserName();
    hostUserNameReading = null;
    return hostUserNameCache;
  })();
  return hostUserNameReading;
}

/** 测试用：清掉缓存，让下一次重新读。 */
export function resetHanaUserNameCache() {
  hostUserNameCache = null;
  hostUserNameReading = null;
}
