import 'fake-indexeddb/auto';
import { describe, expect, it, beforeEach } from 'vitest';
import { addNote, getNotesByVideo, listVideosWithNotes, resetDbForTest, saveVideo, saveTranscript, getTranscript } from './db';
import type { Note, VideoMeta } from '../types';

const v: VideoMeta = { videoId: 'v1', title: 'T', channel: 'C', url: 'u', captionLang: 'en', fetchedAt: 1 };

beforeEach(async () => {
  await resetDbForTest(); // 关闭旧连接并删库，fake-indexeddb 重新开
});

it('笔记按视频隔离且按时间排序', async () => {
  await saveVideo(v);
  const n2: Note = { id: 'b', videoId: 'v1', start: 20, end: 25, excerpt: 'e2', annotation: 'a', type: 'value', createdAt: 2 };
  const n1: Note = { id: 'a', videoId: 'v1', start: 10, end: 15, excerpt: 'e1', annotation: 'a', type: 'confusion', createdAt: 1 };
  await addNote(n2); await addNote(n1);
  expect((await getNotesByVideo('v1')).map((n) => n.id)).toEqual(['a', 'b']);
  expect(await getNotesByVideo('other')).toEqual([]);
});

it('listVideosWithNotes 返回条数与最近时间且倒序', async () => {
  await saveVideo(v);
  await saveVideo({ ...v, videoId: 'v2' });
  await addNote({ id: 'x', videoId: 'v1', start: 1, end: 2, excerpt: '', annotation: '', type: 'value', createdAt: 99 } as Note);
  await addNote({ id: 'y', videoId: 'v2', start: 1, end: 2, excerpt: '', annotation: '', type: 'value', createdAt: 5 } as Note);
  const rows = await listVideosWithNotes();
  expect(rows.map((r) => r.video.videoId)).toEqual(['v1', 'v2']);
  expect(rows[0]).toMatchObject({ noteCount: 1, lastAt: 99 });
});

it('逐字稿整存整取', async () => {
  await saveTranscript('v1', [{ start: 0, dur: 2, text: 'hi', zh: '你好' }]);
  expect((await getTranscript('v1'))?.[0]?.zh).toBe('你好');
});
