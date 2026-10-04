<script setup lang="ts">
import { computed, ref } from 'vue';
import { NButton, NSelect, useMessage } from 'naive-ui';
import { programRoleLabels, type ProgramLanguage, type ProgramRole } from '@problemforge/contracts';
import { programRoleGuides, templatesFor, templateSource, type ProgramTemplate } from '../program-templates';

const props = defineProps<{ role: ProgramRole; language: ProgramLanguage; writable: boolean; initiallyExpanded: boolean }>();
const emit = defineEmits<{ apply: [template: ProgramTemplate] }>();
const expanded = ref(props.initiallyExpanded), selectedId = ref(''), message = useMessage();
const templates = computed(() => templatesFor(props.role, props.language));
const selected = computed(() => templates.value.find(t => t.id === selectedId.value) ?? templates.value[0]);
const source = computed(() => selected.value ? templateSource(selected.value, props.language)! : '');
async function copy() {
  try { await navigator.clipboard.writeText(source.value); message.success('模板代码已复制'); }
  catch { message.warning('复制失败，请选中示例代码手动复制'); }
}
</script>

<template>
  <section class="program-template-guide" aria-label="程序模板与用法">
    <div class="guide-heading"><strong>{{ programRoleLabels[role] }} · 写法参考</strong><NButton size="small" quaternary :aria-expanded="expanded" @click="expanded = !expanded">{{ expanded ? '收起模板' : '查看模板' }}</NButton></div>
    <p class="guide-purpose">{{ programRoleGuides[role] }}</p>
    <div v-if="expanded" class="guide-body">
      <template v-if="selected">
        <div class="guide-toolbar"><NSelect aria-label="程序代码模板" :value="selected.id" :options="templates.map(t => ({ label: t.title, value: t.id }))" @update:value="value => selectedId = value"/><div class="guide-actions"><NButton size="small" @click="copy">复制模板</NButton><NButton size="small" :disabled="!writable" @click="emit('apply', selected)">填入编辑器</NButton></div></div>
        <p class="guide-description">{{ selected.description }}</p>
        <ul class="guide-tips"><li v-for="tip in selected.tips" :key="tip">{{ tip }}</li></ul>
        <div class="guide-example"><span>{{ selected.exampleLabel }}</span><pre>{{ selected.example }}</pre></div>
        <pre class="guide-code" tabindex="0" role="region" aria-label="模板代码预览"><code>{{ source }}</code></pre>
        <p class="guide-footnote">示例用于说明写法，请按题意修改。填入后是未保存草稿，点击「保存程序」才会更新程序。</p>
      </template>
      <p v-else class="guide-description">当前角色暂无此语言的代码模板。生成器可切换为 C++ 或 Python 3；Validator、Checker 和 Interactor 请使用 C++ 编译配置。</p>
    </div>
  </section>
</template>

<style scoped>
.program-template-guide { min-width: 0; margin: 0 18px 18px; border: 1px solid var(--line); border-radius: 12px; padding: 14px 16px; background: var(--surface-soft); }
.guide-heading, .guide-toolbar, .guide-actions { display: flex; align-items: center; gap: 12px; }
.guide-heading { justify-content: space-between; }
.guide-heading strong { font-size: 14px; }
.guide-purpose, .guide-description, .guide-tips { font-size: 13px; color: var(--text-secondary); line-height: 1.7; }
.guide-purpose { margin: 7px 0 0; }
.guide-body { margin-top: 14px; }
.guide-toolbar .n-select { flex: 1; min-width: 160px; }
.guide-actions { flex-shrink: 0; gap: 8px; }
.guide-description { margin: 12px 0 6px; }
.guide-tips { padding-left: 20px; margin: 6px 0 12px; }
.guide-example { padding: 10px 12px; border-left: 3px solid var(--accent); background: var(--surface); }
.guide-example span { font-size: 12px; color: var(--text-muted); }
.guide-example pre { white-space: pre-wrap; overflow-wrap: anywhere; margin: 4px 0 0; font: 12px/1.7 "Cascadia Code", Consolas, monospace; }
.guide-code { max-height: 260px; overflow: auto; padding: 14px; background: var(--surface); border: 1px solid var(--line-soft); border-radius: 8px; font: 12px/1.7 "Cascadia Code", Consolas, monospace; tab-size: 4; }
.guide-code:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
.guide-footnote { font-size: 12px; color: var(--text-muted); margin: 8px 0 0; line-height: 1.7; }
@media (max-width: 640px) { .program-template-guide { margin-inline: 10px; padding: 12px; } .guide-toolbar { align-items: stretch; flex-direction: column; } .guide-actions { justify-content: flex-end; } }
</style>
