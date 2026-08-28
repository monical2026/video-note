// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, fireEvent, cleanup, waitFor } from '@testing-library/preact';
import { App } from './App';
import { activeTab, displayMode } from './state';
import type { Settings } from '../../src/types';

const settings: Settings = { displayMode: 'bilingual', translateChannel: 'free', llm: null, supadataKey: '', llmKeys: {} };
const cues = [{ start: 1, dur: 2, text: 'hello', zh: '你好' }];

function stubBrowser() {
  const store = new Map<string, any>();
  vi.stubGlobal('browser', {
    runtime: {
      sendMessage: vi.fn(async (msg: any) => {
        if (msg.type === 'GET_SETTINGS') return settings;
        if (msg.type === 'GET_VIDEO_DATA') return { video: { videoId: 'vid123', title: 'T' }, cues, notes: [], summary: null };
        return {};
      }),
      onMessage: { addListener: vi.fn(), removeListener: vi.fn() },
    },
    tabs: { query: vi.fn(async () => [{ url: 'https://www.youtube.com/watch?v=vid123456789' }]) },
    storage: {
      local: {
        get: vi.fn(async (k: string) => (store.has(k) ? { [k]: store.get(k) } : {})),
        set: vi.fn(async (obj: any) => { for (const [k, v] of Object.entries(obj)) store.set(k, v); }),
      },
    },
  });
  return store;
}

afterEach(() => { cleanup(); vi.unstubAllGlobals(); displayMode.value = 'bilingual'; activeTab.value = 'transcript'; });

describe('三档显示模式切换条', () => {
  it('渲染三个分段按钮；点击「仅中文」保存偏好且 TranscriptView 英文行隐藏', async () => {
    stubBrowser();
    const { getByTestId, findByText } = render(<App />);
    // 数据加载后：切换条三按钮 + 双语行都在
    expect(await findByText('hello')).toBeTruthy();
    const bar = getByTestId('mode-switch');
    expect(bar.textContent).toContain('中英对照');
    expect(bar.textContent).toContain('仅中文');
    expect(bar.textContent).toContain('仅英文');
    // 点击「仅中文」：信号更新 + SAVE_SETTINGS 发出 + 英文行隐藏
    const btns = Array.from(bar.children) as HTMLElement[];
    fireEvent.click(btns[1]!);
    expect(displayMode.value).toBe('zh');
    expect(browser.runtime.sendMessage).toHaveBeenCalledWith({ type: 'SAVE_SETTINGS', patch: { displayMode: 'zh' } });
    await waitFor(() => expect(getByTestId('cue-0').textContent).not.toContain('hello'));
    expect(getByTestId('cue-0').textContent).toContain('你好');
  });
});

describe('LLM 重翻按钮', () => {
  it('配置 LLM 后显示；点击「用 LLM 重翻」发送 force', async () => {
    settings.llm = { baseUrl: 'http://x/v1', apiKey: 'k', model: 'm' };
    stubBrowser();
    const { getByTestId, queryByTestId, findByText } = render(<App />);
    await findByText('hello');
    expect(getByTestId('retranslate-llm')).toBeTruthy();
    fireEvent.click(getByTestId('retranslate-llm'));
    expect(browser.runtime.sendMessage).toHaveBeenCalledWith({ type: 'TRANSLATE', videoId: 'vid123', force: true });
    settings.llm = null;
  });

  it('未配置 LLM 时按钮不显示；润色功能已移除（无重新润色按钮）', async () => {
    stubBrowser();
    const { queryByTestId, findByText } = render(<App />);
    await findByText('hello');
    expect(queryByTestId('retranslate-llm')).toBeNull();
    expect(queryByTestId('repolish')).toBeNull();
    expect(document.body.textContent).not.toContain('重新润色');
  });
});

