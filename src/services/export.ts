import type { Cue, Note, Summary, VideoMeta } from '../types';
import { mdTimestampLink } from '../utils/time';

/** 导出内容多选（§0.13）：任意组合合并为单文档，各部分带显式总标题 */
export type ExportPart = 'notes' | 'summary' | 'transcript';

const noteBlock = (videoId: string, n: Note): string => {
  const icon = n.type === 'value' ? '⭐ **我的笔记**' : '❓ **我的疑惑**';
  const lines = [`> ${icon} · ${mdTimestampLink(videoId, n.start)}`, `> ${n.annotation}`];
  if (n.excerpt) lines.push(`> 「${n.excerpt}」`);
  if (n.excerptZh) lines.push('> ' + n.excerptZh);
  if (n.aiExplanation) lines.push('> 🤖 **AI 解释**：' + n.aiExplanation);
  return lines.join('\n');
};

/** 按所选部分构建导出 Markdown：多选合并单文档、显式总标题标注各部分；选摘要且选笔记时笔记嵌入对应小节，未覆盖的归入笔记节 */
export function buildExportMarkdown(input: {
  video: VideoMeta; notes: Note[]; summary?: Summary | null; transcript?: Cue[];
  parts: ExportPart[]; now?: Date;
}): string {
  const { video, notes, transcript, now = new Date() } = input;
  const parts = new Set(input.parts);
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
  const out: string[] = [...head];

  const summary = input.summary ?? null;
  const wantSummary = parts.has('summary') && !!summary;
  const wantNotes = parts.has('notes');
  const sections = wantSummary ? [...summary!.sections].sort((a, b) => a.start - b.start) : [];
  // 最后一节以自身 end 为界（旧版用 Infinity 会把末节之后的笔记误判为已覆盖而丢失）
  const ends = sections.map((s, i) => (i + 1 < sections.length ? sections[i + 1]!.start : (s.end ?? Infinity)));

  // —— AI 摘要：总标题标注，分节降级 ###；选了笔记时笔记嵌入对应小节 ——
  if (wantSummary && summary) {
    const embedNotes = wantNotes && sorted.length > 0;
    out.push('## 🤖 AI 摘要', '', `> 📌 一句话总结：${summary.oneLiner}`, '');
    sections.forEach((sec, i) => {
      const endMark = sec.end != null ? ` ~ ${mdTimestampLink(video.videoId, sec.end)}` : '';
      out.push(`### ${mdTimestampLink(video.videoId, sec.start)}${endMark} ${sec.title}`, '');
      if (sec.overview) out.push(`> ${sec.overview}`, '');
      if (sec.problem) out.push(`> 🎯 **解决的问题**：${sec.problem}`, '');
      if (sec.useCase) out.push(`> 🧭 **应用场景**：${sec.useCase}`, '');
      if (sec.clipWorthy) out.push(`> ✂️ **${sec.clipWorthy.level === 'high' ? '切片价值：高' : sec.clipWorthy.level === 'medium' ? '切片价值：中' : '切片价值：低'}**——${sec.clipWorthy.reason}`, '');
      if (sec.points.length) { sec.points.forEach((p) => out.push(`- ${p}`)); out.push(''); }
      if (embedNotes) sorted.filter((n) => n.start >= sec.start && n.start < ends[i]!).forEach((n) => out.push(noteBlock(video.videoId, n), ''));
    });
    if (summary.keyQuotes?.length) {
      out.push('### 💬 金句', '');
      summary.keyQuotes.forEach((k) => out.push(`- ${mdTimestampLink(video.videoId, k.start)}「${k.quote}」`));
      out.push('');
    }
    if (summary.knowledge.length) {
      out.push('### 📚 知识点清单', '');
      summary.knowledge.forEach((k) => out.push(`- **${k.term}**：${k.desc}`));
      out.push('');
    }
    if (summary.prerequisites.length) {
      out.push('### 前置知识 / 延伸', '', ...summary.prerequisites.map((p) => `- ${p}`), '');
    }
  }

  // —— 我的笔记：嵌入模式（有摘要+有笔记）仅收编未落小节的笔记；否则独立时间线（空则占位） ——
  if (wantNotes) {
    const embedMode = wantSummary && summary && sorted.length > 0;
    if (embedMode) {
      const covered = new Set(sections.flatMap((s, i) => sorted.filter((n) => n.start >= s.start && n.start < ends[i]!).map((n) => n.id)));
      const uncovered = sorted.filter((n) => !covered.has(n.id));
      if (uncovered.length) {
        out.push('## ⭐ 我的笔记', '');
        uncovered.forEach((n) => out.push(noteBlock(video.videoId, n), ''));
      }
    } else {
      out.push('## ⭐ 我的笔记', '');
      if (sorted.length) sorted.forEach((n) => out.push(noteBlock(video.videoId, n), ''));
      else out.push('> 暂无笔记', '');
    }
  }

  // —— 逐字稿 ——
  if (parts.has('transcript') && transcript?.length) {
    out.push('## 📄 逐字稿', '', ...transcript.map((c) => `- ${mdTimestampLink(video.videoId, c.start)} ${c.text}${c.zh ? ` ｜ ${c.zh}` : ''}`), '');
  }
  return out.join('\n');
}
