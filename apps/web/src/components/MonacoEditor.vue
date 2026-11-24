<script setup lang="ts">
import { onMounted, onBeforeUnmount, ref, watch } from 'vue';
import * as monaco from 'monaco-editor/esm/vs/editor/editor.api';
import EditorWorker from 'monaco-editor/esm/vs/editor/editor.worker?worker';
import 'monaco-editor/esm/vs/basic-languages/cpp/cpp.contribution';
import 'monaco-editor/esm/vs/basic-languages/python/python.contribution';
import 'monaco-editor/esm/vs/basic-languages/java/java.contribution';
import { themeMode } from '../theme';

const props = withDefaults(
  defineProps<{
    modelValue: string;
    language?: string;
    readonly?: boolean;
    insertRequest?: { id: number; text: string } | null;
  }>(),
  { language: 'latex', readonly: false, insertRequest: null }
);
const emit = defineEmits<{ 'update:modelValue': [value: string] }>();
const container = ref<HTMLDivElement>();
let editor: monaco.editor.IStandaloneCodeEditor | undefined;
let updating = false;

self.MonacoEnvironment = { getWorker: () => new EditorWorker() };

monaco.editor.defineTheme('problemforge-light', {
  base: 'vs', inherit: true,
  rules: [
    { token: 'comment', foreground: '64748b', fontStyle: 'italic' },
    { token: 'keyword', foreground: '4f46e5', fontStyle: 'bold' },
    { token: 'keyword.section', foreground: '2563eb', fontStyle: 'bold' },
    { token: 'type', foreground: '7c3aed', fontStyle: 'bold' },
    { token: 'string', foreground: '059669' },
    { token: 'string.math', foreground: 'b45309' },
    { token: 'number', foreground: 'd97706' },
    { token: 'delimiter', foreground: '475569' },
  ],
  colors: {
    'editor.background': '#ffffff', 'editor.foreground': '#0f172a',
    'editorLineNumber.foreground': '#94a3b8', 'editorLineNumber.activeForeground': '#334155',
    'editorCursor.foreground': '#4f46e5', 'editor.selectionBackground': '#e0e7ff',
    'editor.inactiveSelectionBackground': '#eef2ff', 'editor.lineHighlightBackground': '#f8fafc',
    'editorIndentGuide.background1': '#eef2f6', 'editorIndentGuide.activeBackground1': '#c7d2fe',
    'editorWidget.border': '#e2e8f0', 'focusBorder': '#4f46e5',
  },
});

monaco.editor.defineTheme('problemforge-dark', {
  base: 'vs-dark', inherit: true,
  rules: [
    { token: 'comment', foreground: '64748b', fontStyle: 'italic' },
    { token: 'keyword', foreground: '818cf8', fontStyle: 'bold' },
    { token: 'keyword.section', foreground: '60a5fa', fontStyle: 'bold' },
    { token: 'type', foreground: 'c084fc', fontStyle: 'bold' },
    { token: 'string', foreground: '34d399' },
    { token: 'string.math', foreground: 'fbbf24' },
    { token: 'number', foreground: 'fb923c' },
    { token: 'delimiter', foreground: '94a3b8' },
  ],
  colors: {
    'editor.background': '#111622', 'editor.foreground': '#e2e8f0',
    'editorLineNumber.foreground': '#475569', 'editorLineNumber.activeForeground': '#cbd5e1',
    'editorCursor.foreground': '#818cf8', 'editor.selectionBackground': '#312e81',
    'editor.inactiveSelectionBackground': '#1e1b4b', 'editor.lineHighlightBackground': '#161d2e',
    'editorIndentGuide.background1': '#1e293b', 'editorIndentGuide.activeBackground1': '#4338ca',
    'editorWidget.background': '#131926', 'editorWidget.border': '#222b3d', 'focusBorder': '#6366f1',
  },
});

