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
  // 0.5.5 业界模式（用户批准）：用户滚动意图由 scroll 事件判定（wheel 只是输入信号会误判惯性）。
  // programmaticPending：一次性豁免——每次程序滚动自身触发的第一个 scroll 不算用户；
  // programmaticUntil：点「跟随」后的 1.2s 长窗口——触摸板惯性残余的 scroll 在窗口内被吸收（不打回暂停）。
  const programmaticPending = useRef(false);
  const programmaticUntil = useRef(0);
  const recalibrateTimer = useRef<ReturnType<typeof setInterval> | null>(null);

  const activeEl = () => containerRef.current?.querySelector('.cue.active') as HTMLElement | null | undefined;
  /**
   * 滚动当前句到可视区（0.5.4 定案：绕开 scrollIntoView——真实 Chrome 在触摸板手势活跃期会抑制
   * 程序化滚动，且其派生的 scroll 事件风暴会引发按钮重挂载吞掉 click；直设 scrollTop 是最底层
   * API，不受手势干预，行为完全可控）。
   */
  const scrollToCue = (el: HTMLElement | null | undefined) => {
    const scroller = containerRef.current?.closest?.('main') as HTMLElement | null;
    if (!el || !scroller) return;
    programmaticPending.current = true;   // 本次赋值将触发的 scroll 事件是程序自己——一次性豁免
    const er = el.getBoundingClientRect(), sr = scroller.getBoundingClientRect();
    scroller.scrollTop = scroller.scrollTop + (er.top - sr.top) + (er.height - sr.height) / 2;   // 居中
  };
  const scrollActiveIntoView = () => scrollToCue(activeEl());
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
    if (!activeEl()) return;
    if (userScroll) { refreshAway(); return; }   // 暂停跟随：仅刷新按钮显隐，不滚不恢复
    scrollActiveIntoView();                       // scrollTop 直设居中（0.5.4：绕开 scrollIntoView 的手势抑制）
    refreshAway();
  }, [props.currentTime, userScroll]);

  // scroll 监听绑【真正的滚动容器 main】（scroll 不冒泡）：既刷新按钮显隐（0.5.2 根因②），
  // 也作为用户滚动意图的唯一判定源（0.5.5 业界模式）。程序豁免两道：
  // 一次性 pending（程序滚动自身的 scroll）+ 按钮 1.2s 窗口（惯性残余被吸收）。
  useEffect(() => {
    const scroller = containerRef.current?.closest?.('main');
    if (!scroller) return;
    const onScroll = () => {
      refreshAway();
      if (programmaticPending.current) { programmaticPending.current = false; return; }
      if (Date.now() < programmaticUntil.current) return;   // 点「跟随」后的惯性窗口：不算用户
      setUserScroll(true);                                   // 用户真滚动（含其惯性多帧）：暂停跟随
    };
    scroller.addEventListener('scroll', onScroll);
    return () => scroller.removeEventListener('scroll', onScroll);
  }, []);

  // 卸载时清理重校循环
  useEffect(() => () => { if (recalibrateTimer.current) clearInterval(recalibrateTimer.current); }, []);

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
    setUserScroll(true);   // 浏览搜索结果期间暂停自动跟随（可点「跟随」恢复）
    scrollToCue(containerRef.current?.querySelector(`[data-index="${matches[wrapped]}"]`) as HTMLElement | null | undefined);
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
          onMouseDown={() => { try { window.getSelection()?.removeAllRanges(); } catch { /* 兼容 */ } }}>
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
            onMouseDown={(e) => {
              e.preventDefault();                              // 防焦点转移
              setUserScroll(false);
              // 1.2s 程序窗口（吸收触摸板惯性残余的 scroll——不再把跟随打回暂停）
              programmaticUntil.current = Date.now() + 1200;
              scrollActiveIntoView();                          // 立即跳回（惯性会冲掉头几次，重校循环兜底）
              setAway(false);
              // 重校循环：100ms × 1.2s——惯性单调衰减，循环内赋值必然最终生效；暂停中无心跳时尤其关键
              if (recalibrateTimer.current) clearInterval(recalibrateTimer.current);
              recalibrateTimer.current = setInterval(() => {
                scrollActiveIntoView();
                if (Date.now() >= programmaticUntil.current && recalibrateTimer.current) {
                  clearInterval(recalibrateTimer.current); recalibrateTimer.current = null;
                }
              }, 100);
            }}>
            跟随 ↓
          </button>
        )}
      </div>
    </div>
  );
}
