// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { render, fireEvent } from '@testing-library/preact';

const loadVideoData = vi.hoisted(() => vi.fn(async () => {}));
vi.mock('./state', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./state')>();
  return { ...actual, loadVideoData };
});

import { NotesView } from './NotesView';
import type { Note } from '../../src/types';

const notes: Note[] = [
  { id: '1', videoId: 'v', start: 95, end: 100, excerpt: 'closures capture', annotation: '记住环境', type: 'value', createdAt: 1 },
];

it('渲染笔记并复制单条 markdown', async () => {
  const writeText = vi.fn();
  vi.stubGlobal('navigator', { clipboard: { writeText } });
  vi.stubGlobal('browser', { runtime: { sendMessage: vi.fn(async () => ({})) } });
  const { getByText, findByText } = render(<NotesView notes={notes} videoId="v" currentVideoId="v" />);
  expect(getByText('记住环境')).toBeTruthy();
  fireEvent.click(getByText('复制'));
  expect(await findByText('已复制')).toBeTruthy();
  expect(writeText).toHaveBeenCalled();
  expect(String(writeText.mock.calls[0]?.[0])).toContain('⭐ **我的笔记**');
});

describe('explain', () => {
  const confusion: Note = { id: '2', videoId: 'v', start: 10, end: 15, excerpt: '', annotation: '为啥', type: 'confusion', createdAt: 1 };

  it('成功后刷新列表并隐藏按钮，失败显示错误', async () => {
    const sendMsg = vi.fn(async (msg: any) => {
      if (msg.type === 'EXPLAIN') return { explanation: '闭包就是…' };
      return {};
    });
    vi.stubGlobal('browser', { runtime: { sendMessage: sendMsg } });
    const { getByText, findByText, queryByText } = render(<NotesView notes={[confusion]} videoId="v" currentVideoId="v" />);
    fireEvent.click(getByText('AI 解释'));
    await vi.waitFor(() => expect(loadVideoData).toHaveBeenCalledWith('v'));
    expect(confusion.aiExplanation).toBe('闭包就是…');
    expect(queryByText('AI 解释')).toBeNull();
  });

  it('失败时行内显示错误信息', async () => {
    loadVideoData.mockClear();
    const sendMsg = vi.fn(async (msg: any) => {
      if (msg.type === 'EXPLAIN') throw new Error('未配置 LLM');
      return {};
    });
    vi.stubGlobal('browser', { runtime: { sendMessage: sendMsg } });
    const { getByText, findByText, queryByText } = render(<NotesView notes={[{ ...confusion, aiExplanation: undefined }]} videoId="v" currentVideoId="v" />);
    fireEvent.click(getByText('AI 解释'));
    expect(await findByText('未配置 LLM')).toBeTruthy();
    expect(loadVideoData).not.toHaveBeenCalled();
    expect(queryByText('闭包')).toBeNull();
  });
});
