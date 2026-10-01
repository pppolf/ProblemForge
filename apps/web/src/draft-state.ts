import { shallowRef } from 'vue';
export const draftExport = shallowRef<{ name: string; json: string } | null>(null);
export function snapshot<T>(value: T): T { return value === undefined ? value : JSON.parse(JSON.stringify(value)); }
export function draftSignature(value: unknown) { return JSON.stringify(value, (_key,v) => v && typeof v === 'object' && !Array.isArray(v) ? Object.fromEntries(Object.keys(v).sort().map(key=>[key,v[key]])) : v); }

// Three-way reconciliation: accept server normalization/base-version changes,
// retaining any field the user edited after this request was submitted.
export function mergeSaved<T>(current: T, submitted: T, saved: T): T {
  if (draftSignature(current) === draftSignature(submitted)) return snapshot(saved);
  const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
  if (object(current) && object(submitted) && object(saved)) {
    const result: Record<string, unknown> = {};
    for (const key of new Set([...Object.keys(current), ...Object.keys(saved)])) {
      if (Object.hasOwn(submitted,key) && !Object.hasOwn(current,key)) continue;
      const merged = mergeSaved(current[key], submitted[key], saved[key]);
      if (merged !== undefined) result[key] = merged;
    }
    return result as T;
  }
  return snapshot(current);
}
export function downloadDraft(name: string, data: unknown) {
  draftExport.value = { name: name.replace(/[^\p{L}\p{N}._-]/gu, '_')+'.json', json: JSON.stringify({ format: 'problemforge-local-draft/v1', exportedAt: new Date().toISOString(), data }, null, 2) };
}
