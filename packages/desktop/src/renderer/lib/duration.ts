/** Format a millisecond duration for compact UI display: "<1s", "6s", "45s", "6m 23s". */
export const formatDuration = (ms: number) => {
  if (ms < 1000) return "<1s";
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
};
