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
  llmTranslateBatch: vi.fn(), explainConfusion: vi.fn(async () => '解释'), summarize: vi.fn(async () => ({ videoId: 'v', oneLiner: 's', sections: [], knowledge: [], prerequisites: [], model: 'm', generatedAt: 1 })),
  buildFusedMarkdown: vi.fn(() => '# md'), broadcast: vi.fn(), sendToActiveTab: vi.fn(), ...over,
});

describe('router', () => {
  it('PAGE_INFO 抓取并落库', async () => {
    const d = deps();
    await handleMessage({ type: 'PAGE_INFO', tracks: [{ baseUrl: 'u', lang: 'en', kind: 'asr' }], meta: { videoId: 'v', title: 'T', channel: 'C' } }, d);
    expect(d.getTranscriptWithFallback).toHaveBeenCalled();
    expect(d.saveVideo).toHaveBeenCalled();
    expect(d.saveTranscript).toHaveBeenCalledWith('v', [{ start: 0, dur: 1, text: 'x' }]);
  });

  it('EXPLAIN 用字幕窗口调用 explainConfusion 并返回解释', async () => {
    const d = deps();
    const r = await handleMessage({ type: 'EXPLAIN', videoId: 'v', start: 8, end: 12 }, d);
    expect(d.explainConfusion).toHaveBeenCalled();
    expect(r.explanation).toBe('解释');
  });

  it('未知消息类型返回错误', async () => {
    await expect(handleMessage({ type: 'NOPE' } as any, deps())).rejects.toThrow('未知消息');
  });
});
