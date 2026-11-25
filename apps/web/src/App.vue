<script setup lang="ts">
import { NConfigProvider, NMessageProvider, NDialogProvider, NButton, NTag, NAlert, zhCN, dateZhCN } from 'naive-ui';
import { computed, ref, watch } from 'vue';
import { useRouter, isNavigationFailure } from 'vue-router';
import { session, api } from './api';
import NavigationStatus from './components/NavigationStatus.vue';
import DraftExportDialog from './components/DraftExportDialog.vue';
import CommandPalette from './components/CommandPalette.vue';
import AppIcon from './components/AppIcon.vue';
import ThemePicker from './components/ThemePicker.vue';
import { naiveTheme, themeOverrides } from './theme';

const router = useRouter();
const logoutError = ref('');
const commandOpen = ref(false);

function readCollapsed() {
  try { return localStorage.getItem('pf-sidebar-collapsed') === '1'; } catch { return false; }
}
const sidebarCollapsed = ref(readCollapsed());
watch(sidebarCollapsed, value => {
  try { localStorage.setItem('pf-sidebar-collapsed', value ? '1' : '0'); } catch {}
});

const workspaceLinks = [
  { to: '/problems', label: '题目库', icon: 'problems' },
  { to: '/contests', label: '比赛编排', icon: 'contests' },
  { to: '/tasks', label: '任务中心', icon: 'tasks' },
];
const adminLinks = [
  { to: '/admin/templates', label: '模板中心', icon: 'templates' },
  { to: '/admin/compile-profiles', label: '编译配置', icon: 'code' },
  { to: '/admin/users', label: '用户管理', icon: 'users' },
  { to: '/admin/groups', label: '用户组', icon: 'groups' },
  { to: '/admin/operations', label: '运行与审计', icon: 'activity' },
];
const utilityLinks = [
  { to: '/guide', label: '使用指引', icon: 'guide' },
  { to: '/account', label: '账户设置', icon: 'account' },
];
const currentSection = computed(() =>
  [...workspaceLinks, ...adminLinks, ...utilityLinks].find(item => router.currentRoute.value.path.startsWith(item.to))?.label || '导入题包'
);
const roleLabel = computed(() =>
  session.user?.authProvider === 'local-admin' ? '超级管理员' : session.user?.role === 'ADMIN' ? '系统管理员' : '出题人'
);

async function logout() {
  const loginPath = session.user?.authProvider === 'local-admin' ? '/login?mode=admin' : '/login';
  if (router.currentRoute.value.fullPath !== loginPath && isNavigationFailure(await router.push(loginPath))) return;
  logoutError.value = '';
  try { if (!session.expired) await api('/auth/logout', { method: 'POST' }); }
  catch (e) { if (!session.expired) { logoutError.value = (e as Error).message; return; } }
  session.user = null; session.csrfToken = ''; session.expired = false;
}
</script>
<template>
  <NConfigProvider :locale="zhCN" :date-locale="dateZhCN" :theme="naiveTheme" :theme-overrides="themeOverrides">
    <NMessageProvider><NDialogProvider>
      <NavigationStatus />
      <DraftExportDialog />
      <CommandPalette v-model:show="commandOpen" @toggle-sidebar="sidebarCollapsed = !sidebarCollapsed" />
      <NAlert v-if="logoutError" type="error" class="global-banner">退出未成功：{{ logoutError }}。请重试退出。</NAlert>
      <div v-if="session.user && $route.path !== '/reset-password'" class="app-shell" :class="{ 'sidebar-collapsed': sidebarCollapsed }">
        <aside class="sidebar" aria-label="主导航">
          <RouterLink to="/problems" class="brand" :title="session.appName">
            <span class="brand-mark"><AppIcon name="forge" :size="20" /></span>
            <span class="brand-name">{{ session.appName }}<small>XCPC AUTHORING</small></span>
          </RouterLink>
          <nav class="sidebar-nav">
            <div class="nav-label">WORKSPACE</div>
            <RouterLink v-for="item in workspaceLinks" :key="item.to" :to="item.to" class="nav-link" :title="item.label">
              <AppIcon :name="item.icon" :size="17" /><span class="nav-text">{{ item.label }}</span>
            </RouterLink>
            <template v-if="session.user.role === 'ADMIN'">
              <div class="nav-label">ADMIN</div>
              <RouterLink v-for="item in adminLinks" :key="item.to" :to="item.to" class="nav-link" :title="item.label">
                <AppIcon :name="item.icon" :size="17" /><span class="nav-text">{{ item.label }}</span>
              </RouterLink>
            </template>
          </nav>
          <div class="sidebar-bottom">
            <RouterLink v-for="item in utilityLinks" :key="item.to" :to="item.to" class="nav-link" :title="item.label">
              <AppIcon :name="item.icon" :size="17" /><span class="nav-text">{{ item.label }}</span>
            </RouterLink>
            <div class="sidebar-foot">
              <span class="sandbox-dot" aria-hidden="true"></span>
              <span>Linux Sandbox Isolated</span>
            </div>
          </div>
        </aside>
        <div class="main-shell">
          <header class="topbar">
            <div class="topbar-location">
              <button
                type="button"
                class="icon-btn sidebar-toggle"
                :aria-label="sidebarCollapsed ? '展开侧边栏' : '收起侧边栏'"
                :title="sidebarCollapsed ? '展开侧边栏' : '收起侧边栏'"
                @click="sidebarCollapsed = !sidebarCollapsed"
              >
                <AppIcon name="sidebar" :size="17" />
              </button>
              <span class="topbar-prefix">工作台</span>
              <span class="topbar-divider">/</span>
              <span class="topbar-current">{{ currentSection }}</span>
            </div>
            <div class="topbar-user">
              <button
                type="button"
                class="cmd-trigger-btn"
                aria-label="打开快捷命令面板"
                title="快捷跳转与搜索 (⌘K / Ctrl+K)"
                @click="commandOpen = true"
              >
                <AppIcon name="search" :size="14" />
                <span>快速跳转</span>
                <kbd>⌘K</kbd>
              </button>
              <ThemePicker />
              <div class="user-pill">
                <span class="user-avatar" aria-hidden="true">{{ session.user.name.slice(0, 1).toUpperCase() }}</span>
                <span class="user-name">{{ session.user.name }}</span>
                <NTag class="user-role" size="small" :bordered="false" :type="session.user.role === 'ADMIN' ? 'info' : 'default'">{{ roleLabel }}</NTag>
              </div>
              <NButton text class="logout-button" @click="logout">
                <template #icon><AppIcon name="logout" :size="15" /></template>退出
              </NButton>
            </div>
          </header>
          <main>
            <NAlert v-if="session.expired" type="warning" class="spaced">
              登录已失效，本地编辑仍保留在当前页面。请先下载草稿，再重新登录。
              <NButton text type="primary" @click="logout">重新登录</NButton>
            </NAlert>
            <RouterView :key="String($route.params.id || $route.path)" />
          </main>
        </div>
      </div>
      <RouterView v-else />
    </NDialogProvider></NMessageProvider>
  </NConfigProvider>
</template>
