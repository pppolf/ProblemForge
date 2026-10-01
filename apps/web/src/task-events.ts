import { onMounted, onBeforeUnmount, ref } from 'vue';

// Events carry server metadata; data is reloaded through the usual authenticated API.
export function useTaskEvents(refresh: () => unknown, scope?: { problemId?: string; contestId?: string }) {
  const connected = ref(false); let stream: EventSource | undefined, fallback: ReturnType<typeof setInterval>, refreshing = false;
  const load = async () => { if (refreshing) return; refreshing = true; try { await refresh(); } catch { /* The page's API error state remains authoritative. */ } finally { refreshing = false; } };
  onMounted(() => {
    const query = new URLSearchParams(Object.entries(scope ?? {}).filter((entry): entry is [string, string] => !!entry[1]));
    stream = new EventSource(`/api/events?${query}`);
    stream.onopen = () => connected.value = true;
    stream.onerror = () => connected.value = false;
    stream.addEventListener('tasks', () => void load());
    stream.addEventListener('access-revoked', () => { connected.value = false; stream?.close(); void load(); });
    fallback = setInterval(() => { if (!connected.value) void load(); }, 10000);
  });
  onBeforeUnmount(() => { stream?.close(); clearInterval(fallback); });
  return connected;
}
