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
  sections: [{ start: 192, title: '闭包的定义与直觉', points: ['闭包=函数+词法环境'] }],
  knowledge: [{ term: 'closure', desc: '函数+词法环境' }], prerequisites: ['作用域'],
  model: 'm', generatedAt: 1,
};

it('笔记嵌入所属摘要小节', () => {
  const md = buildFusedMarkdown({ video, notes, summary });
  expect(md).toContain('## [03:12](https://www.youtube.com/watch?v=abc&t=192s) 闭包的定义与直觉');
  expect(md.indexOf('⭐ **我的笔记**')).toBeGreaterThan(md.indexOf('闭包的定义与直觉'));
  expect(md).toContain('🤖 **AI 解释**');
  expect(md).toContain('## 📚 知识点清单');
  expect(md).toContain('source: https://youtube.com/watch?v=abc');
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
  expect(buildFusedMarkdown({ video, notes, summary })).toMatchSnapshot();
});
