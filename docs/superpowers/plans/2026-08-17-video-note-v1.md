# Video Note V1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Chrome/Edge MV3 侧边栏插件：看 YouTube 教程时获取带时间戳逐字稿（中英对照），对片段做笔记（有价值/有疑惑），AI 解释疑惑、AI 摘要，融合导出 Obsidian Markdown。

**Architecture:** WXT 框架，四层——content script（页面信息/播放控制）、side panel（Preact UI）、background service worker（消息路由 + 服务编排）、IndexedDB 存储。逐字稿双通道（YouTube 直抓→Supadata 兜底），翻译双通道（Google 免费端点→LLM 升级），AI 服务走 OpenAI 兼容 LLM。

**Tech Stack:** WXT + TypeScript + Preact + @preact/signals、idb（IndexedDB）、Vitest + @testing-library/preact + fake-indexeddb。

**Spec:** `docs/superpowers/specs/2026-08-17-video-note-design.md`

## Global Constraints

- 平台：Chrome/Edge MV3；浏览器最低 Chrome 114（sidePanel API）
- 所有第三方 key（LLM、Supadata）仅存 `chrome.storage.local`，禁止硬编码、禁止打日志
- 翻译/AI 请求需 `host_permissions`：`https://www.youtube.com/*`、`https://api.supadata.ai/*`、`https://translate.googleapis.com/*`、用户配置的 LLM base URL（可选权限 `https://*/*`）
- 注释中文；代码/标识符英文
- 每个任务以 commit 结束；测试框架 Vitest，colocate（`src/**/*.test.ts`）
- UI 文案中文

---

### Task 1: WXT + Preact 脚手架与 Vitest

**Files:**
- Create: `package.json`, `wxt.config.ts`, `tsconfig.json`, `vitest.config.ts`, `src/utils/time.ts`, `src/utils/time.test.ts`, `.gitignore`

**Interfaces:**
- Produces: 可运行的 WXT 项目；`formatTime(sec: number): string`（`95.2 → "01:35"`，支持超 1 小时 `HH:MM:SS`）、`tsLink(videoId: string, sec: number): string`（YouTube 跳转链接）

- [ ] **Step 1: 初始化 WXT 项目（preact 模板）**

```bash
cd /Users/monical/Documents/project/chajian/video-note
npm dlx wxt@latest init . -t preact -p npm --no-git -f
```

若交互卡住则手动创建：`package.json`（deps: `wxt`, `preact`, `@preact/signals`, `idb`; devDeps: `typescript`, `vitest`, `jsdom`, `@testing-library/preact`, `fake-indexeddb`, `@types/bun`? 无需）后 `npm install`。

- [ ] **Step 2: 安装额外依赖**

```bash
npm i preact @preact/signals idb linkedom && npm i -D vitest jsdom @testing-library/preact fake-indexeddb
```

（`linkedom`：node 测试环境的 DOMParser，供 timedtext XML 解析用）

- [ ] **Step 3: 写 `wxt.config.ts`**

```ts
import { defineConfig } from 'wxt';

export default defineConfig({
  manifest: {
    name: 'Video Note',
    description: '看视频做笔记：逐字稿、中英对照、AI 摘要、融合导出',
    permissions: ['sidePanel', 'storage', 'commands'],
    host_permissions: ['https://www.youtube.com/*', 'https://api.supadata.ai/*', 'https://translate.googleapis.com/*'],
    optional_host_permissions: ['https://*/*'], // 用户自定义 LLM base URL
    commands: {
      'capture-note': { suggested_key: { default: 'Ctrl+Shift+N' }, description: '截取当前片段记笔记' },
    },
    side_panel: { default_path: 'sidepanel.html' },
    content_scripts: [{ matches: ['https://www.youtube.com/*'], js: ['content-scripts/content.js'] }],
  },
});
```

- [ ] **Step 4: 写 `vitest.config.ts`**

```ts
import { defineConfig } from 'vitest/config';
export default defineConfig({
  test: { environment: 'node', include: ['src/**/*.test.ts', 'src/**/*.test.tsx'] },
});
```

（组件测试文件首行加 `// @vitest-environment jsdom`）

- [ ] **Step 5: 写失败测试 `src/utils/time.test.ts`**

```ts
import { describe, expect, it } from 'vitest';
import { formatTime, tsLink } from './time';

describe('formatTime', () => {
  it('秒数转 mm:ss', () => expect(formatTime(95.2)).toBe('01:35'));
  it('零', () => expect(formatTime(0)).toBe('00:00'));
  it('超一小时转 h:mm:ss', () => expect(formatTime(3725)).toBe('1:02:05'));
});

describe('tsLink', () => {
  it('生成带时间参数的跳转链接', () =>
    expect(tsLink('abc123', 95)).toBe('https://www.youtube.com/watch?v=abc123&t=95s'));
});
```

- [ ] **Step 6: 运行确认失败**：`npx vitest run src/utils/time.test.ts` → FAIL（模块不存在）

- [ ] **Step 7: 实现 `src/utils/time.ts`**

```ts
/** 秒 → "mm:ss"（<1h）或 "h:mm:ss" */
export function formatTime(sec: number): string {
  const s = Math.floor(sec);
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), r = s % 60;
  const mm = String(m).padStart(2, '0'), ss = String(r).padStart(2, '0');
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

/** YouTube 时间戳跳转链接 */
export const tsLink = (videoId: string, sec: number): string =>
  `https://www.youtube.com/watch?v=${videoId}&t=${Math.floor(sec)}s`;
```

- [ ] **Step 8: 运行确认通过**：`npx vitest run` → 全部 PASS

- [ ] **Step 9: 验证 WXT 构建**：`npm run build` → `.output/chrome-mv3/` 生成 manifest.json

- [ ] **Step 10: Commit**

```bash
git add -A && git commit -m "chore: WXT+Preact 脚手架、Vitest、时间工具函数"
```

---

### Task 2: 领域类型定义

**Files:**
- Create: `src/types.ts`

**Interfaces:**
- Produces（后续所有任务依赖）:

```ts
export interface Cue { start: number; dur: number; text: string; zh?: string; }        // 秒
export type DisplayMode = 'bilingual' | 'zh' | 'en';
export type NoteType = 'value' | 'confusion';
export interface Note {
  id: string; videoId: string; start: number; end: number;
  excerpt: string;           // 原文摘录（英文）
  annotation: string;        // 用户批注
  type: NoteType;
  aiExplanation?: string;    // 疑惑的 AI 解释（可编辑）
  createdAt: number;
}
export interface VideoMeta {
  videoId: string; title: string; channel: string; url: string;
  captionLang: string; fetchedAt: number;
}
export interface SummarySection { start: number; title: string; points: string[]; }
export interface Summary {
  videoId: string; oneLiner: string;
  sections: SummarySection[];
  knowledge: { term: string; desc: string }[];
  prerequisites: string[];
  model: string; generatedAt: number;
}
export interface LlmConfig { baseUrl: string; apiKey: string; model: string; }
export interface Settings {
  displayMode: DisplayMode;
  translateChannel: 'free' | 'llm';
  llm: LlmConfig | null;        // null = 未配置
  supadataKey: string;           // '' = 未配置
  polishEnabled: boolean;        // LLM 纠错润色开关
}
```

- [ ] **Step 1: 创建 `src/types.ts`**（内容如上，逐字写入）
- [ ] **Step 2: 类型检查通过**：`npx tsc --noEmit` → 0 errors
- [ ] **Step 3: Commit**：`git add -A && git commit -m "feat: 领域类型定义"`

---

### Task 3: 存储层（IndexedDB + 设置）

**Files:**
- Create: `src/storage/db.ts`, `src/storage/db.test.ts`, `src/storage/settings.ts`, `src/storage/settings.test.ts`

**Interfaces:**
- Consumes: `src/types.ts`
- Produces:
  - `saveVideo(meta: VideoMeta): Promise<void>`、`getVideo(videoId): Promise<VideoMeta | undefined>`
  - `saveTranscript(videoId: string, cues: Cue[]): Promise<void>`、`getTranscript(videoId): Promise<Cue[] | undefined>`
  - `addNote(note: Note): Promise<void>`、`updateNote(note: Note): Promise<void>`、`deleteNote(id: string): Promise<void>`、`getNotesByVideo(videoId): Promise<Note[]>`（按 start 升序）、`listVideosWithNotes(): Promise<{ video: VideoMeta; noteCount: number; lastAt: number }[]>`（按 lastAt 倒序）
  - `saveSummary(s: Summary)`、`getSummary(videoId): Promise<Summary | undefined>`
  - `getSettings(storage?: SettingsArea): Promise<Settings>`（合并默认值）、`saveSettings(patch: Partial<Settings>, storage?): Promise<void>`；`SettingsArea = { get(k: string): Promise<any>; set(obj: Record<string, any>): Promise<void> }`

- [ ] **Step 1: 写失败测试 `src/storage/db.test.ts`**

```ts
import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { describe, expect, it, beforeEach } from 'vitest';
import { addNote, getNotesByVideo, listVideosWithNotes, resetDbForTest, saveVideo, saveTranscript, getTranscript } from './db';
import type { Note, VideoMeta } from '../types';

const v: VideoMeta = { videoId: 'v1', title: 'T', channel: 'C', url: 'u', captionLang: 'en', fetchedAt: 1 };

beforeEach(async () => {
  await resetDbForTest(); // 关闭旧连接并删库，fake-indexeddb 重新开
});

```

（若 fake-indexeddb 的 IDBFactory 隔离方式不适配 idb 缓存连接，改为 `resetDbForTest()` 内部 `indexedDB.deleteDatabase('video-note')` 并重新 `openDB`。以能让测试稳定为准，实现时固定一种。）

```ts
it('笔记按视频隔离且按时间排序', async () => {
  await saveVideo(v);
  const n2: Note = { id: 'b', videoId: 'v1', start: 20, end: 25, excerpt: 'e2', annotation: 'a', type: 'value', createdAt: 2 };
  const n1: Note = { id: 'a', videoId: 'v1', start: 10, end: 15, excerpt: 'e1', annotation: 'a', type: 'confusion', createdAt: 1 };
  await addNote(n2); await addNote(n1);
  expect((await getNotesByVideo('v1')).map((n) => n.id)).toEqual(['a', 'b']);
  expect(await getNotesByVideo('other')).toEqual([]);
});

it('listVideosWithNotes 返回条数与最近时间且倒序', async () => {
  await saveVideo(v);
  await saveVideo({ ...v, videoId: 'v2' });
  await addNote({ id: 'x', videoId: 'v1', start: 1, end: 2, excerpt: '', annotation: '', type: 'value', createdAt: 99 } as Note);
  await addNote({ id: 'y', videoId: 'v2', start: 1, end: 2, excerpt: '', annotation: '', type: 'value', createdAt: 5 } as Note);
  const rows = await listVideosWithNotes();
  expect(rows.map((r) => r.video.videoId)).toEqual(['v1', 'v2']);
  expect(rows[0]).toMatchObject({ noteCount: 1, lastAt: 99 });
});

it('逐字稿整存整取', async () => {
  await saveTranscript('v1', [{ start: 0, dur: 2, text: 'hi', zh: '你好' }]);
  expect((await getTranscript('v1'))?.[0].zh).toBe('你好');
});
```

- [ ] **Step 2: 运行确认失败**：`npx vitest run src/storage` → FAIL

- [ ] **Step 3: 实现 `src/storage/db.ts`**

```ts
import { openDB, type IDBPDatabase } from 'idb';
import type { Cue, Note, Summary, VideoMeta } from '../types';

const DB_NAME = 'video-note', DB_VERSION = 1;
let dbp: Promise<IDBPDatabase> | null = null;

function db() {
  dbp ??= openDB(DB_NAME, DB_VERSION, {
    upgrade(d) {
      d.createObjectStore('videos', { keyPath: 'videoId' });
      d.createObjectStore('transcripts');
      const notes = d.createObjectStore('notes', { keyPath: 'id' });
      notes.createIndex('byVideo', 'videoId');
      notes.createIndex('byCreated', 'createdAt');
      d.createObjectStore('summaries', { keyPath: 'videoId' });
    },
  });
  return dbp;
}

export async function resetDbForTest() { // 测试隔离用
  dbp = null;
  indexedDB.deleteDatabase(DB_NAME);
}

export const saveVideo = (m: VideoMeta) => db().then((d) => d.put('videos', m));
export const getVideo = (videoId: string) => db().then((d) => d.get<VideoMeta>('videos', videoId));
export const saveTranscript = (videoId: string, cues: Cue[]) => db().then((d) => d.put('transcripts', cues, videoId));
export const getTranscript = (videoId: string) => db().then((d) => d.get<Cue[]>('transcripts', videoId));

export const addNote = (n: Note) => db().then((d) => d.put('notes', n));
export const updateNote = addNote;
export const deleteNote = (id: string) => db().then((d) => d.delete('notes', id));

