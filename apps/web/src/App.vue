<script setup lang="ts">
import { NConfigProvider, NMessageProvider, NDialogProvider, NButton, NTag, zhCN, dateZhCN } from 'naive-ui';
import { useRouter } from 'vue-router';
import { session, api } from './api';
import NavigationStatus from './components/NavigationStatus.vue';
const router = useRouter();
async function logout() { await api('/auth/logout', { method: 'POST' }); session.user = null; session.csrfToken = ''; router.push('/login'); }
</script>
<template>
  <NConfigProvider :locale="zhCN" :date-locale="dateZhCN" :theme-overrides="{ common: { primaryColor: '#2563eb', primaryColorHover: '#1d4ed8', primaryColorPressed: '#1e40af', borderRadius: '5px', fontFamily: 'Inter, Segoe UI, Microsoft YaHei, sans-serif' } }">
    <NMessageProvider><NDialogProvider>
      <NavigationStatus />
      <div v-if="session.user" class="app-shell">
        <aside class="sidebar">
          <RouterLink to="/problems" class="brand"><span class="brand-mark">P</span>{{ session.appName }}</RouterLink>
          <div class="nav-label">出题工作台</div>
          <RouterLink to="/problems" class="nav-link">题目</RouterLink>
          <RouterLink to="/contests" class="nav-link">比赛</RouterLink>
          <RouterLink to="/tasks" class="nav-link">任务中心</RouterLink>
          <template v-if="session.user.role === 'ADMIN'"><div class="nav-label">系统管理</div><RouterLink to="/admin/templates" class="nav-link">模板中心</RouterLink><RouterLink to="/admin/compile-profiles" class="nav-link">编译配置</RouterLink><RouterLink to="/admin/users" class="nav-link">用户管理</RouterLink><RouterLink to="/admin/groups" class="nav-link">用户组</RouterLink><RouterLink to="/admin/operations" class="nav-link">运行与审计</RouterLink></template>
          <div class="sidebar-foot"><NTag size="small" :bordered="false">P5 本地部署版</NTag><p>题目、正文和资源默认私有</p></div>
        </aside>
        <div class="main-shell"><header class="topbar"><span>XCPC · 出题与出版</span><div><span>{{ session.user.name }}</span><NTag size="small" :bordered="false">{{ session.user.role === 'ADMIN' ? '系统管理员' : '出题人' }}</NTag><NButton text @click="logout">退出</NButton></div></header><main><RouterView :key="String($route.params.id || $route.path)" /></main></div>
      </div>
      <RouterView v-else />
    </NDialogProvider></NMessageProvider>
  </NConfigProvider>
</template>
