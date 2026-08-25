import { afterEach, describe, expect, it, vi } from 'vitest';
import { safeSend } from './safe-send';

describe('safeSend', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('上下文正常时透传消息', () => {
    const sendMessage = vi.fn(() => Promise.resolve({ ok: true }));
    vi.stubGlobal('browser', { runtime: { sendMessage } });
    safeSend({ type: 'PLAYBACK', t: 1.5 });
    expect(sendMessage).toHaveBeenCalledWith({ type: 'PLAYBACK', t: 1.5 });
  });

  it('扩展重载后 sendMessage 同步抛 Extension context invalidated：不向上抛', () => {
    // 还原现场：孤儿 content script 在扩展重载后每次发消息的同步抛错（.catch 接不住这种）
    vi.stubGlobal('browser', {
      runtime: { sendMessage: () => { throw new Error('Extension context invalidated.'); } },
    });
    expect(() => safeSend({ type: 'PLAYBACK', t: 1 })).not.toThrow();
  });

  it('消息 Promise 拒绝（对端不存在等）也被吞掉', async () => {
    vi.stubGlobal('browser', {
      runtime: { sendMessage: () => Promise.reject(new Error('Could not establish connection')) },
    });
    expect(() => safeSend({ type: 'PLAYBACK', t: 1 })).not.toThrow();
    // 排空微任务队列：若有未处理的 rejection 冒泡，vitest 会将其记为测试失败
    await new Promise((r) => setTimeout(r, 0));
  });
});