export async function getNotesByVideo(videoId: string): Promise<Note[]> {
  const d = await db();
  const all = await d.getAllFromIndex('notes', 'byVideo', videoId);
  return all.sort((a, b) => a.start - b.start);
}

export async function listVideosWithNotes() {
  const d = await db();
  const notes = (await d.getAll('notes')) as Note[];
  const byVideo = new Map<string, Note[]>();
  for (const n of notes) byVideo.set(n.videoId, [...(byVideo.get(n.videoId) ?? []), n]);
  const rows = await Promise.all(
    [...byVideo.keys()].map(async (videoId) => {
      const ns = byVideo.get(videoId)!;
      return { video: (await d.get<VideoMeta>('videos', videoId))!, noteCount: ns.length, lastAt: Math.max(...ns.map((n) => n.createdAt)) };
    }),
  );
  return rows.filter((r) => r.video).sort((a, b) => b.lastAt - a.lastAt);
}

export const saveSummary = (s: Summary) => db().then((d) => d.put('summaries', s));
export const getSummary = (videoId: string) => db().then((d) => d.get<Summary>('summaries', videoId));
```

- [ ] **Step 4: 写失败测试 `src/storage/settings.test.ts`**

```ts
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
```

- [ ] **Step 5: 实现 `src/storage/settings.ts`**

```ts
import type { Settings } from '../types';

export interface SettingsArea { get(key: string): Promise<any>; set(obj: Record<string, any>): Promise<void>; }
const KEY = 'vn-settings';
export const DEFAULT_SETTINGS: Settings = {
  displayMode: 'bilingual', translateChannel: 'free', llm: null, supadataKey: '', polishEnabled: false,
};

/** area 缺省时用 chrome.storage.local（浏览器环境） */
const defaultArea = (): SettingsArea =>
  typeof chrome !== 'undefined' && chrome.storage?.local
    ? { get: (k) => chrome.storage.local.get(k).then((o) => o[k]), set: (o) => chrome.storage.local.set(o) }
    : memFallback();

function memFallback(): SettingsArea {
  const m = new Map<string, any>();
  return { get: async (k) => m.get(k), set: async (o) => { for (const [k, v] of Object.entries(o)) m.set(k, v); } };
}

export async function getSettings(area: SettingsArea = defaultArea()): Promise<Settings> {
  const saved = (await area.get(KEY)) ?? {};
  return { ...DEFAULT_SETTINGS, ...saved };
}

export async function saveSettings(patch: Partial<Settings>, area: SettingsArea = defaultArea()) {
  const merged = { ...(await getSettings(area)), ...patch };
  await area.set({ [KEY]: merged });
}
```

- [ ] **Step 6: 运行测试通过**：`npx vitest run src/storage` → PASS
- [ ] **Step 7: Commit**：`git add -A && git commit -m "feat: IndexedDB 存储层与设置存储"`

---

### Task 4: 逐字稿获取（解析 + 双通道）

**Files:**
- Create: `src/adapters/timedtext.ts`, `src/adapters/timedtext.test.ts`, `src/adapters/youtube.ts`, `src/adapters/supadata.ts`, `src/adapters/supadata.test.ts`, `src/services/transcript.ts`, `src/services/transcript.test.ts`

**Interfaces:**
- Consumes: `Cue`, `VideoMeta`, `Settings`；Task 3 的 `getSettings`
- Produces:
  - `parseJson3(json: any): Cue[]`、`parseTimedtextXml(xml: string): Cue[]`（纯函数）
  - `extractCaptionTracks(html: string): { baseUrl: string; lang: string; kind: string }[]`、`extractVideoMeta(html: string, url: string): { videoId: string; title: string; channel: string }`（纯函数，供 content script 用）
  - `fetchCueTrack(baseUrl: string): Promise<Cue[]>`（background 用，fetch baseUrl + `&fmt=json3`，失败回退 XML）
  - `fetchSupadataTranscript(videoId: string, apiKey: string): Promise<Cue[]>`
  - `getTranscriptWithFallback(input: { videoId: string; tracks: { baseUrl: string }[] } ): Promise<{ cues: Cue[]; source: 'youtube' | 'supadata' }>`——tracks 为空或全失败且配置了 Supadata key 时走兜底

- [ ] **Step 1: 写失败测试 `src/adapters/timedtext.test.ts`**

```ts
import { describe, expect, it } from 'vitest';
import { parseJson3, parseTimedtextXml } from './timedtext';

it('解析 json3：合并 segs、过滤空段、ms→s', () => {
  const cues = parseJson3({ events: [
    { tStartMs: 1000, dDurationMs: 2000, segs: [{ utf8: 'hello ' }, { utf8: 'world' }] },
    { tStartMs: 3500, dDurationMs: 1500, segs: [{ utf8: '\n' }] }, // 纯换行段丢弃
    { tStartMs: 3500, dDurationMs: 1500, segs: [{ utf8: 'next' }] },
  ] });
  expect(cues).toEqual([
    { start: 1, dur: 2, text: 'hello world' },
    { start: 3.5, dur: 1.5, text: 'next' },
  ]);
});

it('解析 XML：解转义、start/dur 字符串转数字', () => {
  const xml = `<transcript><text start="12.28" dur="2.4">a &amp; b &lt;tag&gt;</text></transcript>`;
  expect(parseTimedtextXml(xml)).toEqual([{ start: 12.28, dur: 2.4, text: 'a & b <tag>' }]);
});
```

- [ ] **Step 2: 实现 `src/adapters/timedtext.ts`**

```ts
import { DOMParser } from 'linkedom';
import type { Cue } from '../types';

/** YouTube json3 格式 → Cue[] */
export function parseJson3(json: any): Cue[] {
  const out: Cue[] = [];
  for (const ev of json?.events ?? []) {
    const text = (ev.segs ?? []).map((s: any) => s.utf8 ?? '').join('').trim();
    if (!text) continue;
    out.push({ start: ev.tStartMs / 1000, dur: (ev.dDurationMs ?? 0) / 1000, text });
  }
  return out;
}

const ENTITIES: Record<string, string> = { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'", '&apos;': "'", '&#39': "'" };

/** YouTube timedtext XML → Cue[] */
export function parseTimedtextXml(xml: string): Cue[] {
  const doc = new DOMParser().parseFromString(xml, 'text/xml');
  return [...doc.getElementsByTagName('text')]
    .map((t) => ({
      start: Number(t.getAttribute('start')),
      dur: Number(t.getAttribute('dur') ?? 0),
      text: (t.textContent ?? '').replace(/&#39;?|&\w+;/g, (e) => ENTITIES[e] ?? e).trim(),
    }))
    .filter((c) => c.text);
}
```

- [ ] **Step 3: 实现 `src/adapters/youtube.ts`**（纯提取 + fetch）

```ts
import type { Cue } from '../types';
import { parseJson3, parseTimedtextXml } from './timedtext';

export interface CaptionTrack { baseUrl: string; lang: string; kind: string } // kind: 'asr'=自动 | ''=手动

/** 从 watch 页 HTML 提取 caption 轨道列表（content script 同域 fetch 后调用） */
export function extractCaptionTracks(html: string): CaptionTrack[] {
  const m = html.match(/ytInitialPlayerResponse\s*=\s*(\{.+?\})\s*;/s);
  if (!m) return [];
  try {
    const pr = JSON.parse(m[1]);
    const list = pr?.captions?.playerCaptionsTracklistRenderer?.captionTracks ?? [];
    return list.map((t: any) => ({ baseUrl: t.baseUrl, lang: t.languageCode, kind: t.kind ?? '' }));
  } catch { return []; }
}

/** 从 watch 页 HTML 提取视频元信息 */
export function extractVideoMeta(html: string, url: string): { videoId: string; title: string; channel: string } {
  const m = html.match(/ytInitialPlayerResponse\s*=\s*(\{.+?\})\s*;/s);
  const pr = m ? JSON.parse(m[1]) : {};
  const videoId = pr?.videoDetails?.videoId ?? new URL(url).searchParams.get('v') ?? '';
  return { videoId, title: pr?.videoDetails?.title ?? document.title, channel: pr?.videoDetails?.author ?? '' };
}

/** 抓取字幕内容：json3 优先，XML 兜底（background 中执行，需 host_permissions） */
export async function fetchCueTrack(baseUrl: string): Promise<Cue[]> {
  const res = await fetch(`${baseUrl}&fmt=json3`);
  if (res.ok) {
    const cues = parseJson3(await res.json());
    if (cues.length) return cues;
  }
  const xmlRes = await fetch(baseUrl);
  if (!xmlRes.ok) throw new Error(`timedtext ${xmlRes.status}`);
  return parseTimedtextXml(await xmlRes.text());
}
```

- [ ] **Step 4: 写失败测试并实现 `src/adapters/supadata.ts`**

测试（mock 全局 fetch）：

```ts
import { describe, expect, it, vi, afterEach } from 'vitest';
import { fetchSupadataTranscript } from './supadata';

afterEach(() => vi.unstubAllGlobals());

it('换算 offset/duration 毫秒→秒并透传文本', async () => {
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: any) => {
    expect(url).toContain('api.supadata.ai/v1/youtube/transcript');
    expect(init.headers['x-api-key']).toBe('sk-test');
    return { ok: true, json: async () => ({ content: [{ text: 'hello', offset: 1000, duration: 2000 }] }) } as any;
  }));
  expect(await fetchSupadataTranscript('v1', 'sk-test')).toEqual([{ start: 1, dur: 2, text: 'hello' }]);
});

it('非 2xx 抛错', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 402, text: async () => 'quota' }) as any));
  await expect(fetchSupadataTranscript('v1', 'sk')).rejects.toThrow('Supadata 402');
});
```

实现：

```ts
import type { Cue } from '../types';

/** Supadata 逐字稿 API（无字幕视频由其 Whisper 生成） */
export async function fetchSupadataTranscript(videoId: string, apiKey: string): Promise<Cue[]> {
  const url = `https://api.supadata.ai/v1/youtube/transcript?url=https://www.youtube.com/watch?v=${videoId}&lang=en`;
  const res = await fetch(url, { headers: { 'x-api-key': apiKey } });
  if (!res.ok) throw new Error(`Supadata ${res.status}: ${await res.text()}`);
  const data = await res.json();
  return (data.content ?? []).map((c: any) => ({ start: c.offset / 1000, dur: (c.duration ?? 0) / 1000, text: String(c.text).trim() }));
}
```

- [ ] **Step 5: 写失败测试并实现 `src/services/transcript.ts`**（双通道编排）

测试：

```ts
import { describe, expect, it, vi } from 'vitest';
import { getTranscriptWithFallback } from './transcript';

it('直抓成功不走 Supadata', async () => {
  const fetchTrack = vi.fn(async () => [{ start: 0, dur: 1, text: 'a' }]);
  const supadata = vi.fn();
  const r = await getTranscriptWithFallback({ videoId: 'v', tracks: [{ baseUrl: 'u' }] }, { fetchTrack, supadata });
  expect(r.source).toBe('youtube'); expect(supadata).not.toHaveBeenCalled();
});

it('无轨道且配置 Supadata 时走兜底', async () => {
  const supadata = vi.fn(async () => [{ start: 0, dur: 1, text: 'x' }]);
  const r = await getTranscriptWithFallback({ videoId: 'v', tracks: [] }, { supadata, supadataKey: 'sk' });
  expect(r.source).toBe('supadata');
});

it('两通道都失败抛出明确错误', async () => {
  const fetchTrack = vi.fn(async () => { throw new Error('x'); });
  await expect(
    getTranscriptWithFallback({ videoId: 'v', tracks: [{ baseUrl: 'u' }] }, { fetchTrack, supadata: undefined, supadataKey: '' }),
  ).rejects.toThrow('该视频无可用字幕');
});
```

实现：

```ts
import type { Cue } from '../types';
import type { CaptionTrack } from '../adapters/youtube';

export interface TranscriptDeps {
  fetchTrack?: (baseUrl: string) => Promise<Cue[]>;
  supadata?: (videoId: string, key: string) => Promise<Cue[]>;
  supadataKey?: string;
}

