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
