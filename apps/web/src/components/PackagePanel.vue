<script setup lang="ts">
import { ref, onMounted, computed } from 'vue';
import { NSelect, NButton, NTag, NAlert, useMessage, useDialog } from 'naive-ui';
import { api } from '../api';
const props = defineProps<{ scope: 'problems' | 'contests'; id: string; owner: boolean; hasUnsaved?: boolean; language?: string }>();
const message = useMessage(), dialog = useDialog();
const revisions = ref<any[]>([]), exports = ref<any[]>([]), releases = ref<any[]>([]);
const revisionId = ref<string | null>(props.scope === 'contests' ? 'LATEST' : null), purpose = ref('STATEMENT'), format = ref('NATIVE'), busy = ref(false), selected = ref<any>();
const contestVersion = ref<number>(), contestWritable = ref(false);
const dataTarget = ref('HYDRO'), dataSource = ref('WORKING'), novaComparison = ref('NATIVE');
const targets = [{ label: 'Hydro 题目包', value: 'HYDRO' }, { label: 'NovaJudge 题目包', value: 'NOVAJUDGE_PROBLEM' }, { label: 'NovaJudge 测试数据 ZIP', value: 'NOVAJUDGE' }];
const purposes = [{ label: '题面（含引用样例与图片）', value: 'STATEMENT' }, { label: '文档题解', value: 'EDITORIAL_DOCUMENT' }, { label: 'Beamer 题解', value: 'EDITORIAL_BEAMER' }, { label: '正式数据与判题工具', value: 'DATA' }, { label: '参考解源码', value: 'REFERENCE' }, { label: '完整题目包', value: 'FULL' }];
const revisionOptions = computed(() => [...(props.scope === 'contests' ? [{ label: '最新题目内容（自动同步）', value: 'LATEST' }] : []), ...revisions.value.map(r => ({ label: `#${r.number} ${r.label ?? ''}${r.current ? ' · 当前' : ' · 历史'}`, value: r.id }))]);
const dataOptions = computed(() => [{ label: '当前已保存的内容', value: 'WORKING' }, ...revisionOptions.value]);
const blocked = computed(() => selected.value?.report.some((r: any) => r.status === 'BLOCKED'));
const isDataExport = (e: any) => ['HYDRO_DATA', 'NOVAJUDGE_DATA'].includes(e?.format);
const isHydroProblem = (e: any) => e?.format === 'HYDRO_PROBLEM';
const isNovaProblem = (e: any) => e?.format === 'NOVAJUDGE_PROBLEM';
function exportLabel(e: any) { return isNovaProblem(e) ? 'NovaJudge · 题目包' : isHydroProblem(e) ? 'Hydro · 题目包' : isDataExport(e) ? `${e.format === 'HYDRO_DATA' ? 'Hydro' : 'NovaJudge'} · 测试数据 ZIP` : `${e.format} · ${purposes.find(p => p.value === e.purpose)?.label}`; }
async function act(fn: () => Promise<void>) { busy.value = true; try { await fn(); } catch (e) { message.error((e as Error).message); } finally { busy.value = false; } }
async function load() {
  if (props.scope === 'contests') { const contest = await api(`/contests/${props.id}`); revisions.value = contest.revisions; contestVersion.value = contest.version; contestWritable.value = ['OWNER', 'EDITOR'].includes(contest.role); }
  else revisions.value = await api(`/problems/${props.id}/revisions`);
  exports.value = await api(`/${props.scope}/${props.id}/exports`);
  releases.value = await api(`/${props.scope}/${props.id}/releases`);
  if (!revisionId.value) revisionId.value = revisions.value[0]?.id ?? null;
}
onMounted(() => act(load));
async function generate() { await act(async () => {
  selected.value = await api(`/${props.scope}/${props.id}/exports`, { method: 'POST', body: JSON.stringify({ ...(props.scope === 'contests' && revisionId.value === 'LATEST' ? { expectedVersion: contestVersion.value } : { revisionId: revisionId.value }), purpose: purpose.value, format: format.value }) });
  await load(); message.success('题包已生成，查看兼容报告后下载');
}); }
async function generateData() { await act(async () => {
  const nova = dataTarget.value === 'NOVAJUDGE_PROBLEM';
  selected.value = await api(`/problems/${props.id}/${nova ? 'novajudge-exports' : 'test-data-exports'}`, { method: 'POST', body: JSON.stringify({ ...(nova ? { comparison: novaComparison.value } : { target: dataTarget.value }), ...(nova || dataTarget.value === 'HYDRO' ? { language: props.language } : {}), ...(dataSource.value === 'WORKING' ? {} : { revisionId: dataSource.value }) }) });
  await load(); message.success(nova ? 'NovaJudge 题目包已生成，查看转换报告后下载' : dataTarget.value === 'HYDRO' ? 'Hydro 题目包已生成，查看转换报告后下载' : '测试数据 ZIP 已生成，查看上传说明后下载');
}); }
function publish() { dialog.warning({ title: '发布所选用途的题包', content: `将创建无需登录即可下载的链接，内容为 ${purposes.find(p => p.value === selected.value.purpose)?.label}。撤回能禁止新的平台下载，已下载文件不能追回。`, positiveText: '发布此题包', negativeText: '返回', onPositiveClick: () => act(async () => { await api(`/${props.scope}/${props.id}/releases`, { method: 'POST', body: JSON.stringify({ exportId: selected.value.id }) }); await load(); }) }); }
async function revoke(id: string) { await act(async () => { await api(`/releases/${id}/revoke`, { method: 'POST' }); await load(); }); }
</script>
<template>
  <div class="p4-editor">
    <section v-if="scope === 'problems'" class="test-data-export">
      <div><h3>{{ targets.find(t => t.value === dataTarget)?.label }}</h3><p v-if="dataTarget === 'HYDRO'">以「题目名称_导出时间」打包：statement.md、题解.md 和 tests/。将 {{ language || '默认语言' }} 的题面与文档题解转为 Markdown，保留数学公式；测试数据、.cc 工具和配置放在 tests/，引用图片随包附上。</p><p v-else-if="dataTarget === 'NOVAJUDGE_PROBLEM'">导出 {{ language || '默认语言' }} 的题面、展示样例、图片、时空限制与判题数据，包含 problem.json、data/ 和引用的 assets/。根据判题配置生成传统题、SPJ 或交互题，可在 NovaJudge「导入题目」直接上传整个 ZIP。</p><p v-else>普通题导出 *.in、*.ans；交互题仅导出 *.in。随包附所需 Checker / Interactor。</p></div>
      <div class="p4-toolbar">
        <NSelect v-model:value="dataTarget" :options="targets" aria-label="导出目标平台" :disabled="busy" />
        <NSelect v-model:value="dataSource" :options="dataOptions" aria-label="导出内容来源" :disabled="busy" />
        <NButton type="primary" :loading="busy" :disabled="busy || (dataSource === 'WORKING' && hasUnsaved)" @click="generateData">{{ dataTarget === 'NOVAJUDGE_PROBLEM' ? '导出 NovaJudge 题目包' : dataTarget === 'HYDRO' ? '导出 Hydro 题目包' : '导出测试数据 ZIP' }}</NButton>
      </div>
      <template v-if="dataTarget === 'NOVAJUDGE_PROBLEM'">
        <NSelect v-model:value="novaComparison" :options="[{ label: '普通题使用 NovaJudge 传统格式', value: 'NATIVE' }, { label: '保留本地比较规则（普通题转为 SPJ）', value: 'PRESERVE' }]" aria-label="NovaJudge 普通题比较规则" :disabled="busy" />
        <small>传统格式使用 NovaJudge 的逐行比较，会忽略行末空格及全文首尾空白。自定义 Checker、浮点比较自动导出为 SPJ；交互题使用 Interactor。导出不包含题解或参考解。</small>
      </template>
      <NAlert v-if="hasUnsaved && dataSource === 'WORKING'" type="warning">请先保存编辑，再导出当前内容。</NAlert>
      <small v-else>可直接导出已保存的内容，无需先冻结。{{ dataTarget === 'HYDRO' ? '交互题 tests/ 仅含输入，不导出答案；题面中的交互样例仍保留。' : dataTarget === 'NOVAJUDGE_PROBLEM' ? '交互题 data/ 仅含隐藏输入；展示样例保留在 problem.json。' : '交互题数据 ZIP 仅含非样例输入，不导出答案。' }}</small>
    </section>
    <h3>题目包</h3>
    <p>{{scope === 'contests' ? '默认导出题目最新保存的内容，也可选择历史冻结版本。' : '按用途选择固定修订。'}}原生完整包用于工作副本往返；Polygon 为离线子集，兼容报告逐项列出需处理内容。</p>
    <div class="p4-toolbar">
      <NSelect v-model:value="revisionId" :options="revisionOptions" placeholder="先保存修订 / 冻结比赛" />
      <NSelect v-model:value="purpose" :options="purposes" />
      <NSelect v-model:value="format" :options="[{ label: 'ProblemForge 原生 v1', value: 'NATIVE' }, { label: 'Polygon 离线子集', value: 'POLYGON' }]" />
      <NButton type="primary" :loading="busy" :disabled="!revisionId || busy || (scope === 'contests' && revisionId === 'LATEST' && (hasUnsaved || !contestWritable))" @click="generate">生成题包</NButton>
      <NButton :disabled="busy" @click="act(load)">刷新</NButton>
    </div>
    <NAlert v-if="scope === 'problems'" type="info">正式发布题目包需要当前工作副本对应的已冻结修订。私有导出不要求冻结。</NAlert>
    <div class="p4-split">
      <aside class="p4-list"><NButton v-for="e in exports" :key="e.id" :type="selected?.id === e.id ? 'primary' : 'default'" @click="selected = e">{{ exportLabel(e) }}<br />{{ new Date(e.createdAt).toLocaleString('zh-CN') }}</NButton></aside>
      <section v-if="selected" class="p4-detail">
        <div class="p4-toolbar"><h3>{{ exportLabel(selected) }}</h3><a class="download-link" :href="`/api/exports/${selected.id}/file`">{{ isNovaProblem(selected) ? '下载 NovaJudge 题目包' : isHydroProblem(selected) ? '下载 Hydro 题目包' : isDataExport(selected) ? '下载测试数据 ZIP' : '下载私有题包' }}</a></div>
        <NAlert v-if="blocked" type="warning">此包有待处理的判题设置，请按下方报告调整后再上传使用。</NAlert>
        <p v-if="selected.fileName" class="export-hash">{{ selected.fileName }}</p><p>{{ selected.bytes.toLocaleString() }} 字节 · SHA-256<br /><code class="export-hash">{{ selected.hash }}</code></p>
        <div v-for="(r, i) in selected.report" :key="i" class="p4-comment"><NTag :type="r.status === 'BLOCKED' ? 'error' : r.status === 'WARNING' ? 'warning' : 'success'">{{ r.status === 'BLOCKED' ? '待处理' : r.status === 'WARNING' ? '注意' : '已映射' }}</NTag> {{ r.area }}<p>{{ r.message }}</p></div>
        <NButton v-if="owner && !isDataExport(selected) && !isHydroProblem(selected) && !isNovaProblem(selected)" :disabled="blocked || busy" @click="publish">公开发布此用途</NButton>
      </section>
    </div>
    <h3>已发布题包</h3>
    <div v-for="r in releases.filter(r => r.exportId)" :key="r.id" class="publication-row"><NTag>{{ purposes.find(p => p.value === r.purpose)?.label }}</NTag><span>{{ r.revokedAt ? '已撤回' : '已发布' }}</span><a v-if="!r.revokedAt" :href="`/api/released/${r.token}/file`">下载</a><NButton v-if="owner && !r.revokedAt" size="small" @click="revoke(r.id)">撤回</NButton></div>
  </div>
</template>
<style scoped>
.test-data-export { display: grid; gap: 12px; padding: 20px; border: 1px solid var(--line); border-radius: 12px; background: var(--surface); }
.test-data-export h3, .test-data-export p { margin: 0; }
.test-data-export p { margin-top: 6px; }
.test-data-export small { color: var(--text-muted); }
.export-hash, .p4-comment p { overflow-wrap: anywhere; }
.test-data-export :deep(.n-select) { max-width: 100%; }
</style>
