<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { useRouter } from 'vue-router';
import { NButton, NInput, NModal, NFormItem, NTag, useMessage } from 'naive-ui';
import { api } from '../api';
import { copyToClipboard } from '../clipboard';
import AppIcon from '../components/AppIcon.vue';

const contests = ref<any[]>([]), title = ref(''), show = ref(false), router = useRouter(), message = useMessage();
async function copyId(id: string) { if (await copyToClipboard(id)) message.success('比赛 ID 已复制'); else message.warning('复制失败'); }
onMounted(async () => { try { contests.value = await api('/contests'); } catch (e) { message.error((e as Error).message); } });
async function create() {
  try {
    const c = await api('/contests', { method: 'POST', body: JSON.stringify({ expectedVersion: 0, data: { title: title.value, author: '', stage: '', dateHeader: '', dateCover: '', language: 'zh-CN', templates: { STATEMENT: null, EDITORIAL_DOCUMENT: null, EDITORIAL_BEAMER: null }, items: [] } }) });
    await router.push(`/contests/${c.id}`);
  } catch (e) { message.error((e as Error).message); }
}
</script>
<template>
  <div class="page-heading">
    <div>
      <span class="page-kicker">CONTEST COLLECTION</span>
      <h1>比赛编排</h1>
      <p>汇集源题、配置题号与讲解顺序，统一生成题册、书面题解集与 Beamer 幻灯片。</p>
    </div>
    <NButton type="primary" @click="show = true"><template #icon><AppIcon name="plus" :size="17" /></template>创建比赛</NButton>
  </div>
  <div class="panel">
    <div class="panel-toolbar"><strong>比赛列表</strong><span class="list-count">共 <strong>{{ contests.length }}</strong> 场比赛</span></div>
    <table v-if="contests.length" class="data-table">
      <thead><tr><th>比赛名称</th><th>编排版本</th><th>最近更新</th><th></th></tr></thead>
      <tbody>
        <tr v-for="c in contests" :key="c.id">
          <td>
            <RouterLink :to="`/contests/${c.id}`" class="problem-title">{{ c.title }}</RouterLink>
            <div><button type="button" class="mono-id copy-chip" :title="`复制比赛 ID：${c.id}`" @click="copyId(c.id)"><span>{{ c.id }}</span><AppIcon name="copy" :size="11" /></button></div>
          </td>
          <td><NTag size="small" :bordered="false" class="mono-num">v{{ c.version }}</NTag></td>
          <td class="mono-num">{{ new Date(c.updatedAt).toLocaleString('zh-CN') }}</td>
          <td style="text-align: right"><NButton size="small" secondary type="primary" @click="router.push(`/contests/${c.id}`)">打开比赛<template #icon><AppIcon name="arrow" :size="14" /></template></NButton></td>
        </tr>
      </tbody>
    </table>
    <div v-else class="empty-state">
      <div class="empty-illustration"><AppIcon name="contests" :size="30" /></div>
      <h2>下一场精彩，由你编排</h2>
      <p>选择已有题目，统一配置模板、题号顺序与讲解顺序，一键生成整场竞赛出版资料。</p>
      <NButton type="primary" @click="show = true"><template #icon><AppIcon name="plus" :size="16" /></template>创建第一场比赛</NButton>
    </div>
  </div>
  <NModal v-model:show="show" title="创建私有比赛" preset="card" style="width: 480px">
    <NFormItem label="比赛名称"><NInput v-model:value="title" :maxlength="160" :input-props="{ 'aria-label': '比赛名称' }" placeholder="例如：程序设计竞赛 · 秋季赛" @keydown.enter="create" /></NFormItem>
    <NButton type="primary" block :disabled="!title.trim()" @click="create">创建并编排</NButton>
  </NModal>
</template>
