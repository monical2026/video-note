import { describe, expect, it, vi, afterEach } from 'vitest';
import { chat, chatJson, chatStream } from './llm';

afterEach(() => vi.unstubAllGlobals());
const cfg = { baseUrl: 'https://api.x.com/v1', apiKey: 'k', model: 'm' };

it('chat 发送 OpenAI 兼容请求并取回内容', async () => {
  vi.stubGlobal('fetch', vi.fn(async (url: string, init: any) => {
    expect(url).toBe('https://api.x.com/v1/chat/completions');
    const body = JSON.parse(init.body);
    expect(body.model).toBe('m'); expect(body.messages[0].role).toBe('user');
    expect(init.headers.Authorization).toBe('Bearer k');
    return { ok: true, json: async () => ({ choices: [{ message: { content: 'hi' } }] }) } as any;
  }));
  expect(await chat(cfg, [{ role: 'user', content: 'x' }])).toBe('hi');
});

it('chatJson 剥离代码围栏', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ choices: [{ message: { content: '```json\n{"a":1}\n```' } }] }) }) as any));
  expect(await chatJson(cfg, [])).toEqual({ a: 1 });
});

/** 把若干 delta 文本打包成 OpenAI 兼容 SSE 响应体（含无 content 的 role 首 chunk 与 [DONE]） */
function sseBody(deltas: string[]): ReadableStream<Uint8Array> {
  const enc = new TextEncoder();
  const chunks = [
    ...deltas.map((d) => enc.encode(`data: ${JSON.stringify({ choices: [{ delta: { content: d } }] })}\n\n`)),
    enc.encode(`data: ${JSON.stringify({ choices: [{ delta: { role: 'assistant' } }] })}\n\n`),
    enc.encode('data: [DONE]\n\n'),
  ];
  return new ReadableStream({
    start(c) { for (const ch of chunks) c.enqueue(ch); c.close(); },
  });
}

it('chatStream 逐字累积并回调，返回完整文本', async () => {
  const seen: string[] = [];
  // SSE delta 是增量片段：'闭包' + '是' + '函数' → 累积 '闭包是函数'
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, body: sseBody(['闭包', '是', '函数']) }) as any));
  const full = await chatStream(cfg, [{ role: 'user', content: 'hi' }], (t) => seen.push(t));
  expect(full).toBe('闭包是函数');
  expect(seen).toEqual(['闭包', '闭包是', '闭包是函数']);
});

it('chatStream 单行 SSE 被拆到多个网络 chunk 时不丢字（缓冲不完整行）', async () => {
  const enc = new TextEncoder();
  const line = `data: ${JSON.stringify({ choices: [{ delta: { content: 'hello' } }] })}\n\n`;
  const body = new ReadableStream({
    start(c) { c.enqueue(enc.encode(line.slice(0, 20))); c.enqueue(enc.encode(line.slice(20))); c.close(); },
  });
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, body }) as any));
  expect(await chatStream(cfg, [{ role: 'user', content: 'x' }])).toBe('hello');
});

it('chatStream 请求体带 stream:true 与 max_tokens', async () => {
  const f = vi.fn(async () => ({ ok: true, body: sseBody(['a']) }) as any);
  vi.stubGlobal('fetch', f);
  await chatStream(cfg, [{ role: 'user', content: 'x' }]);
  const body = JSON.parse((f.mock.calls[0] as any[])[1]!.body as string);
  expect(body.stream).toBe(true);
  expect(body.max_tokens).toBe(4096);
});

it('chatStream 非 2xx 抛错并携带状态码', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 429, text: async () => '{"error":"insufficient balance"}' }) as any));
  await expect(chatStream(cfg, [{ role: 'user', content: 'x' }])).rejects.toThrow('LLM 429');
});
