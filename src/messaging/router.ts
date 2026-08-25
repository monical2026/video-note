import type { Msg, VideoData } from './protocol';
import type { Cue, Note, Settings, Summary, Term, VideoMeta } from '../types';
import type { OnStream } from '../services/llm-translate';

/** LLM 流式进度 → 面板广播：80ms 节流（delta 高频，UI 只需最新帧）；阶段/批号变化强制发（新批立即可见） */
function makeStreamBroadcaster(broadcast: (msg: Msg) => void): OnStream {
  let last = 0;
  let lastKey = '';
  return (info) => {
    const key = `${info.phase}:${info.batch}`;
    const now = Date.now();
    if (key !== lastKey || now - last >= 80) {
      lastKey = key; last = now;
      broadcast({ type: 'LLM_STREAM', ...info });
    }
  };
}

export interface RouterDeps {
  getTranscript(videoId: string): Promise<Cue[] | undefined>;
  getTranscriptRecord(videoId: string): Promise<{ cues: Cue[]; terms?: Term[]; polishedAt?: number } | undefined>;
  saveTranscript(videoId: string, cues: Cue[], terms?: Term[], polishedAt?: number): Promise<unknown>;
  saveVideo(meta: any): Promise<unknown>;
  getVideo(videoId: string): Promise<any>;
  getNotesByVideo(videoId: string): Promise<Note[]>;
  addNote(n: Note): Promise<unknown>;
  deleteNote(id: string): Promise<unknown>;
  getSummary(videoId: string): Promise<Summary | undefined>;
  saveSummary(s: Summary): Promise<unknown>;
  getSettings(): Promise<Settings>;
  saveSettings(patch: Partial<Settings>): Promise<void>;
  getTranscriptWithFallback(input: any): Promise<{ cues: Cue[]; source: string }>;
  googleFreeTranslate(text: string): Promise<string>;
  runBatchTranslation(cues: Cue[], fn: (t: string) => Promise<string>, opts: any): Promise<{ translated: Cue[]; failed: number }>;
  llmTranslateBatch(config: any, texts: string[], terms?: Term[], onStream?: OnStream): Promise<string[]>;
  polishTranscript(config: any, cues: Cue[], onStream?: OnStream): Promise<{ cues: Cue[]; terms: Term[] }>;
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
      // 幂等复用：库里已有润色版（polishedAt）时直接用——不重抓覆盖、不重复润色（每次打开视频页都会
      // 重发 PAGE_INFO，若无此检查则反复扣 token，且先落库还会毁掉已有润色版）。想重润只能显式点「重新润色」
      const existing = await deps.getTranscriptRecord(msg.meta.videoId);
      if (existing?.polishedAt && existing.cues.length) {
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
      // 润色：开关开启且已配 LLM 则先润色（分段+清理+术语表）再落库；失败静默跳过，用原字幕
      let final = cues;
      let terms: Term[] | undefined;
      let polishedAt: number | undefined;
      const s = await deps.getSettings();
      if (s.polishEnabled && s.llm) {
        try {
          const r = await deps.polishTranscript(s.llm, cues, makeStreamBroadcaster(deps.broadcast));
          final = r.cues; terms = r.terms; polishedAt = Date.now();
        } catch { /* 用原字幕 */ }
      }
      await deps.saveVideo({ ...msg.meta, url: `https://www.youtube.com/watch?v=${msg.meta.videoId}`, captionLang: 'en', fetchedAt: Date.now() });
      await deps.saveTranscript(msg.meta.videoId, final, terms, polishedAt);
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
      if (useLlm) {
        const texts = pending.map((c) => c.text);
        const zh = await deps.llmTranslateBatch(s.llm, texts, record?.terms, makeStreamBroadcaster(deps.broadcast));
        out = { translated: pending.map((c, i) => ({ ...c, zh: zh[i] })), failed: 0 };
      } else {
        out = await deps.runBatchTranslation(pending, deps.googleFreeTranslate, { concurrency: 10 });
      }
      const merged = cues.map((c) => out.translated.find((t) => t.start === c.start) ?? c);
      // polishedAt 透传：翻译存库不丢润色标记，否则下次 PAGE_INFO 又触发重复润色
      await deps.saveTranscript(msg.videoId, merged, record?.terms, record?.polishedAt);
      return { ok: true, failed: out.failed };
    }
    case 'POLISH': {
      const s = await deps.getSettings();
      if (!s.llm) throw new Error('未配置 LLM，润色需要大模型');
      const record = await deps.getTranscriptRecord(msg.videoId);
      const cues = record?.cues ?? [];
      if (!cues.length) throw new Error('无逐字稿');
      // 润色输出不带 zh：英文段落变了，旧译文必然失配，落库即清空待重翻
      const r = await deps.polishTranscript(s.llm, cues, makeStreamBroadcaster(deps.broadcast));
      await deps.saveTranscript(msg.videoId, r.cues, r.terms, Date.now());
      return { ok: true, cueCount: r.cues.length, termCount: r.terms.length };
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
    case 'RETRY_TRANSCRIPT': deps.sendToActiveTab(msg); return { ok: true };
    default: throw new Error(`未知消息: ${(msg as any).type}`);
  }
}
