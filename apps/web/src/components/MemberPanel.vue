<script setup lang="ts">
import {ref,onMounted,computed}from'vue';
import{NButton,NSelect,NInput,NTag,NFormItem,NAlert,useMessage}from'naive-ui';
import{api}from'../api';
const props=defineProps<{scope:'problems'|'contests';id:string;owner:boolean}>();
const message=useMessage(),directory=ref<any>({users:[],groups:[]}),members=ref<any>({users:[],groups:[]});
const targetType=ref<'USER'|'GROUP'>('USER'),targetId=ref<string|null>(null),role=ref('VIEWER'),languages=ref('en');
const labels:Record<string,string>={OWNER:'负责人',EDITOR:'编辑',REVIEWER:'审题',VIEWER:'只读',TRANSLATOR:'限定语言翻译'};
const options=computed(()=>directory.value[targetType.value==='USER'?'users':'groups'].map((r:any)=>({label:r.name+(r.email?` · ${r.email}`:''),value:r.id})));
const roles=computed(()=>Object.entries(labels).filter(([key])=>!(key==='OWNER'&&targetType.value==='GROUP')&&!(key==='TRANSLATOR'&&props.scope==='contests')).map(([value,label])=>({value,label})));
async function load(){try{members.value=await api(`/${props.scope}/${props.id}/members`);if(props.owner)directory.value=await api('/directory');}catch(e){message.error((e as Error).message);}}
async function grant(){try{await api(`/${props.scope}/${props.id}/members`,{method:'PUT',body:JSON.stringify({targetType:targetType.value,targetId:targetId.value,role:role.value,languages:role.value==='TRANSLATOR'?languages.value.split(/[,，\s]+/).filter(Boolean):[]})});await load();message.success('授权已保存，后续请求按当前权限检查');}catch(e){message.error((e as Error).message);}}
async function remove(targetType:string,targetId:string){try{await api(`/${props.scope}/${props.id}/members`,{method:'DELETE',body:JSON.stringify({targetType,targetId})});await load();}catch(e){message.error((e as Error).message);}}
onMounted(load);
</script>
<template><div class="collaboration-panel"><NAlert :show-icon="false">{{scope==='contests'?'比赛成员可以使用本比赛固定的材料，不能因此编辑源题。':'翻译成员仅能编辑指定语言的正文与内容信息，可读取题目共用图片；不能查看程序、私有测试或 Judge 日志。'}}</NAlert>
<div v-if="owner" class="p4-form-row"><NFormItem label="授权对象"><NSelect v-model:value="targetType" :options="[{label:'用户',value:'USER'},{label:'用户组',value:'GROUP'}]" @update:value="targetId=null;role='VIEWER'"/></NFormItem><NFormItem label="选择成员"><NSelect v-model:value="targetId" :options="options" filterable placeholder="按名称或邮箱搜索"/></NFormItem><NFormItem label="角色"><NSelect v-model:value="role" :options="roles"/></NFormItem><NFormItem v-if="role==='TRANSLATOR'" label="语言代码，逗号分隔"><NInput v-model:value="languages"/></NFormItem><NButton type="primary" :disabled="!targetId" @click="grant">保存授权</NButton></div>
<table class="data-table"><thead><tr><th>成员 / 用户组</th><th>角色</th><th>语言范围</th><th></th></tr></thead><tbody><tr v-for="m in members.users" :key="m.userId"><td>{{m.user.name}}<small>{{m.user.email}}</small></td><td><NTag size="small">{{labels[m.role]}}</NTag></td><td>{{m.languages?.join(', ')||'—'}}</td><td><NButton v-if="owner" size="small" @click="remove('USER',m.userId)">撤销</NButton></td></tr><tr v-for="m in members.groups" :key="m.groupId"><td>{{m.group.name}}<small>用户组 · 成员变更立即生效</small></td><td><NTag size="small">{{labels[m.role]}}</NTag></td><td>{{m.languages?.join(', ')||'—'}}</td><td><NButton v-if="owner" size="small" @click="remove('GROUP',m.groupId)">撤销</NButton></td></tr></tbody></table></div></template>
