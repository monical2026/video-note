import { useEffect, useState } from 'preact/hooks';
import type { Note, VideoMeta } from '../../src/types';
import { sendMsg } from './state';
import { NotesView } from './NotesView';

type Row = { video: VideoMeta; noteCount: number; lastAt: number };

export function LibraryView(props: { currentVideoId: string }) {
  const [rows, setRows] = useState<Row[]>([]);
  const [q, setQ] = useState('');
  const [openVideo, setOpenVideo] = useState<Row | null>(null);
  const [openNotes, setOpenNotes] = useState<Note[]>([]);
  useEffect(() => { sendMsg<{ rows: Row[] }>({ type: 'LIST_LIBRARY' }).then((r) => setRows(r.rows ?? [])); }, []);
  if (openVideo) return (
    <div>
      <button class="back" onClick={() => setOpenVideo(null)}>← 返回</button>
      <NotesView notes={openNotes} videoId={openVideo.video.videoId} currentVideoId={props.currentVideoId}
        onNotesChanged={async () => {
          // 本地刷新：不触碰全局 signals，避免把面板切到历史视频
          const d = await sendMsg<{ notes: Note[] }>({ type: 'GET_VIDEO_DATA', videoId: openVideo.video.videoId });
          setOpenNotes(d.notes);
        }} />
    </div>
  );
  const filtered = rows.filter((r) => r.video.title.toLowerCase().includes(q.toLowerCase()));
  return (
    <div class="library">
      <input placeholder="搜索视频标题…" value={q} onInput={(e) => setQ((e.target as HTMLInputElement).value)} />
      {filtered.map((r) => (
        <div key={r.video.videoId} class="lib-item" onClick={async () => {
          const d = await sendMsg<{ notes: Note[] }>({ type: 'GET_VIDEO_DATA', videoId: r.video.videoId });
          setOpenNotes(d.notes); setOpenVideo(r);
        }}>
          <div class="lib-title">{r.video.title}</div>
          <div class="lib-meta">笔记 {r.noteCount} 条 ｜ {new Date(r.lastAt).toLocaleDateString('zh-CN')}</div>
        </div>
      ))}
      {!filtered.length && <div class="empty">还没有历史笔记</div>}
    </div>
  );
}
