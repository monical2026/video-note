import { openDB, type IDBPDatabase } from 'idb';
import type { Cue, Note, Summary, Term, TranscriptRecord, VideoMeta } from '../types';

const DB_NAME = 'video-note', DB_VERSION = 1;
let dbp: Promise<IDBPDatabase> | null = null;

function db() {
  dbp ??= openDB(DB_NAME, DB_VERSION, {
    upgrade(d) {
      d.createObjectStore('videos', { keyPath: 'videoId' });
      d.createObjectStore('transcripts');
      const notes = d.createObjectStore('notes', { keyPath: 'id' });
      notes.createIndex('byVideo', 'videoId');
      notes.createIndex('byCreated', 'createdAt');
      d.createObjectStore('summaries', { keyPath: 'videoId' });
    },
  });
  return dbp;
}

/** 测试隔离用：关闭旧连接并删库，下次调用重新 openDB */
export async function resetDbForTest() {
  if (dbp) {
    try { (await dbp).close(); } catch { /* 忽略关闭失败 */ }
  }
  dbp = null;
  await new Promise<void>((resolve, reject) => {
    const req = indexedDB.deleteDatabase(DB_NAME);
    req.onsuccess = req.onblocked = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

export const saveVideo = (m: VideoMeta) => db().then((d) => d.put('videos', m));
export const getVideo = (videoId: string) => db().then((d) => d.get('videos', videoId) as Promise<VideoMeta | undefined>);

/** 旧版直接存 Cue[] 数组，升级后存 {cues, terms}——读取时归一为新形状 */
function normalize(v: unknown): TranscriptRecord | undefined {
  if (Array.isArray(v)) return { cues: v as Cue[], terms: [] };
  return v as TranscriptRecord | undefined;
}
export const saveTranscript = (videoId: string, cues: Cue[], terms?: Term[]) =>
  db().then((d) => d.put('transcripts', { cues, terms: terms ?? [] } satisfies TranscriptRecord, videoId));
/** 兼容层：只取 cues 部分（绝大多数调用方只关心字幕行） */
export const getTranscript = (videoId: string) =>
  db().then((d) => d.get('transcripts', videoId)).then((v) => normalize(v)?.cues);
export const getTranscriptRecord = (videoId: string) =>
  db().then((d) => d.get('transcripts', videoId)).then((v) => normalize(v));
/** 原始读写（仅测试用）：绕过归一化层，写入/读取 store 里的原值 */
export const putTranscriptRaw = (videoId: string, value: unknown) => db().then((d) => d.put('transcripts', value, videoId));
export const openTranscriptRaw = (videoId: string) => db().then((d) => d.get('transcripts', videoId));

export const addNote = (n: Note) => db().then((d) => d.put('notes', n));
export const updateNote = addNote;
export const deleteNote = (id: string) => db().then((d) => d.delete('notes', id));

export async function getNotesByVideo(videoId: string): Promise<Note[]> {
  const d = await db();
  const all = await d.getAllFromIndex('notes', 'byVideo', videoId);
  return all.sort((a, b) => a.start - b.start);
}

export async function listVideosWithNotes(): Promise<{ video: VideoMeta; noteCount: number; lastAt: number }[]> {
  const d = await db();
  const notes = (await d.getAll('notes')) as Note[];
  const byVideo = new Map<string, Note[]>();
  for (const n of notes) byVideo.set(n.videoId, [...(byVideo.get(n.videoId) ?? []), n]);
  const rows = await Promise.all(
    [...byVideo.keys()].map(async (videoId) => {
      const ns = byVideo.get(videoId)!;
      return { video: (await d.get('videos', videoId)) as VideoMeta, noteCount: ns.length, lastAt: Math.max(...ns.map((n) => n.createdAt)) };
    }),
  );
  return rows.filter((r) => r.video).sort((a, b) => b.lastAt - a.lastAt);
}

export const saveSummary = (s: Summary) => db().then((d) => d.put('summaries', s));
export const getSummary = (videoId: string) => db().then((d) => d.get('summaries', videoId) as Promise<Summary | undefined>);