/** 直抓优先（手动字幕优先于 asr），无字幕/全失败时 Supadata 兜底 */
export async function getTranscriptWithFallback(
  input: { videoId: string; tracks: CaptionTrack[] },
  deps: TranscriptDeps = {},
): Promise<{ cues: Cue[]; source: 'youtube' | 'supadata' }> {
  const fetchTrack = deps.fetchTrack ?? (async () => { throw new Error('no fetch'); });
  const sorted = [...input.tracks].sort((a, b) => (a.kind === 'asr' ? 1 : 0) - (b.kind === 'asr' ? 1 : 0));
  for (const t of sorted) {
    try {
      const cues = await fetchTrack(t.baseUrl);
      if (cues.length) return { cues, source: 'youtube' };
    } catch { /* 尝试下一轨道 */ }
  }
  if (deps.supadata && deps.supadataKey) {
    const cues = await deps.supadata(input.videoId, deps.supadataKey);
    if (cues.length) return { cues, source: 'supadata' };
  }
  throw new Error('该视频无可用字幕（直抓失败且未配置/未成功调用 Supadata）');
}
```

- [ ] **Step 6: 运行全部通过**：`npx vitest run src/adapters src/services` → PASS
- [ ] **Step 7: Commit**：`git add -A && git commit -m "feat: 逐字稿双通道（timedtext 解析 + Supadata 兜底）"`

---

### Task 5: 翻译服务（免费通道 + 批量调度器）

**Files:**
- Create: `src/services/translate.ts`, `src/services/translate.test.ts`

**Interfaces:**
- Consumes: `Cue`, `Settings`
- Produces:
  - `googleFreeTranslate(text: string): Promise<string>`（translate.googleapis.com 免费端点，en→zh-CN）
  - `runBatchTranslation(cues: Cue[], fn: (text: string) => Promise<string>, opts: { concurrency: number; onProgress?: (done: number, total: number) => void }): Promise<{ translated: Cue[]; failed: number }>`——不修改入参，返回带 `zh` 的副本；单句失败不中断，计入 failed

- [ ] **Step 1: 写失败测试**

```ts
import { describe, expect, it, vi } from 'vitest';
import { runBatchTranslation, googleFreeTranslate } from './translate';

it('调度器并发执行、写入 zh、统计失败', async () => {
  const cues = Array.from({ length: 10 }, (_, i) => ({ start: i, dur: 1, text: `t${i}` }));
  const fn = vi.fn(async (t: string) => (t === 't3' ? Promise.reject(new Error('rate')) : `译-${t}`));
  const progress: number[] = [];
  const r = await runBatchTranslation(cues, fn, { concurrency: 3, onProgress: (d, total) => progress.push(d) });
  expect(r.translated[3].zh).toBeUndefined();      // 失败句无译文
  expect(r.translated[0].zh).toBe('译-t0');
  expect(r.failed).toBe(1);
  expect(progress.at(-1)).toBe(10);
});

it('googleFreeTranslate 拼接响应片段', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => [[[null, '你'], [null, '好']], null, 'en'] }) as any));
  expect(await googleFreeTranslate('hello')).toBe('你好');
  vi.unstubAllGlobals();
});
```

- [ ] **Step 2: 实现 `src/services/translate.ts`**

```ts
import type { Cue } from '../types';

/** Google 翻译免费端点（translate_a/single），en→zh-CN */
export async function googleFreeTranslate(text: string): Promise<string> {
  const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=en&tl=zh-CN&dt=t&q=${encodeURIComponent(text)}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`translate ${res.status}`);
  const data = await res.json();
  return (data[0] ?? []).map((seg: any[]) => seg[0] ?? '').join('');
}

/** 并发调度翻译整篇字幕：单句失败不中断，连续失败自动降速（限流退避） */
export async function runBatchTranslation(
  cues: Cue[],
  fn: (text: string) => Promise<string>,
  opts: { concurrency: number; onProgress?: (done: number, total: number) => void },
): Promise<{ translated: Cue[]; failed: number }> {
  const out = cues.map((c) => ({ ...c }));
  let idx = 0, done = 0, failed = 0, backoff = 0;
  const total = cues.length;
  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
  const worker = async () => {
    while (idx < total) {
      const i = idx++;
      try {
        out[i].zh = await fn(cues[i].text);
        backoff = Math.max(0, backoff - 1); // 成功则逐步恢复速度
      } catch {
        failed++;
        backoff = Math.min(backoff + 1, 5); // 连续失败降速：指数退避上限 1.6s
      }
      if (backoff > 0) await sleep(50 * 2 ** backoff);
      done++;
      opts.onProgress?.(done, total);
    }
  };
  await Promise.all(Array.from({ length: Math.min(opts.concurrency, total) }, worker));
  return { translated: out, failed };
}
```

- [ ] **Step 3: 运行通过**：`npx vitest run src/services/translate.test.ts`
- [ ] **Step 4: Commit**：`git add -A && git commit -m "feat: 免费翻译通道与并发批量调度器"`

---

### Task 6: LLM 客户端 + LLM 翻译 + 纠错润色

**Files:**
- Create: `src/services/llm.ts`, `src/services/llm.test.ts`, `src/services/llm-translate.ts`, `src/services/llm-translate.test.ts`

**Interfaces:**
- Consumes: `LlmConfig`, `Cue`
- Produces:
  - `chat(config: LlmConfig, messages: { role: string; content: string }[], opts?: { temperature?: number }): Promise<string>`（OpenAI 兼容 `POST {baseUrl}/chat/completions`；`baseUrl` 形如 `https://api.openai.com/v1`）
  - `chatJson<T>(config, messages): Promise<T>`（剥离 ```json 围栏后 JSON.parse，失败 throw）
  - `llmTranslateBatch(config: LlmConfig, texts: string[]): Promise<string[]>`（批量编号翻译，返回与输入等长数组；解析失败或长度不符时重试 1 次，再失败 throw）
  - `polishTranscript(config: LlmConfig, cues: Cue[]): Promise<Cue[]>`（修正专有名词/标点断句，保留全部时间戳与条数，仅改 text）

- [ ] **Step 1: 写失败测试 `src/services/llm.test.ts`**

```ts
import { describe, expect, it, vi, afterEach } from 'vitest';
import { chat, chatJson } from './llm';

afterEach(() => vi.unstubAllGlobals());
const cfg = { baseUrl: 'https://api.x.com/v1', apiKey: 'k', model: 'm' };

it('chat 发送 OpenAI 兼容请求并取回内容', async () => {
  vi.stubGlobal('fetch', vi.fn(async (url: string, init: any) => {
    expect(url).toBe('https://api.x.com/v1/chat/completions');
    const body = JSON.parse(init.body);
    expect(body.model).toBe('m'); expect(body.messages[0].role).toBe('user');
    expect(init.headers.Authorization).toBe('Bearer k');
    return { ok: true, json: async () => ({ choices: [{ message: { content: 'hi' } }] }) } as any;
  }));
  expect(await chat(cfg, [{ role: 'user', content: 'x' }])).toBe('hi');
});

it('chatJson 剥离代码围栏', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ choices: [{ message: { content: '```json\n{"a":1}\n```' } }] }) } as any));
  expect(await chatJson(cfg, [])).toEqual({ a: 1 });
});
```

- [ ] **Step 2: 实现 `src/services/llm.ts`**

```ts
import type { LlmConfig } from '../types';

