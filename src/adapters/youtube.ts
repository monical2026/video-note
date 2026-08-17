import type { Cue } from '../types';
import { parseJson3, parseTimedtextXml } from './timedtext';

export interface CaptionTrack { baseUrl: string; lang: string; kind: string } // kind: 'asr'=自动 | ''=手动

/** 从 watch 页 HTML 提取 caption 轨道列表（content script 同域 fetch 后调用） */
export function extractCaptionTracks(html: string): CaptionTrack[] {
  const m = html.match(/ytInitialPlayerResponse\s*=\s*(\{.+?\})\s*;/s);
  if (!m) return [];
  try {
    const pr = JSON.parse(m[1]!);
    const list = pr?.captions?.playerCaptionsTracklistRenderer?.captionTracks ?? [];
    return list.map((t: any) => ({ baseUrl: t.baseUrl, lang: t.languageCode, kind: t.kind ?? '' }));
  } catch { return []; }
}

/** 从 watch 页 HTML 提取视频元信息 */
export function extractVideoMeta(html: string, url: string): { videoId: string; title: string; channel: string } {
  const m = html.match(/ytInitialPlayerResponse\s*=\s*(\{.+?\})\s*;/s);
  const pr = m ? JSON.parse(m[1]!) : {};
  const videoId = pr?.videoDetails?.videoId ?? new URL(url).searchParams.get('v') ?? '';
  return { videoId, title: pr?.videoDetails?.title ?? (typeof document !== 'undefined' ? document.title : ''), channel: pr?.videoDetails?.author ?? '' };
}

/** 抓取字幕内容：json3 优先，XML 兜底（须在页面上下文执行以携带 potoken 会话） */
export async function fetchCueTrack(baseUrl: string): Promise<Cue[]> {
  const res = await fetch(`${baseUrl}&fmt=json3`);
  if (res.ok) {
    const cues = parseJson3(await res.json());
    if (cues.length) return cues;
  }
  const xmlRes = await fetch(baseUrl);
  if (!xmlRes.ok) throw new Error(`timedtext ${xmlRes.status}`);
  return parseTimedtextXml(await xmlRes.text());
}
