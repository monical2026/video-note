import { describe, expect, it, vi, afterEach } from 'vitest';
import { fetchSupadataTranscript } from './supadata';

afterEach(() => vi.unstubAllGlobals());

it('换算 offset/duration 毫秒→秒并透传文本', async () => {
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: any) => {
    expect(url).toContain('api.supadata.ai/v1/youtube/transcript');
    expect(init.headers['x-api-key']).toBe('sk-test');
    return { ok: true, json: async () => ({ content: [{ text: 'hello', offset: 1000, duration: 2000 }] }) } as any;
  }));
  expect(await fetchSupadataTranscript('v1', 'sk-test')).toEqual([{ start: 1, dur: 2, text: 'hello' }]);
});

it('非 2xx 抛错', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 402, text: async () => 'quota' }) as any));
  await expect(fetchSupadataTranscript('v1', 'sk')).rejects.toThrow('Supadata 402');
});
