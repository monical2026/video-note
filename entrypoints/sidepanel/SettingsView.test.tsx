// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { render, fireEvent } from '@testing-library/preact';
import { SettingsView } from './SettingsView';

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
