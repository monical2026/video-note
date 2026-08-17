import type { Cue, Note, Settings, Summary, VideoMeta } from '../types';

export type Msg =
  | { type: 'PAGE_INFO'; meta: { videoId: string; title: string; channel: string }; cues: Cue[] }
  | { type: 'GET_VIDEO_DATA'; videoId: string }
  | { type: 'TRANSLATE'; videoId: string }
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
  | { type: 'RETRY_TRANSCRIPT' };

export interface VideoData { video: VideoMeta | null; cues: Cue[]; notes: Note[]; summary: Summary | null; }
