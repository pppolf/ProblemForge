import { createApp } from 'vue';
import { createRouter, createWebHistory } from 'vue-router';
import App from './App.vue';
import { loadSession, session } from './api';
import { navigation } from './navigation';
import './style.css';
import './admin-style.css';
import './assets.css';
import './judge.css';
import './p4.css';
const router = createRouter({ history: createWebHistory(), routes: [
  { path: '/login', component: () => import('./pages/Login.vue') }, { path: '/', redirect: '/problems' },
  { path: '/problems', component: () => import('./pages/Problems.vue') }, { path: '/problems/:id', component: () => import('./pages/Workspace.vue') },
  { path: '/import', component: () => import('./pages/ImportPackage.vue') },
  { path: '/tasks', component: () => import('./pages/Tasks.vue') },
  { path: '/admin/templates', component: () => import('./pages/Templates.vue') },
  { path: '/admin/users', component: () => import('./pages/Users.vue') },
  { path: '/admin/compile-profiles', component: () => import('./pages/CompileProfiles.vue') },
  { path: '/contests', component: () => import('./pages/Contests.vue') },
  { path: '/contests/:id', component: () => import('./pages/ContestWorkspace.vue') },
  { path: '/admin/groups', component: () => import('./pages/UserGroups.vue') },
  { path: '/admin/operations', component: () => import('./pages/Operations.vue') },
] });
router.beforeEach(async to => { navigation.pending = true; navigation.failedPath = ''; if (!session.ready) await loadSession(); if (!session.user && to.path !== '/login') return '/login'; if (to.path.startsWith('/admin') && session.user?.role !== 'ADMIN') return '/problems'; });
router.afterEach(() => { navigation.pending = false; });
router.onError((_error, to) => { navigation.pending = false; navigation.failedPath = to.fullPath; });
createApp(App).use(router).mount('#app');
