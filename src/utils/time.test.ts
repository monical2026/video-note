import { describe, expect, it } from 'vitest';
import { formatTime, tsLink } from './time';

describe('formatTime', () => {
  it('秒数转 mm:ss', () => expect(formatTime(95.2)).toBe('01:35'));
  it('零', () => expect(formatTime(0)).toBe('00:00'));
  it('超一小时转 h:mm:ss', () => expect(formatTime(3725)).toBe('1:02:05'));
});

describe('tsLink', () => {
  it('生成带时间参数的跳转链接', () =>
    expect(tsLink('abc123', 95)).toBe('https://www.youtube.com/watch?v=abc123&t=95s'));
});
