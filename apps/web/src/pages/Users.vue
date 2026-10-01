<script setup lang="ts">
import { ref, computed, onMounted, watch } from 'vue';
import { useRouter } from 'vue-router';
import { NButton, NInput, NSelect, NFormItem, NModal, NTag, NAlert, NSwitch, NSpace, useMessage, useDialog } from 'naive-ui';
import type { ManagedUser } from '@problemforge/contracts';
import { api, session } from '../api';
const users = ref<ManagedUser[]>([]), show = ref(false), busy = ref(false), error = ref(''), search = ref('');
const edit = ref<ManagedUser | null>(null), email = ref(''), name = ref(''), password = ref(''), role = ref<'USER'|'ADMIN'>('USER'), disabled = ref(false);
const resetLink = ref(''), resetExpiry = ref(''), message = useMessage(), dialog = useDialog(), router = useRouter();
const visible = computed(() => users.value.filter(u => `${u.name} ${u.email}`.toLowerCase().includes(search.value.toLowerCase())));
const roles = [{ label: '普通用户', value: 'USER' }, { label: '系统管理员', value: 'ADMIN' }];
async function load() { try { users.value = await api('/admin/users'); } catch (e) { error.value = (e as Error).message; } }
onMounted(load); watch(show, value => { if (!value) password.value = ''; });
async function signedOut() { session.user = null; session.csrfToken = ''; await router.replace('/login'); }
function open(u: ManagedUser | null) { edit.value = u; email.value = u?.email ?? ''; name.value = u?.name ?? ''; role.value = u?.role ?? 'USER'; disabled.value = u?.disabled ?? false; password.value = ''; error.value = ''; show.value = true; }
async function save() {
  busy.value = true; error.value = '';
  try {
    const body = { email: email.value.trim(), name: name.value.trim(), role: role.value };
    const result = await api(edit.value ? `/admin/users/${edit.value.id}` : '/admin/users', { method: edit.value ? 'PATCH' : 'POST', body: JSON.stringify(edit.value ? { ...body, disabled: disabled.value, expectedVersion: edit.value.version } : { ...body, password: password.value }) });
    show.value = false; password.value = ''; message.success(edit.value ? '账号已更新' : '用户已创建');
    if (result.signedOut) { await signedOut(); return; }
    if (result.user?.id === session.user?.id) Object.assign(session.user!, result.user);
    await load();
  } catch (e) { error.value = (e as Error).message; } finally { busy.value = false; }
}
function action(u: ManagedUser, reset: boolean) {
  dialog.warning({ title: reset ? `重置 ${u.name} 的密码` : `撤销 ${u.name} 的会话`, content: reset ? '所有登录立即失效，旧密码停止登录。将生成仅展示一次、30 分钟内有效的重置链接，请通过可信渠道交给该用户。' : '该用户所有设备将退出登录，已打开的实时连接也会失效。', positiveText: '确认', negativeText: '取消', onPositiveClick: async () => {
    busy.value = true; error.value = '';
    try {
      const result = await api(`/admin/users/${u.id}/${reset ? 'reset-password' : 'revoke-sessions'}`, { method: 'POST', body: JSON.stringify({ expectedVersion: u.version }) });
      if (reset) { resetLink.value = `${window.location.origin}/reset-password#token=${result.resetToken}`; resetExpiry.value = new Date(result.expiresAt).toLocaleString(); }
      else message.success(`已撤销 ${result.revoked} 个会话`);
      if (result.signedOut) await signedOut(); else await load();
    } catch (e) { error.value = (e as Error).message; } finally { busy.value = false; }
  } });
}
</script>
<template>
  <div class="page-heading"><div><h1>用户管理</h1><p>系统角色与题目成员角色分别控制权限；至少保留一个可登录的管理员。</p></div><NButton type="primary" @click="open(null)">创建用户</NButton></div>
  <NAlert v-if="error && !show" type="error" class="spaced">{{ error }}</NAlert>
  <div class="panel"><div class="panel-toolbar"><NInput v-model:value="search" placeholder="查找名称或邮箱" style="max-width:360px"/><NButton @click="load">刷新列表</NButton></div><div style="overflow-x:auto"><table class="data-table"><thead><tr><th>名称 / 邮箱</th><th>系统角色</th><th>状态</th><th>管理</th></tr></thead><tbody><tr v-for="u in visible" :key="u.id"><td><strong>{{ u.name }}</strong><small>{{ u.email }}</small></td><td>{{ u.role === 'ADMIN' ? '系统管理员' : '普通用户' }}</td><td><NTag :type="u.disabled ? 'default' : u.passwordResetRequired ? 'warning' : 'success'">{{ u.disabled ? '已停用' : u.passwordResetRequired ? '待重置密码' : '可登录' }}</NTag></td><td><NSpace><NButton size="small" :disabled="busy" :aria-label="`编辑 ${u.name}`" @click="open(u)">编辑</NButton><NButton size="small" :disabled="busy || u.disabled || u.id === session.user?.id" @click="action(u, true)">重置密码</NButton><NButton size="small" :disabled="busy" @click="action(u, false)">撤销会话</NButton></NSpace></td></tr></tbody></table></div></div>
  <NModal v-model:show="show" preset="card" :title="edit ? '编辑用户' : '创建用户'" style="width:min(500px,95vw)" :mask-closable="!busy" :closable="!busy" :close-on-esc="!busy">
    <NAlert v-if="error" type="error" class="spaced">{{ error }}<span v-if="edit">。本地输入已保留，关闭后刷新列表可取得最新版本。</span></NAlert>
    <NFormItem label="名称"><NInput v-model:value="name" placeholder="用户名称" :disabled="busy"/></NFormItem><NFormItem label="邮箱"><NInput v-model:value="email" placeholder="用户邮箱" :disabled="busy"/></NFormItem>
    <NFormItem v-if="!edit" label="初始密码（至少 12 个字符）"><NInput v-model:value="password" type="password" autocomplete="new-password" :disabled="busy"/></NFormItem>
    <NFormItem label="系统角色"><NSelect v-model:value="role" :options="roles" :disabled="busy"/></NFormItem>
    <NFormItem v-if="edit" label="账号状态"><NSwitch v-model:value="disabled" :disabled="busy"><template #checked>停用</template><template #unchecked>启用</template></NSwitch></NFormItem>
    <p v-if="edit" class="muted">更改邮箱、角色或启停状态会撤销该用户全部会话与旧重置链接。修改自己的密码请到账户设置。</p>
    <NButton type="primary" :loading="busy" @click="save">{{ edit ? '保存修改' : '创建' }}</NButton>
  </NModal>
  <NModal :show="!!resetLink" preset="card" title="一次性重置链接" style="width:min(620px,95vw)" @update:show="value => { if (!value) resetLink = ''; }"><NAlert type="warning" class="spaced">截止 {{ resetExpiry }} 有效，仅展示此次。请复制后通过可信渠道交给用户；关闭后如需取回，必须重新发起重置。</NAlert><NInput :value="resetLink" type="textarea" readonly aria-label="一次性重置链接"/><NButton class="spaced" @click="resetLink = ''">已保存，关闭</NButton></NModal>
</template>
