<script setup lang="ts">
import { onMounted, onBeforeUnmount, ref, watch } from 'vue';
import * as monaco from 'monaco-editor/esm/vs/editor/editor.api';
import EditorWorker from 'monaco-editor/esm/vs/editor/editor.worker?worker';
import 'monaco-editor/esm/vs/basic-languages/cpp/cpp.contribution';
import 'monaco-editor/esm/vs/basic-languages/python/python.contribution';
import 'monaco-editor/esm/vs/basic-languages/java/java.contribution';
import { currentThemePreset, resolvedAccent } from '../theme';

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

function syncMonacoTheme(): string {
  const preset = currentThemePreset.value;
  const accent = resolvedAccent.value;
  const m = preset.monaco;
  const keywordHex = accent.base.replace('#', '');
  const themeName = `problemforge-${preset.id}`;
  monaco.editor.defineTheme(themeName, {
    base: m.base,
    inherit: true,
    rules: [
      { token: 'comment', foreground: m.comment, fontStyle: 'italic' },
      { token: 'keyword', foreground: keywordHex, fontStyle: 'bold' },
      { token: 'keyword.section', foreground: m.keywordSection, fontStyle: 'bold' },
      { token: 'type', foreground: m.type, fontStyle: 'bold' },
      { token: 'string', foreground: m.string },
      { token: 'string.math', foreground: m.math },
      { token: 'number', foreground: m.number },
      { token: 'delimiter', foreground: m.delimiter },
    ],
    colors: {
      'editor.background': m.bg,
      'editor.foreground': m.fg,
      'editorLineNumber.foreground': m.lineNumber,
      'editorLineNumber.activeForeground': m.lineNumberActive,
      'editorCursor.foreground': accent.base,
      'editor.selectionBackground': accent.monacoSelection,
      'editor.inactiveSelectionBackground': accent.monacoInactiveSelection,
      'editor.lineHighlightBackground': m.lineHighlight,
      'editorIndentGuide.background1': m.indentGuide,
      'editorIndentGuide.activeBackground1': accent.monacoIndentActive,
      'editorWidget.background': m.widgetBg,
      'editorWidget.border': m.widgetBorder,
      'focusBorder': accent.base,
    },
  });
  return themeName;
}

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

onMounted(() => {
  const initialTheme = syncMonacoTheme();
  editor = monaco.editor.create(container.value!, {
    value: props.modelValue,
    language: props.language,
    theme: initialTheme,
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

watch([currentThemePreset, resolvedAccent], () => {
  monaco.editor.setTheme(syncMonacoTheme());
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
