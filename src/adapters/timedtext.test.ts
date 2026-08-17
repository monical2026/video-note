import { describe, expect, it } from 'vitest';
import { parseJson3, parseTimedtextXml } from './timedtext';

it('解析 json3：合并 segs、过滤空段、ms→s', () => {
  const cues = parseJson3({ events: [
    { tStartMs: 1000, dDurationMs: 2000, segs: [{ utf8: 'hello ' }, { utf8: 'world' }] },
    { tStartMs: 3500, dDurationMs: 1500, segs: [{ utf8: '\n' }] }, // 纯换行段丢弃
    { tStartMs: 3500, dDurationMs: 1500, segs: [{ utf8: 'next' }] },
  ] });
  expect(cues).toEqual([
    { start: 1, dur: 2, text: 'hello world' },
    { start: 3.5, dur: 1.5, text: 'next' },
  ]);
});

it('解析 XML：解转义、start/dur 字符串转数字', () => {
  const xml = `<transcript><text start="12.28" dur="2.4">a &amp; b &lt;tag&gt;</text></transcript>`;
  expect(parseTimedtextXml(xml)).toEqual([{ start: 12.28, dur: 2.4, text: 'a & b <tag>' }]);
});
