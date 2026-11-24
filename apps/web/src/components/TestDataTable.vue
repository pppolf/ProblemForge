<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { NButton, NCheckbox, NEmpty, NTag } from 'naive-ui';

const props = defineProps<{ tests: any[]; writable: boolean; busy: boolean; interactive?: boolean; communication?: boolean }>();
const displayOnlySample = computed(() => Boolean(props.interactive || props.communication));
const emit = defineEmits<{ edit: [test: any]; delete: [tests: any[]]; refresh: [] }>();
const selectedIds = ref<string[]>([]);
const selected = computed(() => props.tests.filter(test => selectedIds.value.includes(test.id)));
const allSelected = computed(() => props.tests.length > 0 && selected.value.length === props.tests.length);
watch(() => props.tests, tests => { selectedIds.value = selectedIds.value.filter(id => tests.some(test => test.id === id)); });
function select(id: string, checked: boolean) {
  selectedIds.value = checked ? [...new Set([...selectedIds.value, id])] : selectedIds.value.filter(value => value !== id);
}
</script>

<template>
  <div class="panel-toolbar">
    <span class="list-count">共 <strong>{{ tests.length }}</strong> 组<span v-if="writable"> · 已选 <strong>{{ selected.length }}</strong> 组</span></span>
    <div class="toolbar-right">
      <NButton size="small" :disabled="busy" @click="emit('refresh')">刷新数据</NButton>
      <NButton v-if="writable" size="small" type="error" secondary :disabled="busy || !selected.length" @click="emit('delete', selected)">删除所选<span v-if="selected.length">（{{ selected.length }}）</span></NButton>
    </div>
  </div>
  <div v-if="tests.length" class="table-scroll">
    <table class="data-table">
      <thead><tr>
        <th v-if="writable"><NCheckbox :checked="allSelected" :indeterminate="selected.length > 0 && !allSelected" :disabled="busy" aria-label="全选测试数据" @update:checked="checked => selectedIds = checked ? tests.map(test => test.id) : []" /></th>
        <th>编号 / 分组</th><th>输入 / 答案</th><th>版本与重复提醒</th><th v-if="writable" style="text-align: right">操作</th>
      </tr></thead>
      <tbody><tr v-for="test in tests" :key="test.id">
        <td v-if="writable"><NCheckbox :checked="selectedIds.includes(test.id)" :disabled="busy" :aria-label="`选择数据 #${test.number}`" @update:checked="checked => select(test.id, checked)" /></td>
        <td>
          <strong class="mono-num">#{{ test.number }}</strong>
          <NTag size="small" :bordered="false" style="margin-left: 6px">{{ test.groupName }}</NTag>
          <NTag v-if="test.isSample" size="small" :bordered="false" type="info" style="margin-left: 4px">{{ communication ? '通信样例' : interactive ? '交互样例' : '题面样例' }}</NTag>
          <NTag v-if="!test.enabled" size="small" :bordered="false" type="warning" style="margin-left: 4px">已停用</NTag>
          <small v-if="test.isSample && displayOnlySample">仅展示，不参与判题</small>
        </td>
        <td>
          <a :href="`/api/test-revisions/${test.currentRevision.id}/input`" class="mono-num">{{ communication && test.isSample ? '第 1 轮输入' : '输入' }} · {{ test.currentRevision.inputBytes }} B</a>
          <small v-if="communication && test.isSample && test.currentRevision.configuration?.communication">含第 1 轮输出（{{ test.currentRevision.configuration.communication.firstOutput.length }} 字）与第 2 轮输入（{{ test.currentRevision.configuration.communication.secondInput.length }} 字）</small>
          <small><a v-if="test.currentRevision.answerHash" :href="`/api/test-revisions/${test.currentRevision.id}/answer`" class="mono-num">{{ communication && test.isSample ? '第 2 轮输出' : interactive && test.isSample ? '示例输出' : '答案' }} · {{ test.currentRevision.answerBytes }} B</a><span v-else>{{ displayOnlySample && test.isSample ? '尚未填写示例输出' : '尚无答案，运行主标程后显式收集' }}</span></small>
        </td>
        <td>
          <span class="mono-id">v{{ test.version }} · {{ test.currentRevision.inputHash.slice(0, 12) }}</span>
          <small v-if="test.duplicates.length" class="duplicate-warning">重复：{{ test.duplicates.map((duplicate: any) => `#${duplicate.number}`).join('、') }}</small>
        </td>
        <td v-if="writable" style="text-align: right"><div class="toolbar-right" style="justify-content: flex-end">
          <NButton size="small" secondary :disabled="busy" @click="emit('edit', test)">编辑</NButton>
          <NButton size="small" type="error" secondary :disabled="busy" @click="emit('delete', [test])">删除</NButton>
        </div></td>
      </tr></tbody>
    </table>
  </div>
  <NEmpty v-else description="尚无正式数据" class="empty" />
</template>
