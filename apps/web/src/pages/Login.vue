<script setup lang="ts">
import { ref, computed, watch, onMounted } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { NInput, NButton, NForm, NFormItem, NAlert, NTabs, NTab } from 'naive-ui';
import { api, session } from '../api';
import AppIcon from '../components/AppIcon.vue';
import ThemePicker from '../components/ThemePicker.vue';

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
  try {
    Object.assign(session, await api(localAdmin.value ? '/auth/admin/login' : '/auth/login', {
      method: 'POST',
      body: JSON.stringify({ account: account.value.trim(), password: password.value }),
    }));
    await router.push('/problems');
  } catch (e) { error.value = (e as Error).message; }
  finally { password.value = ''; busy.value = false; }
}
</script>
<template>
  <div class="login-shell">
    <div class="login-theme-btn">
      <ThemePicker />
    </div>

    <section class="login-hero" aria-hidden="true">
      <div class="login-hero-brand">
        <span class="brand-mark"><AppIcon name="forge" :size="20" /></span>
        <span>{{ session.appName }}</span>
      </div>
      <div class="login-hero-body">
        <div class="login-hero-kicker"><AppIcon name="terminal" :size="13" /><span>XCPC AUTHORING WORKBENCH</span></div>
        <h2>精准编写，隔离验题，<br />一站式比赛出版。</h2>
        <p class="login-hero-desc">面向算法竞赛命题团队打造的私有出题工作台，将 LaTeX 题面与讲题 Beamer、Linux 沙箱验题与多平台题包导出统一到同一条可追踪版本链。</p>
        <div class="login-features">
          <div class="login-feature-item">
            <span class="login-feature-icon"><AppIcon name="layers" :size="17" /></span>
            <div>
              <strong>三类文稿独立版本出版</strong>
              <span>题面、书面题解与 Beamer 讲题幻灯片独立保存，受控 AST 校验 + XeLaTeX 沙箱直出整场 PDF。</span>
            </div>
          </div>
          <div class="login-feature-item">
            <span class="login-feature-icon"><AppIcon name="cpu" :size="17" /></span>
            <div>
              <strong>Linux go-judge 全隔离验题</strong>
              <span>支持 C17 / C++23 / Java 17 / Python 3、testlib SPJ、双向交互、有预算对拍与 DAG 分组部分分。</span>
            </div>
          </div>
          <div class="login-feature-item">
            <span class="login-feature-icon"><AppIcon name="shield" :size="17" /></span>
            <div>
              <strong>不可变快照与多 OJ 互通</strong>
              <span>支持原生包往返、Polygon 离线子集、Hydro Markdown 与 NovaJudge 完整包一键导出。</span>
            </div>
          </div>
        </div>
      </div>
      <div class="login-hero-meta">
        <span>SANDBOX: <b>GO-JUDGE</b></span>
        <span>TYPESET: <b>XELATEX</b></span>
        <span>TESTLIB: <b>0.9.41</b></span>
      </div>
    </section>

    <section class="login-stage">
      <div class="brand login-mobile-brand">
        <span class="brand-mark"><AppIcon name="forge" :size="20" /></span>
        <span class="brand-name">{{ session.appName }}<small>XCPC AUTHORING</small></span>
      </div>
      <div class="login-panel">
        <h1>登录工作台</h1>
        <p class="login-subtitle">选择账号类型以进入私有命题与协作空间。</p>
        <NTabs v-model:value="mode" type="segment" class="login-modes" aria-label="登录方式">
          <NTab name="association" :disabled="busy">协会账号登录</NTab>
          <NTab name="admin" :disabled="busy">超级管理员登录</NTab>
        </NTabs>
        <p class="muted">{{ localAdmin ? '使用独立管理员邮箱和本地密码登录，无需协会账号。' : '使用协会官网账号或邮箱与密码登录。' }}</p>
        <NAlert v-if="!localAdmin && configured===false" type="warning" class="spaced">协会登录尚未配置，请联系管理员填写 APPKEY。超级管理员可切换到独立登录入口。</NAlert>
        <NAlert v-if="error || (!localAdmin && configError)" type="error" class="spaced">{{ error || configError }}</NAlert>
        <NForm @submit.prevent="login">
          <NFormItem :label="localAdmin ? '管理员邮箱' : '协会账号或邮箱'">
            <NInput v-model:value="account" :disabled="busy" type="text" size="large" autocomplete="username" :input-props="{ 'aria-label': localAdmin ? '管理员邮箱' : '协会账号或邮箱' }" :placeholder="localAdmin ? '输入管理员邮箱' : '输入协会账号或邮箱（不支持学号）'" />
          </NFormItem>
          <NFormItem label="密码">
            <NInput v-model:value="password" :disabled="busy" type="password" size="large" autocomplete="current-password" :input-props="{ 'aria-label': '密码' }" show-password-on="click" :placeholder="localAdmin ? '输入本地管理员密码' : '输入协会官网密码'" />
          </NFormItem>
          <NButton type="primary" attr-type="submit" size="large" block :loading="busy" :disabled="!canLogin">{{ localAdmin ? '管理员登录' : '登录工作台' }}</NButton>
        </NForm>
        <p v-if="localAdmin" class="muted login-help">管理员密码可在登录后的「账户设置」中修改。</p>
        <p v-else class="muted login-help">账号注册、资料和密码管理请前往 <a href="https://www.cwnupaa.com" target="_blank" rel="noopener noreferrer">协会官网 ↗</a>。</p>
      </div>
      <div class="login-footer"><AppIcon name="lock" :size="13" />私有出题 · 隔离验题 · 比赛出版</div>
    </section>
  </div>
</template>
