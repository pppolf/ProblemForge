<script setup lang="ts">
import { ref, computed, onMounted } from 'vue';
import { useRouter } from 'vue-router';
import { NButton, NInput, NSelect, NFormItem, NModal, NTag, NAlert, NSwitch, NSpace, useMessage, useDialog } from 'naive-ui';
import type { ManagedUser } from '@problemforge/contracts';
import { api, session } from '../api';
const users = ref<ManagedUser[]>([]), show = ref(false), busy = ref(false), error = ref(''), search = ref('');
const edit = ref<ManagedUser | null>(null), role = ref<'USER'|'ADMIN'>('USER'), disabled = ref(false);
const message = useMessage(), dialog = useDialog(), router = useRouter();
const visible = computed(() => users.value.filter(u => `${u.name} ${u.email} ${u.associationAccount ?? ''} ${u.associationUserId ?? ''}`.toLowerCase().includes(search.value.toLowerCase())));
const roles = [{ label: '普通用户', value: 'USER' }, { label: '系统管理员', value: 'ADMIN' }];
async function load() { try { users.value = await api('/admin/users'); } catch (e) { error.value = (e as Error).message; } }
onMounted(load);
async function signedOut() { session.user = null; session.csrfToken = ''; await router.replace('/login'); }
function open(u: ManagedUser) { edit.value = u; role.value = u.role; disabled.value = u.disabled; error.value = ''; show.value = true; }
async function save() {
  if (!edit.value || busy.value) return;
  busy.value = true; error.value = '';
  try {
    const result = await api(`/admin/users/${edit.value.id}`, { method: 'PATCH', body: JSON.stringify({ role: role.value, disabled: disabled.value, expectedVersion: edit.value.version }) });
    show.value = false; message.success('权限已更新');
    if (result.signedOut) { await signedOut(); return; }
    await load();
  } catch (e) { error.value = (e as Error).message; } finally { busy.value = false; }
}
function revoke(u: ManagedUser) {
  dialog.warning({ title: `撤销 ${u.name} 的会话`, content: '该用户在出题工作台的所有设备将退出登录。', positiveText: '确认', negativeText: '取消', onPositiveClick: async () => {
    busy.value = true; error.value = '';
    try {
      const result = await api(`/admin/users/${u.id}/revoke-sessions`, { method: 'POST', body: JSON.stringify({ expectedVersion: u.version }) });
      message.success(`已撤销 ${result.revoked} 个会话`);
      if (result.signedOut) await signedOut(); else await load();
    } catch (e) { error.value = (e as Error).message; } finally { busy.value = false; }
  } });
}
</script>
<template>
  <div class="page-heading"><div><h1>用户管理</h1><p>协会用户首次登录后自动加入。此处管理本系统的角色、启停和登录设备。</p></div></div>
  <NAlert v-if="error && !show" type="error" class="spaced">{{ error }}</NAlert>
  <div class="panel"><div class="panel-toolbar"><NInput v-model:value="search" placeholder="查找名称、邮箱或协会账号" style="max-width:360px"/><NButton @click="load">刷新列表</NButton></div><div style="overflow-x:auto"><table class="data-table"><thead><tr><th>名称 / 邮箱</th><th>协会账号</th><th>系统角色</th><th>状态</th><th>管理</th></tr></thead><tbody><tr v-for="u in visible" :key="u.id"><td><strong>{{ u.name }}</strong><small>{{ u.email }}</small></td><td>{{ u.associationAccount || '—' }}<small>{{ u.associationUserId ? `ID ${u.associationUserId}` : '旧账号待绑定' }}</small></td><td>{{ u.role === 'ADMIN' ? '系统管理员' : '普通用户' }}</td><td><NTag :type="u.disabled ? 'default' : u.associationUserId ? 'success' : 'warning'">{{ u.disabled ? '已停用' : u.associationUserId ? '已启用' : '待绑定' }}</NTag></td><td><NSpace><NButton size="small" :disabled="busy" :aria-label="`编辑 ${u.name} 的权限`" @click="open(u)">编辑权限</NButton><NButton size="small" :disabled="busy" @click="revoke(u)">撤销会话</NButton></NSpace></td></tr></tbody></table></div></div>
  <NModal v-model:show="show" preset="card" title="编辑用户权限" style="width:min(500px,95vw)" :mask-closable="!busy" :closable="!busy" :close-on-esc="!busy">
    <NAlert v-if="error" type="error" class="spaced">{{ error }}。本地输入已保留，关闭后刷新列表可取得最新版本。</NAlert>
    <p>{{ edit?.name }} · {{ edit?.email }}</p>
    <NFormItem label="系统角色"><NSelect v-model:value="role" :options="roles" :disabled="busy"/></NFormItem>
    <NFormItem label="本系统账号状态"><NSwitch v-model:value="disabled" :disabled="busy"><template #checked>停用</template><template #unchecked>启用</template></NSwitch></NFormItem>
    <p class="muted">更改角色或启停状态会撤销该用户在本系统的全部会话。名称、邮箱和密码请在协会官网修改。</p>
    <NButton type="primary" :loading="busy" @click="save">保存修改</NButton>
  </NModal>
</template>
