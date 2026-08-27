import type { Cue } from '../types';

/**
 * Supadata 逐字稿 API，两段式（对齐其双模式计费）：
 * 1) native 直取现成字幕（不消耗次数）
 * 2) 仅当 404（视频无任何字幕）→ 带 mode=generate 重试，Whisper 从头生成（消耗次数）；
 *    generate 模式下 lang 参数被服务端忽略
 */
export async function fetchSupadataTranscript(videoId: string, apiKey: string): Promise<Cue[]> {
  const url = `https://api.supadata.ai/v1/youtube/transcript?url=https://www.youtube.com/watch?v=${videoId}&lang=en`;
  let res = await fetch(url, { headers: { 'x-api-key': apiKey } });
  if (res.status === 404) {
    res = await fetch(`${url}&mode=generate`, { headers: { 'x-api-key': apiKey } });
  }
  if (!res.ok) throw new Error(`Supadata ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const data = await res.json();
  return (data.content ?? []).map((c: any) => ({ start: c.offset / 1000, dur: (c.duration ?? 0) / 1000, text: String(c.text).trim() }));
}
