import { createApp } from 'vue';
import { createRouter, createWebHistory } from 'vue-router';
import App from './App.vue';
import Login from './pages/Login.vue';
import Problems from './pages/Problems.vue';
import Workspace from './pages/Workspace.vue';
import Templates from './pages/Templates.vue';
import Tasks from './pages/Tasks.vue';
import Users from './pages/Users.vue';
import CompileProfiles from './pages/CompileProfiles.vue';
import { loadSession, session } from './api';
import './style.css';
import './admin-style.css';
import './assets.css';
import './judge.css';
const router = createRouter({ history: createWebHistory(), routes: [
  { path: '/login', component: Login }, { path: '/', redirect: '/problems' },
  { path: '/problems', component: Problems }, { path: '/problems/:id', component: Workspace },
  { path: '/tasks', component: Tasks }, { path: '/admin/templates', component: Templates }, { path: '/admin/users', component: Users },
  { path: '/admin/compile-profiles', component: CompileProfiles },
] });
router.beforeEach(async to => { if (!session.ready) await loadSession(); if (!session.user && to.path !== '/login') return '/login'; if (to.path.startsWith('/admin') && session.user?.role !== 'ADMIN') return '/problems'; });
createApp(App).use(router).mount('#app');