/** OpenAI 兼容 chat/completions（key 仅从设置读取，不落日志） */
export async function chat(
  config: LlmConfig,
  messages: { role: string; content: string }[],
  opts: { temperature?: number } = {},
): Promise<string> {
  const res = await fetch(`${config.baseUrl.replace(/\/$/, '')}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${config.apiKey}` },
    body: JSON.stringify({ model: config.model, messages, temperature: opts.temperature ?? 0 }),
  });
  if (!res.ok) throw new Error(`LLM ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const data = await res.json();
  return data.choices?.[0]?.message?.content ?? '';
}

/** 要求模型返回 JSON 并可靠解析 */
export async function chatJson<T>(config: LlmConfig, messages: { role: string; content: string }[]): Promise<T> {
  const raw = await chat(config, [...messages, { role: 'system', content: '只输出 JSON，不要输出其他内容。' }]);
  const stripped = raw.replace(/^```(?:json)?\s*/m, '').replace(/\s*```\s*$/m, '').trim();
  return JSON.parse(stripped) as T;
}
```

- [ ] **Step 3: 写失败测试并实现 `src/services/llm-translate.ts`**

测试：

```ts
import { describe, expect, it, vi, afterEach } from 'vitest';
import { llmTranslateBatch, polishTranscript } from './llm-translate';

afterEach(() => vi.unstubAllGlobals());
const cfg = { baseUrl: 'https://x/v1', apiKey: 'k', model: 'm' };
const stub = (payload: any) =>
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ choices: [{ message: { content: JSON.stringify(payload) } }] }) } as any));

it('批量翻译：按编号对齐返回', async () => {
  stub({ t: ['译1', '译2'] });
  expect(await llmTranslateBatch(cfg, ['a', 'b'])).toEqual(['译1', '译2']);
});

it('润色：仅改文本，时间戳与条数不变', async () => {
  stub({ lines: ['Hello, world.', 'Closure captures state.'] });
  const cues = [{ start: 1, dur: 1, text: 'hello world' }, { start: 2, dur: 1, text: 'closure capture state' }];
  const out = await polishTranscript(cfg, cues);
  expect(out.map((c) => c.text)).toEqual(['Hello, world.', 'Closure captures state.']);
  expect(out.map((c) => c.start)).toEqual([1, 2]);
});
```

实现：

```ts
import type { Cue, LlmConfig } from '../types';
import { chatJson } from './llm';

/** LLM 批量翻译：编号对齐，长度不符自动重试一次 */
export async function llmTranslateBatch(config: LlmConfig, texts: string[]): Promise<string[]> {
  const numbered = texts.map((t, i) => `${i + 1}. ${t}`).join('\n');
  const messages = [
    { role: 'system', content: '你是专业技术翻译。把用户给出的编号英文句子逐句翻译成简体中文，技术术语首次出现时在括号内保留英文。输出 JSON：{"t":["第一句译文","第二句译文",...]}，数组长度必须等于输入句数，顺序一致。' },
    { role: 'user', content: numbered },
  ];
  for (let attempt = 0; attempt < 2; attempt++) {
    const r = await chatJson<{ t: string[] }>(config, messages);
    if (Array.isArray(r.t) && r.t.length === texts.length) return r.t.map(String);
  }
  throw new Error('LLM 翻译返回长度不符');
}

/** LLM 纠错润色：修正字幕专有名词/标点，时间戳不变 */
export async function polishTranscript(config: LlmConfig, cues: Cue[]): Promise<Cue[]> {
  const r = await chatJson<{ lines: string[] }>(config, [
    { role: 'system', content: '以下是语音识别字幕，存在专有名词拼写与标点问题。逐条修正：补标点、修正术语拼写、不改写含义、不合并不拆分。输出 JSON：{"lines":["...", ...]}，长度与输入严格相等。' },
    { role: 'user', content: JSON.stringify(cues.map((c) => c.text)) },
  ]);
  if (r.lines.length !== cues.length) throw new Error('润色返回长度不符');
  return cues.map((c, i) => ({ ...c, text: r.lines[i] }));
}
```

- [ ] **Step 4: 运行通过**：`npx vitest run src/services/llm`
- [ ] **Step 5: Commit**：`git add -A && git commit -m "feat: OpenAI 兼容 LLM 客户端、批量翻译与字幕纠错润色"`

---

### Task 7: AI 服务（疑惑解释 + 摘要 map-reduce）

**Files:**
- Create: `src/services/ai.ts`, `src/services/ai.test.ts`

**Interfaces:**
- Consumes: `chat`（Task 6）、`Cue`, `Summary`, `LlmConfig`
- Produces:
  - `chunkTranscript(cues: Cue[], maxChars: number): Cue[][]`（纯函数，按累计文本长度切块，不切断单条）
  - `explainConfusion(config: LlmConfig, contextCues: Cue[]): Promise<string>`——contextCues 为疑惑点前后字幕（含疑惑摘录），返回中文解释
  - `summarize(config: LlmConfig, video: { videoId: string; title: string }, cues: Cue[]): Promise<Summary>`——单块直接生成；多块 map（每块出要点）→ reduce（汇总成结构化 Summary）

- [ ] **Step 1: 写失败测试**

```ts
import { describe, expect, it, vi, afterEach } from 'vitest';
import { chunkTranscript, explainConfusion, summarize } from './ai';

it('chunkTranscript 不切断单条且不超限', () => {
  const cues = Array.from({ length: 50 }, (_, i) => ({ start: i, dur: 1, text: 'x'.repeat(30) }));
  const chunks = chunkTranscript(cues, 100);
  expect(chunks.length).toBeGreaterThan(1);
  for (const ch of chunks) expect(ch.reduce((n, c) => n + c.text.length, 0)).toBeLessThanOrEqual(100 + 30);
  expect(chunks.flat().length).toBe(50);
});

const cfg = { baseUrl: 'https://x/v1', apiKey: 'k', model: 'gpt-x' };
const stubJson = (payload: any) =>
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ choices: [{ message: { content: JSON.stringify(payload) } }] }) } as any)));
afterEach(() => vi.unstubAllGlobals());

it('explainConfusion 返回中文解释', async () => {
  stubJson({ explanation: '闭包是函数与其词法环境的组合。' });
  const r = await explainConfusion(cfg, [{ start: 0, dur: 1, text: 'what is closure' }]);
  expect(r).toContain('闭包');
});

it('summarize 多块 map-reduce 得到结构化 Summary', async () => {
  const cues = Array.from({ length: 120 }, (_, i) => ({ start: i * 2, dur: 2, text: `point ${i} about closures and scope` }));
  stubJson({
    mapPoints: [{ start: 0, point: '闭包基础' }],
    oneLiner: '讲解闭包', sections: [{ start: 0, title: '闭包基础', points: ['定义'] }],
    knowledge: [{ term: 'closure', desc: '函数+词法环境' }], prerequisites: ['作用域'],
  });
  const s = await summarize(cfg, { videoId: 'v', title: 'T' }, cues);
  expect(s.videoId).toBe('v'); expect(s.oneLiner).toBe('讲解闭包');
  expect(s.model).toBe('gpt-x'); expect(s.sections[0].points).toEqual(['定义']);
});
```

- [ ] **Step 2: 实现 `src/services/ai.ts`**

```ts
import type { Cue, LlmConfig, Summary } from '../types';
import { chatJson } from './llm';

/** 按累计字符切块（单条永不切断），供超长视频 map-reduce */
export function chunkTranscript(cues: Cue[], maxChars: number): Cue[][] {
  const chunks: Cue[][] = []; let cur: Cue[] = []; let n = 0;
  for (const c of cues) {
    if (cur.length && n + c.text.length > maxChars) { chunks.push(cur); cur = []; n = 0; }
    cur.push(c); n += c.text.length;
  }
  if (cur.length) chunks.push(cur);
  return chunks;
}

/** 疑惑解释：结合上下文字幕给中文讲解 */
export async function explainConfusion(config: LlmConfig, contextCues: Cue[]): Promise<string> {
  const r = await chatJson<{ explanation: string }>(config, [
    { role: 'system', content: '你看视频教程时有疑惑，结合以下带时间戳的字幕上下文，用中文通俗解释疑惑点：先一句话直击要害，再展开原理，必要时给一个小例子。输出 JSON：{"explanation":"..."}' },
    { role: 'user', content: JSON.stringify(contextCues.map((c) => ({ t: c.start, text: c.text }))) },
  ]);
  return r.explanation;
}

const SUMMARY_SCHEMA = {
  oneLiner: '一句话总结（中文）',
  sections: [{ start: 0, title: '小节标题（中文）', points: ['要点，简洁中文'] }],
  knowledge: [{ term: '术语（保留英文）', desc: '一句话中文说明' }],
  prerequisites: ['前置知识'],
};

/** 视频摘要：≤1 块直接生成；多块 map（逐块要点）→ reduce（汇总结构化） */
export async function summarize(config: LlmConfig, video: { videoId: string; title: string }, cues: Cue[]): Promise<Summary> {
  const chunks = chunkTranscript(cues, 12000);
  let mapPoints: { start: number; point: string }[] = [];

  if (chunks.length > 1) {
    // 单块失败重试一次，仍失败则跳过该块（保留已完成块继续 reduce）
    const one = async (ch: Cue[]) => {
      const messages = [
        { role: 'system', content: '总结这段视频字幕的要点。输出 JSON：{"points":[{"start":秒数,"point":"要点（中文）"}]}' },
        { role: 'user', content: `视频《${video.title}》片段字幕：\n` + JSON.stringify(ch.map((c) => ({ t: c.start, text: c.text }))) },
      ] as const;
      const r = await chatJson<{ points: { start: number; point: string }[] }>(config, [...messages]);
      return r.points ?? [];
    };
    const results = await Promise.allSettled(chunks.map(async (ch) => {
      try { return await one(ch); } catch { return await one(ch); } // 重试一次
    }));
    mapPoints = results.flatMap((r) => (r.status === 'fulfilled' ? r.value : []));
  }

  const finalContext = chunks.length > 1
    ? '各片段要点：\n' + JSON.stringify(mapPoints)
    : '完整字幕：\n' + JSON.stringify(cues.map((c) => ({ t: c.start, text: c.text })));

  const r = await chatJson<Omit<Summary, 'videoId' | 'model' | 'generatedAt'>>(config, [
    { role: 'system', content: `生成结构化学习摘要，严格输出符合此形状的 JSON：${JSON.stringify(SUMMARY_SCHEMA)}。sections 按时间排序，start 取该节起始秒数。` },
    { role: 'user', content: `视频《${video.title}》\n${finalContext}` },
  ]);

  return {
    videoId: video.videoId, oneLiner: r.oneLiner,
    sections: (r.sections ?? []).sort((a, b) => a.start - b.start),
    knowledge: r.knowledge ?? [], prerequisites: r.prerequisites ?? [],
    model: config.model, generatedAt: Date.now(),
  };
}
```

- [ ] **Step 3: 运行通过**：`npx vitest run src/services/ai.test.ts`
- [ ] **Step 4: Commit**：`git add -A && git commit -m "feat: AI 服务——疑惑解释与 map-reduce 视频摘要"`

---

### Task 8: 融合导出生成器

**Files:**
- Create: `src/services/export.ts`, `src/services/export.test.ts`

**Interfaces:**
- Consumes: `VideoMeta`, `Note`, `Summary`, `Cue`, `tsLink`（Task 1）
- Produces: `buildFusedMarkdown(input: { video: VideoMeta; notes: Note[]; summary?: Summary; transcript?: Cue[]; includeTranscript?: boolean }): string`

- [ ] **Step 1: 写失败测试（含快照锁定格式）**

```ts
import { describe, expect, it } from 'vitest';
import { buildFusedMarkdown } from './export';
import type { Note, Summary, VideoMeta } from '../types';

const video: VideoMeta = { videoId: 'abc', title: 'Closures Explained', channel: 'Dev', url: 'https://youtube.com/watch?v=abc', captionLang: 'en', fetchedAt: 1 };
const notes: Note[] = [
  { id: '1', videoId: 'abc', start: 195, end: 200, excerpt: 'closures capture state', annotation: '闭包 = 记住出生环境', type: 'value', createdAt: 1 },
  { id: '2', videoId: 'abc', start: 542, end: 548, excerpt: 'vs scope chain', annotation: '和作用域链什么关系？', type: 'confusion', aiExplanation: '作用域链是规则，闭包是现象。', createdAt: 2 },
];
const summary: Summary = {
  videoId: 'abc', oneLiner: '讲透闭包',
  sections: [{ start: 192, title: '闭包的定义与直觉', points: ['闭包=函数+词法环境'] }],
  knowledge: [{ term: 'closure', desc: '函数+词法环境' }], prerequisites: ['作用域'],
  model: 'm', generatedAt: 1,
};

it('笔记嵌入所属摘要小节', () => {
  const md = buildFusedMarkdown({ video, notes, summary });
  expect(md).toContain('## [03:12](https://www.youtube.com/watch?v=abc&t=192s) 闭包的定义与直觉');
  expect(md.indexOf('⭐ **我的笔记**')).toBeGreaterThan(md.indexOf('闭包的定义与直觉'));
  expect(md).toContain('🤖 **AI 解释**');
  expect(md).toContain('## 📚 知识点清单');
  expect(md).toContain('source: https://youtube.com/watch?v=abc');
});

it('无摘要时退化为纯笔记时间线', () => {
  const md = buildFusedMarkdown({ video, notes });
  expect(md).toContain('## 我的笔记');
  expect(md).not.toContain('知识点清单');
});

it('includeTranscript 附加附录', () => {
  const md = buildFusedMarkdown({ video, notes, transcript: [{ start: 1, dur: 2, text: 'hi', zh: '你好' }], includeTranscript: true });
  expect(md).toContain('## 附录：完整逐字稿');
  expect(md).toContain('你好');
});

it('格式快照', () => {
  expect(buildFusedMarkdown({ video, notes, summary })).toMatchSnapshot();
});
```

- [ ] **Step 2: 实现 `src/services/export.ts`**

```ts
import type { Cue, Note, Summary, VideoMeta } from '../types';
import { formatTime, tsLink } from '../utils/time';

const noteBlock = (videoId: string, n: Note): string => {
  const icon = n.type === 'value' ? '⭐ **我的笔记**' : '❓ **我的疑惑**';
  const lines = [`> ${icon} · [${formatTime(n.start)}](${tsLink(videoId, n.start)})`, `> ${n.annotation}`];
  if (n.excerpt) lines.push(`> 「${n.excerpt}」`);
  if (n.aiExplanation) lines.push('> 🤖 **AI 解释**：' + n.aiExplanation);
  return lines.join('\n');
};

/** 融合导出：时间轴骨架，摘要分节 + 笔记嵌入（不经 LLM，批注原样保留） */
export function buildFusedMarkdown(input: { video: VideoMeta; notes: Note[]; summary?: Summary; transcript?: Cue[]; includeTranscript?: boolean }): string {
  const { video, notes, summary, transcript, includeTranscript } = input;
  const sorted = [...notes].sort((a, b) => a.start - b.start);
  const head = [
    '---',
    `title: ${video.title}`,
    `source: ${video.url}`,
    `channel: ${video.channel}`,
    `date: ${new Date().toISOString().slice(0, 10)}`,
    '---', '',
    `# ${video.title}`, '',
  ];
  if (!summary) { // 退化：纯笔记时间线
    const body = sorted.length ? ['## 我的笔记', '', ...sorted.flatMap((n) => [noteBlock(video.videoId, n), ''])] : ['> 暂无笔记'];
    return [...head, ...body].join('\n');
  }
  const sections = [...summary.sections].sort((a, b) => a.start - b.start);
  const parts = [`> 📌 一句话总结：${summary.oneLiner}`, ''];
  const ends = sections.map((s, i) => (i + 1 < sections.length ? sections[i + 1].start : Infinity));
  sections.forEach((sec, i) => {
    parts.push(`## [${formatTime(sec.start)}](${tsLink(video.videoId, sec.start)}) ${sec.title}`, '');
    sec.points.forEach((p) => parts.push(`- ${p}`));
    parts.push('');
    sorted.filter((n) => n.start >= sec.start && n.start < ends[i]).forEach((n) => parts.push(noteBlock(video.videoId, n), ''));
  });
  // 不落在任何小节的笔记，追加到尾部时间线
  const covered = new Set(sections.flatMap((s, i) => sorted.filter((n) => n.start >= s.start && n.start < ends[i]).map((n) => n.id)));
  sorted.filter((n) => !covered.has(n.id)).forEach((n) => parts.push(noteBlock(video.videoId, n), ''));
  if (summary.knowledge.length) {
    parts.push('## 📚 知识点清单', '');
    summary.knowledge.forEach((k) => parts.push(`- **${k.term}**：${k.desc}`));
    parts.push('');
  }
  if (summary.prerequisites.length) {
    parts.push('## 前置知识 / 延伸', '', ...summary.prerequisites.map((p) => `- ${p}`), '');
  }
  if (includeTranscript && transcript?.length) {
    parts.push('## 附录：完整逐字稿', '', ...transcript.map((c) => `- [${formatTime(c.start)}](${tsLink(video.videoId, c.start)}) ${c.text}${c.zh ? ` ｜ ${c.zh}` : ''}`), '');
  }
  return [...head, ...parts].join('\n');
}
```

- [ ] **Step 3: 运行通过（快照生成后复查内容）**：`npx vitest run src/services/export.test.ts`；打开 `src/services/__snapshots__/export.test.ts.snap` 人工核对格式
- [ ] **Step 4: Commit**：`git add -A && git commit -m "feat: 融合导出 Markdown 生成器（快照锁定格式）"`

---

### Task 9: 消息协议与 background 路由

**Files:**
- Create: `src/messaging/protocol.ts`, `src/messaging/router.ts`, `src/messaging/router.test.ts`, `src/entrypoints/background.ts`

**Interfaces:**
- Consumes: Task 3-8 全部服务
- Produces:
  - 消息类型（ discriminated union）：`{ type: 'PAGE_INFO'; tracks: CaptionTrack[]; meta: {videoId,title,channel} }`（content→bg，触发抓取+存库）、`{ type: 'GET_VIDEO_DATA'; videoId: string }`（panel→bg，返回 `{ video, cues, notes, summary, translateProgress }`）、`{ type: 'TRANSLATE'; videoId: string }`、`{ type: 'SAVE_NOTE'; note: Note }`、`{ type: 'DELETE_NOTE'; id: string }`、`{ type: 'EXPLAIN'; videoId: string; start: number; end: number }`、`{ type: 'SUMMARIZE'; videoId: string }`、`{ type: 'SEEK'; t: number }`（panel→content）、`{ type: 'PLAYBACK'; t: number }`（content→panel 广播）、`{ type: 'EXPORT'; videoId: string; includeTranscript: boolean }`、`{ type: 'GET_SETTINGS' }` / `{ type: 'SAVE_SETTINGS'; patch: Partial<Settings> }`、`{ type: 'CAPTURE_NOW' }`（bg 收快捷键→转 content）、`{ type: 'OPEN_NOTE_EDITOR'; start: number; end: number; excerpt: string }`（bg→panel）
  - `handleMessage(msg: Msg, deps: RouterDeps): Promise<any>`——纯路由函数，deps 注入全部服务，便于测试

- [ ] **Step 1: 写 `src/messaging/protocol.ts`**（完整消息类型定义）

```ts
import type { CaptionTrack } from '../adapters/youtube';
import type { Cue, Note, Settings, Summary, VideoMeta } from '../types';

