// 拾光记 · 待办到点时的输入框提示条
//
// 系统通知飘一下就没了，人常常错过。宿主有一个挂得住的位置：会话输入框上方的提示条。
// 它不自动消失、只认手动关，而且跟着人走——在哪个会话说话，就挂到哪个框上面。
//
// 两条约束：
//   1. 挂载必须给 sessionPath，所以得知道她最近在哪个会话开口（订阅会话事件拿第二个参数）。
//   2. 每个 (会话, 应用) 同时只留一条：换会话先把旧的摘掉，再挂新的。

const BANNER_ID = "shiguangji-todo";
/** 多久没在会话里露面，就不再往那个窗口上硬塞 */
const ACTIVE_WINDOW_MS = 6 * 60 * 60 * 1000;

const state = { activeSessionPath: "", activeAt: 0, current: "" };

/** 她最近开口的会话。subscribe 的签名固定是 (event, sessionPath)，第二个参数就是它。 */
export function rememberActiveSession(sessionPath, now = Date.now()) {
  const value = String(sessionPath || "").trim();
  if (!value) return;
  state.activeSessionPath = value;
  const at = Number(now);
  state.activeAt = Number.isFinite(at) ? at : Date.now();
}

export function currentActiveSession(now = Date.now()) {
  if (!state.activeSessionPath) return "";
  const at = Number(state.activeAt) || 0;
  return now - at > ACTIVE_WINDOW_MS ? "" : state.activeSessionPath;
}

/** 横幅文案跟系统通知同源，免得两处各写一套。 */
export function todoBannerContent({ window: windowText = "", title = "", body = "" } = {}) {
  const lead = String(windowText || "").trim() || "到时间了";
  const name = String(title || "").trim() || "这件待办";
  const text = String(body || "").trim() || `${lead}：${name}`;
  return { text: text.slice(0, 200) };
}

/** 到点了：能挂就挂一条在她眼前的输入框上方；挂不上只返回原因，不影响系统通知那条路。 */
export function showTodoBanner(ctx, payload, { log = () => {}, now = Date.now() } = {}) {
  if (typeof ctx?.inputBanner?.set !== "function") return { ok: false, reason: "unsupported" };
  const sessionPath = currentActiveSession(now);
  if (!sessionPath) return { ok: false, reason: "no-active-session" };
  const content = todoBannerContent(payload);
  // 横幅全局只留一条：换窗口先把旧窗口那条摘掉
  if (state.current && state.current !== sessionPath) dismissTodoBanner(ctx);
  try {
    // 只放一句话提醒她，不带按钮：提醒的东西不该反过来要她先点一下。
    ctx.inputBanner.set({
      sessionPath,
      bannerId: BANNER_ID,
      text: content.text,
    });
  } catch (error) {
    log(`待办横幅没挂上：${error?.message || error}`);
    return { ok: false, reason: "set-failed" };
  }
  state.current = sessionPath;
  return { ok: true, sessionPath };
}

export function dismissTodoBanner(ctx) {
  const sessionPath = state.current;
  state.current = "";
  if (!sessionPath || typeof ctx?.inputBanner?.dismiss !== "function") return;
  try { ctx.inputBanner.dismiss({ sessionPath, bannerId: BANNER_ID }); } catch { /* 摘不掉不影响别的路 */ }
}

/** 测试用：清掉内存里的记录。 */
export function __resetTodoBanner() {
  state.activeSessionPath = "";
  state.activeAt = 0;
  state.current = "";
}
