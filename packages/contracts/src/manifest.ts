import type { DocumentKind } from './index.ts';
import type { ProgramSave, ProgramLanguage, ProfileConfigValue, JudgeSettingsValue, TestGroupsValue, StressConfigValue, GeneratorPlanSave, ToolSelfTestSave } from './judge.ts';
export type StoredBlob = { key:string;hash:string;bytes:number };
export type ManifestTest = {id:string;revisionId:string;version:number;number:number;groupName:string;isSample:boolean;enabled:boolean;notes:string;input:StoredBlob;answer:StoredBlob|null;provenance:unknown};
export type ManifestDocument = {id:string;revisionId:string;version:number;language:string;kind:DocumentKind;enabled:boolean;body:string;metadata:{title:string;author:string};sampleRevisionIds:string[];template:{id:string;templateId:string;number:number;hash:string;name:string}|null};
export type ManifestProgram = Omit<ProgramSave,'profileId'> & {id:string;revisionId:string;version:number;sourceHash:string;profile:{id:string;name:string;language:ProgramLanguage;version:number;hash:string;config:ProfileConfigValue}};
export type ProblemManifest = {
  schemaVersion:1;problemId:string;meta:{title:string;tags:string[];notes:string;responsibleId:string|null};
  documents:ManifestDocument[];programs:ManifestProgram[];tests:ManifestTest[];samples:ManifestTest[];
  assets:{id:string;name:string;path:string;mediaType:string;blob:StoredBlob}[];
  plans:(GeneratorPlanSave & {id:string;version:number})[];selfTests:(Omit<ToolSelfTestSave,'inputBase64'|'answerBase64'|'outputBase64'> & {id:string;version:number;input:StoredBlob;answer:StoredBlob;output:StoredBlob})[];
  groups:TestGroupsValue|null;stress:StressConfigValue|null;judgeSettings:JudgeSettingsValue;
};
