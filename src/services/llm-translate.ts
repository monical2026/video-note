import type { Cue, LlmConfig, Term } from '../types';
import { chatJson, chatStream } from './llm';

/** 流式进度回调：phase 阶段 / batch 当前批（1 起）/ batchTotal 总批数 / text 当前批累积文本（逐字增长） */
export interface StreamInfo { phase: 'polish' | 'translate'; batch: number; batchTotal: number; text: string; }
export type OnStream = (info: StreamInfo) => void;

/** LLM 批量翻译 v3：自然中文 + 术语表全片统一；编号行协议（流式可读），长度不符自动重试一次 */
const TRANSLATE_BATCH_CHARS = 3000; // 配合 max_tokens 4096：中文输出 ≈ 英文字符数，3000 字符批的输出不超限

export async function llmTranslateBatch(config: LlmConfig, texts: string[], terms?: Term[], onStream?: OnStream): Promise<string[]> {
  if (!texts.length) return [];
  // 润色后每条是一段（可能数百字符），按累计字符预算分组逐组请求，防单次超上下文/超输出上限
  const groups: string[][] = [];
  let cur: string[] = [], curChars = 0;
  for (const t of texts) {
    if (cur.length && curChars + t.length > TRANSLATE_BATCH_CHARS) { groups.push(cur); cur = []; curChars = 0; }
    cur.push(t); curChars += t.length;
  }
  if (cur.length) groups.push(cur);

  const glossary = terms?.length
    ? `\n\n术语表（必须严格遵守，全片统一译法）：\n${terms.map((t) => `${t.en} → ${t.zh}`).join('\n')}`
    : '';
  const system = `你是专业技术翻译。把用户给出的编号英文段落逐条翻译成简体中文：
1. 用中文最自然、最清楚的说法，不逐字硬译
2. 术语表（若有）必须严格遵守，全片保持统一译法
3. 代码、品牌名、产品名、API、模型名保留英文（或"中文（英文）"形式）
4. 不改变事实、数字、因果关系；不补充原文没有的信息；不把不确定表述改成确定结论；保留说话者语气与有表达意义的重复；不过度书面化

输出格式（纯文本，每条一行）："序号. 中文译文"，序号从 1 连续编号到 ${'{}'} 内输入条数，译文内不要换行，不要输出任何其他内容。${glossary}`;

  const out: string[] = [];
  for (let gi = 0; gi < groups.length; gi++) {
    const g = groups[gi]!;
    const numbered = g.map((t, i) => `${i + 1}. ${t}`).join('\n');
    let done: string[] | null = null;
    for (let attempt = 0; attempt < 2; attempt++) {
      const raw = await chatStream(config, [
        { role: 'system', content: system.replace('{}', String(g.length)) },
        { role: 'user', content: numbered },
      ], (acc) => onStream?.({ phase: 'translate', batch: gi + 1, batchTotal: groups.length, text: acc }));
      done = parseNumberedLines(raw, g.length);
      if (done) break;
    }
    if (!done) throw new Error('LLM 翻译返回条数不符');
    out.push(...done);
  }
  return out;
}

/** 解析 "1. xx / 2. xx" 编号行协议；条数不符返回 null（触发上层重试） */
function parseNumberedLines(raw: string, expected: number): string[] | null {
  const out: string[] = [];
  for (const line of raw.split('\n')) {
    const m = line.match(/^\s*\d+\s*[.、:：]\s*(.*)$/);
    if (m && m[1]!.trim()) out.push(m[1]!.trim());
  }
  return out.length === expected ? out : null;
}

/** LLM 纠错润色 v3：一句一行 → 按语义分段合并（[from-to] 行协议，流式可读）；术语表由独立小请求产出 */
const POLISH_BATCH_LINES = 60;

const POLISH_SYSTEM = `你是英文视频字幕的整理编辑。用户给出带全局行号的口语转写字幕行，整理成可读讲稿。

必须做：
1. 删除 um / uh / er / you know / I mean / right? 等纯语气填充词
2. 把碎片化表达整理成完整句子：补足主谓宾和标点
3. 相邻行按语义合并成段（一般 2~6 行一段）：按意思分段，不按语音停顿硬切；段落长短照顾屏幕阅读节奏，不要过长
4. 根据上下文修正语音识别听错的单词、专有名词
5. 保留真正推动内容的连接词（but / so / because / for example 等）
6. 保留说话者的语气：犹豫、强调、保留态度，用更自然的文字表达

绝不做（红线）：
- 不改变数字、时间、人物、产品名和因果关系
- 不补充原视频没说过的信息
- 不把 I think / maybe / perhaps 等不确定表述改成确定结论
- 不删除有表达意义的重复（如刻意强调 "very, very important"）
- 不删除真实情绪或态度（犹豫、讽刺、激动、道歉）
- 不把口语全改成论文腔或营销腔，不为显得高级换词
- 不擅自总结、缩写、删减内容
- 不合并不同说话人的内容
- 听不清的内容写 [inaudible]，不猜成确定文本

输出格式（纯文本，每段一行）：
[起始行号-结束行号] 该段整理后的英文段落
行号用输入给出的全局行号；按行号单调递增，覆盖输入的每一行，不重叠、不留缺口；段落文本内不要换行；不要输出任何其他内容。`;