export type Msg =
  | { type: 'PAGE_INFO'; tracks: CaptionTrack[]; meta: { videoId: string; title: string; channel: string } }
  | { type: 'GET_VIDEO_DATA'; videoId: string }
  | { type: 'TRANSLATE'; videoId: string }
  | { type: 'SAVE_NOTE'; note: Note }
  | { type: 'DELETE_NOTE'; id: string }
  | { type: 'EXPLAIN'; videoId: string; start: number; end: number }
  | { type: 'SUMMARIZE'; videoId: string }
  | { type: 'SEEK'; t: number }
  | { type: 'PLAYBACK'; t: number }
  | { type: 'EXPORT'; videoId: string; includeTranscript: boolean; notesOnly?: boolean }
  | { type: 'GET_SETTINGS' }
  | { type: 'SAVE_SETTINGS'; patch: Partial<Settings> }
  | { type: 'CAPTURE_NOW' }
  | { type: 'OPEN_NOTE_EDITOR'; start: number; end: number; excerpt: string };

export interface VideoData { video: VideoMeta | null; cues: Cue[]; notes: Note[]; summary: Summary | null; }
```

- [ ] **Step 2: 写失败测试 `src/messaging/router.test.ts`**

```ts
import 'fake-indexeddb/auto';
import { describe, expect, it, vi } from 'vitest';
import { handleMessage } from './router';

const deps = (over: any = {}) => ({
  getTranscript: vi.fn(async () => [{ start: 0, dur: 1, text: 'hi' }]),
  saveTranscript: vi.fn(), saveVideo: vi.fn(), getVideo: vi.fn(async () => null),
  getNotesByVideo: vi.fn(async () => []), addNote: vi.fn(), deleteNote: vi.fn(),
  getSummary: vi.fn(async () => null), saveSummary: vi.fn(),
  getSettings: vi.fn(async () => ({ displayMode: 'bilingual', translateChannel: 'free', llm: null, supadataKey: '', polishEnabled: false })),
  saveSettings: vi.fn(),
  getTranscriptWithFallback: vi.fn(async () => ({ cues: [{ start: 0, dur: 1, text: 'x' }], source: 'youtube' as const })),
  googleFreeTranslate: vi.fn(async () => '你好'), runBatchTranslation: vi.fn(async (c: any[]) => ({ translated: c.map((x) => ({ ...x, zh: '译' })), failed: 0 })),
  llmTranslateBatch: vi.fn(), explainConfusion: vi.fn(async () => '解释'), summarize: vi.fn(async () => ({ videoId: 'v', oneLiner: 's', sections: [], knowledge: [], prerequisites: [], model: 'm', generatedAt: 1 })),
  buildFusedMarkdown: vi.fn(() => '# md'), broadcast: vi.fn(), sendToActiveTab: vi.fn(), ...over,
});

it('PAGE_INFO 抓取并落库', async () => {
  const d = deps();
  await handleMessage({ type: 'PAGE_INFO', tracks: [{ baseUrl: 'u', lang: 'en', kind: 'asr' }], meta: { videoId: 'v', title: 'T', channel: 'C' } }, d);
  expect(d.getTranscriptWithFallback).toHaveBeenCalled();
  expect(d.saveVideo).toHaveBeenCalled();
  expect(d.saveTranscript).toHaveBeenCalledWith('v', [{ start: 0, dur: 1, text: 'x' }]);
});

it('EXPLAIN 用字幕窗口调用 explainConfusion 并返回解释', async () => {
  const d = deps();
  const r = await handleMessage({ type: 'EXPLAIN', videoId: 'v', start: 8, end: 12 }, d);
  expect(d.explainConfusion).toHaveBeenCalled();
  expect(r.explanation).toBe('解释');
});

it('未知消息类型返回错误', async () => {
  await expect(handleMessage({ type: 'NOPE' } as any, deps())).rejects.toThrow('未知消息');
});
```

- [ ] **Step 3: 实现 `src/messaging/router.ts`**

```ts
import type { Msg, VideoData } from './protocol';
import type { Cue, Note, Settings, Summary } from '../types';

export interface RouterDeps {
  getTranscript(videoId: string): Promise<Cue[] | undefined>;
  saveTranscript(videoId: string, cues: Cue[]): Promise<void>;
  saveVideo(meta: any): Promise<void>;
  getVideo(videoId: string): Promise<any>;
  getNotesByVideo(videoId: string): Promise<Note[]>;
  addNote(n: Note): Promise<void>;
  deleteNote(id: string): Promise<void>;
  getSummary(videoId: string): Promise<Summary | undefined>;
  saveSummary(s: Summary): Promise<void>;
  getSettings(): Promise<Settings>;
  saveSettings(patch: Partial<Settings>): Promise<void>;
  getTranscriptWithFallback(input: any): Promise<{ cues: Cue[]; source: string }>;
  googleFreeTranslate(text: string): Promise<string>;
  runBatchTranslation(cues: Cue[], fn: (t: string) => Promise<string>, opts: any): Promise<{ translated: Cue[]; failed: number }>;
  llmTranslateBatch(config: any, texts: string[]): Promise<string[]>;
  explainConfusion(config: any, cues: Cue[]): Promise<string>;
  summarize(config: any, video: any, cues: Cue[]): Promise<Summary>;
  buildFusedMarkdown(input: any): string;
  broadcast(msg: Msg): void;          // 面板广播（PLAYBACK/OPEN_NOTE_EDITOR 等）
  sendToActiveTab(msg: Msg): void;    // content script 定向
}

/** 消息路由：纯函数，全部依赖注入（真实绑定在 background.ts） */
export async function handleMessage(msg: Msg, deps: RouterDeps): Promise<any> {
  switch (msg.type) {
    case 'PAGE_INFO': {
      const { cues } = await deps.getTranscriptWithFallback({ videoId: msg.meta.videoId, tracks: msg.tracks });
      await deps.saveVideo({ ...msg.meta, url: `https://www.youtube.com/watch?v=${msg.meta.videoId}`, captionLang: 'en', fetchedAt: Date.now() });
      await deps.saveTranscript(msg.meta.videoId, cues);
      return { ok: true, cueCount: cues.length };
    }
    case 'GET_VIDEO_DATA': {
      const [video, cues, notes, summary] = await Promise.all([
        deps.getVideo(msg.videoId), deps.getTranscript(msg.videoId), deps.getNotesByVideo(msg.videoId), deps.getSummary(msg.videoId),
      ]);
      return { video: video ?? null, cues: cues ?? [], notes, summary: summary ?? null } satisfies VideoData;
    }
    case 'TRANSLATE': {
      const cues = (await deps.getTranscript(msg.videoId)) ?? [];
      if (!cues.length) throw new Error('无逐字稿');
      const pending = cues.filter((c) => !c.zh);
      if (!pending.length) return { ok: true, done: true };
      const s = await deps.getSettings();
      let out: { translated: Cue[]; failed: number };
      if (s.translateChannel === 'llm' && s.llm) {
        const texts = pending.map((c) => c.text);
        const zh = await deps.llmTranslateBatch(s.llm, texts);
        out = { translated: pending.map((c, i) => ({ ...c, zh: zh[i] })), failed: 0 };
      } else {
        out = await deps.runBatchTranslation(pending, deps.googleFreeTranslate, { concurrency: 5 });
      }
      const merged = cues.map((c) => out.translated.find((t) => t.start === c.start) ?? c);
      await deps.saveTranscript(msg.videoId, merged);
      return { ok: true, failed: out.failed };
    }
    case 'SAVE_NOTE': await deps.addNote(msg.note); return { ok: true };
    case 'DELETE_NOTE': await deps.deleteNote(msg.id); return { ok: true };
    case 'EXPLAIN': {
      const s = await deps.getSettings();
      if (!s.llm) throw new Error('未配置 LLM');
      const cues = (await deps.getTranscript(msg.videoId)) ?? [];
      const ctx = cues.filter((c) => c.start >= msg.start - 30 && c.start <= msg.end + 30);
      const explanation = await deps.explainConfusion(s.llm, ctx);
      return { explanation };
    }
    case 'SUMMARIZE': {
      const s = await deps.getSettings();
      if (!s.llm) throw new Error('未配置 LLM');
      const [video, cues] = await Promise.all([deps.getVideo(msg.videoId), deps.getTranscript(msg.videoId)]);
      const summary = await deps.summarize(s.llm, video ?? { videoId: msg.videoId, title: '' }, cues ?? []);
      await deps.saveSummary(summary);
      return { summary };
    }
    case 'EXPORT': {
      const [video, cues, notes, summary] = await Promise.all([
        deps.getVideo(msg.videoId), deps.getTranscript(msg.videoId), deps.getNotesByVideo(msg.videoId), deps.getSummary(msg.videoId),
      ]);
      return { markdown: deps.buildFusedMarkdown({ video, notes: notes as Note[], summary: msg.notesOnly ? undefined : summary, transcript: cues, includeTranscript: msg.includeTranscript }) };
    }
    case 'GET_SETTINGS': return await deps.getSettings();
    case 'SAVE_SETTINGS': await deps.saveSettings(msg.patch); return { ok: true };
    case 'SEEK': deps.sendToActiveTab(msg); return { ok: true };
    case 'CAPTURE_NOW': deps.sendToActiveTab(msg); return { ok: true };
    default: throw new Error(`未知消息: ${(msg as any).type}`);
  }
}
```

- [ ] **Step 4: 绑定真实依赖 `src/entrypoints/background.ts`**

```ts
import { defineBackground } from 'wxt';
import * as db from '../storage/db';
import { getSettings, saveSettings } from '../storage/settings';
import { getTranscriptWithFallback } from '../services/transcript';
import { fetchCueTrack } from '../adapters/youtube';
import { fetchSupadataTranscript } from '../adapters/supadata';
import { googleFreeTranslate, runBatchTranslation } from '../services/translate';
import { llmTranslateBatch } from '../services/llm-translate';
import { explainConfusion, summarize } from '../services/ai';
import { buildFusedMarkdown } from '../services/export';
import { handleMessage, type RouterDeps } from '../messaging/router';
import type { Msg } from '../messaging/protocol';

