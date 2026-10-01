<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { useRouter } from 'vue-router';
import { NInput, NButton, NFormItem, NAlert } from 'naive-ui';
import { api, session } from '../api';
const router = useRouter(), resetToken = ref(new URLSearchParams(window.location.hash.slice(1)).get('token') ?? ''), password = ref(''), confirm = ref(''), error = ref(''), busy = ref(false), done = ref(false);
// Fragments never reach the server. Remove from browser history immediately and
// retain the credential only in this mounted page, never in persistent storage.
onMounted(() => { void router.replace('/reset-password'); });
async function reset() {
  error.value = ''; if (password.value !== confirm.value) { error.value = '两次新密码不一致'; return; }
  busy.value = true;
  try { await api('/auth/reset-password', { method: 'POST', body: JSON.stringify({ resetToken: resetToken.value, newPassword: password.value }) }); password.value = ''; confirm.value = ''; resetToken.value = ''; session.user = null; session.csrfToken = ''; done.value = true; }
  catch (e) { error.value = (e as Error).message; } finally { busy.value = false; }
}
</script>
<template><div class="login-page"><div class="login-panel"><h1>重置密码</h1><NAlert v-if="done" type="success">密码已重置，请使用新密码登录。</NAlert><template v-else><p class="muted">使用管理员提供的链接设置新密码；链接 30 分钟有效且仅能使用一次。</p><NAlert v-if="error || !resetToken" type="error" class="spaced">{{ error || '缺少重置凭据，请重新打开完整链接或联系管理员。' }}</NAlert><NFormItem label="新密码（至少 12 个字符）"><NInput v-model:value="password" type="password" autocomplete="new-password" :disabled="busy"/></NFormItem><NFormItem label="确认新密码"><NInput v-model:value="confirm" type="password" autocomplete="new-password" :disabled="busy" @keydown.enter="reset"/></NFormItem><NButton type="primary" block :loading="busy" :disabled="!resetToken" @click="reset">设置新密码</NButton></template><p><RouterLink to="/login">返回登录</RouterLink></p></div></div></template>
