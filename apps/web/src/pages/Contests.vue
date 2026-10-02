<script setup lang="ts">
import{ref,onMounted}from'vue';import{useRouter}from'vue-router';import{NButton,NInput,NModal,NFormItem,useMessage}from'naive-ui';import{api}from'../api';
import AppIcon from '../components/AppIcon.vue';
const contests=ref<any[]>([]),title=ref(''),show=ref(false),router=useRouter(),message=useMessage();
onMounted(async()=>{try{contests.value=await api('/contests');}catch(e){message.error((e as Error).message);}});
async function create(){try{const c=await api('/contests',{method:'POST',body:JSON.stringify({expectedVersion:0,data:{title:title.value,author:'',stage:'',dateHeader:'',dateCover:'',language:'zh-CN',templates:{STATEMENT:null,EDITORIAL_DOCUMENT:null,EDITORIAL_BEAMER:null},items:[]}})});await router.push(`/contests/${c.id}`);}catch(e){message.error((e as Error).message);}}
</script>
<template>
  <div class="page-heading"><div><span class="page-kicker">CONTEST COLLECTION</span><h1>比赛</h1><p>汇集精彩题目，编排属于你的比赛。</p></div><NButton type="primary" @click="show=true"><template #icon><AppIcon name="plus" :size="18" /></template>创建比赛</NButton></div>
  <div class="panel">
    <div class="panel-toolbar"><strong>比赛列表</strong><span class="list-count">共 <strong>{{contests.length}}</strong> 场比赛</span></div>
    <table class="data-table" v-if="contests.length"><thead><tr><th>比赛名称</th><th>编排版本</th><th>最近更新</th><th></th></tr></thead><tbody><tr v-for="c in contests" :key="c.id"><td><RouterLink :to="`/contests/${c.id}`" class="problem-title">{{c.title}}</RouterLink><small>{{c.id}}</small></td><td>v{{c.version}}</td><td>{{new Date(c.updatedAt).toLocaleString('zh-CN')}}</td><td><NButton size="small" @click="router.push(`/contests/${c.id}`)">打开比赛</NButton></td></tr></tbody></table>
    <div v-else class="empty-state"><div class="empty-illustration"><AppIcon name="contests" :size="32" /></div><h2>下一场精彩，由你编排</h2><p>选择已冻结的题目，统一生成题册、文档题解与演示文稿。</p><NButton @click="show=true"><template #icon><AppIcon name="plus" :size="16" /></template>创建第一场比赛</NButton></div>
  </div>
  <NModal v-model:show="show" title="创建私有比赛" preset="card" style="width:480px"><NFormItem label="比赛名称"><NInput v-model:value="title" :maxlength="160" :input-props="{ 'aria-label': '比赛名称' }" placeholder="例如：程序设计竞赛 · 秋季赛" /></NFormItem><NButton type="primary" :disabled="!title.trim()" @click="create">创建</NButton></NModal>
</template>
