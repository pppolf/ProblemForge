<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { useRouter } from 'vue-router';
import { NButton, NAlert, NTag, NSpace, useDialog, useMessage } from 'naive-ui';
import { api, session } from '../api';
const error = ref(''), busy = ref(false);
const sessions = ref<{createdAt:string; expiresAt:string; current:boolean}[]>([]), router = useRouter(), dialog = useDialog(), message = useMessage();
async function load() { try { sessions.value = await api('/auth/sessions'); } catch (e) { error.value = (e as Error).message; } }
onMounted(load);
async function signOut() { session.user = null; session.csrfToken = ''; await router.replace('/login'); }
function revoke(all: boolean) { dialog.warning({ title: all ? '退出所有设备' : '退出其他设备', content: all ? '包括当前页面在内的所有会话将失效。' : '保留当前会话，其他设备需重新登录。', positiveText: '确认退出', negativeText: '取消', onPositiveClick: async () => {
  busy.value = true; error.value = '';
  try { const result = await api('/auth/sessions/revoke', { method: 'POST', body: JSON.stringify({ all }) }); message.success(`已撤销 ${result.revoked} 个会话`); if (all) await signOut(); else await load(); } catch (e) { error.value = (e as Error).message; } finally { busy.value = false; }
} }); }
</script>
<template><div class="page-heading"><div><h1>账户设置</h1><p>{{ session.user?.email }} · 管理出题工作台的登录设备。</p></div></div><NAlert v-if="error" type="error" class="spaced">{{ error }}</NAlert><div class="panel spaced" style="max-width:700px;padding:24px"><h2>协会账号</h2><p>账号资料和密码由协会官网统一管理。</p><a href="https://www.cwnupaa.com" target="_blank" rel="noopener noreferrer">前往协会官网管理账号</a></div><div class="panel" style="max-width:700px"><div class="panel-toolbar"><h2>有效会话（{{ sessions.length }}）</h2><NSpace><NButton :disabled="busy" @click="revoke(false)">退出其他设备</NButton><NButton :disabled="busy" @click="revoke(true)">退出所有设备</NButton></NSpace></div><table class="data-table"><thead><tr><th>登录时间</th><th>有效期至</th><th>标记</th></tr></thead><tbody><tr v-for="(s,i) in sessions" :key="i"><td>{{ new Date(s.createdAt).toLocaleString() }}</td><td>{{ new Date(s.expiresAt).toLocaleString() }}</td><td><NTag v-if="s.current" type="success">当前会话</NTag></td></tr></tbody></table></div></template>
