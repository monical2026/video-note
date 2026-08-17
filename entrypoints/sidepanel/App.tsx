import { useEffect } from 'preact/hooks';
import { activeTab, cues, currentTime, loadVideoData, noteEditorCtx, refreshSettings, sendMsg, settings, videoInfo } from './state';
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
  useEffect(() => {
    refreshSettings();
    // 找当前 YouTube 标签页拿 videoId
    browser.tabs.query({ active: true, currentWindow: true }).then(async ([tab]) => {
      const m = tab?.url?.match(/[?&]v=([\w-]{11})/);
      const videoId = m?.[1];
      if (videoId) await loadVideoData(videoId);
    });
    const listener = (msg: any) => {
      if (msg.type === 'PLAYBACK') currentTime.value = msg.t;
      if (msg.type === 'OPEN_NOTE_EDITOR') noteEditorCtx.value = msg;
      if (msg.type === 'PAGE_INFO') loadVideoData(msg.meta.videoId);
    };
    browser.runtime.onMessage.addListener(listener);
    return () => browser.runtime.onMessage.removeListener(listener);
  }, []);

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
        {tab === 'transcript' && <TranscriptView
          cues={cues.value} videoId={videoInfo.value?.videoId ?? ''} currentTime={currentTime.value}
          mode={(settings.value?.displayMode ?? 'bilingual') as any}
          onSeek={(t) => sendMsg({ type: 'SEEK', t })}
          onSelect={(sel) => (noteEditorCtx.value = { start: sel[0]?.start ?? 0, end: sel.at(-1)!.start + sel.at(-1)!.dur, excerpt: sel.map((c) => c.text).join(' ') })}
        />}
        {tab === 'notes' && <NotesView />}
        {tab === 'summary' && <SummaryView />}
        {tab === 'library' && <LibraryView />}
        {tab === 'settings' && <SettingsView />}
      </main>
      {noteEditorCtx.value && <NoteEditor />}
    </div>
  );
}
