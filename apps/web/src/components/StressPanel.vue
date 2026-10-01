<script setup lang="ts">
import { ref, computed, watch, onMounted, onBeforeUnmount } from 'vue';
import { NButton, NSelect, NInput, NInputNumber, NFormItem, NCheckbox, NAlert, NEmpty, useMessage } from 'naive-ui';
import { useTaskEvents } from '../task-events';
import { api } from '../api';
import JudgeReport from './JudgeReport.vue';
const props = defineProps<{ problemId: string; programs: any[]; groupIds: string[]; writable: boolean; defaultNumber: number }>();
const emit = defineEmits<{ dirty: [value: boolean]; dataChanged: [] }>();
const requestKey = () => crypto.randomUUID();
const message = useMessage(), busy = ref(false), version = ref(0), saved = ref(''), loaded = ref(false);
const draft = ref({ generatorId: '', referenceId: '', candidateId: '', checkerId: null as string | null, argvText: '[]', seed: '1', iterations: 100, budgetMs: 60000, stop: 'FIRST_COUNTEREXAMPLE', groupIds: [] as string[] });
const dirty = computed(() => loaded.value && JSON.stringify(draft.value) !== saved.value);
watch(dirty, value => emit('dirty', value));
const runs = ref<any[]>([]), selectedId = ref(''), run = ref<any>();
const number = ref(props.defaultNumber), group = ref('main'), duplicate = ref(false), regenerate = ref(false);

const options = (roles: string[]) => props.programs.filter(p => p.enabled && roles.includes(p.role)).map(p => ({ label: `${p.name} · v${p.version}`, value: p.id }));
const solutions = ['MAIN_SOLUTION', 'CORRECT_SOLUTION', 'WRONG_SOLUTION', 'TIME_LIMIT_SOLUTION', 'BRUTE_FORCE'];
async function refresh() {
  runs.value = (await api(`/test-runs?problemId=${props.problemId}`)).filter((r: any) => ['STRESS', 'REPLAY'].includes(r.purpose));
  selectedId.value ||= runs.value[0]?.id ?? '';
  if (selectedId.value) run.value = await api(`/test-runs/${selectedId.value}`);
}
onMounted(async () => {
  try { const config = await api(`/problems/${props.problemId}/stress-config`); version.value = config.version; if (config.data) { const { argv, ...data } = config.data; draft.value = { groupIds: [], ...data, argvText: JSON.stringify(argv) }; } saved.value = JSON.stringify(draft.value); loaded.value = true; await refresh(); }
  catch (e) { message.error((e as Error).message); }

});

