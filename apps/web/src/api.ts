import { reactive } from 'vue';
import type { UserView } from '@problemforge/contracts';
export const session = reactive({ user: null as UserView | null, csrfToken: '', appName: 'ProblemForge', ready: false });
export class ApiError extends Error { constructor(message: string, public status: number, public code: string, public details?: unknown) { super(message); } }
export async function api<T = any>(path: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch(`/api${path}`, { ...options, credentials: 'same-origin', headers: { ...(options.body ? { 'Content-Type': 'application/json' } : {}), ...(session.csrfToken ? { 'X-CSRF-Token': session.csrfToken } : {}), ...options.headers } });
  if (!response.ok) { const error = await response.json(); if (response.status === 401) session.user = null; throw new ApiError(error.message, response.status, error.code, error.details); }
  return response.json();
}
export async function loadSession() {
  try { Object.assign(session, await api('/auth/me')); } catch {} finally { session.ready = true; }
}
export type Artifact = { id: string; hash: string; bytes: number };
export type Build = { id: string; kind: string; state: string; log: string; errorCode?: string; stale: boolean; artifacts: Artifact[]; documentId?: string; purpose: string; input: Record<string, any>; createdAt: string; diagnostics?: any[] };
export type Draft = { id: string; kind: 'STATEMENT' | 'EDITORIAL_DOCUMENT' | 'EDITORIAL_BEAMER'; language: string; version: number; enabled: boolean; templateVersionId: string | null; currentRevision: { id: string; body: string; metadata: { title: string; author: string } }; templateVersion?: any; dirty: boolean; saving: boolean; savedAt?: string; conflict?: boolean; policyIssues?: any[] };
