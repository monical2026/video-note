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
