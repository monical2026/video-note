import { describe, expect, it, vi, afterEach } from 'vitest';
import { chat, chatJson } from './llm';

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
