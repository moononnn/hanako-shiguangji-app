// 拾光记 · 进程内共享数据实例
// routes、before_agent_start 扩展和工具必须共用同一个 UserData，避免设置/天气/总结更新后各自继续读旧缓存。
// 延迟创建是为了让只加载工具模块的测试/宿主探测不提前创建用户数据密钥。

import os from "node:os";
import path from "node:path";
import { UserData } from "./data.js";

// ⚠️ 已知遗留（未修）：这里的无参兜底还是插件时代的 plugin-data/shiguangji。
// 运行时 index.js / routes / inject 都会先 configure(ctx.dataDir)，正常路径走不到；
// 但若将来出现 configure 之前的无参调用，用户数据会被建到旧插件目录去。
// 要迁到 app-data/shiguangji-app 得连测试口径一起改（routes.test.js 里 5 处仍按旧路径构造 ctx.dataDir），另行立项。
const DEFAULT_DATA_DIR = path.join(
  process.env.HANA_HOME || path.join(os.homedir(), ".hanako"),
  "plugin-data",
  "shiguangji",
);
let sharedUserData = null;
let sharedDataDir = null;

function normalizeDataDir(dataDir) {
  if (typeof dataDir !== "string" || !dataDir.trim()) return null;
  return path.resolve(dataDir);
}

export function getSharedUserData(dataDir = null) {
  const requestedDir = normalizeDataDir(dataDir);
  if (requestedDir && requestedDir !== sharedDataDir) {
    sharedDataDir = requestedDir;
    sharedUserData = new UserData(requestedDir);
  }
  if (!sharedUserData) {
    sharedDataDir = requestedDir || DEFAULT_DATA_DIR;
    sharedUserData = new UserData(sharedDataDir);
  }
  return sharedUserData;
}

// 路由注册阶段优先接入宿主提供的数据目录；旧宿主没有传入时保留默认路径。
export function configureSharedUserData(dataDir) {
  const requestedDir = normalizeDataDir(dataDir);
  return requestedDir ? getSharedUserData(requestedDir) : sharedUserData;
}

// 仅供自动测试替换为临时数据实例；生产代码不调用。
export function __setSharedUserDataForTest(data) {
  sharedUserData = data || null;
  sharedDataDir = normalizeDataDir(data?.dataDir);
}
