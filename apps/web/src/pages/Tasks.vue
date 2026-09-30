<script setup lang="ts">
import { onMounted, onBeforeUnmount, ref } from 'vue';
import { NButton, NTag, NModal, NAlert, NEmpty, useMessage } from 'naive-ui';
import { api, type Build } from '../api';
import PdfPreview from '../components/PdfPreview.vue';
const builds = ref<Build[]>([]); const selected = ref<Build>(); const show = ref(false); const message = useMessage(); let timer: ReturnType<typeof setInterval>;
async function load() { try { builds.value = await api('/builds'); if (selected.value) selected.value = await api(`/builds/${selected.value.id}`); } catch (e) { message.error((e as Error).message); } }
onMounted(() => { load(); timer = setInterval(() => { if (builds.value.some(b => ['RUNNING', 'QUEUED'].includes(b.state))) load(); }, 2000); }); onBeforeUnmount(() => clearInterval(timer));
async function inspect(id: string) { selected.value = await api(`/builds/${id}`); show.value = true; }
</script>
<template><div class="page-heading"><div><h1>任务中心</h1><p>查看后台保存的任务状态、日志和历史产物</p></div><NButton @click="load">刷新</NButton></div><div class="panel"><table v-if="builds.length" class="data-table"><thead><tr><th>任务</th><th>状态</th><th>创建时间</th><th></th></tr></thead><tbody><tr v-for="b in builds" :key="b.id"><td>{{ b.kind }}<small>{{ b.purpose }} · {{ b.id }}</small></td><td><NTag :type="b.state === 'SUCCEEDED' ? 'success' : b.state === 'FAILED' ? 'error' : 'default'">{{ b.state }}</NTag></td><td>{{ new Date(b.createdAt).toLocaleString('zh-CN') }}</td><td><NButton size="small" @click="inspect(b.id)">日志与产物</NButton></td></tr></tbody></table><NEmpty v-else description="没有任务" class="empty"/></div><NModal v-model:show="show" preset="card" title="构建记录" style="width: min(1100px, 95vw)"><template v-if="selected"><NAlert v-if="selected.errorCode" type="error">{{ selected.errorCode }}</NAlert><PdfPreview v-if="selected.artifacts.length" :artifact-id="selected.artifacts[0].id"/><pre class="build-log">{{ selected.log || selected.state }}</pre></template></NModal></template>
