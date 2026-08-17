import type { Cue } from '../types';

export interface TranscriptDeps {
  fetchTrack?: (baseUrl: string) => Promise<Cue[]>;
  supadata?: (videoId: string, key: string) => Promise<Cue[]>;
  supadataKey?: string;
}

/** 直抓优先（手动字幕优先于 asr），无字幕/全失败时 Supadata 兜底 */
export async function getTranscriptWithFallback(
  input: { videoId: string; tracks: { baseUrl: string; lang?: string; kind?: string }[] },
  deps: TranscriptDeps = {},
): Promise<{ cues: Cue[]; source: 'youtube' | 'supadata' }> {
  const fetchTrack = deps.fetchTrack ?? (async () => { throw new Error('no fetch'); });
  const sorted = [...input.tracks].sort((a, b) => (a.kind === 'asr' ? 1 : 0) - (b.kind === 'asr' ? 1 : 0));
  for (const t of sorted) {
    try {
      const cues = await fetchTrack(t.baseUrl);
      if (cues.length) return { cues, source: 'youtube' };
    } catch { /* 尝试下一轨道 */ }
  }
  if (deps.supadata && deps.supadataKey) {
    const cues = await deps.supadata(input.videoId, deps.supadataKey);
    if (cues.length) return { cues, source: 'supadata' };
  }
  throw new Error('该视频无可用字幕（直抓失败且未配置/未成功调用 Supadata）');
}
