<script setup lang="ts">
import { ref } from 'vue';
import { useRouter } from 'vue-router';
import { NInput, NButton, NForm, NFormItem, NAlert } from 'naive-ui';
import { api, session } from '../api';
const email = ref(''); const password = ref(''); const busy = ref(false); const error = ref(''); const router = useRouter();
async function login() { busy.value = true; error.value = ''; try { Object.assign(session, await api('/auth/login', { method: 'POST', body: JSON.stringify({ email: email.value, password: password.value }) })); router.push('/problems'); } catch (e) { error.value = (e as Error).message; } finally { busy.value = false; } }
</script>
<template><div class="login-page"><div class="login-panel"><div class="brand"><span class="brand-mark">P</span>{{ session.appName }}</div><h1>登录出题工作台</h1><p class="muted">编写、验证、审阅和出版竞赛题目。</p><NAlert v-if="error" type="error" class="spaced">{{ error }}</NAlert><NForm @submit.prevent="login"><NFormItem label="邮箱"><NInput v-model:value="email" type="text" autocomplete="username" placeholder="name@example.org" /></NFormItem><NFormItem label="密码"><NInput v-model:value="password" type="password" autocomplete="current-password" show-password-on="click" placeholder="输入密码" @keydown.enter="login" /></NFormItem><NButton type="primary" block :loading="busy" @click="login">登录</NButton></NForm></div></div></template>
