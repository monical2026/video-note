import { describe, expect, it } from 'vitest';
import { mergeCues, sentencesFromCues, sentencesToParagraphs, type Sentence } from './segment';

const cue = (start: number, dur: number, text: string) => ({ start, dur, text });
const SENT = (over: Partial<Sentence> = {}): Sentence => ({ start: 0, end: 2, text: 'x', complete: true, nextGap: 0, ...over });

describe('层 1 分句：CUT/KEEP 决策表', () => {
  it('真句尾（. ? !）→ CUT', () => {
    const s = sentencesFromCues([cue(0, 2, 'first sentence.'), cue(2.2, 2, 'Second one.')]);
    expect(s).toHaveLength(2);
    expect(s[0]!.complete).toBe(true);
  });

  it('假句号不算句尾：缩写 Dr. / 小数 3.14 / v1.2 → KEEP', () => {
    const a = sentencesFromCues([cue(0, 2, 'Dr. Smith explains'), cue(2.1, 2, 'the concept.')]);
    expect(a).toHaveLength(1);
    const b = sentencesFromCues([cue(0, 2, 'like 3.14 or v1.2 or'), cue(2.1, 2, 'so on.')]);
    expect(b).toHaveLength(1);
  });

  it('弱边界（, ; : — …）/ 未闭合引号 / 续接词结尾 → KEEP', () => {
    expect(sentencesFromCues([cue(0, 2, 'here is the thing:'), cue(2.1, 2, 'closures.')])).toHaveLength(1);
    expect(sentencesFromCues([cue(0, 2, 'we talked about'), cue(2.1, 2, 'this before.')])).toHaveLength(1); // of/about 结尾续接
    expect(sentencesFromCues([cue(0, 2, 'he said " closures'), cue(2.1, 2, 'are great."')])).toHaveLength(1);
  });

  it('下一条以续接词开头且前一条无句号 → KEEP', () => {
    expect(sentencesFromCues([cue(0, 2, 'closures capture'), cue(2.1, 2, 'and keep state')])).toHaveLength(1);
  });

  it('无标点 + gap < 0.7s → KEEP（连说不切）', () => {
    expect(sentencesFromCues([cue(0, 2, 'so closures'), cue(2.05, 2, 'capture state')])).toHaveLength(1);
  });

  it('停顿断句已移除（2026-09-02 用户定案）：无标点数据即使长停顿+大写开头也 KEEP', () => {
    // 此前 gap≥1.5s+新句开头三条件会 CUT；移除后一律继续拼，由层 2 软上限兜底
    const a = sentencesFromCues([
      cue(0, 3, 'um so we have this concept called closures here'),
      cue(5, 2, 'They capture state'),   // gap=2.0，大写开头——仍不切
    ]);
    expect(a).toHaveLength(1);
    const b = sentencesFromCues([
      cue(0, 3, 'um so we have this concept called closures here'),
      cue(5, 2, 'they capture state'),   // 小写开头——同样不切
    ]);
    expect(b).toHaveLength(1);
  });

  it('>> 说话人切换 → CUT，>> 标记剔除并记录 speakerBreak', () => {
    const s = sentencesFromCues([
      cue(0, 2, 'host asks a question?'),
      cue(2.1, 2, '>> guest answers here'),
    ]);
    expect(s).toHaveLength(2);
    expect(s.map((x) => x.text)).toEqual(['host asks a question?', 'guest answers here']);
    expect(s[1]!.speakerBreak).toBe(true);
  });
});

