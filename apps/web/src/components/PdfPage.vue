<script setup lang="ts">
import { computed, ref, shallowRef, watch, onMounted, onBeforeUnmount, nextTick } from 'vue';
import { NButton } from 'naive-ui';
import type { PDFDocumentProxy, PDFPageProxy, RenderTask } from 'pdfjs-dist';

const props = defineProps<{ document: PDFDocumentProxy; number: number; zoom: number; availableWidth: number; defaultSize: { width: number; height: number }; scrollArea?: HTMLElement }>();
const emit = defineEmits<{ loaded: [] }>();
const frame = ref<HTMLDivElement>(), canvas = ref<HTMLCanvasElement>();
const page = shallowRef<PDFPageProxy>();
const visible = ref(false), ready = ref(false), error = ref('');
const size = computed(() => page.value?.getViewport({ scale: 1 }) ?? props.defaultSize);
const scale = computed(() => props.zoom || props.availableWidth / size.value.width);
const dimensions = computed(() => ({ width: `${size.value.width * scale.value}px`, height: `${size.value.height * scale.value}px` }));
let observer: IntersectionObserver | undefined, rendering: RenderTask | undefined, drawing = 0, disposed = false;

async function draw() {
  const current = ++drawing, previous = rendering;
  previous?.cancel();
  await previous?.promise.catch(() => {});
  await nextTick();
  if (disposed || current !== drawing || !canvas.value) return;
  rendering = undefined; ready.value = false; error.value = '';
  const element = canvas.value;
  // Keep every page in the scroll layout while releasing distant bitmaps.
  element.width = 0; element.height = 0;
  if (!visible.value || !page.value) return;
  try {
    const viewport = page.value.getViewport({ scale: scale.value });
    const ratio = Math.min(window.devicePixelRatio || 1, 2, Math.sqrt(12_000_000 / (viewport.width * viewport.height)));
    element.width = Math.ceil(viewport.width * ratio); element.height = Math.ceil(viewport.height * ratio);
    const task = page.value.render({ canvas: element, viewport, transform: ratio === 1 ? undefined : [ratio, 0, 0, ratio, 0, 0] });
    rendering = task;
    await task.promise;
    if (!disposed && current === drawing) { ready.value = true; emit('loaded'); }
  } catch (e) {
    if (!disposed && current === drawing && (e as Error).name !== 'RenderingCancelledException') error.value = (e as Error).message;
  }
}
async function loadPage() {
  try { const loaded = await props.document.getPage(props.number); if (!disposed) { page.value = loaded; await draw(); } }
  catch (e) { if (!disposed) error.value = (e as Error).message; }
}
onMounted(() => {
  observer = new IntersectionObserver(entries => { visible.value = entries.some(entry => entry.isIntersecting); }, { root: props.scrollArea, rootMargin: '700px 0px' });
  if (frame.value) observer.observe(frame.value);
  void loadPage();
});
watch([visible, scale], draw);
onBeforeUnmount(() => { disposed = true; drawing++; observer?.disconnect(); rendering?.cancel(); });
</script>

<template>
  <div ref="frame" class="pdf-page" :style="dimensions" role="img" :aria-label="`PDF 第 ${number} 页`" :aria-busy="visible && !ready && !error">
    <canvas ref="canvas" :style="dimensions" :class="{ 'pdf-page-pending': !ready }"/>
    <div v-if="!ready" class="pdf-page-placeholder">
      <span>第 {{ number }} 页</span>
      <template v-if="error"><span role="alert">{{ error }}</span><NButton size="small" @click="loadPage">重新加载此页</NButton></template>
      <span v-else-if="visible">正在渲染…</span>
    </div>
  </div>
</template>

<style scoped>
.pdf-page{position:relative;flex:none;background:white;box-shadow:0 2px 10px #25364b1a}
.pdf-page canvas{display:block;box-shadow:none}
.pdf-page-pending{visibility:hidden}
.pdf-page-placeholder{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:10px;padding:20px;overflow-wrap:anywhere;color:#7a879a;font-size:12px}
</style>
