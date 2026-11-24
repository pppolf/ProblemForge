<script setup lang="ts">
import { computed } from 'vue';
import { NFormItem, NInputNumber } from 'naive-ui';
import { defaultCommunicationSettings, type JudgeSettingsValue } from '@problemforge/contracts';

const props = defineProps<{ modelValue: JudgeSettingsValue['communication']; disabled: boolean }>();
const emit = defineEmits<{ 'update:modelValue': [value: JudgeSettingsValue['communication']] }>();
const settings = computed(() => ({ ...defaultCommunicationSettings, ...props.modelValue }));
function set(key: string, value: unknown) { emit('update:modelValue', { ...settings.value, [key]: value }); }
const fields = [
  { key: 'outputLimitBytes', label: '第一轮通信输出上限 / bytes', min: 1024, max: 64_000_000 },
  { key: 'interactorTimeMs', label: 'Interactor CPU / ms', min: 50, max: 10000 },
  { key: 'interactorMemoryMb', label: 'Interactor 内存 / MiB', min: 32, max: 1024 },
  { key: 'wallTimeMs', label: '第一轮双方总墙钟 / ms', min: 500, max: 30000 },
  { key: 'idleTimeMs', label: '第一轮空闲上限 / ms', min: 100, max: 10000 },
  { key: 'transcriptBytes', label: '通信原始记录上限 / bytes', min: 1024, max: 262144 },
] as const;
</script>
<template>
  <div class="judge-form-grid">
    <NFormItem v-for="f in fields" :key="f.key" :label="f.label">
      <NInputNumber :value="settings[f.key]" :min="f.min" :max="f.max" :disabled="disabled" @update:value="v => set(f.key, v)" />
    </NFormItem>
  </div>
</template>
