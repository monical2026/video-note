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
    ? `\n【术语表】（必须严格遵守，全片统一译法）：\n${terms.map((t) => `${t.en} → ${t.zh}`).join('\n')}`
    : '';
  // 翻译规范 v3.1（2026-08-27 用户提供）：通用基础规则 + 中文规则；术语表与事实红线保留
  const system = `你是专业口译员，把用户给出的编号英文段落译成简体中文。严格遵守以下规则。

【通用基础规则】
- 完全匹配原文的语气和表达风格（口语保持口语，正式保持正式）
- 使用自然的中文句式——不要逐字按照英文语法翻译
- 不要翻译：专有名词、品牌名称、通常保留英文的技术术语（API、AI 等）、时间戳
- 保留原有格式标记（如项目符号）

【中文规则】
- 使用现代、口语化的简体中文。除非原文是正式风格，否则避免生硬的书面语。
- 使用自然的中文句式——不要照搬英文语法结构。
- 在决定最终中文表达之前，先理解完整的语义；不要因为源字幕被切分过，就机械地保留一个不完整的片段含义。
- 使用"你"，除非原文明确使用正式敬语，否则不要使用"您"。
- 面向聪明、熟悉科技和产品的用户来表达。像 AI、API、GitHub、Claude Code、Codex、skill、builder、deck 和 Chrome 这样的常见术语和产品名称，在自然情况下保留英文。
- 中文与相邻的英文单词或数字之间加入易读的空格，例如"使用 Claude Code"和"过去 6 个月"。
- 删除无实际意义的口头填充词，不要逐字翻译；但要保留真正表达的不确定性或强调语气。

【事实红线】
- 不改变事实、数字、因果关系；不补充原文没有的信息
- 不把不确定表述改成确定结论；不删除有表达意义的重复

输出格式：纯文本，每条一行，"序号. 中文译文"，序号从 1 连续编号到输入条数；译文内不要换行；不要输出任何其他内容。${glossary}`;

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
