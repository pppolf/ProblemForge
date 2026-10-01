<script setup lang="ts">
import { ref, watch, onMounted } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { NButton, NInput, NModal, NFormItem, NTag, NEmpty, NCheckbox, NAlert, useMessage } from 'naive-ui';
import { api } from '../api';
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
<template><div class="page-heading"><div><h1>题目</h1><p>搜索私有题目；按创建时间从新到旧分页，最近修改时间单独显示。</p></div><RouterLink v-if="lastProblem" :to="lastProblem">继续上次题目</RouterLink><RouterLink to="/import">导入题包</RouterLink><NButton type="primary" @click="show=true">＋ 创建题目</NButton></div><NAlert v-if="error" type="error" class="spaced">{{error}} <NButton text @click="latest">回到最新一页</NButton></NAlert><div class="panel"><form class="panel-toolbar" style="gap:12px;flex-wrap:wrap" @submit.prevent="search"><NInput v-model:value="filter" placeholder="搜索名称、标签或负责人" style="max-width:360px" clearable/><NCheckbox v-model:checked="archived">包含已归档</NCheckbox><NButton type="primary" attr-type="submit" :loading="loading">搜索</NButton><span class="muted">本页 {{problems.length}} 道题目</span></form><table v-if="problems.length" class="data-table"><thead><tr><th>题目名称</th><th>标签 / 负责人</th><th>文稿</th><th>最近更新</th><th></th></tr></thead><tbody><tr v-for="p in problems" :key="p.id"><td><RouterLink :to="'/problems/'+p.id" class="problem-title">{{p.title}}</RouterLink> <NTag v-if="p.archived" size="small">已归档</NTag><small>{{p.id}}</small></td><td><NTag v-for="tag in p.tags" :key="tag" size="small">{{tag}}</NTag><small>{{person(p.responsibleId)}}</small></td><td>{{p._count.documents}} 份独立文稿</td><td>{{new Date(p.updatedAt).toLocaleString('zh-CN')}}</td><td><NButton size="small" @click="router.push('/problems/'+p.id)">打开工作区</NButton></td></tr></tbody></table><NEmpty v-else :description="loading?'加载题目…':'没有匹配的题目'" class="empty"/><div class="panel-toolbar"><span class="muted">搜索条件和当前页保存在地址中</span><div class="p4-toolbar"><NButton :disabled="loading" @click="latest">最新一页</NButton><NButton :disabled="loading || !previous.length" @click="back">上一页</NButton><NButton :disabled="loading || !nextCursor" @click="next">下一页</NButton></div></div></div><NModal v-model:show="show" preset="card" title="创建私有题目" style="width:460px"><NFormItem label="题目名称"><NInput v-model:value="title" placeholder="例如：A + B" :maxlength="160" @keydown.enter="create"/></NFormItem><p class="muted">将分别创建简体中文题面、文档题解和 Beamer 题解。</p><NButton type="primary" :disabled="!title.trim()" :loading="creating" @click="create">创建并编辑</NButton></NModal></template>
