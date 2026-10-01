<script setup lang="ts">
import { ref, shallowRef, watch, onBeforeUnmount, nextTick } from 'vue';
import { NButton, NInputNumber, NSelect, NSpin, NAlert, NEmpty } from 'naive-ui';
import { getDocument, GlobalWorkerOptions, type PDFDocumentProxy, type RenderTask } from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
GlobalWorkerOptions.workerSrc = workerUrl;
const props = defineProps<{ artifactId?: string }>();
const emit = defineEmits<{ loaded: [] }>();
const pdf = shallowRef<PDFDocumentProxy>(); const page = ref(1); const zoom = ref(0); const busy = ref(false); const error = ref(''); const canvas = ref<HTMLCanvasElement>(); let rendering: RenderTask | undefined; let request = 0;
let drawing = 0;
async function draw() {
  const document = pdf.value; if (!document) return;
  const current = ++drawing; const previous = rendering;
  previous?.cancel(); await previous?.promise.catch(() => {}); await nextTick();
  try {
    const p = await document.getPage(page.value);
    if (current !== drawing || document !== pdf.value || !canvas.value) return;
    const element = canvas.value;
    const fit = Math.max(0.25, ((element.parentElement?.clientWidth ?? 600) - 32) / p.getViewport({ scale: 1 }).width);
    const viewport = p.getViewport({ scale: zoom.value || fit });
    const ratio = window.devicePixelRatio || 1; element.width = viewport.width * ratio; element.height = viewport.height * ratio;
    element.style.width = `${viewport.width}px`; element.style.height = `${viewport.height}px`;
    const task = p.render({ canvas: element, viewport, transform: ratio === 1 ? undefined : [ratio, 0, 0, ratio, 0, 0] });
    rendering = task; await task.promise;
    if (current === drawing && document === pdf.value) emit('loaded');
  } catch (e) { if (current === drawing && (e as Error).name !== 'RenderingCancelledException') error.value = (e as Error).message; }
}
watch(() => props.artifactId, async id => { const current = ++request; drawing++; rendering?.cancel(); await pdf.value?.destroy(); pdf.value = undefined; page.value = 1; error.value = ''; if (!id) { busy.value = false; return; } busy.value = true; try { const loaded = await getDocument({ url: `/api/artifacts/${id}/pdf`, withCredentials: true, isEvalSupported: false }).promise; if (current !== request) { await loaded.destroy(); return; } pdf.value = loaded; await draw(); } catch (e) { if (current === request) error.value = (e as Error).message; } finally { if (current === request) busy.value = false; } }, { immediate: true });
watch([page, zoom], draw);
onBeforeUnmount(() => { request++; drawing++; rendering?.cancel(); pdf.value?.destroy(); });
</script>
<template><div class="pdf-preview"><div class="pdf-toolbar" v-if="pdf"><NButton size="small" :disabled="page <= 1" @click="page--">上一页</NButton><NInputNumber v-model:value="page" :min="1" :max="pdf.numPages" size="small" style="width: 75px" /><span>/ {{ pdf.numPages }}</span><NButton size="small" :disabled="page >= pdf.numPages" @click="page++">下一页</NButton><NSelect v-model:value="zoom" size="small" style="width: 110px" :options="[{ label: '适应宽度', value: 0 }, { label: '75%', value: 0.75 }, { label: '110%', value: 1.1 }, { label: '150%', value: 1.5 }]"/><a :href="`/api/artifacts/${artifactId}/pdf`" target="_blank" rel="noopener">下载 PDF</a></div><NAlert v-if="error" type="error">{{ error }}</NAlert><NSpin :show="busy"><div class="pdf-canvas"><canvas v-show="pdf" ref="canvas"></canvas><NEmpty v-if="!pdf && !busy && !error" description="选择成功构建，预览真实 PDF" /></div></NSpin></div></template>
