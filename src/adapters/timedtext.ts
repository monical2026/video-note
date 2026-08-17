import { DOMParser } from 'linkedom';
import type { Cue } from '../types';

/** YouTube json3 格式 → Cue[] */
export function parseJson3(json: any): Cue[] {
  const out: Cue[] = [];
  for (const ev of json?.events ?? []) {
    const text = (ev.segs ?? []).map((s: any) => s.utf8 ?? '').join('').trim();
    if (!text) continue;
    out.push({ start: ev.tStartMs / 1000, dur: (ev.dDurationMs ?? 0) / 1000, text });
  }
  return out;
}

const ENTITIES: Record<string, string> = { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'", '&apos;': "'", '&#39': "'" };

/** YouTube timedtext XML → Cue[] */
export function parseTimedtextXml(xml: string): Cue[] {
  const doc = new DOMParser().parseFromString(xml, 'text/xml');
  return [...doc.getElementsByTagName('text')]
    .map((t) => ({
      start: Number(t.getAttribute('start')),
      dur: Number(t.getAttribute('dur') ?? 0),
      text: (t.textContent ?? '').replace(/&#39;?|&\w+;/g, (e: string) => ENTITIES[e] ?? e).trim(),
    }))
    .filter((c) => c.text);
}
