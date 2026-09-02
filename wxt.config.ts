import { defineConfig } from 'wxt';

export default defineConfig({
  // 输出到不带点的目录（默认 .output 在 Finder/文件选择框中隐藏，用户加载不便）
  outDir: 'dist',
  manifest: {
    name: 'Video Note',
    // 版本号随功能性修复递增（0.4.0 起）——用户在 chrome://extensions 卡片可核对"新代码是否真的加载了"
    version: '0.4.5',
    description: '看视频做笔记：逐字稿、中英对照、AI 摘要、融合导出',
    permissions: ['sidePanel', 'storage', 'commands', 'tabs'],
    host_permissions: ['https://www.youtube.com/*', 'https://api.supadata.ai/*', 'https://translate.googleapis.com/*'],
    optional_host_permissions: ['https://*/*'], // 用户自定义 LLM base URL
    commands: {
      'capture-note': { suggested_key: { default: 'Alt+N' }, description: '截取当前片段记笔记' },
    },
    side_panel: { default_path: 'sidepanel.html' },
    // content_scripts 由 entrypoints/content.ts 的 defineContentScript({ matches: ['https://www.youtube.com/*'] })
    // 自动生成（js 路径 content-scripts/content.js）；此处手写会与之合并出重复条目、导致双重注入
  },
});
