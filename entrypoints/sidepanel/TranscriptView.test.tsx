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

describe('滚动跟随（2026-09 用户需求：滚动不被心跳抢占）', () => {
  const withScrollSpy = () => {
    const calls: any[] = [];
    Element.prototype.scrollIntoView = function (opt?: any) { calls.push(opt); };
    return calls;
  };

  it('用户滚动后播放心跳不再抢滚动；点「当前位置」恢复跟随', async () => {
    const calls = withScrollSpy();
    const { rerender, getByTestId, findByTestId } = render(
      <TranscriptView cues={cues} videoId="v" currentTime={1} mode="en" onSeek={() => {}} onSelect={() => {}} />,
    );
    expect(calls.length).toBeGreaterThan(0);        // 跟随生效中
    calls.length = 0;
    fireEvent.wheel(getByTestId('cue-0'));          // 用户滚动 → 暂停跟随
    rerender(<TranscriptView cues={cues} videoId="v" currentTime={1.5} mode="en" onSeek={() => {}} onSelect={() => {}} />);
    await findByTestId('jump-current');             // 暂停中显示恢复按钮
    expect(calls.length).toBe(0);                   // 心跳不再触发滚动
    fireEvent.click(getByTestId('jump-current'));   // 点按钮：跳回当前句 + 恢复
    calls.length = 0;                               // 清按钮自身的跳转与 userScroll 变化引发的滚动
    rerender(<TranscriptView cues={cues} videoId="v" currentTime={1.9} mode="en" onSeek={() => {}} onSelect={() => {}} />);
    expect(calls.length).toBeGreaterThanOrEqual(1); // 恢复跟随：心跳重新驱动滚动
  });
});

describe('全文搜索（2026-09 用户需求：中英都搜+蓝底高亮+不动视频）', () => {
  it('输入即时搜索：计数、mark 高亮、命中行标记', async () => {
    const { getByTestId, findByTestId } = render(
      <TranscriptView cues={cues} videoId="v" currentTime={0} mode="bilingual" onSeek={() => {}} onSelect={() => {}} />,
    );
    fireEvent.input(getByTestId('search-input'), { target: { value: 'hello' } });
    const count = await findByTestId('match-count');
    expect(count.textContent).toBe('1/1');
    expect(document.querySelector('.transcript mark')!.textContent).toBe('hello');   // 蓝底高亮
    expect(getByTestId('cue-0').className).toContain('hit');
    fireEvent.input(getByTestId('search-input'), { target: { value: '世界' } });      // 中文命中
    expect(getByTestId('match-count').textContent).toBe('1/1');
    expect(getByTestId('cue-1').className).toContain('hit');
    fireEvent.input(getByTestId('search-input'), { target: { value: 'zzz' } });      // 无匹配
    expect(getByTestId('match-count').textContent).toBe('0/0');
    expect(getByTestId('match-next').disabled).toBe(true);
  });

  it('多匹配循环跳转（Enter），跳转不动视频', () => {
    const orig = Element.prototype.scrollIntoView;
    const spy = vi.fn();
    Element.prototype.scrollIntoView = function () { spy(); };
    const many = [
      { start: 0, dur: 1, text: ' closures capture closures', zh: '' },
      { start: 1, dur: 1, text: ' state', zh: '' },
      { start: 2, dur: 1, text: ' closures again', zh: '' },
    ];
    const onSeek = vi.fn();
    const { getByTestId } = render(<TranscriptView cues={many} videoId="v" currentTime={0} mode="en" onSeek={onSeek} onSelect={() => {}} />);
    fireEvent.input(getByTestId('search-input'), { target: { value: 'closures' } });
    expect(getByTestId('match-count').textContent).toBe('1/2');
    fireEvent.keyDown(getByTestId('search-input'), { key: 'Enter' });
    expect(getByTestId('match-count').textContent).toBe('2/2');
    fireEvent.keyDown(getByTestId('search-input'), { key: 'Enter' });
    expect(getByTestId('match-count').textContent).toBe('1/2');      // 循环
    expect(spy).toHaveBeenCalled();          // 跳转滚动了逐字稿
    expect(onSeek).not.toHaveBeenCalled();  // 不动视频
    Element.prototype.scrollIntoView = orig;
  });
});
