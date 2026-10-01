<script setup lang="ts">
import { computed } from 'vue';
import { NAlert, NCheckbox, NFormItem, NInput, NInputNumber, NSelect } from 'naive-ui';
import { formatGeneratorCommands, generatorPlanCommands, parseGeneratorCommands } from '@problemforge/contracts';

const props = defineProps<{ modelValue: any; programs: any[]; plans: any[]; tests: any[] }>();
const emit = defineEmits<{ 'update:modelValue': [value: any] }>();
const form = computed(() => props.modelValue);
const program = computed(() => props.programs.find(p => p.id === form.value.programId));
const references = computed(() => props.programs.filter(p => p.role === 'GENERATOR'));
const generators = computed(() => props.programs.filter(p => p.role === 'GENERATOR').map(p => ({ value: p.id, label: `${p.name} · v${p.version}${p.enabled ? '' : ' · 已停用'}` })));
const placeholder = computed(() => Array.from({ length: 9 }, (_, i) => `${program.value?.name ?? 'gen'} ${i + 1} ${10001 + i}`).join('\n'));
const parsed = computed(() => {
  try {
    const commands = form.value.mode === 'commands'
      ? parseGeneratorCommands(form.value.commandText, references.value)
      : generatorPlanCommands({ ...form.value, commands: undefined, argv: JSON.parse(form.value.argvText) });
    if (!Number.isInteger(form.value.numberStart) || form.value.numberStart < 1 || form.value.numberStart + commands.length - 1 > 100000) throw new Error('生成数据编号必须在 1～100000 内');
    return { commands, error: '' };
  } catch (error) { return { commands: [], error: (error as Error).message }; }
});
const overlaps = computed(() => {
  if (!form.value.enabled) return [];
  return parsed.value.commands.map((_, i) => form.value.numberStart + i).filter(number =>
    props.tests.some(test => test.number === number) || props.plans.some(plan => plan.id !== form.value.id && plan.enabled && number >= plan.data.numberStart && number < plan.data.numberStart + plan.data.count));
});
function set(key: string, value: unknown) { emit('update:modelValue', { ...form.value, [key]: value }); }
function setMode(mode: string) {
  const next = { ...form.value, mode };
  if (mode === 'commands' && !next.commandText.trim() && program.value && parsed.value.commands.length) {
    next.commandText = formatGeneratorCommands(references.value, parsed.value.commands, form.value.programId);
  }
  emit('update:modelValue', next);
}
</script>

<template>
  <NFormItem label="输入方式"><NSelect :value="form.mode" :options="[{ label: '逐行命令 · 每行一组', value: 'commands' }, { label: '固定参数 · 种子递增', value: 'repeat' }]" @update:value="setMode"/></NFormItem>
  <template v-if="form.mode === 'repeat'">
    <NFormItem label="生成器"><NSelect :value="form.programId" :options="generators" @update:value="value => set('programId', value)"/></NFormItem>
    <NFormItem label="argv（JSON 字符串数组）"><NInput :value="form.argvText" placeholder='["100"]' @update:value="value => set('argvText', value)"/></NFormItem>
    <NFormItem label="起始种子"><NInput :value="form.seed" @update:value="value => set('seed', value)"/></NFormItem>
    <NFormItem label="数量"><NInputNumber :value="form.count" :min="1" :max="100" @update:value="value => set('count', value)"/></NFormItem>
  </template>
  <NFormItem v-else label="生成命令 · 每行：生成器 参数… 种子" class="generator-plan-wide">
    <NInput :value="form.commandText" type="textarea" :autosize="{ minRows: 9, maxRows: 16 }" :maxlength="200000" :placeholder="placeholder" class="generator-command-input" @update:value="value => set('commandText', value)"/>
  </NFormItem>
  <NFormItem label="起始编号"><NInputNumber :value="form.numberStart" :min="1" :max="100000" @update:value="value => set('numberStart', value)"/></NFormItem>
  <NFormItem label="分组"><NInput :value="form.groupName" @update:value="value => set('groupName', value)"/></NFormItem>
  <NFormItem label="用途"><NCheckbox :checked="form.isSample" @update:checked="value => set('isSample', value)">题面样例</NCheckbox></NFormItem>
  <div class="generator-plan-wide generator-plan-preview">
    <p class="generator-plan-help" v-if="form.mode === 'commands'">直接粘贴命令，首项是本题生成器的程序名称，末项是种子，中间是参数。每行一组，可使用不同生成器；空行忽略，含空格的参数可加引号。保存后再点击「执行生成计划」。</p>
    <NAlert v-if="parsed.error" :type="form.mode === 'commands' && !form.commandText.trim() ? 'info' : 'error'" :show-icon="false">{{ parsed.error }}</NAlert>
    <template v-else>
      <p><strong>共 {{ parsed.commands.length }} 组 · #{{ form.numberStart }}～#{{ form.numberStart + parsed.commands.length - 1 }}</strong></p>
      <NAlert v-if="overlaps.length" type="warning" :show-icon="false">编号 {{ overlaps.slice(0, 12).map(number => `#${number}`).join('、') }}{{ overlaps.length > 12 ? ' 等' : '' }} 与已有数据或启用的计划重叠。收集时不会覆盖已有数据；请调整起始编号，已收集的计划可取消「启用」。</NAlert>
      <div class="table-scroll"><table class="data-table"><thead><tr><th>数据编号</th><th>生成器</th><th>参数 argv</th><th>种子</th></tr></thead><tbody><tr v-for="(command, index) in parsed.commands" :key="index"><td>#{{ form.numberStart + index }}</td><td>{{ references.find(program => program.id === (command.programId ?? form.programId))?.name }}</td><td><code>{{ JSON.stringify(command.argv) }}</code></td><td><code>{{ command.seed }}</code></td></tr></tbody></table></div>
    </template>
  </div>
</template>
