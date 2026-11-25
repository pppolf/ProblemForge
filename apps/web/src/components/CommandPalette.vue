<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import { NModal } from 'naive-ui';
import { api, session } from '../api';
import { THEME_PRESETS, setThemeMode, themeMode } from '../theme';
import AppIcon from './AppIcon.vue';

const props = defineProps<{ show: boolean }>();
const emit = defineEmits<{ 'update:show': [value: boolean]; toggleSidebar: [] }>();

type PaletteItem = {
  id: string;
  group: string;
  label: string;
  hint?: string;
  icon: string;
  keywords: string;
  run: () => void;
};

const router = useRouter();
const query = ref('');
const activeIndex = ref(0);
const inputRef = ref<HTMLInputElement>();
const problems = ref<{ id: string; title: string; tags?: string[] }[]>([]);
const contests = ref<{ id: string; title: string }[]>([]);
const loading = ref(false);

async function fetchCatalog() {
  if (!session.user) return;
  loading.value = true;
  try {
    const [p, c] = await Promise.all([
      api<any[]>('/problems').catch(() => []),
      api<any[]>('/contests').catch(() => []),
    ]);
    problems.value = p.slice(0, 40);
    contests.value = c.slice(0, 30);
  } finally {
    loading.value = false;
  }
}

function close() {
  emit('update:show', false);
}

const items = computed<PaletteItem[]>(() => {
  const nav: PaletteItem[] = [
    { id: 'nav-problems', group: '页面导航', label: '题目库', hint: '/problems', icon: 'problems', keywords: '题目 problem list library', run: () => { void router.push('/problems'); } },
    { id: 'nav-contests', group: '页面导航', label: '比赛编排', hint: '/contests', icon: 'contests', keywords: '比赛 contest collection', run: () => { void router.push('/contests'); } },
    { id: 'nav-tasks', group: '页面导航', label: '任务中心', hint: '/tasks', icon: 'tasks', keywords: '任务 queue history judge tex', run: () => { void router.push('/tasks'); } },
    { id: 'nav-import', group: '页面导航', label: '离线导入题目', hint: '/import', icon: 'upload', keywords: '导入 import polygon zip native', run: () => { void router.push('/import'); } },
    { id: 'nav-guide', group: '页面导航', label: '团队使用指引', hint: '/guide', icon: 'guide', keywords: '指引 帮助 guide help', run: () => { void router.push('/guide'); } },
    { id: 'nav-account', group: '页面导航', label: '账户设置', hint: '/account', icon: 'account', keywords: '账户 密码 会话 account', run: () => { void router.push('/account'); } },
  ];
  if (session.user?.role === 'ADMIN') {
    nav.push(
      { id: 'nav-templates', group: '系统管理', label: '模板中心', hint: '/admin/templates', icon: 'templates', keywords: '模板 template latex beamer', run: () => { void router.push('/admin/templates'); } },
      { id: 'nav-profiles', group: '系统管理', label: '编译配置', hint: '/admin/compile-profiles', icon: 'code', keywords: '编译 profile gcc python java', run: () => { void router.push('/admin/compile-profiles'); } },
      { id: 'nav-users', group: '系统管理', label: '用户管理', hint: '/admin/users', icon: 'users', keywords: '用户 权限 users', run: () => { void router.push('/admin/users'); } },
      { id: 'nav-groups', group: '系统管理', label: '用户组', hint: '/admin/groups', icon: 'groups', keywords: '用户组 groups team', run: () => { void router.push('/admin/groups'); } },
      { id: 'nav-ops', group: '系统管理', label: '运行与审计', hint: '/admin/operations', icon: 'activity', keywords: '运维 健康 审计 operations health', run: () => { void router.push('/admin/operations'); } },
    );
  }
  const actions: PaletteItem[] = [
    ...THEME_PRESETS.filter(p => p.id !== themeMode.value).map(p => ({
      id: `act-theme-${p.id}`,
      group: '外观主题',
      label: `切换主题：${p.name}`,
      hint: p.subtitle.split(' · ')[0],
      icon: p.isDark ? 'moon' : 'sun',
      keywords: `主题 配色 护眼 ${p.name} ${p.subtitle} ${p.id} theme color`,
      run: () => setThemeMode(p.id),
    })),
    { id: 'act-sidebar', group: '快捷操作', label: '展开 / 收起侧边栏', hint: 'Sidebar', icon: 'sidebar', keywords: '侧边栏 折叠 收起 sidebar', run: () => emit('toggleSidebar') },
  ];
  const problemItems: PaletteItem[] = problems.value.map(p => ({
    id: `p-${p.id}`,
    group: '题目工作区',
    label: p.title,
    hint: p.id.slice(0, 12),
    icon: 'problems',
    keywords: `${p.title} ${p.id} ${(p.tags ?? []).join(' ')}`,
    run: () => { void router.push(`/problems/${p.id}`); },
  }));
  const contestItems: PaletteItem[] = contests.value.map(c => ({
    id: `c-${c.id}`,
    group: '比赛工作区',
    label: c.title,
    hint: c.id.slice(0, 12),
    icon: 'contests',
    keywords: `${c.title} ${c.id}`,
    run: () => { void router.push(`/contests/${c.id}`); },
  }));
  return [...actions, ...problemItems, ...contestItems, ...nav];
});

const filtered = computed(() => {
  const q = query.value.trim().toLowerCase();
  if (!q) return items.value.slice(0, 18);
  return items.value.filter(i => `${i.label} ${i.group} ${i.keywords}`.toLowerCase().includes(q)).slice(0, 24);
});

