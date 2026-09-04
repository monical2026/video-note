import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import type { Cue, DisplayMode } from '../../src/types';
import { formatTime } from '../../src/utils/time';

export function TranscriptView(props: {
  cues: Cue[]; videoId: string; currentTime: number; mode: DisplayMode;
  onSeek: (t: number) => void; onSelect: (cues: Cue[]) => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  // 用户滚动浏览时暂停自动跟随（2026-09 用户需求：滚动不应被播放心跳抢占；暂停视频才能看的问题根除）
  const [userScroll, setUserScroll] = useState(false);
  const [q, setQ] = useState('');
  const [matchIdx, setMatchIdx] = useState(0);
  const [hovering, setHovering] = useState(false);   // 鼠标悬停在逐字稿区域（按钮显隐条件之一）
  const [away, setAway] = useState(false);           // 当前播放句不在可视范围（按钮显隐条件之二）
  const lastFollowClick = useRef(0);                 // 点「跟随」按钮时刻：其后 0.8s 忽略 wheel（触摸板惯性不得打断刚恢复的跟随）

  const activeEl = () => containerRef.current?.querySelector('.cue.active') as HTMLElement | null | undefined;
  /**
   * 当前句是否在可视范围——参照物必须是【滚动容器的可视矩形】（最近的 main 祖先），
   * 绝不能用逐字稿内容区自身（它包住全部内容，任何句子都"在其中"，判定恒真——
   * 0.5.0 的根因：恒真导致滚动暂停瞬间被重置，播放/暂停都滚不动）。
   */
  const activeVisible = () => {
    const el = activeEl();
    if (!el || typeof el.getBoundingClientRect !== 'function') return true;   // 无 rect 环境：保守视为可见
    const scroller = containerRef.current?.closest?.('main') as HTMLElement | null;
    let top = 0, bottom = typeof window !== 'undefined' ? window.innerHeight : Infinity;
    if (scroller && typeof scroller.getBoundingClientRect === 'function') {
      const sr = scroller.getBoundingClientRect();
      top = sr.top; bottom = sr.bottom;
    }
    const er = el.getBoundingClientRect();
    return er.bottom > top && er.top < bottom;
  };
  const refreshAway = () => {
    const v = !activeVisible();
    setAway((prev) => (prev === v ? prev : v));   // 值不变跳过渲染（滚动事件高频）
  };

  // 播放心跳跟随（方案 A，用户 2026-09 定案）：恢复跟随的唯一途径是点「回到当前位置」按钮——
  // 不做"滑回视口自动恢复"（0.5.1 的自动恢复与"跟随保证当前句可见"互相成全成陷阱，滑不动）。
  // 跟随对齐 block:'center'——当前句显示在窗口中间（用户定案，不贴底）。
  useEffect(() => {
    const el = activeEl();
    if (!el || typeof el.scrollIntoView !== 'function') return;
    if (userScroll) { refreshAway(); return; }   // 暂停跟随：仅刷新按钮显隐，不滚不恢复
    el.scrollIntoView({ block: 'center' });      // 瞬时对齐（smooth 动画与触摸板惯性/0.1s 心跳打架，0.5.3 定案改 auto；小步推进视觉仍平滑）
    refreshAway();
  }, [props.currentTime, userScroll]);

  // scroll 监听必须绑【真正的滚动容器 main】（scroll 事件不冒泡，绑在 .transcript 上永远收不到——
  // 0.5.2 根因②：暂停中无心跳时按钮显隐冻结）。refreshAway 读实时 DOM，无过期闭包。
  useEffect(() => {
    const scroller = containerRef.current?.closest?.('main');
    if (!scroller) return;
    scroller.addEventListener('scroll', refreshAway);
    return () => scroller.removeEventListener('scroll', refreshAway);
  }, []);

  // 播放时间大幅跳变（>30s：刷新视频/换片）→ 自动回到跟随模式（用户需求：刷新后逐字稿跟随当前播放位置）
  const prevTime = useRef(props.currentTime);
  useEffect(() => {
    if (Math.abs(props.currentTime - prevTime.current) > 30) setUserScroll(false);
    prevTime.current = props.currentTime;
  }, [props.currentTime]);

  // 全文搜索：中英都搜、不区分大小写（2026-09 用户需求；跳转只定位逐字稿不动视频）
  const ql = q.trim().toLowerCase();
  const matches = useMemo(() => (!ql ? [] : props.cues.map((_, i) => i).filter((i) => {
    const c = props.cues[i]!;
    return c.text.toLowerCase().includes(ql) || c.zh?.toLowerCase().includes(ql);
  })), [ql, props.cues]);

  const jumpToMatch = (idx: number) => {
    if (!matches.length) return;
    const wrapped = (idx + matches.length) % matches.length;
    setMatchIdx(wrapped);
    setUserScroll(true);   // 浏览搜索结果期间暂停自动跟随（可点「当前位置」恢复）
    const el = containerRef.current?.querySelector(`[data-index="${matches[wrapped]}"]`) as HTMLElement | null | undefined;
    el?.scrollIntoView?.({ block: 'center' });
  };

  /** 用户滚动意图（滚轮/触摸）：点「跟随」按钮后 0.8s 内忽略——触摸板惯性事件不得把刚恢复的跟随打回暂停 */
  const onUserScrollIntent = () => {
    if (Date.now() - lastFollowClick.current < 800) return;
    setUserScroll(true);
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
  const isCurrent = (c: Cue, i: number) => {
    const next = props.cues[i + 1];
    return props.currentTime >= c.start && (!next || props.currentTime < next.start);
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
          onMouseEnter={() => setHovering(true)} onMouseLeave={() => setHovering(false)}
          onMouseDown={() => { try { window.getSelection()?.removeAllRanges(); } catch { /* 兼容 */ } }}
          onWheel={onUserScrollIntent} onTouchMove={onUserScrollIntent}>
          {props.cues.map((c, i) => (
            <div key={i} data-testid={`cue-${i}`} data-index={i}
              class={`cue ${isCurrent(c, i) ? 'active' : ''} ${ql && matches.includes(i) ? 'hit' : ''}`}
              onClick={() => { if (window.getSelection()?.toString()) return; props.onSeek(c.start); }}>
              <button data-testid={`ts-${i}`} class="ts" onClick={(e) => { e.stopPropagation(); props.onSeek(c.start); }}>{formatTime(c.start)}</button>
              {props.mode !== 'zh' && <div class="en">{hl(c.text)}</div>}
              {props.mode !== 'en' && <div class="zh">{hl(c.zh ?? '（未翻译）')}</div>}
            </div>
          ))}
        </div>
        {hovering && away && (
          <button class="jump-current" data-testid="jump-current" title="跟随视频当前播放位置"
            onClick={() => {
              lastFollowClick.current = Date.now();            // 冷却起点：其后 0.8s 忽略惯性 wheel
              setUserScroll(false);
              activeEl()?.scrollIntoView?.({ block: 'center' }); // 瞬时跳回（无动画即无打断）
              setAway(false);
            }}>
            跟随 ↓
          </button>
        )}
      </div>
    </div>
  );
}
