import type { Cue, LlmConfig } from '../types';
import { chatJson } from './llm';

/** LLM 批量翻译：编号对齐，长度不符自动重试一次 */
export async function llmTranslateBatch(config: LlmConfig, texts: string[]): Promise<string[]> {
  const numbered = texts.map((t, i) => `${i + 1}. ${t}`).join('\n');
  const messages = [
    { role: 'system', content: '你是专业技术翻译。把用户给出的编号英文句子逐句翻译成简体中文，技术术语首次出现时在括号内保留英文。输出 JSON：{"t":["第一句译文","第二句译文",...]}，数组长度必须等于输入句数，顺序一致。' },
    { role: 'user', content: numbered },
  ];
  for (let attempt = 0; attempt < 2; attempt++) {
    const r = await chatJson<{ t: string[] }>(config, messages);
    if (Array.isArray(r.t) && r.t.length === texts.length) return r.t.map(String);
  }
  throw new Error('LLM 翻译返回长度不符');
}

/** LLM 纠错润色：修正字幕专有名词/标点，时间戳不变 */
export async function polishTranscript(config: LlmConfig, cues: Cue[]): Promise<Cue[]> {
  const r = await chatJson<{ lines: string[] }>(config, [
    { role: 'system', content: '以下是语音识别字幕，存在专有名词拼写与标点问题。逐条修正：补标点、修正术语拼写、不改写含义、不合并不拆分。输出 JSON：{"lines":["...", ...]}，长度与输入严格相等。' },
    { role: 'user', content: JSON.stringify(cues.map((c) => c.text)) },
  ]);
  if (r.lines.length !== cues.length) throw new Error('润色返回长度不符');
  return cues.map((c, i) => ({ ...c, text: String(r.lines[i]) }));
}
