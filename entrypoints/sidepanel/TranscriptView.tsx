import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import type { Cue, DisplayMode } from '../../src/types';
import { formatTime } from '../../src/utils/time';

/**
 * 0.6.0 跟随模块：照 youtube-digest 项目模式重写（用户批准，源码逐条对标）。
 * 核心原则——程序滚动必须稀疏（换句才滚，5~10s 一次），一切判定才可靠：
 *   · 跟随：当前句索引变化 → scrollIntoView({behavior:'smooth', block:'center'})（丝滑居中），滚前盖程序时间戳
 *   · 用户检测：main 的 scroll 事件距上次程序滚动 >1s → 判用户滚动（暂停跟随+显示按钮）
 *   · 点「跟随」：click 后立即直接滚回当前句（参考注释：不直接滚则按钮"看起来没反应"）
 *   · 按钮：关跟随中 && 鼠标悬停逐字稿 → 显示
 * 无 pending 标记/长窗口/重校循环/冷却期/rect 判定（历史方案全部废弃，见 spec §0.9.5~0.9.8）。
 */
const PROGRAM_SCROLL_GRACE_MS = 1000;   // 程序滚动后 1s 内到达的 scroll 视为程序自身（youtube-digest 同值）

export function TranscriptView(props: {
  cues: Cue[]; videoId: string; currentTime: number; mode: DisplayMode;
  onSeek: (t: number) => void; onSelect: (cues: Cue[]) => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [userScroll, setUserScroll] = useState(false);      // true=用户浏览中（跟随暂停）
  const [q, setQ] = useState('');
  const [matchIdx, setMatchIdx] = useState(0);
  const [hovering, setHovering] = useState(false);          // 鼠标悬停在逐字稿区域（按钮显隐）
  const lastProgramScroll = useRef(0);                      // 上次程序滚动时刻（时间戳豁免）

  const activeEl = () => containerRef.current?.querySelector('.cue.active') as HTMLElement | null | undefined;
  /** 当前句索引（换句才变——跟随的触发源） */
  const activeIndex = useMemo(() => {
    for (let i = props.cues.length - 1; i >= 0; i--) {
      if (props.currentTime >= props.cues[i]!.start) return i;
    }
    return -1;
  }, [props.cues, props.currentTime]);

  /** 程序滚动（唯一入口）：先盖时间戳再平滑居中——自身触发的 scroll 事件落在豁免窗口内 */
  const programScrollToCue = (el: HTMLElement | null | undefined) => {
    if (!el || typeof el.scrollIntoView !== 'function') return;
    lastProgramScroll.current = Date.now();
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
  };

  // 跟随：仅换句时滚（不每心跳滚——密集程序滚动是一切判定失效的根源，spec §0.9.9）
  const prevActive = useRef(activeIndex);
  useEffect(() => {
    const changed = activeIndex !== prevActive.current;
    prevActive.current = activeIndex;
    if (!changed) return;
    if (!userScroll) programScrollToCue(activeEl());
    // eslint-disable-next-line react-hooks/exhaustive-deps -- userScroll 刻意不入依赖：只在换句瞬间检查跟随态
  }, [activeIndex]);

  // 播放时间大幅跳变（>30s：刷新/换片）→ 自动回到跟随模式（用户需求：刷新后逐字稿跟随播放位置）
  const prevTime = useRef(props.currentTime);
  useEffect(() => {
    if (Math.abs(props.currentTime - prevTime.current) > 30) {
      setUserScroll(false);
      programScrollToCue(activeEl());   // 跳变即滚回（不等换句）
    }
    prevTime.current = props.currentTime;
  }, [props.currentTime]);

  // 用户滚动检测：main 的 scroll 事件 + 时间戳豁免（绑真正的滚动容器；scroll 不冒泡）
  useEffect(() => {
    const scroller = containerRef.current?.closest?.('main');
    if (!scroller) return;
    const onScroll = () => {
      if (Date.now() - lastProgramScroll.current < PROGRAM_SCROLL_GRACE_MS) return;   // 程序自身（含 smooth 动画期）
      setUserScroll(true);                                                             // 用户滚动（含惯性多帧）
    };
    scroller.addEventListener('scroll', onScroll);
    return () => scroller.removeEventListener('scroll', onScroll);
  }, []);

  // 全文搜索：中英都搜、不区分大小写（跳转只定位逐字稿不动视频）
  const ql = q.trim().toLowerCase();
  const matches = useMemo(() => (!ql ? [] : props.cues.map((_, i) => i).filter((i) => {
    const c = props.cues[i]!;
    return c.text.toLowerCase().includes(ql) || c.zh?.toLowerCase().includes(ql);
  })), [ql, props.cues]);

  const jumpToMatch = (idx: number) => {
    if (!matches.length) return;
    const wrapped = (idx + matches.length) % matches.length;
    setMatchIdx(wrapped);
    setUserScroll(true);   // 浏览搜索结果期间暂停跟随（点「跟随」恢复）
    programScrollToCue(containerRef.current?.querySelector(`[data-index="${matches[wrapped]}"]`) as HTMLElement | null);
  };

  /** 按搜索词拆分文本，命中段渲染为蓝底 <mark> */
  const hl = (text: string) => {
    if (!ql) return text;
    const lower = text.toLowerCase();
    const parts: any[] = [];
    let from = 0, at = lower.indexOf(ql);
    while (at !== -1) {
      if (at > from) parts.push(text.slice(from, at));
      parts.push(<mark>{text.slice(at, at + ql.length)}</mark>);
      from = at + ql.length; at = lower.indexOf(ql, from);
    }
    if (from < text.length) parts.push(text.slice(from));
    return parts.length ? parts : text;
  };

  const onMouseUp = () => {
    const sel = window.getSelection();
    const text = sel?.toString().trim();
    if (!sel || sel.isCollapsed || !text) return;
    // 按 Selection 的起止 DOM 节点定位 cue 行（可靠，支持跨行与反向选择）
    const idxOf = (node: Node | null): number | null => {
      const el = node?.nodeType === 3 ? node.parentElement : (node as HTMLElement | null);
      const cue = el?.closest?.('.cue') as HTMLElement | null;
      const i = cue?.getAttribute('data-index');
      return i == null ? null : Number(i);
    };
    let a = idxOf(sel.anchorNode), b = idxOf(sel.focusNode);
    if (a == null || b == null) return;           // 选区不在字幕行内
    const [from, to] = a <= b ? [a, b] : [b, a];
    const picked = props.cues.slice(from, to + 1);
    if (picked.length) props.onSelect(picked);
  };
  return (
    <div class="transcript-outer">
      <div class="search-bar" data-testid="search-bar">
        <input data-testid="search-input" type="text" placeholder="搜索中英文…" value={q}
          onInput={(e) => { setQ((e.target as HTMLInputElement).value); setMatchIdx(0); }}
          onKeyDown={(e) => { if (e.key === 'Enter') jumpToMatch(matchIdx + 1); }} />
        {ql && <span class="match-count" data-testid="match-count">{matches.length ? `${matchIdx + 1}/${matches.length}` : '0/0'}</span>}
        <button data-testid="match-prev" title="上一个匹配" disabled={!matches.length} onClick={() => jumpToMatch(matchIdx - 1)}>↑</button>
        <button data-testid="match-next" title="下一个匹配（回车同）" disabled={!matches.length} onClick={() => jumpToMatch(matchIdx + 1)}>↓</button>
      </div>
      <div class="transcript-wrap" onMouseEnter={() => setHovering(true)} onMouseLeave={() => setHovering(false)}>
        <div class="transcript" ref={containerRef} onMouseUp={onMouseUp}
          onMouseDown={() => { try { window.getSelection()?.removeAllRanges(); } catch { /* 兼容 */ } }}>
          {props.cues.map((c, i) => (
            <div key={i} data-testid={`cue-${i}`} data-index={i}
              class={`cue ${i === activeIndex ? 'active' : ''} ${ql && matches.includes(i) ? 'hit' : ''}`}
              onClick={() => { if (window.getSelection()?.toString()) return; props.onSeek(c.start); }}>
              <button data-testid={`ts-${i}`} class="ts" onClick={(e) => { e.stopPropagation(); props.onSeek(c.start); }}>{formatTime(c.start)}</button>
              {props.mode !== 'zh' && <div class="en">{hl(c.text)}</div>}
              {props.mode !== 'en' && <div class="zh">{hl(c.zh ?? '（未翻译）')}</div>}
            </div>
          ))}
        </div>
        {userScroll && hovering && (
          <button class="jump-current" data-testid="jump-current" title="跟随视频当前播放位置"
            onClick={() => {
              setUserScroll(false);
              // 立即直接滚回（youtube-digest 注释要点：跟随 tick 会跳过已高亮句，不直接滚则按钮"看起来没反应"）
              programScrollToCue(activeEl());
            }}>
            跟随 ↓
          </button>
        )}
      </div>
    </div>
  );
}
