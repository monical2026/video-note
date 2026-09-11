import type { Cue, LlmConfig, Summary } from '../types';
import { chatJson } from './llm';

/** 按累计字符切块（单条永不切断），供超长视频 map-reduce */
export function chunkTranscript(cues: Cue[], maxChars: number): Cue[][] {
  const chunks: Cue[][] = []; let cur: Cue[] = []; let n = 0;
  for (const c of cues) {
    if (cur.length && n + c.text.length > maxChars) { chunks.push(cur); cur = []; n = 0; }
    cur.push(c); n += c.text.length;
  }
  if (cur.length) chunks.push(cur);
  return chunks;
}

/** 疑惑解释：结合上下文字幕给中文讲解 */
export async function explainConfusion(config: LlmConfig, contextCues: Cue[]): Promise<string> {
  const r = await chatJson<{ explanation: string }>(config, [
    { role: 'system', content: '你看视频教程时有疑惑，结合以下带时间戳的字幕上下文，用中文通俗解释疑惑点：先一句话直击要害，再展开原理，必要时给一个小例子。输出 JSON：{"explanation":"..."}' },
    { role: 'user', content: JSON.stringify(contextCues.map((c) => ({ t: c.start, text: c.text }))) },
  ]);
  return r.explanation;
}

const SUMMARY_SCHEMA = {
  oneLiner: '一句话总结：整个视频解决什么核心问题（中文）',
  sections: [{
    start: 0, end: 0,
    title: '小节标题（中文）',
    overview: '这一小节讲了什么内容（两三句概述）',
    problem: '这一小节能解决什么问题',
    useCase: '学完能用在什么地方',
    points: ['要点，简洁中文'],
    clipWorthy: { level: 'high|medium|low', reason: '一句话理由' },
  }],
  keyQuotes: [{ quote: '金句的中文译文（保留原始语气）', en: '说话者的英文原话（清理转写错误与填充词，保留原语气）', start: 0 }],
  knowledge: [{ term: '术语（保留英文）', desc: '一句话中文说明' }],
  prerequisites: ['前置知识'],
};

/**
 * AI 摘要 v2（2026-09-07 用户定案，对标 youtube-digest prompts/analysis.md）：
 * 主题分节（一节=视频回答的一个完整问题，节长由内容定，禁时间均匀切）+ 金句 + 覆盖性硬规则 + 时间戳防编造。
 * 长视频仍按字符切块（防超上下文），但 map 阶段提炼"主题线索"，reduce 明确要求重组为主题分节——不按块归组。
 */
const SUMMARY_SYSTEM = `你是一名视频内容分析助手。基于带时间戳的逐字稿生成结构化学习摘要，严格输出符合此形状的 JSON：${JSON.stringify(SUMMARY_SCHEMA)}

【分节哲学——最重要】
- 按"问题/主题"划分：一节 = 视频回答的一个完整问题。切在话题自然切换的位置，一节一个完整主题
- 节的长度由内容决定，可长可短（2 分钟的主题一节，15 分钟的主题也一节）；节数一般 3~8 节，由内容真实决定
- ❌ 禁止按时间长度均匀切分（如每 5 分钟一节）——那是流水账，不是结构

【覆盖性硬规则】
- sections 必须覆盖整个视频时间线：从开头到结尾
- 最后一节的 start 必须在视频后段（不允许所有节都挤在前半，后半没有节）

【时间戳硬规则】
- 每个 start/end/金句时间必须来自逐字稿中真实存在的行的 t 值；禁止编造、禁止默认填 0
- end 是该节内容结束的时间（下一节 start 附近或视频结尾）

【切片价值判定】（用户用途：判断值不值得单独剪出来分享、作剪辑参考）
- high：自成一体（完整案例演示/独立技巧/不依赖前后文），单独剪出即可观看
- medium：半自成（少量背景即可理解）
- low：依赖前后文铺垫（如承接上文的推导中段）

【金句】3~5 条，聚焦：反直觉的独特洞察 / 惊人的事实数据 / 印象深刻的轶事 / 一句话点透本质的表达。
每条金句必须成对给出：quote=中文译文，en=说话者的英文原话（逐字稿是英文时必须取原句，清理转写错误与口头填充词 um/uh/you know，保留原始语气与用词）。时间必须真实存在于逐字稿。

所有文字用简体中文（术语/产品名保留英文；金句的 en 字段除外，必须是英文原话）。sections 与 keyQuotes 按时间排序。`;

export async function summarize(config: LlmConfig, video: { videoId: string; title: string }, cues: Cue[]): Promise<Summary> {
  const chunks = chunkTranscript(cues, 12000);
  const videoEnd = cues.at(-1) ? cues.at(-1)!.start + cues.at(-1)!.dur : 0;
  let mapPoints: { start: number; point: string; theme?: string }[] = [];

  if (chunks.length > 1) {
    // map 阶段：提炼主题线索（不是干巴巴要点——reduce 重组主题分节的原料）
    const one = async (ch: Cue[]) => {
      const messages = [
        { role: 'system', content: '分析这段视频字幕片段：这段在讲什么主题？依次回答/讨论了哪些问题？输出 JSON：{"points":[{"start":秒数,"point":"要点（中文）","theme":"该点所属主题（中文短语）"}]}' },
        { role: 'user', content: `视频《${video.title}》片段字幕：\n` + JSON.stringify(ch.map((c) => ({ t: c.start, text: c.text }))) },
      ] as const;
      const r = await chatJson<{ points: { start: number; point: string; theme?: string }[] }>(config, [...messages]);
      return r.points ?? [];
    };
    const results = await Promise.allSettled(chunks.map(async (ch) => {
      try { return await one(ch); } catch { return await one(ch); } // 重试一次
    }));
    mapPoints = results.flatMap((r) => (r.status === 'fulfilled' ? r.value : []));
  }

  const finalContext = (chunks.length > 1
    ? '各片段的主题线索（含时间戳）：\n' + JSON.stringify(mapPoints)
    : '完整逐字稿：\n' + JSON.stringify(cues.map((c) => ({ t: c.start, text: c.text }))))
    + `\n视频总时长约 ${Math.round(videoEnd)} 秒`;

  const r = await chatJson<Omit<Summary, 'videoId' | 'model' | 'generatedAt'>>(config, [
    { role: 'system', content: SUMMARY_SYSTEM },
    { role: 'user', content: `视频《${video.title}》\n${finalContext}` },
  ]);

  return {
    videoId: video.videoId, oneLiner: r.oneLiner,
    sections: (r.sections ?? []).sort((a, b) => a.start - b.start),
    keyQuotes: (r.keyQuotes ?? []).sort((a, b) => a.start - b.start),
    knowledge: r.knowledge ?? [], prerequisites: r.prerequisites ?? [],
    model: config.model, generatedAt: Date.now(),
  };
}
