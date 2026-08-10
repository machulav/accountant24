/** Format a millisecond duration for compact UI display: "1s", "6s", "45s",
 *  "6m 23s". Sub-second durations round up to "1s" — a plain floor would show
 *  a puzzling "0s". */
export const formatDuration = (ms: number) => {
  const seconds = Math.max(1, Math.floor(ms / 1000));
  if (seconds < 60) return `${seconds}s`;
  return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
};
