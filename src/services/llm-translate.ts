import type { Cue, LlmConfig, Term } from '../types';
import { chatJson } from './llm';

/** LLM 批量翻译 v2：自然中文 + 术语表全片统一 + 段落按字符预算分批；编号对齐，长度不符自动重试一次 */
const TRANSLATE_BATCH_CHARS = 6000;

export async function llmTranslateBatch(config: LlmConfig, texts: string[], terms?: Term[]): Promise<string[]> {
  if (!texts.length) return [];
  // 润色 v2 后每条是一段（可能数百字符），按累计字符预算分组逐组请求，防单次超上下文
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
输出 JSON：{"t":["第一段译文","第二段译文",...]}，数组长度必须等于输入条数，顺序一致。${glossary}`;

  const out: string[] = [];
  for (const g of groups) {
    const numbered = g.map((t, i) => `${i + 1}. ${t}`).join('\n');
    let done: string[] | null = null;
    for (let attempt = 0; attempt < 2; attempt++) {
      const r = await chatJson<{ t: string[] }>(config, [
        { role: 'system', content: system },
        { role: 'user', content: numbered },
      ]);
      if (Array.isArray(r.t) && r.t.length === g.length) { done = r.t.map(String); break; }
    }
    if (!done) throw new Error('LLM 翻译返回长度不符');
    out.push(...done);
  }
  return out;
}

/** LLM 纠错润色 v2：一句一行 → 按语义分段合并 + 产出全片统一术语表（用户规格：去填充词/修断句/按语义分段/保语气/红线） */
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

同时提取术语表 terms：英文术语 → 推荐中文译法；代码、品牌名、产品名、API、模型名保留英文不译。

输出 JSON：
{"segments":[{"from":起始行号,"to":结束行号(含),"text":"该段整理后的英文"}],"terms":[{"en":"...","zh":"..."}]}
行号用输入给出的全局行号；segments 按行号单调递增，覆盖输入的每一行，不重叠、不留缺口；text 为整理后的英文段落。`;

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

export async function polishTranscript(config: LlmConfig, cues: Cue[]): Promise<{ cues: Cue[]; terms: Term[] }> {
  const outCues: Cue[] = [];
  const termMap = new Map<string, string>();
  for (let i = 0; i < cues.length; i += POLISH_BATCH_LINES) {
    const batch = cues.slice(i, i + POLISH_BATCH_LINES);
    const numbered = batch.map((c, j) => `${i + j + 1}. ${c.text}`).join('\n');
    const r = await chatJson<{ segments: { from: number; to: number; text: string }[]; terms: { en: string; zh: string }[] }>(config, [
      { role: 'system', content: POLISH_SYSTEM },
      { role: 'user', content: numbered },
    ]);
    outCues.push(...segmentsToCues(batch, r?.segments ?? [], i));
    for (const t of r?.terms ?? []) if (t?.en && t?.zh) termMap.set(String(t.en), String(t.zh));
  }
  return { cues: outCues, terms: [...termMap.entries()].map(([en, zh]) => ({ en, zh })) };
}