describe('层 2 组段：软限制（只在句尾换，绝不句中切）', () => {
  it('段小于 60 字符：即使满足换段条件也继续并入', () => {
    const sents = [
      SENT({ text: 'A.'.padEnd(20, 'x'), complete: true }),
      SENT({ text: 'B.'.padEnd(20, 'x'), complete: true }),
      SENT({ text: 'C.'.padEnd(20, 'x'), complete: true }),
    ];
    // 每句 ~21 字符，三句共 65 —— 前两次检查段 <60 不换，第三次 3 句满换
    const p = sentencesToParagraphs(sents);
    expect(p).toHaveLength(1);
    expect(p[0]!.text).toContain('A.');
  });

  it('已有 2 个完整句且 ≥120 字符 → 换段', () => {
    const s1 = SENT({ text: 'a'.repeat(70), complete: true, start: 0, end: 3 });
    const s2 = SENT({ text: 'b'.repeat(70), complete: true, start: 3.2, end: 6 });
    const s3 = SENT({ text: 'c'.repeat(70), complete: true, start: 6.2, end: 9 });
    const p = sentencesToParagraphs([s1, s2, s3]);
    expect(p).toHaveLength(2);
    expect(p[0]!.text).toBe(`${s1.text} ${s2.text}`);
    expect(p[1]!.text).toBe(s3.text);
  });

  it('句后停顿 ≥2.8s → 换段', () => {
    const s1 = SENT({ text: 'a'.repeat(70), complete: true, start: 0, end: 3, nextGap: 3.5 });
    const s2 = SENT({ text: 'b'.repeat(70), complete: true, start: 6.5, end: 9 });
    const p = sentencesToParagraphs([s1, s2]);
    expect(p).toHaveLength(2);
  });

  it('软上限：段超 320 字符后在下一个完整句尾换（长句本身不硬切）', () => {
    const long = SENT({ text: 'x'.repeat(400), complete: true, start: 0, end: 25, nextGap: 0.2 }); // 单句 400 字符 25 秒：不切
    const next = SENT({ text: 'y'.repeat(50), complete: true, start: 25.5, end: 28 });
    const p = sentencesToParagraphs([long, next]);
    // 第一句后段已 >320 且是完整句尾 → 换；第二句自成段
    expect(p).toHaveLength(2);
    expect(p[0]!.text).toBe(long.text);
    expect(p[1]!.text).toBe(next.text);
  });

  it('>> 开头的句子强制换段', () => {
    const s1 = SENT({ text: 'a'.repeat(80), complete: true, start: 0, end: 3 });
    const s2 = SENT({ text: 'b'.repeat(30), complete: true, start: 3.2, end: 5, speakerBreak: true });
    const p = sentencesToParagraphs([s1, s2]);
    expect(p).toHaveLength(2);
  });

  it('AI 断点（breakpoints）指定处强制换段', () => {
    const sents = [
      SENT({ text: 'a'.repeat(80), start: 0, end: 3 }),
      SENT({ text: 'b'.repeat(80), start: 3.2, end: 6 }),
      SENT({ text: 'c'.repeat(80), start: 6.2, end: 9 }),
    ];
    const p = sentencesToParagraphs(sents, [1, 3]);   // 第 1、3 句后换
    expect(p.map((x) => x.text)).toEqual([sents[0]!.text, `${sents[1]!.text} ${sents[2]!.text}`]);
  });
});

