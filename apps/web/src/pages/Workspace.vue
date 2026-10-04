<script setup lang="ts">
import { ref, computed, onMounted, onBeforeUnmount, watch } from 'vue';
import { useRoute } from 'vue-router';
import { NButton, NTabs, NTab, NSelect, NInput, NSwitch, NTag, NAlert, NEmpty, NSpin, useMessage, useDialog } from 'naive-ui';
import { kindLabels, type DocumentKind } from '@problemforge/contracts';
import { useTaskEvents } from '../task-events';
import { api, type Draft, type Build } from '../api';
import SourceEditor from '../components/SourceEditor.vue';
import PdfPreview from '../components/PdfPreview.vue';
import DeferredPanel from '../components/DeferredPanel.vue';
import EditorFeedback from '../components/EditorFeedback.vue';
import StatementFormatPicker from '../components/StatementFormatPicker.vue';
import type { StatementFormatApplication } from '../statement-formats';
import { snapshot, mergeSaved, downloadDraft } from '../draft-state';
import { rememberedChoice, useUnsavedGuard, readNavigation, writeNavigation } from '../editor-navigation';
const loadJudge = () => import('../components/JudgeWorkspace.vue');
const loadManagement = () => import('../components/ProblemManagement.vue');
const route = useRoute(); const message = useMessage(); const dialog = useDialog();
const problem = ref<any>(); const drafts = ref<Draft[]>([]); const templates = ref<any[]>([]); const builds = ref<Build[]>([]); const publications = ref<any[]>([]);
const kind = rememberedChoice<DocumentKind>('document', 'STATEMENT', ['STATEMENT','EDITORIAL_DOCUMENT','EDITORIAL_BEAMER']); const rightTab = rememberedChoice('result','preview',['preview','log','publish']); const selectedBuildId = ref(''); const building = ref(false);
const language = rememberedChoice<string>('language','zh-CN'); const newLanguage = ref(''); const addingLanguage = ref(false);
const section = rememberedChoice('section','documents',['documents','judge','manage']); const judgeDirty = ref(false);const managementDirty=ref(false);
const visited = ref(new Set(['documents',section.value]));
watch(section, value => { visited.value.add(value); });
const sampleTests = ref<any[]>([]);
const fixedSamples = ref<any[]>([]);
const sampleOptions = computed(() => {
  const opts = sampleTests.value.map(t => ({ label: `#${t.number} · 数据 v${t.version}`, value: t.currentRevision.id }));
  for (const id of current.value?.currentRevision.sampleRevisionIds ?? []) if (!opts.some(o => o.value === id)) {
    const sample = fixedSamples.value.find(s => s.id === id);
    opts.push({ label: sample ? `#${sample.configuration.number} · 数据 v${sample.version}（${sample.deleted ? '数据已删除，保留引用' : '已固定'}）` : '已固定的历史样例', value: id });
  }
  return opts;
});
async function refreshSamples() { try {
  if(problem.value?.role==='TRANSLATOR')return;
  sampleTests.value = (await api(`/problems/${route.params.id}/tests`)).filter((t: any) => t.enabled && t.isSample && t.currentRevision.answerHash);
  const ids = [...new Set(drafts.value.flatMap(d => d.currentRevision.sampleRevisionIds ?? []))];
  fixedSamples.value = await Promise.all(ids.map(id => api(`/test-revisions/${id}`)));
} catch (e) { message.error((e as Error).message); } }
const assets = ref<{ id: string; name: string; path: string; bytes: number }[]>([]); const uploadInput = ref<HTMLInputElement>(); const uploading = ref(false); const showAssets = ref(false);
const current = computed(() => drafts.value.find(d => d.kind === kind.value && d.language === language.value));
const hasDeletedSamples = computed(() => (current.value?.currentRevision.sampleRevisionIds ?? []).some(id => fixedSamples.value.some(sample => sample.id === id && sample.deleted)));
const languages = computed(() => [...new Set(drafts.value.map(d => d.language))].map(l => ({ label: l, value: l })));
const writable = computed(() => ['OWNER', 'EDITOR'].includes(problem.value?.role)&&!problem.value?.archived);
const documentWritable=computed(()=>writable.value||problem.value?.role==='TRANSLATOR'&&!problem.value?.archived);
const currentBuilds = computed(() => builds.value.filter(b => b.documentId === current.value?.id));
const chosenBuild = computed(() => currentBuilds.value.find(b => b.id === selectedBuildId.value) ?? currentBuilds.value[0]);
const templateOptions = computed(() => {
  const opts = templates.value.filter(t => t.template.kind === kind.value && t.languages.includes(language.value)).map(t => ({ label: `${t.template.name} · v${t.number}`, value: t.id }));
  const old = current.value?.templateVersion;
  if (old && !opts.some(t => t.value === old.id)) opts.unshift({ label: `${old.template.name} · v${old.number} (${old.state})`, value: old.id });
  return opts;
});
const unsaved = computed(() => drafts.value.some(d => d.dirty || d.saving) || judgeDirty.value||managementDirty.value);
useUnsavedGuard(() => unsaved.value);
const returnToProblems = readNavigation('problemsList').startsWith('/problems?') ? readNavigation('problemsList') : '/problems';
function documentData(d:Draft) { return { version:d.version, enabled:d.enabled, templateVersionId:d.templateVersionId, body:d.currentRevision.body, metadata:d.currentRevision.metadata, sampleRevisionIds:d.currentRevision.sampleRevisionIds ?? [] }; }
function exportDocument() { if(current.value) downloadDraft(`document-${current.value.id}`,{kind:current.value.kind,language:current.value.language,id:current.value.id,...documentData(current.value)}); }

