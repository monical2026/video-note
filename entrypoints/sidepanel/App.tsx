import { useEffect, useRef, useState } from 'preact/hooks';
import { activeTab, cues, currentTime, displayMode, loadVideoData, noteEditorCtx, notes, refreshSettings, sendMsg, settings, summary, transcriptError, videoInfo } from './state';
import type { Theme } from '../../src/types';
import { TranscriptView } from './TranscriptView';
import { NotesView } from './NotesView';
import { SummaryView } from './SummaryView';
import { LibraryView } from './LibraryView';
import { SettingsView } from './SettingsView';
import { NoteEditor } from './NoteEditor';
import { ExportDialog } from './ExportDialog';

const TABS = [
  ['transcript', '逐字稿'], ['notes', '笔记'], ['summary', 'AI 摘要'], ['library', '📚'], ['settings', '⚙️'],
] as const;

export function App() {
  const [translating, setTranslating] = useState(false);
  const [translateError, setTranslateError] = useState('');
  const [exportOpen, setExportOpen] = useState(false);
  const [fetchTimedOut, setFetchTimedOut] = useState(false);
  const autoTranslatedFor = useRef(''); // 已自动翻译过的 videoId，防止重复触发
  const tabRestored = useRef(false);    // 上次 Tab 恢复完成前禁止回写（防读写竞争覆盖）
  const lastWorkTab = useRef<typeof activeTab.value>('transcript'); // 进入设置页前的工作 Tab（保存后跳回）

  const triggerTranslate = async (videoId: string, force = false) => {
    if (!videoId || translating) return;
    setTranslating(true); setTranslateError('');
    if (force) {
      // 全量重翻：先把界面里的旧译文清掉，进度显示才真实（库里由 force 语义重写）
      cues.value = cues.value.map((c) => ({ ...c, zh: undefined }));
    }
    try {
      await sendMsg({ type: 'TRANSLATE', videoId, force });
      await loadVideoData(videoId);
    } catch (e) {
      // 失败必须可见（此前静默吞掉，用户只见"没反应"）
      setTranslateError(e instanceof Error ? e.message : String(e));
    } finally { setTranslating(false); }
  };

  /**
   * 视频切换统一入口（2026-09 用户需求）：切换瞬间立即亮新标题进「正在获取字幕…」态，
   * 再库读——已抓取过的视频秒显库存数据（不重抓）；未抓取的等 PAGE_INFO（SPA 链）或主动触发抓取（标签页链）。
   */
  const handleVideoSwitch = async (meta: { videoId: string; title: string; channel: string }, autoFetch = false) => {
    if (meta.title) {
      // 先亮新标题（SPA 链带 title；标签页链 title 空，loadVideoData 会带出库里的完整信息）
      videoInfo.value = { ...meta, url: `https://www.youtube.com/watch?v=${meta.videoId}`, captionLang: 'en', fetchedAt: Date.now() };
    }
    cues.value = [];                      // 进加载态（已抓/未抓都先显示获取中，库读命中立即替换）
    await loadVideoData(meta.videoId);
    if (autoFetch && !cues.value.length) sendMsg({ type: 'RETRY_TRANSCRIPT' });   // 未抓取：active tab 自动抓
  };

  // 主题应用：html data-theme 驱动三套 CSS token（light/dark/amber）；设置加载/保存后即时切换。
  // settings signal 初始为 null，加载完成时本 effect 必然触发，无需单独的 mount 拉取
  const applyTheme = (t: Theme) => {
    document.documentElement.setAttribute('data-theme', t);
    // 同步写 localStorage 镜像：下次面板打开由 main.tsx 在首绘前读取，消除主题闪切（FOUC）
    try { localStorage.setItem('vn-theme', t); } catch { /* 存储不可用仅影响下次首绘，静默 */ }
  };
  useEffect(() => { if (settings.value) applyTheme(settings.value.theme); }, [settings.value?.theme]);

  useEffect(() => {
    refreshSettings();
    // 记住上次的 Tab：面板关闭重开后回到原处（而非默认「逐字稿」）
    browser.storage.local.get('lastTab').then((r: any) => {
      const v = r?.lastTab as typeof activeTab.value | undefined;
      if (v && TABS.some(([id]) => id === v)) activeTab.value = v;
    }).catch(() => {}).finally(() => { tabRestored.current = true; });
    // 找当前 YouTube 标签页拿 videoId
    browser.tabs.query({ active: true, currentWindow: true }).then(async ([tab]) => {
      const m = tab?.url?.match(/[?&]v=([\w-]{11})/);
      const videoId = m?.[1];
      if (videoId) await loadVideoData(videoId);
    });
    const listener = (msg: any, sender: any) => {
      if (msg.type === 'PLAYBACK') currentTime.value = msg.t;
      if (msg.type === 'OPEN_NOTE_EDITOR') noteEditorCtx.value = msg;
      if (msg.type === 'TRANSCRIPT_FAILED') transcriptError.value = msg.reason;
      // SPA 导航瞬间通知（content 经 background 转发）：立即切换——亮新标题+加载态，已抓过的库读秒切
      if (msg.type === 'VIDEO_CHANGED' && !sender?.tab) {
        transcriptError.value = '';
        if (msg.meta.videoId !== videoInfo.value?.videoId) handleVideoSwitch(msg.meta);
      }
      // 仅接受 background 处理完成后的广播（sender 无 tab）；忽略 content script 发来的原始未处理消息
      if (msg.type === 'PAGE_INFO' && !sender?.tab) {
        transcriptError.value = ''; loadVideoData(msg.meta.videoId);
      }
    };
    browser.runtime.onMessage.addListener(listener);
    // 多标签页切换跟随：激活的标签页是另一个 YouTube 视频时立即切换（已抓取秒显；未抓取自动触发抓取）
    const onTabActivated = ({ tabId }: any) => {
      browser.tabs.get(tabId).then((tab: any) => {
        const m = (tab?.url ?? '').match(/[?&]v=([\w-]{11})/);
        if (!m || m[1] === videoInfo.value?.videoId) return;
        handleVideoSwitch({ videoId: m[1]!, title: '', channel: '' }, true);
      }).catch(() => {});
    };
    browser.tabs.onActivated?.addListener?.(onTabActivated);
    return () => {
      browser.runtime.onMessage.removeListener(listener);
      browser.tabs.onActivated?.removeListener?.(onTabActivated);
    };
  }, []);

  // Tab 切换持久化：恢复完成前不回写——否则挂载瞬间 subscribe 的立即回调（值为默认 transcript）
  // 可能在恢复读取之前落库，把存储里的上次 Tab 覆盖掉（真机 IPC 时序不定，读/写竞争）
  useEffect(() => activeTab.subscribe((v) => {
    if (v !== 'settings') lastWorkTab.current = v; // 设置页是临时跳出改配置，记最近的工作现场
    if (tabRestored.current) browser.storage.local.set({ lastTab: v }).catch(() => {});
  }), []);

  // 抓取超时：cues 为空先显示「正在获取字幕…」，12s 仍无结果/无失败广播才切换为空态
  const cuesLen = cues.value.length;
  const curVideoId0 = videoInfo.value?.videoId ?? '';
  useEffect(() => {
    setFetchTimedOut(false);
    if (cuesLen) return;
    const t = setTimeout(() => setFetchTimedOut(true), 12_000);
    return () => clearTimeout(t);
  }, [cuesLen, curVideoId0]);

  // 免费通道自动翻译：cues 非空且全部无译文时，每个视频自动触发一次
  const pendingCount = cues.value.filter((c) => !c.zh).length;
  const total = cues.value.length;
  const done = total - pendingCount;
  const currentVideoId = videoInfo.value?.videoId ?? '';

  // 翻译进度轮询：翻译中每 3s 刷新已翻数量；pending 清零或 5 分钟自动停；卸载即清
  useEffect(() => {
    if (!translating || !currentVideoId) return;
    const startAt = Date.now();
    const timer = setInterval(async () => {
      if (Date.now() - startAt > 5 * 60 * 1000) { clearInterval(timer); return; }
      await loadVideoData(currentVideoId);
      if (cues.value.every((c) => c.zh)) clearInterval(timer);
    }, 3000);
    return () => clearInterval(timer);
  }, [translating, currentVideoId]);

  useEffect(() => {
    if (
      !translating && currentVideoId && autoTranslatedFor.current !== currentVideoId &&
      cues.value.length && pendingCount === cues.value.length &&
      settings.value && settings.value.translateChannel === 'free'
    ) {
      autoTranslatedFor.current = currentVideoId;
      triggerTranslate(currentVideoId);
    }
  }, [currentVideoId, pendingCount, translating, settings.value]);

  // 无字幕视频的笔记入口：以当前播放位置为窗口打开编辑器（excerpt 为空合法）
  const noteHere = () => {
    noteEditorCtx.value = { start: currentTime.value - 5, end: currentTime.value + 5, excerpt: '' };
  };

  const tab = activeTab.value;
  return (
    <div class="app">
      <header>
        <nav>
          {TABS.map(([id, label]) => (
            <button key={id} class={tab === id ? 'on' : ''} onClick={() => (activeTab.value = id)}>{label}</button>
          ))}
        </nav>
      </header>
      <main>
        {videoInfo.value && <h1 class="video-title">{videoInfo.value.title}</h1>}
        {tab === 'transcript' && transcriptError.value && (
          <div class="err">
            <span>字幕获取失败：{transcriptError.value}</span>
            <button onClick={() => { transcriptError.value = ''; sendMsg({ type: 'RETRY_TRANSCRIPT' }); }}>重试</button>
          </div>
        )}
        {tab === 'transcript' && (
          <div class="mode-switch" data-testid="mode-switch">
            {([['bilingual', '中英对照'], ['zh', '仅中文'], ['en', '仅英文']] as const).map(([m, label]) => (
              <button key={m} class={displayMode.value === m ? 'on' : ''} onClick={() => {
                displayMode.value = m;
                sendMsg({ type: 'SAVE_SETTINGS', patch: { displayMode: m } });
                if (settings.value) settings.value = { ...settings.value, displayMode: m };
              }}>{label}</button>
            ))}
          </div>
        )}
        {tab === 'transcript' && (
          <>
          <div class="translate-bar">
            {/* §0.13：免费通道自动翻译，手动入口仅留 LLM 翻译；导出按钮与此并列 */}
            <span>{translating ? `翻译中… 已翻 ${done}/${total}` : `未翻译句数 ${pendingCount}`}</span>
            {settings.value?.llm && (
              <button data-testid="llm-translate" disabled={!currentVideoId || translating || !cues.value.length}
                onClick={() => triggerTranslate(currentVideoId, true)}>
                LLM 翻译
              </button>
            )}
            <button data-testid="open-export" disabled={!currentVideoId}
              onClick={() => setExportOpen(true)}>
              导出
            </button>
          </div>
          {translateError && <div class="err"><span>翻译失败：{translateError}</span></div>}
          {settings.value?.translateChannel === 'free' && !settings.value.llm && (
            <div class="translate-hint">免费通道逐句翻译较慢、术语有限。配置 LLM key 可大幅提速提质 → ⚙️</div>
          )}
          {cues.value.length === 0 && !transcriptError.value && !fetchTimedOut && (
            <div class="empty fetching" data-testid="transcript-fetching"><span>⏳ 正在获取字幕…</span></div>
          )}
          {cues.value.length === 0 && (fetchTimedOut || transcriptError.value) && (
            <div class="empty" data-testid="transcript-empty">
              <span>本视频没有逐字稿（或获取失败）</span>
              <button onClick={noteHere}>📝 在当前播放位置记笔记</button>
            </div>
          )}
          </>
        )}
        {tab === 'transcript' && <TranscriptView
          cues={cues.value} videoId={videoInfo.value?.videoId ?? ''} currentTime={currentTime.value}
          mode={displayMode.value}
          onSeek={(t) => sendMsg({ type: 'SEEK', t })}
          onSelect={(sel) => {
            // 空选区早退：不打开编辑器，也避免空 excerpt 传入
            if (!sel.length) return;
            const last = sel.at(-1)!;
            noteEditorCtx.value = { start: sel[0]!.start, end: last.start + last.dur, excerpt: sel.map((c) => c.text).join(' ') };
          }}
        />}
        {tab === 'notes' && <NotesView notes={notes.value} videoId={videoInfo.value?.videoId ?? ''} currentVideoId={videoInfo.value?.videoId ?? ''} onNoteHere={noteHere} />}
        {tab === 'summary' && <SummaryView
          summary={summary.value} llmConfigured={!!settings.value?.llm}
          videoId={videoInfo.value?.videoId ?? ''} onSeek={(t) => sendMsg({ type: 'SEEK', t })}
        />}
        {tab === 'library' && <LibraryView currentVideoId={videoInfo.value?.videoId ?? ''} />}
        {/* 真实设置就绪才渲染：SettingsView 表单 state 仅首挂载从 props 取值，
            若用兜底字面量提前挂载，stale seed 会在保存时覆盖已存的设置（主题/LLM key） */}
        {tab === 'settings' && settings.value && <SettingsView
          settings={settings.value}
          onSave={async (patch) => {
            await sendMsg({ type: 'SAVE_SETTINGS', patch });
            await refreshSettings();
            // 保存成功即回到进入设置前的工作现场（上次在逐字稿回逐字稿、在笔记回笔记）
            activeTab.value = lastWorkTab.current;
          }}
        />}
      </main>
      {noteEditorCtx.value && <NoteEditor key={`${noteEditorCtx.value.start}-${noteEditorCtx.value.end}`} />}
      {exportOpen && currentVideoId && <ExportDialog videoId={currentVideoId} onClose={() => setExportOpen(false)} />}
    </div>
  );
}
