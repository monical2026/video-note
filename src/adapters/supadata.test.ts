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

it('有字幕视频：native 直接命中，不发起 generate 重试（零消耗）', async () => {
  const urls: string[] = [];
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    urls.push(url);
    return { ok: true, status: 200, json: async () => ({ content: [{ text: 'hi', offset: 0, duration: 1000 }] }) } as any;
  }));
  await fetchSupadataTranscript('v1', 'sk');
  expect(urls).toHaveLength(1);
  expect(urls[0]).not.toContain('mode=generate');
});

it('无字幕视频（404）：带 mode=generate 重试（Whisper 生成），命中后换算', async () => {
  const urls: string[] = [];
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    urls.push(url);
    if (urls.length === 1) return { ok: false, status: 404, text: async () => 'no transcripts' } as any;
    return { ok: true, status: 200, json: async () => ({ content: [{ text: 'generated', offset: 500, duration: 1500 }] }) } as any;
  }));
  const cues = await fetchSupadataTranscript('v1', 'sk');
  expect(urls).toHaveLength(2);
  expect(urls[1]).toContain('mode=generate');
  expect(cues).toEqual([{ start: 0.5, dur: 1.5, text: 'generated' }]);
});

it('两段都失败（404→402）：抛第二段错误', async () => {
  let call = 0;
  vi.stubGlobal('fetch', vi.fn(async () => {
    call++;
    return call === 1
      ? { ok: false, status: 404, text: async () => 'none' } as any
      : { ok: false, status: 402, text: async () => 'quota exceeded' } as any;
  }));
  await expect(fetchSupadataTranscript('v1', 'sk')).rejects.toThrow('Supadata 402');
});
