import { describe, expect, it, vi, afterEach } from 'vitest';
import { llmTranslateBatch, polishTranscript } from './llm-translate';

afterEach(() => vi.unstubAllGlobals());
const cfg = { baseUrl: 'https://x/v1', apiKey: 'k', model: 'm' };
const stub = (payload: any) => {
  const f = vi.fn(async () => ({ ok: true, json: async () => ({ choices: [{ message: { content: JSON.stringify(payload) } }] }) }) as any);
  vi.stubGlobal('fetch', f);
  return f;
};

it('批量翻译：按编号对齐返回', async () => {
  stub({ t: ['译1', '译2'] });
  expect(await llmTranslateBatch(cfg, ['a', 'b'])).toEqual(['译1', '译2']);
});

it('批量翻译：空输入直接返回空数组不发请求', async () => {
  const f = stub({ t: [] });
  expect(await llmTranslateBatch(cfg, [])).toEqual([]);
  expect(f).not.toHaveBeenCalled();
});

it('批量翻译：术语表注入 prompt（全片统一译法）', async () => {
  const f = stub({ t: ['闭包捕获状态'] });
  await llmTranslateBatch(cfg, ['closures capture state'], [{ en: 'closure', zh: '闭包' }]);
  const body = JSON.parse((f.mock.calls[0] as any[])[1]!.body as string);
  const system = body.messages.find((m: any) => m.role === 'system')!.content as string;
  expect(system).toContain('closure → 闭包');
  expect(system).toContain('术语表');
});

it('批量翻译：段落按字符预算分批请求，结果按序拼接', async () => {
  // 分批推演：['x'*4000] 单独成批（加 'y'*4000 超 6000）；['y'*4000, 'z'*10] 累计 4010 同批
  const payloads = [{ t: ['译A'] }, { t: ['译B1', '译B2'] }];
  let call = 0;
  const f = vi.fn(async () => ({ ok: true, json: async () => ({ choices: [{ message: { content: JSON.stringify(payloads[call++]!) } }] }) }) as any);
  vi.stubGlobal('fetch', f);
  const texts = ['x'.repeat(4000), 'y'.repeat(4000), 'z'.repeat(10)];
  const out = await llmTranslateBatch(cfg, texts);
  expect(f).toHaveBeenCalledTimes(2);
  expect(out).toEqual(['译A', '译B1', '译B2']);
});

it('润色 v2：分段合并（start=段首 / dur 累加）+ 术语表产出', async () => {
  stub({
    segments: [{ from: 1, to: 2, text: 'Polished paragraph one.' }, { from: 3, to: 4, text: 'Paragraph two.' }],
    terms: [{ en: 'closure', zh: '闭包' }],
  });
  const cues = [
    { start: 1, dur: 2, text: 'um so closure' },
    { start: 3, dur: 2, text: 'captures state' },
    { start: 5, dur: 1, text: 'and second' },
    { start: 6, dur: 2, text: 'topic here' },
  ];
  const out = await polishTranscript(cfg, cues);
  expect(out.cues.map((c) => c.text)).toEqual(['Polished paragraph one.', 'Paragraph two.']);
  expect(out.cues.map((c) => c.start)).toEqual([1, 5]);
  expect(out.cues.map((c) => c.dur)).toEqual([4, 3]);
  expect(out.terms).toEqual([{ en: 'closure', zh: '闭包' }]);
});

it('润色 v2：区间缺口与非法段兜底为原文自成段（不丢行）', async () => {
  stub({
    segments: [
      { from: 1, to: 1, text: 'Fixed one.' },  // 只覆盖第 1 行，2/3 行成缺口
      { from: 3, to: 2, text: 'bad range' },   // from>to：丢弃
      { from: 9, to: 9, text: 'out of range' }, // 越界：丢弃
    ],
    terms: [],
  });
  const cues = [
    { start: 1, dur: 1, text: 'line one' },
    { start: 2, dur: 1, text: 'line two' },
    { start: 3, dur: 1, text: 'line three' },
  ];
  const out = await polishTranscript(cfg, cues);
  expect(out.cues.map((c) => c.text)).toEqual(['Fixed one.', 'line two', 'line three']);
  expect(out.cues.map((c) => c.start)).toEqual([1, 2, 3]);
});

it('润色 v2：超批大小分批调用，术语跨批去重', async () => {
  // 65 行 → 2 批（60+5）；fetch 按调用序返回不同 payload
  const payloads = [
    { segments: [{ from: 1, to: 60, text: 'batch one merged' }], terms: [{ en: 'closure', zh: '闭包' }] },
    { segments: [{ from: 61, to: 65, text: 'batch two merged' }], terms: [{ en: 'closure', zh: '闭包' }, { en: 'hoisting', zh: '提升' }] },
  ];
  let call = 0;
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ choices: [{ message: { content: JSON.stringify(payloads[call++]!) } }] }) }) as any));
  const cues = Array.from({ length: 65 }, (_, i) => ({ start: i, dur: 1, text: `l${i}` }));
  const out = await polishTranscript(cfg, cues);
  expect(out.cues.map((c) => c.text)).toEqual(['batch one merged', 'batch two merged']);
  expect(out.terms).toEqual([{ en: 'closure', zh: '闭包' }, { en: 'hoisting', zh: '提升' }]);
});
