<script setup lang="ts">
import { computed, ref } from 'vue';
import { NInput, NButton, NAlert, useMessage } from 'naive-ui';
import { bytesBase64 } from '../api';
const props = withDefaults(defineProps<{ modelValue: string; label: string; readonly?: boolean }>(), { readonly: false });
const emit = defineEmits<{ 'update:modelValue': [value: string] }>();
const input = ref<HTMLInputElement>(); const message = useMessage();
const bytes = computed(() => Uint8Array.from(atob(props.modelValue), c => c.charCodeAt(0)));
const text = computed(() => { try { return new TextDecoder('utf-8', { fatal: true }).decode(bytes.value); } catch { return null; } });
function change(value: string) { emit('update:modelValue', bytesBase64(new TextEncoder().encode(value))); }
async function upload(event: Event) {
  const file = (event.target as HTMLInputElement).files?.[0]; if (!file) return;
  try { if (file.size > 1_048_576) throw new Error('文件最大 1MiB'); emit('update:modelValue', bytesBase64(new Uint8Array(await file.arrayBuffer()))); }
  catch (e) { message.error((e as Error).message); } finally { (event.target as HTMLInputElement).value = ''; }
}
</script>
<template><div class="binary-input"><div class="binary-heading"><label>{{ label }} <span class="muted">{{ bytes.length }} bytes</span></label><NButton v-if="!readonly" size="small" @click="input?.click()">上传原始文件</NButton><input ref="input" type="file" hidden @change="upload"/></div><NInput v-if="text !== null" :value="text" type="textarea" :readonly="readonly" :autosize="{ minRows: 4, maxRows: 10 }" :input-props="{ 'aria-label': label }" @update:value="change"/><NAlert v-else type="info" :show-icon="false">二进制数据已载入，原始字节保留。可以上传文件替换。</NAlert></div></template>
