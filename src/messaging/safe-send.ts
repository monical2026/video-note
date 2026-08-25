import type { Msg } from './protocol';

/**
 * content script → background 发消息的安全包装。
 * 扩展在 chrome://extensions 重载后，残留在已打开页面里的旧 content script 上下文失效，
 * browser.runtime.sendMessage 会当场同步抛 "Extension context invalidated."——
 * .catch 只接得住异步拒绝、接不住这种同步抛错，每 500ms 心跳就往扩展卡片刷一条 uncaught 错误。
 * 这里同步 try/catch + 异步拒绝都兜住：孤儿脚本静默退出，不再污染错误面板。
 */
export function safeSend(msg: Msg): void {
  try {
    browser.runtime.sendMessage(msg).catch(() => {});
  } catch { /* 上下文已失效：孤儿脚本静默退出 */ }
}
