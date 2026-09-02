import type { Msg, VideoData } from './protocol';
import type { Cue, Note, Settings, Summary, Term, VideoMeta } from '../types';
import type { OnStream } from '../services/llm-translate';
import type { Sentence } from '../services/segment';

/** LLM 流式进度 → 面板广播：80ms 节流（delta 高频，UI 只需最新帧）；批号变化强制发（新批立即可见） */
function makeStreamBroadcaster(broadcast: (msg: Msg) => void): OnStream {
  let last = 0;
  let lastBatch = -1;
  return (info) => {
    const now = Date.now();
    if (info.batch !== lastBatch || now - last >= 80) {
      lastBatch = info.batch; last = now;
      broadcast({ type: 'LLM_STREAM', ...info });
    }
  };
}

export interface RouterDeps {
  getTranscript(videoId: string): Promise<Cue[] | undefined>;
  getTranscriptRecord(videoId: string): Promise<{ cues: Cue[]; terms?: Term[]; polishedAt?: number; raw?: Cue[] } | undefined>;
  saveTranscript(videoId: string, cues: Cue[], terms?: Term[], polishedAt?: number, raw?: Cue[]): Promise<unknown>;
  saveVideo(meta: any): Promise<unknown>;
  getVideo(videoId: string): Promise<any>;
  getNotesByVideo(videoId: string): Promise<Note[]>;
  addNote(n: Note): Promise<unknown>;
  deleteNote(id: string): Promise<unknown>;
  getSummary(videoId: string): Promise<Summary | undefined>;
  saveSummary(s: Summary): Promise<unknown>;
  deleteTranscript(videoId: string): Promise<unknown>;
  clearAllVideoData(): Promise<number>;
  getSettings(): Promise<Settings>;
  saveSettings(patch: Partial<Settings>): Promise<void>;
  getTranscriptWithFallback(input: any): Promise<{ cues: Cue[]; source: string }>;
  googleFreeTranslate(text: string): Promise<string>;
  runBatchTranslation(cues: Cue[], fn: (t: string) => Promise<string>, opts: any): Promise<{ translated: Cue[]; failed: number }>;
  llmTranslateBatch(config: any, texts: string[], terms?: Term[], onStream?: OnStream): Promise<string[]>;
  extractTerms(config: any, cues: Cue[]): Promise<Term[]>;
  mergeCues(cues: Cue[]): Cue[];   // 规则分段全流程（层1分句+层2组段）
  sentencesFromCues(cues: Cue[]): Sentence[];
  sentencesToParagraphs(sentences: Sentence[], breakpoints?: number[]): Cue[];
  aiSegmentBreakpoints(config: any, sentences: { text: string }[], onStream?: OnStream): Promise<number[]>;
  explainConfusion(config: any, cues: Cue[]): Promise<string>;
  summarize(config: any, video: any, cues: Cue[]): Promise<Summary>;
  buildFusedMarkdown(input: any): string;
  listVideosWithNotes(): Promise<{ video: VideoMeta; noteCount: number; lastAt: number }[]>;
  broadcast(msg: Msg): void;          // 面板广播（PLAYBACK/OPEN_NOTE_EDITOR 等）
  sendToActiveTab(msg: Msg): void;    // content script 定向
}

