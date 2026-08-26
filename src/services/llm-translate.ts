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

/** LLM 纠错润色 v4：段首锚定（模型只抄一个起始行号，范围由代码从相邻锚推算）+ 批尾顺延；术语表独立小请求 */
const POLISH_BATCH_LINES = 60;

const POLISH_SYSTEM = `你是英文视频字幕的整理编辑。用户给出带 [行号] 的口语转写碎行（每次停顿一行，不是完整句子），请按语义把它们重建成可读讲稿。

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

分段判定标准：以语义连贯和语法连接结构为主要判据（but / because / so / that / which 等悬空开头的行必须与上一行相连成同一段）；字数、时间间隔、相似度只能作为辅助信号。

输出格式（纯文本，每段一行）：
行号|该段重建后的完整英文段落
行号照抄该段第一个碎行的 [行号]（抄输入里的数字，不要自己计算）；段落文本内不要换行；每段只输出一个起始行号，段的覆盖范围由系统按下一个段的行号自动推算，你不要输出结束行号。

批尾顺延：如果本批结尾处的行是一个新话语单元的开头、但话在本批内说不完（看不到结尾），不要硬凑成段——只为它输出一行「行号|»」，系统会连同原文带到下一批处理。若用户消息末尾注明这是最后一批，则所有行都必须归入段落，不允许输出 »。`;

/** 解析 "行号|段落文本" 锚点行；text 为 » 表示批尾顺延标记（defer=true） */
function parseAnchorLines(raw: string): { line: number; text: string; defer?: boolean }[] {
  const out: { line: number; text: string; defer?: boolean }[] = [];
  for (const line of raw.split('\n')) {
    const m = line.match(/^\s*(\d+)\s*\|\s*(.*)$/);
    if (m) {
      const text = m[2]!.trim();
      out.push(text === '»' ? { line: Number(m[1]), text: '', defer: true } : { line: Number(m[1]), text });
    }
  }
  return out;
}

/**
 * 锚点 → 分段 Cue。段的覆盖范围 = 本锚到下一锚（或批尾），由代码推算——模型只标段首。
 * 兜底（一行不丢）：中部缺口行、最后一批的尾部行 → 原文自成段。
 * 返回 next = 下一批起始索引：非最后一批遇到 » 时，从 » 行顺延（原文带回下一批重建语境）。
 */
function anchorsToSegments(cues: Cue[], anchors: { line: number; text: string; defer?: boolean }[], from: number, to: number, isLast: boolean): { segs: Cue[]; next: number } {
  const entries: { idx: number; text: string; defer: boolean }[] = [];
  for (const a of anchors) {
    if (a.defer && isLast) continue;                                           // 最后一批 » 无处顺延：忽略，该行起尾部兜底
    const idx = a.line - 1;
    if (!Number.isInteger(idx) || idx < from || idx >= to) continue;           // 越界丢弃
    if (entries.length && idx <= entries[entries.length - 1]!.idx) continue;   // 非递增丢弃
    entries.push({ idx, text: a.text, defer: !!a.defer });
  }
  const solid = entries.filter((e) => !e.defer);
  const segs: Cue[] = [];
  const pushRaw = (lo: number, hi: number) => { for (let r = lo; r < hi; r++) segs.push({ ...cues[r]! }); };
  // 无实体锚（垃圾输出 / 只有 »）：全批原文兜底强制推进，防死循环
  if (!solid.length) { pushRaw(from, to); return { segs, next: to }; }
  // » 只在尾部生效（其后若另有实体锚则 » 被忽略——实体优先）
  const lastSolidIdx = solid[solid.length - 1]!.idx;
  const deferIdx = entries.find((e) => e.defer && e.idx > lastSolidIdx)?.idx;
  let cursor = from;
  for (let k = 0; k < solid.length; k++) {
    const e = solid[k]!;
    if (e.idx > cursor) pushRaw(cursor, e.idx);                                // 中部缺口：原文兜底
    const segEnd = Math.min(solid[k + 1]?.idx ?? deferIdx ?? to, to);          // 覆盖到下一锚 / » 行前 / 批尾
    const merged = cues.slice(e.idx, segEnd);
    segs.push({ start: cues[e.idx]!.start, dur: merged.reduce((s, c) => s + c.dur, 0), text: e.text || cues[e.idx]!.text });
    cursor = segEnd;
  }
  if (deferIdx != null) return { segs, next: deferIdx };                       // 尾部顺延：» 行起留给下一批
  if (isLast) pushRaw(cursor, to);                                             // 最后一批尾部兜底（正常 cursor 已是 to）
  return { segs, next: cursor };
}

export async function polishTranscript(config: LlmConfig, cues: Cue[], onStream?: OnStream): Promise<{ cues: Cue[]; terms: Term[] }> {
  const outCues: Cue[] = [];
  let i = 0;      // 下一批起始行索引（顺延会回拨）
  let batchIdx = 0;
  while (i < cues.length) {
    const to = Math.min(i + POLISH_BATCH_LINES, cues.length);   // 顺延行计入批预算，批恒 ≤60 行
    const isLast = to >= cues.length;
    const numbered = cues.slice(i, to).map((c, j) => `[${i + j + 1}] ${c.text}`).join('\n');
    const batchTotal = batchIdx + 1 + Math.ceil((cues.length - to) / POLISH_BATCH_LINES);
    // 流式显示剥掉 "行号|" 前缀与 » 标记行，只留正文（解析仍用原始文本）
    const clean = (acc: string) => acc.replace(/^\s*\d+\s*\|\s*/gm, '').replace(/^\s*»\s*$/gm, '');
    const raw = await chatStream(config, [
      { role: 'system', content: POLISH_SYSTEM },
      { role: 'user', content: numbered + (isLast ? '\n\n（这是最后一批，所有行都必须归入段落）' : '') },
    ], (acc) => onStream?.({ phase: 'polish', batch: batchIdx + 1, batchTotal, text: clean(acc) }));
    const r = anchorsToSegments(cues, parseAnchorLines(raw), i, to, isLast);
    outCues.push(...r.segs);
    i = r.next;
    batchIdx++;
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
