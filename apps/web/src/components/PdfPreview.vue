<script setup lang="ts">
import { NEmpty } from 'naive-ui';
import DeferredPanel from './DeferredPanel.vue';

defineProps<{ artifactId?: string }>();
const emit = defineEmits<{ loaded: [] }>();
const loadRenderer = () => import('./PdfRenderer.vue');
</script>

<template>
  <DeferredPanel v-if="artifactId" :load="loadRenderer" label="PDF 预览" :artifact-id="artifactId" @loaded="emit('loaded')" />
  <div v-else class="pdf-preview"><div class="pdf-canvas"><NEmpty description="选择成功构建，预览真实 PDF" /></div></div>
</template>
