import type { Cue } from '../types';

/** Supadata 逐字稿 API（无字幕视频由其 Whisper 生成） */
export async function fetchSupadataTranscript(videoId: string, apiKey: string): Promise<Cue[]> {
  const url = `https://api.supadata.ai/v1/youtube/transcript?url=https://www.youtube.com/watch?v=${videoId}&lang=en`;
  const res = await fetch(url, { headers: { 'x-api-key': apiKey } });
  if (!res.ok) throw new Error(`Supadata ${res.status}: ${await res.text()}`);
  const data = await res.json();
  return (data.content ?? []).map((c: any) => ({ start: c.offset / 1000, dur: (c.duration ?? 0) / 1000, text: String(c.text).trim() }));
}
