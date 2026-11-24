<script setup lang="ts">
import { ref, computed, onMounted, onBeforeUnmount, watch } from 'vue';
import { useRoute } from 'vue-router';
import { NButton, NTabs, NTab, NSelect, NInput, NSwitch, NTag, NAlert, NSpin, NModal, NFormItem, useMessage, useDialog } from 'naive-ui';
import { kindLabels, type DocumentKind } from '@problemforge/contracts';
import { useTaskEvents } from '../task-events';
import { api, session, type Draft, type Build } from '../api';
import AppIcon from '../components/AppIcon.vue';
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
const kind = rememberedChoice<DocumentKind>('document', 'STATEMENT', ['STATEMENT', 'EDITORIAL_DOCUMENT', 'EDITORIAL_BEAMER']);
const rightTab = rememberedChoice('result', 'preview', ['preview', 'log', 'publish']);
const selectedBuildId = ref(''); const building = ref(false);
const autoPreviewBuildId = ref('');
const language = rememberedChoice<string>('language', 'zh-CN'); const newLanguage = ref(''); const addingLanguage = ref(false);
const section = rememberedChoice('section', 'documents', ['documents', 'judge', 'manage']);
const judgeDirty = ref(false); const managementDirty = ref(false);
const visited = ref(new Set(['documents', section.value]));
watch(section, value => { visited.value.add(value); });

const metaOpen = ref(true);
const insertRequest = ref<{ id: number; text: string } | null>(null);
let snippetSeq = 0;

function readSplit(): number {
  try {
    const raw = Number(localStorage.getItem('pf-editor-split'));
    if (Number.isFinite(raw) && raw >= 30 && raw <= 70) return raw;
  } catch {}
  return 50;
}
const splitPercent = ref(readSplit());
const editorGridRef = ref<HTMLElement>();
let draggingSplit = false;

function startSplitDrag(event: MouseEvent) {
  event.preventDefault();
  draggingSplit = true;
  const onMove = (e: MouseEvent) => {
    if (!draggingSplit || !editorGridRef.value) return;
    const rect = editorGridRef.value.getBoundingClientRect();
    if (rect.width <= 0) return;
    const pct = Math.min(70, Math.max(30, ((e.clientX - rect.left) / rect.width) * 100));
    splitPercent.value = Math.round(pct * 10) / 10;
  };
  const onUp = () => {
    draggingSplit = false;
    window.removeEventListener('mousemove', onMove);
    window.removeEventListener('mouseup', onUp);
    try { localStorage.setItem('pf-editor-split', String(splitPercent.value)); } catch {}
  };
  window.addEventListener('mousemove', onMove);
  window.addEventListener('mouseup', onUp);
}
function resetSplit() {
  splitPercent.value = 50;
  try { localStorage.setItem('pf-editor-split', '50'); } catch {}
}

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
async function refreshSamples() {
  try {
    if (problem.value?.role === 'TRANSLATOR') return;
    sampleTests.value = (await api(`/problems/${route.params.id}/tests`)).filter((t: any) => t.enabled && t.isSample && t.currentRevision.answerHash);
    const ids = [...new Set(drafts.value.flatMap(d => d.currentRevision.sampleRevisionIds ?? []))];
    fixedSamples.value = await Promise.all(ids.map(id => api(`/test-revisions/${id}`)));
  } catch (e) { message.error((e as Error).message); }
}

