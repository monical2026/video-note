import { describe, expect, it } from 'vitest';
import { mergeCues } from './segment';

describe('mergeCues 程序化拼段', () => {
  it('文字一字不改只拼接：无停顿无标点的连续碎行合成一段', () => {
    const cues = [
      { start: 0, dur: 3, text: 'Google was a founding team that was' },
      { start: 3, dur: 2, text: 'deeply deeply technical. As the' },
      { start: 5, dur: 2, text: 'technology got more mature' },
    ];
    const out = mergeCues(cues);
    expect(out).toHaveLength(1);
    expect(out[0]!.text).toBe('Google was a founding team that was deeply deeply technical. As the technology got more mature');
    expect(out[0]!.start).toBe(0);
    expect(out[0]!.dur).toBe(7);
  });

  it('时间空隙断段：停顿 ≥1.2s 且当前段已有句尾标点时分段', () => {
    const cues = [
      { start: 0, dur: 2, text: 'first sentence.' },
      { start: 2.1, dur: 2, text: 'second sentence.' },   // gap 0.1s：连
      { start: 6, dur: 2, text: 'after a pause.' },        // gap 1.9s：断
    ];
    const out = mergeCues(cues);
    expect(out).toHaveLength(2);
    expect(out[0]!.text).toBe('first sentence. second sentence.');
    expect(out[1]!.text).toBe('after a pause.');
    expect(out[1]!.start).toBe(6);
  });

  it('>> 说话人切换强制新段，且剔除 >> 标记本身', () => {
    const cues = [
      { start: 0, dur: 2, text: 'host asks a question?' },
      { start: 2, dur: 2, text: '>> guest answers here' },
      { start: 4, dur: 2, text: '>> another speaker talks' },
    ];
    const out = mergeCues(cues);
    expect(out.map((c) => c.text)).toEqual(['host asks a question?', 'guest answers here', 'another speaker talks']);
    expect(out.map((c) => c.start)).toEqual([0, 2, 4]);
  });

  it('句数目标：攒满 2 个句尾标点即分段（无空隙也断）', () => {
    const cues = [
      { start: 0, dur: 1, text: 'sentence one.' },
      { start: 1, dur: 1, text: 'sentence two.' },        // 已 2 句：断
      { start: 2, dur: 1, text: 'sentence three.' },
    ];
    const out = mergeCues(cues);
    expect(out.map((c) => c.text)).toEqual(['sentence one. sentence two.', 'sentence three.']);
  });

  it('无标点 asr：靠超长保护断段（1200 字符上限）', () => {
    const long = 'word '.repeat(60).trim();               // 300 字符/行
    const cues = Array.from({ length: 8 }, (_, i) => ({ start: i * 2, dur: 2, text: long })); // 2400 字符连续无标点
    const out = mergeCues(cues);
    expect(out.length).toBeGreaterThanOrEqual(2);
    // 保护线生效：段长 ≤ 上限 + 单行长度（断段粒度是整行，1200 + 300）
    for (const seg of out) expect(seg.text.length).toBeLessThanOrEqual(1200 + long.length);
    // 文字无损：总词数不变
    expect(out.reduce((s, c) => s + c.text.split(' ').length, 0)).toBe(cues.reduce((s, c) => s + c.text.split(' ').length, 0));
  });

  it('空行与纯文本不变：zh 字段不带入、末尾自然收段', () => {
    const cues = [
      { start: 0, dur: 1, text: 'only one line' },
    ];
    expect(mergeCues(cues)).toEqual([{ start: 0, dur: 1, text: 'only one line' }]);
    expect(mergeCues([])).toEqual([]);
  });
});
