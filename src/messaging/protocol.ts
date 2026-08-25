import type { Cue, Note, Settings, Summary, VideoMeta } from '../types';

export type Msg =
  | { type: 'PAGE_INFO'; meta: { videoId: string; title: string; channel: string }; cues: Cue[] }
  | { type: 'GET_VIDEO_DATA'; videoId: string }
  | { type: 'TRANSLATE'; videoId: string; force?: boolean }  // force：忽略已有译文全量重翻（「LLM 重翻」按钮）
  | { type: 'POLISH'; videoId: string }                       // 对已入库逐字稿重新润色（分段+清理+术语表），并清旧译文
  | { type: 'SAVE_NOTE'; note: Note }
  | { type: 'DELETE_NOTE'; id: string }
  | { type: 'EXPLAIN'; videoId: string; start: number; end: number }
  | { type: 'SUMMARIZE'; videoId: string }
  | { type: 'SEEK'; t: number }
  | { type: 'PLAYBACK'; t: number }
  | { type: 'EXPORT'; videoId: string; includeTranscript: boolean; notesOnly?: boolean }
  | { type: 'GET_SETTINGS' }
  | { type: 'SAVE_SETTINGS'; patch: Partial<Settings> }
  | { type: 'CAPTURE_NOW' }
  | { type: 'LIST_LIBRARY' }
  | { type: 'OPEN_NOTE_EDITOR'; start: number; end: number; excerpt: string }
  | { type: 'TRANSCRIPT_FAILED'; videoId: string; reason: string }
  | { type: 'LLM_STREAM'; phase: 'polish' | 'translate'; batch: number; batchTotal: number; text: string }  // bg→面板：LLM 流式生成进度（节流后）
  | { type: 'RETRY_TRANSCRIPT' };

export interface VideoData { video: VideoMeta | null; cues: Cue[]; notes: Note[]; summary: Summary | null; }
