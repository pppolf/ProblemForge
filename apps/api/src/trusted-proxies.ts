import { isIP } from 'node:net';

// Trust only explicitly configured proxy peers; direct requests keep their socket IP.
export function trustedProxies(value: string | undefined): false | string[] {
  if (!value?.trim()) return false;
  const entries = value.split(',').map(entry => entry.trim());
  for (const entry of entries) {
    const [address, prefix, ...extra] = entry.split('/');
    const version = isIP(address);
    if (!version || extra.length || (prefix !== undefined && (!/^\d+$/.test(prefix) || Number(prefix) < 1 || Number(prefix) > (version === 4 ? 32 : 128)))) {
      throw new Error('API_TRUSTED_PROXIES 必须为逗号分隔的代理 IP 或 CIDR，不能信任全部地址');
    }
  }
  return [...new Set(entries)];
}
