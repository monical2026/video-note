import { describe, expect, it } from 'vitest';
import { getSettings, saveSettings, type SettingsArea } from './settings';

const mem = (): SettingsArea => {
  const m = new Map<string, any>();
  return { get: async (k) => m.get(k), set: async (o) => { for (const [k, v] of Object.entries(o)) m.set(k, v); } };
};

it('未存储时返回默认值', async () => {
  const s = await getSettings(mem());
  expect(s).toMatchObject({ displayMode: 'bilingual', translateChannel: 'free', llm: null, supadataKey: '', polishEnabled: false });
});

it('patch 保存并合并读取', async () => {
  const area = mem();
  await saveSettings({ supadataKey: 'sk-1', polishEnabled: true }, area);
  const s = await getSettings(area);
  expect(s.supadataKey).toBe('sk-1');
  expect(s.polishEnabled).toBe(true);
  expect(s.displayMode).toBe('bilingual');
});
