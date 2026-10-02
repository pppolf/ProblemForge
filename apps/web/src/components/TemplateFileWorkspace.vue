<script setup lang="ts">
import { computed, h, nextTick, onBeforeUnmount, ref, watch } from 'vue';
import { NAlert, NButton, NEmpty, NFormItem, NInput, NModal, NTree, useDialog, useMessage, type TreeOption } from 'naive-ui';
import SourceEditor from './SourceEditor.vue';
import { fileBasename, fileFolder, importTemplateFiles, isTemplateImage, moveTemplateFile, readTemplateUploads, removeTemplateFile, requiredTemplateFiles, templateFileAccept, templateFileChanges, templateFileTree, templateImageType, type TemplateFiles } from '../template-files';

const props = defineProps<{ files: TemplateFiles; originalFiles: TemplateFiles; readonly: boolean; busy: boolean; previewOpen: boolean }>();
const emit = defineEmits<{ 'update:files': [files: TemplateFiles]; 'update:previewOpen': [value: boolean]; save: []; pending: [value: boolean] }>();
const message = useMessage(), dialog = useDialog();
const active = ref('main.tex'), opened = ref<string[]>(['main.tex']), folder = ref(''), expanded = ref<string[]>([]);
const uploadInput = ref<HTMLInputElement>(), replaceInput = ref<HTMLInputElement>(), reading = ref(false), dragDepth = ref(0);
const pathModal = ref(false), pathAction = ref<'new' | 'rename'>('new'), pathValue = ref(''), pathError = ref(''), pathSource = ref('');
const uploadModal = ref(false), uploads = ref<File[]>([]), uploadFolder = ref(''), replacement = ref(''), uploadError = ref('');
const dimensions = ref(''), tabsElement = ref<HTMLElement>();
let alive = true;
onBeforeUnmount(() => { alive = false; });
watch(reading, value => emit('pending', value), { flush: 'sync' });
const locked = computed(() => props.readonly || props.busy || reading.value);
const tree = computed(() => templateFileTree(props.files));
const changed = computed(() => templateFileChanges(props.files, props.originalFiles));
const selectedKey = ref('file:main.tex');
const imageFile = computed(() => isTemplateImage(active.value));
const currentExists = computed(() => Object.hasOwn(props.files, active.value));
const protectedFile = computed(() => requiredTemplateFiles.has(active.value));
const imageSource = computed(() => currentExists.value && imageFile.value ? `data:${templateImageType(active.value)};base64,${props.files[active.value]}` : '');
const byteSize = computed(() => {
  const value = props.files[active.value] ?? '';
  return imageFile.value ? Math.floor(value.length * 3 / 4) - (value.endsWith('==') ? 2 : value.endsWith('=') ? 1 : 0) : new TextEncoder().encode(value).length;
});
const editorLanguage = computed(() => active.value.endsWith('.json') ? 'json' : active.value.endsWith('.yaml') ? 'yaml' : 'latex');
const uploadTargets = computed(() => uploads.value.map(file => replacement.value || `${uploadFolder.value.trim() ? uploadFolder.value.trim() + '/' : ''}${file.name.replace(/\.[^.]+$/, extension => extension.toLowerCase())}`));
const replacingCount = computed(() => uploadTargets.value.filter(path => Object.hasOwn(props.files, path)).length);
watch(() => props.files, files => {
  opened.value = opened.value.filter(path => Object.hasOwn(files, path));
  if (!Object.hasOwn(files, active.value)) active.value = opened.value.at(-1) ?? (Object.hasOwn(files, 'main.tex') ? 'main.tex' : Object.keys(files)[0] ?? '');
  if (active.value && !opened.value.includes(active.value)) opened.value.push(active.value);
  if (!selectedKey.value.startsWith('folder:')) selectedKey.value = `file:${active.value}`;
}, { immediate: true });
watch(active, path => { if (path) folder.value = fileFolder(path); });
watch(imageSource, () => { dimensions.value = ''; });
function openFile(path: string) {
  if (!Object.hasOwn(props.files, path)) return;
  active.value = path; selectedKey.value = `file:${path}`; folder.value = fileFolder(path);
  if (!opened.value.includes(path)) opened.value.push(path);
  const parts = path.split('/');
  for (let i = 1; i < parts.length; i++) { const key = `folder:${parts.slice(0, i).join('/')}`; if (!expanded.value.includes(key)) expanded.value.push(key); }
}
function selectTree(keys: (string | number)[]) {
  if (!keys.length) return;
  const key = String(keys[0]); selectedKey.value = key;
  if (key.startsWith('file:')) openFile(key.slice(5)); else folder.value = key.slice(7);
}
function filePrefix({ option }: { option: TreeOption }) {
  if (!option.isLeaf) return h('span', { class: 'workspace-folder-icon', 'aria-hidden': 'true' }, '▱');
  const path = String(option.path);
  return h('span', { class: ['workspace-file-kind', { image: isTemplateImage(path) }], 'aria-hidden': 'true' }, isTemplateImage(path) ? 'IMG' : path.split('.').at(-1)?.toUpperCase());
}
function fileSuffix({ option }: { option: TreeOption }) {
  return option.isLeaf && changed.value.has(String(option.path)) ? h('span', { class: 'workspace-file-change', title: '未保存', 'aria-label': '未保存' }, Object.hasOwn(props.originalFiles, String(option.path)) ? 'M' : 'A') : null;
}
function closeTab(path: string) {
  const index = opened.value.indexOf(path); opened.value = opened.value.filter(item => item !== path);
  if (active.value === path) { active.value = opened.value[Math.min(index, opened.value.length - 1)] ?? ''; selectedKey.value = active.value ? `file:${active.value}` : ''; }
}
async function tabKey(event: KeyboardEvent, index: number) {
  if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
  event.preventDefault(); const count = opened.value.length;
  const next = event.key === 'Home' ? 0 : event.key === 'End' ? count - 1 : (index + (event.key === 'ArrowRight' ? 1 : -1) + count) % count;
  openFile(opened.value[next]); await nextTick(); tabsElement.value?.querySelectorAll<HTMLButtonElement>('[role=tab]')[next]?.focus();
}
function changeSource(value: string) { if (!locked.value && currentExists.value) emit('update:files', { ...props.files, [active.value]: value }); }
function saveKey(event: KeyboardEvent) { if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') { event.preventDefault(); if (!locked.value) emit('save'); } }
function editPath(action: 'new' | 'rename') {
  if (locked.value) return;
  pathAction.value = action; pathSource.value = active.value; pathValue.value = action === 'rename' ? active.value : `${folder.value ? folder.value + '/' : ''}new.tex`;
  pathError.value = ''; pathModal.value = true;
}
function submitPath() {
  if (locked.value) return;
  try {
    const path = pathValue.value.trim();
    let files: TemplateFiles;
    if (pathAction.value === 'rename') files = moveTemplateFile(props.files, pathSource.value, path);
    else {
      if (Object.hasOwn(props.files, path)) throw new Error('文件已存在，请更换路径');
      if (isTemplateImage(path)) throw new Error('图片请通过「上传文件」添加');
      files = importTemplateFiles(props.files, { [path]: '' });
    }
    emit('update:files', files);
    if (pathAction.value === 'rename') opened.value = opened.value.map(item => item === pathSource.value ? path : item);
    active.value = path; selectedKey.value = `file:${path}`; pathModal.value = false;
    void nextTick(() => openFile(path));
  } catch (e) { pathError.value = (e as Error).message; }
}
function deleteFile() {
  if (locked.value || !currentExists.value || protectedFile.value) return;
  const path = active.value;
  dialog.warning({ title: '从草稿移除文件', content: `移除「${path}」？保存草稿后生效，请同时更新源码中对该文件的引用。`, positiveText: '移除文件', negativeText: '取消', onPositiveClick: () => {
    if (!alive || locked.value) return false;
    emit('update:files', removeTemplateFile(props.files, path));
  } });
}
function stageUpload(list: File[], target = '') {
  if (locked.value || !list.length) return;
  uploads.value = list; replacement.value = target; uploadFolder.value = target ? fileFolder(target) : folder.value;
  uploadError.value = ''; uploadModal.value = true;
}
function chooseUpload(event: Event, replace = false) {
  const input = event.target as HTMLInputElement, list = Array.from(input.files ?? []); input.value = '';
  stageUpload(list, replace ? active.value : '');
}
async function submitUpload() {
  if (locked.value) return;
  reading.value = true; uploadError.value = '';
  try {
    const incoming = await readTemplateUploads(uploads.value, uploadFolder.value.trim(), replacement.value || undefined);
    if (!alive || props.readonly || props.busy) return;
    const files = importTemplateFiles(props.files, incoming);
    emit('update:files', files); uploadModal.value = false;
    const path = Object.keys(incoming)[0]; active.value = path; selectedKey.value = `file:${path}`;
    await nextTick(); if (alive) openFile(path);
    message.success(`已载入 ${Object.keys(incoming).length} 个文件，保存草稿后生效`);
  } catch (e) { if (alive) uploadError.value = (e as Error).message; }
  finally { reading.value = false; }
}
function dropped(event: DragEvent) {
  event.preventDefault(); dragDepth.value = 0;
  if (locked.value) return;
  const items = Array.from(event.dataTransfer?.items ?? []);
  if (items.some(item => item.webkitGetAsEntry?.()?.isDirectory)) { message.warning('请拖入文件；目标文件夹可在上传窗口中填写'); return; }
  stageUpload(Array.from(event.dataTransfer?.files ?? []));
}
function downloadFile() {
  if (!currentExists.value) return;
  const value = props.files[active.value], bytes = imageFile.value ? Uint8Array.from(atob(value), c => c.charCodeAt(0)) : new TextEncoder().encode(value);
  const url = URL.createObjectURL(new Blob([bytes], { type: imageFile.value ? templateImageType(active.value) : 'text/plain;charset=utf-8' }));
  const link = document.createElement('a'); link.href = url; link.download = fileBasename(active.value); link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function imageLoaded(event: Event) { const image = event.target as HTMLImageElement; dimensions.value = `${image.naturalWidth} × ${image.naturalHeight}`; }
function resetFile() {
  if (locked.value || !changed.value.has(active.value)) return;
  const path = active.value;
  dialog.warning({ title: '还原文件修改', content: `将「${path}」还原为最近保存的内容？`, positiveText: '还原', negativeText: '取消', onPositiveClick: () => {
    if (!alive || locked.value) return false;
    emit('update:files', Object.hasOwn(props.originalFiles, path) ? { ...props.files, [path]: props.originalFiles[path] } : removeTemplateFile(props.files, path));
  } });
}
</script>

<template>
  <div class="template-file-workspace" :class="{ 'preview-open': previewOpen }" @keydown.capture="saveKey" @dragenter.prevent="dragDepth++" @dragleave.prevent="dragDepth = Math.max(0, dragDepth - 1)" @dragover.prevent @drop="dropped">
    <div class="workspace-commandbar">
      <div class="workspace-file-actions">
        <NButton size="small" :disabled="locked" @click="uploadInput?.click()">上传文件</NButton>
        <NButton size="small" :disabled="locked" @click="editPath('new')">新建文件</NButton>
        <span class="workspace-folder-label" :title="folder || '/'">{{ folder ? folder + '/' : '根目录' }}</span>
      </div>
      <NButton size="small" :aria-expanded="previewOpen" @click="emit('update:previewOpen', !previewOpen)">{{ previewOpen ? '收起预览' : 'PDF / 日志' }}</NButton>
      <input ref="uploadInput" type="file" :accept="templateFileAccept" multiple hidden aria-label="上传模板文件" @change="chooseUpload($event)" />
      <input ref="replaceInput" type="file" :accept="imageFile ? (active.endsWith('.png') ? '.png,image/png' : '.jpg,.jpeg,image/jpeg') : templateFileAccept" hidden aria-label="替换当前模板文件" @change="chooseUpload($event, true)" />
    </div>
    <aside class="workspace-explorer" aria-label="模板文件资源管理器">
      <div class="workspace-explorer-heading"><strong>资源管理器</strong><button type="button" aria-label="选择根目录" title="上传到根目录" @click="folder = ''; selectedKey = ''">/</button></div>
      <NTree block-line expand-on-click ellipsis :data="tree" :selected-keys="selectedKey ? [selectedKey] : []" v-model:expanded-keys="expanded" :render-prefix="filePrefix" :render-suffix="fileSuffix" @update:selected-keys="selectTree" />
    </aside>
    <section class="workspace-edit-pane" aria-label="模板文件编辑区">
      <div ref="tabsElement" class="workspace-file-tabs" role="tablist" aria-label="打开的模板文件">
        <div v-for="(path, index) in opened" :key="path" class="workspace-file-tab" :class="{ active: path === active }">
          <button type="button" role="tab" :aria-selected="path === active" :tabindex="path === active ? 0 : -1" :title="path" @click="openFile(path)" @keydown="tabKey($event, index)">{{ fileBasename(path) }}<span v-if="changed.has(path)" class="workspace-tab-dot" aria-label="未保存">●</span></button>
          <button type="button" class="workspace-close-tab" :aria-label="`关闭标签：${path}`" @click="closeTab(path)">×</button>
        </div>
      </div>
      <template v-if="currentExists">
        <div class="workspace-file-toolbar">
          <span class="workspace-current-path" :title="active">{{ active }}</span>
          <div class="workspace-file-actions">
            <NButton v-if="!imageFile" text size="tiny" :disabled="locked" @click="replaceInput?.click()">替换文件</NButton>
            <NButton text size="tiny" @click="downloadFile">下载</NButton>
            <NButton text size="tiny" :disabled="locked || protectedFile" @click="editPath('rename')">重命名</NButton>
            <NButton text size="tiny" :disabled="locked || protectedFile" @click="deleteFile">删除</NButton>
            <NButton v-if="changed.has(active)" text size="tiny" :disabled="locked" @click="resetFile">还原</NButton>
          </div>
        </div>
        <div v-if="imageFile" class="workspace-image-preview">
          <div class="workspace-image-stage"><img :key="imageSource" :src="imageSource" :alt="active" @load="imageLoaded" /></div>
          <div class="workspace-image-footer"><span>{{ dimensions }}<span v-if="dimensions"> · </span>{{ (byteSize / 1024).toFixed(1) }} KB</span><NButton type="primary" size="small" :disabled="locked" @click="replaceInput?.click()">替换图片</NButton></div>
        </div>
        <SourceEditor v-else :key="active" :model-value="files[active]" :language="editorLanguage" :readonly="locked" @update:model-value="changeSource" />
      </template>
      <NEmpty v-else class="empty" description="从资源管理器打开文件" />
    </section>
    <section v-if="previewOpen" class="workspace-build-preview" aria-label="模板构建结果"><slot name="preview" /></section>
    <div class="workspace-statusbar"><span>{{ Object.keys(files).length }} 个文件<span v-if="changed.size"> · {{ changed.size }} 项未保存</span></span><span>{{ readonly ? '只读' : '可编辑 · Ctrl / ⌘ + S 保存' }}</span></div>
    <div v-if="dragDepth > 0 && !locked" class="workspace-drop-target">放开以上传文件</div>
  </div>
  <NModal v-model:show="pathModal" preset="card" :title="pathAction === 'new' ? '新建文件' : '重命名文件'" class="workspace-file-modal">
    <form @submit.prevent="submitPath"><NFormItem label="文件路径"><NInput v-model:value="pathValue" :input-props="{ 'aria-label': '文件路径' }" placeholder="例如 images/logo.png 或 sections/header.tex" :maxlength="160" /></NFormItem>
      <p v-if="pathAction === 'rename'" class="muted">重命名后需同步修改源码中的文件引用。</p>
      <NAlert v-if="pathError" type="error" class="spaced">{{ pathError }}</NAlert>
      <div class="workspace-modal-actions"><NButton @click="pathModal = false">取消</NButton><NButton type="primary" attr-type="submit" :disabled="locked || !pathValue.trim()">{{ pathAction === 'new' ? '创建文件' : '重命名' }}</NButton></div>
    </form>
  </NModal>
  <NModal :show="uploadModal" preset="card" :title="replacement ? '替换文件' : '上传文件'" class="workspace-file-modal" :closable="!reading" :mask-closable="!reading" :close-on-esc="!reading" @update:show="value => { if (!reading) uploadModal = value; }">
    <form @submit.prevent="submitUpload">
      <NFormItem v-if="!replacement" label="上传到文件夹"><NInput v-model:value="uploadFolder" :input-props="{ 'aria-label': '上传到文件夹' }" :disabled="reading" placeholder="留空为根目录，例如 images" /></NFormItem>
      <ul class="workspace-upload-list"><li v-for="(path, index) in uploadTargets" :key="index"><span :title="path">{{ path }}</span><strong v-if="Object.hasOwn(files, path)">替换</strong><small v-else>新增</small></li></ul>
      <NAlert v-if="uploadError" type="error" class="spaced">{{ uploadError }}</NAlert>
      <div class="workspace-modal-actions"><NButton :disabled="reading" @click="uploadModal = false">取消</NButton><NButton type="primary" attr-type="submit" :loading="reading" :disabled="readonly || busy">{{ replacingCount ? '确认替换并载入' : '载入文件' }}</NButton></div>
    </form>
  </NModal>
</template>

<style scoped>
.template-file-workspace{position:relative;display:grid;grid-template-columns:180px minmax(0,1fr);border-top:1px solid var(--line);min-width:0;container-type:inline-size;background:#fff}
.workspace-commandbar{grid-column:1/-1;display:flex;justify-content:space-between;align-items:center;gap:12px;padding:10px 12px;background:var(--surface-soft);border-bottom:1px solid var(--line);flex-wrap:wrap}
.workspace-file-actions{display:flex;align-items:center;gap:10px;flex-wrap:wrap}.workspace-folder-label{max-width:180px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--text-muted);font:12px Consolas,monospace}
.workspace-explorer{background:var(--surface-soft);border-right:1px solid var(--line);min-width:0;overflow:auto;padding:8px 6px;max-height:630px}.workspace-explorer-heading{display:flex;justify-content:space-between;align-items:center;padding:4px 6px 12px;font-size:12px;color:var(--text-secondary)}.workspace-explorer-heading button{border:0;background:transparent;color:var(--text-muted);cursor:pointer;padding:2px 8px}
.workspace-explorer :deep(.n-tree-node-content__text){font-size:12px}.workspace-explorer :deep(.workspace-file-kind){font:8px/16px Consolas,monospace;color:var(--accent);width:24px;display:inline-block;text-align:center;background:var(--accent-soft);border-radius:3px}.workspace-explorer :deep(.workspace-file-kind.image){background:var(--accent-soft);color:var(--success)}.workspace-explorer :deep(.workspace-folder-icon){color:var(--warning);font-size:18px}.workspace-explorer :deep(.workspace-file-change){font:11px Consolas,monospace;color:var(--warning);padding:0 4px}
.workspace-edit-pane{min-width:0;min-height:545px}.workspace-file-tabs{display:flex;overflow-x:auto;background:var(--surface-muted);border-bottom:1px solid var(--line);min-height:39px}.workspace-file-tab{display:flex;flex:none;border-right:1px solid var(--line);border-top:2px solid transparent;color:var(--text-muted)}.workspace-file-tab.active{background:#fff;border-top-color:var(--accent);color:var(--ink)}.workspace-file-tab button{border:0;background:transparent;color:inherit;cursor:pointer;white-space:nowrap;font-size:12px;padding:9px 10px}.workspace-file-tab .workspace-close-tab{padding:6px 9px 6px 0;font-size:16px}.workspace-tab-dot{color:var(--warning);font-size:8px;margin-left:7px}
.workspace-file-toolbar{min-height:38px;display:flex;align-items:center;justify-content:space-between;gap:10px;padding:8px 12px;border-bottom:1px solid var(--line-soft);flex-wrap:wrap}.workspace-current-path{font:12px Consolas,monospace;overflow-wrap:anywhere;color:var(--text-muted)}.workspace-edit-pane :deep(.source-editor){height:490px;min-height:360px;border-right:0}
.workspace-image-preview{padding:20px;background:#fff}.workspace-image-stage{height:380px;display:flex;align-items:center;justify-content:center;overflow:auto;background-color:#fff;background-image:linear-gradient(45deg,var(--surface-muted) 25%,transparent 25%),linear-gradient(-45deg,var(--surface-muted) 25%,transparent 25%),linear-gradient(45deg,transparent 75%,var(--surface-muted) 75%),linear-gradient(-45deg,transparent 75%,var(--surface-muted) 75%);background-size:20px 20px;background-position:0 0,0 10px,10px -10px,-10px 0;border:1px solid var(--line);border-radius:4px}.workspace-image-stage img{max-width:100%;max-height:100%;object-fit:contain}.workspace-image-footer{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-top:16px;font-size:12px;color:var(--text-muted)}
.workspace-statusbar{grid-column:1/-1;display:flex;justify-content:space-between;gap:12px;flex-wrap:wrap;padding:7px 12px;border-top:1px solid var(--line);background:var(--surface-soft);color:var(--text-muted);font-size:11px}.workspace-build-preview{grid-column:1/-1;min-width:0;border-top:1px solid var(--line)}.workspace-build-preview :deep(.n-tabs){padding:0 14px}.workspace-drop-target{position:absolute;inset:0;z-index:5;display:grid;place-items:center;background:color-mix(in srgb, var(--accent-soft) 95%, transparent);border:2px dashed var(--accent);color:var(--accent-pressed);pointer-events:none;font-size:18px}
.workspace-file-modal{width:min(520px,calc(100vw - 32px))}.workspace-modal-actions{display:flex;justify-content:flex-end;gap:10px}.workspace-upload-list{list-style:none;padding:0;margin:0 0 20px;max-height:260px;overflow:auto;border:1px solid var(--line);border-radius:5px}.workspace-upload-list li{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:10px 12px;font-size:13px;border-bottom:1px solid var(--line-soft)}.workspace-upload-list li:last-child{border:0}.workspace-upload-list li>span{overflow-wrap:anywhere;min-width:0}.workspace-upload-list strong{font-size:11px;color:var(--warning);flex-shrink:0}.workspace-upload-list small{margin:0;flex-shrink:0}
@container template-editor (min-width:1100px){.template-file-workspace.preview-open{grid-template-columns:190px minmax(0,1fr) minmax(350px,0.85fr)}.workspace-build-preview{grid-column:3;grid-row:2;border-top:0;border-left:1px solid var(--line)}}
@container template-editor (max-width:560px){.template-file-workspace{grid-template-columns:minmax(0,1fr)}.workspace-explorer{max-height:210px;border-right:0;border-bottom:1px solid var(--line)}.workspace-file-actions{gap:8px}.workspace-image-preview{padding:12px}}
</style>