export default defineBackground(() => {
  const deps: RouterDeps = {
    ...db, getSettings, saveSettings,
    getTranscriptWithFallback: (input) => {
      // 双通道绑定：Supadata key 从设置读（异步），在 router 调用前无法注入——改为闭包读取
      return getTranscriptWithFallback(input, {}); // 真实绑定见下方包装
    },
    googleFreeTranslate, runBatchTranslation, llmTranslateBatch, explainConfusion, summarize, buildFusedMarkdown,
    broadcast: (msg) => browser.runtime.sendMessage(msg).catch(() => {}),
    sendToActiveTab: (msg) => browser.tabs.query({ active: true, currentWindow: true }).then(([tab]) => tab && browser.tabs.sendMessage(tab.id!, msg)).catch(() => {}),
  };
  // Supadata 兜底包装：每次调用时读设置
  deps.getTranscriptWithFallback = async (input: any) => {
    const s = await getSettings();
    return getTranscriptWithFallback(input, {
      fetchTrack: fetchCueTrack,
      supadata: s.supadataKey ? fetchSupadataTranscript : undefined,
      supadataKey: s.supadataKey || undefined,
    });
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
```

- [ ] **Step 5: 运行 router 测试通过**：`npx vitest run src/messaging`
- [ ] **Step 6: Commit**：`git add -A && git commit -m "feat: 消息协议、可测路由与 background 绑定"`

---

### Task 10: Content Script

**Files:**
- Create: `src/entrypoints/content.ts`
- Modify: `wxt.config.ts`（若 content_scripts 匹配已在 Task 1 配好则不改）

**Interfaces:**
- Consumes: `extractCaptionTracks`, `extractVideoMeta`（Task 4）；消息 `PAGE_INFO/SEEK/CAPTURE_NOW/PLAYBACK`
- Produces: 页面事件流——进入/切换视频时发 `PAGE_INFO`（含 tracks+meta）；播放中每 500ms 广播 `PLAYBACK`；响应 `SEEK`（video.currentTime）与 `CAPTURE_NOW`（抓当前时间±上下文字幕→广播 `OPEN_NOTE_EDITOR`）

- [ ] **Step 1: 实现 `src/entrypoints/content.ts`**（DOM 逻辑，手动验收，无单测）

```ts
import { defineContentScript } from 'wxt';
import { extractCaptionTracks, extractVideoMeta } from '../adapters/youtube';
import type { Msg } from '../messaging/protocol';

export default defineContentScript({
  matches: ['https://www.youtube.com/*'],
  runAt: 'document_idle',
  main() {
    let lastVideoId = '';
    let lastTimeSent = -1;

    async function onPageChange() {
      // 仅 watch 页处理；SPA 导航后重新 fetch 当前 HTML 提取（页面源里始终有 ytInitialPlayerResponse）
      if (!location.pathname.startsWith('/watch')) return;
      try {
        const html = await fetch(location.href).then((r) => r.text());
        const meta = extractVideoMeta(html, location.href);
        if (!meta.videoId || meta.videoId === lastVideoId) return;
        lastVideoId = meta.videoId;
        const tracks = extractCaptionTracks(html);
        browser.runtime.sendMessage({ type: 'PAGE_INFO', tracks, meta } satisfies Msg).catch(() => {});
      } catch { /* 页面未就绪，导航事件后重试 */ setTimeout(onPageChange, 1500); }
    }

    // 播放进度：500ms 节流广播
    setInterval(() => {
      const v = document.querySelector('video');
      if (!v) return;
      const t = Math.floor(v.currentTime);
      if (t !== lastTimeSent) { lastTimeSent = t; browser.runtime.sendMessage({ type: 'PLAYBACK', t } satisfies Msg).catch(() => {}); }
    }, 500);

    // 接收指令：SEEK / CAPTURE_NOW
    browser.runtime.onMessage.addListener((msg: Msg) => {
      const v = document.querySelector('video');
      if (msg.type === 'SEEK' && v) v.currentTime = msg.t;
      if (msg.type === 'CAPTURE_NOW' && v) {
        const t = v.currentTime;
        // 摘录当前句前后 ±1 句：由 background 持有字幕，这里只报时间，面板负责组稿
        browser.runtime.sendMessage({ type: 'OPEN_NOTE_EDITOR', start: t - 5, end: t + 5, excerpt: '' } satisfies Msg).catch(() => {});
      }
    });

    // SPA 导航监听 + 首次进入
    window.addEventListener('yt-navigate-finish', onPageChange);
    onPageChange();
  },
});
```

- [ ] **Step 2: 构建验证**：`npm run build` → `.output/chrome-mv3/content-scripts/content.js` 存在且无类型错误
- [ ] **Step 3: 手动冒烟（chrome://extensions 加载 .output/chrome-mv3）**：打开任一 YouTube watch 页 → DevTools service worker 控制台无报错；`PAGE_INFO` 触发后 IndexedDB 出现该视频记录
- [ ] **Step 4: Commit**：`git add -A && git commit -m "feat: content script——元信息抓取、播放进度、seek 与快捷键捕获"`

---

### Task 11: Side Panel 骨架 + 逐字稿视图

**Files:**
- Create: `src/entrypoints/sidepanel/index.html`, `src/entrypoints/sidepanel/main.tsx`, `src/entrypoints/sidepanel/App.tsx`, `src/entrypoints/sidepanel/state.ts`, `src/entrypoints/sidepanel/TranscriptView.tsx`, `src/entrypoints/sidepanel/TranscriptView.test.tsx`

**Interfaces:**
- Consumes: 消息 API（`browser.runtime.sendMessage` / `onMessage`）、`Cue`, `DisplayMode`、`formatTime`
- Produces:
  - `state.ts` 导出 signals：`videoInfo`、`cues`、`notes`、`summary`、`settings`、`currentTime`、`activeTab`、`noteEditorOpen`，及 `sendMsg(msg): Promise<any>` 封装、`loadVideoData(videoId)`、`refreshSettings()`
  - `TranscriptView`：props `{ cues: Cue[]; videoId: string; currentTime: number; mode: DisplayMode; onSeek(t: number): void; onSelect(cues: Cue[]): void }`

- [ ] **Step 1: 创建 `index.html` 与 `main.tsx`**

`src/entrypoints/sidepanel/index.html`:

```html
<!doctype html>
<html lang="zh">
  <head>
    <meta charset="UTF-8" />
    <title>Video Note</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="./main.tsx"></script>
  </body>
</html>
```

`src/entrypoints/sidepanel/main.tsx`:

```tsx
import { render } from 'preact';
import { App } from './App';
import './style.css';

render(<App />, document.getElementById('root')!);
```

- [ ] **Step 2: 实现 `state.ts`（signals + 消息封装）**

```ts
import { signal } from '@preact/signals';
import type { Cue, Note, Settings, Summary, VideoMeta } from '../../types';

export const videoInfo = signal<VideoMeta | null>(null);
export const cues = signal<Cue[]>([]);
export const notes = signal<Note[]>([]);
export const summary = signal<Summary | null>(null);
export const settings = signal<Settings | null>(null);
export const currentTime = signal(0);
export const activeTab = signal<'transcript' | 'notes' | 'summary' | 'library' | 'settings'>('transcript');
export const noteEditorCtx = signal<{ start: number; end: number; excerpt: string } | null>(null);

export const sendMsg = <T = any>(msg: any): Promise<T> =>
  browser.runtime.sendMessage(msg).then((resp: any) => {
    // background 以 { error } 形状回传失败——统一转成 throw，调用方 try/catch
    if (resp && typeof resp === 'object' && 'error' in resp) throw new Error(resp.error);
    return resp as T;
  });

export async function loadVideoData(videoId: string) {
  const d = await sendMsg<{ video: VideoMeta; cues: Cue[]; notes: Note[]; summary: Summary }>({ type: 'GET_VIDEO_DATA', videoId });
  videoInfo.value = d.video; cues.value = d.cues; notes.value = d.notes; summary.value = d.summary;
}

export async function refreshSettings() { settings.value = await sendMsg<Settings>({ type: 'GET_SETTINGS' }); }
```

- [ ] **Step 3: 写失败测试 `TranscriptView.test.tsx`**

```tsx
// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { render, fireEvent } from '@testing-library/preact';
import { TranscriptView } from './TranscriptView';

const cues = [
  { start: 1, dur: 2, text: 'hello', zh: '你好' },
  { start: 3, dur: 2, text: 'world', zh: '世界' },
];

it('中英对照渲染双行，点击时间戳触发 onSeek', () => {
  const onSeek = vi.fn();
  const { getByText, getByTestId } = render(
    <TranscriptView cues={cues} videoId="v" currentTime={1} mode="bilingual" onSeek={onSeek} onSelect={() => {}} />,
  );
  expect(getByText('hello')).toBeTruthy();
  expect(getByText('你好')).toBeTruthy();
  fireEvent.click(getByTestId('ts-0'));
  expect(onSeek).toHaveBeenCalledWith(1);
});

it('仅中文模式隐藏英文', () => {
  const { queryByText } = render(<TranscriptView cues={cues} videoId="v" currentTime={0} mode="zh" onSeek={() => {}} onSelect={() => {}} />);
  expect(queryByText('hello')).toBeNull();
  expect(queryByText('你好')).toBeTruthy();
});

it('当前播放句有高亮类名', () => {
  const { getByTestId } = render(<TranscriptView cues={cues} videoId="v" currentTime={4} mode="en" onSeek={() => {}} onSelect={() => {}} />);
  expect(getByTestId('cue-1').className).toContain('active');
});
```

- [ ] **Step 4: 实现 `TranscriptView.tsx`**

```tsx
import type { Cue, DisplayMode } from '../../types';
import { formatTime } from '../../utils/time';

export function TranscriptView(props: {
  cues: Cue[]; videoId: string; currentTime: number; mode: DisplayMode;
  onSeek: (t: number) => void; onSelect: (cues: Cue[]) => void;
}) {
  const isCurrent = (c: Cue, i: number) => {
    const next = props.cues[i + 1];
    return props.currentTime >= c.start && (!next || props.currentTime < next.start);
  };
  const onMouseUp = () => {
    const sel = window.getSelection()?.toString().trim();
    if (sel) props.onSelect(props.cues.filter((c) => sel.includes(c.text.slice(0, 10)) || (sel && c.text.includes(sel.slice(0, 10)))));
  };
  return (
    <div class="transcript" onMouseUp={onMouseUp}>
      {props.cues.map((c, i) => (
        <div key={i} data-testid={`cue-${i}`} class={`cue ${isCurrent(c, i) ? 'active' : ''}`}>
          <button data-testid={`ts-${i}`} class="ts" onClick={() => props.onSeek(c.start)}>{formatTime(c.start)}</button>
          {props.mode !== 'zh' && <div class="en">{c.text}</div>}
          {props.mode !== 'en' && <div class="zh">{c.zh ?? '（未翻译）'}</div>}
        </div>
      ))}
    </div>
  );
}
```

- [ ] **Step 5: 实现 `App.tsx`（Tab 骨架 + 消息监听接线）**

```tsx
import { useEffect } from 'preact/hooks';
import { activeTab, cues, currentTime, loadVideoData, noteEditorCtx, refreshSettings, sendMsg, videoInfo } from './state';
import { TranscriptView } from './TranscriptView';
import { NotesView } from './NotesView';
import { SummaryView } from './SummaryView';
import { LibraryView } from './LibraryView';
import { SettingsView } from './SettingsView';
import { NoteEditor } from './NoteEditor';

const TABS = [
  ['transcript', '逐字稿'], ['notes', '笔记'], ['summary', 'AI 摘要'], ['library', '📚'], ['settings', '⚙️'],
] as const;

export function App() {
  useEffect(() => {
    refreshSettings();
    // 找当前 YouTube 标签页拿 videoId
    browser.tabs.query({ active: true, currentWindow: true }).then(async ([tab]) => {
      const m = tab?.url?.match(/[?&]v=([\w-]{11})/);
      if (m) await loadVideoData(m[1]);
    });
    const listener = (msg: any) => {
      if (msg.type === 'PLAYBACK') currentTime.value = msg.t;
      if (msg.type === 'OPEN_NOTE_EDITOR') noteEditorCtx.value = msg;
      if (msg.type === 'PAGE_INFO') loadVideoData(msg.meta.videoId);
    };
    browser.runtime.onMessage.addListener(listener);
    return () => browser.runtime.onMessage.removeListener(listener);
  }, []);

  const tab = activeTab.value;
  return (
    <div class="app">
      <header>
        <span class="title">{videoInfo.value?.title ?? 'Video Note'}</span>
        <nav>
          {TABS.map(([id, label]) => (
            <button key={id} class={tab === id ? 'on' : ''} onClick={() => (activeTab.value = id)}>{label}</button>
          ))}
        </nav>
      </header>
      <main>
        {tab === 'transcript' && <TranscriptView
          cues={cues.value} videoId={videoInfo.value?.videoId ?? ''} currentTime={currentTime.value}
          mode={(settings.value?.displayMode ?? 'bilingual') as any}
          onSeek={(t) => sendMsg({ type: 'SEEK', t })}
          onSelect={(sel) => (noteEditorCtx.value = { start: sel[0]?.start ?? 0, end: sel.at(-1)!.start + sel.at(-1)!.dur, excerpt: sel.map((c) => c.text).join(' ') })}
        />}
        {tab === 'notes' && <NotesView />}
        {tab === 'summary' && <SummaryView />}
        {tab === 'library' && <LibraryView />}
        {tab === 'settings' && <SettingsView />}
      </main>
      {noteEditorCtx.value && <NoteEditor />}
    </div>
  );
}
```

- [ ] **Step 6: 创建 `style.css`（基础布局+高亮）**

```css
* { box-sizing: border-box; margin: 0; }
body { font: 13px/1.6 system-ui, sans-serif; color: #1f2328; }
.app { display: flex; flex-direction: column; height: 100vh; }
header { display: flex; justify-content: space-between; align-items: center; padding: 8px 12px; border-bottom: 1px solid #e1e4e8; }
header .title { font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 45%; }
nav button { border: 0; background: none; padding: 4px 8px; cursor: pointer; font-size: 13px; }
nav button.on { border-bottom: 2px solid #0969da; color: #0969da; }
main { flex: 1; overflow-y: auto; padding: 8px 12px; }
.cue { padding: 6px 4px; border-radius: 6px; }
.cue.active { background: #fff8c5; }
.cue .ts { border: 0; background: none; color: #0969da; cursor: pointer; font-size: 12px; padding: 0 4px 0 0; }
.cue .en { color: #1f2328; }
.cue .zh { color: #57606a; }
.transcript .en, .transcript .zh { display: block; }
```

- [ ] **Step 7: 其余视图先放占位文件**（`NotesView.tsx`/`SummaryView.tsx`/`LibraryView.tsx`/`SettingsView.tsx`/`NoteEditor.tsx` 各导出同名组件，函数体仅 `return <div class="empty">本视图在后续任务实现</div>;`——本任务只为编译通过，Task 12-14 逐个替换为真实实现）
- [ ] **Step 8: 测试+构建通过**：`npx vitest run src/entrypoints && npm run build`
- [ ] **Step 9: Commit**：`git add -A && git commit -m "feat: 侧边栏骨架与逐字稿视图（三档切换/高亮/跳转）"`

---

### Task 12: 笔记交互（NoteEditor + NotesView + 快捷键接线）

**Files:**
- Modify: `src/entrypoints/sidepanel/NoteEditor.tsx`, `src/entrypoints/sidepanel/NotesView.tsx`（替换占位）
- Test: `src/entrypoints/sidepanel/NotesView.test.tsx`

**Interfaces:**
- Consumes: `state.ts` signals、`sendMsg`、`Note`, `NoteType`、`formatTime`, `tsLink`
- Produces:
  - `NoteEditor`：读 `noteEditorCtx`（start/end/excerpt），选类型（⭐/❓）、批注输入、保存→`SAVE_NOTE`（id 用 `crypto.randomUUID()`，excerpt 为空时自动从当前字幕取 ±5s 窗口文本）
  - `NotesView`：笔记列表；每条两个按钮——「复制」（`navigator.clipboard.writeText`，格式与 `noteBlock` 一致的单条 markdown）、「跳转」（当前视频 `SEEK`，否则 `browser.tabs.create({url: tsLink(...)})`）；「AI 解释」按钮（confusion 且未解释时显示）→`EXPLAIN`→可编辑→保存

- [ ] **Step 1: 写失败测试 `NotesView.test.tsx`**

```tsx
// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { render, fireEvent } from '@testing-library/preact';
import { NotesView } from './NotesView';
import type { Note } from '../../types';

const notes: Note[] = [
  { id: '1', videoId: 'v', start: 95, end: 100, excerpt: 'closures capture', annotation: '记住环境', type: 'value', createdAt: 1 },
];

it('渲染笔记并复制单条 markdown', async () => {
  const writeText = vi.fn();
  vi.stubGlobal('navigator', { clipboard: { writeText } });
  vi.stubGlobal('browser', { runtime: { sendMessage: vi.fn(async () => ({})) } });
  const { getByText, findByText } = render(<NotesView notes={notes} videoId="v" currentVideoId="v" />);
  expect(getByText('记住环境')).toBeTruthy();
  fireEvent.click(getByText('复制'));
  expect(await findByText('已复制')).toBeTruthy();
  expect(writeText).toHaveBeenCalled();
  expect(String(writeText.mock.calls[0][0])).toContain('⭐ **我的笔记**');
});
```

- [ ] **Step 2: 实现 `NoteEditor.tsx`**

```tsx
import { useState } from 'preact/hooks';
import type { NoteType } from '../../types';
import { cues, loadVideoData, noteEditorCtx, sendMsg, videoInfo } from './state';
import { formatTime } from '../../utils/time';

export function NoteEditor() {
  const ctx = noteEditorCtx.value!;
  const [type, setType] = useState<NoteType>('value');
  const [annotation, setAnnotation] = useState('');
  // excerpt 为空（快捷键路径）时，从字幕取 ±5s 窗口文本
  const excerpt = ctx.excerpt || cues.value.filter((c) => c.start >= ctx.start && c.start <= ctx.end).map((c) => c.text).join(' ');
  const save = async () => {
    const videoId = videoInfo.value?.videoId ?? '';
    await sendMsg({ type: 'SAVE_NOTE', note: {
      id: crypto.randomUUID(), videoId,
      start: ctx.start, end: ctx.end, excerpt, annotation, type, createdAt: Date.now(),
    } });
    noteEditorCtx.value = null;
    await loadVideoData(videoId); // 刷新笔记列表
  };
  return (
    <div class="editor-mask">
      <div class="editor">
        <div class="row">
          <button class={type === 'value' ? 'on' : ''} onClick={() => setType('value')}>⭐ 有价值</button>
          <button class={type === 'confusion' ? 'on' : ''} onClick={() => setType('confusion')}>❓ 有疑惑</button>
        </div>
        <div class="meta">[{formatTime(ctx.start)}] 「{excerpt.slice(0, 120)}{excerpt.length > 120 ? '…' : ''}」</div>
        <textarea placeholder="写批注…" value={annotation} onInput={(e) => setAnnotation((e.target as HTMLTextAreaElement).value)} rows={4} />
        <div class="row">
          <button onClick={() => (noteEditorCtx.value = null)}>取消</button>
          <button class="primary" onClick={save}>保存</button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: 实现 `NotesView.tsx`**

```tsx
import { useState } from 'preact/hooks';
import type { Note } from '../../types';
import { formatTime, tsLink } from '../../utils/time';
import { sendMsg } from './state';

/** 单条笔记复制格式（与融合导出一致） */
export function noteMarkdown(n: Note): string {
  const icon = n.type === 'value' ? '⭐ **我的笔记**' : '❓ **我的疑惑**';
  const lines = [`${icon} · [${formatTime(n.start)}](${tsLink(n.videoId, n.start)})`, n.annotation];
  if (n.excerpt) lines.push(`「${n.excerpt}」`);
  if (n.aiExplanation) lines.push('🤖 **AI 解释**：' + n.aiExplanation);
  return lines.join('\n');
}

export function NotesView(props: { notes: Note[]; videoId: string; currentVideoId: string }) {
  const [copiedId, setCopiedId] = useState('');
  const copy = async (n: Note) => {
    await navigator.clipboard.writeText(noteMarkdown(n));
    setCopiedId(n.id); setTimeout(() => setCopiedId(''), 1500);
  };
  const jump = (n: Note) => {
    if (n.videoId === props.currentVideoId) sendMsg({ type: 'SEEK', t: n.start });
    else browser.tabs.create({ url: tsLink(n.videoId, n.start) });
  };
  const explain = async (n: Note) => {
    const r = await sendMsg<{ explanation: string }>({ type: 'EXPLAIN', videoId: n.videoId, start: n.start, end: n.end });
    n.aiExplanation = r.explanation;
    await sendMsg({ type: 'SAVE_NOTE', note: n });
  };
  if (!props.notes.length) return <div class="empty">本视频还没有笔记——选中字幕或按快捷键开始记录</div>;
  const exportMd = async (notesOnly: boolean, includeTranscript: boolean) => {
    const r = await sendMsg<{ markdown: string }>({ type: 'EXPORT', videoId: props.videoId, notesOnly, includeTranscript });
    const url = URL.createObjectURL(new Blob([r.markdown], { type: 'text/markdown' }));
    const a = document.createElement('a');
    a.href = url; a.download = `${props.videoId}-notes.md`; a.click();
    URL.revokeObjectURL(url);
  };
  return (
    <div class="notes">
      {props.notes.map((n) => (
        <div key={n.id} class="note">
          <button class="ts" onClick={() => jump(n)}>{formatTime(n.start)}</button>
          <span class={`tag ${n.type}`}>{n.type === 'value' ? '⭐' : '❓'}</span>
          <div class="annotation">{n.annotation}</div>
          {n.excerpt && <div class="excerpt">「{n.excerpt}」</div>}
          {n.aiExplanation && <div class="ai">🤖 {n.aiExplanation}</div>}
          <div class="ops">
            <button onClick={() => copy(n)}>{copiedId === n.id ? '已复制' : '复制'}</button>
            <button onClick={() => jump(n)}>跳转</button>
            {n.type === 'confusion' && !n.aiExplanation && <button onClick={() => explain(n)}>AI 解释</button>}
          </div>
        </div>
      ))}
      <div class="export">
        <button class="primary" onClick={() => exportMd(false, false)}>导出 Markdown</button>
        <button onClick={() => exportMd(true, false)}>仅笔记</button>
        <button onClick={() => exportMd(false, true)}>含逐字稿</button>
      </div>
    </div>
  );
}
```

（`App.tsx` 中 `<NotesView />` 改为 `<NotesView notes={notes.value} videoId={videoInfo.value?.videoId ?? ''} currentVideoId={videoInfo.value?.videoId ?? ''} />`；`NoteEditor` 保存后调用 `loadVideoData` 刷新——把 state.ts 中加 `export async function reloadNotes(videoId)` 调 `loadVideoData`，NoteEditor 保存后调用。）

- [ ] **Step 4: 测试+构建通过**：`npx vitest run src/entrypoints && npm run build`
- [ ] **Step 5: Commit**：`git add -A && git commit -m "feat: 笔记编辑器与笔记列表（复制/跳转/AI解释）"`

---

### Task 13: AI 摘要视图

**Files:**
- Modify: `src/entrypoints/sidepanel/SummaryView.tsx`（替换占位）
- Test: `src/entrypoints/sidepanel/SummaryView.test.tsx`

**Interfaces:**
- Consumes: `summary`, `videoInfo`, `sendMsg`, `formatTime`, `tsLink`
- Produces: `SummaryView`——无摘要时显示「生成摘要」按钮（未配 LLM 时禁用并提示先去设置）；有摘要显示一句话总结/分节（时间戳可点跳转）/知识点/前置知识 + 「重新生成」；生成中 loading 态

- [ ] **Step 1: 写失败测试**

```tsx
// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { render, fireEvent } from '@testing-library/preact';
import { SummaryView } from './SummaryView';
import type { Summary } from '../../types';

const s: Summary = {
  videoId: 'v', oneLiner: '讲透闭包',
  sections: [{ start: 192, title: '定义', points: ['闭包=函数+词法环境'] }],
  knowledge: [{ term: 'closure', desc: '函数+词法环境' }], prerequisites: ['作用域'],
  model: 'm', generatedAt: 1,
};

it('渲染结构化摘要，时间戳可点跳转', () => {
  const sendMsg = vi.fn(async () => ({}));
  vi.stubGlobal('browser', { runtime: { sendMessage: sendMsg }, tabs: { create: vi.fn() } });
  const { getByText } = render(<SummaryView summary={s} llmConfigured onSeek={() => {}} />);
  expect(getByText('讲透闭包')).toBeTruthy();
  expect(getByText('定义')).toBeTruthy();
  expect(getByText('作用域')).toBeTruthy();
});

it('未配 LLM 时禁用生成按钮', () => {
  const { getByRole } = render(<SummaryView summary={null} llmConfigured={false} onSeek={() => {}} />);
  expect((getByRole('button') as HTMLButtonElement).disabled).toBe(true);
});
```

- [ ] **Step 2: 实现 `SummaryView.tsx`**

```tsx
import { useState } from 'preact/hooks';
import type { Summary } from '../../types';
import { formatTime } from '../../utils/time';
import { sendMsg, summary as summarySignal } from './state';

export function SummaryView(props: { summary: Summary | null; llmConfigured: boolean; videoId: string; onSeek: (t: number) => void }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const gen = async () => {
    setBusy(true); setErr('');
    try {
      const r = await sendMsg<{ summary: Summary }>({ type: 'SUMMARIZE', videoId: props.videoId });
      summarySignal.value = r.summary; // 直接更新 signal，无需刷新页面
    } catch (e: any) { setErr(e.message ?? '生成失败'); }
    finally { setBusy(false); }
  };
  if (!props.summary) return (
    <div class="empty">
      {props.llmConfigured
        ? <button class="primary" disabled={busy} onClick={gen}>{busy ? '生成中…（长视频需数分钟）' : '生成摘要'}</button>
        : <p>AI 摘要需要在 ⚙️ 设置中配置 LLM API key</p>}
      {err && <p class="err">{err}</p>}
    </div>
  );
  const s = props.summary;
  return (
    <div class="summary">
      <p class="oneliner">📌 {s.oneLiner}</p>
      {s.sections.map((sec, i) => (
        <section key={i}>
          <h3><button class="ts" onClick={() => props.onSeek(sec.start)}>{formatTime(sec.start)}</button> {sec.title}</h3>
          <ul>{sec.points.map((p, j) => <li key={j}>{p}</li>)}</ul>
        </section>
      ))}
      {!!s.knowledge.length && <section><h3>📚 知识点清单</h3>
        <ul>{s.knowledge.map((k, i) => <li key={i}><b>{k.term}</b>：{k.desc}</li>)}</ul></section>}
      {!!s.prerequisites.length && <section><h3>前置知识 / 延伸</h3>
        <ul>{s.prerequisites.map((p, i) => <li key={i}>{p}</li>)}</ul></section>}
      <button disabled={busy} onClick={gen}>{busy ? '生成中…' : '重新生成'}</button>
    </div>
  );
}
```

（`App.tsx` 接线：`<SummaryView summary={summary.value} llmConfigured={!!settings.value?.llm} videoId={videoInfo.value?.videoId ?? ''} onSeek={(t) => sendMsg({ type: 'SEEK', t })} />`。）

- [ ] **Step 3: 测试+构建通过**
- [ ] **Step 4: Commit**：`git add -A && git commit -m "feat: AI 摘要视图（生成/缓存/重新生成/时间戳跳转）"`

---

### Task 14: 视频库视图 + 设置页

**Files:**
- Modify: `src/entrypoints/sidepanel/LibraryView.tsx`, `src/entrypoints/sidepanel/SettingsView.tsx`（替换占位）
- Modify: `src/messaging/protocol.ts`, `src/messaging/router.ts`（新增 `LIST_LIBRARY` 消息：返回 `listVideosWithNotes()` 结果）
- Test: `src/entrypoints/sidepanel/LibraryView.test.tsx`, `src/entrypoints/sidepanel/SettingsView.test.tsx`

**Interfaces:**
- Consumes: `listVideosWithNotes`（Task 3）、`Settings`、`saveSettings`、`NotesView`（复用）
- Produces:
  - `LIST_LIBRARY` 消息 → `{ rows: { video: VideoMeta; noteCount: number; lastAt: number }[] }`
  - `LibraryView`：搜索框（标题过滤）+ 列表（标题/笔记数/日期，倒序）；点进 → 内嵌该视频 `NotesView` + 「返回」
  - `SettingsView`：显示模式默认值、翻译通道（免费/LLM）、LLM 配置（baseUrl/apiKey/model，password input）、Supadata key、润色开关、「修改快捷键」按钮（`browser.tabs.create({url: 'chrome://extensions/shortcuts'})`）、LLM 连通性测试按钮（发一条 `chat` 验证，成功显示 ✓）

- [ ] **Step 1: router 增加 `LIST_LIBRARY`**（protocol.ts 加 `| { type: 'LIST_LIBRARY' }`；router.ts switch 加 `case 'LIST_LIBRARY': return { rows: await deps.listVideosWithNotes() };`；RouterDeps 加 `listVideosWithNotes`；background.ts deps 补 `listVideosWithNotes: db.listVideosWithNotes`；router.test.ts 补一条断言）
- [ ] **Step 2: 写 `LibraryView.test.tsx`**

```tsx
// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { render, fireEvent } from '@testing-library/preact';
import { LibraryView } from './LibraryView';

vi.mock('./state', () => ({ sendMsg: vi.fn(async () => ({ rows: [
  { video: { videoId: 'a', title: 'Closures', channel: 'C', url: 'u', captionLang: 'en', fetchedAt: 1 }, noteCount: 5, lastAt: 99 },
  { video: { videoId: 'b', title: 'React Intro', channel: 'C', url: 'u', captionLang: 'en', fetchedAt: 1 }, noteCount: 2, lastAt: 5 },
] })) }));

it('列表渲染并可搜索过滤', async () => {
  const { findByText, queryByText, getByPlaceholderText } = render(<LibraryView currentVideoId="a" />);
  expect(await findByText(/Closures/)).toBeTruthy();
  fireEvent.input(getByPlaceholderText('搜索视频标题…'), { target: { value: 'react' } });
  expect(queryByText(/Closures/)).toBeNull();
  expect(await findByText(/React Intro/)).toBeTruthy();
});
```

- [ ] **Step 3: 实现 `LibraryView.tsx`**

```tsx
import { useEffect, useState } from 'preact/hooks';
import type { Note, VideoMeta } from '../../types';
import { sendMsg } from './state';
import { NotesView } from './NotesView';

type Row = { video: VideoMeta; noteCount: number; lastAt: number };

export function LibraryView(props: { currentVideoId: string }) {
  const [rows, setRows] = useState<Row[]>([]);
  const [q, setQ] = useState('');
  const [openVideo, setOpenVideo] = useState<Row | null>(null);
  const [openNotes, setOpenNotes] = useState<Note[]>([]);
  useEffect(() => { sendMsg<{ rows: Row[] }>({ type: 'LIST_LIBRARY' }).then((r) => setRows(r.rows ?? [])); }, []);
  if (openVideo) return (
    <div>
      <button class="back" onClick={() => setOpenVideo(null)}>← 返回</button>
      <NotesView notes={openNotes} videoId={openVideo.video.videoId} currentVideoId={props.currentVideoId} />
    </div>
  );
  const filtered = rows.filter((r) => r.video.title.toLowerCase().includes(q.toLowerCase()));
  return (
    <div class="library">
      <input placeholder="搜索视频标题…" value={q} onInput={(e) => setQ((e.target as HTMLInputElement).value)} />
      {filtered.map((r) => (
        <div key={r.video.videoId} class="lib-item" onClick={async () => {
          const d = await sendMsg<{ notes: Note[] }>({ type: 'GET_VIDEO_DATA', videoId: r.video.videoId });
          setOpenNotes(d.notes); setOpenVideo(r);
        }}>
          <div class="lib-title">{r.video.title}</div>
          <div class="lib-meta">笔记 {r.noteCount} 条 ｜ {new Date(r.lastAt).toLocaleDateString('zh-CN')}</div>
        </div>
      ))}
      {!filtered.length && <div class="empty">还没有历史笔记</div>}
    </div>
  );
}
```

- [ ] **Step 4: 写 `SettingsView.test.tsx` 并实现 `SettingsView.tsx`**

测试要点：渲染各字段并从 `settings` props 填充；点保存调用 `onSave` 且携带 patch。

```tsx
// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { render, fireEvent } from '@testing-library/preact';
import { SettingsView } from './SettingsView';

it('保存时回传完整 patch', async () => {
  const onSave = vi.fn();
  const { getByDisplayValue, getByText } = render(
    <SettingsView settings={{ displayMode: 'bilingual', translateChannel: 'free', llm: null, supadataKey: '', polishEnabled: false }} onSave={onSave} />,
  );
  fireEvent.input(getByDisplayValue(''), { target: { value: 'sk-supa' } }); // Supadata key 输入框
  fireEvent.click(getByText('保存设置'));
  expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ supadataKey: 'sk-supa' }));
});
```

实现：

```tsx
import { useState } from 'preact/hooks';
import type { Settings } from '../../types';
import { sendMsg } from './state';

export function SettingsView(props: { settings: Settings; onSave: (patch: Partial<Settings>) => void }) {
  const [s, setS] = useState<Settings>(props.settings);
  const [testResult, setTestResult] = useState('');
  const bind = <K extends keyof Settings>(k: K) => ({ value: String(s[k] ?? ''), onInput: (e: any) => setS({ ...s, [k]: e.target.value }) });
  const testLlm = async () => {
    if (!s.llm) return;
    setTestResult('测试中…');
    try {
      const r = await fetch(`${s.llm.baseUrl.replace(/\/$/, '')}/chat/completions`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${s.llm.apiKey}` },
        body: JSON.stringify({ model: s.llm.model, messages: [{ role: 'user', content: 'ping' }], max_tokens: 1 }),
      });
      setTestResult(r.ok ? '✓ 连接成功' : `✗ HTTP ${r.status}`);
    } catch (e: any) { setTestResult(`✗ ${e.message}`); }
  };
  return (
    <div class="settings">
      <label>默认显示模式
        <select value={s.displayMode} onChange={(e) => setS({ ...s, displayMode: (e.target as HTMLSelectElement).value as any })}>
          <option value="bilingual">中英对照</option><option value="zh">仅中文</option><option value="en">仅英文</option>
        </select>
      </label>
      <label>翻译通道
        <select value={s.translateChannel} onChange={(e) => setS({ ...s, translateChannel: (e.target as HTMLSelectElement).value as any })}>
          <option value="free">免费接口（默认）</option><option value="llm">LLM（需配置）</option>
        </select>
      </label>
      <fieldset><legend>LLM 配置（OpenAI 兼容）</legend>
        <input placeholder="Base URL（如 https://api.openai.com/v1）" value={s.llm?.baseUrl ?? ''} onInput={(e) => setS({ ...s, llm: { ...(s.llm ?? { baseUrl: '', apiKey: '', model: '' }), baseUrl: e.target.value } })} />
        <input placeholder="API Key（仅存本机）" type="password" value={s.llm?.apiKey ?? ''} onInput={(e) => setS({ ...s, llm: { ...(s.llm ?? { baseUrl: '', apiKey: '', model: '' }), apiKey: e.target.value } })} />
        <input placeholder="模型名（如 gpt-4o-mini / deepseek-chat）" value={s.llm?.model ?? ''} onInput={(e) => setS({ ...s, llm: { ...(s.llm ?? { baseUrl: '', apiKey: '', model: '' }), model: e.target.value } })} />
        <div class="row"><button onClick={testLlm}>测试连接</button><span>{testResult}</span></div>
      </fieldset>
      <label>Supadata API Key（无字幕视频兜底，免费 100 次/月）
        <input type="password" placeholder="sk-…" {...(bind('supadataKey') as any)} />
      </label>
      <label class="check"><input type="checkbox" checked={s.polishEnabled} onChange={(e) => setS({ ...s, polishEnabled: (e.target as HTMLInputElement).checked })} /> LLM 纠错润色字幕（修正术语与标点）</label>
      <button class="primary" onClick={() => props.onSave(s)}>保存设置</button>
      <button onClick={() => browser.tabs.create({ url: 'chrome://extensions/shortcuts' })}>修改快捷键（浏览器管理页）</button>
      <p class="hint">密钥仅存储于本机浏览器（chrome.storage.local），请求直达对应服务，不经过第三方。走 Supadata 时视频 URL 会发送至其服务器。</p>
    </div>
  );
}
```

（`App.tsx` 接线：`<SettingsView settings={settings.value!} onSave={async (patch) => { await sendMsg({ type: 'SAVE_SETTINGS', patch }); await refreshSettings(); }} />`。）

- [ ] **Step 5: 全量测试+构建通过**：`npx vitest run && npm run build`
- [ ] **Step 6: Commit**：`git add -A && git commit -m "feat: 视频库（历史笔记/搜索/跨视频跳转）与设置页"`

---

### Task 15: 翻译触发接线、润色接线与手动验收

**Files:**
- Modify: `src/entrypoints/sidepanel/App.tsx`（逐字稿 Tab 加「翻译」按钮与进度；初次加载未翻译时自动触发免费翻译）
- Modify: `src/messaging/router.ts`（`PAGE_INFO` 处理后，若 `settings.polishEnabled && llm` 则先润色再存库——直接在 PAGE_INFO 分支调用 `deps.polishTranscript`；RouterDeps 加 `polishTranscript`，background.ts 绑定）
- Create: `docs/manual-acceptance-v1.md`

**Interfaces:**
- Consumes: 前面全部
- Produces: 完整可验收的 V1 + 验收清单文档

- [ ] **Step 1: App.tsx 逐字稿区加翻译条**（`TranscriptView` 上方：`未翻译句数 N` + 「翻译」按钮，点击 `sendMsg({type:'TRANSLATE', videoId})` 后 `loadVideoData` 刷新；`useEffect` 中当 `cues.length && cues.every(c=>!c.zh)` 且设置为 free 时自动触发一次）
- [ ] **Step 2: router.ts 润色接线**（`PAGE_INFO` 分支：`let final = cues; if (s.polishEnabled && s.llm) { try { final = await deps.polishTranscript(s.llm, cues); } catch {} }`，注意该分支需先 `await deps.getSettings()`；RouterDeps 与测试 deps 补 `polishTranscript: vi.fn(async (_c,cs)=>cs)`；background.ts 绑定 `polishTranscript`）
- [ ] **Step 3: 写 `docs/manual-acceptance-v1.md`**

```markdown
# V1 手动验收清单（每次发版前过一遍）

前置：chrome://extensions 加载 .output/chrome-mv3；准备一个带字幕的英文教程视频（如 JS 闭包主题）

- [ ] 打开 watch 页，侧边栏自动出现逐字稿（或点插件图标打开侧边栏）
- [ ] 三档显示切换正常；当前播放句黄色高亮跟随
- [ ] 点时间戳视频跳转
- [ ] 未配置任何 key 时：免费翻译自动/手动触发，进度可见，译文出现
- [ ] 选中字幕若干句 → 浮出/弹出记笔记 → 选⭐保存 → 笔记 Tab 出现
- [ ] Ctrl+Shift+N 快捷键 → 当前时间 ±5s 进入笔记编辑
- [ ] 记一条 ❓疑惑 → 点「AI 解释」（需已配 LLM）→ 解释可保存
- [ ] AI 摘要 Tab 生成（需 LLM）→ 结构四段完整、时间戳可点
- [ ] 单条笔记复制 → 粘贴出 markdown 格式正确
- [ ] 导出：融合笔记打开为 .md（含摘要分节+嵌入笔记+知识点）；「仅笔记」「含逐字稿附录」两种选项生效
- [ ] 换第二个视频 → 笔记 Tab 只显示新视频；📚 库里两个视频都在，条数正确
- [ ] 📚 点第一个视频 → 复制/跳转可用；跳转打开原视频并定位时间点
- [ ] ⚙️ 设置：填 LLM key → 测试连接 ✓ → 翻译通道切 LLM 后新视频翻译走 LLM
- [ ] ⚙️ 设置 Supadata key → 打开一个无字幕视频 → 逐字稿经 Supadata 生成
- [ ] 润色开关开启后重新打开视频 → 字幕带标点、术语正确
- [ ] 关闭浏览器重开 → 笔记与历史库仍在
```

- [ ] **Step 4: 全量测试**：`npx vitest run` → 全绿
- [ ] **Step 5: `npm run build` + 按清单逐项手动验收**，问题修复后重过
- [ ] **Step 6: Commit**：`git add -A && git commit -m "feat: 翻译/润色接线与 V1 手动验收清单"`

---

## 任务依赖关系

Task 1 → 2 → 3 →（4、5 可并行）→ 6 → 7 →（8 可并行）→ 9 → 10 → 11 → 12 → 13 → 14 → 15
