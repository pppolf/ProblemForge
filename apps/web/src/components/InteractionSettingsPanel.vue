<script setup lang="ts">
import { computed } from 'vue';
import { NSelect, NFormItem, NInputNumber } from 'naive-ui';
import { defaultInteractionSettings, type JudgeSettingsValue } from '@problemforge/contracts';
const props=defineProps<{modelValue:JudgeSettingsValue['interaction'];disabled:boolean}>();
const emit=defineEmits<{'update:modelValue':[value:JudgeSettingsValue['interaction']]}>();
const settings=computed(()=>({...defaultInteractionSettings,...props.modelValue}));
function set(key:string,value:unknown){emit('update:modelValue',{...settings.value,[key]:value});}
const fields=[{key:'interactorTimeMs',label:'Interactor CPU / ms',min:50,max:10000},{key:'interactorMemoryMb',label:'Interactor 内存 / MiB',min:32,max:1024},{key:'wallTimeMs',label:'双方总墙钟 / ms',min:500,max:30000},{key:'idleTimeMs',label:'通信空闲上限 / ms',min:100,max:10000},{key:'transcriptBytes',label:'通信原始记录上限 / bytes',min:1024,max:262144}] as const;
</script>
<template><div class="judge-form-grid"><NFormItem label="交互判定方式"><NSelect :value="settings.verdictMode" :options="[{label:'Interactor 直接判定',value:'DIRECT'},{label:'Interactor 输出交 Checker',value:'CHECKER'}]" :disabled="disabled" @update:value="v=>set('verdictMode',v)"/></NFormItem><NFormItem v-for="f in fields" :key="f.key" :label="f.label"><NInputNumber :value="settings[f.key]" :min="f.min" :max="f.max" :disabled="disabled" @update:value="v=>set(f.key,v)"/></NFormItem></div></template>
