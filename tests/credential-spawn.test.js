import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const appRoot = new URL("../", import.meta.url);
const read = (rel) => fs.readFileSync(new URL(rel, appRoot), "utf8");

test("宿主契约：自定义 API Key 走 DPAPI，就必须声明 app/process.spawn", () => {
  const manifest = JSON.parse(read("manifest.json"));
  const crypto = read("lib/model-config/core/crypto.js");

  // model-config 的 Key 存储靠 spawn PowerShell 调 Windows DPAPI。
  // 宿主默认不给 --allow-child-process，只有授权 app/process.spawn 才开；
  // 没声明时 spawn 会被拒，异常被吞掉，Key 静默落成明文。
  assert.ok(
    crypto.includes("node:child_process"),
    "crypto.js 不再用子进程时，这条契约要跟着改；现在是靠它调 DPAPI",
  );
  assert.ok(
    manifest.capabilities.includes("app/process.spawn"),
    "manifest 缺少 app/process.spawn：Windows 上 DPAPI 起不来，Key 会退化成明文落盘",
  );
});

test("用户可见文案：明文保存不能声称会自动转加密", () => {
  const template = read("lib/page-template.js");
  // 「Windows 下会自动转系统加密」在缺权限（或 DPAPI 不可用）时是假话，
  // 会让人以为 Key 已经受保护。明文就说明文。
  assert.ok(
    !template.includes("Windows 下会自动转系统加密"),
    "Key 明文提示里不能再写「Windows 下会自动转系统加密」",
  );
  assert.ok(
    template.includes("未启用系统加密"),
    "明文保存要有诚实的提示文案",
  );
});

test("用户可见文案：注入预览的关闭提示叫「伙伴」不叫「助手」", () => {
  const routes = read("routes/ui.js");
  // 这行是直接回给页面展示的，不是注释。应用里 74 处都叫「伙伴」，
  // 只在这里冒出「助手」，用户点预览会看到两套称呼。
  assert.ok(
    !routes.includes("助手当前收不到今日时光"),
    "注入预览的关闭提示还写着「助手」，应统一成「伙伴」",
  );
  assert.ok(
    routes.includes("伙伴当前收不到今日时光"),
    "注入预览的关闭提示应保留人话版本，只换称呼",
  );
});
