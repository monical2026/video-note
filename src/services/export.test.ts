import { describe, expect, it } from 'vitest';
import { buildExportMarkdown } from './export';
import type { Note, Summary, VideoMeta } from '../types';

const video: VideoMeta = { videoId: 'abc', title: 'Closures Explained', channel: 'Dev', url: 'https://youtube.com/watch?v=abc', captionLang: 'en', fetchedAt: 1 };
const notes: Note[] = [
  { id: '1', videoId: 'abc', start: 195, end: 200, excerpt: 'closures capture state', annotation: '闭包 = 记住出生环境', type: 'value', createdAt: 1 },
  { id: '2', videoId: 'abc', start: 542, end: 548, excerpt: 'vs scope chain', annotation: '和作用域链什么关系？', type: 'confusion', aiExplanation: '作用域链是规则，闭包是现象。', createdAt: 2 },
];
const summary: Summary = {
  videoId: 'abc', oneLiner: '讲透闭包',
  sections: [{ start: 192, end: 260, title: '闭包的定义与直觉', overview: '用背包比喻引入闭包概念。', problem: '理解闭包到底捕获了什么', useCase: '解释回调中的变量存活', points: ['闭包=函数+词法环境'], clipWorthy: { level: 'high', reason: '完整案例自成一体' } }],
  keyQuotes: [{ quote: 'A closure is a backpack.', start: 200 }],
  knowledge: [{ term: 'closure', desc: '函数+词法环境' }], prerequisites: ['作用域'],
  model: 'm', generatedAt: 1,
};
const transcript = [{ start: 1, dur: 2, text: 'hi', zh: '你好' }];

describe('buildExportMarkdown（§0.13 parts 多选合并单文档）', () => {
  it('全选：三部分各带显式总标题，笔记嵌入所属摘要小节，分节降级 ###', () => {
    const md = buildExportMarkdown({ video, notes, summary, transcript, parts: ['notes', 'summary', 'transcript'] });
    // 三部分总标题（用户要求：文档上标注什么是什么）
    expect(md).toContain('## 🤖 AI 摘要');
    expect(md).toContain('## ⭐ 我的笔记');
    expect(md).toContain('## 📄 逐字稿');
    // 摘要分节降级 ### 且带起止时间戳链接
    expect(md).toContain('### [03:12](https://www.youtube.com/watch?v=abc&t=192s) ~ [04:20](https://www.youtube.com/watch?v=abc&t=260s) 闭包的定义与直觉');
    expect(md).toContain('### 💬 金句');
    expect(md).toContain('### 📚 知识点清单');
    // 笔记 195s 落在 192~260 小节 → 嵌入其后；542s 未覆盖 → 归入笔记节
    expect(md.indexOf('⭐ **我的笔记**')).toBeGreaterThan(md.indexOf('闭包的定义与直觉'));
    expect(md.indexOf('## ⭐ 我的笔记')).toBeLessThan(md.indexOf('❓ **我的疑惑**'));
    expect(md).toContain('🤖 **AI 解释**');
    expect(md).toContain('## 📄 逐字稿');
    expect(md).toContain('- [00:01](https://www.youtube.com/watch?v=abc&t=1s) hi ｜ 你好');
    // frontmatter
    expect(md).toContain('source: "https://youtube.com/watch?v=abc"');
    expect(md).toContain('title: "Closures Explained"');
  });

  it('仅笔记：无摘要节，纯笔记时间线', () => {
    const md = buildExportMarkdown({ video, notes, parts: ['notes'] });
    expect(md).toContain('## ⭐ 我的笔记');
    expect(md).not.toContain('## 🤖 AI 摘要');
    expect(md).not.toContain('知识点清单');
    expect(md.indexOf('⭐ **我的笔记**')).toBeLessThan(md.indexOf('❓ **我的疑惑**'));   // 按时间排序
  });

  it('仅逐字稿：只有逐字稿节', () => {
    const md = buildExportMarkdown({ video, notes, transcript, parts: ['transcript'] });
    expect(md).toContain('## 📄 逐字稿');
    expect(md).not.toContain('我的笔记');
    expect(md).not.toContain('AI 摘要');
    expect(md).toContain('你好');
  });

  it('摘要+逐字稿（不选笔记）：无任何笔记内容', () => {
    const md = buildExportMarkdown({ video, notes, summary, transcript, parts: ['summary', 'transcript'] });
    expect(md).toContain('## 🤖 AI 摘要');
    expect(md).toContain('## 📄 逐字稿');
    expect(md).not.toContain('我的笔记');     // 嵌入与独立节都不出现
    expect(md).not.toContain('❓ **我的疑惑**');
  });

  it('仅摘要：摘要完整字段 + 金句 + 知识点，分节 ###', () => {
    const md = buildExportMarkdown({ video, notes: [], summary, parts: ['summary'] });
    expect(md).toContain('## 🤖 AI 摘要');
    expect(md).toContain('> 📌 一句话总结：讲透闭包');
    expect(md).toContain('🎯 **解决的问题**：理解闭包到底捕获了什么');
    expect(md).toContain('🧭 **应用场景**：解释回调中的变量存活');
    expect(md).toContain('✂️ **切片价值：高**——完整案例自成一体');
    expect(md).toContain('「A closure is a backpack.」');
    expect(md).not.toContain('## 📄');
  });

  it('选笔记但库里没有笔记：输出「暂无笔记」占位', () => {
    const md = buildExportMarkdown({ video, notes: [], summary, parts: ['notes', 'summary'] });
    expect(md).toContain('> 暂无笔记');
  });

  it('excerptZh 出现在摘录行后（noteBlock 格式不回归）', () => {
    const withZh: Note[] = [{ ...notes[0]!, excerptZh: '闭包捕获状态' }];
    const md = buildExportMarkdown({ video, notes: withZh, parts: ['notes'] });
    expect(md).toContain('> 「closures capture state」\n> 闭包捕获状态');
    expect(buildExportMarkdown({ video, notes, parts: ['notes'] })).not.toContain('undefined');
  });
});
