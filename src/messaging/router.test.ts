import 'fake-indexeddb/auto';
import { describe, expect, it, vi } from 'vitest';
import { handleMessage } from './router';

const deps = (over: any = {}) => ({
  getTranscript: vi.fn(async () => [{ start: 0, dur: 1, text: 'hi' }]),
  saveTranscript: vi.fn(), saveVideo: vi.fn(), getVideo: vi.fn(async () => null),
  getNotesByVideo: vi.fn(async () => []), addNote: vi.fn(), deleteNote: vi.fn(),
  getSummary: vi.fn(async () => null), saveSummary: vi.fn(),
  getSettings: vi.fn(async () => ({ displayMode: 'bilingual', translateChannel: 'free', llm: { baseUrl: 'http://x', apiKey: 'k', model: 'm' }, supadataKey: '', polishEnabled: false })),
  saveSettings: vi.fn(),
  getTranscriptWithFallback: vi.fn(async () => ({ cues: [{ start: 0, dur: 1, text: 'x' }], source: 'youtube' as const })),
  googleFreeTranslate: vi.fn(async () => '你好'), runBatchTranslation: vi.fn(async (c: any[]) => ({ translated: c.map((x) => ({ ...x, zh: '译' })), failed: 0 })),
  llmTranslateBatch: vi.fn(), polishTranscript: vi.fn(async (_c: any, cs: any[]) => cs), explainConfusion: vi.fn(async () => '解释'), summarize: vi.fn(async () => ({ videoId: 'v', oneLiner: 's', sections: [], knowledge: [], prerequisites: [], model: 'm', generatedAt: 1 })),
  buildFusedMarkdown: vi.fn(() => '# md'), broadcast: vi.fn(), sendToActiveTab: vi.fn(),
  listVideosWithNotes: vi.fn(async () => [{ video: { videoId: 'v', title: 'T', channel: 'C', url: 'u', captionLang: 'en', fetchedAt: 1 }, noteCount: 3, lastAt: 9 }]), ...over,
});

describe('router', () => {
  it('PAGE_INFO 抓取并落库', async () => {
    const d = deps();
    await handleMessage({ type: 'PAGE_INFO', tracks: [{ baseUrl: 'u', lang: 'en', kind: 'asr' }], meta: { videoId: 'v', title: 'T', channel: 'C' } }, d);
    expect(d.getTranscriptWithFallback).toHaveBeenCalled();
    expect(d.saveVideo).toHaveBeenCalled();
    expect(d.saveTranscript).toHaveBeenCalledWith('v', [{ start: 0, dur: 1, text: 'x' }]);
  });

  it('PAGE_INFO 润色开关开启时先润色再存库，并广播通知面板', async () => {
    const d = deps({ getSettings: vi.fn(async () => ({ displayMode: 'bilingual', translateChannel: 'llm', llm: { baseUrl: 'http://x', apiKey: 'k', model: 'm' }, supadataKey: '', polishEnabled: true })) });
    await handleMessage({ type: 'PAGE_INFO', tracks: [], meta: { videoId: 'v', title: 'T', channel: 'C' } }, d);
    expect(d.polishTranscript).toHaveBeenCalled();
    expect(d.saveTranscript).toHaveBeenCalled();
    expect(d.broadcast).toHaveBeenCalledWith(expect.objectContaining({ type: 'PAGE_INFO' }));
  });

  it('PAGE_INFO 抓取失败时广播 TRANSCRIPT_FAILED 并返回 error', async () => {
    const d = deps({ getTranscriptWithFallback: vi.fn(async () => { throw new Error('无可用字幕通道'); }) });
    const r = await handleMessage({ type: 'PAGE_INFO', tracks: [], meta: { videoId: 'v', title: 'T', channel: 'C' } }, d);
    expect(d.broadcast).toHaveBeenCalledWith({ type: 'TRANSCRIPT_FAILED', videoId: 'v', reason: '无可用字幕通道' });
    expect(r).toEqual({ error: '无可用字幕通道' });
    expect(d.saveVideo).not.toHaveBeenCalled();
  });

  it('RETRY_TRANSCRIPT 转发给当前标签页的 content script', async () => {
    const d = deps();
    await handleMessage({ type: 'RETRY_TRANSCRIPT' }, d);
    expect(d.sendToActiveTab).toHaveBeenCalledWith({ type: 'RETRY_TRANSCRIPT' });
  });

  it('PLAYBACK / OPEN_NOTE_EDITOR 静默放行不抛错', async () => {
    await expect(handleMessage({ type: 'PLAYBACK', t: 1 }, deps())).resolves.toEqual({ ok: true });
    await expect(handleMessage({ type: 'OPEN_NOTE_EDITOR', start: 0, end: 1, excerpt: '' }, deps())).resolves.toEqual({ ok: true });
  });

  it('EXPLAIN 用字幕窗口调用 explainConfusion 并返回解释', async () => {
    const d = deps();
    const r = await handleMessage({ type: 'EXPLAIN', videoId: 'v', start: 8, end: 12 }, d);
    expect(d.explainConfusion).toHaveBeenCalled();
    expect(r.explanation).toBe('解释');
  });

  it('LIST_LIBRARY 返回视频笔记列表', async () => {
    const d = deps();
    const r = await handleMessage({ type: 'LIST_LIBRARY' }, d);
    expect(d.listVideosWithNotes).toHaveBeenCalled();
    expect(r.rows).toHaveLength(1);
    expect(r.rows[0]).toMatchObject({ noteCount: 3, lastAt: 9 });
  });

  it('未知消息类型返回错误', async () => {
    await expect(handleMessage({ type: 'NOPE' } as any, deps())).rejects.toThrow('未知消息');
  });
});
