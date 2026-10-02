<script setup lang="ts">
import { ref, computed, onMounted } from 'vue';
import { NButton, NInput, NInputNumber, NSelect, NTag, NModal, NFormItem, NAlert, NTabs, NTab, NEmpty, useMessage, useDialog } from 'naive-ui';
import { kindLabels, kinds, type DocumentKind } from '@problemforge/contracts';
import { useTaskEvents } from '../task-events';
import { api, type Build } from '../api';
import SourceEditor from '../components/SourceEditor.vue';
import PdfPreview from '../components/PdfPreview.vue';
import EditorFeedback from '../components/EditorFeedback.vue';
import { snapshot, mergeSaved, downloadDraft } from '../draft-state';
import { rememberedChoice, useUnsavedGuard } from '../editor-navigation';
const templates = ref<any[]>([]); const version = ref<any>(); const templateId = ref(''); const fileName = ref('main.tex'); const files = ref<Record<string, string>>({}); const dirty = ref(false); const show = ref(false); const name = ref(''); const kind = ref<DocumentKind>('STATEMENT'); const busy = ref(false); const build = ref<Build>(); const panelTab = ref('preview'); const previewed = ref(false); const uploadInput = ref<HTMLInputElement>(); const message = useMessage(); const dialog = useDialog();
const styleConfig = ref({ marginMm: 24, cjkFont: 'Noto Serif CJK SC', palette: 'RED' }); const styleEdited = ref(false);
const loadError = ref(''); const loading = ref(false);
const saveError = ref(''), lastVersion = rememberedChoice<string>('template-version','');
const templateAction = ref<'rename' | 'copy'>('rename'), showAction = ref(false);
const actionTarget = ref<{ id: string; name: string; versionId?: string; number?: number; editVersion?: number }>();
const actionName = ref(''), actionError = ref('');
const actionAllowed = computed(() => !!actionName.value.trim() && (templateAction.value !== 'rename' || actionName.value.trim() !== actionTarget.value?.name));
type TemplateCategory = 'ALL' | DocumentKind;
const templateCategory = ref<TemplateCategory>('ALL');
const templateGroups = computed(() => kinds.map(kind => ({ kind, label: kindLabels[kind], templates: templates.value.filter(t => t.kind === kind) })));
const categoryOptions = computed(() => [
  { value: 'ALL' as TemplateCategory, label: '全部', count: templates.value.length },
  ...templateGroups.value.map(group => ({ value: group.kind, label: group.label, count: group.templates.length })),
]);
const visibleGroups = computed(() => templateGroups.value.filter(group => group.templates.length && (templateCategory.value === 'ALL' || group.kind === templateCategory.value)));
function openCreate() { kind.value = templateCategory.value === 'ALL' ? 'STATEMENT' : templateCategory.value; show.value = true; }
function openRename(t: any) {
  if (busy.value) return;
  actionTarget.value = { id: t.id, name: t.name };
  actionName.value = t.name; actionError.value = ''; templateAction.value = 'rename'; showAction.value = true;
}
function openCopy() {
  if (busy.value || !version.value || !selectedTemplate.value) return;
  if (dirty.value) { message.warning('请先保存当前草稿，再复制为新模板。'); return; }
  const t = selectedTemplate.value, v = version.value;
  actionTarget.value = { id: t.id, name: t.name, versionId: v.id, number: v.number, editVersion: v.editVersion };
  actionName.value = `${Array.from(t.name as string).slice(0, 116).join('')}（副本）`;
  actionError.value = ''; templateAction.value = 'copy'; showAction.value = true;
}
function closeAction() { if (!busy.value) showAction.value = false; }
async function submitAction() {
  if (busy.value || !actionAllowed.value || !actionTarget.value || !showAction.value) return;
  const target = actionTarget.value, action = templateAction.value;
  busy.value = true; actionError.value = '';
  try {
    if (action === 'rename') {
      const updated = await api(`/admin/templates/${target.id}`, { method: 'PATCH', body: JSON.stringify({ name: actionName.value.trim(), expectedName: target.name }) });
      const local = templates.value.find(t => t.id === target.id);
      if (local) Object.assign(local, updated);
      message.success('模板名称已更新');
    } else {
      const created = await api(`/admin/template-versions/${target.versionId}/copy`, { method: 'POST', body: JSON.stringify({ name: actionName.value.trim(), expectedVersion: target.editVersion }) });
      templates.value.unshift(created); choose(created, created.versions[0], true);
      message.success('已复制为独立模板，可继续编辑 v1 草稿');
    }
    showAction.value = false; await load();
  } catch (e) { actionError.value = (e as Error).message; }
  finally { busy.value = false; }
}
useUnsavedGuard(()=>dirty.value||busy.value);
const imageFile = computed(() => /\.(png|jpe?g)$/.test(fileName.value));
const archivePreset = computed(() => !!files.value['preamble.tex']?.includes('fontset=overleaf'));
function changeStyle() { styleEdited.value = true; dirty.value = true; }
const editable = computed(() => version.value && ['DRAFT', 'VALIDATED'].includes(version.value.state));
const selectedTemplate = computed(() => templates.value.find(t => t.id === templateId.value));
async function load() { loading.value = true; loadError.value = ''; try { templates.value = await api('/admin/templates'); if (version.value) { const updated = templates.value.flatMap(t => t.versions).find(v => v.id === version.value.id); if (updated && !dirty.value) version.value = updated; } } catch (e) { loadError.value = (e as Error).message; } finally { loading.value = false; } }
function choose(t: any, v: any, internal=false) { if(busy.value&&!internal){message.info('请等待保存完成再切换版本');return;} if (dirty.value && !internal && !window.confirm('放弃尚未保存的模板修改？可先下载本地草稿。')) return; if(templateCategory.value !== 'ALL' && templateCategory.value !== t.kind) templateCategory.value = t.kind; templateId.value = t.id; version.value = v; files.value = { ...v.files }; styleConfig.value = snapshot(v.styleConfig ?? { marginMm: t.kind === 'STATEMENT' ? 20 : 24, cjkFont: t.kind === 'EDITORIAL_BEAMER' ? 'Noto Sans CJK SC' : 'Noto Serif CJK SC', palette: 'RED' }); styleEdited.value = false; fileName.value = 'main.tex'; dirty.value = false; saveError.value=''; lastVersion.value=v.id; previewed.value = false; build.value = undefined; if (v.validationBuildId) inspect(v.validationBuildId); }
async function inspect(id: string) { const selectedId = version.value?.id; const result = await api(`/builds/${id}`); if (version.value?.id === selectedId) build.value = result; }
onMounted(async () => { await load(); const t = templates.value.find(t=>t.versions.some((v:any)=>v.id===lastVersion.value)) ?? templates.value[0]; const v=t?.versions.find((v:any)=>v.id===lastVersion.value) ?? t?.versions[0]; if(v)choose(t,v); });
useTaskEvents(async()=>{if(build.value){await inspect(build.value.id);if(build.value?.state==='SUCCEEDED')await load();}});
async function create() { if(busy.value)return; busy.value = true; try { const t = await api('/admin/templates', { method: 'POST', body: JSON.stringify({ name: name.value, kind: kind.value }) }); const starter = await api(`/admin/template-starters/${kind.value}`); const v = await api(`/admin/templates/${t.id}/versions`, { method: 'POST', body: JSON.stringify({ files: starter.files }) }); await load(); choose(t, v,true); show.value = false; } catch (e) { message.error((e as Error).message); } finally { busy.value = false; } }
async function save() { if(busy.value)return false;busy.value = true;saveError.value='';const submitted=snapshot({files:files.value,styleConfig:styleConfig.value});try { const v = await api(`/admin/template-versions/${version.value.id}`, { method: 'PUT', body: JSON.stringify({ expectedVersion: version.value.editVersion, files: submitted.files, ...(styleEdited.value ? { styleConfig: submitted.styleConfig } : {}) }) }); const server={files:v.files,styleConfig:v.styleConfig??submitted.styleConfig};const merged=mergeSaved({files:files.value,styleConfig:styleConfig.value},submitted,server);version.value = v; files.value = merged.files;styleConfig.value=merged.styleConfig;styleEdited.value=JSON.stringify(merged.styleConfig)!==JSON.stringify(server.styleConfig);dirty.value=JSON.stringify(merged)!==JSON.stringify(server);previewed.value = false; build.value = undefined; await load(); message.success(dirty.value?'模板已保存；继续输入的修改仍未保存':'模板草稿已保存，需重新验证'); return !dirty.value; } catch (e) { saveError.value=(e as Error).message;message.error(saveError.value); return false; } finally { busy.value = false; } }
async function newVersion() { if(busy.value)return;busy.value=true;try { const v = await api(`/admin/templates/${templateId.value}/versions`, { method: 'POST', body: JSON.stringify({ files: files.value }) }); await load(); choose(selectedTemplate.value, v,true); message.success('新草稿已创建，原版本保留'); } catch (e) { message.error((e as Error).message); } finally{busy.value=false;} }
async function validate() { if (dirty.value && !await save()) return; try { const b = await api(`/admin/template-versions/${version.value.id}/validate`, { method: 'POST' }); build.value = { ...b, artifacts: [] }; previewed.value = false; panelTab.value = 'log'; } catch (e) { message.error((e as Error).message); } }
async function publish() { dialog.warning({ title: '发布管理员模板', content: '确认已检查此版本的真实 PDF 预览。发布后源码不可修改，已有题目绑定保持原版本。', positiveText: '发布此版本', negativeText: '返回', onPositiveClick: async () => { try { await api(`/admin/template-versions/${version.value.id}/publish`, { method: 'POST', body: JSON.stringify({ reviewedBuildId: build.value!.id }) }); await load(); message.success('模板已发布，可供新绑定选择'); } catch (e) { message.error((e as Error).message); } } }); }
async function archive() { await api(`/admin/template-versions/${version.value.id}/archive`, { method: 'POST' }); await load(); }
function revoke() { let reason = ''; dialog.warning({ title: '撤回模板版本', content: () => '撤回将阻止该版本的新构建。请输入原因：', positiveText: '撤回', negativeText: '返回', onPositiveClick: async () => { reason = window.prompt('撤回原因') ?? ''; if (!reason.trim()) return false; await api(`/admin/template-versions/${version.value.id}/revoke`, { method: 'POST', body: JSON.stringify({ reason }) }); await load(); } }); }
async function upload(event: Event) { try { const file = (event.target as HTMLInputElement).files?.[0]; if (!file) return; if (file.size > 10_000_000) throw new Error('模板包超过 10MB'); const parsed = JSON.parse(await file.text()); const imported = parsed.files ?? parsed; if (!editable.value) throw new Error('先创建可编辑草稿版本'); files.value = imported; dirty.value = true; message.info('模板包已载入编辑器，保存时由后端检查'); } catch (e) { message.error((e as Error).message); } }
</script>
<template><div class="page-heading"><div><h1>管理员模板中心</h1><p>题面、文档题解和 Beamer 模板独立版本化</p></div><NButton type="primary" :disabled="busy" @click="openCreate">新建模板</NButton></div><NAlert v-if="loadError" type="error" class="spaced">模板列表加载失败：{{ loadError }} <NButton size="small" :loading="loading" @click="load">重试</NButton></NAlert>
<div class="panel template-categories" role="group" aria-label="按模板类型筛选">
  <button v-for="category in categoryOptions" :key="category.value" type="button" :class="['template-category-button', { active: templateCategory === category.value }]" :aria-pressed="templateCategory === category.value" @click="templateCategory = category.value">
    <span>{{ category.label }}</span><span class="template-category-count">{{ category.count }}</span>
  </button>
