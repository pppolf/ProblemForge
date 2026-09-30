import { Type, type Static } from '@sinclair/typebox';

export const kinds = ['STATEMENT', 'EDITORIAL_DOCUMENT', 'EDITORIAL_BEAMER'] as const;
export type DocumentKind = typeof kinds[number];
export const kindLabels: Record<DocumentKind, string> = {
  STATEMENT: '题面', EDITORIAL_DOCUMENT: '文档题解', EDITORIAL_BEAMER: 'Beamer 题解',
};
export const Kind = Type.Union(kinds.map(k => Type.Literal(k)));
const strict = { additionalProperties: false };
export const LoginInput = Type.Object({ email: Type.String({ format: 'email', maxLength: 254 }), password: Type.String({ minLength: 1, maxLength: 256 }) }, strict);
export const Language = Type.String({ pattern: '^[a-z]{2}(-[A-Z]{2})?$' });
export const ProblemInput = Type.Object({ title: Type.String({ minLength: 1, maxLength: 160 }), language: Language }, strict);
export const LanguageInput = Type.Object({ language: Language }, strict);
export const AssetInput = Type.Object({ name: Type.String({ minLength: 1, maxLength: 120 }), base64: Type.String({ minLength: 1, maxLength: 1_400_000, pattern: '^[A-Za-z0-9+/]+={0,2}$' }) }, strict);
export const Metadata = Type.Object({ title: Type.String({ maxLength: 160 }), author: Type.String({ maxLength: 160 }) }, strict);
export const DocumentInput = Type.Object({
  expectedVersion: Type.Integer({ minimum: 1 }), body: Type.String({ maxLength: 200000 }),
  enabled: Type.Boolean(), metadata: Metadata,
  templateVersionId: Type.Union([Type.String({ maxLength: 80 }), Type.Null()]),
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
export const BuildInput = Type.Object({ documentId: Type.String({ maxLength: 80 }) }, strict);
export const ReasonInput = Type.Object({ reason: Type.String({ minLength: 1, maxLength: 1000 }) }, strict);
export const PublishInput = Type.Object({ buildId: Type.String({ maxLength: 80 }) }, strict);
export const UserInput = Type.Object({
  email: Type.String({ format: 'email', maxLength: 254 }), name: Type.String({ minLength: 1, maxLength: 80 }),
  password: Type.String({ minLength: 12, maxLength: 256 }), role: Type.Union([Type.Literal('USER'), Type.Literal('ADMIN')]),
}, strict);
export type UserView = { id: string; email: string; name: string; role: 'ADMIN' | 'USER' };
