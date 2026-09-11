import { useState } from 'preact/hooks';
import { sendMsg } from './state';
import type { ExportPart } from '../../src/services/export';

const PARTS: Array<{ id: ExportPart; label: string; desc: string }> = [
  { id: 'transcript', label: '逐字稿', desc: '中英对照全文（时间戳可点跳转）' },
  { id: 'notes', label: '我的笔记', desc: '批注、摘录与 AI 解释时间线' },
  { id: 'summary', label: 'AI 摘要', desc: '主题分节、金句与知识点' },
];

/** 导出弹窗（§0.13）：三选多选，合并为单文档（文内分节标注各部分） */
export function ExportDialog(props: { videoId: string; onClose: () => void }) {
  const [parts, setParts] = useState<Set<ExportPart>>(() => new Set(['notes', 'summary']));
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const toggle = (id: ExportPart) => {
    setParts((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };
  const doExport = async () => {
    if (!parts.size || busy) return;
    setBusy(true); setErr('');
    try {
      const r = await sendMsg<{ markdown: string }>({ type: 'EXPORT', videoId: props.videoId, parts: [...parts] });
      const url = URL.createObjectURL(new Blob([r.markdown], { type: 'text/markdown' }));
      const a = document.createElement('a');
      a.href = url; a.download = `${props.videoId}-notes.md`; a.click();
      URL.revokeObjectURL(url);
      props.onClose();
    } catch (e) {
      setErr(e instanceof Error ? e.message : '导出失败');
    } finally { setBusy(false); }
  };
  return (
    <div class="editor-mask" data-testid="export-dialog" onClick={props.onClose}>
      <div class="editor" onClick={(e) => e.stopPropagation()}>
        <div class="meta">导出当前视频的学习内容（可多选，合并为一个 Markdown 文档）</div>
        {PARTS.map((p) => (
          <label key={p.id} class={`export-part ${parts.has(p.id) ? 'on' : ''}`} data-testid={`export-${p.id}`}>
            <input type="checkbox" checked={parts.has(p.id)} onChange={() => toggle(p.id)} />
            <span>
              <span class="pl">{p.label}</span>
              <span class="pd">{p.desc}</span>
            </span>
          </label>
        ))}
        {err && <div class="err"><span>导出失败：{err}</span></div>}
        <div class="row">
          <button onClick={props.onClose}>取消</button>
          <button class="primary" data-testid="export-confirm" disabled={!parts.size || busy} onClick={doExport}>
            {busy ? '导出中…' : '导出'}
          </button>
        </div>
      </div>
    </div>
  );
}
