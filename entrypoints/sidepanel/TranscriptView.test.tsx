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

/** jsdom 的 scrollTop 恒 0（无布局）——对 main 实例 defineProperty 捕获 scrollTop 写入（0.5.4 直设 scrollTop 的断言依据） */
const scrollTopSpy = () => {
  const mainEl = document.querySelector('main') as HTMLElement;
  const writes: number[] = [];
  let val = 0;
  Object.defineProperty(mainEl, 'scrollTop', {
    get: () => val,
    set: (v: number) => { val = v; writes.push(v); },
    configurable: true,
  });
  return writes;
};

describe('滚动跟随（2026-09 用户需求；0.5.1 视口判定修复后的规则）', () => {
  /** mock 视口：main 可视区 0~600px；当前句按 placeAt（true=滚出视口 800px 处）放置 */
  const mockViewport = (placeAt: () => boolean) => {
    const orig = Element.prototype.getBoundingClientRect;
    (Element.prototype as any).getBoundingClientRect = function (this: HTMLElement) {
      if (this.tagName === 'MAIN') return { top: 0, bottom: 600, left: 0, right: 400, height: 600, width: 400 };
      if (this.classList?.contains?.('cue') && this.classList.contains('active')) {
        return placeAt() ? { top: 800, bottom: 850, left: 0, right: 400, height: 50, width: 400 }
                        : { top: 100, bottom: 150, left: 0, right: 400, height: 50, width: 400 };
      }
      return { top: 0, bottom: 0, left: 0, right: 0, height: 0, width: 0 };
    };
    return () => { (Element.prototype as any).getBoundingClientRect = orig; };
  };
  const scrollSpy = () => {
    const calls: any[] = [];
    Element.prototype.scrollIntoView = function (opt?: any) { calls.push(opt); };
    return calls;
  };


  it('滚出视口后心跳不拉回（0.5.0 恒真根因回归）；hover 逐字稿区域且不在当前位置时按钮出现', async () => {
    const restore = mockViewport(() => true);   // 当前句在视口外
    const view = (t: number) => <main><TranscriptView cues={cues} videoId="v" currentTime={t} mode="en" onSeek={() => {}} onSelect={() => {}} /></main>;
    const { rerender, getByTestId, queryByTestId, findByTestId } = render(view(1));
    const writes = scrollTopSpy();                // render 后建立（mount 期首写不计入断言）
    fireEvent.scroll(document.querySelector('main')!); fireEvent.scroll(document.querySelector('main')!);   // 用户滚动（首帧可能被程序 pending 豁免，第二帧判定用户）       // 用户滚动 → 暂停跟随
    writes.length = 0;
    rerender(view(1.5));                          // 播放心跳
    expect(writes.length).toBe(0);                // 不再被拉回（0.5.0 根因：视口判定恒真致瞬间恢复）
    expect(queryByTestId('jump-current')).toBeNull();     // 未 hover：不显示
    // mouseenter 不冒泡：派发到 .transcript 容器本身（真实浏览器中鼠标进入必先穿过容器边界）
    fireEvent.mouseEnter(document.querySelector('.transcript')!);
    await findByTestId('jump-current');           // hover + 不在当前位置 → 显示
    restore();
  });

  it('按「跟随 ↓」：跳回当前句、恢复跟随、按钮隐藏（mousedown 触发 + scrollTop 直设）', async () => {
    let farAway = true;                           // 滚出视口 → 按钮出现；按下后置于视口内
    const restore = mockViewport(() => farAway);
    const view = (t: number) => <main><TranscriptView cues={cues} videoId="v" currentTime={t} mode="en" onSeek={() => {}} onSelect={() => {}} /></main>;
    const { rerender, getByTestId, findByTestId, queryByTestId } = render(view(1));
    const writes = scrollTopSpy();
    fireEvent.scroll(document.querySelector('main')!); fireEvent.scroll(document.querySelector('main')!);   // 用户滚动（首帧可能被程序 pending 豁免，第二帧判定用户）
    fireEvent.mouseEnter(document.querySelector('.transcript')!);
    await findByTestId('jump-current');
    writes.length = 0;
    farAway = false;                               // 按下后当前句在视口内
    fireEvent.mouseDown(getByTestId('jump-current'));   // mousedown 即执行：scrollTop 直设跳回 + 恢复跟随 + away=false
    expect(queryByTestId('jump-current')).toBeNull();   // 回到当前位置：按钮隐藏
    expect(writes.length).toBeGreaterThanOrEqual(1);    // 立即发生了滚动写入
    writes.length = 0;
    rerender(view(1.9));                           // 心跳：跟随已恢复
    expect(writes.length).toBeGreaterThanOrEqual(1);
    restore();
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
    const writes = scrollTopSpy();          // 搜索跳转同走 scrollTop 直设（需 main 滚动容器）
    fireEvent.input(getByTestId('search-input'), { target: { value: 'closures' } });
    expect(getByTestId('match-count').textContent).toBe('1/2');
    fireEvent.keyDown(getByTestId('search-input'), { key: 'Enter' });
    expect(getByTestId('match-count').textContent).toBe('2/2');
    fireEvent.keyDown(getByTestId('search-input'), { key: 'Enter' });
    expect(getByTestId('match-count').textContent).toBe('1/2');      // 循环
    expect(writes.length).toBeGreaterThanOrEqual(1);   // 跳转滚动了逐字稿
    expect(onSeek).not.toHaveBeenCalled();             // 不动视频
  });
});

