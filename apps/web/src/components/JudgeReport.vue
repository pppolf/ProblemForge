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
const communication = computed(() => props.run.input?.settings?.interactionMode === 'COMMUNICATION' && ['ANSWERS', 'ACCEPTANCE'].includes(props.run.purpose));
const directInteraction = computed(() => interactive.value && (props.run.input.settings.interaction?.verdictMode ?? defaultInteractionSettings.verdictMode) === 'DIRECT');
const answerLabel = computed(() => interactive.value ? directInteraction.value ? 'Interactor 附加输出' : '比较用输出（tout）' : communication.value ? '答案（第 2 轮输出）' : '答案');
const dataCases = computed(() => {
  const mainInvocations = new Map<string, any>(invocations.value.filter((i: any) => i.phase === 'MAIN_SOLUTION').map((i: any) => [i.caseRef, i]));
  return (props.run.cases ?? []).map((c: any) => ({ ...c, mainInvocation: mainInvocations.get(c.ref) }));
});
const selected = computed(() => invocations.value.find((i: any) => i.id === selectedInvocation.value) ?? invocations.value.at(-1));
const canApply = computed(() => props.writable && props.run.state === 'SUCCEEDED' && !props.run.stale && ['GENERATE', 'ANSWERS', 'ACCEPTANCE'].includes(props.run.purpose));
const matrixStats = computed(() => {
  const cells: any[] = props.run.report?.matrix ?? [];
  const expectations: any[] = props.run.report?.expectations ?? [];
  let ac = 0, maxTime = 0, maxMem = 0;
  for (const c of cells) {
    if (c.verdict === 'AC') ac++;
    if (c.timeMs > maxTime) maxTime = c.timeMs;
    if (c.memoryBytes > maxMem) maxMem = c.memoryBytes;
  }
  return {
    total: cells.length,
    ac,
    maxTime,
    maxMemMb: maxMem / 1048576,
    expPassed: expectations.filter(e => e.passed).length,
    expTotal: expectations.length,
  };
});

