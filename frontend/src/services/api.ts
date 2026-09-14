import { API_URL } from '../config';
import { supabase } from './supabase';
import type {
  Analytics,
  AuditEvent,
  Call,
  CallDetail,
  CallFilters,
  CallListItem,
  Me,
  Paged,
  PoliciesResponse,
  PolicyPreset,
  Sample,
} from './types';

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code?: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

async function accessToken(): Promise<string | null> {
  const { data } = await supabase.auth.getSession();
  return data.session?.access_token ?? null;
}

function toQuery(params: object = {}): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== '') search.set(key, String(value));
  }
  const text = search.toString();
  return text ? `?${text}` : '';
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const token = await accessToken();
  const headers: Record<string, string> = { ...(init.headers as Record<string, string>) };
  if (token) headers.Authorization = `Bearer ${token}`;
  if (init.body && !(init.body instanceof FormData)) headers['Content-Type'] = 'application/json';

  let response: Response;
  try {
    response = await fetch(`${API_URL}${path}`, { ...init, headers });
  } catch {
    throw new ApiError('Cannot reach the SafeCall API. Check that it is running and try again.', 0, 'NETWORK');
  }
  if (response.status === 204) return undefined as T;
  const body = await response.json().catch(() => null);
  if (!response.ok) {
    throw new ApiError(body?.error?.message ?? `Request failed (${response.status}).`, response.status, body?.error?.code);
  }
  return body as T;
}

export interface UploadInput {
  file: File;
  department: string;
  policyPreset: PolicyPreset;
  analysisEnabled: boolean;
}

/** XHR so the UI can show real upload progress (bytes sent), not a fake percentage. */
async function uploadCall(input: UploadInput, onProgress?: (fraction: number) => void): Promise<{ call: Call }> {
  const token = await accessToken();
  const form = new FormData();
  form.set('department', input.department);
  form.set('policy_preset', input.policyPreset);
  form.set('analysis_enabled', String(input.analysisEnabled));
  form.set('file', input.file);

  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', `${API_URL}/api/calls`);
    if (token) xhr.setRequestHeader('Authorization', `Bearer ${token}`);
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable && onProgress) onProgress(event.loaded / event.total);
    };
    xhr.onload = () => {
      let body: { call?: Call; error?: { message?: string; code?: string } } | null = null;
      try {
        body = JSON.parse(xhr.responseText);
      } catch {
        body = null;
      }
      if (xhr.status >= 200 && xhr.status < 300 && body?.call) resolve({ call: body.call });
      else reject(new ApiError(body?.error?.message ?? `Upload failed (${xhr.status}).`, xhr.status, body?.error?.code));
    };
    xhr.onerror = () => reject(new ApiError('Upload failed — the SafeCall API could not be reached.', 0, 'NETWORK'));
    xhr.send(form);
  });
}

async function exportDataset(format: 'jsonl' | 'csv', filters: CallFilters): Promise<{ blob: Blob; filename: string }> {
  const token = await accessToken();
  const { department, sentiment, pii_type, from, to } = filters;
  const response = await fetch(`${API_URL}/api/export${toQuery({ format, department, sentiment, pii_type, from, to })}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  if (!response.ok) {
    const body = await response.json().catch(() => null);
    throw new ApiError(body?.error?.message ?? 'Export failed.', response.status);
  }
  const disposition = response.headers.get('content-disposition') ?? '';
  const filename = /filename="([^"]+)"/.exec(disposition)?.[1] ?? `safecall-safe-dataset.${format}`;
  return { blob: await response.blob(), filename };
}

export const api = {
  me: () => request<Me>('/api/me'),
  listCalls: (filters: CallFilters = {}) => request<Paged<CallListItem>>(`/api/calls${toQuery(filters)}`),
  search: (filters: CallFilters = {}) => request<Paged<CallListItem>>(`/api/search${toQuery(filters)}`),
  getCall: (id: string) => request<CallDetail>(`/api/calls/${id}`),
  audioUrl: (id: string) => request<{ url: string; expires_in: number; format: string }>(`/api/calls/${id}/audio-url`),
  retry: (id: string) => request<{ call: Call }>(`/api/calls/${id}/retry`, { method: 'POST' }),
  deleteCall: (id: string) => request<void>(`/api/calls/${id}`, { method: 'DELETE' }),
  analytics: () => request<Analytics>('/api/analytics'),
  audit: (params: { call_id?: string; event_type?: string; page?: number; page_size?: number } = {}) =>
    request<Paged<AuditEvent>>(`/api/audit${toQuery(params)}`),
  policies: () => request<PoliciesResponse>('/api/policies'),
  savePolicy: (preset: PolicyPreset, policies: string[]) =>
    request<{ preset: PolicyPreset; policies: string[]; customized: boolean }>(`/api/policies/${preset}`, {
      method: 'PUT',
      body: JSON.stringify({ policies }),
    }),
  resetPolicy: (preset: PolicyPreset) =>
    request<{ preset: PolicyPreset; policies: string[]; customized: boolean }>(`/api/policies/${preset}`, { method: 'DELETE' }),
  samples: () => request<{ notice: string; samples: Sample[] }>('/api/demo/samples'),
  runSample: (id: string, analysisEnabled = true) =>
    request<{ call: Call }>(`/api/demo/samples/${id}`, {
      method: 'POST',
      body: JSON.stringify({ analysis_enabled: analysisEnabled }),
    }),
  uploadCall,
  exportDataset,
};

/** Triggers a browser download for a blob produced by the API. */
export function saveBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1_000);
}
