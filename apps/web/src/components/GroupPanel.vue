<script setup lang="ts">
import { computed, ref, onMounted, watch } from 'vue';
import { NButton, NInput, NInputNumber, NSelect, NFormItem, NAlert, NEmpty, useMessage } from 'naive-ui';
import { api } from '../api';
import type { TestGroupsValue } from '@problemforge/contracts';
const props=defineProps<{problemId:string;tests:any[];programs:any[];writable:boolean}>();
const emit=defineEmits<{dirty:[value:boolean];saved:[]}>();
const message=useMessage(), groups=ref<TestGroupsValue['groups']>([]), version=ref(0), busy=ref(false), loaded=ref(false), saved=ref('[]');
const dirty=computed(()=>loaded.value&&JSON.stringify(groups.value)!==saved.value);
watch(dirty,value=>emit('dirty',value));
const testOptions=computed(()=>props.tests.filter(t=>t.enabled).map(t=>({label:`#${t.number} · ${t.groupName} · v${t.version}`,value:t.id})));
const hasDeletedMembers=computed(()=>groups.value.some(group=>group.members.some(member=>!props.tests.some(test=>test.id===member.testId))));
const validatorOptions=computed(()=>props.programs.filter(p=>p.enabled&&p.role==='EXTRA_VALIDATOR'&&p.validatorScope==='GROUPS').map(p=>({label:`${p.name} · v${p.version}`,value:p.id})));
onMounted(async()=>{try{const r=await api(`/problems/${props.problemId}/test-groups`);version.value=r.version;groups.value=r.data.groups;saved.value=JSON.stringify(groups.value);loaded.value=true;}catch(e){message.error((e as Error).message);}});
function add(){groups.value.push({id:`g${groups.value.length+1}`,points:0,aggregation:'ALL',members:[],dependencies:[],extraValidatorIds:[]});}
function fromLabels(){
  if(groups.value.length&&!window.confirm('用现有标签建立新的数据组草稿，替换当前组编辑内容？'))return;
  const map=new Map<string,TestGroupsValue['groups'][number]>();
  for(const t of props.tests.filter(t=>t.enabled)){if(!map.has(t.groupName))map.set(t.groupName,{id:t.groupName,points:0,aggregation:'ALL',members:[],dependencies:[],extraValidatorIds:[]});map.get(t.groupName)!.members.push({testId:t.id,revisionId:t.currentRevision.id,weight:1});}
  groups.value=[...map.values()];
}
function membersChanged(index:number,ids:string[]){const g=groups.value[index];g.members=ids.map(id=>g.members.find(m=>m.testId===id)??{testId:id,revisionId:props.tests.find(t=>t.id===id).currentRevision.id,weight:1});}
function updateVersions(index:number){const g=groups.value[index];g.members=g.members.map(m=>({...m,revisionId:props.tests.find(t=>t.id===m.testId)?.currentRevision.id??m.revisionId}));}
function removeDeletedMembers(){for(const group of groups.value)group.members=group.members.filter(member=>props.tests.some(test=>test.id===member.testId));}
async function save(){busy.value=true;try{const r=await api(`/problems/${props.problemId}/test-groups`,{method:'PUT',body:JSON.stringify({expectedVersion:version.value,data:{groups:groups.value}})});version.value=r.version;saved.value=JSON.stringify(groups.value);emit('saved');message.success(`数据组已保存 v${version.value}`);}catch(e){message.error((e as Error).message);}finally{busy.value=false;}}
</script>
<template><div class="settings-pane"><div class="document-toolbar"><span>{{dirty?'未保存修改':`数据组 v${version}`}} · 满分 {{groups.reduce((s,g)=>s+g.points,0)}}</span><div class="toolbar-right"><NButton v-if="writable" @click="fromLabels">按现有标签建立草稿</NButton><NButton v-if="writable" @click="add">添加数据组</NButton><NButton v-if="writable" type="primary" :loading="busy" @click="save">保存数据组</NButton></div></div>
<NAlert type="info" :show-icon="false">组成员固定具体数据版本。更新、停用或删除数据后请显式重选；原分组标签不会自动变成计分配置。组依赖未全过时本组计零。</NAlert>
<NAlert v-if="hasDeletedMembers" type="warning" :show-icon="false">部分成员数据已删除，请移除旧成员，选择需要的新数据后保存。空组需补充成员或移除整组。<div v-if="writable" class="report-actions"><NButton size="small" @click="removeDeletedMembers">从草稿移除已删除的成员</NButton></div></NAlert>
<div v-for="(g,index) in groups" :key="index" class="group-editor"><div class="judge-form-grid"><NFormItem label="组标识"><NInput v-model:value="g.id" :disabled="!writable"/></NFormItem><NFormItem label="组满分"><NInputNumber v-model:value="g.points" :min="0" :max="10000" :precision="0" :disabled="!writable"/></NFormItem><NFormItem label="组内计分"><NSelect v-model:value="g.aggregation" :options="[{label:'全部通过得整组分',value:'ALL'},{label:'按显式数据权重累计',value:'WEIGHTED'}]" :disabled="!writable"/></NFormItem><NFormItem label="依赖组（全部通过才解锁）"><NSelect v-model:value="g.dependencies" multiple :options="groups.filter(x=>x!==g).map(x=>({label:x.id,value:x.id}))" :disabled="!writable"/></NFormItem><NFormItem label="成员数据"><NSelect :value="g.members.map(m=>m.testId)" multiple :options="testOptions" :disabled="!writable" @update:value="ids=>membersChanged(index,ids)"/></NFormItem><NFormItem label="本组额外 Validator"><NSelect v-model:value="g.extraValidatorIds" multiple :options="validatorOptions" :disabled="!writable"/></NFormItem></div>
<table class="data-table"><thead><tr><th>成员 / 固定版本</th><th>权重</th></tr></thead><tbody><tr v-for="m in g.members" :key="m.testId"><td><template v-if="tests.some(t=>t.id===m.testId)">#{{tests.find(t=>t.id===m.testId)?.number}}</template><span v-else class="duplicate-warning">数据已删除，需移除此成员</span><small>{{m.revisionId}}</small><span v-if="tests.some(t=>t.id===m.testId)&&tests.find(t=>t.id===m.testId)?.currentRevision.id!==m.revisionId" class="duplicate-warning">数据有新版本，需显式升级</span></td><td><NInputNumber v-model:value="m.weight" :min="1" :max="1000000" :precision="0" :disabled="!writable || g.aggregation==='ALL'" :aria-label="`${g.id} 数据权重`"/></td></tr></tbody></table><div class="report-actions"><NButton v-if="writable" size="small" @click="updateVersions(index)">成员升级到当前版本</NButton><NButton v-if="writable" size="small" type="error" @click="groups.splice(index,1)">移除此组</NButton></div></div>
<NEmpty v-if="!groups.length" description="无计分组：ACM 使用全部启用数据；部分分需先保存数据组" class="empty"/>
<p class="judge-hint">权重分母为本组全部成员权重之和；各组向下取整到 0.001 分后相加。保存时检查成员完整性和依赖环。</p></div></template>
