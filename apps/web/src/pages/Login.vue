<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { useRouter } from 'vue-router';
import { NInput, NButton, NForm, NFormItem, NAlert } from 'naive-ui';
import { api, session } from '../api';
const account = ref(''), password = ref(''), busy = ref(false), error = ref(''), configured = ref<boolean | null>(null), router = useRouter();
onMounted(async () => { try { configured.value = (await api('/auth/config')).configured; } catch (e) { error.value = (e as Error).message; } });
async function login() {
  if (busy.value || configured.value !== true || !account.value.trim() || !password.value) return;
  busy.value = true; error.value = '';
  try { Object.assign(session, await api('/auth/login', { method: 'POST', body: JSON.stringify({ account: account.value.trim(), password: password.value }) })); await router.push('/problems'); }
  catch (e) { error.value = (e as Error).message; }
  finally { password.value = ''; busy.value = false; }
}
</script>
<template><div class="login-page"><div class="login-panel"><div class="brand"><span class="brand-mark">P</span>{{ session.appName }}</div><h1>登录出题工作台</h1><p class="muted">使用协会官网账号或邮箱与密码登录。</p><NAlert v-if="configured===false" type="warning" class="spaced">协会登录尚未配置，请联系管理员填写 APPKEY。</NAlert><NAlert v-if="error" type="error" class="spaced">{{ error }}</NAlert><NForm @submit.prevent="login"><NFormItem label="协会账号或邮箱"><NInput v-model:value="account" :disabled="busy" type="text" autocomplete="username" placeholder="输入协会账号或邮箱（不支持学号）" /></NFormItem><NFormItem label="密码"><NInput v-model:value="password" :disabled="busy" type="password" autocomplete="current-password" show-password-on="click" placeholder="输入协会官网密码" /></NFormItem><NButton type="primary" attr-type="submit" block :loading="busy" :disabled="configured!==true||!account.trim()||!password">登录</NButton></NForm><p class="muted">账号注册、资料和密码管理请前往 <a href="https://www.cwnupaa.com" target="_blank" rel="noopener noreferrer">协会官网</a>。</p></div></div></template>
