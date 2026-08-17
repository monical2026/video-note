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
  oneLiner: '一句话总结（中文）',
  sections: [{ start: 0, title: '小节标题（中文）', points: ['要点，简洁中文'] }],
  knowledge: [{ term: '术语（保留英文）', desc: '一句话中文说明' }],
  prerequisites: ['前置知识'],
};

/** 视频摘要：≤1 块直接生成；多块 map（逐块要点）→ reduce（汇总结构化） */
export async function summarize(config: LlmConfig, video: { videoId: string; title: string }, cues: Cue[]): Promise<Summary> {
  const chunks = chunkTranscript(cues, 12000);
  let mapPoints: { start: number; point: string }[] = [];

  if (chunks.length > 1) {
    // 单块失败重试一次，仍失败则跳过该块（保留已完成块继续 reduce）
    const one = async (ch: Cue[]) => {
      const messages = [
        { role: 'system', content: '总结这段视频字幕的要点。输出 JSON：{"points":[{"start":秒数,"point":"要点（中文）"}]}' },
        { role: 'user', content: `视频《${video.title}》片段字幕：\n` + JSON.stringify(ch.map((c) => ({ t: c.start, text: c.text }))) },
      ] as const;
      const r = await chatJson<{ points: { start: number; point: string }[] }>(config, [...messages]);
      return r.points ?? [];
    };
    const results = await Promise.allSettled(chunks.map(async (ch) => {
      try { return await one(ch); } catch { return await one(ch); } // 重试一次
    }));
    mapPoints = results.flatMap((r) => (r.status === 'fulfilled' ? r.value : []));
  }

  const finalContext = chunks.length > 1
    ? '各片段要点：\n' + JSON.stringify(mapPoints)
    : '完整字幕：\n' + JSON.stringify(cues.map((c) => ({ t: c.start, text: c.text })));

  const r = await chatJson<Omit<Summary, 'videoId' | 'model' | 'generatedAt'>>(config, [
    { role: 'system', content: `生成结构化学习摘要，严格输出符合此形状的 JSON：${JSON.stringify(SUMMARY_SCHEMA)}。sections 按时间排序，start 取该节起始秒数。` },
    { role: 'user', content: `视频《${video.title}》\n${finalContext}` },
  ]);

  return {
    videoId: video.videoId, oneLiner: r.oneLiner,
    sections: (r.sections ?? []).sort((a, b) => a.start - b.start),
    knowledge: r.knowledge ?? [], prerequisites: r.prerequisites ?? [],
    model: config.model, generatedAt: Date.now(),
  };
}
