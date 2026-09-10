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
/** 切片价值：该节是否自成一体、值得单独剪出来分享或作剪辑参考（用户 2026-09-07 定案用途） */
export interface ClipWorthiness { level: 'high' | 'medium' | 'low'; reason: string; }
export interface SummarySection {
  start: number; end?: number;        // 起止时间（切片范围）
  title: string;
  overview?: string;                  // 这一小节讲了什么（两三句概述）
  problem?: string;                   // 这一小节能解决什么问题
  useCase?: string;                   // 学完能用在什么地方
  points: string[];
  clipWorthy?: ClipWorthiness;
}
/** 金句：带时间戳，聚焦反直觉洞察/惊人事实/轶事/点透本质的表达 */
export interface KeyQuote { quote: string; start: number; }
export interface Summary {
  videoId: string; oneLiner: string;
  sections: SummarySection[];
  keyQuotes?: KeyQuote[];
  knowledge: { term: string; desc: string }[];
  prerequisites: string[];
  model: string; generatedAt: number;
}
export interface LlmConfig { baseUrl: string; apiKey: string; model: string; }
export interface Term { en: string; zh: string; }   // 术语表：全片统一译法（润色阶段产出，翻译批次复用）
export interface TranscriptRecord { cues: Cue[]; terms?: Term[]; polishedAt?: number; raw?: Cue[]; }  // transcripts store 存储形状（旧数据是纯 Cue[] 数组；raw=原始碎行，重新分段的原料）
export const THEMES = ['light', 'dark', 'amber'] as const;  // 界面主题全集：Theme 类型/归一化/设置按钮共用此源
export type Theme = typeof THEMES[number];
export interface Settings {
  theme: Theme;                    // 界面主题（三套可切换，2026-09-07 用户需求）
  displayMode: DisplayMode;
  translateChannel: 'free' | 'llm';
  llm: LlmConfig | null;        // null = 未配置
  supadataKey: string;           // '' = 未配置
  llmKeys?: {                    // 各服务商 API Key 记忆槽位（切换预设自动带出）
    zhipu?: string; deepseek?: string; openai?: string;
  };
}
