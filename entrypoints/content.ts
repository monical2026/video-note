import { extractCaptionTracks, extractVideoMeta, fetchCueTrack, type CaptionTrack } from '../src/adapters/youtube';
import { parseJson3, parseTimedtextXml } from '../src/adapters/timedtext';
import type { Cue } from '../src/types';
import type { Msg } from '../src/messaging/protocol';

export default defineContentScript({
  matches: ['https://www.youtube.com/*'],
  runAt: 'document_idle',
  main() {
    let lastVideoId = '';
    let lastTimeSent = -1;

    /** 用捕获到的带 pot 的 timedtext URL 在页面上下文抓完整字幕：json3 优先，XML 兜底 */
    async function fetchCapturedUrl(url: string): Promise<Cue[]> {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`timedtext ${res.status}`);
      // 捕获 URL 可能已是 json3 也可能是 XML；两种格式都试
      try {
        const cues = parseJson3(await res.clone().json());
        if (cues.length) return cues;
      } catch { /* 非 JSON，走 XML 解析 */ }
      return parseTimedtextXml(await res.text());
    }

    /**
     * 播放器捕获降级：让播放器自己加载字幕轨（其 timedtext 请求带有效 pot），
     * 用 PerformanceObserver 捕获该请求 URL 后再 fetch 完整字幕。
     */
    function captureViaPlayer(tracks: CaptionTrack[]): Promise<Cue[]> {
      return new Promise<Cue[]>((resolve) => {
        let settled = false;
        const finish = (cues: Cue[]) => { if (!settled) { settled = true; clearTimeout(timer); resolve(cues); } };
        // 整体 10s 超时：超时即放弃，返回空数组（不 reject 中断流程）
        const timer = setTimeout(() => {
          console.info('[video-note]', 'capture', `timeout (${tracks.length} tracks), host=${location.host}`);
          finish([]);
        }, 10_000);
        try {
          const obs = new PerformanceObserver((list) => {
            for (const e of list.getEntries() as PerformanceResourceTiming[]) {
              if (!e.name.includes('/api/timedtext')) continue;
              console.info('[video-note]', 'capture', `hit, host=${new URL(e.name).host}, len=${e.name.length}`);
              obs.disconnect();
              // 命中后用该 URL 在页面上下文 fetch 完整字幕
              fetchCapturedUrl(e.name).then((cues) => {
                console.info('[video-note]', 'capture', `fetched ${cues.length} cues`);
                if (cues.length) finish(cues);
                // 空结果不 settle：继续等可能的后续请求，直至超时
              }).catch(() => { /* 单次 fetch 失败继续等 */ });
            }
          });
          obs.observe({ entryTypes: ['resource'] });
          // 触发播放器加载字幕轨；任一调用可选链防崩，抛错则继续等观察者（播放器可能已预取）
          try {
            const player = document.getElementById('movie_player') as any;
            player?.loadModule?.('captions');
            const first = tracks[0];
            if (first) {
              player?.setOption?.('captions', 'track', { languageCode: first.lang, kind: first.kind || undefined });
            }
          } catch { /* 播放器 API 不可用，继续等观察者 */ }
        } catch {
          // PerformanceObserver 不可用：直接放弃（返回空，走 Supadata 兜底）
          console.info('[video-note]', 'capture', 'PerformanceObserver unavailable');
          finish([]);
        }
      });
    }

    /** 字幕取数总入口：a) SSR 直抓 → b) 播放器捕获 → c) 空数组（Supadata 兜底） */
    async function obtainCues(html: string): Promise<Cue[]> {
      const tracks = extractCaptionTracks(html);
      // a. SSR 直抓：手动轨优先 asr，逐轨尝试，取第一个非空（未来 YouTube 放宽 pot 校验时立即受益）
      const sorted = [...tracks].sort((a, b) => (a.kind === 'asr' ? 1 : 0) - (b.kind === 'asr' ? 1 : 0));
      for (const t of sorted) {
        try {
          const c = await fetchCueTrack(t.baseUrl);
          if (c.length) {
            console.info('[video-note]', 'ssr', `ok ${c.length} cues, lang=${t.lang}`);
            return c;
          }
        } catch { /* 尝试下一轨道 */ }
      }
      console.info('[video-note]', 'ssr', `empty (${sorted.length} tracks)`);
      // b. 播放器捕获降级
      const captured = await captureViaPlayer(tracks);
      if (captured.length) return captured;
      // c. 全失败 → 空数组，PAGE_INFO cues:[] 触发 Supadata 兜底链路
      return [];
    }

    async function onPageChange() {
      // 仅 watch 页处理；SPA 导航后重新 fetch 当前 HTML 提取（页面源里始终有 ytInitialPlayerResponse）
      if (!location.pathname.startsWith('/watch')) return;
      try {
        const html = await fetch(location.href).then((r) => r.text());
        const meta = extractVideoMeta(html, location.href);
        if (!meta.videoId || meta.videoId === lastVideoId) return;
        lastVideoId = meta.videoId;
        const cues = await obtainCues(html);
        browser.runtime.sendMessage({ type: 'PAGE_INFO', meta, cues } satisfies Msg).catch(() => {});
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
