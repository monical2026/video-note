// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { noteMarkdown } from './NotesView';
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

describe('excerptZh', () => {
  const noteZh: Note = { id: '3', videoId: 'v', start: 95, end: 100, excerpt: 'closures capture', excerptZh: '闭包捕获', annotation: '记住环境', type: 'value', createdAt: 1 };

  it('卡片渲染中文对照行', () => {
    vi.stubGlobal('browser', { runtime: { sendMessage: vi.fn(async () => ({})) } });
    const { getByText } = render(<NotesView notes={[noteZh]} videoId="v" currentVideoId="v" />);
    expect(getByText('闭包捕获')).toBeTruthy();
  });

  it('noteMarkdown 在摘录行后输出中文行，无 excerptZh 跳过', () => {
    expect(noteMarkdown(noteZh)).toContain('「closures capture」\n闭包捕获');
    expect(noteMarkdown({ ...noteZh, excerptZh: undefined })).not.toContain('闭包捕获');
  });
});

describe('两段式删除', () => {
  const note: Note = { id: 'd1', videoId: 'v', start: 10, end: 15, excerpt: '', annotation: '待删', type: 'value', createdAt: 1 };

  it('点删除→确认删除→发出 DELETE_NOTE 并刷新', async () => {
    vi.useFakeTimers();
    loadVideoData.mockClear();
    const sendMsg = vi.fn(async () => ({ ok: true }));
    vi.stubGlobal('browser', { runtime: { sendMessage: sendMsg } });
    try {
      const { getByText } = render(<NotesView notes={[note]} videoId="v" currentVideoId="v" />);
      fireEvent.click(getByText('删除'));
      expect(getByText('确认删除？')).toBeTruthy();
      expect(sendMsg).not.toHaveBeenCalled();
      fireEvent.click(getByText('确认删除？'));
      await vi.runAllTimersAsync();
      expect(sendMsg).toHaveBeenCalledWith({ type: 'DELETE_NOTE', id: 'd1' });
      expect(loadVideoData).toHaveBeenCalledWith('v');
    } finally {
      vi.useRealTimers();
    }
  });

  it('3 秒内不再点则自动恢复', async () => {
    vi.useFakeTimers();
    loadVideoData.mockClear();
    const sendMsg = vi.fn(async () => ({ ok: true }));
    vi.stubGlobal('browser', { runtime: { sendMessage: sendMsg } });
    try {
      const { getByText, queryByText } = render(<NotesView notes={[note]} videoId="v" currentVideoId="v" />);
      fireEvent.click(getByText('删除'));
      expect(getByText('确认删除？')).toBeTruthy();
      await vi.advanceTimersByTimeAsync(3000);
      expect(queryByText('确认删除？')).toBeNull();
      expect(getByText('删除')).toBeTruthy();
      expect(sendMsg).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it('onNotesChanged 存在时走回调而非 loadVideoData', async () => {
    vi.useFakeTimers();
    loadVideoData.mockClear();
    const sendMsg = vi.fn(async () => ({ ok: true }));
    const onNotesChanged = vi.fn();
    vi.stubGlobal('browser', { runtime: { sendMessage: sendMsg } });
    try {
      const { getByText } = render(<NotesView notes={[note]} videoId="v" currentVideoId="v" onNotesChanged={onNotesChanged} />);
      fireEvent.click(getByText('删除'));
      fireEvent.click(getByText('确认删除？'));
      await vi.runAllTimersAsync();
      expect(onNotesChanged).toHaveBeenCalled();
      expect(loadVideoData).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });
});
