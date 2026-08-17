import type { Cue, DisplayMode } from '../../src/types';
import { formatTime } from '../../src/utils/time';

export function TranscriptView(props: {
  cues: Cue[]; videoId: string; currentTime: number; mode: DisplayMode;
  onSeek: (t: number) => void; onSelect: (cues: Cue[]) => void;
}) {
  const isCurrent = (c: Cue, i: number) => {
    const next = props.cues[i + 1];
    return props.currentTime >= c.start && (!next || props.currentTime < next.start);
  };
  const onMouseUp = () => {
    const sel = window.getSelection()?.toString().trim();
    if (sel) props.onSelect(props.cues.filter((c) => sel.includes(c.text.slice(0, 10)) || (sel && c.text.includes(sel.slice(0, 10)))));
  };
  return (
    <div class="transcript" onMouseUp={onMouseUp}>
      {props.cues.map((c, i) => (
        <div key={i} data-testid={`cue-${i}`} class={`cue ${isCurrent(c, i) ? 'active' : ''}`}>
          <button data-testid={`ts-${i}`} class="ts" onClick={() => props.onSeek(c.start)}>{formatTime(c.start)}</button>
          {props.mode !== 'zh' && <div class="en">{c.text}</div>}
          {props.mode !== 'en' && <div class="zh">{c.zh ?? '（未翻译）'}</div>}
        </div>
      ))}
    </div>
  );
}
