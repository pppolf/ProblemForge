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
monaco.editor.defineTheme('problemforge-light', {
  base: 'vs', inherit: true,
  rules: [
    { token: 'comment', foreground: '7b877c' },
    { token: 'keyword', foreground: '42634e' },
    { token: 'string', foreground: '8c6b35' },
    { token: 'number', foreground: 'a06045' },
    { token: 'delimiter', foreground: '69776c' },
  ],
  colors: {
    'editor.background': '#ffffff', 'editor.foreground': '#29362e',
    'editorLineNumber.foreground': '#a5afa4', 'editorLineNumber.activeForeground': '#536158',
    'editorCursor.foreground': '#42634e', 'editor.selectionBackground': '#dfead6',
    'editor.inactiveSelectionBackground': '#edf1e8', 'editor.lineHighlightBackground': '#f6f8f3',
    'editorIndentGuide.background1': '#e9ece6', 'editorIndentGuide.activeBackground1': '#cbd9c5',
    'editorWidget.border': '#dfe4dc', 'focusBorder': '#42634e',
  },
});
if (!monaco.languages.getLanguages().some(l => l.id === 'latex')) {
  monaco.languages.register({ id: 'latex' });
  monaco.languages.setMonarchTokensProvider('latex', { tokenizer: { root: [[/%.*$/, 'comment'], [/\\[a-zA-Z@]+|\\./, 'keyword'], [/[{}$]/, 'delimiter']] } });
}
onMounted(() => { editor = monaco.editor.create(container.value!, { value: props.modelValue, language: props.language, theme: 'problemforge-light', readOnly: props.readonly, automaticLayout: true, minimap: { enabled: false }, fontFamily: 'Cascadia Code, Consolas, monospace', fontSize: 14, lineHeight: 23, lineNumbersMinChars: 3, scrollBeyondLastLine: false, wordWrap: 'on', tabSize: 2, padding: { top: 16 }, ariaLabel: `${props.language} 源码编辑器` }); editor.onDidChangeModelContent(() => { if (!updating) emit('update:modelValue', editor!.getValue()); }); });
watch(() => props.modelValue, value => { if (editor && value !== editor.getValue()) { updating = true; editor.setValue(value); updating = false; } });
watch(() => props.readonly, readOnly => editor?.updateOptions({ readOnly }));
watch(() => props.language, language => { const model = editor?.getModel(); if (model) monaco.editor.setModelLanguage(model, language); editor?.updateOptions({ ariaLabel: `${language} 源码编辑器` }); });
onBeforeUnmount(() => { const model = editor?.getModel(); editor?.dispose(); model?.dispose(); });
</script>
<template><div ref="container" class="source-editor"></div></template>
