import * as db from '../src/storage/db';
import { getSettings, saveSettings } from '../src/storage/settings';
import { getTranscriptWithFallback } from '../src/services/transcript';
import { fetchCueTrack } from '../src/adapters/youtube';
import { fetchSupadataTranscript } from '../src/adapters/supadata';
import { googleFreeTranslate, runBatchTranslation } from '../src/services/translate';
import { llmTranslateBatch } from '../src/services/llm-translate';
import { explainConfusion, summarize } from '../src/services/ai';
import { buildFusedMarkdown } from '../src/services/export';
import { handleMessage, type RouterDeps } from '../src/messaging/router';
import type { Msg } from '../src/messaging/protocol';
import type { Cue } from '../src/types';

export default defineBackground(() => {
  // Supadata 兜底：每次调用时读设置，key 存在才启用兜底通道
  const getTranscriptBound = async (input: any): Promise<{ cues: Cue[]; source: string }> => {
    const s = await getSettings();
    return getTranscriptWithFallback(input, {
      fetchTrack: fetchCueTrack,
      supadata: s.supadataKey ? fetchSupadataTranscript : undefined,
      supadataKey: s.supadataKey || undefined,
    });
  };

  const deps: RouterDeps = {
    ...db, getSettings, saveSettings,
    getTranscriptWithFallback: getTranscriptBound,
    googleFreeTranslate, runBatchTranslation, llmTranslateBatch, explainConfusion, summarize, buildFusedMarkdown,
    broadcast: (msg) => { browser.runtime.sendMessage(msg).catch(() => {}); },
    sendToActiveTab: (msg) => { browser.tabs.query({ active: true, currentWindow: true }).then(([tab]) => tab && browser.tabs.sendMessage(tab.id!, msg)).catch(() => {}); },
  };

  browser.runtime.onMessage.addListener((msg: Msg, _sender, sendResponse) => {
    handleMessage(msg, deps).then(sendResponse, (e: Error) => sendResponse({ error: e.message }));
    return true; // 异步响应
  });

  // 快捷键：抓取当前片段 → 打开笔记编辑器
  browser.commands?.onCommand.addListener(async (command: string) => {
    if (command !== 'capture-note') return;
    await browser.tabs.query({ active: true, currentWindow: true }).then(([tab]) => tab && browser.tabs.sendMessage(tab.id!, { type: 'CAPTURE_NOW' } as Msg)).catch(() => {});
  });
});