async function refreshResults() { try { const rows = await api<Build[]>(`/builds?problemId=${route.params.id}`); if (selectedBuildId.value && !rows.some(b=>b.id===selectedBuildId.value)) rows.push(await api(`/builds/${selectedBuildId.value}`)); builds.value = rows; publications.value = await api(`/problems/${route.params.id}/publications`); } catch (e) { message.error((e as Error).message); } }
async function load() { try { problem.value = await api(`/problems/${route.params.id}`); drafts.value = problem.value.documents.map((d: Draft) => ({ ...d, dirty: false, saving: false })); if(!drafts.value.some(d=>d.language===language.value)) language.value = drafts.value.some(d => d.language === 'zh-CN') ? 'zh-CN' : drafts.value[0]?.language ?? 'zh-CN'; if(problem.value.role==='TRANSLATOR')section.value='documents'; templates.value = await api('/templates'); assets.value = await api(`/problems/${route.params.id}/assets`); writeNavigation('lastProblem',route.path); await refreshResults(); } catch (e) { message.error((e as Error).message); } }
onMounted(async () => { await load(); await refreshSamples(); });
useTaskEvents(refreshResults,{problemId:String(route.params.id)});
function dirty() { if (current.value) current.value.dirty = true; }
function applyStatementFormat(value: StatementFormatApplication) {
  const draft = current.value;
  if (!draft || draft.kind !== 'STATEMENT' || !documentWritable.value || draft.saving || building.value) return;
  const body = draft.currentRevision.body;
  draft.currentRevision.body = value.mode === 'append' && body ? `${body}${body.endsWith('\n') ? '\n' : '\n\n'}${value.body}` : value.body;
  if (value.title) draft.currentRevision.metadata.title = value.title;
  draft.dirty = true;
  if (value.mode === 'replace') draft.policyIssues = [];
  message.success('交互题格式已写入草稿，请检查内容后保存题面');
}
async function save(): Promise<boolean> {
  const draft = current.value; if (!draft || !documentWritable.value || draft.saving) return false;
  const submitted = snapshot(documentData(draft)); draft.saving = true; draft.saveError='';
  try { const {version,...data}=submitted; const saved = await api<Draft>(`/documents/${draft.id}`, { method: 'PUT', body: JSON.stringify({ expectedVersion:version,...data }) }); const server=documentData(saved), merged=mergeSaved(documentData(draft),submitted,server); Object.assign(draft,saved,{enabled:merged.enabled,templateVersionId:merged.templateVersionId,currentRevision:{...saved.currentRevision,body:merged.body,metadata:merged.metadata,sampleRevisionIds:merged.sampleRevisionIds},dirty:JSON.stringify(merged)!==JSON.stringify(server),conflict:false,savedAt:new Date().toLocaleTimeString('zh-CN')}); await refreshResults(); message.success(`${kindLabels[draft.kind]}已保存 · v${draft.version}${draft.dirty?'；继续输入的修改仍未保存':''}`); return !draft.dirty; }
  catch (e) { draft.saveError=(e as Error).message; if ((e as any).code === 'VERSION_CONFLICT') draft.conflict = true; message.error((e as Error).message); return false; }
  finally { draft.saving = false; }
}
async function build() { if (current.value?.dirty && !await save()) return; building.value = true; try { const created = await api('/builds', { method: 'POST', body: JSON.stringify({ documentId: current.value!.id }) }); selectedBuildId.value = created.id; rightTab.value = 'log'; await refreshResults(); } catch (e) { message.error((e as Error).message); } finally { building.value = false; } }
function publish() { const b = chosenBuild.value; const d = current.value; if (!b || !d) return; dialog.warning({ title: `公开发布${kindLabels[d.kind]}`, content: '此 PDF 将通过独立链接公开下载。确认正文与版本后发布，其他资料仍按各自状态控制。', positiveText: '发布当前 PDF', negativeText: '返回检查', onPositiveClick: async () => { try { await api(`/documents/${d.id}/publish`, { method: 'POST', body: JSON.stringify({ buildId: b.id }) }); await refreshResults(); message.success('已发布'); } catch (e) { message.error((e as Error).message); } } }); }
async function cancel() { if (chosenBuild.value) { await api(`/builds/${chosenBuild.value.id}/cancel`, { method: 'POST' }); await refreshResults(); } }
async function retry() { if (chosenBuild.value) { try { const b = await api(`/builds/${chosenBuild.value.id}/retry`, { method: 'POST' }); selectedBuildId.value = b.id; await refreshResults(); } catch (e) { message.error((e as Error).message); } } }
async function revoke(id: string) { try { await api(`/publications/${id}/revoke`, { method: 'POST' }); await refreshResults(); } catch (e) { message.error((e as Error).message); } }
async function addLanguage() {
  addingLanguage.value = true;
  try {
    await api(`/problems/${route.params.id}/languages`, { method: 'POST', body: JSON.stringify({ language: newLanguage.value }) });
    const updated = await api(`/problems/${route.params.id}`);
    for (const d of updated.documents) if (!drafts.value.some(old => old.id === d.id)) drafts.value.push({ ...d, dirty: false, saving: false });
    language.value = newLanguage.value; newLanguage.value = ''; selectedBuildId.value = ''; message.success('已建立独立语言分稿，原稿件保留');
  } catch (e) { message.error((e as Error).message); } finally { addingLanguage.value = false; }
}
async function uploadAsset(event: Event) {
  const file = (event.target as HTMLInputElement).files?.[0]; if (!file) return; uploading.value = true;
  try {
    if (file.size > 1_000_000) throw new Error('单张图片不能超过 1MB');
    const base64 = await new Promise<string>((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result).split(',')[1]); reader.onerror = () => reject(new Error('读取图片失败')); reader.readAsDataURL(file); });
    await api(`/problems/${route.params.id}/assets`, { method: 'POST', body: JSON.stringify({ name: file.name, base64 }) });
    assets.value = await api(`/problems/${route.params.id}/assets`); message.success('私有图片已上传');
  } catch (e) { message.error((e as Error).message); } finally { uploading.value = false; (event.target as HTMLInputElement).value = ''; }
}
function insertAsset(path: string) { if (!current.value) return; current.value.currentRevision.body += `\n\\includegraphics[width=0.8\\linewidth]{${path}}\n`; dirty(); }
</script>
<template>
  <NSpin :show="!problem"><template v-if="problem"><div class="workspace-heading"><div><div class="breadcrumb"><RouterLink :to="returnToProblems">题目</RouterLink> / 工作区</div><h1>{{ problem.title }}</h1></div><div class="toolbar-left"><NSelect v-model:value="language" :options="languages" style="width: 130px" @update:value="selectedBuildId = ''"/><NTag :bordered="false">{{ problem.role }} · 默认私有</NTag></div></div>
  <div class="p4-toolbar spaced"><RouterLink :to="{path:'/tasks',query:{kind:'tex',problemId:String(route.params.id)}}">全部 TeX 历史</RouterLink><RouterLink v-if="problem.role!=='TRANSLATOR'" :to="{path:'/tasks',query:{kind:'judge',problemId:String(route.params.id)}}">全部 Judge 历史</RouterLink><span class="muted">工作区显示最近 50 条，完整历史可分页检索</span></div>
  <NTabs v-model:value="section" type="segment" class="workspace-sections"><NTab name="documents">题面与双题解出版</NTab><NTab v-if="problem.role!=='TRANSLATOR'" name="judge">程序、数据与验收</NTab><NTab v-if="problem.role!=='TRANSLATOR'" name="manage">组织、修订与协作</NTab></NTabs>
  <DeferredPanel v-if="problem.role!=='TRANSLATOR' && visited.has('manage')" v-show="section==='manage'" :load="loadManagement" label="组织、修订与协作" :problem="problem" :has-unsaved="unsaved" :language="language" @dirty="(v: boolean)=>managementDirty=v" @metadata="(v: Record<string, unknown>)=>Object.assign(problem,v)" @restored="load();refreshSamples()"/><DeferredPanel v-if="problem.role!=='TRANSLATOR' && visited.has('judge')" :load="loadJudge" label="程序、数据与验收" :problem-id="problem.id" :writable="writable" v-show="section === 'judge'" @dirty="(v: boolean) => judgeDirty = v" @data-changed="refreshSamples" @settings-saved="refreshResults"/>
  <div v-show="section === 'documents'">
  <div class="workspace-extra"><NButton size="small" @click="showAssets = !showAssets">图片资源 · {{ assets.length }}</NButton><template v-if="writable"><NInput v-model:value="newLanguage" placeholder="语言代码，如 en" size="small" style="width: 150px"/><NButton size="small" :loading="addingLanguage" :disabled="!newLanguage" @click="addLanguage">添加语言</NButton></template></div><section v-if="showAssets" class="panel asset-panel"><div class="panel-toolbar"><span>私有 PNG / JPEG · 引用路径固定，构建按哈希保存资源清单</span><NButton v-if="writable" size="small" :loading="uploading" @click="uploadInput?.click()">上传图片</NButton><input ref="uploadInput" type="file" accept="image/png,image/jpeg" hidden @change="uploadAsset"/></div><div v-for="a in assets" :key="a.id" class="asset-row"><img :src="`/api/assets/${a.id}/file`" :alt="a.name"/><div><strong>{{ a.name }}</strong><code>{{ a.path }}</code><small>{{ a.bytes }} bytes</small></div><NButton v-if="writable" size="small" @click="insertAsset(a.path)">插入当前稿件</NButton></div><p v-if="!assets.length" class="muted">尚无图片资源；上传后可以插入正文。</p></section><div class="panel workspace"><NTabs v-model:value="kind" type="line" @update:value="selectedBuildId = ''"><NTab v-for="d in drafts.filter(d => d.language === language)" :key="d.id" :name="d.kind">{{ kindLabels[d.kind] }} <span v-if="d.dirty" class="dirty-dot">●</span></NTab></NTabs>
    <template v-if="current"><div class="document-toolbar"><div class="toolbar-left"><NSelect v-model:value="current.templateVersionId" :options="templateOptions" :disabled="!writable" placeholder="选择管理员已发布模板" style="min-width: 250px; width: 310px" @update:value="dirty"/><NSwitch v-model:value="current.enabled" :disabled="!writable" @update:value="dirty"/><span>{{ current.enabled ? '已启用' : '已停用，稿件保留' }}</span></div><div class="toolbar-right"><span class="save-state">{{ current.saving ? '保存中…' : current.dirty ? '未保存' : `已保存 v${current.version}` }}</span><NButton :disabled="!documentWritable" :loading="current.saving" @click="save">保存</NButton><NButton type="primary" :disabled="!documentWritable || !current.enabled" :loading="building" @click="build">构建 PDF</NButton></div></div>
      <EditorFeedback :dirty="current.dirty" :saving="current.saving" :error="current.saveError" :version="current.version" :label="kindLabels[current.kind]" @export="exportDocument"/>
      <div class="content-metadata"><label>标题<NInput v-model:value="current.currentRevision.metadata.title" :disabled="!documentWritable" @update:value="dirty" /></label><label>作者<NInput v-model:value="current.currentRevision.metadata.author" :disabled="!documentWritable" @update:value="dirty"/></label><span class="muted">{{ current.language }} · {{ current.kind === 'EDITORIAL_BEAMER' ? '仅填写 frames，主题由模板生成' : '仅填写正文，文档外壳由模板生成' }}</span></div>
      <StatementFormatPicker v-if="current.kind === 'STATEMENT' && documentWritable" :key="current.id" :disabled="current.saving || building" :has-content="!!current.currentRevision.body.trim()" :sample-count="current.currentRevision.sampleRevisionIds?.length ?? 0" @apply="applyStatementFormat"/>
      <div v-if="current.kind === 'STATEMENT'" class="sample-binding"><label>引用样例的具体数据版本</label><NSelect v-model:value="current.currentRevision.sampleRevisionIds" multiple :options="sampleOptions" :disabled="!writable" placeholder="在测试数据中标记样例并收集答案后选择" @update:value="dirty"/><small>输入与答案来自不可变数据版本，构建按原始字节复制；更新样例版本需显式重新选择。</small><NAlert v-if="hasDeletedSamples" type="warning" :show-icon="false">已引用的部分样例从测试数据中删除了，本文稿仍使用原固定版本。若不再需要，请取消引用或选择新版本并保存题面。</NAlert></div>
      <NAlert v-if="current.policyIssues?.length" type="warning" :show-icon="false">已保存草稿。构建前需要处理：{{ current.policyIssues.map(i => `第 ${i.line} 行：${i.message}`).join('；') }}</NAlert>
      <div class="editor-grid"><section class="source-pane"><div class="pane-title">LaTeX 源码 <span class="muted">{{ kindLabels[current.kind] }} · 独立版本</span></div><SourceEditor :key="current.id" v-model="current.currentRevision.body" :readonly="!documentWritable" @update:model-value="dirty" /></section><section class="result-pane"><NTabs v-model:value="rightTab" type="line"><NTab name="preview">PDF 预览</NTab><NTab name="log">构建日志</NTab><NTab name="publish">发布</NTab></NTabs><div class="build-selector"><NSelect :value="chosenBuild?.id ?? null" :options="currentBuilds.map(b => ({ label: `${b.state} · 内容 v${b.input.contentVersion ?? '?'} · 模板 v${b.input.templateNumber ?? '?'}${b.stale ? ' · 已过期' : ''}`, value: b.id }))" placeholder="尚无构建记录" @update:value="v => selectedBuildId = v"/><NButton v-if="chosenBuild && ['QUEUED', 'RUNNING'].includes(chosenBuild.state)" size="small" @click="cancel">取消</NButton><NButton v-if="chosenBuild && ['FAILED', 'CANCELED'].includes(chosenBuild.state)" size="small" @click="retry">重试此任务</NButton></div><NAlert v-if="chosenBuild?.stale" type="warning" :show-icon="false">历史产物：正文、模板绑定或题目配置已改变，请重新构建当前版本。</NAlert><PdfPreview v-if="rightTab === 'preview'" :artifact-id="chosenBuild?.artifacts[0]?.id"/><template v-else-if="rightTab === 'log'"><NAlert v-if="chosenBuild?.errorCode" type="error">{{ chosenBuild.errorCode }}</NAlert><pre class="build-log">{{ chosenBuild?.log || '等待 Worker 返回执行日志。' }}</pre></template><div v-else class="publication-pane"><p>当前格式：{{ kindLabels[current.kind] }}。每种格式独立发布和撤回。</p><NButton type="primary" :disabled="!chosenBuild || chosenBuild.state !== 'SUCCEEDED' || chosenBuild.stale || current.dirty || problem.role !== 'OWNER'" @click="publish">公开发布当前 PDF</NButton><div v-for="p in publications.filter(p => p.document.kind === kind && p.document.language === language)" :key="p.id" class="publication-row"><span>{{ p.revokedAt ? '已撤回' : '已发布' }} · {{ new Date(p.createdAt).toLocaleString('zh-CN') }}</span><a v-if="!p.revokedAt" :href="`/api/published/${p.token}/pdf`" target="_blank">打开公开 PDF</a><NButton v-if="!p.revokedAt && problem.role === 'OWNER'" size="small" @click="revoke(p.id)">撤回</NButton></div></div></section></div>
    </template>
  </div></div></template></NSpin>
</template>