describe('重抓字幕 / 重新分段', () => {
  it('点击后清除库存并触发重新抓取（DELETE_TRANSCRIPT + RETRY_TRANSCRIPT）', async () => {
    stubBrowser();
    const { getByTestId, findByText } = render(<App />);
    await findByText('hello');
    fireEvent.click(getByTestId('refetch-transcript'));
    await waitFor(() => expect(browser.runtime.sendMessage).toHaveBeenCalledWith({ type: 'DELETE_TRANSCRIPT', videoId: 'vid123' }));
    expect(browser.runtime.sendMessage).toHaveBeenCalledWith({ type: 'RETRY_TRANSCRIPT' });
  });

  it('「规则分段」与「AI 分段」按钮：点击发送对应 mode 的 RESEGMENT；未配 LLM 时 AI 按钮不显示', async () => {
    stubBrowser();   // 默认 settings.llm = null → AI 按钮隐藏
    const { getByTestId, queryByTestId, findByText } = render(<App />);
    await findByText('hello');
    expect(queryByTestId('resegment-ai')).toBeNull();
    fireEvent.click(getByTestId('resegment-rules'));
    expect(browser.runtime.sendMessage).toHaveBeenCalledWith({ type: 'RESEGMENT', videoId: 'vid123', mode: 'rules' });
  });

  it('配置 LLM 后「AI 分段」显示且可点击', async () => {
    settings.llm = { baseUrl: 'http://x/v1', apiKey: 'k', model: 'm' };
    stubBrowser();
    const { getByTestId, findByText } = render(<App />);
    await findByText('hello');
    fireEvent.click(getByTestId('resegment-ai'));
    expect(browser.runtime.sendMessage).toHaveBeenCalledWith({ type: 'RESEGMENT', videoId: 'vid123', mode: 'ai' });
    settings.llm = null;
  });
});

describe('LLM 流式显示 / Tab 记忆', () => {
  it('收到 LLM_STREAM 广播显示批号与逐字文本', async () => {
    stubBrowser();
    const { findByText, findByTestId } = render(<App />);
    await findByText('hello');
    // 模拟 background 广播（listener 由 App 注册到 onMessage）
    const cb = (browser.runtime.onMessage.addListener as ReturnType<typeof vi.fn>).mock.calls[0]![0] as (m: any, s: any) => void;
    cb({ type: 'LLM_STREAM', batch: 2, batchTotal: 5, text: '2. 闭包可以捕获状态' }, null);
    const box = await findByTestId('llm-stream');
    expect(box.textContent).toContain('翻译中');
    expect(box.textContent).toContain('2/5');
    expect(box.textContent).toContain('2. 闭包可以捕获状态');
  });

  it('翻译失败显示错误条（不再静默）', async () => {
    stubBrowser();
    vi.stubGlobal('browser', {
      ...(browser as any),
      runtime: {
        ...(browser as any).runtime,
        sendMessage: vi.fn(async (msg: any) => (msg.type === 'TRANSLATE' ? { error: 'LLM 429: 余额不足' } : (browser as any).runtime.sendMessage(msg))),
      },
    });
    const { findByText } = render(<App />);
    await findByText('hello');
    fireEvent.click(document.querySelector('.translate-bar button')!);
    await waitFor(() => expect(document.body.textContent).toContain('翻译失败：LLM 429: 余额不足'));
  });

  it('记住上次的 Tab：预存 settings 后启动恢复', async () => {
    const store = stubBrowser();
    store.set('lastTab', 'settings');
    const { findByText } = render(<App />);
    // activeTab 恢复为 settings：设置页的保存按钮出现
    await findByText('保存设置');
    expect(activeTab.value).toBe('settings');
  });

  it('切换 Tab 写入持久化存储', async () => {
    const store = stubBrowser();
    const { findByText, getByText } = render(<App />);
    await findByText('hello');
    fireEvent.click(getByText('AI 摘要'));
    await waitFor(() => expect(store.get('lastTab')).toBe('summary'));
  });

  it('恢复读取完成前不回写初始 Tab（真机 IPC 时序下防覆盖）', async () => {
    const store = stubBrowser();
    store.set('lastTab', 'settings');
    // get 延迟一拍：模拟真机 chrome.storage 的 IPC——读取结果晚于 subscribe 立即回调
    (browser.storage.local as any).get = vi.fn(async (k: string) => {
      await new Promise((r) => setTimeout(r, 0));
      return store.has(k) ? { [k]: store.get(k) } : {};
    });
    const { findByText } = render(<App />);
    await findByText('保存设置');
    expect(activeTab.value).toBe('settings');
    // 关键：存储里的值没有被 signal 初始值 'transcript' 覆盖
    expect(store.get('lastTab')).toBe('settings');
  });

  it('保存设置成功后跳回进入设置前的工作 Tab', async () => {
    stubBrowser();
    const { findByText, getByText } = render(<App />);
    await findByText('hello');
    // 工作现场切到「笔记」→ 进设置 → 保存 → 应回到笔记
    fireEvent.click(getByText('笔记'));
    fireEvent.click(getByText('⚙️'));
    await findByText('保存设置');
    fireEvent.click(getByText('保存设置'));
    await waitFor(() => expect(activeTab.value).toBe('notes'));
  });
});
