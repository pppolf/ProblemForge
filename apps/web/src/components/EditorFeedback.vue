<script setup lang="ts">
import { NAlert, NButton } from 'naive-ui';
defineProps<{ dirty: boolean; saving: boolean; error?: string; version?: number; label?: string }>();
defineEmits<{export:[]}>();
</script>
<template><div class="editor-feedback"><div class="feedback-row"><span role="status" aria-live="polite">{{label || '当前草稿'}} · {{saving?'保存中…':error?'保存未成功，输入已保留':dirty?'有未保存修改':version?`已保存 v${version}`:'已保存'}}</span><NButton size="small" @click="$emit('export')">下载本地草稿</NButton></div><NAlert v-if="error" type="warning" :show-icon="false">{{error}}。本地输入保留在当前编辑器。请先下载本地草稿，再重新加载服务端版本对照合并；不会自动覆盖。</NAlert></div></template>
<style scoped>.editor-feedback{padding:12px 18px;background:#f8faff;border-bottom:1px solid #e2e7ef;font-size:13px}.feedback-row{display:flex;justify-content:space-between;align-items:center;gap:14px}.editor-feedback .n-alert{margin-top:10px}</style>
