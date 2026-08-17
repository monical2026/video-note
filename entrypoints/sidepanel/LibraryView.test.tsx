// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { render, fireEvent } from '@testing-library/preact';
import { LibraryView } from './LibraryView';

vi.mock('./state', () => ({ sendMsg: vi.fn(async () => ({ rows: [
  { video: { videoId: 'a', title: 'Closures', channel: 'C', url: 'u', captionLang: 'en', fetchedAt: 1 }, noteCount: 5, lastAt: 99 },
  { video: { videoId: 'b', title: 'React Intro', channel: 'C', url: 'u', captionLang: 'en', fetchedAt: 1 }, noteCount: 2, lastAt: 5 },
] })) }));

it('列表渲染并可搜索过滤', async () => {
  const { findByText, queryByText, getByPlaceholderText } = render(<LibraryView currentVideoId="a" />);
  expect(await findByText(/Closures/)).toBeTruthy();
  fireEvent.input(getByPlaceholderText('搜索视频标题…'), { target: { value: 'react' } });
  expect(queryByText(/Closures/)).toBeNull();
  expect(await findByText(/React Intro/)).toBeTruthy();
});
