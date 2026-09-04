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

/** 0.6.0 跟随回归 scrollIntoView（smooth center）：spy 计数程序滚动调用 */
const intoViewSpy = () => {
  const calls: any[] = [];
  Element.prototype.scrollIntoView = function (opt?: any) { calls.push(opt); };
  return calls;
};

describe('滚动跟随（0.6.0 youtube-digest 模式：换句滚动+时间戳豁免）', () => {
  /** 用户滚动模拟：main 派发 scroll（默认时间窗口外——测试内程序滚动距今远） */
  const userScrolls = () => { fireEvent.scroll(document.querySelector('main')!); };

  it('用户滚动（scroll 事件、豁免窗口外）→ 暂停跟随；换句不再拉动', async () => {
    const calls = intoViewSpy();
    const view = (t: number) => <main><TranscriptView cues={cues} videoId="v" currentTime={t} mode="en" onSeek={() => {}} onSelect={() => {}} /></main>;
    const { rerender, getByTestId, queryByTestId, findByTestId } = render(view(1));
    calls.length = 0;
    userScrolls();                                   // 用户滚动（窗口外）→ userScroll=true
    rerender(view(3.5));                             // 换句（cue-0→cue-1）
    expect(calls.length).toBe(0);                    // 跟随暂停：换句不滚
    expect(queryByTestId('jump-current')).toBeNull(); // 未 hover：按钮不显示
    fireEvent.mouseEnter(document.querySelector('.transcript-wrap')!);
    await findByTestId('jump-current');               // 关跟随+hover → 显示
  });

  it('点「跟随 ↓」（click）：立即直接滚回当前句（不直接滚则按钮无反应——参考项目要点）+ 恢复跟随', async () => {
    const calls = intoViewSpy();
    const view = (t: number) => <main><TranscriptView cues={cues} videoId="v" currentTime={t} mode="en" onSeek={() => {}} onSelect={() => {}} /></main>;
    const { rerender, getByTestId, findByTestId, queryByTestId } = render(view(1));
    userScrolls();
    fireEvent.mouseEnter(document.querySelector('.transcript-wrap')!);
    await findByTestId('jump-current');
    calls.length = 0;
    fireEvent.click(getByTestId('jump-current'));     // click → 立即 scrollIntoView
    expect(calls.length).toBe(1);
    expect(queryByTestId('jump-current')).toBeNull(); // 恢复跟随：按钮隐藏
    calls.length = 0;
    rerender(view(3.5));                             // 之后换句：跟随恢复工作
    expect(calls.length).toBe(1);
  });

  it('程序滚动豁免：跟随换句滚动后 1s 内的 scroll 不误判用户（跟随不被自己打断）', () => {
    const many = [
      { start: 0, dur: 1, text: 'first sentence here' },
      { start: 2, dur: 1, text: 'second sentence here' },
      { start: 4, dur: 1, text: 'third sentence here' },
    ];
    const calls = intoViewSpy();
    const view = (t: number) => <main><TranscriptView cues={many} videoId="v" currentTime={t} mode="en" onSeek={() => {}} onSelect={() => {}} /></main>;
    const { rerender } = render(view(0));
    calls.length = 0;
    rerender(view(2.5));                             // 换句（0→1）→ 程序滚动（盖时间戳）
    expect(calls.length).toBe(1);
    fireEvent.scroll(document.querySelector('main')!);   // 紧随的 scroll（豁免窗口内）——程序 smooth 动画自身
    rerender(view(4.5));                             // 再换句（1→2）
    expect(calls.length).toBe(2);                    // 跟随未被误判暂停，仍在滚动
  });
});