</div>
<div class="template-layout"><aside class="panel template-list template-directory" aria-label="模板目录">
  <div v-if="selectedTemplate && templateCategory !== 'ALL' && selectedTemplate.kind !== templateCategory" class="template-selection-note">
    <span>当前编辑：{{ selectedTemplate.name }}</span>
    <NButton text size="small" type="primary" @click="templateCategory = selectedTemplate.kind">显示所在分类</NButton>
  </div>
  <section v-for="group in visibleGroups" :key="group.kind" class="template-kind-group" :aria-labelledby="'template-kind-' + group.kind">
    <h2 :id="'template-kind-' + group.kind" class="template-kind-heading"><span>{{ group.label }}</span><span>{{ group.templates.length }} 套</span></h2>
    <div v-for="t in group.templates" :key="t.id" class="template-group">
      <div class="template-group-heading"><strong>{{ t.name }}</strong><NButton text size="small" type="primary" :disabled="busy" :aria-label="`重命名模板：${t.name}`" @click="openRename(t)">重命名</NButton></div>
      <button v-for="v in t.versions" :key="v.id" type="button" :class="['version-link', { selected: version?.id === v.id }]" :aria-current="version?.id === v.id ? 'true' : undefined" @click="choose(t, v)">
        <span>v{{ v.number }}</span><NTag size="small" :type="v.state === 'PUBLISHED' ? 'success' : 'default'">{{ v.state }}</NTag>
      </button>
    </div>
  </section>
  <NEmpty v-if="!visibleGroups.length && !loading && !loadError" :description="templateCategory === 'ALL' ? '创建第一套管理员模板' : '此分类暂无模板，可点击新建模板'" class="empty"/>
