// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { render, fireEvent } from '@testing-library/preact';
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
