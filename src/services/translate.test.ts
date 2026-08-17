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
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => [[[null, '你'], [null, '好']], null, 'en'] }) as any));
  expect(await googleFreeTranslate('hello')).toBe('你好');
  vi.unstubAllGlobals();
});
