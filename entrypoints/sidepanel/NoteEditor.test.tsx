// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { render, fireEvent } from '@testing-library/preact';

const loadVideoData = vi.hoisted(() => vi.fn(async () => {}));
vi.mock('./state', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./state')>();
  return { ...actual, loadVideoData };
});

import * as state from './state';
import { NoteEditor } from './NoteEditor';

// 与 App 一致：仅在有编辑上下文时挂载 NoteEditor
function Host() {
  return state.noteEditorCtx.value ? <NoteEditor /> : null;
}

describe('NoteEditor 保存', () => {
  it('窗口内 cue 带 zh 时保存 excerptZh', async () => {
    const sendMsg = vi.fn(async (_msg: any) => ({}));
    vi.stubGlobal('browser', { runtime: { sendMessage: sendMsg } });
    state.noteEditorCtx.value = { start: 10, end: 20, excerpt: '' };
    state.cues.value = [
      { start: 11, dur: 2, text: 'closures capture', zh: '闭包捕获' },
      { start: 15, dur: 2, text: 'outer scope' }, // 无 zh，不拼接
      { start: 30, dur: 2, text: 'outside' },     // 窗口外
    ];
    state.videoInfo.value = { videoId: 'v', title: 't', channel: 'c', url: 'u', captionLang: 'en', fetchedAt: 1 };

    const { getByText } = render(<Host />);
    fireEvent.click(getByText('保存'));
    await vi.waitFor(() => expect(loadVideoData).toHaveBeenCalledWith('v'));
    const note = sendMsg.mock.calls[0]![0].note;
    expect(note.excerptZh).toBe('闭包捕获'); // 仅拼接有 zh 的 cue
  });

  it('窗口内 cue 均无 zh 时不存 excerptZh', async () => {
    const sendMsg = vi.fn(async (_msg: any) => ({}));
    vi.stubGlobal('browser', { runtime: { sendMessage: sendMsg } });
    state.noteEditorCtx.value = { start: 10, end: 20, excerpt: '' };
    state.cues.value = [{ start: 11, dur: 2, text: 'no zh here' }];
    state.videoInfo.value = { videoId: 'v', title: 't', channel: 'c', url: 'u', captionLang: 'en', fetchedAt: 1 };

    const { getByText } = render(<Host />);
    fireEvent.click(getByText('保存'));
    await vi.waitFor(() => expect(sendMsg).toHaveBeenCalled());
    const note = sendMsg.mock.calls[0]![0].note;
    expect(note.excerptZh).toBeUndefined();
  });
});

describe('NoteEditor 编辑已有笔记（§0.14）', () => {
  it('预填批注/类型/摘录，保存保留原 id 与 createdAt', async () => {
    const sendMsg = vi.fn(async (_msg: any) => ({}));
    vi.stubGlobal('browser', { runtime: { sendMessage: sendMsg } });
    const existing = { id: 'n1', videoId: 'v', start: 10, end: 20, excerpt: 'old excerpt', excerptZh: '旧中文', annotation: '旧批注', type: 'value' as const, createdAt: 42 };
    state.noteEditorCtx.value = { start: 10, end: 20, excerpt: existing.excerpt, note: existing };
    state.cues.value = [];
    state.videoInfo.value = { videoId: 'v', title: 't', channel: 'c', url: 'u', captionLang: 'en', fetchedAt: 1 };

    const { getByText, getByDisplayValue } = render(<Host />);
    expect((getByDisplayValue('旧批注') as HTMLTextAreaElement)).toBeTruthy();   // 预填批注
    expect((getByDisplayValue('old excerpt') as HTMLTextAreaElement)).toBeTruthy(); // 预填摘录
    expect(getByText(/编辑笔记/)).toBeTruthy();
    fireEvent.click(getByText('❓ 有疑惑'));   // 换类型
    fireEvent.click(getByText('保存'));
    await vi.waitFor(() => expect(sendMsg).toHaveBeenCalled());
    const note = sendMsg.mock.calls[0]![0].note;
    expect(note.id).toBe('n1');                 // 保留原 id → db put 覆盖而非新增
    expect(note.createdAt).toBe(42);
    expect(note.type).toBe('confusion');
    expect(note.annotation).toBe('旧批注');
  });
});
