import type { Msg, VideoData } from './protocol';
import type { Cue, Note, Settings, Summary } from '../types';

export interface RouterDeps {
  getTranscript(videoId: string): Promise<Cue[] | undefined>;
  saveTranscript(videoId: string, cues: Cue[]): Promise<unknown>;
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
  llmTranslateBatch(config: any, texts: string[]): Promise<string[]>;
  explainConfusion(config: any, cues: Cue[]): Promise<string>;
  summarize(config: any, video: any, cues: Cue[]): Promise<Summary>;
  buildFusedMarkdown(input: any): string;
  broadcast(msg: Msg): void;          // 面板广播（PLAYBACK/OPEN_NOTE_EDITOR 等）
  sendToActiveTab(msg: Msg): void;    // content script 定向
}

/** 消息路由：纯函数，全部依赖注入（真实绑定在 background.ts） */
export async function handleMessage(msg: Msg, deps: RouterDeps): Promise<any> {
  switch (msg.type) {
    case 'PAGE_INFO': {
      const { cues } = await deps.getTranscriptWithFallback({ videoId: msg.meta.videoId, tracks: msg.tracks });
      await deps.saveVideo({ ...msg.meta, url: `https://www.youtube.com/watch?v=${msg.meta.videoId}`, captionLang: 'en', fetchedAt: Date.now() });
      await deps.saveTranscript(msg.meta.videoId, cues);
      return { ok: true, cueCount: cues.length };
    }
    case 'GET_VIDEO_DATA': {
      const [video, cues, notes, summary] = await Promise.all([
        deps.getVideo(msg.videoId), deps.getTranscript(msg.videoId), deps.getNotesByVideo(msg.videoId), deps.getSummary(msg.videoId),
      ]);
      return { video: video ?? null, cues: cues ?? [], notes, summary: summary ?? null } satisfies VideoData;
    }
    case 'TRANSLATE': {
      const cues = (await deps.getTranscript(msg.videoId)) ?? [];
      if (!cues.length) throw new Error('无逐字稿');
      const pending = cues.filter((c) => !c.zh);
      if (!pending.length) return { ok: true, done: true };
      const s = await deps.getSettings();
      let out: { translated: Cue[]; failed: number };
      if (s.translateChannel === 'llm' && s.llm) {
        const texts = pending.map((c) => c.text);
        const zh = await deps.llmTranslateBatch(s.llm, texts);
        out = { translated: pending.map((c, i) => ({ ...c, zh: zh[i] })), failed: 0 };
      } else {
        out = await deps.runBatchTranslation(pending, deps.googleFreeTranslate, { concurrency: 5 });
      }
      const merged = cues.map((c) => out.translated.find((t) => t.start === c.start) ?? c);
      await deps.saveTranscript(msg.videoId, merged);
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
    case 'GET_SETTINGS': return await deps.getSettings();
    case 'SAVE_SETTINGS': await deps.saveSettings(msg.patch); return { ok: true };
    case 'SEEK': deps.sendToActiveTab(msg); return { ok: true };
    case 'CAPTURE_NOW': deps.sendToActiveTab(msg); return { ok: true };
    default: throw new Error(`未知消息: ${(msg as any).type}`);
  }
}
