<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue';
import { NAlert, NButton, NImage, NImageGroup, useMessage } from 'naive-ui';
import { api, bytesBase64 } from '../api';

type IntroductionAsset = { id: string; name: string; path: string; bytes: number; mediaType: string; hash: string };
const props = defineProps<{ contestId: string; writable: boolean }>();
const emit = defineEmits<{ insert: [frame: string] }>();
const message = useMessage(), assets = ref<IntroductionAsset[]>([]), input = ref<HTMLInputElement>();
const loading = ref(false), loaded = ref(false), uploading = ref(false), error = ref('');
const totalBytes = computed(() => assets.value.reduce((sum, asset) => sum + asset.bytes, 0));
const atCapacity = computed(() => assets.value.length >= 100 || totalBytes.value >= 20_000_000);
let generation = 0, disposed = false;
const isCurrent = (request: number, contestId: string) => !disposed && generation === request && props.contestId === contestId;

async function load() {
  const request = ++generation, contestId = props.contestId;
  loading.value = true; loaded.value = false; error.value = ''; assets.value = [];
  try {
    const result = await api<IntroductionAsset[]>(`/contests/${contestId}/assets`);
    if (!isCurrent(request, contestId)) return;
    assets.value = result; loaded.value = true;
  } catch (e) {
    if (isCurrent(request, contestId)) error.value = (e as Error).message;
  } finally { if (isCurrent(request, contestId)) loading.value = false; }
}
watch(() => props.contestId, () => { uploading.value = false; if (input.value) input.value.value = ''; void load(); }, { immediate: true });
onBeforeUnmount(() => { disposed = true; generation++; });

async function upload(event: Event) {
  const picker = event.target as HTMLInputElement, file = picker.files?.[0];
  picker.value = '';
  if (!file || !props.writable || !loaded.value || uploading.value) return;
  const request = generation, contestId = props.contestId;
  uploading.value = true;
  try {
    if (!['image/png', 'image/jpeg'].includes(file.type) && !(file.type === '' && /\.(?:png|jpe?g)$/i.test(file.name))) throw new Error('请选择 PNG 或 JPEG 图片');
    if (!file.size || file.size > 1_000_000) throw new Error('每张图片需大于 0 字节且不超过 1 MB，请缩小图片后上传');
    if (assets.value.length >= 100 || totalBytes.value + file.size > 20_000_000) throw new Error('本场比赛的图片最多 100 张、合计 20 MB');
    let bytes: ArrayBuffer;
    try { bytes = await file.arrayBuffer(); } catch { throw new Error('读取图片失败，请重新选择图片'); }
    if (!isCurrent(request, contestId) || !props.writable) return;
    const asset = await api<IntroductionAsset>(`/contests/${contestId}/assets`, {
      method: 'POST', body: JSON.stringify({ name: file.name.slice(0, 120), base64: bytesBase64(new Uint8Array(bytes)) }),
    });
    if (!isCurrent(request, contestId)) return;
    assets.value = [asset, ...assets.value.filter(existing => existing.id !== asset.id)];
    message.success('图片已上传，点击“插入图片页”添加到开场总结');
  } catch (e) { if (isCurrent(request, contestId)) message.error((e as Error).message); }
  finally { if (isCurrent(request, contestId)) uploading.value = false; }
}

function insert(asset: IntroductionAsset) {
  if (!props.writable || !assets.value.some(existing => existing.id === asset.id)) return;
  if (!/^assets\/[A-Za-z0-9_-]+\.(?:png|jpg|jpeg)$/.test(asset.path)) { message.error('图片引用路径无效，请刷新图片列表后重试'); return; }
  emit('insert', String.raw`\begin{frame}{比赛总结}
\centering
\includegraphics[width=1\linewidth,height=0.68\textheight,keepaspectratio]{${asset.path}}
\end{frame}`);
}
</script>

<template>
  <div class="introduction-assets">
    <div class="introduction-assets-heading">
      <strong>开场总结图片<span v-if="loaded"> · {{ assets.length }} / 100</span></strong>
      <NButton v-if="writable" size="small" :loading="uploading" :disabled="!loaded || atCapacity" @click="input?.click()">上传图片</NButton>
      <input v-if="writable" ref="input" type="file" accept="image/png,image/jpeg,.png,.jpg,.jpeg" hidden aria-label="上传开场总结图片" @change="upload" />
    </div>
    <p class="muted introduction-assets-help">点击缩略图查看大图。<template v-if="writable">支持 PNG / JPEG，每张最多 1 MB，每场合计最多 20 MB。插入时自动生成一页，并等比适配页面；可添加多张图片，插入后需保存编排。</template></p>
    <NAlert v-if="error" type="error" class="introduction-assets-error">图片列表加载失败：{{ error }} <NButton size="tiny" @click="load">重新加载</NButton></NAlert>
    <p v-else-if="loading" class="muted" role="status">正在加载图片…</p>
    <NImageGroup v-else-if="assets.length">
      <div class="introduction-assets-grid">
        <article v-for="asset in assets" :key="asset.id" class="introduction-asset">
          <NImage :src="`/api/contests/${contestId}/assets/${asset.id}/file`" :alt="asset.name" :width="160" :height="90" object-fit="contain" lazy class="introduction-asset-preview" />
          <div class="introduction-asset-details"><strong :title="asset.name">{{ asset.name }}</strong><small class="muted">{{ (asset.bytes / 1000).toFixed(1) }} KB</small></div>
          <NButton v-if="writable" size="small" @click="insert(asset)">插入图片页</NButton>
        </article>
      </div>
    </NImageGroup>
    <p v-else class="muted">{{ writable ? '尚无图片，可上传比赛总结图、榜单或统计图。' : '尚无开场总结图片。' }}</p>
  </div>
</template>

<style scoped>
.introduction-assets{margin:16px 0;padding:14px;border:1px solid var(--line-soft);border-radius:8px}
.introduction-assets-heading{display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap}
.introduction-assets-help{font-size:12px;margin:8px 0 12px;line-height:1.6}
.introduction-assets-error{margin-top:8px}
.introduction-assets-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(205px,1fr));gap:12px}
.introduction-asset{display:flex;flex-direction:column;align-items:flex-start;gap:10px;min-width:0;padding:12px;border:1px solid var(--line-soft);border-radius:6px}
.introduction-asset-preview{align-self:center;max-width:100%}
.introduction-asset-details{display:flex;flex-direction:column;gap:2px;max-width:100%}
.introduction-asset-details strong{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:13px}
</style>