/** 消息路由：纯函数，全部依赖注入（真实绑定在 background.ts） */
export async function handleMessage(msg: Msg, deps: RouterDeps): Promise<any> {
  switch (msg.type) {
    case 'PAGE_INFO': {
      // 幂等复用：库里已有逐字稿直接用（拼段是无损确定性的，成品即原始；每次打开/刷新视频页都会
      // 重发 PAGE_INFO，不检查则反复重抓覆盖）
      const existing = await deps.getTranscriptRecord(msg.meta.videoId);
      if (existing?.cues.length) {
        await deps.saveVideo({ ...msg.meta, url: `https://www.youtube.com/watch?v=${msg.meta.videoId}`, captionLang: 'en', fetchedAt: Date.now() });
        deps.broadcast(msg);
        return { ok: true, cueCount: existing.cues.length, reused: true };
      }
      // content script 已在页面上下文下载 timedtext；cues 为空说明直抓失败，走 Supadata 兜底
      let cues = msg.cues;
      if (!cues.length) {
        try {
          ({ cues } = await deps.getTranscriptWithFallback({ videoId: msg.meta.videoId, tracks: [] }));
        } catch (e) {
          // 无字幕/双通道均失败：广播给侧边栏展示错误条，可手动重试
          deps.broadcast({ type: 'TRANSCRIPT_FAILED', videoId: msg.meta.videoId, reason: e instanceof Error ? e.message : String(e) });
          return { error: e instanceof Error ? e.message : String(e) };
        }
      }
      // 程序化拼段：碎行→段落（文字一字不改，零 LLM 零费用）后落库；raw 保留原始碎行（重新分段的原料）
      const final = deps.mergeCues(cues);
      await deps.saveVideo({ ...msg.meta, url: `https://www.youtube.com/watch?v=${msg.meta.videoId}`, captionLang: 'en', fetchedAt: Date.now() });
      await deps.saveTranscript(msg.meta.videoId, final, undefined, undefined, cues);
      // 处理完成后广播，通知 sidepanel 刷新（sidepanel 依据 sender.tab 区分原始消息）
      deps.broadcast(msg);
      return { ok: true, cueCount: final.length };
    }
    case 'GET_VIDEO_DATA': {
      const [video, cues, notes, summary] = await Promise.all([
        deps.getVideo(msg.videoId), deps.getTranscript(msg.videoId), deps.getNotesByVideo(msg.videoId), deps.getSummary(msg.videoId),
      ]);
      return { video: video ?? null, cues: cues ?? [], notes, summary: summary ?? null } satisfies VideoData;
    }
    case 'TRANSLATE': {
      const record = await deps.getTranscriptRecord(msg.videoId);
      const cues = record?.cues ?? [];
      if (!cues.length) throw new Error('无逐字稿');
      // force：忽略已有译文全量重翻（「LLM 重翻」按钮）；否则只翻缺译文的
      const pending = msg.force ? cues : cues.filter((c) => !c.zh);
      if (!pending.length) return { ok: true, done: true };
      const s = await deps.getSettings();
      let out: { translated: Cue[]; failed: number };
      // force 且已配 LLM 时强制走 LLM（用户从免费通道切过来重翻的场景）；常规按设置通道
      const useLlm = !!s.llm && (msg.force || s.translateChannel === 'llm');
      let terms = record?.terms;
      if (useLlm) {
        // 术语表：库里没有则先提取一次（独立小请求），之后每批注入保证全片统一译法，随落库保存
        if (!terms?.length) {
          terms = await deps.extractTerms(s.llm, cues);
        }
        const texts = pending.map((c) => c.text);
        const zh = await deps.llmTranslateBatch(s.llm, texts, terms, makeStreamBroadcaster(deps.broadcast));
        out = { translated: pending.map((c, i) => ({ ...c, zh: zh[i] })), failed: 0 };
      } else {
        out = await deps.runBatchTranslation(pending, deps.googleFreeTranslate, { concurrency: 10 });
      }
      const merged = cues.map((c) => out.translated.find((t) => t.start === c.start) ?? c);
      await deps.saveTranscript(msg.videoId, merged, terms, record?.polishedAt, record?.raw);
      return { ok: true, failed: out.failed };
    }
    case 'SAVE_NOTE': await deps.addNote(msg.note); return { ok: true };
    case 'DELETE_NOTE': await deps.deleteNote(msg.id); return { ok: true };
    case 'EXPLAIN': {
      const s = await deps.getSettings();
      if (!s.llm) throw new Error('未配置 LLM');
      const cues = (await deps.getTranscript(msg.videoId)) ?? [];
      const ctx = cues.filter((c) => c.start >= msg.start - 30 && c.start <= msg.end + 30);
      const explanation = await deps.explainConfusion(s.llm, ctx);
      return { explanation };
    }
    case 'SUMMARIZE': {
      const s = await deps.getSettings();
      if (!s.llm) throw new Error('未配置 LLM');
      const [video, cues] = await Promise.all([deps.getVideo(msg.videoId), deps.getTranscript(msg.videoId)]);
      const summary = await deps.summarize(s.llm, video ?? { videoId: msg.videoId, title: '' }, cues ?? []);
      await deps.saveSummary(summary);
      return { summary };
    }
    case 'EXPORT': {
      const [video, cues, notes, summary] = await Promise.all([
        deps.getVideo(msg.videoId), deps.getTranscript(msg.videoId), deps.getNotesByVideo(msg.videoId), deps.getSummary(msg.videoId),
      ]);
      return { markdown: deps.buildFusedMarkdown({ video, notes: notes as Note[], summary: msg.notesOnly ? undefined : summary, transcript: cues, includeTranscript: msg.includeTranscript }) };
    }
    case 'LIST_LIBRARY': return { rows: await deps.listVideosWithNotes() };
    case 'GET_SETTINGS': return await deps.getSettings();
    case 'SAVE_SETTINGS': await deps.saveSettings(msg.patch); return { ok: true };
    case 'SEEK': deps.sendToActiveTab(msg); return { ok: true };
    case 'CAPTURE_NOW': deps.sendToActiveTab(msg); return { ok: true };
    // content 直发的心跳/编辑器消息到达 background：静默放行，不再落「未知消息」
    case 'PLAYBACK': return { ok: true };
    case 'OPEN_NOTE_EDITOR': return { ok: true };
    case 'DELETE_TRANSCRIPT': await deps.deleteTranscript(msg.videoId); return { ok: true };
    case 'CLEAR_ALL_DATA': await deps.clearAllVideoData(); return { ok: true };
    case 'RESEGMENT': {
      const record = await deps.getTranscriptRecord(msg.videoId);
      const raw = record?.raw;
      if (!raw?.length) throw new Error('无原始碎行（旧库存视频请先「重抓字幕」补充原料）');
      let final: Cue[];
      if (msg.mode === 'ai') {
        const s = await deps.getSettings();
        if (!s.llm) throw new Error('AI 分段需要先配置 LLM');
        const sentences = deps.sentencesFromCues(raw);
        const bps = await deps.aiSegmentBreakpoints(s.llm, sentences, makeStreamBroadcaster(deps.broadcast));
        // 诊断日志（不含 key/全文）：断点为 0 说明模型输出未解析到 → 已退回规则组段
        console.info('[video-note] segment', `ai breakpoints=${bps.length}/${sentences.length} sentences${bps.length ? '' : ' (fallback to rules)'}`);
        final = deps.sentencesToParagraphs(sentences, bps.length ? bps : undefined);
      } else {
        final = deps.mergeCues(raw);
        // 诊断日志（不含 key/全文）：原料条数 vs 产出段数——段数≈条数说明预切/分句没生效
        console.info('[video-note] segment', `rules raw=${raw.length} cues -> ${final.length} paras, avg ${Math.round(final.reduce((n, c) => n + c.text.length, 0) / Math.max(1, final.length))} chars`);
      }
      // 文字一字不动：术语表仍适用故保留；新段与旧译文失配 → 落库即清空待重翻；raw 保留
      await deps.saveTranscript(msg.videoId, final, record?.terms, record?.polishedAt, raw);
      // 写后回读验证（2026-09-02 排障）：区分"写入失败"（回读旧值/空）与"读取端问题"（回读新值但界面/导出仍旧）
      const verify = await deps.getTranscriptRecord(msg.videoId);
      console.info('[video-note] segment', `saved ${final.length}, reread ${verify?.cues?.length ?? 'undefined'} (videoId=${msg.videoId})`);
      return { ok: true, cueCount: final.length };
    }
    case 'RETRY_TRANSCRIPT': deps.sendToActiveTab(msg); return { ok: true };
    default: throw new Error(`未知消息: ${(msg as any).type}`);
  }
}
