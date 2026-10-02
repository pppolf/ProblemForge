<script setup lang="ts">
import { ref, computed, onMounted } from 'vue';
import { useRouter } from 'vue-router';
import { NButton, NAlert, NTag, NSpace, NForm, NFormItem, NInput, useDialog, useMessage } from 'naive-ui';
import { api, session } from '../api';
const error = ref(''), busy = ref(false);
const localAdmin = computed(() => session.user?.authProvider === 'local-admin');
const currentPassword = ref(''), newPassword = ref(''), confirmPassword = ref('');
const sessions = ref<{createdAt:string; expiresAt:string; current:boolean}[]>([]), router = useRouter(), dialog = useDialog(), message = useMessage();
async function load() { try { sessions.value = await api('/auth/sessions'); } catch (e) { error.value = (e as Error).message; } }
onMounted(load);
async function signOut() { const path = localAdmin.value ? '/login?mode=admin' : '/login'; session.user = null; session.csrfToken = ''; await router.replace(path); }
async function changePassword() {
  if (busy.value) return;
  error.value = '';
  if (!currentPassword.value || newPassword.value.length < 12 || newPassword.value.length > 256 || !newPassword.value.trim()) { error.value = '请填写当前密码，新密码需要 12—256 个字符。'; return; }
  if (newPassword.value !== confirmPassword.value) { error.value = '两次输入的新密码不一致。'; return; }
  busy.value = true;
  try {
    await api('/auth/admin/password', { method: 'POST', body: JSON.stringify({ currentPassword: currentPassword.value, newPassword: newPassword.value }) });
    message.success('密码已修改，所有设备已退出，请使用新密码登录。'); await signOut();
  } catch (e) { error.value = (e as Error).message; }
  finally { currentPassword.value = ''; newPassword.value = ''; confirmPassword.value = ''; busy.value = false; }
}
function revoke(all: boolean) { dialog.warning({ title: all ? '退出所有设备' : '退出其他设备', content: all ? '包括当前页面在内的所有会话将失效。' : '保留当前会话，其他设备需重新登录。', positiveText: '确认退出', negativeText: '取消', onPositiveClick: async () => {
  busy.value = true; error.value = '';
  try { const result = await api('/auth/sessions/revoke', { method: 'POST', body: JSON.stringify({ all }) }); message.success(`已撤销 ${result.revoked} 个会话`); if (all) await signOut(); else await load(); } catch (e) { error.value = (e as Error).message; } finally { busy.value = false; }
} }); }
</script>
<template><div class="page-heading"><div><h1>账户设置</h1><p>{{ session.user?.email }} · 管理出题工作台的登录设备。</p></div></div><NAlert v-if="error" type="error" class="spaced">{{ error }}</NAlert>
  <div v-if="localAdmin" class="panel spaced" style="max-width:700px;padding:24px"><h2>独立超级管理员</h2><p>使用本地密码，无需绑定协会账号。修改密码后所有设备将退出登录。</p>
    <NForm @submit.prevent="changePassword">
      <NFormItem label="当前密码"><NInput v-model:value="currentPassword" type="password" autocomplete="current-password" :disabled="busy" show-password-on="click" /></NFormItem>
      <NFormItem label="新密码（12—256 个字符）"><NInput v-model:value="newPassword" type="password" autocomplete="new-password" :maxlength="256" :disabled="busy" show-password-on="click" /></NFormItem>
      <NFormItem label="确认新密码"><NInput v-model:value="confirmPassword" type="password" autocomplete="new-password" :maxlength="256" :disabled="busy" show-password-on="click" /></NFormItem>
      <NButton type="primary" attr-type="submit" :loading="busy" :disabled="!currentPassword || !newPassword || !confirmPassword">修改管理员密码</NButton>
    </NForm>
  </div>
  <div v-else class="panel spaced" style="max-width:700px;padding:24px"><h2>协会账号</h2><p>账号资料和密码由协会官网统一管理。</p><a href="https://www.cwnupaa.com" target="_blank" rel="noopener noreferrer">前往协会官网管理账号</a></div><div class="panel" style="max-width:700px"><div class="panel-toolbar"><h2>有效会话（{{ sessions.length }}）</h2><NSpace><NButton :disabled="busy" @click="revoke(false)">退出其他设备</NButton><NButton :disabled="busy" @click="revoke(true)">退出所有设备</NButton></NSpace></div><table class="data-table"><thead><tr><th>登录时间</th><th>有效期至</th><th>标记</th></tr></thead><tbody><tr v-for="(s,i) in sessions" :key="i"><td>{{ new Date(s.createdAt).toLocaleString() }}</td><td>{{ new Date(s.expiresAt).toLocaleString() }}</td><td><NTag v-if="s.current" type="success">当前会话</NTag></td></tr></tbody></table></div></template>
