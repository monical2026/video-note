import type { Cue, LlmConfig, Term } from '../types';
import { chatJson, chatStream } from './llm';

/** 流式进度回调：batch 当前批（1 起）/ batchTotal 总批数 / text 当前批累积文本（逐字增长） */
export interface StreamInfo { batch: number; batchTotal: number; text: string; }
export type OnStream = (info: StreamInfo) => void;

/** LLM 批量翻译：风格保留（口译员式——口语译口语、保留语气色彩）+ 术语表全片统一；编号行协议（流式可读） */
const TRANSLATE_BATCH_CHARS = 3000; // 配合 max_tokens 4096：中文输出 ≈ 英文字符数，3000 字符批的输出不超限

export async function llmTranslateBatch(config: LlmConfig, texts: string[], terms?: Term[], onStream?: OnStream): Promise<string[]> {
  if (!texts.length) return [];
  // 段落（可能数百字符）按累计字符预算分组逐组请求，防单次超上下文/超输出上限
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
  const system = `你是专业口译员。把用户给出的编号英文段落译成自然简体中文：
1. 保留说话者的风格与语气：口语说的就译成自然口语，流畅但不装腔、不强行书面化
2. 保留犹豫、强调、幽默、严肃等语气色彩，不抹平
3. 术语表（若有）必须严格遵守，全片保持统一译法
4. 代码、品牌名、产品名、API、模型名保留英文（或"中文（英文）"形式）
5. 不改变事实、数字、因果关系；不补充原文没有的信息；不把不确定表述改成确定结论；不删除有表达意义的重复；用中文最自然的说法，不逐字硬译

输出格式（纯文本，每条一行）："序号. 中文译文"，序号从 1 连续编号到输入条数，译文内不要换行，不要输出任何其他内容。${glossary}`;

  const out: string[] = [];
  for (let gi = 0; gi < groups.length; gi++) {
    const g = groups[gi]!;
    const numbered = g.map((t, i) => `${i + 1}. ${t}`).join('\n');
    let done: string[] | null = null;
    for (let attempt = 0; attempt < 2; attempt++) {
      const raw = await chatStream(config, [
        { role: 'system', content: system },
        { role: 'user', content: numbered },
      ], (acc) => onStream?.({ batch: gi + 1, batchTotal: groups.length, text: acc }));
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

/** 术语表提取：首次 LLM 翻译前跑一次（独立小请求，输出小不截断），之后每批注入保证全片统一译法 */
export async function extractTerms(config: LlmConfig, cues: Cue[]): Promise<Term[]> {
  const corpus = cues.map((c) => c.text).join('\n').slice(0, 24000);
  const r = await chatJson<{ terms: { en: string; zh: string }[] }>(config, [
    { role: 'system', content: '从英文讲稿中提取术语表：专有名词、技术术语、产品名 → 推荐中文译法；代码、品牌名、产品名、API、模型名保留英文不译。输出 JSON：{"terms":[{"en":"...","zh":"..."}]}' },
    { role: 'user', content: corpus },
  ]);
  const seen = new Map<string, string>();
  for (const t of r?.terms ?? []) if (t?.en && t?.zh) seen.set(String(t.en), String(t.zh));
  return [...seen.entries()].map(([en, zh]) => ({ en, zh }));
}
