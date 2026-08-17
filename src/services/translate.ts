import type { Cue } from '../types';

/** Google 翻译免费端点（translate_a/single），en→zh-CN */
export async function googleFreeTranslate(text: string): Promise<string> {
  const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=en&tl=zh-CN&dt=t&q=${encodeURIComponent(text)}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`translate ${res.status}`);
  const data = await res.json();
  return (data[0] ?? []).map((seg: any[]) => typeof seg?.[0] === 'string' ? seg[0] : '').join('');
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
        out[i]!.zh = await fn(cues[i]!.text);
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
