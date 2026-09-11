import { describe, expect, it, vi, afterEach } from 'vitest';
import { chunkTranscript, explainConfusion, summarize } from './ai';

it('chunkTranscript 不切断单条且不超限', () => {
  const cues = Array.from({ length: 50 }, (_, i) => ({ start: i, dur: 1, text: 'x'.repeat(30) }));
  const chunks = chunkTranscript(cues, 100);
  expect(chunks.length).toBeGreaterThan(1);
  for (const ch of chunks) expect(ch.reduce((n, c) => n + c.text.length, 0)).toBeLessThanOrEqual(100 + 30);
  expect(chunks.flat().length).toBe(50);
});

const cfg = { baseUrl: 'https://x/v1', apiKey: 'k', model: 'gpt-x' };
const stubJson = (payload: any) =>
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ choices: [{ message: { content: JSON.stringify(payload) } }] }) } as any)));
afterEach(() => vi.unstubAllGlobals());

it('explainConfusion 返回中文解释', async () => {
  stubJson({ explanation: '闭包是函数与其词法环境的组合。' });
  const r = await explainConfusion(cfg, [{ start: 0, dur: 1, text: 'what is closure' }]);
  expect(r).toContain('闭包');
});

it('summarize 多块 map-reduce 得到结构化 Summary', async () => {
  const cues = Array.from({ length: 120 }, (_, i) => ({ start: i * 2, dur: 2, text: `point ${i} about closures and scope` }));
  stubJson({
    mapPoints: [{ start: 0, point: '闭包基础' }],
    oneLiner: '讲解闭包', sections: [{ start: 0, title: '闭包基础', points: ['定义'] }],
    knowledge: [{ term: 'closure', desc: '函数+词法环境' }], prerequisites: ['作用域'],
  });
  const s = await summarize(cfg, { videoId: 'v', title: 'T' }, cues);
  expect(s.videoId).toBe('v'); expect(s.oneLiner).toBe('讲解闭包');
  expect(s.model).toBe('gpt-x'); expect(s.sections[0]!.points).toEqual(['定义']);
});

it('金句缺 en 时自动补一次回译（§0.14 用户实测模型偶发省略 en 键）', async () => {
  // 按请求内容分流：含「回译」的补齐请求返回英文，其余（reduce）返回缺 en 的摘要
  vi.stubGlobal('fetch', vi.fn(async (_url: string, init: any) => {
    const body = JSON.parse(init.body);
    const isBack = body.messages.some((m: any) => m.content.includes('回译'));
    const content = isBack
      ? JSON.stringify({ t: ['A closure is a backpack.'] })
      : JSON.stringify({ oneLiner: 'o', sections: [], keyQuotes: [{ quote: '闭包是背包。', start: 5 }], knowledge: [], prerequisites: [] });
    return { ok: true, json: async () => ({ choices: [{ message: { content } }] }) } as any;
  }));
  const s = await summarize(cfg, { videoId: 'v', title: 'T' }, [{ start: 0, dur: 2, text: 'closures capture env' }]);
  expect(s.keyQuotes?.[0]!.quote).toBe('闭包是背包。');
  expect(s.keyQuotes?.[0]!.en).toBe('A closure is a backpack.');
});
