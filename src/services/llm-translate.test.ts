import { describe, expect, it, vi, afterEach } from 'vitest';
import { llmTranslateBatch, polishTranscript, type StreamInfo } from './llm-translate';

afterEach(() => vi.unstubAllGlobals());
const cfg = { baseUrl: 'https://x/v1', apiKey: 'k', model: 'm' };

/** SSE 流响应体（单 delta 携带整段文本——流式语义下等价于多 delta 拼接的终态） */
function sse(text: string): ReadableStream<Uint8Array> {
  const enc = new TextEncoder();
  return new ReadableStream({
    start(c) {
      c.enqueue(enc.encode(`data: ${JSON.stringify({ choices: [{ delta: { content: text } }] })}\n\n`));
      c.enqueue(enc.encode('data: [DONE]\n\n'));
      c.close();
    },
  });
}
/** 流式响应（chatStream 用 body） */
const stubStream = (text: string) => {
  const f = vi.fn(async () => ({ ok: true, body: sse(text) }) as any);
  vi.stubGlobal('fetch', f);
  return f;
};
/** 流式 + JSON 双形态响应：第 1 次调用走 body（润色/翻译主体），第 2 次走 json（术语表请求） */
const stubStreamThenJson = (text: string, jsonPayload: unknown) => {
  let call = 0;
  const f = vi.fn(async () => {
    call++;
    return (call === 1
      ? { ok: true, body: sse(text) }
      : { ok: true, json: async () => ({ choices: [{ message: { content: JSON.stringify(jsonPayload) } }] }) }) as any;
  });
  vi.stubGlobal('fetch', f);
  return f;
};

describe('翻译 v3（编号行协议）', () => {
  it('按编号对齐返回', async () => {
    stubStream('1. 译1\n2. 译2');
    expect(await llmTranslateBatch(cfg, ['a', 'b'])).toEqual(['译1', '译2']);
  });

  it('空输入直接返回空数组不发请求', async () => {
    const f = stubStream('');
    expect(await llmTranslateBatch(cfg, [])).toEqual([]);
    expect(f).not.toHaveBeenCalled();
  });

  it('术语表注入 prompt（全片统一译法）', async () => {
    const f = stubStream('1. 闭包捕获状态');
    await llmTranslateBatch(cfg, ['closures capture state'], [{ en: 'closure', zh: '闭包' }]);
    const body = JSON.parse((f.mock.calls[0] as any[])[1]!.body as string);
    const system = body.messages.find((m: any) => m.role === 'system')!.content as string;
    expect(system).toContain('closure → 闭包');
    expect(system).toContain('术语表');
  });

  it('条数不符自动重试一次，仍不符抛错', async () => {
    let call = 0;
    vi.stubGlobal('fetch', vi.fn(async () => { call++; return { ok: true, body: sse('1. 只有一条') } as any; }));
    await expect(llmTranslateBatch(cfg, ['a', 'b'])).rejects.toThrow('条数不符');
    expect(call).toBe(2);
  });

  it('段落按字符预算分批请求，结果按序拼接', async () => {
    // 分批推演：['x'*2000] 单独成批（加 'y'*2000 超 3000）；['y'*2000, 'z'*10] 累计 2010 同批
    const payloads = ['1. 译A', '1. 译B1\n2. 译B2'];
    let call = 0;
    const f = vi.fn(async () => ({ ok: true, body: sse(payloads[call++]!) }) as any);
    vi.stubGlobal('fetch', f);
    const texts = ['x'.repeat(2000), 'y'.repeat(2000), 'z'.repeat(10)];
    const out = await llmTranslateBatch(cfg, texts);
    expect(f).toHaveBeenCalledTimes(2);
    expect(out).toEqual(['译A', '译B1', '译B2']);
  });

  it('onStream 回调带 phase/batch/batchTotal 与累积文本', async () => {
    stubStream('1. 译A\n2. 译B');
    const events: StreamInfo[] = [];
    await llmTranslateBatch(cfg, ['a', 'b'], undefined, (i) => events.push(i));
    expect(events.length).toBeGreaterThan(0);
    expect(events.at(-1)).toMatchObject({ phase: 'translate', batch: 1, batchTotal: 1, text: '1. 译A\n2. 译B' });
  });
});

describe('润色 v3（[from-to] 行协议）', () => {
  const cues = [
    { start: 1, dur: 2, text: 'um so closure' },
    { start: 3, dur: 2, text: 'captures state' },
    { start: 5, dur: 1, text: 'and second' },
    { start: 6, dur: 2, text: 'topic here' },
  ];

  it('分段合并（start=段首 / dur 累加）+ 术语表独立请求产出', async () => {
    stubStreamThenJson('[1-2] Polished paragraph one.\n[3-4] Paragraph two.', { terms: [{ en: 'closure', zh: '闭包' }] });
    const out = await polishTranscript(cfg, cues);
    expect(out.cues.map((c) => c.text)).toEqual(['Polished paragraph one.', 'Paragraph two.']);
    expect(out.cues.map((c) => c.start)).toEqual([1, 5]);
    expect(out.cues.map((c) => c.dur)).toEqual([4, 3]);
    expect(out.terms).toEqual([{ en: 'closure', zh: '闭包' }]);
  });

  it('区间缺口与非法段兜底为原文自成段（不丢行）', async () => {
    stubStreamThenJson('[1-1] Fixed one.\n[3-2] bad range\n[9-9] out of range', { terms: [] });
    const out = await polishTranscript(cfg, [
      { start: 1, dur: 1, text: 'line one' },
      { start: 2, dur: 1, text: 'line two' },
      { start: 3, dur: 1, text: 'line three' },
    ]);
    expect(out.cues.map((c) => c.text)).toEqual(['Fixed one.', 'line two', 'line three']);
    expect(out.cues.map((c) => c.start)).toEqual([1, 2, 3]);
  });

  it('超批大小分批调用；术语表请求失败不拖垮润色（空表继续）', async () => {
    // 65 行 → 2 批（60+5）；第 3 次调用（术语）返回非 JSON 触发 chatJson 抛错
    const bodies = ['[1-60] batch one merged', '[61-65] batch two merged'];
    let call = 0;
    vi.stubGlobal('fetch', vi.fn(async () => {
      call++;
      if (call <= 2) return { ok: true, body: sse(bodies[call - 1]!) } as any;
      return { ok: true, json: async () => { throw new Error('bad json'); } } as any;
    }));
    const many = Array.from({ length: 65 }, (_, i) => ({ start: i, dur: 1, text: `l${i}` }));
    const out = await polishTranscript(cfg, many);
    expect(out.cues.map((c) => c.text)).toEqual(['batch one merged', 'batch two merged']);
    expect(out.terms).toEqual([]);
  });

  it('onStream 回调带 polish 阶段与批号', async () => {
    stubStreamThenJson('[1-4] All merged.', { terms: [] });
    const events: StreamInfo[] = [];
    await polishTranscript(cfg, cues, (i) => events.push(i));
    expect(events.at(-1)).toMatchObject({ phase: 'polish', batch: 1, batchTotal: 1, text: '[1-4] All merged.' });
  });
});
