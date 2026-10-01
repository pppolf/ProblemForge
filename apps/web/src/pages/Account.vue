<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { useRouter } from 'vue-router';
import { NInput, NButton, NFormItem, NAlert, NTag, NSpace, useDialog, useMessage } from 'naive-ui';
import { api, session } from '../api';
const currentPassword = ref(''), newPassword = ref(''), confirm = ref(''), error = ref(''), busy = ref(false);
const sessions = ref<{createdAt:string; expiresAt:string; current:boolean}[]>([]), router = useRouter(), dialog = useDialog(), message = useMessage();
async function load() { try { sessions.value = await api('/auth/sessions'); } catch (e) { error.value = (e as Error).message; } }
onMounted(load);
async function signOut() { session.user = null; session.csrfToken = ''; await router.replace('/login'); }
async function changePassword() {
  error.value = '';
  if (newPassword.value !== confirm.value) { error.value = '两次新密码不一致'; return; }
  busy.value = true;
  try { await api('/auth/password', { method: 'POST', body: JSON.stringify({ currentPassword: currentPassword.value, newPassword: newPassword.value }) }); currentPassword.value = ''; newPassword.value = ''; confirm.value = ''; message.success('密码已修改，请重新登录'); await signOut(); }
  catch (e) { error.value = (e as Error).message; } finally { busy.value = false; }
}
function revoke(all: boolean) { dialog.warning({ title: all ? '退出所有设备' : '退出其他设备', content: all ? '包括当前页面在内的所有会话将失效。' : '保留当前会话，其他设备需重新登录。', positiveText: '确认退出', negativeText: '取消', onPositiveClick: async () => {
  busy.value = true; error.value = '';
  try { const result = await api('/auth/sessions/revoke', { method: 'POST', body: JSON.stringify({ all }) }); message.success(`已撤销 ${result.revoked} 个会话`); if (all) await signOut(); else await load(); } catch (e) { error.value = (e as Error).message; } finally { busy.value = false; }
} }); }
</script>
<template><div class="page-heading"><div><h1>账户设置</h1><p>{{ session.user?.email }} · 修改密码后所有设备都需要重新登录。</p></div></div><NAlert v-if="error" type="error" class="spaced">{{ error }}</NAlert><div class="panel spaced" style="max-width:700px;padding:24px"><h2>修改密码</h2><NFormItem label="当前密码"><NInput v-model:value="currentPassword" type="password" autocomplete="current-password" :disabled="busy"/></NFormItem><NFormItem label="新密码（至少 12 个字符）"><NInput v-model:value="newPassword" type="password" autocomplete="new-password" :disabled="busy"/></NFormItem><NFormItem label="确认新密码"><NInput v-model:value="confirm" type="password" autocomplete="new-password" :disabled="busy" @keydown.enter="changePassword"/></NFormItem><NButton type="primary" :loading="busy" @click="changePassword">修改密码并退出登录</NButton></div><div class="panel" style="max-width:700px"><div class="panel-toolbar"><h2>有效会话（{{ sessions.length }}）</h2><NSpace><NButton :disabled="busy" @click="revoke(false)">退出其他设备</NButton><NButton :disabled="busy" @click="revoke(true)">退出所有设备</NButton></NSpace></div><table class="data-table"><thead><tr><th>登录时间</th><th>有效期至</th><th>标记</th></tr></thead><tbody><tr v-for="(s,i) in sessions" :key="i"><td>{{ new Date(s.createdAt).toLocaleString() }}</td><td>{{ new Date(s.expiresAt).toLocaleString() }}</td><td><NTag v-if="s.current" type="success">当前会话</NTag></td></tr></tbody></table></div></template>