watch(() => props.show, async open => {
  if (open) {
    query.value = '';
    activeIndex.value = 0;
    void fetchCatalog();
    await nextTick();
    inputRef.value?.focus();
  }
});

watch(filtered, list => {
  if (activeIndex.value >= list.length) activeIndex.value = 0;
});

function execute(item?: PaletteItem) {
  if (!item) return;
  close();
  item.run();
}

function onPaletteKey(event: KeyboardEvent) {
  if (event.key === 'ArrowDown') {
    event.preventDefault();
    if (filtered.value.length) activeIndex.value = (activeIndex.value + 1) % filtered.value.length;
  } else if (event.key === 'ArrowUp') {
    event.preventDefault();
    if (filtered.value.length) activeIndex.value = (activeIndex.value - 1 + filtered.value.length) % filtered.value.length;
  } else if (event.key === 'Enter') {
    event.preventDefault();
    execute(filtered.value[activeIndex.value]);
  }
}

function onGlobalKey(event: KeyboardEvent) {
  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
    if (!session.user) return;
    event.preventDefault();
    emit('update:show', !props.show);
  }
}

onMounted(() => window.addEventListener('keydown', onGlobalKey));
onBeforeUnmount(() => window.removeEventListener('keydown', onGlobalKey));
</script>

<template>
  <NModal :show="show" @update:show="emit('update:show', $event)">
    <div class="cmd-dialog" role="dialog" aria-label="快捷命令面板" @keydown="onPaletteKey">
      <div class="cmd-input-row">
        <AppIcon name="search" :size="16" />
        <input
          ref="inputRef"
          v-model="query"
          type="text"
          class="cmd-input"
          placeholder="搜索题目、比赛、页面或快捷操作…"
          aria-label="搜索命令、题目或页面"
        />
        <kbd class="cmd-kbd">ESC</kbd>
      </div>
      <div class="cmd-list" role="listbox">
        <button
          v-for="(item, idx) in filtered"
          :key="item.id"
          type="button"
          role="option"
          :aria-selected="idx === activeIndex"
          class="cmd-item"
          :class="{ active: idx === activeIndex }"
          @mouseenter="activeIndex = idx"
          @click="execute(item)"
        >
          <span class="cmd-item-icon"><AppIcon :name="item.icon" :size="15" /></span>
          <span class="cmd-item-main">
            <strong>{{ item.label }}</strong>
            <small>{{ item.group }}</small>
          </span>
          <span v-if="item.hint" class="cmd-item-hint">{{ item.hint }}</span>
        </button>
        <div v-if="!filtered.length" class="cmd-empty">
          {{ loading ? '正在加载目录…' : '没有匹配的结果，试试其他关键词' }}
        </div>
      </div>
      <div class="cmd-footer">
        <span><kbd class="cmd-kbd">↑↓</kbd> 选择</span>
        <span><kbd class="cmd-kbd">↵</kbd> 打开</span>
        <span><kbd class="cmd-kbd">⌘K</kbd> 随时唤起</span>
      </div>
    </div>
  </NModal>
</template>

<style scoped>
.cmd-dialog {
  width: min(560px, calc(100vw - 32px));
  margin: 0 auto;
  background: var(--surface);
  border: 1px solid var(--line);
  border-radius: 14px;
  box-shadow: var(--shadow-lg);
  overflow: hidden;
  color: var(--ink);
}
.cmd-input-row {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 13px 16px;
  border-bottom: 1px solid var(--line);
  color: var(--text-muted);
}
.cmd-input {
  flex: 1;
  border: 0;
  background: transparent;
  color: var(--ink);
  font-size: 14px;
  outline: none;
}
.cmd-input::placeholder { color: var(--text-muted); }
.cmd-list {
  max-height: 360px;
  overflow-y: auto;
  padding: 8px;
}
.cmd-item {
  width: 100%;
  display: flex;
  align-items: center;
  gap: 11px;
  padding: 9px 11px;
  border: 1px solid transparent;
  border-radius: 8px;
  background: transparent;
  color: var(--ink);
  cursor: pointer;
  text-align: left;
  transition: background-color .1s, border-color .1s;
}
.cmd-item.active {
  background: var(--accent-soft);
  border-color: var(--accent-line);
}
.cmd-item-icon {
  width: 28px;
  height: 28px;
  border-radius: 7px;
  display: grid;
  place-items: center;
  background: var(--surface-muted);
  color: var(--text-secondary);
  flex-shrink: 0;
}
.cmd-item.active .cmd-item-icon {
  background: var(--accent);
  color: var(--on-accent, #ffffff);
}
.cmd-item-main {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
}
.cmd-item-main strong { font-size: 13.5px; font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.cmd-item-main small { margin-top: 1px; font-size: 11px; color: var(--text-muted); }
.cmd-item-hint { font-family: var(--font-mono); font-size: 11px; color: var(--text-muted); flex-shrink: 0; }
.cmd-empty { padding: 36px 16px; text-align: center; font-size: 13px; color: var(--text-muted); }
.cmd-footer {
  display: flex;
  align-items: center;
  gap: 16px;
  padding: 9px 16px;
  border-top: 1px solid var(--line-soft);
  background: var(--surface-soft);
  font-size: 11.5px;
  color: var(--text-muted);
}
.cmd-kbd {
  display: inline-block;
  font-family: var(--font-mono);
  font-size: 10.5px;
  padding: 1px 5px;
  border-radius: 4px;
  border: 1px solid var(--line);
  background: var(--surface-muted);
  color: var(--text-secondary);
}
</style>