describe('方案 A 与跳变重置（0.5.2 用户定案）', () => {
  const mockViewport = (placeAt: () => boolean) => {
    const orig = Element.prototype.getBoundingClientRect;
    (Element.prototype as any).getBoundingClientRect = function (this: HTMLElement) {
      if (this.tagName === 'MAIN') return { top: 0, bottom: 600, left: 0, right: 400, height: 600, width: 400 };
      if (this.classList?.contains?.('cue') && this.classList.contains('active')) {
        return placeAt() ? { top: 800, bottom: 850, left: 0, right: 400, height: 50, width: 400 }
                        : { top: 100, bottom: 150, left: 0, right: 400, height: 50, width: 400 };
      }
      return { top: 0, bottom: 0, left: 0, right: 0, height: 0, width: 0 };
    };
    return () => { (Element.prototype as any).getBoundingClientRect = orig; };
  };

  it('方案 A：滑回视口内也不自动恢复跟随（0.5.1 自动恢复陷阱回归——恢复只靠按钮）', async () => {
    let farAway = true;
    const restore = mockViewport(() => farAway);
    const view = (t: number) => <main><TranscriptView cues={cues} videoId="v" currentTime={t} mode="en" onSeek={() => {}} onSelect={() => {}} /></main>;
    const { rerender, getByTestId } = render(view(1));
    const writes = scrollTopSpy();
    fireEvent.scroll(document.querySelector('main')!); fireEvent.scroll(document.querySelector('main')!);   // 用户滚动（首帧可能被程序 pending 豁免，第二帧判定用户）       // 滑走：暂停跟随
    writes.length = 0;
    farAway = false;                              // 用户自己滑回当前句附近（当前句进视口）
    rerender(view(1.5));                          // 心跳
    expect(writes.length).toBe(0);                // 不自动恢复——不滚动（0.5.1 陷阱回归：此前 activeVisible=true 会恢复+拉回）
    restore();
  });

  it('播放时间大幅跳变（刷新/换片）自动回到跟随模式', () => {
    const restore = mockViewport(() => false);
    const view = (t: number) => <main><TranscriptView cues={cues} videoId="v" currentTime={t} mode="en" onSeek={() => {}} onSelect={() => {}} /></main>;
    const { rerender, getByTestId } = render(view(100));
    const writes = scrollTopSpy();
    fireEvent.scroll(document.querySelector('main')!); fireEvent.scroll(document.querySelector('main')!);   // 用户滚动（首帧可能被程序 pending 豁免，第二帧判定用户）       // 暂停跟随
    writes.length = 0;
    rerender(view(100.5));                        // 正常心跳推进：跟随保持暂停
    expect(writes.length).toBe(0);
    rerender(view(2));                            // 刷新/换片：时间从 100 跳回 2（>30s 跳变）
    expect(writes.length).toBeGreaterThanOrEqual(1);   // 自动恢复跟随
    restore();
  });
});

