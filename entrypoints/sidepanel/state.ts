import { signal } from '@preact/signals';
import type { Cue, Note, Settings, Summary, VideoMeta } from '../../src/types';

export const videoInfo = signal<VideoMeta | null>(null);
export const cues = signal<Cue[]>([]);
export const notes = signal<Note[]>([]);
export const summary = signal<Summary | null>(null);
export const settings = signal<Settings | null>(null);
export const currentTime = signal(0);
export const activeTab = signal<'transcript' | 'notes' | 'summary' | 'library' | 'settings'>('transcript');
export const noteEditorCtx = signal<{ start: number; end: number; excerpt: string } | null>(null);

export const sendMsg = <T = any>(msg: any): Promise<T> =>
  browser.runtime.sendMessage(msg).then((resp: any) => {
    // background 以 { error } 形状回传失败——统一转成 throw，调用方 try/catch
    if (resp && typeof resp === 'object' && 'error' in resp) throw new Error(resp.error);
    return resp as T;
  });

export async function loadVideoData(videoId: string) {
  const d = await sendMsg<{ video: VideoMeta; cues: Cue[]; notes: Note[]; summary: Summary }>({ type: 'GET_VIDEO_DATA', videoId });
  videoInfo.value = d.video; cues.value = d.cues; notes.value = d.notes; summary.value = d.summary;
}

export async function refreshSettings() { settings.value = await sendMsg<Settings>({ type: 'GET_SETTINGS' }); }
