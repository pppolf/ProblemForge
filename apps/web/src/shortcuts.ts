function detectMac(): boolean {
  if (typeof navigator === 'undefined') return false;
  const uaData = (navigator as Navigator & { userAgentData?: { platform?: string } }).userAgentData;
  const platform = uaData?.platform || navigator.platform || navigator.userAgent || '';
  return /Mac|iPhone|iPad|iPod/i.test(platform);
}

export const isMac = detectMac();

/** Primary modifier key label for the current OS: `⌘` on macOS, `Ctrl` on Windows/Linux. */
export const modKey = isMac ? '⌘' : 'Ctrl';

/** Format a shortcut chord such as `⌘K` / `Ctrl+K`, `⌘S` / `Ctrl+S`, `⌘+Enter` / `Ctrl+Enter`. */
export function shortcut(key: string): string {
  if (isMac) return key.length === 1 ? `⌘${key}` : `⌘+${key}`;
  return `Ctrl+${key}`;
}

export const SHORTCUT_SEARCH = shortcut('K');
export const SHORTCUT_SAVE = shortcut('S');
export const SHORTCUT_BUILD = shortcut('Enter');
