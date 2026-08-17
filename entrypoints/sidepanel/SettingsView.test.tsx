// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { render, fireEvent } from '@testing-library/preact';
import { SettingsView } from './SettingsView';

it('保存时回传完整 patch', async () => {
  const onSave = vi.fn();
  const { getByPlaceholderText, getByText } = render(
    <SettingsView settings={{ displayMode: 'bilingual', translateChannel: 'free', llm: null, supadataKey: '', polishEnabled: false }} onSave={onSave} />,
  );
  fireEvent.input(getByPlaceholderText('sk-…'), { target: { value: 'sk-supa' } }); // Supadata key 输入框
  fireEvent.click(getByText('保存设置'));
  expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ supadataKey: 'sk-supa' }));
});
