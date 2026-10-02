<script setup lang="ts">
import { ref, shallowRef, watch, onMounted, onBeforeUnmount, nextTick } from 'vue';
import { NButton, NSelect, NSpin, NAlert, NEmpty } from 'naive-ui';
import { getDocument, GlobalWorkerOptions, type PDFDocumentProxy, type PDFDocumentLoadingTask } from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import PdfPage from './PdfPage.vue';

GlobalWorkerOptions.workerSrc = workerUrl;
const props = defineProps<{ artifactId?: string }>();
const emit = defineEmits<{ loaded: [] }>();
const pdf = shallowRef<PDFDocumentProxy>();
const zoom = ref(0), busy = ref(false), error = ref('');
const scrollArea = ref<HTMLDivElement>(), availableWidth = ref(560);
const firstPageSize = ref({ width: 595, height: 842 });
let loading: PDFDocumentLoadingTask | undefined, request = 0, previewed = false;
let resize: ResizeObserver | undefined;

async function load() {
  const current = ++request, previous = loading;
  loading = undefined; pdf.value = undefined; error.value = ''; previewed = false;
  void previous?.destroy().catch(() => {});
  const id = props.artifactId;
  busy.value = !!id;
  if (!id) return;
  try {
    const task = getDocument({ url: `/api/artifacts/${id}/pdf`, withCredentials: true, isEvalSupported: false });
    loading = task;
    const document = await task.promise;
    if (current !== request) return;
    const first = await document.getPage(1);
    if (current !== request) return;
    const size = first.getViewport({ scale: 1 });
    firstPageSize.value = { width: size.width, height: size.height };
    pdf.value = document;
    await nextTick();
    if (current === request && scrollArea.value) scrollArea.value.scrollTop = 0;
  } catch (e) {
    if (current === request) error.value = (e as Error).message;
  } finally {
    if (current === request) busy.value = false;
  }
}
function pageLoaded() { if (!previewed) { previewed = true; emit('loaded'); } }
watch(() => props.artifactId, load, { immediate: true });
onMounted(() => {
  resize = new ResizeObserver(() => {
    const width = scrollArea.value?.clientWidth ?? 0;
    if (width > 36) availableWidth.value = width - 36;
  });
  if (scrollArea.value) resize.observe(scrollArea.value);
});
onBeforeUnmount(() => { request++; resize?.disconnect(); void loading?.destroy().catch(() => {}); });
</script>

<template>
  <div class="pdf-preview">
    <div v-if="pdf" class="pdf-toolbar">
      <span>共 {{ pdf.numPages }} 页 · 上下滚动浏览</span>
      <NSelect v-model:value="zoom" size="small" style="width: 110px" :options="[{ label: '适应宽度', value: 0 }, { label: '75%', value: 0.75 }, { label: '110%', value: 1.1 }, { label: '150%', value: 1.5 }]"/>
      <a :href="`/api/artifacts/${artifactId}/pdf`" target="_blank" rel="noopener">下载 PDF</a>
    </div>
    <NAlert v-if="error" type="error">{{ error }} <NButton size="small" @click="load">重新加载</NButton></NAlert>
    <NSpin :show="busy">
      <div ref="scrollArea" class="pdf-canvas pdf-scroll" tabindex="0" aria-label="PDF 全部页面，上下滚动浏览">
        <div v-if="pdf" class="pdf-pages">
          <PdfPage v-for="number in pdf.numPages" :key="`${artifactId}:${number}`" :document="pdf" :number="number" :zoom="zoom" :available-width="availableWidth" :default-size="firstPageSize" :scroll-area="scrollArea" @loaded="pageLoaded"/>
        </div>
        <NEmpty v-else-if="!busy && !error" description="选择成功构建，预览真实 PDF"/>
      </div>
    </NSpin>
  </div>
</template>

<style scoped>
.pdf-scroll{display:block;text-align:left;overflow-anchor:none}
.pdf-pages{display:flex;flex-direction:column;align-items:center;gap:18px;min-width:100%;width:max-content}
</style>
