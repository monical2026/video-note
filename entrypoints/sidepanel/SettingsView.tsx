import { useRef, useState } from 'preact/hooks';
import type { Settings } from '../../src/types';

// 常用 LLM 服务商预设：一键填充 baseUrl + model，避免手填出错
const PRESETS = [
  { name: '智谱', baseUrl: 'https://open.bigmodel.cn/api/paas/v4', model: 'glm-4-flash', keyHint: 'your-zhipu-api-key' },
  { name: 'DeepSeek', baseUrl: 'https://api.deepseek.com/v1', model: 'deepseek-chat', keyHint: 'sk-...' },
  { name: 'OpenAI', baseUrl: 'https://api.openai.com/v1', model: 'gpt-4o-mini', keyHint: 'sk-...' },
] as const;

const emptyLlm = { baseUrl: '', apiKey: '', model: '' };
const DEFAULT_KEY_HINT = 'sk-…（仅存本机）';

type Provider = 'zhipu' | 'deepseek' | 'openai' | null;

/** 根据 baseUrl 判定服务商：用于 key 记忆槽位；自定义地址返回 null（不记忆） */
const detectProvider = (baseUrl: string | undefined): Provider => {
  const u = baseUrl ?? '';
  if (u.startsWith('https://open.bigmodel.cn')) return 'zhipu';
  if (u.startsWith('https://api.deepseek.com')) return 'deepseek';
  if (u.startsWith('https://api.openai.com')) return 'openai';
  return null;
};

