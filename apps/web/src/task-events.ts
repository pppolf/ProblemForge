import { onMounted, onBeforeUnmount, ref, watch, type WatchStopHandle } from 'vue';

export type TaskEvents = { builds: {id:string;state:string;createdAt:string;updatedAt:string;cacheSourceId?:string|null}[]; runs: {id:string;state:string;createdAt:string;updatedAt:string;completed:number;total:number;stage:string;accepted?:boolean|null}[] };
type Scope = { problemId?: string; contestId?: string };

// Events carry server metadata; data is reloaded through the usual authenticated API.
export function useTaskEvents(refresh: (events?: TaskEvents) => unknown, scope?: Scope | (() => Scope), watched?: () => {buildIds?:string[];runIds?:string[]}) {
  const connected = ref(false); let stream: EventSource | undefined, fallback: ReturnType<typeof setInterval>, refreshing = false;
  let stop: WatchStopHandle | undefined;
  const load = async (events?:TaskEvents) => { if (refreshing) return; refreshing = true; try { await refresh(events); } catch { /* The page's API error state remains authoritative. */ } finally { refreshing = false; } };
  onMounted(() => {
    stop = watch(() => {
      const ids = watched?.();
      return new URLSearchParams(Object.entries({ ...(typeof scope === 'function' ? scope() : scope ?? {}), buildIds: ids?.buildIds?.join(','), runIds: ids?.runIds?.join(',') }).filter((entry): entry is [string,string] => !!entry[1])).toString();
    }, query => {
      stream?.close(); connected.value = false;
      const current = stream = new EventSource(`/api/events?${query}`);
      current.onopen = () => { if (stream === current) connected.value = true; };
      current.onerror = () => { if (stream === current) connected.value = false; };
      current.addEventListener('tasks', event => { if (stream === current) void load(JSON.parse((event as MessageEvent).data)); });
      current.addEventListener('access-revoked', () => { if (stream === current) { connected.value = false; current.close(); void load(); } });
    }, { immediate: true });
    fallback = setInterval(() => { if (!connected.value) void load(); }, 10000);
  });
  onBeforeUnmount(() => { stop?.(); stream?.close(); clearInterval(fallback); });
  return connected;
}
