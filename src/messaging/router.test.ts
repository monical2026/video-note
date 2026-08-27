import 'fake-indexeddb/auto';
import { describe, expect, it, vi } from 'vitest';
import { handleMessage } from './router';

const deps = (over: any = {}) => ({
  getTranscript: vi.fn(async () => [{ start: 0, dur: 1, text: 'hi' }]),
  getTranscriptRecord: vi.fn(async () => ({ cues: [{ start: 0, dur: 1, text: 'hi' }], terms: [] })),
  saveTranscript: vi.fn(), saveVideo: vi.fn(), getVideo: vi.fn(async () => null),
  getNotesByVideo: vi.fn(async () => []), addNote: vi.fn(), deleteNote: vi.fn(),
  getSummary: vi.fn(async () => null), saveSummary: vi.fn(),
  deleteTranscript: vi.fn(async () => {}),
  getSettings: vi.fn(async () => ({ displayMode: 'bilingual', translateChannel: 'free', llm: { baseUrl: 'http://x', apiKey: 'k', model: 'm' }, supadataKey: '', llmKeys: {} })),
  saveSettings: vi.fn(),
  getTranscriptWithFallback: vi.fn(async () => ({ cues: [{ start: 0, dur: 1, text: 'x' }], source: 'youtube' as const })),
  googleFreeTranslate: vi.fn(async () => '你好'), runBatchTranslation: vi.fn(async (c: any[]) => ({ translated: c.map((x) => ({ ...x, zh: '译' })), failed: 0 })),
  llmTranslateBatch: vi.fn(async (_c: any, ts: string[]) => ts.map(() => 'LLM译')),
  extractTerms: vi.fn(async () => [{ en: 'closure', zh: '闭包' }]),
  mergeCues: vi.fn((cs: any[]) => cs),   // 恒等 mock：拼段行为由 segment.test.ts 单测覆盖
  explainConfusion: vi.fn(async () => '解释'), summarize: vi.fn(async () => ({ videoId: 'v', oneLiner: 's', sections: [], knowledge: [], prerequisites: [], model: 'm', generatedAt: 1 })),
  buildFusedMarkdown: vi.fn(() => '# md'), broadcast: vi.fn(), sendToActiveTab: vi.fn(),
  listVideosWithNotes: vi.fn(async () => [{ video: { videoId: 'v', title: 'T', channel: 'C', url: 'u', captionLang: 'en', fetchedAt: 1 }, noteCount: 3, lastAt: 9 }]), ...over,
});