if (!monaco.languages.getLanguages().some(l => l.id === 'latex')) {
  monaco.languages.register({ id: 'latex' });
  monaco.languages.setMonarchTokensProvider('latex', {
    tokenizer: {
      root: [
        [/(?<!\\)%.*$/, 'comment'],
        [/(\\(?:begin|end))(\s*\{)([^}]*)(\})/, ['keyword', 'delimiter', 'type', 'delimiter']],
        [/\\(?:section\*?|subsection\*?|subsubsection\*?|Description|InputFile|OutputFile|Note|interactor|InteractionNotes|includegraphics|frametitle|title|author)\b/, 'keyword.section'],
        [/\$\$/, { token: 'string.math', next: '@mathDisplay' }],
        [/\\\[/, { token: 'string.math', next: '@mathBracket' }],
        [/(?<!\\)\$/, { token: 'string.math', next: '@mathInline' }],
        [/\\[a-zA-Z@]+\*?/, 'keyword'],
        [/\\./, 'keyword'],
        [/[{}[\]&]/, 'delimiter'],
      ],
      mathDisplay: [
        [/\$\$/, { token: 'string.math', next: '@pop' }],
        [/\\[a-zA-Z@]+/, 'keyword'],
        [/[^$\\]+/, 'string.math'],
        [/./, 'string.math'],
      ],
      mathBracket: [
        [/\\\]/, { token: 'string.math', next: '@pop' }],
        [/\\[a-zA-Z@]+/, 'keyword'],
        [/[^\\]+/, 'string.math'],
        [/./, 'string.math'],
      ],
      mathInline: [
        [/(?<!\\)\$/, { token: 'string.math', next: '@pop' }],
        [/\\[a-zA-Z@]+/, 'keyword'],
        [/[^$\\]+/, 'string.math'],
        [/./, 'string.math'],
      ],
    },
  });
}

const monacoThemeName = () => (themeMode.value === 'dark' ? 'problemforge-dark' : 'problemforge-light');

onMounted(() => {
  editor = monaco.editor.create(container.value!, {
    value: props.modelValue,
    language: props.language,
    theme: monacoThemeName(),
    readOnly: props.readonly,
    automaticLayout: true,
    minimap: { enabled: false },
    fontFamily: '"JetBrains Mono", "SF Mono", "Fira Code", "Cascadia Code", ui-monospace, Menlo, Consolas, monospace',
    fontSize: 13.5,
    lineHeight: 22,
    lineNumbersMinChars: 3,
    scrollBeyondLastLine: false,
    wordWrap: 'on',
    tabSize: 2,
    padding: { top: 14, bottom: 14 },
    ariaLabel: `${props.language} 源码编辑器`,
  });
  editor.onDidChangeModelContent(() => {
    if (!updating) emit('update:modelValue', editor!.getValue());
  });
});

watch(themeMode, () => {
  monaco.editor.setTheme(monacoThemeName());
});
watch(() => props.modelValue, value => {
  if (editor && value !== editor.getValue()) {
    updating = true;
    editor.setValue(value);
    updating = false;
  }
});
watch(() => props.readonly, readOnly => editor?.updateOptions({ readOnly }));
watch(() => props.language, language => {
  const model = editor?.getModel();
  if (model) monaco.editor.setModelLanguage(model, language);
  editor?.updateOptions({ ariaLabel: `${language} 源码编辑器` });
});
watch(() => props.insertRequest?.id, () => {
  const text = props.insertRequest?.text;
  if (!editor || !text || props.readonly) return;
  const selection = editor.getSelection() ?? new monaco.Range(1, 1, 1, 1);
  editor.executeEdits('snippet', [{ range: selection, text, forceMoveMarkers: true }]);
  editor.focus();
});
onBeforeUnmount(() => {
  const model = editor?.getModel();
  editor?.dispose();
  model?.dispose();
});
</script>
<template><div ref="container" class="source-editor"></div></template>
