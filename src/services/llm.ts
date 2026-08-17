import type { LlmConfig } from '../types';

/** OpenAI 兼容 chat/completions（key 仅从设置读取，不落日志） */
export async function chat(
  config: LlmConfig,
  messages: { role: string; content: string }[],
  opts: { temperature?: number } = {},
): Promise<string> {
  const res = await fetch(`${config.baseUrl.replace(/\/$/, '')}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${config.apiKey}` },
    body: JSON.stringify({ model: config.model, messages, temperature: opts.temperature ?? 0 }),
  });
  if (!res.ok) throw new Error(`LLM ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const data = await res.json();
  return data.choices?.[0]?.message?.content ?? '';
}

/** 要求模型返回 JSON 并可靠解析 */
export async function chatJson<T>(config: LlmConfig, messages: { role: string; content: string }[]): Promise<T> {
  const raw = await chat(config, [...messages, { role: 'system', content: '只输出 JSON，不要输出其他内容。' }]);
  const stripped = raw.replace(/^```(?:json)?\s*/m, '').replace(/\s*```\s*$/m, '').trim();
  return JSON.parse(stripped) as T;
}
