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
