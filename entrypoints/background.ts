import * as db from '../src/storage/db';
import { getSettings, saveSettings } from '../src/storage/settings';
import { getTranscriptWithFallback } from '../src/services/transcript';
import { fetchSupadataTranscript } from '../src/adapters/supadata';
import { googleFreeTranslate, runBatchTranslation } from '../src/services/translate';
import { aiSegmentBreakpoints, extractTerms, llmTranslateBatch } from '../src/services/llm-translate';
import { mergeCues, sentencesFromCues, sentencesToParagraphs } from '../src/services/segment';
import { explainConfusion, summarize } from '../src/services/ai';
import { buildFusedMarkdown } from '../src/services/export';
import { handleMessage, type RouterDeps } from '../src/messaging/router';
import type { Msg } from '../src/messaging/protocol';
import type { Cue } from '../src/types';

export default defineBackground(() => {
  // 点击工具栏图标直接打开侧边栏（不依赖 action 弹窗）
  (browser as any).sidePanel?.setPanelBehavior?.({ openPanelOnActionClick: true }).catch?.(() => {});

  // Supadata 兜底（timedtext 直抓已移至 content script 页面上下文）：key 存在才启用兜底通道
  const getTranscriptBound = async (input: any): Promise<{ cues: Cue[]; source: string }> => {
    const s = await getSettings();
    return getTranscriptWithFallback(input, {
      supadata: s.supadataKey ? fetchSupadataTranscript : undefined,
      supadataKey: s.supadataKey || undefined,
    });
  };

  const deps: RouterDeps = {
    ...db, getSettings, saveSettings,
    getTranscriptWithFallback: getTranscriptBound,
    googleFreeTranslate, runBatchTranslation, llmTranslateBatch, extractTerms,
    mergeCues, sentencesFromCues, sentencesToParagraphs, aiSegmentBreakpoints,
    explainConfusion, summarize, buildFusedMarkdown,
    broadcast: (msg) => { browser.runtime.sendMessage(msg).catch(() => {}); },
    sendToActiveTab: (msg) => { browser.tabs.query({ active: true, currentWindow: true }).then(([tab]) => tab && browser.tabs.sendMessage(tab.id!, msg)).catch(() => {}); },
  };

  browser.runtime.onMessage.addListener((msg: Msg, _sender, sendResponse) => {
    handleMessage(msg, deps).then(sendResponse, (e: Error) => sendResponse({ error: e.message }));
    return true; // 异步响应
  });

  // 扩展重载/更新后，已打开页面里的旧 content script 已失联（context invalidated，Chrome 机制）——
  // 主动给所有 YouTube 标签页重注入脚本：跳转/心跳/跟随立刻恢复，无需用户手动刷新页面。
  // WXT 的 content script 自带"新实例停旧实例"机制，重复注入安全。
  browser.runtime.onInstalled.addListener(async () => {
    try {
      const tabs = await browser.tabs.query({ url: 'https://www.youtube.com/*' });
      for (const t of tabs) {
        if (t.id == null) continue;
        browser.scripting.executeScript({ target: { tabId: t.id }, files: ['/content-scripts/content.js'] }).catch(() => {});
      }
      console.info('[video-note] reinjected content scripts into', tabs.length, 'youtube tabs');
    } catch { /* scripting 不可用（老浏览器）：刷新页面仍会注入，功能可恢复 */ }
  });

  // 快捷键：抓取当前片段 → 打开笔记编辑器
  browser.commands?.onCommand.addListener(async (command: string) => {
    if (command !== 'capture-note') return;
    await browser.tabs.query({ active: true, currentWindow: true }).then(([tab]) => tab && browser.tabs.sendMessage(tab.id!, { type: 'CAPTURE_NOW' } as Msg)).catch(() => {});
  });
});
