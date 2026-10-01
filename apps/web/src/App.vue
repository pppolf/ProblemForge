<script setup lang="ts">
import { NConfigProvider, NMessageProvider, NDialogProvider, NButton, NTag, NAlert, zhCN, dateZhCN } from 'naive-ui';
import { ref } from 'vue';
import { useRouter, isNavigationFailure } from 'vue-router';
import { session, api } from './api';
import NavigationStatus from './components/NavigationStatus.vue';
import DraftExportDialog from './components/DraftExportDialog.vue';
const router = useRouter();
const logoutError = ref('');
async function logout() {
  if (router.currentRoute.value.path !== '/login' && isNavigationFailure(await router.push('/login'))) return;
  logoutError.value = '';
  try { if(!session.expired)await api('/auth/logout', { method: 'POST' }); }
  catch(e) { if(!session.expired){logoutError.value=(e as Error).message;return;} }
  session.user = null; session.csrfToken = ''; session.expired = false;
}
</script>
<template>
  <NConfigProvider :locale="zhCN" :date-locale="dateZhCN" :theme-overrides="{ common: { primaryColor: '#2563eb', primaryColorHover: '#1d4ed8', primaryColorPressed: '#1e40af', borderRadius: '5px', fontFamily: 'Inter, Segoe UI, Microsoft YaHei, sans-serif' } }">
    <NMessageProvider><NDialogProvider>
      <NavigationStatus />
      <DraftExportDialog />
      <NAlert v-if="logoutError" type="error">退出未成功：{{logoutError}}。请重试退出。</NAlert>
      <div v-if="session.user && $route.path !== '/reset-password'" class="app-shell">
        <aside class="sidebar">
          <RouterLink to="/problems" class="brand"><span class="brand-mark">P</span>{{ session.appName }}</RouterLink>
          <div class="nav-label">出题工作台</div>
          <RouterLink to="/problems" class="nav-link">题目</RouterLink>
          <RouterLink to="/contests" class="nav-link">比赛</RouterLink>
          <RouterLink to="/tasks" class="nav-link">任务中心</RouterLink>
          <RouterLink to="/account" class="nav-link">账户设置</RouterLink>
          <RouterLink to="/guide" class="nav-link">使用指引</RouterLink>
          <template v-if="session.user.role === 'ADMIN'"><div class="nav-label">系统管理</div><RouterLink to="/admin/templates" class="nav-link">模板中心</RouterLink><RouterLink to="/admin/compile-profiles" class="nav-link">编译配置</RouterLink><RouterLink to="/admin/users" class="nav-link">用户管理</RouterLink><RouterLink to="/admin/groups" class="nav-link">用户组</RouterLink><RouterLink to="/admin/operations" class="nav-link">运行与审计</RouterLink></template>
          <div class="sidebar-foot"><NTag size="small" :bordered="false">私有出题工作台</NTag><p>题目、正文和资源默认私有</p></div>
        </aside>
        <div class="main-shell"><header class="topbar"><span>XCPC · 出题与出版</span><div><span>{{ session.user.name }}</span><NTag size="small" :bordered="false">{{ session.user.role === 'ADMIN' ? '系统管理员' : '出题人' }}</NTag><NButton text @click="logout">退出</NButton></div></header><main><NAlert v-if="session.expired" type="warning" class="spaced">登录已失效，本地编辑仍保留在当前页面。请先下载草稿，再重新登录。<NButton text @click="logout">重新登录</NButton></NAlert><RouterView :key="String($route.params.id || $route.path)" /></main></div>
      </div>
      <RouterView v-else />
    </NDialogProvider></NMessageProvider>
  </NConfigProvider>
</template>
