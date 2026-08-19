import { useEffect, useRef } from 'preact/hooks';
import type { Cue, DisplayMode } from '../../src/types';
import { formatTime } from '../../src/utils/time';

export function TranscriptView(props: {
  cues: Cue[]; videoId: string; currentTime: number; mode: DisplayMode;
  onSeek: (t: number) => void; onSelect: (cues: Cue[]) => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  // 当前句变化时跟随滚动；block:'nearest' 仅在当前句离开视口时才滚动
  useEffect(() => {
    const el = containerRef.current?.querySelector('.cue.active') as HTMLElement | null | undefined;
    // jsdom 等环境无 scrollIntoView，存在性守卫
    if (el && typeof el.scrollIntoView === 'function') el.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [props.currentTime]);
  const isCurrent = (c: Cue, i: number) => {
    const next = props.cues[i + 1];
    return props.currentTime >= c.start && (!next || props.currentTime < next.start);
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
    <div class="transcript" ref={containerRef} onMouseUp={onMouseUp}>
      {props.cues.map((c, i) => (
        <div key={i} data-testid={`cue-${i}`} data-index={i} class={`cue ${isCurrent(c, i) ? 'active' : ''}`}
          onClick={() => { if (window.getSelection()?.toString()) return; props.onSeek(c.start); }}>
          <button data-testid={`ts-${i}`} class="ts" onClick={(e) => { e.stopPropagation(); props.onSeek(c.start); }}>{formatTime(c.start)}</button>
          {props.mode !== 'zh' && <div class="en">{c.text}</div>}
          {props.mode !== 'en' && <div class="zh">{c.zh ?? '（未翻译）'}</div>}
        </div>
      ))}
    </div>
  );
}
