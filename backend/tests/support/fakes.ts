import { randomUUID } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import { pino } from 'pino';
import type { AppConfig } from '../../src/config.js';
import type {
  AnalyticsRow,
  AuditListItem,
  AuditRepository,
  CallFilters,
  CallListItem,
  CallPatch,
  CallRepository,
  NewAuditEvent,
  NewCall,
  PolicyRepository,
  SearchResultItem,
  UserProfile,
  UserRepository,
} from '../../src/db/types.js';
import type { AuditEvent, CallAnalysis, CallRecord, PolicyPreset, SafeText, UserRole, Utterance } from '../../src/domain/types.js';
import type { AppDeps } from '../../src/http/appDeps.js';
import type { AuthVerifier, VerifiedIdentity } from '../../src/middleware/auth.js';
import type { JobQueue, PollTranscriptJob, ProcessCallJob } from '../../src/queue/jobs.js';
import type {
  RedactedAudioResult,
  SubmitRequest,
  TranscriptionService,
  TranscriptResult,
} from '../../src/services/assemblyai/transcription.js';
import type { VoiceAgentService, VoiceSession } from '../../src/services/assemblyai/voiceAgent.js';
import type { DemoAccountService } from '../../src/services/demoAccounts.js';
import { RepositoryAuditLogger } from '../../src/services/audit.js';
import type { AnalysisResult, AnalysisService } from '../../src/services/llm/analysis.js';
import { FileSampleCatalog } from '../../src/services/samples.js';
import type { SafeAudioStorage } from '../../src/services/storage/safeAudioStorage.js';

export const silentLogger = pino({ level: 'silent' });