useTaskEvents(()=>refresh().catch(e=>message.error(e.message)),{problemId:props.problemId});
async function save() {
  busy.value = true;
  try { const { argvText, ...data } = draft.value; const config = await api(`/problems/${props.problemId}/stress-config`, { method: 'PUT', body: JSON.stringify({ expectedVersion: version.value, data: { ...data, argv: JSON.parse(argvText) } }) }); version.value = config.version; saved.value = JSON.stringify(draft.value); await refresh(); message.success(`对拍配置已保存 v${version.value}`); }
  catch (e) { message.error((e as Error).message); } finally { busy.value = false; }
}
async function action(path: string, body?: object) {
  busy.value = true;
  try { const result = await api(path, { method: 'POST', ...(body ? { body: JSON.stringify(body) } : {}) }); if (result.id && !path.endsWith('apply-counterexample')) selectedId.value = result.id; if (path.endsWith('apply-counterexample')) { emit('dataChanged'); number.value++; message.success('反例已成为新的正式数据版本'); } await refresh(); }
  catch (e) { message.error((e as Error).message); } finally { busy.value = false; }
}
const outcome: Record<string, string> = { RUNNING: '执行中', COUNTEREXAMPLE_FOUND: '发现反例', ITERATION_LIMIT: '迭代完成，未发现反例', BUDGET_EXHAUSTED: '预算耗尽', CANCELED: '已取消', TOOL_ERROR: '工具或参考解失败', INFRA_ERROR: '基础设施错误', REPRODUCED: '复现相同判定', NOT_REPRODUCED: '未复现原判定' };
</script>
<template><div class="settings-pane"><div class="document-toolbar"><span>{{ dirty ? '未保存修改' : `对拍配置 v${version}` }}</span><div class="toolbar-right"><NButton v-if="writable" :loading="busy" @click="save">保存对拍配置</NButton><NButton v-if="writable" type="primary" :disabled="dirty || !version" :loading="busy" @click="action(`/problems/${problemId}/test-runs`, { purpose: 'STRESS', requestKey: requestKey() })">开始对拍</NButton></div></div>
<div class="judge-form-grid"><NFormItem label="生成器"><NSelect v-model:value="draft.generatorId" :options="options(['GENERATOR'])" :disabled="!writable"/></NFormItem><NFormItem label="参考解"><NSelect v-model:value="draft.referenceId" :options="options(solutions)" :disabled="!writable"/></NFormItem><NFormItem label="被测解"><NSelect v-model:value="draft.candidateId" :options="options(solutions)" :disabled="!writable"/></NFormItem><NFormItem label="Checker"><NSelect v-model:value="draft.checkerId" clearable placeholder="当前内置比较器" :options="options(['CHECKER'])" :disabled="!writable"/></NFormItem><NFormItem label="argv / JSON 数组"><NInput v-model:value="draft.argvText" :disabled="!writable"/></NFormItem><NFormItem label="起始种子"><NInput v-model:value="draft.seed" :disabled="!writable"/></NFormItem><NFormItem label="迭代上限"><NInputNumber v-model:value="draft.iterations" :min="1" :max="200" :disabled="!writable"/></NFormItem><NFormItem label="总预算 / ms（包括编译）"><NInputNumber v-model:value="draft.budgetMs" :min="1000" :max="600000" :disabled="!writable"/></NFormItem><NFormItem label="适用组级额外 Validator"><NSelect v-model:value="draft.groupIds" multiple :options="groupIds.map(id => ({ label: id, value: id }))" :disabled="!writable"/></NFormItem><NFormItem label="停止策略"><NSelect v-model:value="draft.stop" :options="[{ label: '发现首个反例即停止', value: 'FIRST_COUNTEREXAMPLE' }, { label: '继续到迭代或预算上限', value: 'CONTINUE' }]" :disabled="!writable"/></NFormItem></div>
<p class="judge-hint">未发现反例不等于证明正确。参考解、生成器或工具失败不会算作反例。复现使用保存输入和原执行快照。</p>
<NSelect v-model:value="selectedId" :options="runs.map(r => ({ label: `${r.purpose === 'REPLAY' ? '复现' : '对拍'} · ${r.state}${r.stale ? ' · 历史结果' : ''} · ${new Date(r.createdAt).toLocaleString('zh-CN')}`, value: r.id }))" placeholder="对拍历史" @update:value="refresh"/>
<template v-if="run"><NAlert v-if="run.report?.stress" :show-icon="false" type="info">{{ outcome[run.report.stress.outcome] }} · 已完成 {{ run.report.stress.completedIterations }} 次 · 反例 {{ run.report.stress.counterexamples }} 个 · 最近种子 {{ run.report.stress.lastSeed }}</NAlert>
<details v-if="run.report?.stress?.iterations?.length" class="stress-detail"><summary>本次迭代记录 · 实际种子</summary><table class="data-table"><thead><tr><th>种子</th><th>判定</th><th>输入哈希</th></tr></thead><tbody><tr v-for="(iteration,index) in run.report.stress.iterations" :key="index"><td>{{iteration.seed}}</td><td>{{iteration.verdict}}</td><td><code>{{iteration.inputHash}}</code></td></tr></tbody></table></details>
<details class="stress-detail"><summary>固定源码与编译配置来源</summary><div v-for="p in run.input.programs" :key="p.id"><strong>{{p.name}} · 源码 v{{p.version}} · {{p.profile.name}} v{{p.profile.version}}</strong><small>源码 {{p.sourceHash}} · profile {{p.profile.hash}}</small><details><summary>查看此任务的源码快照</summary><pre class="build-log">{{p.source}}</pre></details></div></details>
<div v-if="run.cases.length" class="report-body"><div class="judge-form-grid"><NFormItem label="入库编号"><NInputNumber v-model:value="number" :min="1" :max="100000"/></NFormItem><NFormItem label="入库分组标签"><NInput v-model:value="group"/></NFormItem></div><NCheckbox v-model:checked="duplicate">已知重复输入时仍保留</NCheckbox> <NCheckbox v-model:checked="regenerate">复现时附加重新生成检查（仍使用保存输入）</NCheckbox><table class="data-table"><thead><tr><th>反例种子 / 判定</th><th>原始字节与执行证据</th><th>操作</th></tr></thead><tbody><tr v-for="c in run.cases" :key="c.id"><td>{{ c.origin.seed }} · {{ c.origin.verdict }}<small>{{ c.inputHash.slice(0, 16) }} · {{ c.inputBytes }} bytes</small></td><td><a :href="`/api/test-runs/${run.id}/cases/${c.id}/input`">输入</a> · <a :href="`/api/test-runs/${run.id}/cases/${c.id}/answer`">参考输出</a> · <a :href="`/api/invocations/${c.origin.candidateInvocationId}/output`">被测输出</a><small>{{ c.origin.diagnostic }}</small></td><td><NButton v-if="writable" size="small" :loading="busy" @click="action(`/test-runs/${run.id}/cases/${c.id}/reproduce`, { requestKey: requestKey(), regenerate })">复现保存输入</NButton> <NButton v-if="writable" size="small" :disabled="run.stale" :loading="busy" @click="action(`/test-runs/${run.id}/cases/${c.id}/apply-counterexample`, { number, groupName: group, allowDuplicate: duplicate })">显式加入正式数据</NButton></td></tr></tbody></table></div>
<JudgeReport :run="run" :writable="writable" @cancel="action(`/test-runs/${run.id}/cancel`)" @retry="action(`/test-runs/${run.id}/retry`, { requestKey: requestKey() })"/>
</template><NEmpty v-else description="保存配置并启动对拍后显示真实执行结果"/></div></template>
