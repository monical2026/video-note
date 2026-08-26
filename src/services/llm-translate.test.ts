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

describe('润色 v4（段首锚定 + 批尾顺延）', () => {
  const cues = [
    { start: 1, dur: 2, text: 'um so closure' },
    { start: 3, dur: 2, text: 'captures state' },
    { start: 5, dur: 1, text: 'and second' },
    { start: 6, dur: 2, text: 'topic here' },
  ];

  it('段首锚定分段（start=段首 / dur 累加 / 范围由相邻锚推算）+ 术语独立请求', async () => {
    stubStreamThenJson('1|So closures capture state.\n3|The second topic.', { terms: [{ en: 'closure', zh: '闭包' }] });
    const out = await polishTranscript(cfg, cues);
    expect(out.cues.map((c) => c.text)).toEqual(['So closures capture state.', 'The second topic.']);
    expect(out.cues.map((c) => c.start)).toEqual([1, 5]);
    expect(out.cues.map((c) => c.dur)).toEqual([4, 3]);   // 段1 覆盖行1-2（dur 2+2），段2 覆盖行3-4（1+2）
    expect(out.terms).toEqual([{ en: 'closure', zh: '闭包' }]);
  });

  it('越界锚丢弃；末锚按协议覆盖到批尾（锚定协议无中部洞）', async () => {
    // 锚 1 声明"行 1 起是一段"，覆盖到批尾（行 1~3）；越界锚（行 9）丢弃不影响
    stubStreamThenJson('1|Fixed one.\n9|out of range', { terms: [] });
    const out = await polishTranscript(cfg, [
      { start: 1, dur: 1, text: 'line one' },
      { start: 2, dur: 1, text: 'line two' },
      { start: 3, dur: 1, text: 'line three' },
    ]);
    expect(out.cues.map((c) => c.text)).toEqual(['Fixed one.']);
    expect(out.cues[0]!.start).toBe(1);
    expect(out.cues[0]!.dur).toBe(3);   // 行 2、3 的时长并入末段（协议语义）
  });

  it('批尾顺延：» 标记的行带入下一批输入（带原文语境重建），批预算含顺延行', async () => {
    // 60 行 + 5 行 → 批1 覆盖到行 57、» 在 58；批2 输入必须从行 58 起（含 58/59/60 原文）+ 新 5 行
    const many = Array.from({ length: 65 }, (_, i) => ({ start: i, dur: 1, text: `l${i + 1}` }));
    const payloads = [
      { stream: '1|Batch one part one.\n57|Batch one part two.\n58|»' },
      { stream: '58|Batch two merged.' },
    ];
    let call = 0;
    const f = vi.fn(async () => {
      call++;
      return (call === 1
        ? { ok: true, body: sse(payloads[0]!.stream!) }
        : { ok: true, body: sse(payloads[1]!.stream!), json: async () => ({ choices: [{ message: { content: JSON.stringify({ terms: [] }) } }] }) }) as any;
    });
    vi.stubGlobal('fetch', f);
    const out = await polishTranscript(cfg, many);
    expect(f).toHaveBeenCalledTimes(3); // 两批润色 + 一次术语
    // 批2 的输入必须包含顺延行 58/59/60 的原文（跨批语境完整）
    const batch2Body = JSON.parse((f.mock.calls[1] as any[])[1]!.body as string);
    expect(batch2Body.messages[1]!.content).toContain('[58] l58');
    expect(batch2Body.messages[1]!.content).toContain('[60] l60');
    expect(batch2Body.messages[1]!.content).toContain('[65] l65');
    expect(batch2Body.messages[1]!.content).not.toContain('[57] l57'); // 已处理行不带回
    // 结果：批1 两段 + 批2 一段
    expect(out.cues.map((c) => c.text)).toEqual(['Batch one part one.', 'Batch one part two.', 'Batch two merged.']);
  });

  it('最后一批：所有行必须归段（尾部无 » 空间时兜底原文段）', async () => {
    // 65 行 → 批1 全覆盖无顺延；批2 为最后一批，模型仍输出 »（应忽略），尾部行兜底原文
    const many = Array.from({ length: 65 }, (_, i) => ({ start: i, dur: 1, text: `l${i + 1}` }));
    const streams = ['1|All sixty.', '61|»'];
    let call = 0;
    vi.stubGlobal('fetch', vi.fn(async () => {
      call++;
      return call === 1
        ? { ok: true, body: sse(streams[0]!) } as any
        : { ok: true, body: sse(streams[1]!), json: async () => ({ choices: [{ message: { content: JSON.stringify({ terms: [] }) } }] }) } as any;
    }));
    const out = await polishTranscript(cfg, many);
    // 最后一批 » 被忽略（无实体锚）→ 行 61~65 全部兜底原文自成段；批1 一大段
    expect(out.cues.length).toBe(6);
    expect(out.cues.at(-1)!.text).toBe('l65');
  });

  it('无有效锚：全批原文兜底强制推进（防死循环）', async () => {
    stubStreamThenJson('completely garbage output', { terms: [] });
    const out = await polishTranscript(cfg, cues);
    expect(out.cues.map((c) => c.text)).toEqual(cues.map((c) => c.text)); // 原文原样
  });

  it('onStream 带阶段与批号，显示文本剥掉行号前缀', async () => {
    stubStreamThenJson('1|So closures.', { terms: [] });
    const events: StreamInfo[] = [];
    await polishTranscript(cfg, cues, (i) => events.push(i));
    expect(events.length).toBeGreaterThan(0);
    const last = events.at(-1)!;
    expect(last.phase).toBe('polish');
    expect(last.batch).toBe(1);
    expect(last.text).not.toMatch(/\d\|/);   // 前缀已剥
    expect(last.text).toContain('So closures.');
  });
});
