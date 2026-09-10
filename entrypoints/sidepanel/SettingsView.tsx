import { useEffect, useRef, useState } from 'preact/hooks';
import { THEMES } from '../../src/types';
import type { Settings, Theme } from '../../src/types';

// 常用 LLM 服务商预设：一键填充 baseUrl + model，避免手填出错
const PRESETS = [
  { name: '智谱', baseUrl: 'https://open.bigmodel.cn/api/paas/v4', model: 'glm-4-flash', keyHint: 'your-zhipu-api-key' },
  { name: 'DeepSeek', baseUrl: 'https://api.deepseek.com/v1', model: 'deepseek-chat', keyHint: 'sk-...' },
  { name: 'OpenAI', baseUrl: 'https://api.openai.com/v1', model: 'gpt-4o-mini', keyHint: 'sk-...' },
] as const;

const emptyLlm = { baseUrl: '', apiKey: '', model: '' };
const DEFAULT_KEY_HINT = 'sk-…（仅存本机）';
const THEME_LABEL: Record<Theme, string> = { light: '亮色', dark: '暗色', amber: '琥珀' };

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
  const [confirmClear, setConfirmClear] = useState(false);
  const [clearDone, setClearDone] = useState(false);
  const clearTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // 两段式确认：首点进入确认态（3 秒窗口），再点执行——删除不可恢复
  const clearAll = async () => {
    if (clearTimer.current) clearTimeout(clearTimer.current);
    if (!confirmClear) {
      setConfirmClear(true);
      clearTimer.current = setTimeout(() => setConfirmClear(false), 3000);
      return;
    }
    setConfirmClear(false);
    await browser.runtime.sendMessage({ type: 'CLEAR_ALL_DATA' }).catch(() => {});
    setClearDone(true);
    clearTimer.current = setTimeout(() => setClearDone(false), 3000);
  };
  const apiKeyRef = useRef<HTMLInputElement>(null);
  // 当前快捷键实际绑定：Chrome 不会自动应用 manifest 更新后的新默认键，需展示真实状态
  const [shortcut, setShortcut] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const cmds = await (browser as any).commands.getAll();
        const cmd = (cmds as any[])?.find((c) => c.name === 'capture-note');
        if (alive) setShortcut(cmd?.shortcut || '');
      } catch {
        if (alive) setShortcut(null); // 读取失败（环境不支持）
      }
    })();
    return () => { alive = false; };
  }, []);

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
        <h3>外观</h3>
        <div class="field">
          <span class="label">界面主题</span>
          <div class="theme-row" data-testid="theme-row">
            {THEMES.map((t) => (
              <button key={t} class={s.theme === t ? 'on' : ''} data-testid={`theme-${t}`} onClick={() => setS({ ...s, theme: t })}>
                <span class="swatch" data-theme={t}></span>{THEME_LABEL[t]}
              </button>
            ))}
          </div>
          <span class="hint-line">保存后全界面即时切换：亮色适合白天，暗色适合夜间看视频，琥珀适合长时间阅读逐字稿。</span>
        </div>
      </section>

      <section class="settings-card">
        <h3>其他</h3>
        <div class="field">
          <span class="label">截取片段快捷键</span>
          <span class="hint-line">
            {shortcut === null
              ? '当前绑定：无法读取（点下方按钮去浏览器设置页查看）'
              : shortcut
                ? `当前绑定：${shortcut}`
                : '当前绑定：未设置 ⚠️ 请点击下方按钮设置'}
          </span>
        </div>
        <button class="ghost" onClick={() => browser.tabs.create({ url: 'chrome://extensions/shortcuts' })}>修改快捷键（浏览器管理页）</button>
        <div class="field">
          <span class="label">测试数据</span>
          <span class="hint-line">删除全部视频、逐字稿、笔记与 AI 摘要（设置与 API key 保留）——用于从头开始完整测试。</span>
          <button class="ghost danger" data-testid="clear-data-btn" onClick={clearAll}>
            {confirmClear ? '⚠️ 再点一次确认清空（3 秒内）' : clearDone ? '已清空 ✓' : '清空全部测试数据'}
          </button>
        </div>
        <p class="hint-line">密钥仅存储于本机浏览器（chrome.storage.local），请求直达对应服务，不经过第三方。走 Supadata 时视频 URL 会发送至其服务器。</p>
      </section>

      <button class="primary save-btn" onClick={save}>{saved ? '已保存 ✓' : '保存设置'}</button>
    </div>
  );
}