</aside><section class="panel template-editor" v-if="version"><EditorFeedback :dirty="dirty" :saving="busy" :error="saveError" :version="version.editVersion" label="模板草稿" @export="downloadDraft(`template-${version.id}`,{id:version.id,baseVersion:version.editVersion,files,styleConfig})"/><div class="document-toolbar"><div><strong>{{ selectedTemplate?.name }} · v{{ version.number }}</strong><NTag size="small">{{ version.state }}</NTag></div><div><NButton size="small" :disabled="busy" @click="openCopy">复制为新模板</NButton><NButton size="small" :disabled="busy" @click="newVersion">复制为新版本</NButton><NButton v-if="editable" size="small" :loading="busy" @click="save">保存草稿</NButton><NButton v-if="editable" size="small" type="primary" @click="validate">验证样稿</NButton><NButton v-if="version.state === 'VALIDATED'" size="small" type="primary" :disabled="dirty || !build?.artifacts.length || !previewed" @click="publish">确认预览并发布</NButton><NButton v-if="version.state === 'PUBLISHED'" size="small" @click="archive">归档</NButton><NButton v-if="['PUBLISHED', 'ARCHIVED'].includes(version.state)" size="small" type="error" @click="revoke">撤回</NButton></div></div><NAlert v-if="!editable" :show-icon="false" type="info">发布版本不可原地修改。请复制为新草稿，既有绑定继续固定此版本。</NAlert><NAlert v-if="archivePreset" type="info" :show-icon="false">采用上传 main.tex 原版式：11pt、Overleaf 字体、双行页眉、原始页边距和 olymp 样例表格。下面的配置仅在管理员主动修改后覆盖原值。</NAlert><div class="admin-style-form"><label>中文字体<NSelect v-model:value="styleConfig.cjkFont" :disabled="!editable || busy" :options="[{ label: 'Noto 宋体', value: 'Noto Serif CJK SC' }, { label: 'Noto 黑体', value: 'Noto Sans CJK SC' }]" @update:value="changeStyle" /></label><label v-if="selectedTemplate?.kind !== 'EDITORIAL_BEAMER'">页边距 (mm)<NInputNumber v-model:value="styleConfig.marginMm" :disabled="!editable || busy" :min="15" :max="35" @update:value="changeStyle" /></label><label v-else>CWNU 配色<NSelect v-model:value="styleConfig.palette" :disabled="!editable || busy" :options="[{ label: '参考红色', value: 'RED' }, { label: 'CWNU 蓝色', value: 'BLUE' }]" @update:value="changeStyle" /></label><span class="muted">管理员配置变化将重新生成 style.tex，并要求重新验证。</span></div><div class="template-tools"><NSelect v-model:value="fileName" :options="Object.keys(files).map(f => ({ label: f, value: f }))" style="width: 260px"/><span class="muted">{{ dirty ? '尚未保存' : `草稿编辑版本 ${version.editVersion}` }}</span><NButton v-if="editable" size="small" :disabled="busy" @click="uploadInput?.click()">上传模板包 JSON</NButton><input ref="uploadInput" type="file" accept="application/json,.json" hidden @change="upload"/></div><div class="editor-grid"><div v-if="imageFile" class="template-image"><img :src="`data:${fileName.endsWith('png') ? 'image/png' : 'image/jpeg'};base64,${files[fileName]}`" :alt="fileName"/><p>{{ fileName }} · 管理员模板资源</p></div><SourceEditor v-else v-model="files[fileName]" :key="version.id + fileName" :language="fileName.endsWith('.json') ? 'json' : fileName.endsWith('.yaml') ? 'yaml' : 'latex'" :readonly="!editable || busy" @update:model-value="dirty = true"/><section class="result-pane"><NTabs v-model:value="panelTab" ><NTab name="preview">真实 PDF 预览</NTab><NTab name="log">验证日志</NTab></NTabs><NAlert v-if="build?.errorCode" type="error">{{ build.errorCode }}</NAlert><PdfPreview v-if="panelTab === 'preview'" :artifact-id="build?.artifacts[0]?.id" @loaded="previewed = true"/><pre v-else class="build-log">{{ build?.log || build?.state || '保存后提交代表性样稿验证' }}</pre></section></div></section></div><NModal v-model:show="show" preset="card" title="新建管理员模板" style="width: 480px"><NFormItem label="名称"><NInput v-model:value="name" :maxlength="120" show-count placeholder="例如：简洁中文题面"/></NFormItem><NFormItem label="模板类型"><NSelect v-model:value="kind" :options="kinds.map(k => ({ label: kindLabels[k], value: k }))"/></NFormItem><p class="muted">会创建一份管理员可编辑的内置样式草稿，真实编译并确认后才能发布。</p><NButton type="primary" :loading="busy" :disabled="!name.trim()" @click="create">创建草稿</NButton></NModal>
<NModal :show="showAction" preset="card" :title="templateAction === 'rename' ? '重命名模板' : '复制为新模板'" class="template-action-modal" :closable="!busy" :mask-closable="!busy" :close-on-esc="!busy" @update:show="closeAction">
  <p v-if="templateAction === 'rename'" class="muted">修改整套模板在目录中的名称，已有版本、绑定和历史 PDF 保持不变。</p>
  <p v-else class="muted">从「{{ actionTarget?.name }} · v{{ actionTarget?.number }}」复制全部文件和样式，创建同类型的独立 v1 草稿。编辑完成后需验证样稿并发布。</p>
  <form @submit.prevent="submitAction">
    <NFormItem :label="templateAction === 'rename' ? '模板名称' : '新模板名称'"><NInput v-model:value="actionName" :input-props="{ 'aria-label': templateAction === 'rename' ? '模板名称' : '新模板名称' }" :maxlength="120" show-count :disabled="busy" placeholder="请输入模板名称"/></NFormItem>
    <NAlert v-if="actionError" type="error" class="spaced">{{ actionError }}</NAlert>
    <div class="template-action-buttons"><NButton :disabled="busy" @click="closeAction">取消</NButton><NButton attr-type="submit" type="primary" :loading="busy" :disabled="!actionAllowed">{{ templateAction === 'rename' ? '保存名称' : '创建副本' }}</NButton></div>
  </form>
</NModal></template>
