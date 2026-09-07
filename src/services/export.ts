import type { Cue, Note, Summary, VideoMeta } from '../types';
import { formatTime, tsLink } from '../utils/time';

const noteBlock = (videoId: string, n: Note): string => {
  const icon = n.type === 'value' ? '⭐ **我的笔记**' : '❓ **我的疑惑**';
  const lines = [`> ${icon} · [${formatTime(n.start)}](${tsLink(videoId, n.start)})`, `> ${n.annotation}`];
  if (n.excerpt) lines.push(`> 「${n.excerpt}」`);
  if (n.excerptZh) lines.push('> ' + n.excerptZh);
  if (n.aiExplanation) lines.push('> 🤖 **AI 解释**：' + n.aiExplanation);
  return lines.join('\n');
};

/** 融合导出：时间轴骨架，摘要分节 + 笔记嵌入（不经 LLM，批注原样保留）。now 仅测试注入，默认当前时间 */
export function buildFusedMarkdown(input: { video: VideoMeta; notes: Note[]; summary?: Summary; transcript?: Cue[]; includeTranscript?: boolean; now?: Date }): string {
  const { video, notes, summary, transcript, includeTranscript, now = new Date() } = input;
  const sorted = [...notes].sort((a, b) => a.start - b.start);
  const head = [
    '---',
    // JSON.stringify 产出合法 YAML 双引号标量，自动转义 : 引号等特殊字符
    `title: ${JSON.stringify(video.title)}`,
    `source: ${JSON.stringify(video.url)}`,
    `channel: ${JSON.stringify(video.channel)}`,
    // sv-SE locale 恰好输出 YYYY-MM-DD，且按本地时区
    `date: ${now.toLocaleDateString('sv')}`,
    '---', '',
    `# ${video.title}`, '',
  ];
  if (!summary) { // 退化：纯笔记时间线
    const body = sorted.length ? ['## 我的笔记', '', ...sorted.flatMap((n) => [noteBlock(video.videoId, n), ''])] : ['> 暂无笔记'];
    if (includeTranscript && transcript?.length) {
      body.push('## 附录：完整逐字稿', '', ...transcript.map((c) => `- [${formatTime(c.start)}](${tsLink(video.videoId, c.start)}) ${c.text}${c.zh ? ` ｜ ${c.zh}` : ''}`), '');
    }
    return [...head, ...body].join('\n');
  }
  const sections = [...summary.sections].sort((a, b) => a.start - b.start);
  const parts = [`> 📌 一句话总结：${summary.oneLiner}`, ''];
  const ends = sections.map((s, i) => (i + 1 < sections.length ? sections[i + 1]!.start : Infinity));
  sections.forEach((sec, i) => {
    const endMark = sec.end != null ? ` ~ [${formatTime(sec.end)}](${tsLink(video.videoId, sec.end)})` : '';
    parts.push(`## [${formatTime(sec.start)}](${tsLink(video.videoId, sec.start)})${endMark} ${sec.title}`, '');
    if (sec.overview) parts.push(`> ${sec.overview}`, '');
    if (sec.problem) parts.push(`> 🎯 **解决的问题**：${sec.problem}`, '');
    if (sec.useCase) parts.push(`> 🧭 **应用场景**：${sec.useCase}`, '');
    if (sec.clipWorthy) parts.push(`> ✂️ **${sec.clipWorthy.level === 'high' ? '切片价值：高' : sec.clipWorthy.level === 'medium' ? '切片价值：中' : '切片价值：低'}**——${sec.clipWorthy.reason}`, '');
    if (sec.points.length) { sec.points.forEach((p) => parts.push(`- ${p}`)); parts.push(''); }
    sorted.filter((n) => n.start >= sec.start && n.start < ends[i]!).forEach((n) => parts.push(noteBlock(video.videoId, n), ''));
  });
  if (summary.keyQuotes?.length) {
    parts.push('## 💬 金句', '');
    summary.keyQuotes.forEach((k) => parts.push(`- [${formatTime(k.start)}](${tsLink(video.videoId, k.start)})「${k.quote}」`));
    parts.push('');
  }
  // 不落在任何小节的笔记，追加到尾部时间线
  const covered = new Set(sections.flatMap((s, i) => sorted.filter((n) => n.start >= s.start && n.start < ends[i]!).map((n) => n.id)));
  sorted.filter((n) => !covered.has(n.id)).forEach((n) => parts.push(noteBlock(video.videoId, n), ''));
  if (summary.knowledge.length) {
    parts.push('## 📚 知识点清单', '');
    summary.knowledge.forEach((k) => parts.push(`- **${k.term}**：${k.desc}`));
    parts.push('');
  }
  if (summary.prerequisites.length) {
    parts.push('## 前置知识 / 延伸', '', ...summary.prerequisites.map((p) => `- ${p}`), '');
  }
  if (includeTranscript && transcript?.length) {
    parts.push('## 附录：完整逐字稿', '', ...transcript.map((c) => `- [${formatTime(c.start)}](${tsLink(video.videoId, c.start)}) ${c.text}${c.zh ? ` ｜ ${c.zh}` : ''}`), '');
  }
  return [...head, ...parts].join('\n');
}
