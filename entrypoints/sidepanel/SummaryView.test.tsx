// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { render, fireEvent, waitFor } from '@testing-library/preact';
import { quoteMarkdown, SummaryView } from './SummaryView';
import type { Summary } from '../../src/types';

const s: Summary = {
  videoId: 'v', oneLiner: '讲透闭包',
  sections: [{ start: 192, title: '定义', points: ['闭包=函数+词法环境'] }],
  knowledge: [{ term: 'closure', desc: '函数+词法环境' }], prerequisites: ['作用域'],
  model: 'm', generatedAt: 1,
};

it('渲染结构化摘要，时间戳可点跳转', () => {
  const sendMsg = vi.fn(async () => ({}));
  vi.stubGlobal('browser', { runtime: { sendMessage: sendMsg }, tabs: { create: vi.fn() } });
  const { getByText } = render(<SummaryView summary={s} llmConfigured onSeek={() => {}} />);
  expect(getByText('讲透闭包')).toBeTruthy();
  expect(getByText('定义')).toBeTruthy();
  expect(getByText('作用域')).toBeTruthy();
});

it('未配 LLM 时禁用生成按钮', () => {
  const { getByRole } = render(<SummaryView summary={null} llmConfigured={false} onSeek={() => {}} />);
  expect((getByRole('button') as HTMLButtonElement).disabled).toBe(true);
});

describe('金句复制（2026-09-07 用户需求）', () => {
  it('quoteMarkdown：时间戳跳转链接 + 原话（与笔记复制一致的 Markdown）', () => {
    const md = quoteMarkdown('vid1', { quote: 'A closure is a backpack.', start: 200 });
    expect(md).toContain('[03:20](https://www.youtube.com/watch?v=vid1&t=200s)');
    expect(md).toContain('「A closure is a backpack.」');
  });
  it('金句列表渲染复制按钮，点击写入剪贴板并反馈', async () => {
    const writeText = vi.fn(async () => {});
    vi.stubGlobal('navigator', { clipboard: { writeText } });
    const summary = { videoId: 'v', oneLiner: 'o', sections: [], keyQuotes: [{ quote: 'Q1', start: 10 }], knowledge: [], prerequisites: [], model: 'm', generatedAt: 1 } as any;
    const { getByTestId } = render(<SummaryView summary={summary} llmConfigured videoId="v" onSeek={() => {}} />);
    fireEvent.click(getByTestId('quote-copy-0'));
    expect(writeText).toHaveBeenCalledWith(expect.stringContaining('「Q1」'));
    await waitFor(() => expect(getByTestId('quote-copy-0').textContent).toContain('已复制'));
    vi.unstubAllGlobals();
  });
});
