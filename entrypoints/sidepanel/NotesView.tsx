import { useState } from 'preact/hooks';
import type { Note } from '../../src/types';
import { formatTime, tsLink } from '../../src/utils/time';
import { sendMsg } from './state';

/** 单条笔记复制格式（与融合导出一致） */
export function noteMarkdown(n: Note): string {
  const icon = n.type === 'value' ? '⭐ **我的笔记**' : '❓ **我的疑惑**';
  const lines = [`${icon} · [${formatTime(n.start)}](${tsLink(n.videoId, n.start)})`, n.annotation];
  if (n.excerpt) lines.push(`「${n.excerpt}」`);
  if (n.aiExplanation) lines.push('🤖 **AI 解释**：' + n.aiExplanation);
  return lines.join('\n');
}

export function NotesView(props: { notes: Note[]; videoId: string; currentVideoId: string }) {
  const [copiedId, setCopiedId] = useState('');
  const copy = async (n: Note) => {
    await navigator.clipboard.writeText(noteMarkdown(n));
    setCopiedId(n.id); setTimeout(() => setCopiedId(''), 1500);
  };
  const jump = (n: Note) => {
    if (n.videoId === props.currentVideoId) sendMsg({ type: 'SEEK', t: n.start });
    else browser.tabs.create({ url: tsLink(n.videoId, n.start) });
  };
  const explain = async (n: Note) => {
    const r = await sendMsg<{ explanation: string }>({ type: 'EXPLAIN', videoId: n.videoId, start: n.start, end: n.end });
    n.aiExplanation = r.explanation;
    await sendMsg({ type: 'SAVE_NOTE', note: n });
  };
  if (!props.notes.length) return <div class="empty">本视频还没有笔记——选中字幕或按快捷键开始记录</div>;
  const exportMd = async (notesOnly: boolean, includeTranscript: boolean) => {
    const r = await sendMsg<{ markdown: string }>({ type: 'EXPORT', videoId: props.videoId, notesOnly, includeTranscript });
    const url = URL.createObjectURL(new Blob([r.markdown], { type: 'text/markdown' }));
    const a = document.createElement('a');
    a.href = url; a.download = `${props.videoId}-notes.md`; a.click();
    URL.revokeObjectURL(url);
  };
  return (
    <div class="notes">
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
            {n.type === 'confusion' && !n.aiExplanation && <button onClick={() => explain(n)}>AI 解释</button>}
          </div>
        </div>
      ))}
      <div class="export">
        <button class="primary" onClick={() => exportMd(false, false)}>导出 Markdown</button>
        <button onClick={() => exportMd(true, false)}>仅笔记</button>
        <button onClick={() => exportMd(false, true)}>含逐字稿</button>
      </div>
    </div>
  );
}
