<script setup lang="ts">
import { ref, watch, onBeforeUnmount } from 'vue';
import { NModal, NInput, NButton, useMessage } from 'naive-ui';
import { draftExport } from '../draft-state';
const url = ref(''), message = useMessage();
function release() { if(url.value) URL.revokeObjectURL(url.value); url.value=''; }
watch(draftExport, value => { release(); if(value) url.value=URL.createObjectURL(new Blob([value.json],{type:'application/json;charset=utf-8'})); });
onBeforeUnmount(release);
async function copy() { try { await navigator.clipboard.writeText(draftExport.value?.json ?? '');message.success('本地草稿已复制'); } catch { message.warning('复制受浏览器限制，请在下方全选并复制草稿'); } }
</script>
<template><NModal :show="!!draftExport" preset="card" title="取回本地草稿" style="width:min(760px,94vw)" @update:show="value => { if(!value) draftExport=null; }"><p>草稿包含当前输入和保存基准版本。下载或复制后，再与服务端内容对照合并；此操作不会修改服务端。</p><div class="panel-toolbar"><a :href="url" :download="draftExport?.name">下载 JSON 文件</a><NButton @click="copy">复制草稿 JSON</NButton><NButton @click="draftExport=null">返回编辑</NButton></div><NInput :value="draftExport?.json" type="textarea" readonly aria-label="本地草稿 JSON" :autosize="{minRows:8,maxRows:18}"/></NModal></template>
