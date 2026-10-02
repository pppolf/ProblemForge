<script setup lang="ts">
import { computed, ref } from 'vue';
import { NAlert, NButton, NTag, NSelect, NCheckbox, NEmpty, NTabs, NTab } from 'naive-ui';
import { defaultInteractionSettings, judgePurposeLabels, type JudgePurpose } from '@problemforge/contracts';
const props = withDefaults(defineProps<{ run: any; writable?: boolean }>(), { writable: false });
const emit = defineEmits<{ cancel: []; retry: []; apply: [caseIds: string[]] }>();
const tab = ref('matrix'), selectedInvocation = ref(''), selectedCases = ref<string[]>([]);
const programs = computed(() => props.run.input?.programs?.filter((p: any) => props.run.report?.matrix?.some((c: any) => c.programId === p.id)) ?? []);
const invocations = computed(() => props.run.invocations ?? []);
const interactive = computed(() => props.run.input?.settings?.interactionMode === 'INTERACTIVE' && ['ANSWERS', 'ACCEPTANCE'].includes(props.run.purpose));
const directInteraction = computed(() => interactive.value && (props.run.input.settings.interaction?.verdictMode ?? defaultInteractionSettings.verdictMode) === 'DIRECT');
const answerLabel = computed(() => interactive.value ? directInteraction.value ? 'Interactor 附加输出' : '比较用输出（tout）' : '答案');
const dataCases = computed(() => {
  const mainInvocations = new Map<string, any>(invocations.value.filter((i: any) => i.phase === 'MAIN_SOLUTION').map((i: any) => [i.caseRef, i]));
  return (props.run.cases ?? []).map((c: any) => ({ ...c, mainInvocation: mainInvocations.get(c.ref) }));
});
const selected = computed(() => invocations.value.find((i: any) => i.id === selectedInvocation.value) ?? invocations.value.at(-1));
const canApply = computed(() => props.writable && props.run.state === 'SUCCEEDED' && !props.run.stale && ['GENERATE', 'ANSWERS', 'ACCEPTANCE'].includes(props.run.purpose));
function tone(verdict: string) { return verdict === 'AC' || verdict === 'ACCEPT' || verdict === 'COMPILED' ? 'success' as const : ['CE', 'TOOL_ERROR', 'INFRA_ERROR'].includes(verdict) ? 'error' as const : 'warning' as const; }
function cell(programId: string, ref: string) { return props.run.report?.matrix?.find((c: any) => c.programId === programId && c.caseRef === ref); }
function inspect(id: string) { selectedInvocation.value = id; tab.value = 'log'; }
function choose(id: string, value: boolean) { selectedCases.value = value ? [...selectedCases.value, id] : selectedCases.value.filter(c => c !== id); }
function stdoutLabel(invocation: any) {
  if (interactive.value) {
    if (invocation.phase === 'MAIN_SOLUTION') return '主标程输出';
    if (invocation.phase === 'SOLUTION') return '选手输出';
    if (invocation.phase === 'INTERACTOR') return 'Interactor 通信输出';
  }
  return 'stdout';
}
</script>
<template><div class="judge-report"><div class="panel-toolbar"><div><strong>{{ judgePurposeLabels[run.purpose as JudgePurpose] }} · {{ run.state }}</strong><small>{{ run.stage }} · 已完成 {{ run.completed }} 个处理步骤 · {{ run.id }}</small></div><div class="toolbar-right"><NTag v-if="run.accepted !== null" :type="run.accepted ? 'success' : 'warning'">{{ run.accepted ? '符合预期' : '未通过验收' }}</NTag><NButton v-if="writable && ['QUEUED', 'RUNNING'].includes(run.state)" size="small" @click="emit('cancel')">取消任务</NButton><NButton v-if="writable && ['FAILED', 'CANCELED'].includes(run.state)" size="small" @click="emit('retry')">重试原快照</NButton></div></div>
  <NAlert v-if="run.stale" type="warning" :show-icon="false">历史结果：相关程序、数据、工具或配置已改变。请按当前版本重新执行，不能用于当前版本冻结。</NAlert><NAlert v-if="run.errorCode" type="error">{{ run.errorCode }}</NAlert><NAlert v-for="(w, i) in run.report?.warnings ?? []" :key="i" type="warning" :show-icon="false">{{ w }}</NAlert>
  <NAlert v-if="interactive" type="info" :show-icon="false"><template v-if="directInteraction">本任务由 Interactor 直接判定。附加输出文件（tout）允许为 0 字节；主标程的询问和最终回答请查看「主标程输出」或「通信记录」。</template><template v-else>本任务将 Interactor 写入的输出（tout）交给 Checker 比较；主标程的交互通信单独保存在「主标程输出」和「通信记录」中。</template></NAlert>
  <NTabs v-model:value="tab" type="line"><NTab name="matrix">验收矩阵</NTab><NTab v-if="run.report?.scores?.length" name="scores">组分与总分</NTab><NTab name="data">{{ interactive ? '输入与交互记录' : '输入与答案' }}</NTab><NTab name="selftests">自测与编译</NTab><NTab name="log">执行日志</NTab></NTabs>
  <div v-if="tab === 'matrix'" class="report-body"><div class="table-scroll"><table v-if="programs.length" class="data-table matrix-table"><thead><tr><th>解法 / 固定版本</th><th v-for="c in run.cases" :key="c.id">#{{ c.number }}<small>{{ c.groupName }}</small></th><th>预期检查</th></tr></thead><tbody><tr v-for="p in programs" :key="p.id"><td>{{ p.name }}<small>源码 v{{ p.version }} · {{ p.profile.name }}</small></td><td v-for="c in run.cases" :key="c.id"><template v-if="cell(p.id, c.ref)"><button class="matrix-cell" :title="cell(p.id, c.ref).diagnostic" @click="inspect(cell(p.id, c.ref).invocationId)"><NTag size="small" :type="tone(cell(p.id, c.ref).verdict)">{{ cell(p.id, c.ref).verdict }}</NTag><small>{{ cell(p.id, c.ref).timeMs.toFixed(1) }} ms<br/>{{ (cell(p.id, c.ref).memoryBytes / 1048576).toFixed(1) }} MiB</small></button></template><span v-else class="muted">未执行</span></td><td><template v-for="e in (run.report?.expectations ?? []).filter((e: any) => e.programId === p.id)" :key="e.programId"><NTag size="small" :type="e.passed ? 'success' : 'warning'">{{ e.passed ? '符合预期' : '未符合预期' }}</NTag><small>{{ e.diagnostic }}</small></template></td></tr></tbody></table><NEmpty v-else description="此任务尚无解法验收矩阵。生成、校验、答案与自测结果在各自标签中查看。" class="empty"/></div></div>
  <div v-else-if="tab === 'scores'" class="report-body"><div v-for="s in run.report.scores" :key="s.programId"><div class="panel-toolbar"><strong>{{ run.input.programs.find((p: any) => p.id === s.programId)?.name }} · {{ (s.totalScoreMilli / 1000).toFixed(3) }} / {{ (s.maxScoreMilli / 1000).toFixed(3) }}</strong><NTag :type="s.allPassed ? 'success' : 'warning'">{{ s.allPassed ? '全部通过' : '未全过' }}</NTag></div><table class="data-table"><thead><tr><th>数据组</th><th>通过权重 / 全部权重</th><th>组内原始得分</th><th>依赖后得分 / 满分</th><th>阻断原因</th></tr></thead><tbody><tr v-for="g in s.groups" :key="g.id"><td>{{g.id}}</td><td>{{g.passedWeight}} / {{g.totalWeight}}</td><td>{{(g.rawScoreMilli/1000).toFixed(3)}}</td><td>{{(g.scoreMilli/1000).toFixed(3)}} / {{(g.fullScoreMilli/1000).toFixed(3)}}</td><td>{{g.blockedBy.length ? '依赖未全过：'+g.blockedBy.join('、') : '无'}}</td></tr></tbody></table></div></div>
  <div v-else-if="tab === 'data'" class="report-body">
    <div v-if="canApply" class="report-actions">
      <NButton size="small" @click="selectedCases = run.cases.filter((c: any) => c.origin.type === 'GENERATOR' || c.answerHash).map((c: any) => c.id)">选择可收集数据</NButton>
      <NButton type="primary" size="small" :disabled="!selectedCases.length" @click="emit('apply', selectedCases)">收集所选输入 / {{ interactive ? 'Interactor 输出' : '答案' }}到正式数据</NButton>
      <span class="muted">收集会形成新数据版本，并使依赖旧数据的报告过期</span>
    </div>
    <div class="table-scroll"><table class="data-table">
      <thead><tr><th v-if="canApply">选择</th><th>数据</th><th>来源与固定版本</th><th>校验</th><th>原始字节下载</th></tr></thead>
      <tbody><tr v-for="c in dataCases" :key="c.id">
        <td v-if="canApply"><NCheckbox :checked="selectedCases.includes(c.id)" :disabled="c.origin.type !== 'GENERATOR' && !c.answerHash" :aria-label="`选择数据 ${c.number}`" @update:checked="v => choose(c.id, v)"/></td>
        <td>#{{ c.number }} · {{ c.groupName }}<small>{{ c.inputBytes }} bytes · {{ c.inputHash.slice(0, 12) }}</small></td>
        <td>{{ c.origin.type === 'GENERATOR' ? `生成计划 v${c.origin.planVersion} · seed=${c.origin.seed}` : c.origin.type === 'COUNTEREXAMPLE' ? `反例 · seed=${c.origin.seed} · ${c.origin.verdict}` : `测试数据 v${c.origin.testVersion}` }}<small>{{ c.ref }}</small></td>
        <td>{{ c.validation }}</td>
        <td>
          <a :href="`/api/test-runs/${run.id}/cases/${c.id}/input`">输入</a>
          <small v-if="c.answerHash"><a :href="`/api/test-runs/${run.id}/cases/${c.id}/answer`">{{ answerLabel }} · {{ c.answerBytes }} bytes</a><span v-if="directInteraction && c.answerBytes === 0">（允许为空）</span></small>
          <template v-if="interactive && c.mainInvocation">
            <small v-if="c.mainInvocation.stdoutHash"><a :href="`/api/invocations/${c.mainInvocation.id}/stdout`">主标程输出 · {{ c.mainInvocation.stdoutBytes }} bytes</a></small>
            <small v-if="c.mainInvocation.detail?.transcript"><a :href="`/api/invocations/${c.mainInvocation.id}/transcript`">通信记录 · JSONL</a></small>
          </template>
        </td>
      </tr></tbody>
    </table></div>
  </div>
  <div v-else-if="tab === 'selftests'" class="report-body"><table class="data-table"><thead><tr><th>编译 / 自测</th><th>实际结果</th><th>期望与诊断</th></tr></thead><tbody><tr v-for="c in run.report?.compilations ?? []" :key="c.programId"><td>{{ c.name }} · v{{ c.version }}</td><td><NTag :type="tone(c.verdict)">{{ c.verdict }}</NTag></td><td><NButton text @click="inspect(c.invocationId)">打开编译日志</NButton></td></tr><tr v-for="t in run.report?.selfTests ?? []" :key="t.id"><td>{{ t.name }}</td><td><NTag :type="t.passed ? 'success' : 'error'">{{ t.actual }}</NTag></td><td>预期 {{ t.expected }}<small>{{ t.diagnostic }}</small></td></tr></tbody></table></div>
  <div v-else class="report-body">
    <NSelect v-model:value="selectedInvocation" :options="invocations.map((i: any) => ({ label: `${i.phase} · ${i.verdict} · ${i.caseRef ?? i.selfTestId ?? '编译'} · ${i.programRevisionId}`, value: i.id }))" placeholder="选择执行或缓存记录"/>
    <div v-if="selected" class="invocation-summary">
      <NTag :type="tone(selected.verdict)">{{ selected.verdict }}</NTag>
      <span v-if="selected.status === 'Cached'">已复用编译缓存 · 本次未重新编译</span>
      <span v-else>沙箱 {{ selected.status }} / exit={{ selected.exitStatus }} · {{ selected.timeMs.toFixed(2) }} ms · {{ (selected.memoryBytes / 1048576).toFixed(2) }} MiB</span>
      <a v-if="selected.detail?.transcript" :href="`/api/invocations/${selected.id}/transcript`">有界通信记录 · JSONL</a>
      <a v-if="selected.status !== 'Cached'" :href="`/api/invocations/${selected.id}/stdout`">{{ stdoutLabel(selected) }} · {{ selected.stdoutBytes }} bytes</a>
      <a v-if="selected.status !== 'Cached'" :href="`/api/invocations/${selected.id}/stderr`">stderr · {{ selected.stderrBytes }} bytes</a>
      <a v-if="['MAIN_SOLUTION', 'SOLUTION'].includes(selected.phase) && (selected.detail?.output || selected.detail?.judgedOutput)" :href="`/api/invocations/${selected.id}/output`">{{ interactive ? answerLabel : '判题输出' }} · {{ (selected.detail.judgedOutput ?? selected.detail.output).bytes }} bytes</a>
    </div>
    <pre class="build-log">{{ selected?.diagnostic || run.log || '等待 Worker 返回执行记录。' }}</pre>
  </div>
</div></template>
