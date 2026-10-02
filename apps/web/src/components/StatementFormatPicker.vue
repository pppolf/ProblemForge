<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { NButton, NModal, NSelect, NFormItem, NInput, NCheckbox, NAlert } from 'naive-ui';
import { statementFormats, type StatementFormatApplication } from '../statement-formats';

const props = defineProps<{ disabled: boolean; hasContent: boolean; sampleCount: number }>();
const emit = defineEmits<{ apply: [value: StatementFormatApplication] }>();
const show = ref(false), formatId = ref<string>('interactive'), useTitle = ref(false);
const selected = computed(() => statementFormats.find(format => format.id === formatId.value) ?? statementFormats[0]);
watch(formatId, () => { useTitle.value = false; });
function apply(mode: StatementFormatApplication['mode']) {
  if (props.disabled) return;
  emit('apply', { body: selected.value.body, mode, ...(useTitle.value && selected.value.title ? { title: selected.value.title } : {}) });
  show.value = false;
}
</script>

<template>
  <div class="statement-format-toolbar">
    <span class="muted">交互题可直接套用协议、注意事项和通信示例。</span>
    <NButton size="small" :disabled="disabled" @click="show = true">交互题格式</NButton>
  </div>
  <NModal v-model:show="show" preset="card" title="套用交互题正文格式" style="width: min(800px, 95vw)">
    <NFormItem label="正文格式"><NSelect v-model:value="formatId" :options="statementFormats.map(format => ({ label: format.label, value: format.id }))" :disabled="disabled"/></NFormItem>
    <p>{{ selected.description }}</p>
    <p class="muted">正文使用模板章节命令，如 \Description、\interactor、\InteractionNotes。请选择已支持这些命令的新版题面模板。</p>
    <NAlert v-if="hasContent" type="warning" :show-icon="false" class="spaced">当前已有正文。「替换当前正文」会替换编辑器中的内容；也可以追加到末尾。应用后请检查并保存题面。</NAlert>
    <NInput :value="selected.body" type="textarea" readonly :autosize="{ minRows: 10, maxRows: 16 }" aria-label="交互题正文格式预览" class="statement-format-preview"/>
    <div v-if="selected.title" class="statement-format-option"><NCheckbox v-model:checked="useTitle" :disabled="disabled">同时将题面标题设为「{{ selected.title }}」</NCheckbox></div>
    <p class="muted">交互示例按通信顺序写在正文中。运行交互判题时，还需在「判题配置」选择「双向交互」并设置 Interactor。</p>
    <NAlert v-if="sampleCount" type="info" :show-icon="false">当前还绑定了 {{ sampleCount }} 组输入/输出样例。如交互题不使用这些样例，请在题面的样例选择框中取消引用后保存。</NAlert>
    <template #footer><div class="statement-format-actions">
      <NButton @click="show = false">取消</NButton>
      <NButton v-if="hasContent" :disabled="disabled" @click="apply('append')">追加到末尾</NButton>
      <NButton type="primary" :disabled="disabled" @click="apply('replace')">{{ hasContent ? '替换当前正文' : '插入正文' }}</NButton>
    </div></template>
  </NModal>
</template>

<style scoped>
.statement-format-toolbar{display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap;padding:10px 18px;border-bottom:1px solid #e8edf4}
.statement-format-preview{font-family:Consolas,"Microsoft YaHei",monospace}
.statement-format-option{margin-top:14px}
.statement-format-actions{display:flex;justify-content:flex-end;gap:10px;flex-wrap:wrap}
</style>
