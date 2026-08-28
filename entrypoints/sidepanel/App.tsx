import { useEffect, useRef, useState } from 'preact/hooks';
import { activeTab, cues, currentTime, displayMode, loadVideoData, noteEditorCtx, notes, refreshSettings, sendMsg, settings, summary, transcriptError, videoInfo } from './state';
import type { StreamInfo } from '../../src/services/llm-translate';
import { TranscriptView } from './TranscriptView';
import { NotesView } from './NotesView';
import { SummaryView } from './SummaryView';
import { LibraryView } from './LibraryView';
import { SettingsView } from './SettingsView';
import { NoteEditor } from './NoteEditor';

const TABS = [
  ['transcript', '逐字稿'], ['notes', '笔记'], ['summary', 'AI 摘要'], ['library', '📚'], ['settings', '⚙️'],
] as const;

export function App() {
  const [translating, setTranslating] = useState(false);
  const [resegmenting, setResegmenting] = useState<'rules' | 'ai' | null>(null);
  const [translateError, setTranslateError] = useState('');
  const [stream, setStream] = useState<StreamInfo | null>(null);
  const [fetchTimedOut, setFetchTimedOut] = useState(false);
  const streamBoxRef = useRef<HTMLPreElement>(null);
  const autoTranslatedFor = useRef(''); // 已自动翻译过的 videoId，防止重复触发
  const tabRestored = useRef(false);    // 上次 Tab 恢复完成前禁止回写（防读写竞争覆盖）
  const lastWorkTab = useRef<typeof activeTab.value>('transcript'); // 进入设置页前的工作 Tab（保存后跳回）

  const triggerTranslate = async (videoId: string, force = false) => {
    if (!videoId || translating) return;
    setTranslating(true); setTranslateError(''); setStream(null);
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
    } finally { setTranslating(false); setStream(null); }
  };

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
      if (msg.type === 'LLM_STREAM') setStream(msg as StreamInfo);
      // 仅接受 background 处理完成后的广播（sender 无 tab）；忽略 content script 发来的原始未处理消息
      if (msg.type === 'PAGE_INFO' && !sender?.tab) {
        transcriptError.value = ''; setStream(null); loadVideoData(msg.meta.videoId);
      }
    };
    browser.runtime.onMessage.addListener(listener);
    return () => browser.runtime.onMessage.removeListener(listener);
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

  // 流式文本自动滚到底（跟随生成）
  useEffect(() => {
    const el = streamBoxRef.current;
    if (el && typeof el.scrollTo === 'function') el.scrollTo(0, el.scrollHeight);
  }, [stream?.text]);

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

  /** 重新分段：从库存的原始碎行重新拼段（规则=零费用 / AI=大模型断点）；文字一字不动，译文失配清空待重翻 */
  const resegment = async (mode: 'rules' | 'ai') => {
    if (!currentVideoId || translating || resegmenting) return;
    setResegmenting(mode); setTranslateError(''); setStream(null);
    try {
      await sendMsg({ type: 'RESEGMENT', videoId: currentVideoId, mode });
      await loadVideoData(currentVideoId);
    } catch (e) {
      setTranslateError(e instanceof Error ? e.message : String(e));
    } finally { setResegmenting(null); setStream(null); }
  };

  /** 重抓字幕：清除该视频库存稿（旧润色版/译文/术语表），重新走抓取→拼段新链路；笔记与摘要保留 */
  const refetchTranscript = async () => {
    if (!currentVideoId || translating) return;
    setTranslateError(''); setStream(null);
    try {
      await sendMsg({ type: 'DELETE_TRANSCRIPT', videoId: currentVideoId });
      cues.value = [];  // 清本地：触发「正在获取字幕…」态，等 PAGE_INFO 广播刷新
      sendMsg({ type: 'RETRY_TRANSCRIPT' });
    } catch (e) { setTranslateError(e instanceof Error ? e.message : String(e)); }
  };

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
            <span>{translating ? `翻译中… 已翻 ${done}/${total}` : `未翻译句数 ${pendingCount}`}</span>
            <button disabled={!currentVideoId || translating || !pendingCount} onClick={() => triggerTranslate(currentVideoId)}>
              {translating ? '翻译中…' : '翻译'}
            </button>
            {settings.value?.llm && (
              <button data-testid="retranslate-llm" disabled={!currentVideoId || translating || !cues.value.length}
                onClick={() => triggerTranslate(currentVideoId, true)}>
                用 LLM 重翻
              </button>
            )}
            <button data-testid="refetch-transcript" disabled={!currentVideoId || translating || !cues.value.length}
              title="清除本视频已存字幕稿（旧润色版/译文），重新抓取并按新方式拼段；笔记不受影响"
              onClick={refetchTranscript}>
              重抓字幕
            </button>
            <button data-testid="resegment-rules" disabled={!currentVideoId || translating || !!resegmenting || !cues.value.length}
              title="按两层规则（分句→组段）从原始碎行重新拼段：零费用、即时；文字一字不动，译文需重翻"
              onClick={() => resegment('rules')}>
              {resegmenting === 'rules' ? '分段中…' : '规则分段'}
            </button>
          </div>
          {translateError && <div class="err"><span>翻译失败：{translateError}</span></div>}
          {stream && (
            <div class="llm-stream" data-testid="llm-stream">
              <span class="llm-stream-head">翻译中 · 第 {stream.batch}/{stream.batchTotal} 批</span>
              <pre ref={streamBoxRef}>{stream.text}</pre>
            </div>
          )}
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
        {tab === 'settings' && <SettingsView
          settings={settings.value ?? { displayMode: 'bilingual', translateChannel: 'free', llm: null, supadataKey: '', llmKeys: {} }}
          onSave={async (patch) => {
            await sendMsg({ type: 'SAVE_SETTINGS', patch });
            await refreshSettings();
            // 保存成功即回到进入设置前的工作现场（上次在逐字稿回逐字稿、在笔记回笔记）
            activeTab.value = lastWorkTab.current;
          }}
        />}
      </main>
      {noteEditorCtx.value && <NoteEditor key={`${noteEditorCtx.value.start}-${noteEditorCtx.value.end}`} />}
    </div>
  );
}
