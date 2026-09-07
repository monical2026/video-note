import { describe, expect, it } from 'vitest';
import { buildFusedMarkdown } from './export';
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

it('笔记嵌入所属摘要小节', () => {
  const md = buildFusedMarkdown({ video, notes, summary });
  // 摘要 v2：节标题带起止范围（end 时间戳跳转链接）
  expect(md).toContain('## [03:12](https://www.youtube.com/watch?v=abc&t=192s) ~ [04:20](https://www.youtube.com/watch?v=abc&t=260s) 闭包的定义与直觉');
  expect(md.indexOf('⭐ **我的笔记**')).toBeGreaterThan(md.indexOf('闭包的定义与直觉'));
  expect(md).toContain('🤖 **AI 解释**');
  // 摘要 v2 字段（2026-09-07）：概述/解决的问题/应用场景/切片价值/金句
  expect(md).toContain('> 用背包比喻引入闭包概念。');
  expect(md).toContain('🎯 **解决的问题**：理解闭包到底捕获了什么');
  expect(md).toContain('🧭 **应用场景**：解释回调中的变量存活');
  expect(md).toContain('✂️ **切片价值：高**——完整案例自成一体');
  expect(md).toContain('## 💬 金句');
  expect(md).toContain('「A closure is a backpack.」');
  expect(md).toContain('## 📚 知识点清单');
  expect(md).toContain('source: "https://youtube.com/watch?v=abc"');
  expect(md).toContain('title: "Closures Explained"');
});

it('无摘要时退化为纯笔记时间线', () => {
  const md = buildFusedMarkdown({ video, notes });
  expect(md).toContain('## 我的笔记');
  expect(md).not.toContain('知识点清单');
});

it('includeTranscript 附加附录', () => {
  const md = buildFusedMarkdown({ video, notes, transcript: [{ start: 1, dur: 2, text: 'hi', zh: '你好' }], includeTranscript: true });
  expect(md).toContain('## 附录：完整逐字稿');
  expect(md).toContain('你好');
});

it('格式快照', () => {
  // now 固定注入：快照不随真实日期漂移（否则隔天跑必红）
  expect(buildFusedMarkdown({ video, notes, summary, now: new Date('2026-08-20') })).toMatchSnapshot();
});

it('excerptZh 出现在摘录行后', () => {
  const withZh: Note[] = [{ ...notes[0]!, excerptZh: '闭包捕获状态' }];
  const md = buildFusedMarkdown({ video, notes: withZh });
  expect(md).toContain('> 「closures capture state」\n> 闭包捕获状态');
  // 旧笔记无 excerptZh 正常
  expect(buildFusedMarkdown({ video, notes })).not.toContain('undefined');
});
