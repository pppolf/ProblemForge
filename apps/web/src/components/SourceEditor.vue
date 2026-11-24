<script setup lang="ts">
import DeferredPanel from './DeferredPanel.vue';

withDefaults(
  defineProps<{
    modelValue: string;
    language?: string;
    readonly?: boolean;
    insertRequest?: { id: number; text: string } | null;
  }>(),
  { language: 'latex', readonly: false, insertRequest: null }
);
const emit = defineEmits<{ 'update:modelValue': [value: string] }>();
const loadEditor = () => import('./MonacoEditor.vue');
</script>

<template>
  <DeferredPanel
    :load="loadEditor"
    label="源码编辑器"
    class="source-editor"
    :model-value="modelValue"
    :language="language"
    :readonly="readonly"
    :insert-request="insertRequest"
    @update:model-value="(value: string) => emit('update:modelValue', value)"
  />
</template>
