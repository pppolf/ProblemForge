<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { NButton, NCheckbox, NEmpty } from 'naive-ui';

const props = defineProps<{ tests: any[]; writable: boolean; busy: boolean }>();
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
    <span>共 {{ tests.length }} 组<span v-if="writable"> · 已选 {{ selected.length }} 组</span></span>
    <div class="toolbar-right">
      <NButton :disabled="busy" @click="emit('refresh')">刷新数据</NButton>
      <NButton v-if="writable" type="error" secondary :disabled="busy || !selected.length" @click="emit('delete', selected)">删除所选<span v-if="selected.length">（{{ selected.length }}）</span></NButton>
    </div>
  </div>
  <div v-if="tests.length" class="table-scroll">
    <table class="data-table">
      <thead><tr>
        <th v-if="writable"><NCheckbox :checked="allSelected" :indeterminate="selected.length > 0 && !allSelected" :disabled="busy" aria-label="全选测试数据" @update:checked="checked => selectedIds = checked ? tests.map(test => test.id) : []"/></th>
        <th>编号 / 分组</th><th>输入 / 答案</th><th>版本与重复提醒</th><th v-if="writable">操作</th>
      </tr></thead>
      <tbody><tr v-for="test in tests" :key="test.id">
        <td v-if="writable"><NCheckbox :checked="selectedIds.includes(test.id)" :disabled="busy" :aria-label="`选择数据 #${test.number}`" @update:checked="checked => select(test.id, checked)"/></td>
        <td>#{{ test.number }} · {{ test.groupName }}<small>{{ test.isSample ? '题面样例' : '私有测试' }}{{ test.enabled ? '' : ' · 已停用' }}</small></td>
        <td>
          <a :href="`/api/test-revisions/${test.currentRevision.id}/input`">输入 · {{ test.currentRevision.inputBytes }} bytes</a>
          <small><a v-if="test.currentRevision.answerHash" :href="`/api/test-revisions/${test.currentRevision.id}/answer`">答案 · {{ test.currentRevision.answerBytes }} bytes</a><span v-else>尚无答案，运行主标程后显式收集</span></small>
        </td>
        <td>v{{ test.version }} · {{ test.currentRevision.inputHash.slice(0, 12) }}<small v-if="test.duplicates.length" class="duplicate-warning">重复：{{ test.duplicates.map((duplicate: any) => `#${duplicate.number}`).join('、') }}</small></td>
        <td v-if="writable"><div class="toolbar-right">
          <NButton size="small" :disabled="busy" @click="emit('edit', test)">编辑</NButton>
          <NButton size="small" type="error" secondary :disabled="busy" @click="emit('delete', [test])">删除</NButton>
        </div></td>
      </tr></tbody>
    </table>
  </div>
  <NEmpty v-else description="尚无正式数据" class="empty"/>
</template>
