import { describe, expect, it, vi } from 'vitest';
import { getTranscriptWithFallback } from './transcript';

it('直抓成功不走 Supadata', async () => {
  const fetchTrack = vi.fn(async () => [{ start: 0, dur: 1, text: 'a' }]);
  const supadata = vi.fn();
  const r = await getTranscriptWithFallback({ videoId: 'v', tracks: [{ baseUrl: 'u' }] }, { fetchTrack, supadata });
  expect(r.source).toBe('youtube'); expect(supadata).not.toHaveBeenCalled();
});

it('无轨道且配置 Supadata 时走兜底', async () => {
  const supadata = vi.fn(async () => [{ start: 0, dur: 1, text: 'x' }]);
  const r = await getTranscriptWithFallback({ videoId: 'v', tracks: [] }, { supadata, supadataKey: 'sk' });
  expect(r.source).toBe('supadata');
});

it('两通道都失败抛出明确错误', async () => {
  const fetchTrack = vi.fn(async () => { throw new Error('x'); });
  await expect(
    getTranscriptWithFallback({ videoId: 'v', tracks: [{ baseUrl: 'u' }] }, { fetchTrack, supadata: undefined, supadataKey: '' }),
  ).rejects.toThrow('该视频无可用字幕');
});
