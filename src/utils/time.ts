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

/** 时间戳的 Markdown 跳转链接：[mm:ss](watch?v=…&t=…s)——笔记/金句复制与融合导出共用，格式一致性只此一处定义 */
export const mdTimestampLink = (videoId: string, sec: number): string =>
  `[${formatTime(sec)}](${tsLink(videoId, sec)})`;
