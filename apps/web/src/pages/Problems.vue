<script setup lang="ts">
import { ref, watch, onMounted } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { NButton, NInput, NModal, NFormItem, NTag, NEmpty, NCheckbox, NAlert, useMessage } from 'naive-ui';
import { api } from '../api';
import AppIcon from '../components/AppIcon.vue';
import { readNavigation, writeNavigation } from '../editor-navigation';
const problems = ref<any[]>([]), filter = ref(''), show = ref(false), title = ref(''), creating = ref(false), loading = ref(false), error = ref('');
const message = useMessage(), router = useRouter(), route = useRoute(), users = ref<any[]>([]), archived = ref(false), nextCursor = ref<string|null>(null), previous = ref<string[]>([]);
const value = (key:string) => typeof route.query[key] === 'string' ? route.query[key] as string : '';
const lastProblem = /^\/problems\/[a-zA-Z0-9_-]+$/.test(readNavigation('lastProblem')) ? readNavigation('lastProblem') : '';
const person = (id:string) => users.value.find(u=>u.id===id)?.name || '未指定';
let request = 0;
async function load() {
  const seq = ++request; loading.value = true; error.value = '';
  try {
    const query = new URLSearchParams(Object.fromEntries(['q','archived','cursor'].map(k=>[k,value(k)]).filter(([,v])=>v)));
    const result = await api('/problems/page?'+query);
    if (seq !== request) return;
    problems.value = result.rows; nextCursor.value = result.nextCursor;
    if (!value('cursor')) await router.replace({query:{...route.query,cursor:result.currentCursor}});
  } catch (e) { if (seq===request) { error.value = (e as Error).message; problems.value=[]; nextCursor.value=null; } }
  finally { if (seq===request) loading.value=false; }
}
watch(()=>JSON.stringify([value('q'),value('archived')]),()=>{filter.value=value('q');archived.value=value('archived')==='true';},{immediate:true});
watch(()=>route.fullPath,()=>{writeNavigation('problemsList',route.fullPath);void load();},{immediate:true});
onMounted(async()=>{try{users.value=(await api('/directory')).users;}catch(e){message.error((e as Error).message);}});
function search() { previous.value=[]; void router.push({query:{q:filter.value.trim() || undefined,archived:archived.value?'true':undefined}}); }
function next() { if (nextCursor.value) {previous.value.push(value('cursor'));void router.push({query:{...route.query,cursor:nextCursor.value}});} }
function back() { const cursor=previous.value.pop();if(cursor)void router.push({query:{...route.query,cursor}}); }
function latest() { previous.value=[];void router.push({query:{...route.query,cursor:undefined}}); }
async function create() { creating.value = true; try { const result = await api('/problems', { method: 'POST', body: JSON.stringify({ title: title.value, language: 'zh-CN' }) }); await router.push('/problems/'+result.id); } catch (e) { message.error((e as Error).message); } finally { creating.value = false; } }
</script>
<template>
  <div class="page-heading">
    <div><span class="page-kicker">PROBLEM LIBRARY</span><h1>题目</h1><p>让灵感成为好题，在这里完成每一次创作。</p></div>
    <div class="page-actions">
      <RouterLink v-if="lastProblem" :to="lastProblem">继续上次题目</RouterLink>
      <NButton @click="router.push('/import')"><template #icon><AppIcon name="upload" :size="17" /></template>导入题包</NButton>
      <NButton type="primary" @click="show=true"><template #icon><AppIcon name="plus" :size="18" /></template>创建题目</NButton>
    </div>
  </div>
  <NAlert v-if="error" type="error" class="spaced">{{error}} <NButton text @click="latest">回到最新一页</NButton></NAlert>
  <div class="panel">
    <form class="panel-toolbar list-toolbar" @submit.prevent="search">
      <NInput v-model:value="filter" placeholder="搜索名称、标签或负责人" :input-props="{ 'aria-label': '搜索题目' }" class="search-field" clearable><template #prefix><AppIcon name="search" :size="16" /></template></NInput>
      <NButton attr-type="submit" :loading="loading">搜索</NButton>
      <NCheckbox v-model:checked="archived">包含已归档</NCheckbox>
      <span class="list-count">本页 <strong>{{problems.length}}</strong> 道题目</span>
    </form>
    <NEmpty v-if="loading" description="加载题目…" class="empty" />
    <table v-else-if="problems.length" class="data-table">
      <thead><tr><th>题目名称</th><th>标签 / 负责人</th><th>文稿</th><th>最近更新</th><th></th></tr></thead>
      <tbody><tr v-for="p in problems" :key="p.id"><td><RouterLink :to="'/problems/'+p.id" class="problem-title">{{p.title}}</RouterLink> <NTag v-if="p.archived" size="small">已归档</NTag><small>{{p.id}}</small></td><td><NTag v-for="tag in p.tags" :key="tag" size="small">{{tag}}</NTag><small>{{person(p.responsibleId)}}</small></td><td>{{p._count.documents}} 份独立文稿</td><td>{{new Date(p.updatedAt).toLocaleString('zh-CN')}}</td><td><NButton size="small" @click="router.push('/problems/'+p.id)">打开工作区<template #icon><AppIcon name="arrow" :size="15" /></template></NButton></td></tr></tbody>
    </table>
    <div v-else-if="!error" class="empty-state">
      <div class="empty-illustration"><AppIcon :name="value('q') || value('archived') ? 'search' : 'problems'" :size="32" /></div>
      <h2>{{value('q') || value('archived') ? '没有找到匹配的题目' : '从一道好题开始'}}</h2>
      <p>{{value('q') || value('archived') ? '试试其他关键词，或调整筛选条件后重新搜索。' : '创建题目，逐步完善题面、程序与测试数据。你的创作默认保持私有。'}}</p>
      <NButton v-if="!value('q') && !value('archived')" @click="show=true"><template #icon><AppIcon name="plus" :size="16" /></template>创建第一道题目</NButton>
    </div>
    <div class="panel-toolbar list-footer"><span class="muted">按创建时间从新到旧</span><div class="p4-toolbar"><NButton size="small" :disabled="loading" @click="latest">最新一页</NButton><NButton size="small" :disabled="loading || !previous.length" @click="back">上一页</NButton><NButton size="small" :disabled="loading || !nextCursor" @click="next">下一页</NButton></div></div>
  </div>
  <NModal v-model:show="show" preset="card" title="创建私有题目" style="width:460px">
    <NFormItem label="题目名称"><NInput v-model:value="title" placeholder="例如：A + B" :input-props="{ 'aria-label': '题目名称' }" :maxlength="160" @keydown.enter="create" /></NFormItem>
    <p class="muted">将分别创建简体中文题面、文档题解和 Beamer 题解。</p><NButton type="primary" :disabled="!title.trim()" :loading="creating" @click="create">创建并编辑</NButton>
  </NModal>
</template>