const assets = ref<{ id: string; name: string; path: string; bytes: number }[]>([]);
const uploadInput = ref<HTMLInputElement>(); const uploading = ref(false); const showAssets = ref(false);
const current = computed(() => drafts.value.find(d => d.kind === kind.value && d.language === language.value));
const hasDeletedSamples = computed(() => (current.value?.currentRevision.sampleRevisionIds ?? []).some(id => fixedSamples.value.some(sample => sample.id === id && sample.deleted)));
const languages = computed(() => [...new Set(drafts.value.map(d => d.language))].map(l => ({ label: l, value: l })));
const writable = computed(() => ['OWNER', 'EDITOR'].includes(problem.value?.role) && !problem.value?.archived);
const documentWritable = computed(() => writable.value || (problem.value?.role === 'TRANSLATOR' && !problem.value?.archived));
const currentBuilds = computed(() => builds.value.filter(b => b.documentId === current.value?.id));
const chosenBuild = computed(() => currentBuilds.value.find(b => b.id === selectedBuildId.value) ?? currentBuilds.value[0]);
const templateOptions = computed(() => {
  const opts = templates.value.filter(t => t.template.kind === kind.value && t.languages.includes(language.value)).map(t => ({ label: `${t.template.name} · v${t.number}`, value: t.id }));
  const old = current.value?.templateVersion;
  if (old && !opts.some(t => t.value === old.id)) opts.unshift({ label: `${old.template.name} · v${old.number} (${old.state})`, value: old.id });
  return opts;
});
const snippets = computed(() => {
  if (kind.value === 'EDITORIAL_BEAMER') {
    return [
      { label: '+ Frame', text: '\n\\begin{frame}{页面标题}\n\\begin{itemize}\n  \\item 要点一\n\\end{itemize}\n\\end{frame}\n' },
      { label: '$x$', text: '$x$' },
      { label: '$$公式$$', text: '\n\\[\n  \n\\]\n' },
      { label: '列表', text: '\n\\begin{itemize}\n  \\item \n\\end{itemize}\n' },
      { label: 'Block', text: '\n\\begin{block}{结论}\n  \n\\end{block}\n' },
    ];
  }
  if (kind.value === 'EDITORIAL_DOCUMENT') {
    return [
      { label: '$x$', text: '$x$' },
      { label: '$$公式$$', text: '\n\\[\n  \n\\]\n' },
      { label: '\\section*', text: '\n\\section*{小节标题}\n' },
      { label: '列表', text: '\n\\begin{itemize}\n  \\item \n\\end{itemize}\n' },
      { label: '复杂度', text: '$O(n \\log n)$' },
    ];
  }
  return [
    { label: '$x$', text: '$x$' },
    { label: '$$公式$$', text: '\n\\[\n  \n\\]\n' },
    { label: '\\InputFile', text: '\n\\InputFile\n' },
    { label: '\\OutputFile', text: '\n\\OutputFile\n' },
    { label: '\\Note', text: '\n\\Note\n' },
    { label: '列表', text: '\n\\begin{itemize}\n  \\item \n\\end{itemize}\n' },
    { label: '等宽', text: '\\texttt{}' },
  ];
});
function insertSnippet(text: string) {
  if (!current.value || !documentWritable.value) return;
  insertRequest.value = { id: ++snippetSeq, text };
}

const unsaved = computed(() => drafts.value.some(d => d.dirty || d.saving) || judgeDirty.value || managementDirty.value);
useUnsavedGuard(() => unsaved.value);
const returnToProblems = readNavigation('problemsList').startsWith('/problems?') ? readNavigation('problemsList') : '/problems';

function documentData(d: Draft) {
  return { version: d.version, enabled: d.enabled, templateVersionId: d.templateVersionId, body: d.currentRevision.body, metadata: d.currentRevision.metadata, sampleRevisionIds: d.currentRevision.sampleRevisionIds ?? [] };
}
function exportDocument() {
  if (current.value) downloadDraft(`document-${current.value.id}`, { kind: current.value.kind, language: current.value.language, id: current.value.id, ...documentData(current.value) });
}

async function refreshResults() {
  try {
    const rows = await api<Build[]>(`/builds?problemId=${route.params.id}`);
    if (selectedBuildId.value && !rows.some(b => b.id === selectedBuildId.value)) rows.push(await api(`/builds/${selectedBuildId.value}`));
    builds.value = rows;
    publications.value = await api(`/problems/${route.params.id}/publications`);
    if (autoPreviewBuildId.value) {
      const target = rows.find(b => b.id === autoPreviewBuildId.value);
      if (target) {
        if (target.state === 'SUCCEEDED' && target.artifacts.length) {
          rightTab.value = 'preview';
          autoPreviewBuildId.value = '';
        } else if (['FAILED', 'CANCELED'].includes(target.state)) {
          rightTab.value = 'log';
          autoPreviewBuildId.value = '';
        }
      }
    }
  } catch (e) { message.error((e as Error).message); }
}

