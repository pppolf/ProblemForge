import { Type, type Static } from '@sinclair/typebox';
export * from './judge.ts';
export * from './generator-plan.ts';
export * from './collaboration.ts';
export * from './manifest.ts';

export const kinds = ['STATEMENT', 'EDITORIAL_DOCUMENT', 'EDITORIAL_BEAMER'] as const;
export type DocumentKind = typeof kinds[number];
export const kindLabels: Record<DocumentKind, string> = {
  STATEMENT: '题面', EDITORIAL_DOCUMENT: '文档题解', EDITORIAL_BEAMER: 'Beamer 题解',
};
export const Kind = Type.Union(kinds.map(k => Type.Literal(k)));
const strict = { additionalProperties: false };
export const LoginInput = Type.Object({ account: Type.String({ minLength: 1, maxLength: 254, pattern: '\\S' }), password: Type.String({ minLength: 1, maxLength: 256 }) }, strict);
export const LocalAdminPasswordInput = Type.Object({ currentPassword: Type.String({ minLength: 1, maxLength: 256 }), newPassword: Type.String({ minLength: 12, maxLength: 256, pattern: '\\S' }) }, strict);
export const Language = Type.String({ pattern: '^[a-z]{2}(-[A-Z]{2})?$' });
export const ProblemInput = Type.Object({ title: Type.String({ minLength: 1, maxLength: 160 }), language: Language }, strict);
export const LanguageInput = Type.Object({ language: Language }, strict);
export const AssetInput = Type.Object({ name: Type.String({ minLength: 1, maxLength: 120 }), base64: Type.String({ minLength: 1, maxLength: 1_400_000, pattern: '^[A-Za-z0-9+/]+={0,2}$' }) }, strict);
export const Metadata = Type.Object({ title: Type.String({ maxLength: 160 }), author: Type.String({ maxLength: 160 }) }, strict);
export const DocumentInput = Type.Object({
  expectedVersion: Type.Integer({ minimum: 1 }), body: Type.String({ maxLength: 200000 }),
  enabled: Type.Boolean(), metadata: Metadata,
  templateVersionId: Type.Union([Type.String({ maxLength: 80 }), Type.Null()]),
  sampleRevisionIds: Type.Optional(Type.Array(Type.String({ minLength: 1, maxLength: 80 }), { maxItems: 10, uniqueItems: true })),
}, strict);
export type DocumentSave = Static<typeof DocumentInput>;
export const TemplateInput = Type.Object({ name: Type.String({ minLength: 1, maxLength: 120 }), kind: Kind }, strict);
export const TemplateStyle = Type.Object({
  marginMm: Type.Integer({ minimum: 15, maximum: 35 }),
  cjkFont: Type.Union([Type.Literal('Noto Serif CJK SC'), Type.Literal('Noto Sans CJK SC')]),
  palette: Type.Union([Type.Literal('RED'), Type.Literal('BLUE')]),
}, strict);
export type AdminStyle = Static<typeof TemplateStyle>;
export const TemplateDraftInput = Type.Object({
  expectedVersion: Type.Optional(Type.Integer({ minimum: 1 })),
  files: Type.Record(Type.String({ maxLength: 160 }), Type.String({ maxLength: 2_000_000 }), { maxProperties: 40 }),
  styleConfig: Type.Optional(TemplateStyle),
}, strict);
export const BuildInput = Type.Object({ documentId: Type.String({ maxLength: 80 }), requestKey: Type.Optional(Type.String({minLength:8,maxLength:100})) }, strict);
export const ReasonInput = Type.Object({ reason: Type.String({ minLength: 1, maxLength: 1000 }) }, strict);
export const PublishInput = Type.Object({ buildId: Type.String({ maxLength: 80 }) }, strict);
export type UserView = { id: string; email: string; name: string; role: 'ADMIN' | 'USER' };
export type AuthenticatedUser = UserView & { authProvider: 'local-admin' | 'association' };
export const UserVersionInput = Type.Object({ expectedVersion: Type.Integer({ minimum: 1 }) }, strict);
export const UserUpdateInput = Type.Object({
  ...UserVersionInput.properties,
  role: Type.Union([Type.Literal('USER'), Type.Literal('ADMIN')]),
  disabled: Type.Boolean(),
}, strict);
export const SessionRevokeInput = Type.Object({ all: Type.Boolean() }, strict);
export type ManagedUser = UserView & { disabled: boolean; version: number; associationUserId: string | null; associationAccount: string | null; localAdmin: boolean };
