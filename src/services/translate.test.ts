import { describe, expect, it, vi } from 'vitest';
import { runBatchTranslation, googleFreeTranslate } from './translate';

it('调度器并发执行、写入 zh、统计失败', async () => {
  const cues = Array.from({ length: 10 }, (_, i) => ({ start: i, dur: 1, text: `t${i}` }));
  const fn = vi.fn(async (t: string) => (t === 't3' ? Promise.reject(new Error('rate')) : `译-${t}`));
  const progress: number[] = [];
  const r = await runBatchTranslation(cues, fn, { concurrency: 3, onProgress: (d, total) => progress.push(d) });
  expect(r.translated[3]!.zh).toBeUndefined();      // 失败句无译文
  expect(r.translated[0]!.zh).toBe('译-t0');
  expect(r.failed).toBe(1);
  expect(progress.at(-1)).toBe(10);
});

it('googleFreeTranslate 拼接响应片段', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => [[['你', 'hel', null, null, 10], ['好', 'lo', null, null, 10]], null, 'en'] }) as any));
  expect(await googleFreeTranslate('hello')).toBe('你好');
  vi.unstubAllGlobals();
});

it('googleFreeTranslate 超长段落按句切分多次请求拼接（GET URL 保护）', async () => {
  const f = vi.fn(async (url: string) => ({
    ok: true,
    json: async () => [[[decodeURIComponent((url as string).match(/q=([^&]*)/)![1]!.slice(0, 4)), '', null, null, 10]], null, 'en'],
  }) as any);
  vi.stubGlobal('fetch', f);
  // 三句共约 3000 字符（超 1200 阈值）→ 按 . 切分 3 次请求
  const long = ['Sentence one. ', 'Sentence two. ', 'Sentence three. '].map((s) => s.repeat(150)).join('').trim();
  const out = await googleFreeTranslate(long);
  expect(f.mock.calls.length).toBeGreaterThanOrEqual(3);
  // 每次请求的 q 参数都不超阈值
  for (const [url] of f.mock.calls as unknown as [string][]) expect(decodeURIComponent(url.match(/q=([^&]*)/)![1]!).length).toBeLessThanOrEqual(1250);
  expect(out.length).toBeGreaterThan(0);
  vi.unstubAllGlobals();
});
