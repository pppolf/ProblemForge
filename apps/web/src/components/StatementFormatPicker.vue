<script setup lang="ts">
import { computed, ref } from 'vue';
import { NButton, NModal, NSelect, NFormItem, NInput, NAlert } from 'naive-ui';
import { statementFormats, type StatementFormatApplication } from '../statement-formats';

const props = withDefaults(
  defineProps<{ disabled: boolean; hasContent: boolean; sampleCount: number; compact?: boolean }>(),
  { compact: false }
);
const emit = defineEmits<{ apply: [value: StatementFormatApplication] }>();
const show = ref(false), formatId = ref<string>('interactive');
const selected = computed(() => statementFormats.find(format => format.id === formatId.value) ?? statementFormats[0]);
const isCommunication = computed(() => selected.value.id === 'communication');
function apply(mode: StatementFormatApplication['mode']) {
  if (props.disabled) return;
  emit('apply', { body: selected.value.body, mode });
  show.value = false;
}
</script>

<template>
  <NButton v-if="compact" size="small" secondary :disabled="disabled" @click="show = true">交互 / 通信格式</NButton>
  <div v-else class="statement-format-toolbar">
    <span class="muted">交互题与通信题可直接套用通用题面格式。</span>
    <NButton size="small" :disabled="disabled" @click="show = true">交互 / 通信格式</NButton>
  </div>
  <NModal v-model:show="show" preset="card" title="套用交互 / 通信题正文格式" style="width: min(800px, 95vw)">
    <NFormItem label="正文格式"><NSelect v-model:value="formatId" :options="statementFormats.map(format => ({ label: format.label, value: format.id }))" :disabled="disabled" /></NFormItem>
    <p>{{ selected.description }}</p>
    <p class="muted" v-if="isCommunication">正文使用标准章节命令（\InputFile、\OutputFile、\Note），直接编写题目描述即可，无需 \Description。</p>
    <p class="muted" v-else>正文使用交互章节命令（\interactor、\InteractionStart、\InteractionNotes 等），直接编写题目描述即可，无需 \Description。</p>
    <NAlert v-if="hasContent" type="warning" :show-icon="false" class="spaced">当前已有正文。「替换当前正文」会替换编辑器中的内容；也可以追加到末尾。应用后请检查并保存题面。</NAlert>
    <NInput :value="selected.body" type="textarea" readonly :autosize="{ minRows: 10, maxRows: 16 }" aria-label="题面正文格式预览" class="statement-format-preview" />
    <p class="muted" v-if="isCommunication">可在「测试数据」勾选「通信题面样例」填写四段（first / second）展示样例并绑定到本题面；在「判题配置」选择「两轮通信（first / second）」并启用 Interactor。</p>
    <p class="muted" v-else>交互示例按通信顺序写在正文中。运行交互判题时，还需在「判题配置」选择「双向交互」并设置 Interactor。</p>
    <NAlert v-if="!isCommunication && sampleCount" type="info" :show-icon="false">当前还绑定了 {{ sampleCount }} 组输入/输出样例。如交互题不使用这些样例，请在题面的样例选择框中取消引用后保存。</NAlert>
    <template #footer><div class="statement-format-actions">
      <NButton @click="show = false">取消</NButton>
      <NButton v-if="hasContent" :disabled="disabled" @click="apply('append')">追加到末尾</NButton>
      <NButton type="primary" :disabled="disabled" @click="apply('replace')">{{ hasContent ? '替换当前正文' : '插入正文' }}</NButton>
    </div></template>
  </NModal>
</template>

<style scoped>
.statement-format-toolbar { display: flex; align-items: center; justify-content: space-between; gap: 12px; flex-wrap: wrap; padding: 10px 18px; border-bottom: 1px solid var(--line-soft); }
.statement-format-preview { font-family: var(--font-mono); }
.statement-format-actions { display: flex; justify-content: flex-end; gap: 10px; flex-wrap: wrap; }
</style>