describe('端到端 mergeCues', () => {
  it('巨段根因回归：json3 常见形态（每条恰一个句号切点）也预切开句——句子建立后组段生效', () => {
    const cues = [
      cue(0.0, 2.5, 'Google was a founding team that was'),
      cue(2.5, 2.4, 'deeply deeply technical. As the'),
      cue(4.9, 2.3, 'technology the underlying technology got'),
      cue(7.2, 2.6, 'more mature, the slider goes forward'),
      cue(9.8, 2.5, 'forward forward more towards the product'),
      cue(12.3, 2.4, 'thinker product experience. Pinterest'),
      cue(14.7, 2.6, 'where I was, Snap, Instagram, the CEOs'),
      cue(17.3, 2.5, "weren't technical at all. They were"),
      cue(19.8, 2.3, 'product geniuses. So what are the big'),
      cue(22.1, 2.6, 'consumer wins so far in AI? Of course'),
      cue(24.7, 2.4, "it's ChatGPT which is in a way not that"),
      cue(27.1, 1.9, 'dissimilar from Google in terms of what it was'),
    ];
    const p = mergeCues(cues);
    // 修前：1 个巨句 462 字符 1 段（用户实测 00:00 巨段）。修后：多段小段
    expect(p.length).toBeGreaterThanOrEqual(3);
    for (const seg of p) expect(seg.text.length).toBeLessThanOrEqual(260);
    // 文字无损
    const joined = p.map((x) => x.text).join(' ').replace(/\s+/g, ' ');
    expect(joined).toContain('Google was a founding team');
    expect(joined).toContain('what it was');
  });

  it('满 2 句即换段（用户定案：1~2 句一段）', () => {
    const s1 = SENT({ text: 'a'.repeat(70), complete: true, start: 0, end: 3 });
    const s2 = SENT({ text: 'b'.repeat(70), complete: true, start: 3.2, end: 6 });
    const s3 = SENT({ text: 'c'.repeat(70), complete: true, start: 6.2, end: 9 });
    const p = sentencesToParagraphs([s1, s2, s3]);
    expect(p.map((x) => x.text)).toEqual([`${s1.text} ${s2.text}`, s3.text]);
  });

  it('非语言标记行（[laughter] 等）并入前句不单独成段；首行标记并入后句', () => {
    const cues = [
      cue(0, 3, 'Yes, I heard your podcast.'),
      cue(3.2, 1, '[laughter]'),
      cue(4.5, 3, 'It was very impressive.'),
      cue(8, 3, 'I love it.'),
    ];
    const p = mergeCues(cues);
    // [laughter] 并入前句所在段，不单独成段
    expect(p.some((x) => x.text.trim() === '[laughter]' || x.text.trim() === 'laughter')).toBe(false);
    const withLaughter = p.find((x) => x.text.includes('[laughter]'));
    expect(withLaughter).toBeTruthy();
    expect(withLaughter!.text).toContain('podcast. [laughter]');

    // 首行标记：并到后一句
    const p2 = mergeCues([cue(0, 2, '[music]'), cue(2.1, 3, 'Welcome to the show.')]);
    expect(p2.some((x) => x.text.trim() === '[music]')).toBe(false);
    expect(p2.length).toBe(1);
    expect(p2[0]!.text).toContain('[music]');

    // 复合标记行（一行多个标记）同样并入前句，不单独成段
    const p3 = mergeCues([cue(0, 3, 'Welcome to the stage.'), cue(3.2, 1, '[cheering] [applause]'), cue(4.6, 3, 'Thank you all.')]);
    expect(p3.some((x) => x.text.trim() === '[cheering] [applause]')).toBe(false);
    expect(p3.find((x) => x.text.includes('[applause]'))!.text).toContain('stage. [cheering] [applause]');
  });

  it('Whisper 长条形态（单条 content 内挤多句）：条内预切后产出小段，时间分摊且文字无损', () => {
    // 根因复现（2026-08-28 用户实测）：Supadata 单条 content 是一大段话——
    // 不预切时整条成为"一个句子"，组段层"长句不硬切"→ 一大段一大段
    const long1 = 'So today we are going to talk about closures. A closure is a function that remembers its outer scope. They are super useful for callbacks.';
    const long2 = 'Now let me show you a quick example. Here we create a counter. It returns an incrementing function.';
    const p = mergeCues([
      cue(0, 15, long1),    // 单条 15 秒 3 句
      cue(16, 12, long2),   // 单条 12 秒 3 句
    ]);
    // 预切生效：不是两大段，而是 2~3 句的小段
    expect(p.length).toBeGreaterThanOrEqual(3);
    for (const seg of p) expect(seg.text.length).toBeLessThanOrEqual(340);
    // 文字无损（忽略空白差异）
    const joined = p.map((x) => x.text).join(' ').replace(/\s+/g, ' ');
    expect(joined).toBe(`${long1} ${long2}`);
    // 时间在原始范围内
    expect(p[0]!.start).toBe(0);
    expect(p.at(-1)!.start + p.at(-1)!.dur).toBeLessThanOrEqual(28.01);
  });

  it('Whisper 无标点场景（停顿断句移除后）：无句尾则整段拼合，文字无损（层 2 无句尾可换）', () => {
    // 8 个无标点碎行，行间 gap 2s——停顿断句已移除，层 1 无信号可切 → 整拼一段
    const lines = [
      'um so today we are going to talk about closures in javascript',
      'They capture variables from outer scope',
      'And that means the function remembers',
      'This is really useful for callbacks',
      'Now let me show you a quick example',
      'Here we create a counter function',
      'It returns another function that increments',
      'So the inner function keeps access to count',
    ];
    const cues = lines.map((t, i) => cue(i * 5, 3, t));   // 3s 内容 + 2s gap
    const p = mergeCues(cues);
    expect(p).toHaveLength(1);   // 新规则如实行为：无标点无句尾 → 一段（用户 2026-09-02 定案移除停顿断句的已知代价）
    // 文字无损：总词数不变
    expect(p[0]!.text.split(' ').length).toBe(lines.reduce((n, t) => n + t.split(' ').length, 0));
  });

  it('空输入与单行', () => {
    expect(mergeCues([])).toEqual([]);
    expect(mergeCues([cue(0, 2, 'only one line')])).toEqual([{ start: 0, dur: 2, text: 'only one line' }]);
  });
});
