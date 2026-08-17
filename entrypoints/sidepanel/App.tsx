import { useEffect, useRef, useState } from 'preact/hooks';
import { activeTab, cues, currentTime, displayMode, loadVideoData, noteEditorCtx, notes, refreshSettings, sendMsg, settings, summary, transcriptError, videoInfo } from './state';
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
  const autoTranslatedFor = useRef(''); // 已自动翻译过的 videoId，防止重复触发

  const triggerTranslate = async (videoId: string) => {
    if (!videoId || translating) return;
    setTranslating(true);
    try {
      await sendMsg({ type: 'TRANSLATE', videoId });
      await loadVideoData(videoId);
    } catch { /* 失败静默：保留原字幕，可手动重试 */ }
    finally { setTranslating(false); }
  };

  useEffect(() => {
    refreshSettings();
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
      // 仅接受 background 处理完成后的广播（sender 无 tab）；忽略 content script 发来的原始未处理消息
      if (msg.type === 'PAGE_INFO' && !sender?.tab) { transcriptError.value = ''; loadVideoData(msg.meta.videoId); }
    };
    browser.runtime.onMessage.addListener(listener);
    return () => browser.runtime.onMessage.removeListener(listener);
  }, []);

  // 免费通道自动翻译：cues 非空且全部无译文时，每个视频自动触发一次
  const pendingCount = cues.value.filter((c) => !c.zh).length;
  const currentVideoId = videoInfo.value?.videoId ?? '';
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

  const tab = activeTab.value;
  return (
    <div class="app">
      <header>
        <span class="title">{videoInfo.value?.title ?? 'Video Note'}</span>
        <nav>
          {TABS.map(([id, label]) => (
            <button key={id} class={tab === id ? 'on' : ''} onClick={() => (activeTab.value = id)}>{label}</button>
          ))}
        </nav>
      </header>
      <main>
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
          <div class="translate-bar">
            <span>未翻译句数 {pendingCount}</span>
            <button disabled={!currentVideoId || translating || !pendingCount} onClick={() => triggerTranslate(currentVideoId)}>
              {translating ? '翻译中…' : '翻译'}
            </button>
          </div>
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
        {tab === 'notes' && <NotesView notes={notes.value} videoId={videoInfo.value?.videoId ?? ''} currentVideoId={videoInfo.value?.videoId ?? ''} />}
        {tab === 'summary' && <SummaryView
          summary={summary.value} llmConfigured={!!settings.value?.llm}
          videoId={videoInfo.value?.videoId ?? ''} onSeek={(t) => sendMsg({ type: 'SEEK', t })}
        />}
        {tab === 'library' && <LibraryView currentVideoId={videoInfo.value?.videoId ?? ''} />}
        {tab === 'settings' && <SettingsView
          settings={settings.value ?? { displayMode: 'bilingual', translateChannel: 'free', llm: null, supadataKey: '', polishEnabled: false }}
          onSave={async (patch) => { await sendMsg({ type: 'SAVE_SETTINGS', patch }); await refreshSettings(); }}
        />}
      </main>
      {noteEditorCtx.value && <NoteEditor />}
    </div>
  );
}
