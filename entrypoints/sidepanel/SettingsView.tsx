import { useState } from 'preact/hooks';
import type { Settings } from '../../src/types';

export function SettingsView(props: { settings: Settings; onSave: (patch: Partial<Settings>) => void }) {
  const [s, setS] = useState<Settings>(props.settings);
  const [testResult, setTestResult] = useState('');
  const bind = <K extends keyof Settings>(k: K) => ({ value: String(s[k] ?? ''), onInput: (e: any) => setS({ ...s, [k]: e.target.value }) });
  const testLlm = async () => {
    if (!s.llm) return;
    setTestResult('测试中…');
    try {
      const r = await fetch(`${s.llm.baseUrl.replace(/\/$/, '')}/chat/completions`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${s.llm.apiKey}` },
        body: JSON.stringify({ model: s.llm.model, messages: [{ role: 'user', content: 'ping' }], max_tokens: 1 }),
      });
      setTestResult(r.ok ? '✓ 连接成功' : `✗ HTTP ${r.status}`);
    } catch (e: any) { setTestResult(`✗ ${e.message}`); }
  };
  return (
    <div class="settings">
      <label>默认显示模式
        <select value={s.displayMode} onChange={(e) => setS({ ...s, displayMode: (e.target as HTMLSelectElement).value as any })}>
          <option value="bilingual">中英对照</option><option value="zh">仅中文</option><option value="en">仅英文</option>
        </select>
      </label>
      <label>翻译通道
        <select value={s.translateChannel} onChange={(e) => setS({ ...s, translateChannel: (e.target as HTMLSelectElement).value as any })}>
          <option value="free">免费接口（默认）</option><option value="llm">LLM（需配置）</option>
        </select>
      </label>
      <fieldset><legend>LLM 配置（OpenAI 兼容）</legend>
        <input placeholder="Base URL（如 https://api.openai.com/v1）" value={s.llm?.baseUrl ?? ''} onInput={(e) => setS({ ...s, llm: { ...(s.llm ?? { baseUrl: '', apiKey: '', model: '' }), baseUrl: (e.target as HTMLInputElement).value } })} />
        <input placeholder="API Key（仅存本机）" type="password" value={s.llm?.apiKey ?? ''} onInput={(e) => setS({ ...s, llm: { ...(s.llm ?? { baseUrl: '', apiKey: '', model: '' }), apiKey: (e.target as HTMLInputElement).value } })} />
        <input placeholder="模型名（如 gpt-4o-mini / deepseek-chat）" value={s.llm?.model ?? ''} onInput={(e) => setS({ ...s, llm: { ...(s.llm ?? { baseUrl: '', apiKey: '', model: '' }), model: (e.target as HTMLInputElement).value } })} />
        <div class="row"><button onClick={testLlm}>测试连接</button><span>{testResult}</span></div>
      </fieldset>
      <label>Supadata API Key（无字幕视频兜底，免费 100 次/月）
        <input type="password" placeholder="sk-…" {...(bind('supadataKey') as any)} />
      </label>
      <label class="check"><input type="checkbox" checked={s.polishEnabled} onChange={(e) => setS({ ...s, polishEnabled: (e.target as HTMLInputElement).checked })} /> LLM 纠错润色字幕（修正术语与标点）</label>
      <button class="primary" onClick={() => props.onSave(s)}>保存设置</button>
      <button onClick={() => browser.tabs.create({ url: 'chrome://extensions/shortcuts' })}>修改快捷键（浏览器管理页）</button>
      <p class="hint">密钥仅存储于本机浏览器（chrome.storage.local），请求直达对应服务，不经过第三方。走 Supadata 时视频 URL 会发送至其服务器。</p>
    </div>
  );
}
