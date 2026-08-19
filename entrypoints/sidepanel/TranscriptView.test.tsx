// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { render, fireEvent } from '@testing-library/preact';
import { TranscriptView } from './TranscriptView';

const cues = [
  { start: 1, dur: 2, text: 'hello', zh: '你好' },
  { start: 3, dur: 2, text: 'world', zh: '世界' },
];

it('中英对照渲染双行，点击时间戳触发 onSeek', () => {
  const onSeek = vi.fn();
  const { getByText, getByTestId } = render(
    <TranscriptView cues={cues} videoId="v" currentTime={1} mode="bilingual" onSeek={onSeek} onSelect={() => {}} />,
  );
  expect(getByText('hello')).toBeTruthy();
  expect(getByText('你好')).toBeTruthy();
  fireEvent.click(getByTestId('ts-0'));
  expect(onSeek).toHaveBeenCalledWith(1);
});

it('仅中文模式隐藏英文', () => {
  const { queryByText } = render(<TranscriptView cues={cues} videoId="v" currentTime={0} mode="zh" onSeek={() => {}} onSelect={() => {}} />);
  expect(queryByText('hello')).toBeNull();
  expect(queryByText('你好')).toBeTruthy();
});

it('当前播放句有高亮类名', () => {
  const { getByTestId } = render(<TranscriptView cues={cues} videoId="v" currentTime={4} mode="en" onSeek={() => {}} onSelect={() => {}} />);
  expect(getByTestId('cue-1').className).toContain('active');
});

it('点击整行触发 onSeek；有文字选区时点击不触发', () => {
  const onSeek = vi.fn();
  const { getByTestId, unmount } = render(
    <TranscriptView cues={cues} videoId="v" currentTime={0} mode="bilingual" onSeek={onSeek} onSelect={() => {}} />,
  );
  // 无选区：点击行触发跳转
  vi.stubGlobal('getSelection', () => ({ toString: () => '' }));
  fireEvent.click(getByTestId('cue-1'));
  expect(onSeek).toHaveBeenCalledWith(3);
  // 有选区（划选文字记笔记）：点击行不触发跳转
  vi.stubGlobal('getSelection', () => ({ toString: () => 'world' }));
  fireEvent.click(getByTestId('cue-1'));
  expect(onSeek).toHaveBeenCalledTimes(1);
  vi.unstubAllGlobals();
  unmount();
});

it('划选两行（含反向选择）按起止行定位，onSelect 收到对应 cues', () => {
  const onSelect = vi.fn();
  const { getByTestId, unmount } = render(
    <TranscriptView cues={cues} videoId="v" currentTime={0} mode="bilingual" onSeek={() => {}} onSelect={onSelect} />,
  );
  const cue0 = getByTestId('cue-0');
  const cue1 = getByTestId('cue-1');
  const text0 = cue0.querySelector('.en')!.firstChild!;
  const text1 = cue1.querySelector('.en')!.firstChild!;
  const stub = (anchorNode: Node, focusNode: Node) =>
    vi.stubGlobal('getSelection', () => ({ isCollapsed: false, toString: () => 'hello world', anchorNode, focusNode }));
  // 正向：行0 → 行1
  stub(text0, text1);
  fireEvent.mouseUp(cue1);
  expect(onSelect).toHaveBeenCalledWith(cues);
  // 反向：行1 → 行0，仍取 [0,1]
  onSelect.mockClear();
  stub(text1, text0);
  fireEvent.mouseUp(cue0);
  expect(onSelect).toHaveBeenCalledWith(cues);
  vi.unstubAllGlobals();
  unmount();
});

it('选区不在字幕行内时不触发 onSelect', () => {
  const onSelect = vi.fn();
  const { getByTestId, unmount } = render(
    <TranscriptView cues={cues} videoId="v" currentTime={0} mode="bilingual" onSeek={() => {}} onSelect={onSelect} />,
  );
  const outside = document.createElement('div');
  document.body.appendChild(outside);
  vi.stubGlobal('getSelection', () => ({ isCollapsed: false, toString: () => 'x', anchorNode: outside, focusNode: outside }));
  fireEvent.mouseUp(getByTestId('cue-0'));
  expect(onSelect).not.toHaveBeenCalled();
  vi.unstubAllGlobals();
  outside.remove();
  unmount();
});

it('折叠选区（仅点击无划选）不触发 onSelect', () => {
  const onSelect = vi.fn();
  const { getByTestId, unmount } = render(
    <TranscriptView cues={cues} videoId="v" currentTime={0} mode="bilingual" onSeek={() => {}} onSelect={onSelect} />,
  );
  vi.stubGlobal('getSelection', () => ({ isCollapsed: true, toString: () => '', anchorNode: null, focusNode: null }));
  fireEvent.mouseUp(getByTestId('cue-0'));
  expect(onSelect).not.toHaveBeenCalled();
  vi.unstubAllGlobals();
  unmount();
});
