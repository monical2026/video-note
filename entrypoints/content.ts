import { extractCaptionTracks, extractVideoMeta } from '../src/adapters/youtube';
import type { Msg } from '../src/messaging/protocol';

export default defineContentScript({
  matches: ['https://www.youtube.com/*'],
  runAt: 'document_idle',
  main() {
    let lastVideoId = '';
    let lastTimeSent = -1;

    async function onPageChange() {
      // 仅 watch 页处理；SPA 导航后重新 fetch 当前 HTML 提取（页面源里始终有 ytInitialPlayerResponse）
      if (!location.pathname.startsWith('/watch')) return;
      try {
        const html = await fetch(location.href).then((r) => r.text());
        const meta = extractVideoMeta(html, location.href);
        if (!meta.videoId || meta.videoId === lastVideoId) return;
        lastVideoId = meta.videoId;
        const tracks = extractCaptionTracks(html);
        browser.runtime.sendMessage({ type: 'PAGE_INFO', tracks, meta } satisfies Msg).catch(() => {});
      } catch { /* 页面未就绪，导航事件后重试 */ setTimeout(onPageChange, 1500); }
    }

    // 播放进度：500ms 节流广播
    setInterval(() => {
      const v = document.querySelector('video');
      if (!v) return;
      const t = Math.floor(v.currentTime);
      if (t !== lastTimeSent) { lastTimeSent = t; browser.runtime.sendMessage({ type: 'PLAYBACK', t } satisfies Msg).catch(() => {}); }
    }, 500);

    // 接收指令：SEEK / CAPTURE_NOW
    browser.runtime.onMessage.addListener((msg: Msg) => {
      const v = document.querySelector('video');
      if (msg.type === 'SEEK' && v) v.currentTime = msg.t;
      if (msg.type === 'CAPTURE_NOW' && v) {
        const t = v.currentTime;
        // 摘录当前句前后 ±1 句：由 background 持有字幕，这里只报时间，面板负责组稿
        browser.runtime.sendMessage({ type: 'OPEN_NOTE_EDITOR', start: t - 5, end: t + 5, excerpt: '' } satisfies Msg).catch(() => {});
      }
      // 面板重试：重置去重标记后重新抓取当前页
      if (msg.type === 'RETRY_TRANSCRIPT') { lastVideoId = ''; onPageChange(); }
    });

    // SPA 导航监听 + 首次进入
    window.addEventListener('yt-navigate-finish', onPageChange);
    onPageChange();
  },
});
