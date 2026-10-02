<script setup lang="ts">
import { ref, computed, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { NButton, NTag, NModal, NAlert, NEmpty, NTabs, NTab, NSelect, NInput, useMessage } from 'naive-ui';
import { judgePurposeLabels, type JudgePurpose } from '@problemforge/contracts';
import { useTaskEvents, type TaskEvents } from '../task-events';
import { api, type Build } from '../api';
import PdfPreview from '../components/PdfPreview.vue';
import JudgeReport from '../components/JudgeReport.vue';
const route = useRoute(), router = useRouter(), message = useMessage();
const rows = ref<any[]>([]), selected = ref<Build>(), selectedRun = ref<any>(), busy = ref(false), error = ref(''), nextCursor = ref<string|null>(null), asOf = ref(''), newer = ref(false);
const previous = ref<string[]>([]), state = ref<string|null>(null), purpose = ref<string|null>(null), problemId = ref(''), contestId = ref(''), from = ref(''), to = ref('');
const value = (key:string) => typeof route.query[key] === 'string' ? route.query[key] as string : '';
const tab = computed(() => value('kind') === 'tex' ? 'tex' : 'judge');
const states = ['QUEUED','RUNNING','SUCCEEDED','FAILED','CANCELED'].map(value => ({label:value,value}));
const purposes = computed(() => tab.value === 'tex' ? ['DOCUMENT','CONTEST','TEMPLATE_VALIDATION'].map(value => ({label:value,value})) : Object.entries(judgePurposeLabels).map(([value,label]) => ({value,label})));
const query = () => new URLSearchParams(Object.fromEntries(['cursor','state','purpose','problemId','contestId','from','to'].map(k => [k,value(k)]).filter(([,v])=>v))).toString();
let request = 0;
function localDate(iso:string) { if (!iso || !Number.isFinite(Date.parse(iso))) return ''; const d = new Date(iso); return new Date(d.getTime()-d.getTimezoneOffset()*60000).toISOString().slice(0,16); }
async function load() {
  const seq = ++request, kind = tab.value; busy.value = true; error.value = '';
  try {
    const result = await api('/'+(kind === 'tex' ? 'builds' : 'test-runs')+'/page?'+query());
    if (seq !== request) return;
    rows.value = result.rows; nextCursor.value = result.nextCursor; asOf.value = result.asOf;
    if (!value('cursor')) await router.replace({query:{...route.query,cursor:result.currentCursor}});
  } catch (e) { if (seq === request) { rows.value = []; nextCursor.value = null; error.value = (e as Error).message; } }
  finally { if (seq === request) busy.value = false; }
}
watch(() => JSON.stringify(['kind','state','purpose','problemId','contestId','from','to'].map(value)), () => {
  state.value = value('state') || null; purpose.value = value('purpose') || null; problemId.value = value('problemId'); contestId.value = value('contestId'); from.value = localDate(value('from')); to.value = localDate(value('to'));
}, {immediate:true});
watch(() => tab.value+'?'+query(), () => { newer.value = false; void load(); }, {immediate:true});
async function detail() {
  const id = value('task'), kind = tab.value;
  if (!id) { selected.value = undefined; selectedRun.value = undefined; return; }
  try {
    const result = await api('/'+(kind === 'tex' ? 'builds/' : 'test-runs/')+encodeURIComponent(id));
    if (id !== value('task') || kind !== tab.value) return;
    if (kind === 'tex') selected.value = result; else selectedRun.value = result;
  } catch (e) { selected.value = undefined; selectedRun.value = undefined; error.value = (e as Error).message; }
}
watch(() => tab.value+':'+value('task'), () => { selected.value = undefined; selectedRun.value = undefined; void detail(); }, {immediate:true});
function inspect(id:string) { void router.replace({query:{...route.query,task:id}}); }
function closeDetail() { void router.replace({query:{...route.query,task:undefined}}); }
function changeTab(kind:string) { previous.value = []; void router.push({query:{kind, ...(value('problemId') ? {problemId:value('problemId')} : {})}}); }
function apply() {
  previous.value = [];
  try { void router.push({query:{kind:tab.value, state:state.value || undefined, purpose:purpose.value || undefined, problemId:problemId.value.trim() || undefined, contestId:tab.value === 'tex' ? contestId.value.trim() || undefined : undefined, from:from.value ? new Date(from.value).toISOString() : undefined, to:to.value ? new Date(to.value).toISOString() : undefined}}); }
  catch { error.value = '请输入有效的时间范围'; }
}
function latest() { previous.value = []; newer.value = false; void router.push({query:{...route.query,cursor:undefined}}); }
function next() { if (!nextCursor.value) return; previous.value.push(value('cursor')); void router.push({query:{...route.query,cursor:nextCursor.value}}); }
function back() { const cursor = previous.value.pop(); if (cursor) void router.push({query:{...route.query,cursor}}); }
async function events(data?:TaskEvents) {
  if (!data) { await load(); await detail(); return; }
  if (busy.value) return;
  const updates = tab.value === 'tex' ? data.builds : data.runs;
  if (updates.some(r => r.createdAt > asOf.value)) newer.value = true;
  // Watched history IDs are included even outside the newest 50. Missing watched
  // records have lost access; remove them without moving this page or selection.
  rows.value = rows.value.filter(row => updates.some(r=>r.id===row.id)).map(row => ({...row,...updates.find(r=>r.id===row.id)}));
  const chosen = tab.value === 'tex' ? selected.value : selectedRun.value;
  if (chosen) { const change = updates.find(r=>r.id===chosen.id); if (!change || change.updatedAt !== chosen.updatedAt) await detail(); }
}
const live = useTaskEvents(events, () => ({problemId:value('problemId') || undefined, contestId:tab.value === 'tex' ? value('contestId') || undefined : undefined}), () => {
  const ids = [...new Set([...rows.value.map(r=>r.id), ...(value('task') ? [value('task')] : [])])];
  return tab.value === 'tex' ? {buildIds:ids} : {runIds:ids};
});
async function runAction(action:'cancel'|'retry') {
  try { const r = await api('/test-runs/'+selectedRun.value.id+'/'+action, {method:'POST', ...(action === 'retry' ? {body:JSON.stringify({requestKey:crypto.randomUUID()})} : {})}); if (action === 'retry') inspect(r.id); else await detail(); await load(); }
  catch (e) { message.error((e as Error).message); }
}
</script>
<template>
  <div class="page-heading"><div><h1>任务中心</h1><p>默认查询我的任务；填写题目或比赛 ID 可查看有权限的对象历史。按创建时间从新到旧排列。</p></div><div class="p4-toolbar"><NTag :type="live?'success':'warning'">{{live?'实时连接':'重连中 · 定时刷新'}}</NTag><NButton :loading="busy" @click="load">刷新当前页</NButton></div></div>
  <NTabs :value="tab" type="segment" class="task-kind-tabs" @update:value="changeTab"><NTab name="judge">Judge · 出题与验收</NTab><NTab name="tex">TeX · 资料出版</NTab></NTabs>
  <form class="panel history-filters spaced" @submit.prevent="apply"><label>状态<NSelect v-model:value="state" :options="states" placeholder="全部状态" clearable/></label><label>用途<NSelect v-model:value="purpose" :options="purposes" placeholder="全部用途" clearable/></label><label>题目 ID<NInput v-model:value="problemId" placeholder="可选题目 ID" clearable/></label><label v-if="tab==='tex'">比赛 ID<NInput v-model:value="contestId" placeholder="可选比赛 ID" clearable/></label><label>开始时间<input v-model="from" type="datetime-local" aria-label="开始时间"/></label><label>结束时间<input v-model="to" type="datetime-local" aria-label="结束时间"/></label><NButton attr-type="submit" type="primary" :disabled="busy">应用筛选</NButton></form>
  <NAlert v-if="error" type="error" class="spaced">{{error}} <NButton text @click="latest">回到最新一页</NButton></NAlert>
  <NAlert v-if="newer" type="info" class="spaced">有较新的任务。当前页与已选记录保持不变。<NButton text @click="latest">查看最新</NButton></NAlert>
  <div class="panel"><table v-if="rows.length" class="data-table"><thead><tr><th>任务</th><th>状态</th><th v-if="tab==='judge'">处理进度</th><th>创建时间</th><th></th></tr></thead><tbody><tr v-for="r in rows" :key="r.id"><td>{{tab==='judge'?judgePurposeLabels[r.purpose as JudgePurpose]:r.kind}}<small>{{r.purpose}} · {{r.id}}</small><small>{{r.contestId || r.problemId || '管理员模板'}}</small></td><td><NTag :type="r.state==='FAILED'?'error':r.state==='SUCCEEDED'&&r.accepted!==false?'success':'default'">{{r.state}}</NTag><small v-if="r.accepted===false">未通过验收</small><small v-if="r.cacheSourceId">固定版本缓存</small></td><td v-if="tab==='judge'">{{r.completed}} / {{r.total}}<small>{{r.stage}}</small></td><td>{{new Date(r.createdAt).toLocaleString('zh-CN')}}</td><td><NButton size="small" @click="inspect(r.id)">{{tab==='judge'?'矩阵与日志':'日志与产物'}}</NButton></td></tr></tbody></table><NEmpty v-else :description="busy?'加载任务历史…':nextCursor?'本段没有可访问的记录，可继续查看更早任务':'没有匹配的任务'" class="empty"/>
  <div class="panel-toolbar"><span class="muted">本页 {{rows.length}} 条 · 当前依赖有效性见详情</span><div class="p4-toolbar"><NButton :disabled="busy" @click="latest">最新一页</NButton><NButton :disabled="busy || !previous.length" @click="back">上一页</NButton><NButton :disabled="busy || !nextCursor" @click="next">更早任务</NButton></div></div></div>
  <NModal :show="!!selected && !!value('task') && tab==='tex'" preset="card" title="TeX 构建记录" style="width:min(1100px,95vw)" @update:show="v=>{if(!v)closeDetail()}"><template v-if="selected"><p class="muted">{{selected.id}} · {{selected.stale?'历史版本':'对应当前稿件版本'}}</p><NAlert v-if="selected.errorCode" type="error">{{selected.errorCode}}</NAlert><PdfPreview v-if="selected.artifacts.length" :artifact-id="selected.artifacts[0].id"/><pre class="build-log">{{selected.log || selected.state}}</pre></template></NModal>
  <NModal :show="!!selectedRun && !!value('task') && tab==='judge'" preset="card" title="Judge 任务记录" style="width:min(1300px,96vw)" @update:show="v=>{if(!v)closeDetail()}"><JudgeReport v-if="selectedRun" :run="selectedRun" writable @cancel="runAction('cancel')" @retry="runAction('retry')"/></NModal>
</template>
<style scoped>.history-filters{padding:20px;display:flex;flex-wrap:wrap;align-items:end;gap:16px}.history-filters label{display:flex;flex-direction:column;gap:7px;font-size:12px;color:var(--text-secondary);min-width:170px;flex:1}.history-filters input[type="datetime-local"]{height:36px;border:1px solid var(--line);border-radius:8px;padding:4px 10px;max-width:100%}</style>
