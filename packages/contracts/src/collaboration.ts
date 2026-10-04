import { Type, type Static } from '@sinclair/typebox';
const strict = { additionalProperties: false };
const id = Type.String({ minLength: 1, maxLength: 80 });
const text = (maxLength = 160) => Type.String({ maxLength });
const language = Type.String({ pattern: '^[a-z]{2}(-[A-Z]{2})?$' });
export const ResourceRoleInput = Type.Union((['OWNER','EDITOR','REVIEWER','VIEWER','TRANSLATOR'] as const).map(v=>Type.Literal(v)));
export const MemberInput = Type.Object({ targetType: Type.Union([Type.Literal('USER'),Type.Literal('GROUP')]), targetId: id, role: ResourceRoleInput, languages: Type.Array(language,{maxItems:20,uniqueItems:true}) },strict);
export const MemberDelete = Type.Object({ targetType: Type.Union([Type.Literal('USER'),Type.Literal('GROUP')]), targetId: id },strict);
export const UserGroupInput = Type.Object({ name: Type.String({minLength:1,maxLength:80}), userIds: Type.Array(id,{maxItems:200,uniqueItems:true}), expectedVersion: Type.Integer({minimum:0}) },strict);
export const ProblemMetaInput = Type.Object({ expectedVersion:Type.Integer({minimum:1}), title:Type.String({minLength:1,maxLength:160}),tags:Type.Array(Type.String({minLength:1,maxLength:40}),{maxItems:30,uniqueItems:true}),notes:text(10000),responsibleId:Type.Union([id,Type.Null()]),archived:Type.Boolean() },strict);
export const RevisionInput = Type.Object({expectedHash:Type.String({pattern:'^[a-f0-9]{64}$'}),label:Type.String({minLength:1,maxLength:160})},strict);
export const CommentInput = Type.Object({body:Type.String({minLength:1,maxLength:10000}),anchor:text(240)},strict);
const kind = Type.Union((['STATEMENT','EDITORIAL_DOCUMENT','EDITORIAL_BEAMER'] as const).map(v=>Type.Literal(v)));
export const ContestData = Type.Object({
  title:Type.String({minLength:1,maxLength:160}),author:text(),stage:text(),dateHeader:text(),dateCover:text(),language,
  templates:Type.Object({STATEMENT:Type.Union([id,Type.Null()]),EDITORIAL_DOCUMENT:Type.Union([id,Type.Null()]),EDITORIAL_BEAMER:Type.Union([id,Type.Null()])},strict),
  items:Type.Array(Type.Object({problemId:id,revisionId:Type.Optional(id),code:Type.String({pattern:'^[A-Z][A-Z0-9]{0,7}$'}),lectureOrder:Type.Integer({minimum:1,maximum:100})},strict),{maxItems:100}),
},strict);
export type ContestDataValue = Static<typeof ContestData>;
export const ContestInput = Type.Object({expectedVersion:Type.Integer({minimum:0}),data:ContestData},strict);
export const ContestFreezeInput = Type.Object({expectedVersion:Type.Integer({minimum:1})},strict);
export const ContestBuildInput = Type.Object({revisionId:Type.Optional(id),expectedVersion:Type.Optional(Type.Integer({minimum:1})),kinds:Type.Array(kind,{minItems:1,maxItems:3,uniqueItems:true}),subset:Type.Optional(Type.Array(id,{minItems:1,maxItems:100,uniqueItems:true})),requestKey:Type.Optional(Type.String({minLength:8,maxLength:100}))},strict);
export const PackagePurpose = Type.Union((['STATEMENT','EDITORIAL_DOCUMENT','EDITORIAL_BEAMER','DATA','REFERENCE','FULL'] as const).map(v=>Type.Literal(v)));
export const ExportInput = Type.Object({revisionId:id,purpose:PackagePurpose,format:Type.Union([Type.Literal('NATIVE'),Type.Literal('POLYGON')])},strict);
export const ContestExportInput = Type.Object({...ExportInput.properties,revisionId:Type.Optional(id),expectedVersion:Type.Optional(Type.Integer({minimum:1}))},strict);
export const TestDataTarget = Type.Union([Type.Literal('HYDRO'),Type.Literal('NOVAJUDGE')]);
export type TestDataTargetValue = Static<typeof TestDataTarget>;
export const TestDataExportInput = Type.Object({target:TestDataTarget,revisionId:Type.Optional(id)},strict);
export const ReleaseInput = Type.Object({buildId:Type.Optional(id),exportId:Type.Optional(id)},strict);
