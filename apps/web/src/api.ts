import { reactive } from 'vue';
import type { UserView } from '@problemforge/contracts';
export const session = reactive({ user: null as UserView | null, csrfToken: '', appName: 'ProblemForge', ready: false, expired: false });
export class ApiError extends Error { constructor(message: string, public status: number, public code: string, public details?: unknown) { super(message); } }
const pendingBuilds=new Map<string,string>();
export async function api<T = any>(path: string, options: RequestInit = {}): Promise<T> {
  let submission:string|undefined;
  if(options.method==='POST'&&path.endsWith('/builds')&&typeof options.body==='string'){
    const body=JSON.parse(options.body);if(!body.requestKey){submission=path+options.body;const key=pendingBuilds.get(submission)??crypto.randomUUID();pendingBuilds.set(submission,key);options={...options,body:JSON.stringify({...body,requestKey:key})};}
  }
  const response = await fetch(`/api${path}`, { ...options, credentials: 'same-origin', headers: { ...(options.body ? { 'Content-Type': 'application/json' } : {}), ...(session.csrfToken ? { 'X-CSRF-Token': session.csrfToken } : {}), ...options.headers } });
  if(submission&&response.status<500)pendingBuilds.delete(submission);
  if (!response.ok) { const error = await response.json(); if (response.status === 401) session.expired = true; throw new ApiError(error.message, response.status, error.code, error.details); }
  if (path === '/auth/login' || path === '/auth/me') session.expired = false;
  return response.json();
}
export async function loadSession() {
  try { Object.assign(session, await api('/auth/me')); } catch {} finally { session.ready = true; }
}
export function bytesBase64(bytes: Uint8Array) {
  let binary = ''; for (let i = 0; i < bytes.length; i += 8192) binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
  return btoa(binary);
}
export async function binaryFile(path: string): Promise<string> {
  const response = await fetch(`/api${path}`, { credentials: 'same-origin' });
  if (!response.ok) { const e = await response.json(); throw new ApiError(e.message, response.status, e.code); }
  return bytesBase64(new Uint8Array(await response.arrayBuffer()));
}
export type Artifact = { id: string; hash: string; bytes: number };
export type Build = { id: string; kind: string; state: string; log: string; errorCode?: string; stale: boolean; artifacts: Artifact[]; documentId?: string; purpose: string; input: Record<string, any>; createdAt: string; diagnostics?: any[]; cacheSourceId?:string|null };
export type Draft = { id: string; kind: 'STATEMENT' | 'EDITORIAL_DOCUMENT' | 'EDITORIAL_BEAMER'; language: string; version: number; enabled: boolean; templateVersionId: string | null; currentRevision: { id: string; body: string; metadata: { title: string; author: string }; sampleRevisionIds?: string[] }; templateVersion?: any; dirty: boolean; saving: boolean; savedAt?: string; saveError?: string; conflict?: boolean; policyIssues?: any[] };
