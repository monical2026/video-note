import { describe, expect, it, vi, afterEach } from 'vitest';
import { aiSegmentBreakpoints, extractTerms, llmTranslateBatch, type StreamInfo } from './llm-translate';

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
    // 术语表仍注入
    expect(system).toContain('closure → 闭包');
    expect(system).toContain('术语表');
    // 用户翻译规范（2026-08-27）：通用基础规则
    expect(system).toContain('完全匹配原文的语气和表达风格');
    expect(system).toContain('不要逐字按照英文语法');
    expect(system).toContain('通常保留英文的技术术语');
    expect(system).not.toContain('{langName}');   // 占位符必须已实例化
    // 中文规则
    expect(system).toContain('现代、口语化的简体中文');
    expect(system).toContain('先理解完整的语义');
    expect(system).toContain('不要使用"您"');
    expect(system).toContain('加入易读的空格');
    expect(system).toContain('删除无实际意义的口头填充词');
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

describe('AI 分段断点 aiSegmentBreakpoints', () => {
  const sents = Array.from({ length: 5 }, (_, i) => ({ text: `sentence ${i + 1}` }));

  it('解析断点数字，排序去重，越界忽略', async () => {
    stubStream('3\n7\n3\n99');   // 重复 3、越界 99
    expect(await aiSegmentBreakpoints(cfg, sents)).toEqual([3]);
  });

  it('解析容错：逗号/空格分隔或夹带说明文字的数字也能提取（根因：整行纯数字解析出 0 断点退回规则）', async () => {
    // 用户实测「AI 分段与规则一模一样」的根因复现：模型输出逗号分隔
    stubStream('2, 4, 5');
    expect(await aiSegmentBreakpoints(cfg, sents)).toEqual([2, 4, 5]);
    stubStream('Break after sentence 2 and 4.');
    expect(await aiSegmentBreakpoints(cfg, sents)).toEqual([2, 4]);
  });

  it('prompt 含分段标准与"只输出数字"约束', async () => {
    const f = stubStream('2');
    await aiSegmentBreakpoints(cfg, sents);
    const body = JSON.parse((f.mock.calls[0] as any[])[1]!.body as string);
    const system = body.messages.find((m: any) => m.role === 'system')!.content as string;
    expect(system).toContain('2~5 句话');
    expect(system).toContain('绝不可切断');
    expect(system).toContain('不要输出数字以外的任何内容');
    expect(body.messages[1]!.content).toContain('1. sentence 1');   // 带全局编号的句子输入
  });

  it('无效输出（无数字行）→ 空数组（调用方退回规则组段）', async () => {
    stubStream('I think these all belong together.');
    expect(await aiSegmentBreakpoints(cfg, sents)).toEqual([]);
  });

  it('超批大小分批调用（80 句/批），全局句号解析', async () => {
    const payloads = ['80', '95'];   // 第二批覆盖全局句 81~100，断点 95 合法
    let call = 0;
    const f = vi.fn(async () => ({ ok: true, body: sse(payloads[call++]!) }) as any);
    vi.stubGlobal('fetch', f);
    const many = Array.from({ length: 100 }, () => ({ text: 's' }));
    const bps = await aiSegmentBreakpoints(cfg, many);
    expect(f).toHaveBeenCalledTimes(2);
    expect(bps).toEqual([80, 95]);
  });
});
