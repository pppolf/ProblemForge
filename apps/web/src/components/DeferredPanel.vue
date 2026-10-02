<script setup lang="ts">
import { onMounted, onBeforeUnmount, ref, shallowRef, type Component } from 'vue';
import { NButton } from 'naive-ui';

defineOptions({ inheritAttrs: false });
const props = defineProps<{ load: () => Promise<{ default: Component }>; label: string }>();
const component = shallowRef<Component>();
const busy = ref(false), failed = ref(false);
let disposed = false;
async function load() {
  if (busy.value) return;
  busy.value = true; failed.value = false;
  try {
    const loaded = await props.load();
    if (!disposed) component.value = loaded.default;
  } catch { if (!disposed) failed.value = true; }
  finally { if (!disposed) busy.value = false; }
}
onMounted(load);
onBeforeUnmount(() => { disposed = true; });
function retry() { window.location.reload(); }
</script>

<template>
  <component v-if="component" :is="component" v-bind="$attrs" />
  <div v-else class="deferred-panel" :class="$attrs.class" :role="failed ? 'alert' : 'status'" :aria-busy="busy">
    <template v-if="failed"><p>{{ label }}加载失败，请检查连接。保存其他编辑后可刷新重试。</p><NButton size="small" @click="retry">刷新页面重试</NButton></template>
    <span v-else>正在加载{{ label }}…</span>
  </div>
</template>

<style scoped>
.deferred-panel { min-height: 180px; padding: 24px; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 10px; color: var(--text-muted); background: var(--surface-soft); font-size: 13px; }
.deferred-panel p { margin: 0; }
</style>
