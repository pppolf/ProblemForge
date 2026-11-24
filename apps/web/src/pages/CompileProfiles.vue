<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { NButton, NModal, NInput, NSelect, NFormItem, NCheckbox, NInputNumber, NTag, useMessage } from 'naive-ui';
import { programLanguages, programLanguageLabels, isCppLanguage, type ProgramLanguage } from '@problemforge/contracts';
import { api } from '../api';
const profiles = ref<any[]>([]), draft = ref<any>(), show = ref(false), busy = ref(false); const message = useMessage();
const usesOptimization = (language: string) => language === 'C17' || isCppLanguage(language);
async function load() { try { profiles.value = await api('/compile-profiles'); } catch (e) { message.error((e as Error).message); } } onMounted(load);
function edit(p?: any) { draft.value = p ? JSON.parse(JSON.stringify(p)) : { name: '', language: 'CPP17', enabled: true, config: { optimization: 'O2', warnings: true, compileTimeMs: 10000, compileMemoryMb: 512 } }; show.value = true; }
async function save() {
  busy.value = true;
  try { const p = draft.value; await api(p.id ? `/admin/compile-profiles/${p.id}` : '/admin/compile-profiles', { method: p.id ? 'PUT' : 'POST', body: JSON.stringify({ name: p.name, language: p.language, enabled: p.enabled, config: p.config, ...(p.id ? { expectedVersion: p.version } : {}) }) }); show.value = false; await load(); message.success('编译 profile 已保存，相关历史验收将显示过期'); }
  catch (e) { message.error((e as Error).message); } finally { busy.value = false; }
}
</script>
<template>
  <div class="page-heading">
    <div><span class="page-kicker">SANDBOX TOOLCHAIN</span><h1>编译配置</h1><p>管理员维护固定语言与编译参数，版本变化会精确进入后续沙箱任务快照。</p></div>
    <NButton type="primary" @click="edit()">创建 Profile</NButton>
  </div>
  <div class="panel">
    <table class="data-table">
      <thead><tr><th>名称 / 版本</th><th>语言与选项</th><th>编译资源限制</th><th>状态</th><th></th></tr></thead>
      <tbody>
        <tr v-for="p in profiles" :key="p.id">
          <td><strong>{{ p.name }}</strong> <NTag size="small" :bordered="false" class="mono-num">v{{ p.version }}</NTag><div><span class="mono-id">{{ p.hash.slice(0, 12) }}</span></div></td>
          <td><NTag size="small" :bordered="false" type="info">{{ programLanguageLabels[p.language as ProgramLanguage] }}</NTag><span v-if="usesOptimization(p.language)" class="mono-num" style="margin-left: 8px">-{{ p.config.optimization }}</span><span v-if="p.config.warnings" class="muted" style="margin-left: 8px">· 启用警告</span></td>
          <td class="mono-num">{{ p.config.compileTimeMs }} ms / {{ p.config.compileMemoryMb }} MiB</td>
          <td><NTag size="small" :bordered="false" :type="p.enabled ? 'success' : 'default'">{{ p.enabled ? '已启用' : '已停用' }}</NTag></td>
          <td style="text-align: right"><NButton size="small" secondary @click="edit(p)">编辑</NButton></td>
        </tr>
      </tbody>
    </table>
  </div>
  <NModal v-model:show="show" preset="card" title="管理员编译 Profile" style="width: min(550px, 95vw)">
    <template v-if="draft">
      <NFormItem label="名称"><NInput v-model:value="draft.name" /></NFormItem>
      <NFormItem label="固定语言"><NSelect v-model:value="draft.language" :options="programLanguages.map(v => ({ label: programLanguageLabels[v], value: v }))" /></NFormItem>
      <NFormItem v-if="usesOptimization(draft.language)" label="优化级别"><NSelect v-model:value="draft.config.optimization" :options="['O0', 'O2'].map(v => ({ label: v, value: v }))" /></NFormItem>
      <NFormItem label="编译 CPU 限制 / ms"><NInputNumber v-model:value="draft.config.compileTimeMs" :min="1000" :max="30000" style="width: 100%" /></NFormItem>
      <NFormItem label="编译内存 / MiB"><NInputNumber v-model:value="draft.config.compileMemoryMb" :min="128" :max="1024" style="width: 100%" /></NFormItem>
      <div class="toolbar-left spaced"><NCheckbox v-model:checked="draft.enabled">启用</NCheckbox><NCheckbox v-model:checked="draft.config.warnings">编译警告</NCheckbox></div>
      <NButton type="primary" block :loading="busy" @click="save">保存版本</NButton>
    </template>
  </NModal>
</template>
