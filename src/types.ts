// 领域类型定义（后续所有任务依赖此文件）

export interface Cue { start: number; dur: number; text: string; zh?: string; }        // 秒
export type DisplayMode = 'bilingual' | 'zh' | 'en';
export type NoteType = 'value' | 'confusion';
export interface Note {
  id: string; videoId: string; start: number; end: number;
  excerpt: string;           // 原文摘录（英文）
  annotation: string;        // 用户批注
  type: NoteType;
  excerptZh?: string;        // 摘录的中文对照（来自字幕翻译）
  aiExplanation?: string;    // 疑惑的 AI 解释（可编辑）
  createdAt: number;
}
export interface VideoMeta {
  videoId: string; title: string; channel: string; url: string;
  captionLang: string; fetchedAt: number;
}
export interface SummarySection { start: number; title: string; points: string[]; }
export interface Summary {
  videoId: string; oneLiner: string;
  sections: SummarySection[];
  knowledge: { term: string; desc: string }[];
  prerequisites: string[];
  model: string; generatedAt: number;
}
export interface LlmConfig { baseUrl: string; apiKey: string; model: string; }
export interface Term { en: string; zh: string; }   // 术语表：全片统一译法（润色阶段产出，翻译批次复用）
export interface TranscriptRecord { cues: Cue[]; terms?: Term[]; polishedAt?: number; }  // transcripts store 存储形状（旧数据是纯 Cue[] 数组；polishedAt=已润色标记，防重复润色扣费）
export interface Settings {
  displayMode: DisplayMode;
  translateChannel: 'free' | 'llm';
  llm: LlmConfig | null;        // null = 未配置
  supadataKey: string;           // '' = 未配置
  polishEnabled: boolean;        // LLM 纠错润色开关
  llmKeys?: {                    // 各服务商 API Key 记忆槽位（切换预设自动带出）
    zhipu?: string; deepseek?: string; openai?: string;
  };
}
