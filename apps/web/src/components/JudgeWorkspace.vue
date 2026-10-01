<script setup lang="ts">
import { ref, computed, onMounted, onBeforeUnmount, watch } from 'vue';
import { NButton, NTabs, NTab, NSelect, NInput, NInputNumber, NFormItem, NCheckbox, NTag, NAlert, NModal, NEmpty, NSpin, useMessage } from 'naive-ui';
import { programRoles, programRoleLabels, verdicts, judgePurposeLabels, type JudgePurpose, type ProgramRole, defaultJudgeSettings, parseGeneratorCommands, formatGeneratorCommands, generatorPlanCommands } from '@problemforge/contracts';
import { useTaskEvents } from '../task-events';
import { api, binaryFile, bytesBase64 } from '../api';
import SourceEditor from './SourceEditor.vue';
import BinaryInput from './BinaryInput.vue';
import JudgeReport from './JudgeReport.vue';
import StressPanel from './StressPanel.vue';
import GroupPanel from './GroupPanel.vue';
import ScoreExpectationEditor from './ScoreExpectationEditor.vue';
import InteractionSettingsPanel from './InteractionSettingsPanel.vue';
import GeneratorPlanFields from './GeneratorPlanFields.vue';
import TestDataTable from './TestDataTable.vue';
import EditorFeedback from './EditorFeedback.vue';
import { snapshot, mergeSaved, downloadDraft, draftSignature } from '../draft-state';
import { rememberedChoice } from '../editor-navigation';
const props = defineProps<{ problemId: string; writable: boolean }>();
const emit = defineEmits<{ dirty: [value: boolean]; dataChanged: [] }>();
const message = useMessage();
const stressDirty = ref(false), groupsDirty = ref(false), groupConfig = ref<any>({ data: { groups: [] } });
const tab = rememberedChoice('judge-tab','programs',['programs','settings','data','selftests','acceptance','stress','groups']), loaded = ref(false), busy = ref(false);
const programError = ref(''), lastProgram = rememberedChoice<string>('program','');
const profiles = ref<any[]>([]), programs = ref<any[]>([]), tests = ref<any[]>([]), plans = ref<any[]>([]), selfTests = ref<any[]>([]), runs = ref<any[]>([]);
const chosenRunId = ref(''), chosenRun = ref<any>();
const settings = ref({ ...defaultJudgeSettings }), settingsVersion = ref(1), settingsSaved = ref('');
const programDraft = ref<any>(), programSaved = ref('');
const modal = ref<'test' | 'plan' | 'selftest' | ''>(''), form = ref<any>({}), formSaved = ref('');
const zipInput = ref<HTMLInputElement>();
const pendingTestDelete = ref<{ id: string; expectedVersion: number; number: number }[]>([]);
const deleteAffectedGroups = computed(() => groupConfig.value.data.groups.filter((group: any) => group.members.some((member: any) => pendingTestDelete.value.some(test => test.id === member.testId))).map((group: any) => group.id));
const settingsDirty = computed(() => loaded.value && JSON.stringify(settings.value) !== settingsSaved.value);
const programDirty = computed(() => !!programDraft.value && draftSignature(programDraft.value) !== programSaved.value);
const formDirty = computed(() => !!modal.value && JSON.stringify(form.value) !== formSaved.value);
watch(() => settingsDirty.value || programDirty.value || formDirty.value || stressDirty.value || groupsDirty.value, value => emit('dirty', value), { immediate: true });
const roleOptions = programRoles.map(r => ({ label: programRoleLabels[r], value: r }));
const solution = computed(() => programDraft.value && ['MAIN_SOLUTION', 'CORRECT_SOLUTION', 'WRONG_SOLUTION', 'TIME_LIMIT_SOLUTION', 'BRUTE_FORCE'].includes(programDraft.value.role));
const editorLanguage = computed(() => profiles.value.find(p => p.id === programDraft.value?.profileId)?.language === 'PYTHON3' ? 'python' : 'cpp');
const generatorOptions = computed(() => programs.value.filter(p => p.role === 'GENERATOR').map(p => ({ label: `${p.name} · v${p.version}`, value: p.id })));
const selfToolOptions = computed(() => [ ...(form.value.kind === 'CHECKER' && settings.value.checkerMode !== 'CUSTOM' ? [{ label: '当前内置比较器', value: '' }] : []), ...programs.value.filter(p => (form.value.kind === 'VALIDATOR' ? ['VALIDATOR', 'EXTRA_VALIDATOR'] : ['CHECKER']).includes(p.role)).map(p => ({ label: `${p.name} · v${p.version}${p.enabled ? '' : '（未启用，仍可自测）'}`, value: p.id })) ]);
const selfExpectedOptions = computed(() => (form.value.kind === 'VALIDATOR' ? ['ACCEPT', 'REJECT'] : ['AC', 'WA', 'PE']).map(v => ({ label: v, value: v })));
async function catalog() {
  [programs.value, tests.value, plans.value, selfTests.value, groupConfig.value] = await Promise.all([api(`/problems/${props.problemId}/programs`), api(`/problems/${props.problemId}/tests`), api(`/problems/${props.problemId}/generator-plans`), api(`/problems/${props.problemId}/self-tests`), api(`/problems/${props.problemId}/test-groups`)]);
}
async function refreshRuns() {
  runs.value = await api(`/test-runs?problemId=${props.problemId}`);
  if (!chosenRunId.value && runs.value.length) chosenRunId.value = runs.value[0].id;
  if (chosenRunId.value) chosenRun.value = await api(`/test-runs/${chosenRunId.value}`);
}
async function load() {
  try {
    const [config, profileList] = await Promise.all([api(`/problems/${props.problemId}/judge-settings`), api('/compile-profiles')]);
    settings.value = config.settings; settingsVersion.value = config.version; settingsSaved.value = JSON.stringify(settings.value); profiles.value = profileList;
    await catalog(); await refreshRuns(); if (programs.value.length) selectProgram(programs.value.find(p=>p.id===lastProgram.value)?.id ?? programs.value[0].id); loaded.value = true;
  } catch (e) { message.error((e as Error).message); }
}
onMounted(async () => { await load();  });
onBeforeUnmount(() => {  emit('dirty', false); });
useTaskEvents(()=>refreshRuns().catch(e=>message.error(e.message)),{problemId:props.problemId});
function selectProgram(id?: string) {
  if(busy.value){message.info('请等待当前保存完成再切换程序');return;}
  if (programDirty.value && !window.confirm('当前程序还有未保存修改，确定放弃并切换吗？')) return;
  const p = programs.value.find(p => p.id === id);
  programDraft.value = p ? { id: p.id, version: p.version, name: p.name, role: p.role, profileId: p.profileId, source: p.currentRevision.source, enabled: p.enabled, notes: p.notes, expectedVerdicts: [...p.expectedVerdicts], validatorScope: p.validatorScope, expectedScore: p.expectedScore ?? null }
    : { name: '', role: 'CORRECT_SOLUTION', profileId: profiles.value.find(p => p.enabled)?.id ?? '', source: '#include <iostream>\nint main() {\n  // 编写程序\n}\n', enabled: true, notes: '', expectedVerdicts: ['AC'], validatorScope: 'GLOBAL', expectedScore: null };
  programSaved.value = p ? draftSignature(programDraft.value) : '';
  programError.value=''; if(p)lastProgram.value=p.id;
}
function roleChanged(role: ProgramRole) { programDraft.value.expectedScore = null; programDraft.value.validatorScope = 'GLOBAL'; programDraft.value.expectedVerdicts = [role === 'WRONG_SOLUTION' ? 'WA' : role === 'TIME_LIMIT_SOLUTION' ? 'TLE' : 'AC']; }
async function saveProgram() {
  if (!programDraft.value || !props.writable || busy.value) return false; busy.value = true; programError.value='';
  const submitted = snapshot(programDraft.value);
  try {
    const { id, version, ...data } = submitted;
    const saved = await api(id ? `/programs/${id}` : `/problems/${props.problemId}/programs`, { method: id ? 'PUT' : 'POST', body: JSON.stringify({ ...data, ...(id ? { expectedVersion: version } : {}) }) });
    const server = { ...data, id: saved.id, version: saved.version };
    programDraft.value = mergeSaved(programDraft.value,submitted,server); programSaved.value = draftSignature(server); lastProgram.value=saved.id;
    await catalog(); await refreshRuns(); message.success(`程序已保存 · v${saved.version}${programDirty.value?'；继续输入的修改仍未保存':''}`); return !programDirty.value;
  } catch (e) { programError.value=(e as Error).message; message.error(programError.value); return false; } finally { busy.value = false; }
}
async function saveSettings() {
  if(busy.value)return;const submitted=snapshot(settings.value);
  busy.value = true;
  try { const saved = await api(`/problems/${props.problemId}/judge-settings`, { method: 'PUT', body: JSON.stringify({ expectedVersion: settingsVersion.value, settings: submitted }) }); settingsVersion.value = saved.version; settingsSaved.value = JSON.stringify(submitted); await refreshRuns(); message.success(settingsDirty.value?'已保存提交的配置；继续输入的修改仍未保存':'判题配置已保存'); }
  catch (e) { message.error((e as Error).message); } finally { busy.value = false; }
}
async function submit(purpose: JudgePurpose) {
  if (purpose === 'COMPILE' && programDirty.value && !await saveProgram()) return;
  if (purpose !== 'COMPILE' && (programDirty.value || settingsDirty.value)) { message.warning('请先保存程序和判题配置，再提交当前版本任务'); return; }
  busy.value = true;
  try { const run = await api(`/problems/${props.problemId}/test-runs`, { method: 'POST', body: JSON.stringify({ purpose, requestKey: crypto.randomUUID(), ...(purpose === 'COMPILE' ? { programId: programDraft.value?.id } : {}) }) }); chosenRunId.value = run.id; tab.value = 'acceptance'; await refreshRuns(); }
  catch (e) { message.error((e as Error).message); } finally { busy.value = false; }
}
async function selectRun(value: string) { chosenRunId.value = value; try { await refreshRuns(); } catch (e) { message.error((e as Error).message); } }
async function runAction(action: 'cancel' | 'retry') {
  if (!chosenRun.value) return;
  try { const result = await api(`/test-runs/${chosenRun.value.id}/${action}`, { method: 'POST', ...(action === 'retry' ? { body: JSON.stringify({ requestKey: crypto.randomUUID() }) } : {}) }); if (action === 'retry') chosenRunId.value = result.id; await refreshRuns(); }
  catch (e) { message.error((e as Error).message); }
}
async function applyData(caseIds: string[]) {
  if (!chosenRun.value) return; busy.value = true;
  try { await api(`/test-runs/${chosenRun.value.id}/apply-data`, { method: 'POST', body: JSON.stringify({ caseIds }) }); await catalog(); await refreshRuns(); emit('dataChanged'); message.success('已保存正式数据的新版本，原任务输入/答案快照保留'); }
  catch (e) { message.error((e as Error).message); } finally { busy.value = false; }
}
async function editTest(t?: any) {
  busy.value = true;
  try {
    form.value = t ? { id: t.id, version: t.version, number: t.number, groupName: t.groupName, isSample: t.isSample, enabled: t.enabled, notes: t.notes,
      inputBase64: await binaryFile(`/test-revisions/${t.currentRevision.id}/input`), answerBase64: t.currentRevision.answerHash ? await binaryFile(`/test-revisions/${t.currentRevision.id}/answer`) : null }
      : { number: Math.max(0, ...tests.value.map(t => t.number)) + 1, groupName: 'main', isSample: false, enabled: true, notes: '', inputBase64: '', answerBase64: null };
    modal.value = 'test'; formSaved.value = JSON.stringify(form.value);
  } catch (e) { message.error((e as Error).message); } finally { busy.value = false; }
}
function requestTestDeletion(selected: any[]) {
  if (!props.writable || busy.value) return;
  pendingTestDelete.value = selected.map(test => ({ id: test.id, expectedVersion: test.version, number: test.number }));
}
async function refreshTestData() {
  busy.value = true;
  try { await catalog(); await refreshRuns(); emit('dataChanged'); }
  catch (e) { message.error((e as Error).message); } finally { busy.value = false; }
}
async function deleteTests() {
  if (!props.writable || busy.value || !pendingTestDelete.value.length) return;
  busy.value = true;
  let deleted = false;
  try {
    const result = await api<{ deletedIds: string[]; affectedGroups: string[] }>(`/problems/${props.problemId}/tests/delete`, {
      method: 'POST', body: JSON.stringify({ tests: pendingTestDelete.value.map(({ id, expectedVersion }) => ({ id, expectedVersion })) }),
    });
    deleted = true; pendingTestDelete.value = [];
    tests.value = tests.value.filter(test => !result.deletedIds.includes(test.id));
    emit('dataChanged');
    message.success(`已删除 ${result.deletedIds.length} 组数据，编号可重新使用`);
    if (result.affectedGroups.length) message.warning(`请在「数据组与评分」重选成员并保存：${result.affectedGroups.join('、')}`, { duration: 7000 });
    await catalog(); await refreshRuns();
  } catch (e) {
    message.error(deleted ? `删除已完成，刷新失败：${(e as Error).message}。请刷新数据列表。` : (e as Error).message);
  } finally { busy.value = false; }
}
function editPlan(p?: any) {
  form.value = p ? { ...p.data, id: p.id, version: p.version, argvText: JSON.stringify(p.data.argv), mode: p.data.commands ? 'commands' : 'repeat', commandText: p.data.commands ? formatGeneratorCommands(programs.value, p.data.commands, p.programId) : '' }
    : { name: '', programId: generatorOptions.value[0]?.value ?? '', enabled: true, argvText: '[]', seed: '1', count: 1, numberStart: Math.max(0, ...tests.value.map(t => t.number), ...plans.value.filter(plan => plan.enabled).map(plan => plan.data.numberStart + plan.data.count - 1)) + 1, groupName: 'main', isSample: false, mode: 'commands', commandText: '' };
  delete form.value.argv; delete form.value.commands; modal.value = 'plan'; formSaved.value = JSON.stringify(form.value);
}
async function editSelfTest(t?: any) {
  busy.value = true;
  try {
    const files = t ? await api(`/self-tests/${t.id}/files`) : { inputBase64: '', answerBase64: '', outputBase64: '' };
    form.value = t ? { id: t.id, version: t.version, name: t.name, kind: t.kind, programId: t.programId ?? '', expected: t.expected, enabled: t.enabled, ...files }
      : { name: '', kind: 'VALIDATOR', programId: programs.value.find(p => p.role === 'VALIDATOR')?.id ?? '', expected: 'ACCEPT', enabled: true, ...files };
    modal.value = 'selftest'; formSaved.value = JSON.stringify(form.value);
  } catch (e) { message.error((e as Error).message); } finally { busy.value = false; }
}
function selfKindChanged(kind: string) { form.value.expected = kind === 'VALIDATOR' ? 'ACCEPT' : 'AC'; form.value.programId = selfToolOptions.value[0]?.value ?? ''; }
function closeModal() { if (!formDirty.value || window.confirm('该编辑还有未保存修改，确定放弃吗？')) modal.value = ''; }
async function saveForm() {
  busy.value = true;
  try {
    const { id, version, argvText, mode, commandText, ...data } = form.value;
    if (modal.value === 'plan') {
      if (mode === 'commands') {
        data.commands = parseGeneratorCommands(commandText, programs.value.filter(program => program.role === 'GENERATOR'));
        data.programId = data.commands[0].programId; data.argv = data.commands[0].argv; data.seed = data.commands[0].seed; data.count = data.commands.length;
        if (!data.name.trim()) data.name = `${programs.value.find(program => program.id === data.programId)?.name ?? '生成计划'} · ${data.count} 组`.slice(0, 120);
      } else { data.argv = JSON.parse(argvText); }
      generatorPlanCommands(data);
    }
    if (modal.value === 'selftest') data.programId ||= null;
    const collection = modal.value === 'test' ? 'tests' : modal.value === 'plan' ? 'generator-plans' : 'self-tests';
    await api(id ? `/${collection}/${id}` : `/problems/${props.problemId}/${collection}`, { method: id ? 'PUT' : 'POST', body: JSON.stringify({ ...data, ...(id ? { expectedVersion: version } : {}) }) });
    modal.value = ''; await catalog(); await refreshRuns(); emit('dataChanged'); message.success('已保存独立版本');
  } catch (e) { message.error((e as Error).message); } finally { busy.value = false; }
}
async function importZip(event: Event) {
  const file = (event.target as HTMLInputElement).files?.[0]; if (!file) return; busy.value = true;
  try { if (file.size > 8_000_000) throw new Error('ZIP 最大 8MB'); const base64 = bytesBase64(new Uint8Array(await file.arrayBuffer())); await api(`/problems/${props.problemId}/tests/import-zip`, { method: 'POST', body: JSON.stringify({ base64, groupName: 'main' }) }); await catalog(); await refreshRuns(); message.success('ZIP 已按原始字节导入；重复输入保留并提示'); }
  catch (e) { message.error((e as Error).message); } finally { busy.value = false; (event.target as HTMLInputElement).value = ''; }
}
</script>
<template><NSpin :show="!loaded"><div class="panel judge-workspace"><NTabs v-model:value="tab" type="line"><NTab name="programs">程序</NTab><NTab name="data">测试数据 / 生成计划</NTab><NTab name="selftests">工具自测</NTab><NTab name="acceptance">验收与日志</NTab><NTab name="groups">数据组与评分</NTab><NTab name="stress">对拍与反例</NTab><NTab name="settings">判题配置</NTab></NTabs>
  <div v-if="tab === 'programs'" class="program-layout"><aside class="program-list"><NButton v-if="writable" block @click="selectProgram()">新建程序</NButton><button v-for="p in programs" :key="p.id" class="program-link" :class="{ selected: p.id === programDraft?.id }" @click="selectProgram(p.id)"><strong>{{ p.name }}</strong><small>{{ programRoleLabels[p.role as ProgramRole] }} · v{{ p.version }} · {{ p.profile.name }}{{ p.enabled ? '' : ' · 已停用' }}</small></button><NEmpty v-if="!programs.length" description="尚无程序" class="empty"/></aside><section v-if="programDraft" class="program-editor"><EditorFeedback :dirty="programDirty" :saving="busy" :error="programError" :version="programDraft.version" label="程序" @export="downloadDraft(`program-${programDraft.id ?? 'new'}`,programDraft)"/><div class="document-toolbar"><span class="save-state">{{ programDirty ? '未保存，离开会提醒' : `已保存 v${programDraft.version}` }}</span><div class="toolbar-right"><NButton :disabled="!writable" :loading="busy" @click="saveProgram">保存程序</NButton><NButton type="primary" :disabled="!writable" :loading="busy" @click="submit('COMPILE')">编译当前源码</NButton></div></div><div class="judge-form-grid"><NFormItem label="名称"><NInput v-model:value="programDraft.name" :disabled="!writable"/></NFormItem><NFormItem label="角色"><NSelect v-model:value="programDraft.role" :options="roleOptions" :disabled="!writable" @update:value="roleChanged"/></NFormItem><NFormItem label="管理员编译 profile"><NSelect v-model:value="programDraft.profileId" :options="profiles.map(p => ({ label: `${p.name} · v${p.version}`, value: p.id, disabled: !p.enabled }))" :disabled="!writable"/></NFormItem><NFormItem v-if="solution" label="预期判定"><NSelect v-model:value="programDraft.expectedVerdicts" multiple :options="verdicts.map(v => ({ label: v, value: v }))" :disabled="!writable || ['MAIN_SOLUTION', 'CORRECT_SOLUTION', 'TIME_LIMIT_SOLUTION'].includes(programDraft.role)"/></NFormItem><NFormItem v-if="programDraft.role === 'EXTRA_VALIDATOR'" label="校验适用范围"><NSelect v-model:value="programDraft.validatorScope" :options="[{label:'全部数据',value:'GLOBAL'},{label:'仅指定数据组',value:'GROUPS'}]" :disabled="!writable"/></NFormItem><NFormItem label="备注"><NInput v-model:value="programDraft.notes" :disabled="!writable"/></NFormItem><NFormItem label="任务选择"><NCheckbox v-model:checked="programDraft.enabled" :disabled="!writable">启用此程序</NCheckbox></NFormItem></div><ScoreExpectationEditor v-if="solution && !['MAIN_SOLUTION', 'CORRECT_SOLUTION'].includes(programDraft.role)" v-model="programDraft.expectedScore" :groups="groupConfig.data.groups.map((g: any) => g.id)" :disabled="!writable"/><SourceEditor :key="programDraft.id ?? 'new'" v-model="programDraft.source" :language="editorLanguage" :readonly="!writable"/></section><NEmpty v-else description="选择或新建程序，保存后独立编译" class="empty"/></div>
  <div v-else-if="tab === 'data'"><div class="panel-toolbar"><span>输入与答案保留原始字节、换行及哈希</span><div class="toolbar-right"><NButton v-if="writable" :disabled="busy" @click="zipInput?.click()">导入 ZIP</NButton><input ref="zipInput" type="file" accept=".zip" hidden @change="importZip"/><NButton v-if="writable" type="primary" :disabled="busy" @click="editTest()">添加数据</NButton></div></div><p class="judge-hint">ZIP 使用 [tests/]编号.in 与 编号.ans；同编号导入冲突会整批拒绝。重复输入会提示并保留。生成错误时，可单条删除或勾选后批量删除，再重新生成。</p>
    <TestDataTable :tests="tests" :writable="writable" :busy="busy" @edit="editTest" @delete="requestTestDeletion" @refresh="refreshTestData"/>
    <div class="panel-toolbar"><strong>数据生成计划</strong><div class="toolbar-right"><NButton v-if="writable" :loading="busy" @click="submit('GENERATE')">执行生成计划</NButton><NButton v-if="writable" @click="editPlan()">添加计划</NButton></div></div><p class="judge-hint">点击「添加计划」，直接粘贴生成命令，每行一组，例如 gen 1 10001。收集为正式数据后，编辑对应计划并取消「启用」，避免后续任务再次生成同编号数据。</p><table class="data-table"><thead><tr><th>计划</th><th>参数与种子</th><th>数据范围</th><th></th></tr></thead><tbody><tr v-for="p in plans" :key="p.id"><td>{{ p.name }}<small>v{{ p.version }}{{ p.enabled ? '' : ' · 已停用' }}</small></td><td><template v-if="p.data.commands"><span>逐行命令 · {{ p.data.commands.length }} 行</span><small>参数与种子按各行保存</small></template><template v-else><code>{{ JSON.stringify(p.data.argv) }}</code><small>seed={{ p.data.seed }} 起递增</small></template></td><td>#{{ p.data.numberStart }} 起 · {{ p.data.count }} 组 · {{ p.data.groupName }}</td><td><NButton v-if="writable" size="small" @click="editPlan(p)">编辑</NButton></td></tr></tbody></table>
  </div>
  <div v-else-if="tab === 'selftests'"><div class="panel-toolbar"><span>Validator 合法 / 非法输入；Checker 接受 / 拒绝输出</span><div class="toolbar-right"><NButton v-if="writable" :loading="busy" @click="submit('SELF_TEST')">运行自测</NButton><NButton v-if="writable" type="primary" @click="editSelfTest()">添加自测</NButton></div></div><table class="data-table"><thead><tr><th>名称</th><th>工具</th><th>预期</th><th></th></tr></thead><tbody><tr v-for="t in selfTests" :key="t.id"><td>{{ t.name }}<small>v{{ t.version }}{{ t.enabled ? '' : ' · 已停用' }}</small></td><td>{{ t.kind }} · {{ programs.find(p => p.id === t.programId)?.name ?? '当前内置比较器' }}</td><td><NTag>{{ t.expected }}</NTag></td><td><NButton v-if="writable" size="small" @click="editSelfTest(t)">编辑</NButton></td></tr></tbody></table><NEmpty v-if="!selfTests.length" description="按题目需要添加代表性自测，不要求固定边界清单" class="empty"/></div>
  <div v-else-if="tab === 'acceptance'"><div class="panel-toolbar"><div class="toolbar-left"><NButton v-if="writable" :loading="busy" @click="submit('VALIDATE')">校验输入</NButton><NButton v-if="writable" :loading="busy" @click="submit('ANSWERS')">生成答案</NButton><NButton v-if="writable" type="primary" :loading="busy" @click="submit('ACCEPTANCE')">验收当前版本</NButton></div><NButton @click="refreshRuns">刷新状态</NButton></div><div class="build-selector"><NSelect :value="chosenRunId || null" :options="runs.map(r => ({ label: `${judgePurposeLabels[r.purpose as JudgePurpose]} · ${r.state}${r.accepted === false ? ' · 未通过' : ''}${r.stale ? ' · 历史结果' : ''} · ${new Date(r.createdAt).toLocaleString('zh-CN')}`, value: r.id }))" placeholder="选择任务" @update:value="selectRun"/></div><JudgeReport v-if="chosenRun" :key="chosenRun.id" :run="chosenRun" :writable="writable" @cancel="runAction('cancel')" @retry="runAction('retry')" @apply="applyData"/><NEmpty v-else description="提交任务后显示 Worker 的真实状态与结果" class="empty"/></div>
  <div v-else-if="tab === 'settings'" class="settings-pane"><div class="document-toolbar"><span>{{ settingsDirty ? '未保存' : `已保存 v${settingsVersion}` }}</span><NButton v-if="writable" type="primary" :loading="busy" @click="saveSettings">保存判题配置</NButton></div><div class="judge-form-grid"><NFormItem label="执行方式"><NSelect v-model:value="settings.interactionMode" :options="[{label:'批处理',value:'BATCH'},{label:'双向交互',value:'INTERACTIVE'}]" :disabled="!writable"/></NFormItem><NFormItem label="评分模式"><NSelect v-model:value="settings.scoringMode" :options="[{label:'ACM：全部必需数据 AC',value:'ACM'},{label:'部分分：按已保存数据组计算',value:'PARTIAL'}]" :disabled="!writable"/></NFormItem><NFormItem label="Checker 模式"><NSelect v-model:value="settings.checkerMode" :disabled="!writable" :options="[{ label: '精确字节（包括空白与末尾换行）', value: 'EXACT' }, { label: 'token（忽略 ASCII 空白，拒绝多余 token）', value: 'TOKENS' }, { label: '浮点误差（拒绝 NaN / Infinity）', value: 'FLOAT' }, { label: '自定义 testlib Checker', value: 'CUSTOM' }]"/></NFormItem><NFormItem label="I/O"><NSelect v-model:value="settings.ioMode" :disabled="!writable" :options="[{ label: '标准输入输出', value: 'STDIO' }, { label: '工作目录内文件', value: 'FILES' }]"/></NFormItem><NFormItem label="CPU 时间限制 / ms"><NInputNumber v-model:value="settings.timeLimitMs" :disabled="!writable" :min="50" :max="10000"/></NFormItem><NFormItem label="内存限制 / MiB"><NInputNumber v-model:value="settings.memoryLimitMb" :disabled="!writable" :min="32" :max="1024"/></NFormItem><NFormItem label="输出限制 / bytes"><NInputNumber v-model:value="settings.outputLimitBytes" :disabled="!writable" :min="1024" :max="4194304"/></NFormItem><template v-if="settings.ioMode === 'FILES'"><NFormItem label="输入文件名"><NInput v-model:value="settings.inputFile" :disabled="!writable"/></NFormItem><NFormItem label="输出文件名"><NInput v-model:value="settings.outputFile" :disabled="!writable"/></NFormItem></template><template v-if="settings.checkerMode === 'FLOAT'"><NFormItem label="绝对误差"><NInputNumber v-model:value="settings.absoluteTolerance" :disabled="!writable" :min="0" :max="1"/></NFormItem><NFormItem label="相对误差（以答案绝对值为基准）"><NInputNumber v-model:value="settings.relativeTolerance" :disabled="!writable" :min="0" :max="1"/></NFormItem></template></div><InteractionSettingsPanel v-if="settings.interactionMode === 'INTERACTIVE'" v-model="settings.interaction" :disabled="!writable"/><p class="judge-hint">交互需要一个启用的 Interactor，使用独立双向管道。ACM 要求全部必需数据 AC；部分分使用数据组、权重及依赖计算。修改配置后相关报告需重新执行。</p></div>
  <StressPanel v-if="loaded" v-show="tab === 'stress'" :problem-id="problemId" :programs="programs" :group-ids="groupConfig.data.groups.map((g: any) => g.id)" :writable="writable" :default-number="Math.max(0, ...tests.map(t => t.number)) + 1" @dirty="stressDirty = $event" @data-changed="catalog(); refreshRuns(); emit('dataChanged')"/>
  <GroupPanel v-if="loaded" v-show="tab === 'groups'" :problem-id="problemId" :tests="tests" :programs="programs" :writable="writable" @dirty="groupsDirty = $event" @saved="catalog(); refreshRuns()"/>
  <NModal :show="!!modal" preset="card" :title="modal === 'test' ? '测试数据 · 原始字节' : modal === 'plan' ? '生成计划' : '工具自测'" :mask-closable="false" :close-on-esc="false" :closable="false" class="judge-modal" style="width: min(850px, 95vw)"><div class="judge-form-grid"><template v-if="modal === 'test'"><NFormItem label="编号"><NInputNumber v-model:value="form.number" :min="1" :max="100000"/></NFormItem><NFormItem label="分组"><NInput v-model:value="form.groupName"/></NFormItem><NFormItem label="用途"><NCheckbox v-model:checked="form.isSample">题面样例</NCheckbox></NFormItem><NFormItem label="备注"><NInput v-model:value="form.notes"/></NFormItem></template><template v-else><NFormItem label="名称"><NInput v-model:value="form.name" :placeholder="modal === 'plan' ? '可留空，按命令自动命名' : ''"/></NFormItem><GeneratorPlanFields v-if="modal === 'plan'" v-model="form" :programs="programs" :plans="plans" :tests="tests"/><template v-else><NFormItem label="类型"><NSelect v-model:value="form.kind" :options="[{ label: 'Validator', value: 'VALIDATOR' }, { label: 'Checker', value: 'CHECKER' }]" @update:value="selfKindChanged"/></NFormItem><NFormItem label="被测工具"><NSelect v-model:value="form.programId" :options="selfToolOptions"/></NFormItem><NFormItem label="预期判定"><NSelect v-model:value="form.expected" :options="selfExpectedOptions"/></NFormItem></template></template><NFormItem label="任务选择"><NCheckbox v-model:checked="form.enabled">启用</NCheckbox></NFormItem></div><template v-if="modal === 'test'"><BinaryInput v-model="form.inputBase64" label="输入"/><NCheckbox :checked="form.answerBase64 !== null" @update:checked="v => form.answerBase64 = v ? '' : null">保存指定答案（也可由主标程生成）</NCheckbox><BinaryInput v-if="form.answerBase64 !== null" v-model="form.answerBase64" label="指定答案"/></template><template v-else-if="modal === 'selftest'"><BinaryInput v-model="form.inputBase64" label="输入"/><template v-if="form.kind === 'CHECKER'"><BinaryInput v-model="form.answerBase64" label="参考答案"/><BinaryInput v-model="form.outputBase64" label="待检输出"/></template></template><template #footer><div class="toolbar-right"><NButton @click="closeModal">取消</NButton><NButton type="primary" :loading="busy" @click="saveForm">保存版本</NButton></div></template></NModal>
  <NModal :show="pendingTestDelete.length > 0" preset="card" title="删除测试数据" :mask-closable="false" :close-on-esc="false" :closable="false" style="width: min(600px, 95vw)">
    <p>确认删除这 {{ pendingTestDelete.length }} 组数据的输入与答案？删除后编号可重新使用。</p>
    <p style="max-height: 160px; overflow: auto">{{ pendingTestDelete.map(test => `#${test.number}`).join('、') }}</p>
    <p class="judge-hint">历史任务和冻结版本会保留。题面已引用的样例仍使用固定版本，需要在题面中取消或替换引用。</p>
    <p class="judge-hint">生成计划会保留；如不再需要这些数据，请停用对应计划。</p>
    <NAlert v-if="deleteAffectedGroups.length" type="warning" :show-icon="false">影响评分组：{{ deleteAffectedGroups.join('、') }}。删除后请在「数据组与评分」重选成员并保存。</NAlert>
    <template #footer><div class="toolbar-right"><NButton :disabled="busy" @click="pendingTestDelete = []">取消</NButton><NButton type="error" :loading="busy" @click="deleteTests">确认删除 {{ pendingTestDelete.length }} 组</NButton></div></template>
  </NModal>
</div></NSpin></template>
