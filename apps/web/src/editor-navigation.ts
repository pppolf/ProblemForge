import { ref, watch, onMounted, onBeforeUnmount, type Ref } from 'vue';
import { useRoute, onBeforeRouteLeave, onBeforeRouteUpdate } from 'vue-router';
import { session } from './api';

const prefix = () => 'pf:navigation:'+session.user?.id+':';
export function readNavigation(key: string) { try { return sessionStorage.getItem(prefix()+key) ?? ''; } catch { return ''; } }
export function writeNavigation(key: string, value: string) { try { sessionStorage.setItem(prefix()+key, value); } catch { /* Navigation remains usable when browser storage is unavailable. */ } }
export function rememberedChoice<T extends string>(key: string, fallback: T, options?: readonly T[]) {
  const scope = useRoute().path+':'+key, old = readNavigation(scope);
  const choice = ref(old && old.length <= 100 && (!options || options.includes(old as T)) ? old as T : fallback) as Ref<T>;
  watch(choice, value => writeNavigation(scope, value as string)); return choice;
}
export function useUnsavedGuard(pending: () => boolean) {
  const confirm = () => !pending() || window.confirm('仍有未保存或正在保存的修改，确定离开并放弃本地输入吗？可先下载本地草稿。');
  const beforeUnload = (event:BeforeUnloadEvent) => { if (pending()) {event.preventDefault(); event.returnValue='';} };
  onMounted(() => window.addEventListener('beforeunload',beforeUnload));
  onBeforeUnmount(() => window.removeEventListener('beforeunload',beforeUnload));
  onBeforeRouteLeave(confirm);
  onBeforeRouteUpdate((to,from) => to.path === from.path || confirm());
}
