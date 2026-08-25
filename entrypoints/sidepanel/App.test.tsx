// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, fireEvent, cleanup, waitFor } from '@testing-library/preact';
import { App } from './App';
import { displayMode } from './state';
import type { Settings } from '../../src/types';

const settings: Settings = { displayMode: 'bilingual', translateChannel: 'free', llm: null, supadataKey: '', polishEnabled: false };
const cues = [{ start: 1, dur: 2, text: 'hello', zh: '你好' }];

function stubBrowser() {
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
  });
}

afterEach(() => { cleanup(); vi.unstubAllGlobals(); displayMode.value = 'bilingual'; });

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

describe('LLM 重翻 / 重新润色按钮', () => {
  it('配置 LLM 后显示；点击「用 LLM 重翻」发送 force，未配置不显示', async () => {
    settings.llm = { baseUrl: 'http://x/v1', apiKey: 'k', model: 'm' };
    stubBrowser();
    const { getByTestId, findByText } = render(<App />);
    await findByText('hello');
    expect(getByTestId('retranslate-llm')).toBeTruthy();
    expect(getByTestId('repolish')).toBeTruthy();
    fireEvent.click(getByTestId('retranslate-llm'));
    expect(browser.runtime.sendMessage).toHaveBeenCalledWith({ type: 'TRANSLATE', videoId: 'vid123', force: true });
    settings.llm = null;
  });

  it('未配置 LLM 时按钮不显示', async () => {
    stubBrowser();
    const { queryByTestId, findByText } = render(<App />);
    await findByText('hello');
    expect(queryByTestId('retranslate-llm')).toBeNull();
    expect(queryByTestId('repolish')).toBeNull();
  });
});
