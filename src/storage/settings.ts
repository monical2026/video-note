import { THEMES } from '../types';
import type { Settings, Theme } from '../types';

export interface SettingsArea { get(key: string): Promise<any>; set(obj: Record<string, any>): Promise<void>; }
const KEY = 'vn-settings';
export const DEFAULT_SETTINGS: Settings = {
  theme: 'light', displayMode: 'bilingual', translateChannel: 'free', llm: null, supadataKey: '', llmKeys: {},
};

/** area 缺省时用 chrome.storage.local（浏览器环境），node 环境走内存 fallback */
const defaultArea = (): SettingsArea => {
  const c = (globalThis as any).chrome;
  if (typeof c !== 'undefined' && c?.storage?.local) {
    return {
      get: (k: string) => c.storage.local.get(k).then((o: Record<string, any>) => o[k]),
      set: (o: Record<string, any>) => c.storage.local.set(o),
    };
  }
  return memFallback();
};

function memFallback(): SettingsArea {
  const m = new Map<string, any>();
  return { get: async (k) => m.get(k), set: async (o) => { for (const [k, v] of Object.entries(o)) m.set(k, v); } };
}

/** theme 合法值归一化：存量脏值/损坏值统一回落 light——storage 边界唯一防线，消费方零防御 */
export function normalizeTheme(v: unknown): Theme {
  return (THEMES as readonly string[]).includes(v as string) ? (v as Theme) : 'light';
}

export async function getSettings(area: SettingsArea = defaultArea()): Promise<Settings> {
  const saved = (await area.get(KEY)) ?? {};
  return { ...DEFAULT_SETTINGS, ...saved, theme: normalizeTheme(saved.theme) };
}

export async function saveSettings(patch: Partial<Settings>, area: SettingsArea = defaultArea()): Promise<void> {
  const merged = { ...(await getSettings(area)), ...patch };
  await area.set({ [KEY]: merged });
}
