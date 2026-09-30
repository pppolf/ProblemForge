<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { NButton, NInput, NSelect, NFormItem, NModal, NTag, useMessage } from 'naive-ui';
import { api } from '../api';
const users = ref<any[]>([]); const show = ref(false); const busy = ref(false); const email = ref(''); const name = ref(''); const password = ref(''); const role = ref('USER'); const message = useMessage();
async function load() { users.value = await api('/admin/users'); } onMounted(load);
async function create() { busy.value = true; try { await api('/admin/users', { method: 'POST', body: JSON.stringify({ email: email.value, name: name.value, password: password.value, role: role.value }) }); password.value = ''; show.value = false; await load(); message.success('用户已创建'); } catch (e) { message.error((e as Error).message); } finally { busy.value = false; } }
</script>
<template><div class="page-heading"><div><h1>用户管理</h1><p>系统角色与题目成员角色分别控制权限</p></div><NButton type="primary" @click="show = true">创建用户</NButton></div><div class="panel"><table class="data-table"><thead><tr><th>名称</th><th>邮箱</th><th>系统角色</th></tr></thead><tbody><tr v-for="u in users" :key="u.id"><td>{{ u.name }}</td><td>{{ u.email }}</td><td><NTag>{{ u.role }}</NTag></td></tr></tbody></table></div><NModal v-model:show="show" preset="card" title="创建用户" style="width: 460px"><NFormItem label="名称"><NInput v-model:value="name"/></NFormItem><NFormItem label="邮箱"><NInput v-model:value="email"/></NFormItem><NFormItem label="初始密码（至少 12 个字符）"><NInput v-model:value="password" type="password" /></NFormItem><NFormItem label="系统角色"><NSelect v-model:value="role" :options="[{ label: '普通用户', value: 'USER' }, { label: '系统管理员', value: 'ADMIN' }]" /></NFormItem><NButton type="primary" :loading="busy" @click="create">创建</NButton></NModal></template>
