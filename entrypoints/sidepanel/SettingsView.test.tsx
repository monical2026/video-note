// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, fireEvent, waitFor } from '@testing-library/preact';
import { SettingsView } from './SettingsView';
import type { Settings } from '../../src/types';

const baseSettings = { displayMode: 'bilingual' as const, translateChannel: 'free' as const, llm: null, supadataKey: '', polishEnabled: false };

it('保存时回传完整 patch', async () => {
  const onSave = vi.fn();
  const { getByPlaceholderText, getByText } = render(<SettingsView settings={{ ...baseSettings }} onSave={onSave} />);
  fireEvent.input(getByPlaceholderText('sk-…'), { target: { value: 'sk-supa' } }); // Supadata key 输入框
  fireEvent.click(getByText('保存设置'));
  expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ supadataKey: 'sk-supa' }));
});

it('点击智谱预设后自动填入 baseUrl 与 model', async () => {
  const onSave = vi.fn();
  const { getByText, getByPlaceholderText } = render(<SettingsView settings={{ ...baseSettings }} onSave={onSave} />);
  fireEvent.click(getByText('智谱'));
  expect((getByPlaceholderText('如 https://open.bigmodel.cn/api/paas/v4') as HTMLInputElement).value).toBe('https://open.bigmodel.cn/api/paas/v4');
  expect((getByPlaceholderText('如 glm-4-flash / deepseek-chat / gpt-4o-mini') as HTMLInputElement).value).toBe('glm-4-flash');
  fireEvent.click(getByText('保存设置'));
  expect(onSave).toHaveBeenCalledWith(expect.objectContaining({
    llm: expect.objectContaining({ baseUrl: 'https://open.bigmodel.cn/api/paas/v4', model: 'glm-4-flash' }),
  }));
});

it('多服务商 key 记忆：切换预设自动带出已存的 key', async () => {
  const onSave = vi.fn();
  const { getByText, getByPlaceholderText } = render(<SettingsView settings={{ ...baseSettings }} onSave={onSave} />);
  const keyInput = getByPlaceholderText('sk-…（仅存本机）') as HTMLInputElement;

  // 1. 填智谱 key 并保存
  fireEvent.click(getByText('智谱'));
  fireEvent.input(keyInput, { target: { value: 'zhipu-key-1' } });
  fireEvent.click(getByText('保存设置'));
  const saved1 = onSave.mock.calls[0]![0] as Settings;
  expect(saved1.llmKeys).toEqual({ zhipu: 'zhipu-key-1' });

  // 2. 切到 DeepSeek：智谱 key 已存、apiKey 变空
  fireEvent.click(getByText('DeepSeek'));
  expect(keyInput.value).toBe('');
  // 3. 填 DeepSeek key 后切回智谱：自动带出智谱 key
  fireEvent.input(keyInput, { target: { value: 'deepseek-key-1' } });
  fireEvent.click(getByText('智谱'));
  expect(keyInput.value).toBe('zhipu-key-1');
});

it('API Key 清空小叉：点击后清空并可重新输入', async () => {
  const onSave = vi.fn();
  const { getByTitle, getByPlaceholderText } = render(
    <SettingsView settings={{ ...baseSettings, llm: { baseUrl: 'https://api.deepseek.com/v1', apiKey: 'sk-old', model: 'deepseek-chat' } }} onSave={onSave} />,
  );
  const keyInput = getByPlaceholderText('sk-...') as HTMLInputElement;
  expect(keyInput.value).toBe('sk-old');
  fireEvent.click(getByTitle('清空'));
  expect(keyInput.value).toBe('');
});

afterEach(() => vi.unstubAllGlobals());

it('展示 capture-note 快捷键的当前实际绑定', async () => {
  vi.stubGlobal('browser', {
    commands: { getAll: vi.fn(async () => [{ name: 'capture-note', shortcut: 'Alt+N' }]) },
  });
  const { getByText } = render(<SettingsView settings={{ ...baseSettings }} onSave={vi.fn()} />);
  await waitFor(() => expect(getByText('当前绑定：Alt+N')).toBeTruthy());
});
