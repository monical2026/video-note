import { useState } from 'preact/hooks';
import type { Summary } from '../../src/types';
import { formatTime } from '../../src/utils/time';
import { sendMsg, summary as summarySignal } from './state';

const CLIP_LABEL: Record<string, string> = { high: '切片价值：高', medium: '切片价值：中', low: '切片价值：低' };
const CLIP_CLASS: Record<string, string> = { high: 'clip-high', medium: 'clip-medium', low: 'clip-low' };

export function SummaryView(props: { summary: Summary | null; llmConfigured: boolean; videoId?: string; onSeek: (t: number) => void }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const gen = async () => {
    setBusy(true); setErr('');
    try {
      const r = await sendMsg<{ summary: Summary }>({ type: 'SUMMARIZE', videoId: props.videoId ?? '' });
      summarySignal.value = r.summary; // 直接更新 signal，无需刷新页面
    } catch (e: any) { setErr(e.message ?? '生成失败'); }
    finally { setBusy(false); }
  };
  if (!props.summary) return (
    <div class="empty">
      <button class="primary" disabled={!props.llmConfigured || busy} onClick={gen}>
        {busy ? '生成中…（长视频需数分钟）' : '生成摘要'}
      </button>
      {!props.llmConfigured && <p>AI 摘要需要在 ⚙️ 设置中配置 LLM API key</p>}
      {err && <p class="err">{err}</p>}
    </div>
  );
  const s = props.summary;
  return (
    <div class="summary">
      <p class="oneliner">📌 <span>{s.oneLiner}</span></p>
      {s.sections.map((sec, i) => (
        <section key={i} class="summary-section">
          <h3>
            <button class="ts" onClick={() => props.onSeek(sec.start)}>{formatTime(sec.start)}</button>
            {sec.end != null && <span class="ts-range">~ <button class="ts" onClick={() => props.onSeek(sec.end!)}>{formatTime(sec.end)}</button></span>}
            {' '}{sec.title}
            {sec.clipWorthy && <span class={`clip-badge ${CLIP_CLASS[sec.clipWorthy.level] ?? ''}`} title={sec.clipWorthy.reason}>
              ✂ {CLIP_LABEL[sec.clipWorthy.level] ?? sec.clipWorthy.level}
            </span>}
          </h3>
          {sec.overview && <p class="sec-overview">{sec.overview}</p>}
          {sec.problem && <p class="sec-meta"><b>解决的问题：</b>{sec.problem}</p>}
          {sec.useCase && <p class="sec-meta"><b>应用场景：</b>{sec.useCase}</p>}
          {!!sec.points.length && <ul>{sec.points.map((p, j) => <li key={j}>{p}</li>)}</ul>}
          {sec.clipWorthy?.reason && <p class="sec-clip-reason">✂ {sec.clipWorthy.reason}</p>}
        </section>
      ))}
      {!!s.keyQuotes?.length && <section><h3>💬 金句</h3>
        <ul class="quotes">{s.keyQuotes.map((k, i) => (
          <li key={i}>
            <button class="ts" onClick={() => props.onSeek(k.start)}>{formatTime(k.start)}</button>
            <blockquote>{k.quote}</blockquote>
          </li>
        ))}</ul></section>}
      {!!s.knowledge.length && <section><h3>📚 知识点清单</h3>
        <ul>{s.knowledge.map((k, i) => <li key={i}><b>{k.term}</b>：{k.desc}</li>)}</ul></section>}
      {!!s.prerequisites.length && <section><h3>前置知识 / 延伸</h3>
        <ul>{s.prerequisites.map((p, i) => <li key={i}>{p}</li>)}</ul></section>}
      <button disabled={busy} onClick={gen}>{busy ? '生成中…' : '重新生成'}</button>
    </div>
  );
}
