import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as db from '../storage/db';
import { mergeCues, sentencesFromCues, sentencesToParagraphs } from '../services/segment';
import { buildFusedMarkdown } from '../services/export';
import { handleMessage } from './router';
import type { Cue } from '../types';

/**
 * 全链集成测试（2026-09-02 排障）：复现用户实测矛盾——RESEGMENT 写入 167 段（reread 确认），
 * 但翻译/导出环节显示 65 段。用真实 IndexedDB（fake-indexeddb）+ 真实分段引擎跑完整链路，
 * 断言段数在 分段→翻译→读取→导出 全程一致。若本地一致，则问题在部署/环境层。
 */

// 模拟 raw：句内句号混合形态（json3 风格：部分行尾句号、部分行内句号、含 [laughter]）
const raw: Cue[] = [
  { start: 0, dur: 2.5, text: 'Google was a founding team that was' },
  { start: 2.5, dur: 2.4, text: 'deeply deeply technical. As the' },
  { start: 4.9, dur: 2.3, text: 'technology got more mature' },
  { start: 7.2, dur: 2.6, text: 'the slider goes forward. Pinterest' },
  { start: 9.8, dur: 2.5, text: 'where I was, Snap, Instagram' },
  { start: 12.3, dur: 2.4, text: 'the CEOs were product geniuses.' },
  { start: 15.0, dur: 1.0, text: '[laughter]' },
  { start: 16.2, dur: 2.5, text: 'So what are the big consumer wins?' },
  { start: 19.0, dur: 2.5, text: 'Of course it is ChatGPT which is' },
  { start: 21.5, dur: 2.4, text: 'a text box. Custom GPTs feel criminal' },
  { start: 24.0, dur: 2.6, text: 'Someone will create a UGC community' },
  { start: 26.6, dur: 2.5, text: 'where the good ones make it easier' },
  { start: 29.1, dur: 2.4, text: 'for the rest of us. That is the claim.' },
];

const makeDeps = () => ({
  ...db,
  mergeCues, sentencesFromCues, sentencesToParagraphs,
  aiSegmentBreakpoints: vi.fn(async () => []),
  getSettings: vi.fn(async () => ({ displayMode: 'bilingual', translateChannel: 'free', llm: null, supadataKey: '', llmKeys: {} })),
  saveSettings: vi.fn(async () => {}),
  getTranscriptWithFallback: vi.fn(async () => { throw new Error('不应走到兜底'); }),
  googleFreeTranslate: vi.fn(async (t: string) => `译(${t.length})`),
  runBatchTranslation: vi.fn(async (cues: Cue[], fn: (t: string) => Promise<string>) => ({
    translated: await Promise.all(cues.map(async (c) => ({ ...c, zh: await fn(c.text) }))),
    failed: 0,
  })),
  llmTranslateBatch: vi.fn(async (_c: any, ts: string[]) => ts.map((t) => `译:${t.slice(0, 3)}`)),
  extractTerms: vi.fn(async () => []),
  explainConfusion: vi.fn(async () => ''),
  summarize: vi.fn(async () => ({ videoId: 'v', oneLiner: '', sections: [], knowledge: [], prerequisites: [], model: 'm', generatedAt: 1 })),
  buildFusedMarkdown,
  listVideosWithNotes: vi.fn(async () => []),
  broadcast: vi.fn(), sendToActiveTab: vi.fn(),
});

beforeEach(async () => {
  await db.resetDbForTest();
  await db.saveVideo({ videoId: 'vid1', title: 'T', channel: 'C', url: 'u', captionLang: 'en', fetchedAt: 1 });
});

describe('RESEGMENT→TRANSLATE→EXPORT 全链段数一致性', () => {
  it('分段后的段数在翻译、读取、导出全程不回退', async () => {
    const d = makeDeps();
    // 预置旧库：旧形态分段（模拟 65 段时代）+ raw 原料
    await db.saveTranscript('vid1', [{ start: 0, dur: 31.5, text: '旧的一大段' }], [], undefined, raw);

    // 1. 规则分段
    const r1 = await handleMessage({ type: 'RESEGMENT', videoId: 'vid1', mode: 'rules' }, d as any);
    const n = r1.cueCount as number;
    expect(n).toBeGreaterThanOrEqual(3);                // 旧 1 大段 → 多个小段（本组数据实测 3~4 段）
    const rec1 = await db.getTranscriptRecord('vid1');
    expect(rec1!.cues.length).toBe(n);                  // 库里 = 返回值
    expect(rec1!.cues.every((c) => !c.zh)).toBe(true);  // 译文已清
    expect(rec1!.raw?.length).toBe(raw.length);         // raw 保留
    // [laughter] 已并入前句，不单独成段
    expect(rec1!.cues.some((c) => c.text.trim() === '[laughter]')).toBe(false);

    // 2. 翻译（免费通道）
    await handleMessage({ type: 'TRANSLATE', videoId: 'vid1' }, d as any);
    const rec2 = await db.getTranscriptRecord('vid1');
    expect(rec2!.cues.length).toBe(n);                  // 段数不回退！
    expect(rec2!.cues.every((c) => c.zh)).toBe(true);   // 全部有译文
    expect(rec2!.raw?.length).toBe(raw.length);         // raw 仍在

    // 3. 界面读取
    const gd = await handleMessage({ type: 'GET_VIDEO_DATA', videoId: 'vid1' }, d as any);
    expect(gd.cues.length).toBe(n);

    // 4. 导出（含逐字稿附录）
    const ex = await handleMessage({ type: 'EXPORT', videoId: 'vid1', includeTranscript: true }, d as any);
    const tsLines = (ex.markdown as string).split('\n').filter((l) => /^- \[\d{2}:\d{2}/.test(l));
    expect(tsLines.length).toBe(n);                      // 附录段数 = 库段数

    // 5. 幂等：再分段一次，段数一致（同规则同原料）
    const r2 = await handleMessage({ type: 'RESEGMENT', videoId: 'vid1', mode: 'rules' }, d as any);
    expect(r2.cueCount).toBe(n);
  });

  it('竞态根因回归：翻译期间库被重新分段 → 旧翻译写回必须被拒（乐观锁），新分段不被覆盖', async () => {
    const d = makeDeps();
    await db.saveTranscript('vid1', [{ start: 0, dur: 31.5, text: 'old big para' }], [], undefined, raw);

    // 真实时序模拟：翻译函数执行期间（await 中），用户点了规则分段（库被改为新段）
    d.runBatchTranslation = vi.fn(async (cues: Cue[]) => {
      await handleMessage({ type: 'RESEGMENT', videoId: 'vid1', mode: 'rules' }, d as any);
      return { translated: cues.map((c) => ({ ...c, zh: '旧译' })), failed: 0 };   // 翻译"完成"，持有启动时的旧段
    });

    const rT = await handleMessage({ type: 'TRANSLATE', videoId: 'vid1' }, d as any);
    // 乐观锁拦截：明确报"已重新分段"，而非静默覆盖
    expect(rT).toMatchObject({ error: expect.stringContaining('重新分段') });

    // 库里是新分段（多段、无旧译文渗入）——167 段被写回 65 段的元凶路径已封死
    const rec = await db.getTranscriptRecord('vid1');
    expect(rec!.cues.length).toBeGreaterThanOrEqual(3);
    expect(rec!.cues.every((c) => !c.zh)).toBe(true);
    expect(rec!.raw?.length).toBe(raw.length);
  });
});