async function load() {
  try {
    problem.value = await api(`/problems/${route.params.id}`);
    drafts.value = problem.value.documents.map((d: Draft) => ({ ...d, dirty: false, saving: false }));
    if (!drafts.value.some(d => d.language === language.value)) language.value = drafts.value.some(d => d.language === 'zh-CN') ? 'zh-CN' : drafts.value[0]?.language ?? 'zh-CN';
    if (problem.value.role === 'TRANSLATOR') section.value = 'documents';
    templates.value = await api('/templates');
    assets.value = await api(`/problems/${route.params.id}/assets`);
    writeNavigation('lastProblem', route.path);
    await refreshResults();
  } catch (e) { message.error((e as Error).message); }
}

function onWorkspaceKeydown(event: KeyboardEvent) {
  if (section.value !== 'documents' || renameOpen.value) return;
  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 's') {
    event.preventDefault();
    void save();
  } else if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
    if (current.value?.enabled && documentWritable.value && !building.value) {
      event.preventDefault();
      void build();
    }
  }
}

onMounted(async () => {
  window.addEventListener('keydown', onWorkspaceKeydown);
  await load();
  await refreshSamples();
});
onBeforeUnmount(() => { window.removeEventListener('keydown', onWorkspaceKeydown); });
useTaskEvents(refreshResults, { problemId: String(route.params.id) });

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
  const submitted = snapshot(documentData(draft)); draft.saving = true; draft.saveError = '';
  try {
    const { version, ...data } = submitted;
    const saved = await api<Draft>(`/documents/${draft.id}`, { method: 'PUT', body: JSON.stringify({ expectedVersion: version, ...data }) });
    const server = documentData(saved), merged = mergeSaved(documentData(draft), submitted, server);
    Object.assign(draft, saved, { enabled: merged.enabled, templateVersionId: merged.templateVersionId, currentRevision: { ...saved.currentRevision, body: merged.body, metadata: merged.metadata, sampleRevisionIds: merged.sampleRevisionIds }, dirty: JSON.stringify(merged) !== JSON.stringify(server), conflict: false, savedAt: new Date().toLocaleTimeString('zh-CN') });
    await refreshResults();
    message.success(`${kindLabels[draft.kind]}已保存 · v${draft.version}${draft.dirty ? '；继续输入的修改仍未保存' : ''}`);
    return !draft.dirty;
  } catch (e) {
    draft.saveError = (e as Error).message;
    if ((e as any).code === 'VERSION_CONFLICT') draft.conflict = true;
    message.error((e as Error).message);
    return false;
  } finally { draft.saving = false; }
}
async function build() {
  if (current.value?.dirty && !await save()) return;
  building.value = true;
  try {
    const created = await api('/builds', { method: 'POST', body: JSON.stringify({ documentId: current.value!.id }) });
    selectedBuildId.value = created.id;
    autoPreviewBuildId.value = created.id;
    rightTab.value = 'log';
    await refreshResults();
  } catch (e) { message.error((e as Error).message); }
  finally { building.value = false; }
}
function publish() {
  const b = chosenBuild.value; const d = current.value; if (!b || !d) return;
  dialog.warning({
    title: `公开发布${kindLabels[d.kind]}`,
    content: '此 PDF 将通过独立链接公开下载。确认正文与版本后发布，其他资料仍按各自状态控制。',
    positiveText: '发布当前 PDF', negativeText: '返回检查',
    onPositiveClick: async () => {
      try { await api(`/documents/${d.id}/publish`, { method: 'POST', body: JSON.stringify({ buildId: b.id }) }); await refreshResults(); message.success('已发布'); }
      catch (e) { message.error((e as Error).message); }
    },
  });
}
async function cancel() { if (chosenBuild.value) { await api(`/builds/${chosenBuild.value.id}/cancel`, { method: 'POST' }); await refreshResults(); } }
async function retry() {
  if (chosenBuild.value) {
    try {
      const b = await api(`/builds/${chosenBuild.value.id}/retry`, { method: 'POST' });
      selectedBuildId.value = b.id;
      autoPreviewBuildId.value = b.id;
      await refreshResults();
    } catch (e) { message.error((e as Error).message); }
  }
}
async function revoke(id: string) { try { await api(`/publications/${id}/revoke`, { method: 'POST' }); await refreshResults(); } catch (e) { message.error((e as Error).message); } }
async function addLanguage() {
  addingLanguage.value = true;
  try {
    await api(`/problems/${route.params.id}/languages`, { method: 'POST', body: JSON.stringify({ language: newLanguage.value }) });
    const updated = await api(`/problems/${route.params.id}`);
    for (const d of updated.documents) if (!drafts.value.some(old => old.id === d.id)) drafts.value.push({ ...d, dirty: false, saving: false });
    language.value = newLanguage.value; newLanguage.value = ''; selectedBuildId.value = '';
    message.success('已建立独立语言分稿，原稿件保留');
  } catch (e) { message.error((e as Error).message); }
  finally { addingLanguage.value = false; }
}
async function uploadAsset(event: Event) {
  const file = (event.target as HTMLInputElement).files?.[0]; if (!file) return; uploading.value = true;
  try {
    if (file.size > 1_000_000) throw new Error('单张图片不能超过 1MB');
    const base64 = await new Promise<string>((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result).split(',')[1]); reader.onerror = () => reject(new Error('读取图片失败')); reader.readAsDataURL(file); });
    await api(`/problems/${route.params.id}/assets`, { method: 'POST', body: JSON.stringify({ name: file.name, base64 }) });
    assets.value = await api(`/problems/${route.params.id}/assets`); message.success('私有图片已上传');
  } catch (e) { message.error((e as Error).message); }
  finally { uploading.value = false; (event.target as HTMLInputElement).value = ''; }
}
function insertAsset(path: string) {
  if (!current.value) return;
  insertSnippet(`\n\\includegraphics[width=0.8\\linewidth]{${path}}\n`);
}

