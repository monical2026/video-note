import { useState } from 'preact/hooks';
import type { Note } from '../../src/types';
import { formatTime, tsLink } from '../../src/utils/time';
import { sendMsg, loadVideoData } from './state';

/** 单条笔记复制格式（与融合导出一致） */
export function noteMarkdown(n: Note): string {
  const icon = n.type === 'value' ? '⭐ **我的笔记**' : '❓ **我的疑惑**';
  const lines = [`${icon} · [${formatTime(n.start)}](${tsLink(n.videoId, n.start)})`, n.annotation];
  if (n.excerpt) lines.push(`「${n.excerpt}」`);
  if (n.aiExplanation) lines.push('🤖 **AI 解释**：' + n.aiExplanation);
  return lines.join('\n');
}

export function NotesView(props: { notes: Note[]; videoId: string; currentVideoId: string; onNotesChanged?: () => void; onNoteHere?: () => void }) {
  const [copiedId, setCopiedId] = useState('');
  const copy = async (n: Note) => {
    await navigator.clipboard.writeText(noteMarkdown(n));
    setCopiedId(n.id); setTimeout(() => setCopiedId(''), 1500);
  };
  const jump = (n: Note) => {
    if (n.videoId === props.currentVideoId) sendMsg({ type: 'SEEK', t: n.start });
    else browser.tabs.create({ url: tsLink(n.videoId, n.start) });
  };
  const [explainingId, setExplainingId] = useState('');
  const [explainError, setExplainError] = useState<{ id: string; msg: string } | null>(null);
  const explain = async (n: Note) => {
    setExplainingId(n.id);
    setExplainError(null);
    try {
      const r = await sendMsg<{ explanation: string }>({ type: 'EXPLAIN', videoId: n.videoId, start: n.start, end: n.end });
      n.aiExplanation = r.explanation;
      await sendMsg({ type: 'SAVE_NOTE', note: n });
      // 原地突变不触发 signal 更新，需重新加载以刷新列表
      // LibraryView 场景（历史视频）：不能 loadVideoData（会把全局 signals 切到历史视频），改用回调本地刷新
      if (props.onNotesChanged) props.onNotesChanged();
      else await loadVideoData(props.videoId);
    } catch (err) {
      setExplainError({ id: n.id, msg: err instanceof Error ? err.message : String(err) });
      setTimeout(() => setExplainError(null), 3000);
    } finally {
      setExplainingId('');
    }
  };
  const exportMd = async (notesOnly: boolean, includeTranscript: boolean) => {
    const r = await sendMsg<{ markdown: string }>({ type: 'EXPORT', videoId: props.videoId, notesOnly, includeTranscript });
    const url = URL.createObjectURL(new Blob([r.markdown], { type: 'text/markdown' }));
    const a = document.createElement('a');
    a.href = url; a.download = `${props.videoId}-notes.md`; a.click();
    URL.revokeObjectURL(url);
  };
  // 顶部常驻工具栏：记笔记入口 + 导出组（记完一条后仍有入口）
  const toolbar = (
    <div class="notes-toolbar">
      {props.onNoteHere && <button class="primary" onClick={props.onNoteHere}>📝 记笔记</button>}
      <button class="primary" onClick={() => exportMd(false, false)}>导出 Markdown</button>
      <button class="ghost" onClick={() => exportMd(true, false)}>仅笔记</button>
      <button class="ghost" onClick={() => exportMd(false, true)}>含逐字稿</button>
    </div>
  );
  if (!props.notes.length) return (
    <div class="notes">
      {toolbar}
      <div class="empty">本视频还没有笔记——点上方 📝 记笔记、按 Ctrl+Shift+L，或在逐字稿上划选</div>
    </div>
  );
  return (
    <div class="notes">
      {toolbar}
      {props.notes.map((n) => (
        <div key={n.id} class="note">
          <button class="ts" onClick={() => jump(n)}>{formatTime(n.start)}</button>
          <span class={`tag ${n.type}`}>{n.type === 'value' ? '⭐' : '❓'}</span>
          <div class="annotation">{n.annotation}</div>
          {n.excerpt && <div class="excerpt">「{n.excerpt}」</div>}
          {n.aiExplanation && <div class="ai">🤖 {n.aiExplanation}</div>}
          <div class="ops">
            <button onClick={() => copy(n)}>{copiedId === n.id ? '已复制' : '复制'}</button>
            <button onClick={() => jump(n)}>跳转</button>
            {n.type === 'confusion' && !n.aiExplanation && (
              <button disabled={explainingId === n.id} onClick={() => explain(n)}>
                {explainingId === n.id ? '解释中…' : 'AI 解释'}
              </button>
            )}
            {explainError?.id === n.id && <span class="err">{explainError.msg}</span>}
          </div>
        </div>
      ))}
    </div>
  );
}
