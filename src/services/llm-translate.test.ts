import { describe, expect, it, vi, afterEach } from 'vitest';
import { extractTerms, llmTranslateBatch, type StreamInfo } from './llm-translate';

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

describe('翻译（编号行协议 + 风格保留指令）', () => {
  it('按编号对齐返回', async () => {
    stubStream('1. 译1\n2. 译2');
    expect(await llmTranslateBatch(cfg, ['a', 'b'])).toEqual(['译1', '译2']);
  });

  it('空输入直接返回空数组不发请求', async () => {
    const f = stubStream('');
    expect(await llmTranslateBatch(cfg, [])).toEqual([]);
    expect(f).not.toHaveBeenCalled();
  });

  it('风格保留指令与术语表注入 prompt', async () => {
    const f = stubStream('1. 闭包捕获状态');
    await llmTranslateBatch(cfg, ['closures capture state'], [{ en: 'closure', zh: '闭包' }]);
    const body = JSON.parse((f.mock.calls[0] as any[])[1]!.body as string);
    const system = body.messages.find((m: any) => m.role === 'system')!.content as string;
    expect(system).toContain('closure → 闭包');
    expect(system).toContain('术语表');
    expect(system).toContain('口译员');          // 风格指令：口语译口语
    expect(system).toContain('保留说话者的风格与语气');
    expect(system).toContain('不强行书面化');
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

  it('onStream 回调带批号与累积文本', async () => {
    stubStream('1. 译A\n2. 译B');
    const events: StreamInfo[] = [];
    await llmTranslateBatch(cfg, ['a', 'b'], undefined, (i) => events.push(i));
    expect(events.length).toBeGreaterThan(0);
    expect(events.at(-1)).toMatchObject({ batch: 1, batchTotal: 1, text: '1. 译A\n2. 译B' });
  });
});

describe('术语表提取 extractTerms', () => {
  it('从段落语料提取术语并去重', async () => {
    const f = vi.fn(async () => ({ ok: true, json: async () => ({ choices: [{ message: { content: JSON.stringify({ terms: [{ en: 'closure', zh: '闭包' }, { en: 'closure', zh: '闭包' }, { en: 'React', zh: '' }] }) } }] }) }) as any);
    vi.stubGlobal('fetch', f);
    const terms = await extractTerms(cfg, [{ start: 0, dur: 1, text: 'closures in React' }]);
    expect(terms).toEqual([{ en: 'closure', zh: '闭包' }]);   // 重复去重、zh 缺失的丢弃
    const body = JSON.parse((f.mock.calls[0] as any[])[1]!.body as string);
    expect(body.messages[1]!.content).toContain('closures in React');  // 语料作为输入
  });
});