export function SettingsView(props: { settings: Settings; onSave: (patch: Partial<Settings>) => void }) {
  const [s, setS] = useState<Settings>(props.settings);
  const [testResult, setTestResult] = useState('');
  const [saved, setSaved] = useState(false);
  const apiKeyRef = useRef<HTMLInputElement>(null);

  const setLlm = (patch: Partial<typeof emptyLlm>) =>
    setS({ ...s, llm: { ...(s.llm ?? emptyLlm), ...patch } });

  const applyPreset = (p: typeof PRESETS[number]) => {
    const provider = p.name === '智谱' ? 'zhipu' : p.name === 'DeepSeek' ? 'deepseek' : 'openai';
    // 先把当前非空 key 存入当前 provider 槽位（自定义地址不记忆）
    const cur = detectProvider(s.llm?.baseUrl);
    const keys = { ...(s.llmKeys ?? {}) };
    if (cur && s.llm?.apiKey) keys[cur] = s.llm.apiKey;
    setS({ ...s, llmKeys: keys, llm: { baseUrl: p.baseUrl, model: p.model, apiKey: keys[provider] ?? '' } });
  };

  const save = () => {
    // 当前 provider 的 key 同步进记忆槽位后随整份 settings 保存
    const cur = detectProvider(s.llm?.baseUrl);
    const toSave = cur && s.llm?.apiKey
      ? { ...s, llmKeys: { ...(s.llmKeys ?? {}), [cur]: s.llm.apiKey } }
      : s;
    props.onSave(toSave);
    setSaved(true);
    setTimeout(() => setSaved(false), 1500);
  };

  const testLlm = async () => {
    if (!s.llm?.baseUrl) return;
    setTestResult('测试中…');
    try {
      // 目标域不在 host_permissions 内，先动态申请（按钮点击是 user gesture，合法）
      const origin = new URL(s.llm.baseUrl).origin;
      const granted = await (browser as any).permissions.request({ origins: [origin + '/*'] });
      if (!granted) { setTestResult('✗ 未授予 ' + origin + ' 的访问权限，无法测试'); return; }
      const r = await fetch(`${s.llm.baseUrl.replace(/\/$/, '')}/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${s.llm.apiKey}` },
        body: JSON.stringify({ model: s.llm.model, messages: [{ role: 'user', content: 'ping' }], max_tokens: 1 }),
      });
      if (r.ok) setTestResult('✓ 连接成功');
      else if (r.status === 401 || r.status === 403) setTestResult(`✗ API Key 无效或无权限（HTTP ${r.status}）`);
      else if (r.status === 404) setTestResult('✗ 地址可能不对：Base URL 应含完整路径（如 https://open.bigmodel.cn/api/paas/v4）');
      else setTestResult(`✗ 服务返回 HTTP ${r.status}`);
    } catch (e: any) {
      setTestResult('✗ 无法连接：检查网络或 Base URL 是否正确');
    }
  };

  const presetKeyHint = PRESETS.find((p) => s.llm?.baseUrl === p.baseUrl)?.keyHint ?? DEFAULT_KEY_HINT;

  return (
    <div class="settings">
      <section class="settings-card">
        <h3>显示与翻译</h3>
        <div class="settings-grid">
          <label class="field">
            <span class="label">默认显示模式</span>
            <select value={s.displayMode} onChange={(e) => setS({ ...s, displayMode: (e.target as HTMLSelectElement).value as any })}>
              <option value="bilingual">中英对照</option><option value="zh">仅中文</option><option value="en">仅英文</option>
            </select>
          </label>
          <label class="field">
            <span class="label">翻译通道</span>
            <select value={s.translateChannel} onChange={(e) => setS({ ...s, translateChannel: (e.target as HTMLSelectElement).value as any })}>
              <option value="free">免费接口（默认）</option><option value="llm">LLM（需配置）</option>
            </select>
          </label>
        </div>
      </section>

      <section class="settings-card">
        <h3>LLM 服务（AI 翻译/摘要/解释）</h3>
        <div class="preset-row">
          {PRESETS.map((p) => (
            <button class="ghost" key={p.name} onClick={() => applyPreset(p)}>{p.name}</button>
          ))}
        </div>
        <span class="hint-line">各服务商的 API Key 会分别记住，切换预设自动带出</span>
        <label class="field">
          <span class="label">Base URL</span>
          <span class="hint-line">完整地址，到 /v1 或 /api/paas/v4</span>
          <input placeholder="如 https://open.bigmodel.cn/api/paas/v4" value={s.llm?.baseUrl ?? ''} onInput={(e) => setLlm({ baseUrl: (e.target as HTMLInputElement).value })} />
        </label>
        <label class="field">
          <span class="label">API Key</span>
          <span class="key-input-wrap">
            <input ref={apiKeyRef} type="password" placeholder={presetKeyHint} value={s.llm?.apiKey ?? ''} onInput={(e) => setLlm({ apiKey: (e.target as HTMLInputElement).value })} />
            {s.llm?.apiKey ? (
              <button type="button" class="clear-btn" title="清空" onClick={() => { setLlm({ apiKey: '' }); apiKeyRef.current?.focus(); }}>×</button>
            ) : null}
          </span>
        </label>
        <label class="field">
          <span class="label">模型名</span>
          <input placeholder="如 glm-4-flash / deepseek-chat / gpt-4o-mini" value={s.llm?.model ?? ''} onInput={(e) => setLlm({ model: (e.target as HTMLInputElement).value })} />
        </label>
        <div class="row"><button class="ghost" onClick={testLlm}>测试连接</button><span class="test-result">{testResult}</span></div>
      </section>

      <section class="settings-card">
        <h3>无字幕兜底</h3>
        <label class="field">
          <span class="label">Supadata API Key</span>
          <span class="hint-line">无字幕视频经 Supadata 生成，免费 100 次/月；视频 URL 会发送至其服务器</span>
          <input type="password" placeholder="sk-…" value={s.supadataKey} onInput={(e) => setS({ ...s, supadataKey: (e.target as HTMLInputElement).value })} />
        </label>
      </section>

      <section class="settings-card">
        <h3>其他</h3>
        <label class="check"><input type="checkbox" checked={s.polishEnabled} onChange={(e) => setS({ ...s, polishEnabled: (e.target as HTMLInputElement).checked })} /> LLM 纠错润色字幕（修正术语与标点）</label>
        <button class="ghost" onClick={() => browser.tabs.create({ url: 'chrome://extensions/shortcuts' })}>修改快捷键（浏览器管理页）</button>
        <p class="hint-line">密钥仅存储于本机浏览器（chrome.storage.local），请求直达对应服务，不经过第三方。走 Supadata 时视频 URL 会发送至其服务器。</p>
      </section>

      <button class="primary save-btn" onClick={save}>{saved ? '已保存 ✓' : '保存设置'}</button>
    </div>
  );
}
