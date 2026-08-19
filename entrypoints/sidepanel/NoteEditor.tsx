import { useState } from 'preact/hooks';
import type { NoteType } from '../../src/types';
import { cues, loadVideoData, noteEditorCtx, sendMsg, videoInfo } from './state';
import { formatTime } from '../../src/utils/time';

export function NoteEditor() {
  const ctx = noteEditorCtx.value!;
  const [type, setType] = useState<NoteType>('value');
  const [annotation, setAnnotation] = useState('');
  // excerpt 为空（快捷键路径）时，从字幕取窗口文本
  const excerpt = ctx.excerpt || cues.value.filter((c) => c.start >= ctx.start && c.start <= ctx.end).map((c) => c.text).join(' ');
  const save = async () => {
    const videoId = videoInfo.value?.videoId ?? '';
    await sendMsg({ type: 'SAVE_NOTE', note: {
      id: crypto.randomUUID(), videoId,
      start: ctx.start, end: ctx.end, excerpt, annotation, type, createdAt: Date.now(),
    } });
    noteEditorCtx.value = null;
    await loadVideoData(videoId); // 刷新笔记列表
  };
  return (
    <div class="editor-mask">
      <div class="editor">
        <div class="row">
          <button class={type === 'value' ? 'on' : ''} onClick={() => setType('value')}>⭐ 有价值</button>
          <button class={type === 'confusion' ? 'on' : ''} onClick={() => setType('confusion')}>❓ 有疑惑</button>
        </div>
        <div class="meta">
          {excerpt
            ? `[${formatTime(ctx.start)}] 「${excerpt.slice(0, 120)}${excerpt.length > 120 ? '…' : ''}」`
            : `⏱ 当前播放位置 · [${formatTime(ctx.start)}]（无字幕摘录）`}
        </div>
        <textarea placeholder="写批注…" value={annotation} onInput={(e) => setAnnotation((e.target as HTMLTextAreaElement).value)} rows={4} />
        <div class="row">
          <button onClick={() => (noteEditorCtx.value = null)}>取消</button>
          <button class="primary" onClick={save}>保存</button>
        </div>
      </div>
    </div>
  );
}
