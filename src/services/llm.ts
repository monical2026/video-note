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

/** 剥离 LLM 可能包裹的 markdown 代码围栏 */
const stripFence = (s: string): string => s.replace(/^```(?:json)?\s*/m, '').replace(/\s*```\s*$/m, '').trim();

/**
 * 要求模型返回 JSON 并可靠解析。
 * 解析失败时带错误信息自修复重试一次（2026-09-11 用户实测：LLM 输出字符串内裸引号致
 * "Expected property name in JSON at position 9132" 直抛用户）——把 parse 错误与原文
 * 喂回模型修正；二次仍失败则如实抛出，不再静默吞。
 */
export async function chatJson<T>(config: LlmConfig, messages: { role: string; content: string }[]): Promise<T> {
  const sys = { role: 'system', content: '只输出 JSON，不要输出其他内容。' };
  const raw = await chat(config, [...messages, sys]);
  const stripped = stripFence(raw);
  try {
    return JSON.parse(stripped) as T;
  } catch (e) {
    const fix = await chat(config, [
      { role: 'user', content: `以下内容应当是合法 JSON，但解析失败：${(e as Error).message}\n\n原文：\n${stripped}\n\n请只输出修正后的完整 JSON（字符串值内的双引号必须转义为 \\"，无尾随逗号、无注释）。` },
      sys,
    ]);
    return JSON.parse(stripFence(fix)) as T;
  }
}
