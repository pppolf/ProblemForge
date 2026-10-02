<script setup lang="ts">
import { ref, computed, watch, onMounted } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { NInput, NButton, NForm, NFormItem, NAlert, NTabs, NTab } from 'naive-ui';
import { api, session } from '../api';
const router = useRouter(), route = useRoute();
const mode = ref<'association' | 'admin'>(route.query.mode === 'admin' ? 'admin' : 'association');
const account = ref(''), password = ref(''), busy = ref(false), error = ref(''), configError = ref(''), configured = ref<boolean | null>(null);
const localAdmin = computed(() => mode.value === 'admin');
const canLogin = computed(() => !busy.value && (localAdmin.value || configured.value === true) && !!account.value.trim() && !!password.value);
watch(mode, () => { account.value = ''; password.value = ''; error.value = ''; });
onMounted(async () => { try { configured.value = (await api('/auth/config')).configured; } catch (e) { configError.value = (e as Error).message; } });
async function login() {
  if (!canLogin.value) return;
  busy.value = true; error.value = '';
  try { Object.assign(session, await api(localAdmin.value ? '/auth/admin/login' : '/auth/login', { method: 'POST', body: JSON.stringify({ account: account.value.trim(), password: password.value }) })); await router.push('/problems'); }
  catch (e) { error.value = (e as Error).message; }
  finally { password.value = ''; busy.value = false; }
}
</script>
<template>
  <div class="login-page"><div class="login-panel">
    <div class="brand"><span class="brand-mark">P</span>{{ session.appName }}</div><h1>登录出题工作台</h1>
    <NTabs v-model:value="mode" type="line" class="spaced" aria-label="登录方式"><NTab name="association" :disabled="busy">协会账号登录</NTab><NTab name="admin" :disabled="busy">超级管理员登录</NTab></NTabs>
    <p class="muted">{{ localAdmin ? '使用独立管理员邮箱和本地密码登录，无需协会账号。' : '使用协会官网账号或邮箱与密码登录。' }}</p>
    <NAlert v-if="!localAdmin && configured===false" type="warning" class="spaced">协会登录尚未配置，请联系管理员填写 APPKEY。超级管理员可切换到独立登录入口。</NAlert>
    <NAlert v-if="error || (!localAdmin && configError)" type="error" class="spaced">{{ error || configError }}</NAlert>
    <NForm @submit.prevent="login">
      <NFormItem :label="localAdmin ? '管理员邮箱' : '协会账号或邮箱'"><NInput v-model:value="account" :disabled="busy" type="text" autocomplete="username" :placeholder="localAdmin ? '输入管理员邮箱' : '输入协会账号或邮箱（不支持学号）'" /></NFormItem>
      <NFormItem label="密码"><NInput v-model:value="password" :disabled="busy" type="password" autocomplete="current-password" show-password-on="click" :placeholder="localAdmin ? '输入本地管理员密码' : '输入协会官网密码'" /></NFormItem>
      <NButton type="primary" attr-type="submit" block :loading="busy" :disabled="!canLogin">{{ localAdmin ? '管理员登录' : '登录' }}</NButton>
    </NForm>
    <p v-if="localAdmin" class="muted">管理员密码可在登录后的「账户设置」中修改。</p>
    <p v-else class="muted">账号注册、资料和密码管理请前往 <a href="https://www.cwnupaa.com" target="_blank" rel="noopener noreferrer">协会官网</a>。</p>
  </div></div>
</template>