export function testConfig(overrides: Partial<AppConfig> = {}): AppConfig {
  return {
    env: 'test',
    port: 0,
    logLevel: 'silent',
    assemblyai: {
      apiKey: 'test-assemblyai-key',
      webhookSecret: 'test-webhook-secret-0123456789',
      baseUrl: 'https://api.assemblyai.com',
      deleteAfterArchive: true,
      redactedAudioFormat: 'mp3',
    },
    llm: { gatewayUrl: 'https://llm.test/v1/chat/completions', model: 'claude-sonnet-4-6', fallbackModel: null, responseFormat: 'json_schema' },
    supabase: { url: 'http://supabase.test', serviceRoleKey: 'service-role', audioBucket: 'safe-call-audio' },
    publicApiUrl: 'https://api.safecall.test',
    webhooksEnabled: true,
    corsOrigins: ['http://localhost:5173'],
    maxUploadBytes: 5 * 1024 * 1024,
    signedUrlTtlSeconds: 300,
    uploadTmpDir: '',
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Repositories
// ---------------------------------------------------------------------------

export class InMemoryCallRepository implements CallRepository {
  readonly calls = new Map<string, CallRecord>();
  readonly utterances = new Map<string, Utterance[]>();
  private nextNumber = 1001;

  async create(input: NewCall): Promise<CallRecord> {
    const now = new Date().toISOString();
    const call: CallRecord = {
      id: randomUUID(),
      call_number: this.nextNumber++,
      ...input,
      status: 'UPLOADING',
      failed_stage: null,
      error_message: null,
      detected_language: null,
      duration_seconds: null,
      speakers_count: null,
      speech_model_used: null,
      assemblyai_transcript_id: null,
      safe_audio_path: null,
      safe_audio_format: null,
      redacted_transcript: null,
      pii_counts: {},
      pii_total: 0,
      pii_types: [],
      ai_summary: null,
      sentiment: null,
      topics: [],
      created_at: now,
      submitted_at: null,
      transcription_completed_at: null,
      processed_at: null,
      original_deleted_at: null,
      updated_at: now,
    };
    this.calls.set(call.id, call);
    return structuredClone(call);
  }

  async findById(orgId: string, id: string) {
    const call = this.calls.get(id);
    return call && call.organization_id === orgId ? structuredClone(call) : null;
  }

  async findByIdForSystem(id: string) {
    const call = this.calls.get(id);
    return call ? structuredClone(call) : null;
  }

  async findByTranscriptId(transcriptId: string) {
    const call = [...this.calls.values()].find((c) => c.assemblyai_transcript_id === transcriptId);
    return call ? structuredClone(call) : null;
  }

  private filtered(orgId: string, filters: Partial<CallFilters>): CallRecord[] {
    return [...this.calls.values()]
      .filter((c) => c.organization_id === orgId)
      .filter((c) => !filters.createdBy || c.created_by === filters.createdBy)
      .filter((c) => !filters.status || c.status === filters.status)
      .filter((c) => !filters.department || c.department === filters.department)
      .filter((c) => !filters.sentiment || c.sentiment === filters.sentiment)
      .filter((c) => !filters.piiType || c.pii_types.includes(filters.piiType))
      .sort((a, b) => b.created_at.localeCompare(a.created_at));
  }

  private toListItem(c: CallRecord): CallListItem {
    return {
      id: c.id,
      call_number: c.call_number,
      original_filename: c.original_filename,
      department: c.department,
      status: c.status,
      sentiment: c.sentiment,
      topics: c.topics,
      pii_total: c.pii_total,
      pii_types: c.pii_types,
      duration_seconds: c.duration_seconds,
      created_at: c.created_at,
      processed_at: c.processed_at,
      error_message: c.error_message,
      source: c.source,
      summary: c.ai_summary?.summary ?? null,
    };
  }

  async list(orgId: string, filters: CallFilters) {
    const rows = this.filtered(orgId, filters);
    return { items: rows.slice(filters.offset, filters.offset + filters.limit).map((c) => this.toListItem(c)), total: rows.length };
  }

  async search(orgId: string, query: string, filters: CallFilters) {
    const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
    const rows = this.filtered(orgId, filters).filter((c) => {
      const haystack = `${c.redacted_transcript ?? ''} ${c.ai_summary?.summary ?? ''} ${c.topics.join(' ')}`.toLowerCase();
      return terms.every((term) => haystack.includes(term));
    });
    const items: SearchResultItem[] = rows.map((c) => ({ ...this.toListItem(c), snippet: c.redacted_transcript?.slice(0, 80) ?? '', rank: 1 }));
    return { items: items.slice(filters.offset, filters.offset + filters.limit), total: items.length };
  }

  async update(id: string, patch: CallPatch) {
    const call = this.calls.get(id);
    if (!call) throw new Error(`call ${id} not found`);
    const updated = { ...call, ...structuredClone(patch), updated_at: new Date().toISOString() } as CallRecord;
    this.calls.set(id, updated);
    return structuredClone(updated);
  }

  async claimForProcessing(id: string, transcriptId: string) {
    const call = this.calls.get(id);
    if (!call || call.assemblyai_transcript_id !== transcriptId) return null;
    if (call.status !== 'TRANSCRIBING' && call.status !== 'PROCESSING') return null;
    return this.update(id, { status: 'PROCESSING', failed_stage: null, error_message: null });
  }

  async replaceUtterances(callId: string, utterances: Utterance[]) {
    this.utterances.set(callId, structuredClone(utterances));
  }

  async listUtterances(callId: string) {
    return structuredClone(this.utterances.get(callId) ?? []);
  }

  async listUtterancesForCalls(callIds: string[]) {
    return new Map(callIds.map((id) => [id, structuredClone(this.utterances.get(id) ?? [])]));
  }

  async listForAnalytics(orgId: string): Promise<AnalyticsRow[]> {
    return this.filtered(orgId, {});
  }

  async listCompleted(orgId: string, filters: Omit<CallFilters, 'status'>) {
    return this.filtered(orgId, { ...filters, status: 'COMPLETED' }).map((c) => structuredClone(c));
  }

  async findStuckTranscribing(olderThanIso: string, limit: number) {
    return [...this.calls.values()]
      .filter((c) => c.status === 'TRANSCRIBING' && c.submitted_at !== null && c.submitted_at < olderThanIso)
      .slice(0, limit);
  }

  async findByStatus(status: CallRecord['status'], limit: number) {
    return [...this.calls.values()].filter((c) => c.status === status).slice(0, limit);
  }

  async delete(id: string) {
    this.calls.delete(id);
    this.utterances.delete(id);
  }
}

export class InMemoryAuditRepository implements AuditRepository {
  readonly events: AuditEvent[] = [];
  private nextId = 1;

  async insert(event: NewAuditEvent) {
    this.events.push({ ...event, id: this.nextId++, created_at: new Date(Date.now() + this.nextId).toISOString() });
  }

  async listForCall(orgId: string, callId: string) {
    return this.events.filter((e) => e.organization_id === orgId && e.call_id === callId);
  }

  async listForOrg(orgId: string, filters: { callId?: string; eventType?: string; limit: number; offset: number }) {
    const rows = this.events
      .filter((e) => e.organization_id === orgId)
      .filter((e) => !filters.callId || e.call_id === filters.callId)
      .filter((e) => !filters.eventType || e.event_type === filters.eventType)
      .reverse();
    const items: AuditListItem[] = rows.slice(filters.offset, filters.offset + filters.limit).map((e) => ({ ...e, call_number: null }));
    return { items, total: rows.length };
  }

  typesFor(callId: string) {
    return this.events.filter((e) => e.call_id === callId).map((e) => e.event_type);
  }
}

export class InMemoryUserRepository implements UserRepository {
  readonly profiles = new Map<string, UserProfile>();
  readonly organizations = new Map<string, string>();

  async ensureProfile(userId: string, email: string, orgName: string) {
    let profile = this.profiles.get(userId);
    if (!profile) {
      profile = { userId, email, orgId: randomUUID(), orgName, role: 'admin' };
      this.profiles.set(userId, profile);
    }
    return profile;
  }

  async listForOrg(orgId: string) {
    return [...this.profiles.values()].filter((profile) => profile.orgId === orgId);
  }

  async setRole(orgId: string, userId: string, role: UserRole) {
    const profile = this.profiles.get(userId);
    if (!profile || profile.orgId !== orgId) return null;
    const updated = { ...profile, role };
    this.profiles.set(userId, updated);
    return updated;
  }

  async moveToOrganization(userId: string, orgId: string, role: UserRole) {
    const profile = this.profiles.get(userId);
    if (!profile) throw new Error('No such user.');
    const target = [...this.profiles.values()].find((other) => other.orgId === orgId);
    const updated = { ...profile, orgId, orgName: target?.orgName ?? profile.orgName, role };
    this.profiles.set(userId, updated);
    return updated;
  }

  async findOrganization(orgId: string) {
    const known = this.organizations.get(orgId);
    if (known) return { id: orgId, name: known };
    const member = [...this.profiles.values()].find((profile) => profile.orgId === orgId);
    return member ? { id: orgId, name: member.orgName } : null;
  }

  async findOrganizationByName(name: string) {
    for (const [id, orgName] of this.organizations) if (orgName === name) return { id, name };
    const member = [...this.profiles.values()].find((profile) => profile.orgName === name);
    return member ? { id: member.orgId, name } : null;
  }

  async createOrganization(name: string) {
    const id = randomUUID();
    this.organizations.set(id, name);
    return { id, name };
  }

  async upsertProfile({ userId, email, orgId, role }: { userId: string; email: string; orgId: string; role: UserRole }) {
    const profile = { userId, email, orgId, orgName: this.organizations.get(orgId) ?? 'Organization', role };
    this.profiles.set(userId, profile);
    return profile;
  }
}

export class InMemoryPolicyRepository implements PolicyRepository {
  readonly overrides = new Map<string, Partial<Record<PolicyPreset, string[]>>>();

  async listOverrides(orgId: string) {
    return { ...(this.overrides.get(orgId) ?? {}) };
  }

  async saveOverride(orgId: string, preset: PolicyPreset, policies: string[]) {
    this.overrides.set(orgId, { ...(this.overrides.get(orgId) ?? {}), [preset]: policies });
  }

  async deleteOverride(orgId: string, preset: PolicyPreset) {
    const current = { ...(this.overrides.get(orgId) ?? {}) };
    delete current[preset];
    this.overrides.set(orgId, current);
  }
}

// ---------------------------------------------------------------------------
// External services
// ---------------------------------------------------------------------------

/** Mock AssemblyAI: records every request and serves canned results. */
export class FakeTranscriptionService implements TranscriptionService {
  readonly uploadedPaths: string[] = [];
  readonly submissions: SubmitRequest[] = [];
  readonly deleted: string[] = [];
  readonly results = new Map<string, TranscriptResult>();
  redactedAudio: RedactedAudioResult = { status: 'ready', url: 'https://assemblyai.test/redacted.mp3' };
  audioBytes = Buffer.from('ID3-fake-redacted-mp3');
  uploadError: Error | null = null;
  submitError: Error | null = null;
  private counter = 0;

  async uploadFile(filePath: string) {
    if (this.uploadError) throw this.uploadError;
    this.uploadedPaths.push(filePath);
    return `https://cdn.assemblyai.test/upload/${this.uploadedPaths.length}`;
  }

  async submit(request: SubmitRequest) {
    if (this.submitError) throw this.submitError;
    this.submissions.push(request);
    this.counter += 1;
    const id = `transcript-${this.counter}`;
    if (!this.results.has(id)) this.results.set(id, { status: 'processing' });
    return { id, status: 'queued' };
  }

  async getTranscriptStatus(id: string) {
    return this.results.get(id)?.status ?? 'error';
  }

  async getTranscript(id: string): Promise<TranscriptResult> {
    return this.results.get(id) ?? { status: 'error', error: 'Transcript not found' };
  }

  async getRedactedAudio(): Promise<RedactedAudioResult> {
    return this.redactedAudio;
  }

  async downloadRedactedAudio() {
    return this.audioBytes;
  }

  async deleteTranscript(id: string) {
    this.deleted.push(id);
  }
}

export const SAMPLE_ANALYSIS: CallAnalysis = {
  summary: 'The customer updated their contact details and payment card. The agent confirmed the changes.',
  customer_issue: 'Update account details after moving.',
  resolution: 'Address, email and payment card were updated.',
  sentiment: 'positive',
  sentiment_trend: { start: 'neutral', end: 'positive' },
  topics: ['Account Update', 'Billing'],
  action_items: ['Send confirmation of updated details'],
  speaker_roles: [
    { speaker: 'A', role: 'agent' },
    { speaker: 'B', role: 'customer' },
  ],
  qa: { issue_resolved: true, agent_professionalism: 'excellent', notes: 'Clear verification steps.' },
};

export class FakeAnalysisService implements AnalysisService {
  readonly inputs: SafeText[] = [];
  error: Error | null = null;

  async analyze(transcript: SafeText): Promise<AnalysisResult> {
    this.inputs.push(transcript);
    if (this.error) throw this.error;
    return {
      analysis: SAMPLE_ANALYSIS,
      meta: { model: 'claude-sonnet-4-6', requestId: 'req_123', inputTokens: 900, outputTokens: 200, outputMode: 'json_schema' },
    };
  }
}

export class InMemoryStorage implements SafeAudioStorage {
  readonly objects = new Map<string, { data: Buffer; contentType: string }>();

  async ensureBucket() {}

  async upload(objectPath: string, data: Buffer, contentType: string) {
    this.objects.set(objectPath, { data, contentType });
  }

  async createSignedUrl(objectPath: string, expiresInSeconds: number) {
    return `https://storage.test/signed/${objectPath}?expires=${expiresInSeconds}`;
  }

  async remove(objectPaths: string[]) {
    for (const p of objectPaths) this.objects.delete(p);
  }
}

/** Mirrors BullJobQueue's dedupe semantics (one process job per call). */
export class InMemoryQueue implements JobQueue {
  readonly processJobs: ProcessCallJob[] = [];
  readonly pollJobs: Array<{ job: PollTranscriptJob; delayMs: number }> = [];
  private readonly processIds = new Set<string>();

  async enqueueProcessCall(job: ProcessCallJob) {
    if (this.processIds.has(job.callId)) return { enqueued: false };
    this.processIds.add(job.callId);
    this.processJobs.push(job);
    return { enqueued: true };
  }

  async requeueProcessCall(job: ProcessCallJob) {
    this.processIds.add(job.callId);
    this.processJobs.push(job);
  }

  async enqueuePollTranscript(job: PollTranscriptJob, delayMs: number) {
    this.pollJobs.push({ job, delayMs });
  }

  async close() {}
}

/** Demo sign-in without Supabase: the access token is the email, which the fake verifier accepts. */
export class FakeDemoAccountService implements DemoAccountService {
  readonly users = new Map<string, { id: string; password: string }>();

  constructor(private readonly verifier: FakeAuthVerifier) {}

  async ensureUser(email: string, password: string) {
    const existing = this.users.get(email);
    if (existing) {
      existing.password = password;
      return existing.id;
    }
    const identity = this.verifier.addUser(email, { email });
    this.users.set(email, { id: identity.userId, password });
    return identity.userId;
  }

  async signIn(email: string, password: string) {
    const user = this.users.get(email);
    if (!user || user.password !== password) throw new Error('bad demo credentials');
    return { userId: user.id, accessToken: email, refreshToken: `refresh-${email}`, expiresIn: 3600 };
  }
}

export class FakeAuthVerifier implements AuthVerifier {
  readonly tokens = new Map<string, VerifiedIdentity>();

  addUser(token: string, identity: Partial<VerifiedIdentity> = {}) {
    const full = { userId: randomUUID(), email: `${token}@example.com`, orgName: `${token} org`, ...identity };
    this.tokens.set(token, full);
    return full;
  }

  async verify(token: string) {
    return this.tokens.get(token) ?? null;
  }
}

/** Mock Voice Agent REST API. A session can report "active" (no recording yet) for a number of lookups. */
export class FakeVoiceAgentService implements VoiceAgentService {
  readonly tokenRequests: Array<{ expiresInSeconds: number; maxSessionSeconds: number }> = [];
  readonly sessions = new Map<string, VoiceSession>();
  readonly activeLookups = new Map<string, number>();
  readonly downloads: string[] = [];
  readonly deleted: string[] = [];
  recording = Buffer.from('OggS-fake-live-agent-recording');
  lookups = 0;

  async createToken(options: { expiresInSeconds: number; maxSessionSeconds: number }) {
    this.tokenRequests.push(options);
    return 'voice-token-single-use';
  }

  async getSession(sessionId: string): Promise<VoiceSession | null> {
    this.lookups += 1;
    const session = this.sessions.get(sessionId);
    if (!session) return null;
    const remaining = this.activeLookups.get(sessionId) ?? 0;
    if (remaining > 0) {
      this.activeLookups.set(sessionId, remaining - 1);
      return { ...session, status: 'active', recordingUrl: null };
    }
    return { ...session };
  }

  async downloadRecording(url: string, filePath: string) {
    this.downloads.push(url);
    await writeFile(filePath, this.recording);
    return this.recording.length;
  }

  async deleteSession(sessionId: string) {
    this.deleted.push(sessionId);
    this.sessions.delete(sessionId);
  }
}

export function buildTestDeps(overrides: Partial<AppConfig> = {}) {
  const calls = new InMemoryCallRepository();
  const auditEvents = new InMemoryAuditRepository();
  const users = new InMemoryUserRepository();
  const policies = new InMemoryPolicyRepository();
  const transcription = new FakeTranscriptionService();
  const analysis = new FakeAnalysisService();
  const storage = new InMemoryStorage();
  const queue = new InMemoryQueue();
  const authVerifier = new FakeAuthVerifier();
  const voiceAgent = new FakeVoiceAgentService();
  const demoAccounts = new FakeDemoAccountService(authVerifier);

  const deps: AppDeps = {
    config: testConfig(overrides),
    logger: silentLogger,
    calls,
    audit: new RepositoryAuditLogger(auditEvents, silentLogger),
    auditEvents,
    transcription,
    analysis,
    storage,
    queue,
    users,
    policies,
    authVerifier,
    samples: new FileSampleCatalog(),
    voiceAgent,
    demoAccounts,
    demoSeeding: false,
    sleep: async () => undefined,
  };
  return { deps, calls, auditEvents, users, policies, transcription, analysis, storage, queue, authVerifier, voiceAgent, demoAccounts };
}
