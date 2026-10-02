<script setup lang="ts">
import { onMounted, onBeforeUnmount, ref, watch } from 'vue';
import * as monaco from 'monaco-editor/esm/vs/editor/editor.api';
import EditorWorker from 'monaco-editor/esm/vs/editor/editor.worker?worker';
import 'monaco-editor/esm/vs/basic-languages/cpp/cpp.contribution';
import 'monaco-editor/esm/vs/basic-languages/python/python.contribution';
import 'monaco-editor/esm/vs/basic-languages/java/java.contribution';
const props = withDefaults(defineProps<{ modelValue: string; language?: string; readonly?: boolean }>(), { language: 'latex', readonly: false });
const emit = defineEmits<{ 'update:modelValue': [value: string] }>();
const container = ref<HTMLDivElement>(); let editor: monaco.editor.IStandaloneCodeEditor | undefined; let updating = false;
self.MonacoEnvironment = { getWorker: () => new EditorWorker() };
if (!monaco.languages.getLanguages().some(l => l.id === 'latex')) {
  monaco.languages.register({ id: 'latex' });
  monaco.languages.setMonarchTokensProvider('latex', { tokenizer: { root: [[/%.*$/, 'comment'], [/\\[a-zA-Z@]+|\\./, 'keyword'], [/[{}$]/, 'delimiter']] } });
}
onMounted(() => { editor = monaco.editor.create(container.value!, { value: props.modelValue, language: props.language, theme: 'vs', readOnly: props.readonly, automaticLayout: true, minimap: { enabled: false }, fontSize: 14, lineNumbersMinChars: 3, scrollBeyondLastLine: false, wordWrap: 'on', tabSize: 2, padding: { top: 12 }, ariaLabel: `${props.language} 源码编辑器` }); editor.onDidChangeModelContent(() => { if (!updating) emit('update:modelValue', editor!.getValue()); }); });
watch(() => props.modelValue, value => { if (editor && value !== editor.getValue()) { updating = true; editor.setValue(value); updating = false; } });
watch(() => props.readonly, readOnly => editor?.updateOptions({ readOnly }));
watch(() => props.language, language => { const model = editor?.getModel(); if (model) monaco.editor.setModelLanguage(model, language); editor?.updateOptions({ ariaLabel: `${language} 源码编辑器` }); });
onBeforeUnmount(() => { const model = editor?.getModel(); editor?.dispose(); model?.dispose(); });
</script>
<template><div ref="container" class="source-editor"></div></template>