const renameOpen = ref(false), renameTitle = ref(''), renaming = ref(false), renameError = ref('');
function openRename() {
  if (!problem.value || !writable.value) return;
  if (managementDirty.value) { message.warning('「组织、修订与协作」中有未保存的元信息修改，请先在那里保存。'); return; }
  renameTitle.value = problem.value.title;
  renameError.value = '';
  renameOpen.value = true;
}
async function submitRename() {
  const next = renameTitle.value.trim();
  if (!problem.value || !writable.value || renaming.value || !next) return;
  if (next === problem.value.title) { renameOpen.value = false; return; }
  renaming.value = true; renameError.value = '';
  try {
    const updated = await api(`/problems/${problem.value.id}/meta`, {
      method: 'PUT',
      body: JSON.stringify({
        expectedVersion: problem.value.version,
        title: next,
        tags: problem.value.tags ?? [],
        notes: problem.value.notes ?? '',
        responsibleId: problem.value.responsibleId ?? null,
        archived: Boolean(problem.value.archived),
      }),
    });
    Object.assign(problem.value, updated);
    renameOpen.value = false;
    message.success('题目名称已更新');
  } catch (e) {
    renameError.value = (e as Error).message;
  } finally { renaming.value = false; }
}
</script>
<template>
  <NSpin :show="!problem"><template v-if="problem">
    <div class="workspace-heading">
      <div>
        <div class="breadcrumb"><RouterLink :to="returnToProblems">题目库</RouterLink><span>/</span><span>工作区</span></div>
        <div class="workspace-title-row">
          <h1>{{ problem.title }}</h1>
          <NButton v-if="writable" size="tiny" quaternary aria-label="重命名题目" @click="openRename">
            <template #icon><AppIcon name="edit" :size="14" /></template>重命名
          </NButton>
        </div>
      </div>
      <div class="workspace-header-meta">
        <RouterLink :to="{ path: '/tasks', query: { kind: 'tex', problemId: String(route.params.id) } }" class="quick-link-pill">TeX 历史</RouterLink>
        <RouterLink v-if="problem.role !== 'TRANSLATOR'" :to="{ path: '/tasks', query: { kind: 'judge', problemId: String(route.params.id) } }" class="quick-link-pill">Judge 历史</RouterLink>
        <NSelect v-model:value="language" :options="languages" style="width: 120px" size="small" @update:value="selectedBuildId = ''" />
        <NTag size="small" :bordered="false" type="info">{{ problem.role }} · 私有</NTag>
      </div>
    </div>

    <div class="workspace-subbar">
      <NTabs v-model:value="section" type="segment" class="workspace-sections" style="margin: 0; flex: 1; min-width: 280px">
        <NTab name="documents">题面与双题解出版</NTab>
        <NTab v-if="problem.role !== 'TRANSLATOR'" name="judge">程序、数据与验收</NTab>
        <NTab v-if="problem.role !== 'TRANSLATOR'" name="manage">组织、修订与协作</NTab>
      </NTabs>
      <div v-if="section === 'documents'" class="workspace-history-links">
        <NButton size="small" :type="showAssets ? 'primary' : 'default'" secondary @click="showAssets = !showAssets">图片资源 · {{ assets.length }}</NButton>
        <template v-if="writable">
          <NInput v-model:value="newLanguage" placeholder="新增语言，如 en" size="small" style="width: 136px" />
          <NButton size="small" :loading="addingLanguage" :disabled="!newLanguage" @click="addLanguage">添加语言</NButton>
        </template>
      </div>
    </div>

    <DeferredPanel v-if="problem.role !== 'TRANSLATOR' && visited.has('manage')" v-show="section === 'manage'" :load="loadManagement" label="组织、修订与协作" :problem="problem" :has-unsaved="unsaved" :language="language" @dirty="(v: boolean) => managementDirty = v" @metadata="(v: Record<string, unknown>) => Object.assign(problem, v)" @restored="load(); refreshSamples()" />
    <DeferredPanel v-if="problem.role !== 'TRANSLATOR' && visited.has('judge')" :load="loadJudge" label="程序、数据与验收" :problem-id="problem.id" :writable="writable" v-show="section === 'judge'" @dirty="(v: boolean) => judgeDirty = v" @data-changed="refreshSamples" @settings-saved="refreshResults" />

    <div v-show="section === 'documents'">
      <section v-if="showAssets" class="panel asset-panel">
        <div class="panel-toolbar"><span>私有 PNG / JPEG · 引用路径固定，构建按哈希保存资源清单</span><NButton v-if="writable" size="small" type="primary" :loading="uploading" @click="uploadInput?.click()">上传图片</NButton><input ref="uploadInput" type="file" accept="image/png,image/jpeg" hidden @change="uploadAsset" /></div>
        <div v-for="a in assets" :key="a.id" class="asset-row"><img :src="`/api/assets/${a.id}/file`" :alt="a.name" /><div><strong>{{ a.name }}</strong><code>{{ a.path }}</code><small class="mono-num">{{ a.bytes }} bytes</small></div><NButton v-if="writable" size="small" secondary @click="insertAsset(a.path)">插入光标处</NButton></div>
        <p v-if="!assets.length" class="muted">尚无图片资源；上传后可以插入正文。</p>
      </section>

      <div class="panel workspace">
        <NTabs v-model:value="kind" type="line" @update:value="selectedBuildId = ''">
          <NTab v-for="d in drafts.filter(d => d.language === language)" :key="d.id" :name="d.kind">{{ kindLabels[d.kind] }} <span v-if="d.dirty" class="dirty-dot">●</span></NTab>
        </NTabs>
        <template v-if="current">
          <div class="document-toolbar">
            <div class="toolbar-left">
              <NSelect v-model:value="current.templateVersionId" :options="templateOptions" :disabled="!writable" placeholder="选择管理员已发布模板" style="min-width: 220px; width: 280px" size="small" @update:value="dirty" />
              <NSwitch v-model:value="current.enabled" size="small" :disabled="!writable" @update:value="dirty" />
              <span>{{ current.enabled ? '已启用' : '已停用' }}</span>
              <StatementFormatPicker v-if="current.kind === 'STATEMENT' && documentWritable" :key="current.id" compact :disabled="current.saving || building" :has-content="!!current.currentRevision.body.trim()" :sample-count="current.currentRevision.sampleRevisionIds?.length ?? 0" @apply="applyStatementFormat" />
              <NButton size="small" quaternary :aria-expanded="metaOpen" @click="metaOpen = !metaOpen">{{ metaOpen ? '收起文稿信息' : '展开文稿信息' }}</NButton>
            </div>
            <div class="toolbar-right">
              <span class="save-state" role="status" aria-live="polite">{{ current.saving ? '保存中…' : current.saveError ? '保存失败' : current.dirty ? '未保存 · ⌘S' : `已保存 v${current.version}` }}</span>
              <NButton size="small" quaternary @click="exportDocument">下载草稿</NButton>
              <NButton size="small" :disabled="!documentWritable" :loading="current.saving" @click="save">保存</NButton>
              <NButton size="small" type="primary" :disabled="!documentWritable || !current.enabled" :loading="building" title="保存并构建 PDF (⌘/Ctrl + Enter)" @click="build">构建 PDF</NButton>
            </div>
          </div>

          <EditorFeedback v-if="current.saveError" :dirty="current.dirty" :saving="current.saving" :error="current.saveError" :version="current.version" :label="kindLabels[current.kind]" @export="exportDocument" />

          <NAlert v-if="!templateOptions.length" type="info" :show-icon="false" style="margin: 10px 16px 0">
            当前语言（{{ current.language }}）暂无已发布的{{ kindLabels[current.kind] }}模板。
            <RouterLink v-if="session.user?.role === 'ADMIN'" to="/admin/templates" style="font-weight: 600">前往「模板中心」验证并发布内置模板 →</RouterLink>
            <span v-else>请联系管理员在模板中心验证并发布对应模板。</span>
          </NAlert>

          <div v-if="metaOpen" class="content-metadata">
            <label>当前文稿排版标题<NInput v-model:value="current.currentRevision.metadata.title" size="small" :disabled="!documentWritable" @update:value="dirty" /></label>
            <label>作者<NInput v-model:value="current.currentRevision.metadata.author" size="small" :disabled="!documentWritable" @update:value="dirty" /></label>
            <label v-if="current.kind === 'STATEMENT'" style="flex: 1; min-width: 240px; width: auto">
              引用样例（固定数据版本）
              <NSelect v-model:value="current.currentRevision.sampleRevisionIds" size="small" multiple :options="sampleOptions" :disabled="!writable" placeholder="在测试数据中标记样例并收集答案后选择" @update:value="dirty" />
            </label>
            <span v-else class="muted">{{ current.language }} · 仅用于当前文稿 PDF 排版（不影响题目列表名称）· {{ current.kind === 'EDITORIAL_BEAMER' ? '仅填写 frames，主题由模板生成' : '仅填写正文，文档外壳由模板生成' }}</span>
          </div>

          <NAlert v-if="current.kind === 'STATEMENT' && hasDeletedSamples" type="warning" :show-icon="false" style="margin: 10px 16px 0">已引用的部分样例从测试数据中删除了，本文稿仍使用原固定版本。若不再需要，请取消引用或选择新版本并保存题面。</NAlert>
          <NAlert v-if="current.policyIssues?.length" type="warning" :show-icon="false" style="margin: 10px 16px 0">已保存草稿。构建前需要处理：{{ current.policyIssues.map(i => `第 ${i.line} 行：${i.message}`).join('；') }}</NAlert>

          <div ref="editorGridRef" class="editor-grid editor-grid-resizable" :style="{ '--split-left': `${splitPercent}%` }">
            <section class="source-pane">
              <div class="pane-title">
                <div class="snippet-bar">
                  <span>LaTeX 源码</span>
                  <template v-if="documentWritable">
                    <button v-for="s in snippets" :key="s.label" type="button" class="snippet-chip" @click="insertSnippet(s.text)">{{ s.label }}</button>
                  </template>
                </div>
                <span class="muted mono-num">v{{ current.version }} · ⌘S 保存</span>
              </div>
              <SourceEditor :key="current.id" v-model="current.currentRevision.body" :readonly="!documentWritable" :insert-request="insertRequest" @update:model-value="dirty" />
            </section>
            <div class="editor-resizer" role="separator" aria-orientation="vertical" title="拖拽调整左右宽度（双击恢复 50/50）" @mousedown="startSplitDrag" @dblclick="resetSplit"></div>
            <section class="result-pane">
              <NTabs v-model:value="rightTab" type="line"><NTab name="preview">PDF 预览</NTab><NTab name="log">构建日志</NTab><NTab name="publish">发布</NTab></NTabs>
              <div class="build-selector">
                <NSelect :value="chosenBuild?.id ?? null" size="small" :options="currentBuilds.map(b => ({ label: `${b.state} · 内容 v${b.input.contentVersion ?? '?'} · 模板 v${b.input.templateNumber ?? '?'}${b.stale ? ' · 已过期' : ''}`, value: b.id }))" placeholder="尚无构建记录" @update:value="v => selectedBuildId = v" />
                <NButton v-if="chosenBuild && ['QUEUED', 'RUNNING'].includes(chosenBuild.state)" size="small" @click="cancel">取消</NButton>
                <NButton v-if="chosenBuild && ['FAILED', 'CANCELED'].includes(chosenBuild.state)" size="small" @click="retry">重试</NButton>
              </div>
              <NAlert v-if="chosenBuild?.stale" type="warning" :show-icon="false" style="margin: 8px 12px 0">历史产物：正文、模板绑定或题目配置已改变，请重新构建当前版本。</NAlert>
              <PdfPreview v-if="rightTab === 'preview'" :artifact-id="chosenBuild?.artifacts[0]?.id" />
              <template v-else-if="rightTab === 'log'">
                <NAlert v-if="chosenBuild?.errorCode" type="error" style="margin: 8px 12px 0">{{ chosenBuild.errorCode }}</NAlert>
                <pre class="build-log">{{ chosenBuild?.log || '等待 Worker 返回执行日志。' }}</pre>
              </template>
              <div v-else class="publication-pane">
                <p>当前格式：<strong>{{ kindLabels[current.kind] }}</strong>。每种格式独立发布和撤回。</p>
                <NButton type="primary" :disabled="!chosenBuild || chosenBuild.state !== 'SUCCEEDED' || chosenBuild.stale || current.dirty || problem.role !== 'OWNER'" @click="publish">公开发布当前 PDF</NButton>
                <div v-for="p in publications.filter(p => p.document.kind === kind && p.document.language === language)" :key="p.id" class="publication-row">
                  <span><NTag size="small" :bordered="false" :type="p.revokedAt ? 'default' : 'success'">{{ p.revokedAt ? '已撤回' : '已发布' }}</NTag> <span class="mono-num">{{ new Date(p.createdAt).toLocaleString('zh-CN') }}</span></span>
                  <div class="toolbar-left">
                    <a v-if="!p.revokedAt" :href="`/api/published/${p.token}/pdf`" target="_blank" class="quick-link-pill">打开公开 PDF</a>
                    <NButton v-if="!p.revokedAt && problem.role === 'OWNER'" size="small" @click="revoke(p.id)">撤回</NButton>
                  </div>
                </div>
              </div>
            </section>
          </div>
        </template>
      </div>
    </div>

    <NModal v-model:show="renameOpen" preset="card" title="重命名题目" style="width: min(460px, 95vw)" :closable="!renaming" :mask-closable="!renaming" :close-on-esc="!renaming">
      <p class="muted" style="margin-top: 0">修改题目列表与工作区顶部显示的题目名称；各语言题面和双题解的独立 PDF 排版标题保持不变。</p>
      <form @submit.prevent="submitRename">
        <NFormItem label="题目名称">
          <NInput v-model:value="renameTitle" :maxlength="160" show-count :disabled="renaming" :input-props="{ 'aria-label': '题目名称' }" placeholder="请输入新的题目名称" />
        </NFormItem>
        <NAlert v-if="renameError" type="error" class="spaced">{{ renameError }}</NAlert>
        <div class="toolbar-right" style="justify-content: flex-end">
          <NButton :disabled="renaming" @click="renameOpen = false">取消</NButton>
          <NButton type="primary" attr-type="submit" :loading="renaming" :disabled="!renameTitle.trim() || renameTitle.trim() === problem.title">保存名称</NButton>
        </div>
      </form>
    </NModal>
  </template></NSpin>
</template>