function verdictClass(verdict: string) {
  if (['AC', 'ACCEPT', 'COMPILED'].includes(verdict)) return 'verdict-ac';
  if (['WA', 'REJECT'].includes(verdict)) return 'verdict-wa';
  if (verdict === 'TLE') return 'verdict-tle';
  if (verdict === 'MLE') return 'verdict-mle';
  if (['RE', 'OLE', 'PE'].includes(verdict)) return 'verdict-re';
  if (['CE', 'TOOL_ERROR', 'INFRA_ERROR', 'INVALID_INPUT'].includes(verdict)) return 'verdict-ce';
  return '';
}
function cell(programId: string, ref: string) { return props.run.report?.matrix?.find((c: any) => c.programId === programId && c.caseRef === ref); }
function inspect(id: string) { selectedInvocation.value = id; tab.value = 'log'; }
function choose(id: string, value: boolean) { selectedCases.value = value ? [...selectedCases.value, id] : selectedCases.value.filter(c => c !== id); }
function stdoutLabel(invocation: any) {
  if (communication.value) {
    if (invocation.phase === 'COMMUNICATION_PASS1') return '第 1 轮输出（first）';
    if (invocation.phase === 'MAIN_SOLUTION') return '主标程第 2 轮输出';
    if (invocation.phase === 'SOLUTION') return '选手第 2 轮输出';
    if (invocation.phase === 'INTERACTOR') return 'Interactor 通信输出';
  }
  if (interactive.value) {
    if (invocation.phase === 'MAIN_SOLUTION') return '主标程输出';
    if (invocation.phase === 'SOLUTION') return '选手输出';
    if (invocation.phase === 'INTERACTOR') return 'Interactor 通信输出';
  }
  return 'stdout';
}
</script>
<template>
  <div class="judge-report">
    <div class="panel-toolbar">
      <div>
        <strong>{{ judgePurposeLabels[run.purpose as JudgePurpose] }} · {{ run.state }}</strong>
        <small>{{ run.stage }} · 已完成 <span class="mono-num">{{ run.completed }}</span> 步 · <span class="mono-num">{{ run.id }}</span></small>
      </div>
      <div class="toolbar-right">
        <NTag v-if="run.accepted !== null" :bordered="false" :type="run.accepted ? 'success' : 'warning'">{{ run.accepted ? '符合预期' : '未通过验收' }}</NTag>
        <NButton v-if="writable && ['QUEUED', 'RUNNING'].includes(run.state)" size="small" @click="emit('cancel')">取消任务</NButton>
        <NButton v-if="writable && ['FAILED', 'CANCELED'].includes(run.state)" size="small" @click="emit('retry')">重试原快照</NButton>
      </div>
    </div>
    <NAlert v-if="run.stale" type="warning" :show-icon="false">历史结果：相关程序、数据、工具或配置已改变。请按当前版本重新执行，不能用于当前版本冻结。</NAlert>
    <NAlert v-if="run.errorCode" type="error">{{ run.errorCode }}</NAlert>
    <NAlert v-for="(w, i) in run.report?.warnings ?? []" :key="i" type="warning" :show-icon="false">{{ w }}</NAlert>
    <NAlert v-if="run.report?.skippedGeneratedInputs?.length" type="info" :show-icon="false">已自动跳过 {{ run.report.skippedGeneratedInputs.length }} 份重复生成输入，沿用相同输入的已有数据。</NAlert>
    <NAlert v-if="interactive" type="info" :show-icon="false">
      <template v-if="directInteraction">本任务由 Interactor 直接判定。附加输出文件（tout）允许为 0 字节；主标程的询问和最终回答请查看「主标程输出」或「通信记录」。</template>
      <template v-else>本任务将 Interactor 写入的输出（tout）交给 Checker 比较；主标程的交互通信单独保存在「主标程输出」和「通信记录」中。</template>
    </NAlert>
    <NAlert v-if="communication" type="info" :show-icon="false">
      本任务为两轮通信验收（first / second）：第 1 轮由 Interactor 校验并经 tout 生成第 2 轮输入，第 2 轮在全新隔离进程中运行并由 Checker / 比较器终判。两轮各自独享时间与内存限制，矩阵显示两轮峰值。
    </NAlert>
    <NTabs v-model:value="tab" type="line">
      <NTab name="matrix">验收矩阵</NTab>
      <NTab v-if="run.report?.scores?.length" name="scores">组分与总分</NTab>
      <NTab name="data">{{ interactive ? '输入与交互记录' : communication ? '输入、中转与答案' : '输入与答案' }}</NTab>
      <NTab name="selftests">自测与编译</NTab>
      <NTab name="log">执行日志</NTab>
    </NTabs>
    <div v-if="tab === 'matrix'" class="report-body">
      <div v-if="matrixStats.total" class="matrix-summary-strip">
        <span class="matrix-summary-item">AC 单元：<strong class="mono-num">{{ matrixStats.ac }} / {{ matrixStats.total }}</strong></span>
        <span v-if="matrixStats.expTotal" class="matrix-summary-item">预期匹配：<strong class="mono-num">{{ matrixStats.expPassed }} / {{ matrixStats.expTotal }}</strong></span>
        <span class="matrix-summary-item">峰值耗时：<strong class="mono-num">{{ matrixStats.maxTime.toFixed(1) }} ms</strong></span>
        <span class="matrix-summary-item">峰值内存：<strong class="mono-num">{{ matrixStats.maxMemMb.toFixed(1) }} MiB</strong></span>
        <span class="muted" style="margin-left: auto; font-size: 11.5px">点击任意单元格查看该次沙箱日志</span>
      </div>
      <div class="table-scroll">
        <table v-if="programs.length" class="data-table matrix-table">
          <thead>
            <tr>
              <th>解法 / 固定版本</th>
              <th v-for="c in run.cases" :key="c.id" class="mono-num">#{{ c.number }}<small>{{ c.groupName }}</small></th>
              <th>预期检查</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="p in programs" :key="p.id">
              <td><strong>{{ p.name }}</strong><small class="mono-num">v{{ p.version }} · {{ p.profile.name }}</small></td>
              <td v-for="c in run.cases" :key="c.id">
                <template v-if="cell(p.id, c.ref)">
                  <button
                    class="matrix-cell"
                    :class="verdictClass(cell(p.id, c.ref).verdict)"
                    :title="cell(p.id, c.ref).diagnostic"
                    @click="inspect(cell(p.id, c.ref).invocationId)"
                  >
                    <span class="matrix-cell-verdict">{{ cell(p.id, c.ref).verdict }}</span>
                    <small>{{ cell(p.id, c.ref).timeMs.toFixed(1) }} ms<br />{{ (cell(p.id, c.ref).memoryBytes / 1048576).toFixed(1) }} MiB</small>
                  </button>
                </template>
                <span v-else class="muted">—</span>
              </td>
              <td>
                <template v-for="e in (run.report?.expectations ?? []).filter((e: any) => e.programId === p.id)" :key="e.programId">
                  <NTag size="small" :bordered="false" :type="e.passed ? 'success' : 'warning'">{{ e.passed ? '符合预期' : '未符合预期' }}</NTag>
                  <small>{{ e.diagnostic }}</small>
                </template>
              </td>
            </tr>
          </tbody>
        </table>
        <NEmpty v-else description="此任务尚无解法验收矩阵。生成、校验、答案与自测结果在各自标签中查看。" class="empty" />
      </div>
    </div>
    <div v-else-if="tab === 'scores'" class="report-body">
      <div v-for="s in run.report.scores" :key="s.programId">
        <div class="panel-toolbar">
          <strong>{{ run.input.programs.find((p: any) => p.id === s.programId)?.name }} · <span class="mono-num">{{ (s.totalScoreMilli / 1000).toFixed(3) }} / {{ (s.maxScoreMilli / 1000).toFixed(3) }}</span></strong>
          <NTag :bordered="false" :type="s.allPassed ? 'success' : 'warning'">{{ s.allPassed ? '全部通过' : '未全过' }}</NTag>
        </div>
        <table class="data-table">
          <thead><tr><th>数据组</th><th>通过权重 / 全部权重</th><th>组内原始得分</th><th>依赖后得分 / 满分</th><th>阻断原因</th></tr></thead>
          <tbody>
            <tr v-for="g in s.groups" :key="g.id">
              <td class="mono-num">{{ g.id }}</td>
              <td class="mono-num">{{ g.passedWeight }} / {{ g.totalWeight }}</td>
              <td class="mono-num">{{ (g.rawScoreMilli / 1000).toFixed(3) }}</td>
              <td class="mono-num">{{ (g.scoreMilli / 1000).toFixed(3) }} / {{ (g.fullScoreMilli / 1000).toFixed(3) }}</td>
              <td>{{ g.blockedBy.length ? '依赖未全过：' + g.blockedBy.join('、') : '无' }}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
    <div v-else-if="tab === 'data'" class="report-body">
      <div v-if="canApply" class="report-actions">
        <NButton size="small" @click="selectedCases = run.cases.filter((c: any) => c.origin.type === 'GENERATOR' || c.answerHash).map((c: any) => c.id)">选择可收集数据</NButton>
        <NButton type="primary" size="small" :disabled="!selectedCases.length" @click="emit('apply', selectedCases)">收集所选输入 / {{ interactive ? 'Interactor 输出' : '答案' }}到正式数据</NButton>
        <span class="muted">收集会形成新数据版本，并使依赖旧数据的报告过期</span>
      </div>
      <div class="table-scroll">
        <table class="data-table">
          <thead><tr><th v-if="canApply">选择</th><th>数据</th><th>来源与固定版本</th><th>校验</th><th>原始字节下载</th></tr></thead>
          <tbody>
            <tr v-for="c in dataCases" :key="c.id">
              <td v-if="canApply"><NCheckbox :checked="selectedCases.includes(c.id)" :disabled="c.origin.type !== 'GENERATOR' && !c.answerHash" :aria-label="`选择数据 ${c.number}`" @update:checked="v => choose(c.id, v)" /></td>
              <td><strong class="mono-num">#{{ c.number }}</strong> · {{ c.groupName }}<small class="mono-num">{{ c.inputBytes }} bytes · {{ c.inputHash.slice(0, 12) }}</small></td>
              <td>{{ c.origin.type === 'GENERATOR' ? `生成计划 v${c.origin.planVersion} · seed=${c.origin.seed}` : c.origin.type === 'COUNTEREXAMPLE' ? `反例 · seed=${c.origin.seed} · ${c.origin.verdict}` : `测试数据 v${c.origin.testVersion}` }}<small class="mono-num">{{ c.ref }}</small></td>
              <td><span class="verdict-pill" :class="verdictClass(c.validation)">{{ c.validation }}</span></td>
              <td>
                <a :href="`/api/test-runs/${run.id}/cases/${c.id}/input`">输入</a>
                <small v-if="c.answerHash"><a :href="`/api/test-runs/${run.id}/cases/${c.id}/answer`">{{ answerLabel }} · {{ c.answerBytes }} bytes</a><span v-if="directInteraction && c.answerBytes === 0">（允许为空）</span></small>
                <template v-if="interactive && c.mainInvocation">
                  <small v-if="c.mainInvocation.stdoutHash"><a :href="`/api/invocations/${c.mainInvocation.id}/stdout`">主标程输出 · {{ c.mainInvocation.stdoutBytes }} bytes</a></small>
                  <small v-if="c.mainInvocation.detail?.transcript"><a :href="`/api/invocations/${c.mainInvocation.id}/transcript`">通信记录 · JSONL</a></small>
                </template>
                <template v-if="communication && c.mainInvocation">
                  <small v-if="c.mainInvocation.detail?.forwardedInput"><a :href="`/api/invocations/${c.mainInvocation.id}/forwarded`">第 2 轮中转输入（tout）· {{ c.mainInvocation.detail.forwardedInput.bytes }} bytes</a></small>
                  <small v-if="c.mainInvocation.detail?.transcript"><a :href="`/api/invocations/${c.mainInvocation.id}/transcript`">第 1 轮通信记录 · JSONL</a></small>
                </template>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
    <div v-else-if="tab === 'selftests'" class="report-body">
      <table class="data-table">
        <thead><tr><th>编译 / 自测</th><th>实际结果</th><th>期望与诊断</th></tr></thead>
        <tbody>
          <tr v-for="c in run.report?.compilations ?? []" :key="c.programId">
            <td><strong>{{ c.name }}</strong> <span class="mono-num">v{{ c.version }}</span></td>
            <td><span class="verdict-pill" :class="verdictClass(c.verdict)">{{ c.verdict }}</span></td>
            <td><NButton text type="primary" @click="inspect(c.invocationId)">打开编译日志</NButton></td>
          </tr>
          <tr v-for="t in run.report?.selfTests ?? []" :key="t.id">
            <td>{{ t.name }}</td>
            <td><span class="verdict-pill" :class="t.passed ? 'verdict-ac' : 'verdict-wa'">{{ t.actual }}</span></td>
            <td>预期 <span class="mono-num">{{ t.expected }}</span><small>{{ t.diagnostic }}</small></td>
          </tr>
        </tbody>
      </table>
    </div>
    <div v-else class="report-body">
      <div class="report-actions" style="margin-bottom: 10px">
        <NButton v-if="programs.length" size="small" secondary @click="tab = 'matrix'">← 返回验收矩阵</NButton>
        <NSelect v-model:value="selectedInvocation" style="flex: 1; min-width: 240px" :options="invocations.map((i: any) => ({ label: `${i.phase} · ${i.verdict} · ${i.caseRef ?? i.selfTestId ?? '编译'} · ${i.programRevisionId}`, value: i.id }))" placeholder="选择执行或缓存记录" />
      </div>
      <div v-if="selected" class="invocation-summary">
        <span class="verdict-pill" :class="verdictClass(selected.verdict)">{{ selected.verdict }}</span>
        <span v-if="selected.status === 'Cached'">已复用编译缓存 · 本次未重新编译</span>
        <span v-else>沙箱 {{ selected.status }} / exit={{ selected.exitStatus }} · {{ selected.timeMs.toFixed(2) }} ms · {{ (selected.memoryBytes / 1048576).toFixed(2) }} MiB</span>
        <a v-if="selected.detail?.transcript" :href="`/api/invocations/${selected.id}/transcript`">{{ communication ? '第 1 轮通信记录 · JSONL' : '有界通信记录 · JSONL' }}</a>
        <a v-if="selected.detail?.forwardedInput" :href="`/api/invocations/${selected.id}/forwarded`">第 2 轮中转输入（tout）· {{ selected.detail.forwardedInput.bytes }} bytes</a>
        <a v-if="selected.status !== 'Cached'" :href="`/api/invocations/${selected.id}/stdout`">{{ stdoutLabel(selected) }} · {{ selected.stdoutBytes }} bytes</a>
        <a v-if="selected.status !== 'Cached'" :href="`/api/invocations/${selected.id}/stderr`">stderr · {{ selected.stderrBytes }} bytes</a>
        <a v-if="['MAIN_SOLUTION', 'SOLUTION'].includes(selected.phase) && (selected.detail?.output || selected.detail?.judgedOutput)" :href="`/api/invocations/${selected.id}/output`">{{ interactive ? answerLabel : '判题输出' }} · {{ (selected.detail.judgedOutput ?? selected.detail.output).bytes }} bytes</a>
      </div>
      <pre class="build-log">{{ selected?.diagnostic || run.log || '等待 Worker 返回执行记录。' }}</pre>
    </div>
  </div>
</template>
