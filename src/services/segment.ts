import type { Cue } from '../types';

/**
 * 分段引擎 v2（两层流水线，2026-08-28 用户参考规范定案）：
 *   层 1 分句：碎行 → 完整句子（CUT/KEEP 决策表）——句子边界只由标点/停顿/说话人决定，
 *             字符数与时长绝不参与（人会说 25 秒的长句，"Yes." 4 个字符也是完整句子）
 *   层 2 组段：句子 → 阅读段落（软限制）——换段只落在已确认的句尾，绝不从句中强切
 * 保守总原则：宁可多拼一点，绝不把半句切开。
 */

// ===== 层 1 信号 =====
/** 假句号：缩写结尾（Dr. / Mr. / e.g. / U.S. …）不算句尾 */
const FALSE_STOP = /(?:\b(?:Dr|Mr|Mrs|Ms|Prof|Sr|Jr|St|vs|etc|approx|Inc|Ltd|Fig|No|Vol|e\.g|i\.e|U\.S|U\.K|a\.m|p\.m)\.)$/i;
/** 假句号：小数/版本号（3.14 / v1.2） */
const DECIMAL_DOT = /\d[.,]\d[\w.]*$/;
/** 强边界：. ? ! （允许收尾引号括号） */
const STRONG = /[.!?][)"'”’]?$/;
/** 弱边界：, ; : — – … */
const WEAK = /[,;:—–…][)"'”’]?$/;
/** 未闭合引号/括号（话还在引号里） */
const OPEN_BRACKET = /["'“‘(][^)"'”’]*$/;
/** 句尾续接词：句子没说完 */
const CONT_TAIL = /\b(?:and|but|or|nor|so|yet|because|that|which|who|whom|whose|if|when|while|since|though|although|unless|until|whereas|to|of|with|for|from|into|onto|on|in|at|by|up|down|off|out|over|under|than|as)\s*$/i;
/** 下一条以续接词开头（且前一条无句号）→ 同一句 */
const CONT_HEAD = /^\s*(?:and|but|or|nor|so|yet|because|which|who|if|when|while|to|of|with|for)\b/i;
/** 新句开头启发：大写/引号后大写，或代词与话语标记 */
const STARTER = /^(?:["'“‘]?[A-Z]|\b(?:I|We|You|He|She|They|It|This|That|These|Those|There|Here|What|When|Where|Why|How|Let|OK|Okay|Well|Now|First|Next|So)\b)/;

const stripSpeaker = (t: string) => t.replace(/^>>\s*/, '');
const words = (t: string) => t.split(/\s+/).filter(Boolean).length;
const nonSpace = (t: string) => t.replace(/\s+/g, '').length;
/** 真句尾：强边界且非假句号 */
const isTrueStop = (t: string) => STRONG.test(t) && !FALSE_STOP.test(t) && !DECIMAL_DOT.test(t);

export interface Sentence {
  start: number; end: number; text: string;
  complete: boolean;         // 以真句尾终止
  speakerBreak?: boolean;    // 由 >> 说话人切换开始
  nextGap?: number;          // 本句末到下一句首的空隙（秒）
}

/**
 * 条内预切：Whisper 等转写服务的单条 content 可能内含多个句子（一条挤几句话），
 * 决策表只在条间判断、从不拆条内 → 整条巨块被当成"一个句子"进组段 → 一大段一大段。
 * 这里先把条内句号切开，时间按字符比例线性分摊（近似）；
 * 假句号误切（e.g.）会被层 1 的 KEEP 规则拼回（切开的小片时间连续、gap≈0）。
 * 根因修正（2026-09-02）：YouTube json3 最常见形态是"每条恰一个句号切点"
 * （如 "deeply deeply technical. As the"）——此前在补尾前判 parts.length<=1 直接跳过，
 * 导致句子从未建立、组段规则全程空转 → 巨段。现在补尾后再判：只要切得出一句话+剩余就切。
 */
function preSplit(cues: Cue[]): Cue[] {
  const out: Cue[] = [];
  for (const c of cues) {
    const text = c.text.trim();
    // 切点要求句尾符后跟空白或结尾（前瞻不消耗）：排除 3.14 / v1.2 这类点后无空格的小数/版本号
    const parts = text.match(/[^.!?]+[.!?]+["')”’]?(?=\s|$)/g);
    if (!parts) { out.push(c); continue; }
    // 尾部可能无句号（如 "technical. As the" 的 "As the"）——match 不含它，必须补上防丢字
    const consumed = parts.reduce((n, p) => n + p.length, 0);
    if (consumed < text.length) parts.push(text.slice(consumed));
    if (parts.length <= 1) { out.push(c); continue; }   // 整条就是一句：原样
    const totalChars = parts.reduce((n, p) => n + p.length, 0);
    let acc = 0;
    for (const p of parts) {
      const frac = p.length / totalChars;
      out.push({ start: c.start + acc * c.dur, dur: frac * c.dur, text: p.trim() });
      acc += frac;
    }
  }
  return out;
}

/** 纯非语言标记行：[laughter] / [music] / [clears throat] 等；允许一行多个标记（[cheering] [applause]） */
const NONVERBAL = /^(?:\[+[^\][]{0,40}\]+\s*)+$/;

/**
 * 非语言标记并段（2026-09-02 用户定案）：纯标记行不单独成段——笑声/音乐属于刚才内容的反应，
 * 并入前一条尾部；开头的标记（无前行）并入后一条头部。
 */
function mergeNonverbal(cues: Cue[]): Cue[] {
  const out: Cue[] = [];
  for (const c of cues) {
    const t = c.text.trim();
    if (NONVERBAL.test(t) && out.length) {
      const prev = out[out.length - 1]!;
      out[out.length - 1] = { ...prev, text: `${prev.text} ${t}` };
    } else {
      out.push(c);
    }
  }
  // 前导标记并入第一个非标记行
  const lead: string[] = [];
  while (out.length > 1 && NONVERBAL.test(out[0]!.text.trim())) {
    lead.push(out.shift()!.text.trim());
  }
  if (lead.length && out.length) {
    out[0] = { ...out[0]!, text: `${lead.join(' ')} ${out[0]!.text}` };
  }
  return out;
}

/**
 * 层 1：碎行 → 句子。对每对相邻碎行按优先级决策 KEEP/CUT：
 *  1 >> 切换 → CUT；2 真句尾 → CUT；3 弱边界/续接词结尾/未闭合 → KEEP；
 *  4 下一条续接词开头（前无句号）→ KEEP；5 gap<0.7s → KEEP；
 *  6 gap≥1.5s → 候选断句三条件；7 默认 KEEP（保守）
 */
export function sentencesFromCues(rawCues: Cue[]): Sentence[] {
  const cues = mergeNonverbal(preSplit(rawCues));   // 条内预切开句 → 非语言标记并段 → 决策表
  const out: Sentence[] = [];
  let buf: { start: number; end: number; text: string; speakerStart: boolean }[] = [];
  const flush = () => {
    if (!buf.length) return;
    const text = buf.map((b) => stripSpeaker(b.text).trim()).filter(Boolean).join(' ');
    if (text) {
      out.push({
        start: buf[0]!.start,
        end: buf.at(-1)!.end,
        text,
        complete: isTrueStop(buf.at(-1)!.text.trim()),
        speakerBreak: buf[0]!.speakerStart,
      });
    }
    buf = [];
  };
  for (let i = 0; i < cues.length; i++) {
    const c = cues[i]!;
    const isSpeaker = /^>>/.test(c.text.trim());
    if (isSpeaker && buf.length) flush();   // >> 起新句（上一句先收）
    buf.push({ start: c.start, end: c.start + c.dur, text: c.text, speakerStart: isSpeaker });
    const next = cues[i + 1];
    const curTail = c.text.trim();
    const gap = next ? next.start - (c.start + c.dur) : Infinity;
    let cut = false;
    if (next) {
      if (/^>>/.test(next.text.trim())) cut = true;                    // 1 说话人切换
      else if (isTrueStop(curTail)) cut = true;                        // 2 真句尾
      else if (WEAK.test(curTail) || OPEN_BRACKET.test(c.text) || CONT_TAIL.test(curTail)) cut = false; // 3
      else if (CONT_HEAD.test(next.text)) cut = false;                 // 4
      else if (gap < 0.7) cut = false;                                 // 5
      else if (gap >= 1.5) {                                           // 6 候选断句三条件
        const acc = buf.map((b) => b.text).join(' ');
        const endsClean = !WEAK.test(curTail) && !CONT_TAIL.test(curTail);
        const startsNew = STARTER.test(next.text.trim());
        cut = (words(acc) >= 8 || nonSpace(acc) >= 40) && endsClean && startsNew;
      } else cut = false;                                              // 7 保守默认
    }
    if (cut) flush();
  }
  flush();
  // 补句间空隙（组段层"句后长停顿换段"用）
  for (let k = 0; k < out.length; k++) {
    out[k]!.nextGap = k + 1 < out.length ? out[k + 1]!.start - out[k]!.end : Infinity;
  }
  return out;
}

// ===== 层 2 组段（软限制）=====
const MIN_CHARS = 60;        // 段落下限：不够就并入下一句
const MAX_SENTS = 2;         // 满 2 句即换（2026-09-02 用户定案：按 1~2 句一段）
const HARD_CHARS = 220;      // 到此必换（仍在句尾）
const MAX_SPAN_S = 18;       // 时长到此必换（仍在句尾）
const GAP_BREAK = 2.8;       // 句后长停顿 → 换段
const SOFT_CHARS = 320;      // 软上限：只在下一个句尾换，绝不句中切
const SOFT_SPAN_S = 20;

/** 是否在此句之后换段（当前段信息 + 本句） */
function shouldBreakParagraph(segChars: number, segSpan: number, completeCount: number, s: Sentence): boolean {
  if (segChars < MIN_CHARS) return false;                       // 段太小：继续并
  if ((s.nextGap ?? Infinity) >= GAP_BREAK) return true;        // 句后长停顿
  if (completeCount >= MAX_SENTS) return true;                  // 满 2 句即换
  if (segChars >= HARD_CHARS) return true;                      // 字符上限（句尾）
  if (segSpan >= MAX_SPAN_S) return true;                       // 时长上限（句尾）
  if ((segChars > SOFT_CHARS || segSpan > SOFT_SPAN_S) && s.complete) return true; // 软上限：下个句尾换
  return false;
}

/**
 * 层 2：句子 → 阅读段落。
 * breakpoints（可选）：AI 分段给出的"该句之后换段"句子索引（1 起，全片统一）——提供时替代规则换段（>> 与段太小仍生效）。
 */
export function sentencesToParagraphs(sentences: Sentence[], breakpoints?: number[]): Cue[] {
  const bp = new Set(breakpoints ?? []);
  const out: Cue[] = [];
  let buf: Sentence[] = [];
  const flush = () => {
    if (!buf.length) return;
    out.push({
      start: buf[0]!.start,
      dur: buf.at(-1)!.end - buf[0]!.start,
      text: buf.map((s) => s.text).join(' '),
    });
    buf = [];
  };
  sentences.forEach((s, idx) => {
    buf.push(s);
    const segChars = buf.reduce((n, b) => n + b.text.length, 0);
    const segSpan = s.end - buf[0]!.start;
    const completeCount = buf.filter((b) => b.complete).length;
    const byAi = bp.has(idx + 1);
    // 下一句由 >> 说话人切换开始 → 本段必须在此收尾（绝不合并不同说话人）
    const nextSpeaker = !!sentences[idx + 1]?.speakerBreak;
    if (nextSpeaker || byAi || shouldBreakParagraph(segChars, segSpan, completeCount, s)) flush();
  });
  flush();
  return out;
}

/** 全流程：碎行 → 段落（规则模式入口） */
export function mergeCues(cues: Cue[]): Cue[] {
  return sentencesToParagraphs(sentencesFromCues(cues));
}
