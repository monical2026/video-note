import { describe, expect, it, vi, afterEach } from 'vitest';
import { llmTranslateBatch, polishTranscript } from './llm-translate';

afterEach(() => vi.unstubAllGlobals());
const cfg = { baseUrl: 'https://x/v1', apiKey: 'k', model: 'm' };
const stub = (payload: any) =>
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ choices: [{ message: { content: JSON.stringify(payload) } }] }) }) as any));

it('批量翻译：按编号对齐返回', async () => {
  stub({ t: ['译1', '译2'] });
  expect(await llmTranslateBatch(cfg, ['a', 'b'])).toEqual(['译1', '译2']);
});

it('润色：仅改文本，时间戳与条数不变', async () => {
  stub({ lines: ['Hello, world.', 'Closure captures state.'] });
  const cues = [{ start: 1, dur: 1, text: 'hello world' }, { start: 2, dur: 1, text: 'closure capture state' }];
  const out = await polishTranscript(cfg, cues);
  expect(out.map((c) => c.text)).toEqual(['Hello, world.', 'Closure captures state.']);
  expect(out.map((c) => c.start)).toEqual([1, 2]);
});