describe('router', () => {
  it('PAGE_INFO 带 cues：经拼段落库并广播', async () => {
    const d = deps({ getTranscriptRecord: vi.fn(async () => undefined) });   // 库为空 → 走抓取拼段
    const r = await handleMessage({ type: 'PAGE_INFO', meta: { videoId: 'v', title: 'T', channel: 'C' }, cues: [{ start: 0, dur: 1, text: 'hello' }] }, d);
    expect(d.getTranscriptWithFallback).not.toHaveBeenCalled();
    expect(d.mergeCues).toHaveBeenCalledWith([{ start: 0, dur: 1, text: 'hello' }]);
    expect(d.saveVideo).toHaveBeenCalled();
    expect(d.saveTranscript).toHaveBeenCalledWith('v', [{ start: 0, dur: 1, text: 'hello' }]);
    expect(d.broadcast).toHaveBeenCalledWith(expect.objectContaining({ type: 'PAGE_INFO' }));
    expect(r).toEqual({ ok: true, cueCount: 1 });
  });

  it('PAGE_INFO 库中已有逐字稿：直接复用，不重抓不覆盖', async () => {
    const d = deps();
    const r = await handleMessage({ type: 'PAGE_INFO', meta: { videoId: 'v', title: 'T', channel: 'C' }, cues: [{ start: 0, dur: 1, text: 'fresh' }] }, d);
    expect(d.mergeCues).not.toHaveBeenCalled();
    expect(d.saveTranscript).not.toHaveBeenCalled();
    expect(d.saveVideo).toHaveBeenCalled();
    expect(d.broadcast).toHaveBeenCalled();
    expect(r).toMatchObject({ ok: true, reused: true });
  });

  it('PAGE_INFO cues 为空时走 Supadata 兜底', async () => {
    const d = deps({ getTranscriptRecord: vi.fn(async () => undefined) });
    await handleMessage({ type: 'PAGE_INFO', meta: { videoId: 'v', title: 'T', channel: 'C' }, cues: [] }, d);
    expect(d.getTranscriptWithFallback).toHaveBeenCalledWith({ videoId: 'v', tracks: [] });
    expect(d.saveVideo).toHaveBeenCalled();
    expect(d.saveTranscript).toHaveBeenCalledWith('v', [{ start: 0, dur: 1, text: 'x' }]);
  });

  it('PAGE_INFO 抓取失败时广播 TRANSCRIPT_FAILED 并返回 error', async () => {
    const d = deps({ getTranscriptRecord: vi.fn(async () => undefined), getTranscriptWithFallback: vi.fn(async () => { throw new Error('无可用字幕通道'); }) });
    const r = await handleMessage({ type: 'PAGE_INFO', meta: { videoId: 'v', title: 'T', channel: 'C' }, cues: [] }, d);
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

  it('TRANSLATE force：全量重翻且已配 LLM 即走 LLM（不依赖通道设置），无术语表时先提取并随落库保存', async () => {
    const cues = [
      { start: 0, dur: 1, text: 'a', zh: '旧译文' },
      { start: 1, dur: 1, text: 'b', zh: '旧译文2' },
    ];
    const d = deps({
      getTranscriptRecord: vi.fn(async () => ({ cues, terms: [] })),   // 库里无术语表 → 触发提取
    });
    const r = await handleMessage({ type: 'TRANSLATE', videoId: 'v', force: true }, d);
    expect(d.extractTerms).toHaveBeenCalledWith(expect.anything(), cues);
    expect(d.llmTranslateBatch).toHaveBeenCalledWith(expect.anything(), ['a', 'b'], [{ en: 'closure', zh: '闭包' }], expect.anything());
    expect(d.runBatchTranslation).not.toHaveBeenCalled();
    expect(d.saveTranscript).toHaveBeenCalledWith('v', [
      { start: 0, dur: 1, text: 'a', zh: 'LLM译' },
      { start: 1, dur: 1, text: 'b', zh: 'LLM译' },
    ], [{ en: 'closure', zh: '闭包' }], undefined);
    expect(r).toEqual({ ok: true, failed: 0 });
  });

  it('TRANSLATE 库里已有术语表：不重复提取直接注入', async () => {
    const d = deps({
      getTranscriptRecord: vi.fn(async () => ({ cues: [{ start: 0, dur: 1, text: 'a' }], terms: [{ en: 'hoisting', zh: '提升' }] })),
    });
    await handleMessage({ type: 'TRANSLATE', videoId: 'v', force: true }, d);   // force 走 LLM
    expect(d.extractTerms).not.toHaveBeenCalled();
    expect(d.llmTranslateBatch).toHaveBeenCalledWith(expect.anything(), ['a'], [{ en: 'hoisting', zh: '提升' }], expect.anything());
  });

  it('TRANSLATE 非 force：已有译文全部存在时直接 done', async () => {
    const d = deps({ getTranscriptRecord: vi.fn(async () => ({ cues: [{ start: 0, dur: 1, text: 'a', zh: '已有' }], terms: [] })) });
    const r = await handleMessage({ type: 'TRANSLATE', videoId: 'v' }, d);
    expect(r).toEqual({ ok: true, done: true });
    expect(d.llmTranslateBatch).not.toHaveBeenCalled();
  });

  it('TRANSLATE 免费通道：走 runBatchTranslation，不提取术语', async () => {
    const d = deps({
      getTranscriptRecord: vi.fn(async () => ({ cues: [{ start: 0, dur: 1, text: 'a' }], terms: [] })),
    });
    await handleMessage({ type: 'TRANSLATE', videoId: 'v' }, d);
    expect(d.runBatchTranslation).toHaveBeenCalled();
    expect(d.extractTerms).not.toHaveBeenCalled();
  });

  it('DELETE_TRANSCRIPT：清除该视频库存稿（旧润色版/译文/术语表随记录删除）', async () => {
    const d = deps();
    await handleMessage({ type: 'DELETE_TRANSCRIPT', videoId: 'v' }, d);
    expect(d.deleteTranscript).toHaveBeenCalledWith('v');
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