/** 区间 → 分段 Cue：非法段（from>to / 越界 / 空 text）丢弃，缺口行以原文自成段，保证一行不丢 */
function segmentsToCues(batch: Cue[], segments: { from: number; to: number; text: string }[], offset: number): Cue[] {
  const n = batch.length;
  const valid = segments
    .filter((s) => Number.isInteger(s?.from) && Number.isInteger(s?.to) && s.to >= s.from && s.from > offset && s.to <= offset + n && typeof s?.text === 'string' && s.text.trim())
    .map((s) => ({ lo: s.from - 1 - offset, hi: s.to - 1 - offset, text: s.text.trim() }))
    .sort((a, b) => a.lo - b.lo);
  const out: Cue[] = [];
  let cursor = 0;
  const fillGap = (toExclusive: number) => {
    for (let i = cursor; i < toExclusive; i++) out.push({ ...batch[i]! });
    cursor = Math.max(cursor, toExclusive);
  };
  for (const seg of valid) {
    if (seg.lo < cursor) continue; // 与前段重叠：丢弃（保守，行不重复消费）
    fillGap(seg.lo);
    const merged = batch.slice(seg.lo, seg.hi + 1);
    out.push({ start: merged[0]!.start, dur: merged.reduce((s, c) => s + c.dur, 0), text: seg.text });
    cursor = seg.hi + 1;
  }
  fillGap(n);
  return out;
}

/** 解析 "[from-to] text" 行协议 → 区间数组 */
function parseSegmentLines(raw: string): { from: number; to: number; text: string }[] {
  const segs: { from: number; to: number; text: string }[] = [];
  for (const line of raw.split('\n')) {
    const m = line.match(/^\s*\[(\d+)\s*-\s*(\d+)\]\s*(.+)$/);
    if (m) segs.push({ from: Number(m[1]), to: Number(m[2]), text: m[3]!.trim() });
  }
  return segs;
}

export async function polishTranscript(config: LlmConfig, cues: Cue[], onStream?: OnStream): Promise<{ cues: Cue[]; terms: Term[] }> {
  const outCues: Cue[] = [];
  const batchTotal = Math.ceil(cues.length / POLISH_BATCH_LINES);
  for (let i = 0; i < cues.length; i += POLISH_BATCH_LINES) {
    const batch = cues.slice(i, i + POLISH_BATCH_LINES);
    const numbered = batch.map((c, j) => `${i + j + 1}. ${c.text}`).join('\n');
    const raw = await chatStream(config, [
      { role: 'system', content: POLISH_SYSTEM },
      { role: 'user', content: numbered },
    ], (acc) => onStream?.({ phase: 'polish', batch: Math.floor(i / POLISH_BATCH_LINES) + 1, batchTotal, text: acc }));
    outCues.push(...segmentsToCues(batch, parseSegmentLines(raw), i));
  }
  // 术语表：独立小请求（输出小不截断）；失败不拖垮润色主体，返回空表
  let terms: Term[] = [];
  try {
    const corpus = outCues.map((c) => c.text).join('\n').slice(0, 24000);
    const r = await chatJson<{ terms: { en: string; zh: string }[] }>(config, [
      { role: 'system', content: '从英文讲稿中提取术语表：专有名词、技术术语、产品名 → 推荐中文译法；代码、品牌名、产品名、API、模型名保留英文不译。输出 JSON：{"terms":[{"en":"...","zh":"..."}]}' },
      { role: 'user', content: corpus },
    ]);
    const seen = new Map<string, string>();
    for (const t of r?.terms ?? []) if (t?.en && t?.zh) seen.set(String(t.en), String(t.zh));
    terms = [...seen.entries()].map(([en, zh]) => ({ en, zh }));
  } catch { /* 术语提取失败：空表继续 */ }
  return { cues: outCues, terms };
}
