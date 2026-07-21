/** Format a duration for logs: `42ms` under 1s, otherwise one decimal second (`8.2s`). */
export function formatDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0)
    return '0ms'
  if (ms < 1000)
    return `${Math.round(ms)}ms`
  return `${(ms / 1000).toFixed(1)}s`
}
