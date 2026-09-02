import type { Cue, Note, Settings, Summary, VideoMeta } from '../types';

export type Msg =
  | { type: 'PAGE_INFO'; meta: { videoId: string; title: string; channel: string }; cues: Cue[] }
  | { type: 'GET_VIDEO_DATA'; videoId: string }
  | { type: 'TRANSLATE'; videoId: string; force?: boolean }  // force：忽略已有译文全量重翻（「LLM 重翻」按钮）
  | { type: 'DELETE_TRANSCRIPT'; videoId: string }            // 清除该视频库存稿（旧润色版/译文/术语表），重抓走新链路
  | { type: 'CLEAR_ALL_DATA' }                                // 清空全部视频/逐字稿/笔记/摘要（设置与 API key 保留）——从头测试用
  | { type: 'RESEGMENT'; videoId: string; mode: 'rules' | 'ai' }  // 从原始碎行重新分段（规则=零费用 / ai=大模型断点）；文字一字不动，译文失配清空
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
  | { type: 'LLM_STREAM'; batch: number; batchTotal: number; text: string }  // bg→面板：LLM 翻译流式生成进度（节流后）
  | { type: 'RETRY_TRANSCRIPT' };

export interface VideoData { video: VideoMeta | null; cues: Cue[]; notes: Note[]; summary: Summary | null; }