describe('点击跳转（0.5.1 选区残留修复）', () => {
  it('残留选区不再拦截正常点击：按下即清，点击恢复跳转', () => {
    const onSeek = vi.fn();
    const { getByTestId } = render(<TranscriptView cues={cues} videoId="v" currentTime={0} mode="bilingual" onSeek={onSeek} onSelect={() => {}} />);
    // 模拟残留选区（划选测试后未清）
    vi.stubGlobal('getSelection', () => ({ toString: () => 'hello', removeAllRanges: () => { (globalThis as any).__cleared = true; } }));
    // mousedown 清掉残留（removeAllRanges 使后续判定为空）——真实浏览器中 click 守卫读到的已是空选区
    fireEvent.mouseDown(getByTestId('cue-1'));
    expect((globalThis as any).__cleared).toBe(true);
    vi.stubGlobal('getSelection', () => ({ toString: () => '' }));   // 清后：空选区
    fireEvent.click(getByTestId('cue-1'));
    expect(onSeek).toHaveBeenCalledWith(3);          // 跳转恢复
    vi.unstubAllGlobals();
    delete (globalThis as any).__cleared;
  });

  it('划选保护依然有效：拖动产生的新选区在 mouseUp 记笔记、click 不跳转', () => {
    const onSelect = vi.fn(); const onSeek = vi.fn();
    const { getByTestId } = render(<TranscriptView cues={cues} videoId="v" currentTime={0} mode="bilingual" onSeek={onSeek} onSelect={onSelect} />);
    const cue1 = getByTestId('cue-1');
    const textNode = cue1.querySelector('.en')!.firstChild!;
    vi.stubGlobal('getSelection', () => ({ isCollapsed: false, toString: () => 'world', anchorNode: textNode, focusNode: textNode }));
    fireEvent.mouseUp(cue1);       // 划选松手：记笔记
    expect(onSelect).toHaveBeenCalled();
    fireEvent.click(cue1);         // 划选后的点击：守卫仍拦（选区非空）
    expect(onSeek).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
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
    expect((getByTestId('match-next') as HTMLButtonElement).disabled).toBe(true);
  });

  it('多匹配循环跳转（Enter），跳转不动视频', () => {
    const many = [
      { start: 0, dur: 1, text: ' closures capture closures', zh: '' },
      { start: 1, dur: 1, text: ' state', zh: '' },
      { start: 2, dur: 1, text: ' closures again', zh: '' },
    ];
    const onSeek = vi.fn();
    const { getByTestId } = render(<main><TranscriptView cues={many} videoId="v" currentTime={0} mode="en" onSeek={onSeek} onSelect={() => {}} /></main>);
    const calls = intoViewSpy();             // 0.6.0 搜索跳转走 scrollIntoView（smooth center）
    fireEvent.input(getByTestId('search-input'), { target: { value: 'closures' } });
    expect(getByTestId('match-count').textContent).toBe('1/2');
    fireEvent.keyDown(getByTestId('search-input'), { key: 'Enter' });
    expect(getByTestId('match-count').textContent).toBe('2/2');
    fireEvent.keyDown(getByTestId('search-input'), { key: 'Enter' });
    expect(getByTestId('match-count').textContent).toBe('1/2');      // 循环
    expect(calls.length).toBeGreaterThanOrEqual(1);   // 跳转滚动了逐字稿
    expect(onSeek).not.toHaveBeenCalled();             // 不动视频
  });
});

describe('方案 A 与跳变重置（0.6.0 语义）', () => {
  const userScrolls = () => { fireEvent.scroll(document.querySelector('main')!); };

  it('方案 A：恢复跟随只靠点按钮（无自动恢复路径——换句只在跟随态滚）', async () => {
    const calls = intoViewSpy();
    const view = (t: number) => <main><TranscriptView cues={cues} videoId="v" currentTime={t} mode="en" onSeek={() => {}} onSelect={() => {}} /></main>;
    const { rerender } = render(view(1));
    calls.length = 0;
    userScrolls();                                   // 暂停跟随
    rerender(view(3.5)); rerender(view(5.9));        // 多次换句
    expect(calls.length).toBe(0);                    // 永不自动恢复（0.5.1 陷阱根除：无任何自动恢复分支）
  });

  it('播放时间大幅跳变（刷新/换片）自动回到跟随模式并立即滚回', () => {
    const calls = intoViewSpy();
    const view = (t: number) => <main><TranscriptView cues={cues} videoId="v" currentTime={t} mode="en" onSeek={() => {}} onSelect={() => {}} /></main>;
    const { rerender } = render(view(100));
    calls.length = 0;
    userScrolls();                                   // 暂停跟随
    rerender(view(100.5));                           // 正常推进
    expect(calls.length).toBe(0);
    rerender(view(2));                               // 跳变 >30s
    expect(calls.length).toBe(1);                    // 自动恢复跟随并立即滚回
  });
});

