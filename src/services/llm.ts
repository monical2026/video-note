import type { LlmConfig } from '../types';

// 输出上限：显式声明防止服务端默认值过小截断长输出（润色/翻译批次输出较大；各家普遍支持 4096）
const MAX_TOKENS = 4096;

/** OpenAI 兼容 chat/completions（key 仅从设置读取，不落日志） */
export async function chat(
  config: LlmConfig,
  messages: { role: string; content: string }[],
  opts: { temperature?: number } = {},
): Promise<string> {
  const res = await fetch(`${config.baseUrl.replace(/\/$/, '')}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${config.apiKey}` },
    body: JSON.stringify({ model: config.model, messages, temperature: opts.temperature ?? 0, max_tokens: MAX_TOKENS }),
  });
  if (!res.ok) throw new Error(`LLM ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const data = await res.json();
  return data.choices?.[0]?.message?.content ?? '';
}

/**
 * 流式版 chat（stream:true + SSE）：逐 token 回调 onDelta（参数为累积全文，UI 直接替换显示即可），
 * 返回值为完整文本。OpenAI/DeepSeek/智谱兼容同一种 SSE 格式（data: {...} / [DONE]）。
 */
export async function chatStream(
  config: LlmConfig,
  messages: { role: string; content: string }[],
  onDelta?: (accumulated: string) => void,
  opts: { temperature?: number } = {},
): Promise<string> {
  const res = await fetch(`${config.baseUrl.replace(/\/$/, '')}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${config.apiKey}` },
    body: JSON.stringify({ model: config.model, messages, temperature: opts.temperature ?? 0, max_tokens: MAX_TOKENS, stream: true }),
  });
  if (!res.ok) throw new Error(`LLM ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const reader = (res.body as ReadableStream<Uint8Array>).getReader();
  const decoder = new TextDecoder();
  let buf = '';
  let full = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    // SSE 按行分帧：一行可能被拆到多个网络 chunk，缓冲不完整行等下一个 chunk 拼满
    buf += decoder.decode(value, { stream: true });
    const lines = buf.split('\n');
    buf = lines.pop() ?? '';
    for (const line of lines) {
      const t = line.trim();
      if (!t.startsWith('data:')) continue;
      const payload = t.slice(5).trim();
      if (!payload || payload === '[DONE]') continue;
      try {
        const delta = JSON.parse(payload)?.choices?.[0]?.delta?.content;
        if (typeof delta === 'string' && delta) { full += delta; onDelta?.(full); }
      } catch { /* 半行 JSON：留给下一个 chunk 拼完再解析 */ }
    }
  }
  return full;
}

/** 要求模型返回 JSON 并可靠解析 */
export async function chatJson<T>(config: LlmConfig, messages: { role: string; content: string }[]): Promise<T> {
  const raw = await chat(config, [...messages, { role: 'system', content: '只输出 JSON，不要输出其他内容。' }]);
  const stripped = raw.replace(/^```(?:json)?\s*/m, '').replace(/\s*```\s*$/m, '').trim();
  return JSON.parse(stripped) as T;
}