describe('0.5.3 两根因回归（惯性冷却期 + scroll 绑 main）', () => {
  const mockViewport = (placeAt: () => boolean) => {
    const orig = Element.prototype.getBoundingClientRect;
    (Element.prototype as any).getBoundingClientRect = function (this: HTMLElement) {
      if (this.tagName === 'MAIN') return { top: 0, bottom: 600, left: 0, right: 400, height: 600, width: 400 };
      if (this.classList?.contains?.('cue') && this.classList.contains('active')) {
        return placeAt() ? { top: 800, bottom: 850, left: 0, right: 400, height: 50, width: 400 }
                        : { top: 100, bottom: 150, left: 0, right: 400, height: 50, width: 400 };
      }
      return { top: 0, bottom: 0, left: 0, right: 0, height: 0, width: 0 };
    };
    return () => { (Element.prototype as any).getBoundingClientRect = orig; };
  };

  it('惯性窗口：按「跟随」后 1.2s 内的 scroll（触摸板惯性残余）不再把跟随打回暂停', async () => {
    let farAway = true;
    const restore = mockViewport(() => farAway);
    const view = (t: number) => <main><TranscriptView cues={cues} videoId="v" currentTime={t} mode="en" onSeek={() => {}} onSelect={() => {}} /></main>;
    const { rerender, getByTestId, findByTestId } = render(view(1));
    const writes = scrollTopSpy();
    fireEvent.scroll(document.querySelector('main')!); fireEvent.scroll(document.querySelector('main')!);   // 用户滚动（首帧可能被程序 pending 豁免，第二帧判定用户）            // 滑走：暂停跟随
    fireEvent.mouseEnter(document.querySelector('.transcript')!);
    const btn = await findByTestId('jump-current');
    farAway = false;
    fireEvent.mouseDown(btn);                          // 按「跟随」恢复
    writes.length = 0;
    fireEvent.scroll(document.querySelector('main')!); fireEvent.scroll(document.querySelector('main')!);   // 用户滚动（首帧可能被程序 pending 豁免，第二帧判定用户）            // 紧随其后的惯性 wheel（冷却期内）
    rerender(view(1.5));                               // 心跳
    expect(writes.length).toBeGreaterThanOrEqual(1);  // 跟随仍在工作（惯性没打断它）
    restore();
  });

  it('暂停中滑动：main 滚动事件实时更新按钮显隐（0.5.2 根因②回归——此前 onScroll 绑错容器冻结状态）', async () => {
    let farAway = false;   // 初始当前句在视口内（按钮不显示）
    const restore = mockViewport(() => farAway);
    Element.prototype.scrollIntoView = function () {};
    const view = () => <main><TranscriptView cues={cues} videoId="v" currentTime={1} mode="en" onSeek={() => {}} onSelect={() => {}} /></main>;
    const { getByTestId, queryByTestId, findByTestId } = render(view());
    fireEvent.mouseEnter(document.querySelector('.transcript')!);   // hover
    // 暂停中（currentTime 恒定无心跳）：当前句在视口 → 按钮不显示
    expect(queryByTestId('jump-current')).toBeNull();
    // 用户滑远：wheel 暂停跟随（此刻 farAway 未变，away 仍 false——冻结状态）→ main 滚动 → 按钮出现
    fireEvent.scroll(document.querySelector('main')!); fireEvent.scroll(document.querySelector('main')!);   // 用户滚动（首帧可能被程序 pending 豁免，第二帧判定用户）
    farAway = true;
    fireEvent.scroll(document.querySelector('main')!);
    await findByTestId('jump-current');                 // 滚动事件驱动按钮出现（不再冻结）
    restore();
  });
});
