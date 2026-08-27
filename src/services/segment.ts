import type { Cue } from '../types';

/**
 * 程序化拼段：碎行 → 段落（零 LLM、零费用、确定性——文字一字不改，只决定哪里换段）。
 * 分段信号（按优先级）：
 * 1. `>>` 说话人切换：强制新段（`>>` 是转写标记不是话语，剔除）
 * 2. 时间空隙 ≥1.2s：说话人真的停顿了，且当前段已有完整句（句尾标点）→ 分段
 * 3. 句数目标：当前段已攒满 ≥2 个句尾标点且本行以句尾标点结束 → 分段
 * 4. 超长保护：段字符数 ≥1200 无条件分段（无标点 asr 的兜底，段落照顾屏幕阅读节奏）
 */
const GAP_SECONDS = 1.2;
const SENTENCES_PER_SEG = 2;
const MAX_SEG_CHARS = 1200;

const endsSentence = (t: string) => /[.!?]["')]?$/.test(t.trim());
const stripSpeakerMark = (t: string) => t.replace(/^>>\s*/, '');

export function mergeCues(cues: Cue[]): Cue[] {
  const out: Cue[] = [];
  let buf: Cue[] = [];
  const flush = () => {
    if (!buf.length) return;
    const text = buf.map((c) => stripSpeakerMark(c.text).trim()).filter(Boolean).join(' ');
    if (text) out.push({ start: buf[0]!.start, dur: buf.reduce((s, c) => s + c.dur, 0), text });
    buf = [];
  };
  for (let i = 0; i < cues.length; i++) {
    const c = cues[i]!;
    // 说话人切换：先收上一段，本行起新段
    if (/^>>/.test(c.text.trim()) && buf.length) flush();
    buf.push(c);
    const next = cues[i + 1];
    const sentenceCount = buf.reduce((s, b) => s + (endsSentence(b.text) ? 1 : 0), 0);
    const bufChars = buf.reduce((s, b) => s + b.text.length, 0);
    const gap = next ? next.start - (c.start + c.dur) : Infinity;
    if (endsSentence(c.text) && (sentenceCount >= SENTENCES_PER_SEG || gap >= GAP_SECONDS)) flush();
    else if (bufChars >= MAX_SEG_CHARS) flush(); // 超长保护：无标点流水的兜底断段
  }
  flush();
  return out;
}
