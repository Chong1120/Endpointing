# SafeCall architecture

SafeCall turns recorded customer calls into a **safe archive**: redacted audio, a redacted and speaker-separated transcript, PII statistics, AI insights computed from the redacted text, and an audit trail. The original recording never reaches permanent storage.

## Three pieces, one job each

```mermaid
flowchart LR
  U[Browser] --> FE[Website<br/>Vercel]
  U -->|API calls + uploads| API[SafeCall API<br/>Railway · one Node.js app]
  U <-->|live call audio · single-use token| VA[AssemblyAI<br/>Voice Agent API]
  FE -. sign-in .-> SB
  API -->|token · fetch recording · delete session| VA
  API -->|upload, transcribe, redact| AAI[AssemblyAI]
  AAI -->|webhook when done| API
  API -->|redacted transcript only| LLM[AssemblyAI LLM Gateway]
  API --> SB[(Supabase<br/>Postgres · Auth · Storage)]
```

| Piece | Hosted on | Responsibility |
| --- | --- | --- |
| **Website** (`frontend/`) | Vercel | Sign-in, the live agent call, upload, live processing view, safe archive, search, analytics, policies, audit. It talks to the API, and during a live call to AssemblyAI's Voice Agent WebSocket; never to tables or storage directly. |
| **API** (`backend/`) | Railway | The only server. Checks sign-ins and scopes everything to the caller's organization. Receives uploads, calls AssemblyAI, receives the webhook, runs the background pipeline, issues signed audio URLs, and serves search, analytics and export. |
| **Database, logins, storage** (`database/migrations/`) | Supabase | Postgres tables (`organizations`, `users`, `calls`, `call_utterances`, `audit_logs`, `pii_policy_settings`), full-text search over safe data, Supabase Auth, and the private `safe-call-audio` bucket. RLS is enabled with no anon/auth policies. |

**Why the API isn't on Vercel too.** Call recordings exceed the 4.5 MB request limit of Vercel functions, and a call keeps processing for minutes after the upload (waiting on AssemblyAI, fetching redacted audio, calling the LLM). Railway runs an ordinary always-on Node server, which suits both.

## Background work without a queue service

AssemblyAI expects its webhook to be answered within 10 seconds, so the webhook handler only authenticates the request, schedules the work and returns 200. The work runs in the same Node process (`backend/src/queue/backgroundQueue.ts`):

- **Duplicates.** A duplicate webhook for a call that is already running is ignored, and a finished call is never processed twice (the database status is checked before starting).
- **Retries.** Transient failures (network, 429 rate limits, 5xx, redacted audio not ready yet, invalid LLM JSON) retry with exponential backoff starting at 10 s, about 5 minutes in total. After that the call is marked `FAILED`, and **Retry** in the UI resumes it from the failed stage.
- **Restarts.** The database is the source of truth. Every pipeline stage is idempotent, and a sweep that runs at start-up and every 2 minutes (`sweepCalls`) handles two cases. Calls left mid-pipeline by a deploy or crash are resumed. Calls waiting on AssemblyAI longer than usual get a status check, which catches missed webhooks.
- **Local development.** Without a public HTTPS URL, submissions omit `webhook_url` and the API checks the transcript status on a timer instead.

This design assumes **one API instance**. To scale horizontally, reintroduce a shared queue (for example Redis + BullMQ) behind the same `JobQueue` interface.

## Live agent (Voice Agent API)

The **Live agent** page lets anyone in the organization call "Sam", a billing agent for the fictional Northwind Mobile, built on AssemblyAI's Voice Agent API. The conversation is live and two-way; SafeCall only acts before and after it.

```mermaid
sequenceDiagram
  autonumber
  participant B as Browser
  participant A as API (Railway)
  participant V as AssemblyAI Voice Agent API
  participant X as AssemblyAI speech-to-text
  B->>A: POST /api/voice-agent/session
  A->>V: GET /v1/token (the API key stays on the server)
  A-->>B: single-use token + agent config (prompt, voice, tools, org reference)
  B->>V: WebSocket ?token=… · session.update
  V-->>B: session.ready · reply.audio · tool.call
  B->>V: input.audio (PCM16, 24 kHz) · tool.result
  B->>V: session.end
  B->>A: POST /api/voice-agent/sessions/{id}/archive
  A->>V: GET /v1/sessions/{id} (check the org reference, wait for the recording)
  A->>X: normal intake: temp file → files.upload → delete temp file → redacted transcription
  A->>V: DELETE /v1/sessions/{id} · VOICE_SESSION_DELETED
```

- **Keys.** The browser gets a single-use token that must be redeemed within 2 minutes and caps the call at 10 minutes. The AssemblyAI API key never leaves the API.
- **No live audio or transcript through SafeCall.** Audio flows between the browser and AssemblyAI. The page shows the call state and the agent's actions only; live transcript events are ignored because they are unredacted.
- **Tools run in the browser** against mock Northwind data (`frontend/src/voice/northwindTools.ts`), so what a caller tells a tool never reaches the API.
- **Keeping the agent talking.** Two things used to leave a caller listening to silence, both found by driving a real session and logging every event. A tool result was held back whenever anything at all arrived after `reply.done` — a cough raises `input.speech.started` — so the gate is now "no reply is being generated" instead. And the prompt used to invite a filler line ("say something short like 'One moment' while it runs"), which the model took as permission to end its turn; it now has to finish the job, chaining the account lookup into the charge list before it speaks. As a backstop, if the agent owes an answer — the caller has stopped talking, or a tool result has gone out — and says nothing for seven seconds, the client sends `reply.create` to ask it to carry on, at most twice per turn. It does **not** do this when the agent has spoken since: an agent waiting on an answer to its own question, prodded, will invent the caller's reply and act on it.
- **Handover to a person.** The `transfer_to_human` tool takes a reason and nothing else — no free text — so nothing the caller said can ride along. The browser passes the reason to the archive request, which records `FOLLOW_UP_REQUESTED`. The Escalations queue is derived from the audit trail: a call is open while it has a `FOLLOW_UP_REQUESTED` with no matching `FOLLOW_UP_RESOLVED`, so the handover needs no extra table and no extra state.
- **Ownership without state.** The system prompt carries an HMAC of the organization id, keyed with the webhook secret. When archiving, the API reads the prompt back from AssemblyAI and checks it, so an organization can only archive its own calls, even across restarts.
- **Same pipeline as uploads.** The stereo OGG recording (caller on the left, agent on the right) is archived like any upload: department `AI Voice Agent`, Contact Center policy, AI analysis on. Nothing in the live path bypasses redaction.
- **AssemblyAI's copy is deleted.** The voice session holds an unredacted recording and conversation timeline, so it is deleted as soon as the transcription job has the audio. If the caller closes the tab mid-call, the page still sends the archive request with `fetch(…, { keepalive: true })`.
- **Browser audio.** Capture runs at the device rate and an AudioWorklet resamples to 24 kHz, because a forced 24 kHz context loses echo cancellation in Firefox and is ignored by Safari. Echo cancellation is on and browser noise suppression is off, as AssemblyAI recommends.

## Data flow and the privacy boundary

```mermaid
sequenceDiagram
  autonumber
  participant B as Browser
  participant A as API (Railway)
  participant T as Temp disk
  participant X as AssemblyAI
  participant S as Supabase (DB + private storage)
  participant L as LLM Gateway

  B->>A: POST /api/calls (multipart)
  A->>T: stream to temp file
  A->>S: insert call · CALL_RECEIVED
  A->>X: files.upload(temp file)
  A->>T: delete temp file · RAW_UPLOAD_DELETED
  A->>X: transcripts.submit(redact_pii, redact_pii_audio, speaker_labels, webhook_url)
  X-->>A: POST /webhooks/assemblyai {transcript_id, status}
  A-->>X: 200 OK (work continues in the background)
  A->>X: GET transcript (redacted text + utterances)
  A->>S: store redacted transcript, utterances, PII counts
  A->>X: GET redacted-audio → download
  A->>S: upload redacted audio (private bucket)
  A->>L: analyze REDACTED transcript (JSON schema)
  A->>S: store AI analysis
  A->>X: DELETE transcript
  A->>S: COMPLETED · ARCHIVE_CREATED
```

Everything left of the AssemblyAI step is transient. After it, only redacted artifacts exist:

| Artifact | Where | Contains PII? |
| --- | --- | --- |
| Raw upload | OS temp dir on the API host, deleted right after `files.upload` (plus a periodic purge of stale files) | Yes — transient only |
| AssemblyAI transcript | AssemblyAI, deleted after archiving (`ASSEMBLYAI_DELETE_AFTER_ARCHIVE`) | Redacted text only (`redact_pii_return_unredacted` is never requested) |
| Redacted audio | Supabase Storage, private bucket | PII replaced with silence |
| Redacted transcript + utterances | Postgres | Entity labels such as `[PHONE_NUMBER]` |
| PII statistics | Postgres (`pii_counts`, `pii_types`, `pii_total`) | Types and counts only |
| AI analysis | Postgres (`ai_summary`) | Generated from redacted text |
| Audit trail | Postgres (`audit_logs`) | IDs, stages, counts — metadata is sanitized |

### Safeguards in code

- **Request builder** (`services/assemblyai/transcription.ts`): `redact_pii: true`, `redact_pii_sub: "entity_name"`, `redact_pii_audio: true` with `override_audio_redaction_method: "silence"`, and never `redact_pii_return_unredacted`.
- **Response guard** (`toSafeTranscript`): refuses transcripts where `redact_pii !== true` and copies only safe fields (never `unredacted_*`).
- **Type-level LLM guard**: `AnalysisService.analyze()` accepts only the branded `SafeText` type, which can only be built from a verified redacted transcript or the safe archive.
- **Logs**: pino redaction paths for text, transcript, URL and credential fields; errors are summarized (name/status/message) without payloads.
- **Access**: the Supabase secret key lives only on the API; every query is scoped to the caller's organization; RLS denies the browser roles; playback uses 5-minute signed URLs and each issuance is audited.

## Pipeline stages and idempotency

`processCall` (in `backend/src/pipeline/processCall.ts`) is resumable. Each stage checks whether its output already exists, and each audit event is written once per call:

1. **Transcription + speaker separation.** Language, duration, model, speaker count.
2. **PII.** Count markers, then store the redacted transcript and utterances.
3. **Audio.** Wait for the redacted audio, download it, then upload it to private storage.
4. **AI analysis.** Built from the archived redacted utterances.
5. **Cleanup and finalize.** Delete the transcript at AssemblyAI (best effort), then mark `COMPLETED`.

## PII counting

`redact_pii_sub: "entity_name"` replaces detected values with labels. AssemblyAI redacts **word by word**, so one address can arrive as `[LOCATION_ADDRESS] [LOCATION_ADDRESS], [LOCATION_ADDRESS]`. SafeCall counts a run of same-type markers separated only by spaces, commas or dashes as one entity (`countPiiMarkers`), and the UI renders the run as a single redaction bar.

## LLM analysis

LLM Gateway `POST /v1/chat/completions`, authenticated with the raw API key. The system prompt requires analyzing only the redacted transcript, never reconstructing redacted information, and never inventing facts.

- Models that support `response_format` get a strict JSON Schema.
- Models that don't (for example `qwen3.5-4b-32k-fast` and `claude-opus-5`) get the same schema in the prompt.
- `temperature` is only sent to models that accept it.

`LLM_RESPONSE_FORMAT=auto` checks `GET /v1/models`. Output is repaired server-side (`json-repair`) and validated with zod.

Model choice: `LLM_MODEL` (default `claude-opus-5`) is tried first. If the gateway refuses it for this account (a 4xx such as "does not have access to this LLM Gateway model"), `LLM_FALLBACK_MODEL` (default `qwen3.5-4b-32k-fast`) answers and `LLM_MODEL` is tried again an hour later. The gateway's own `fallbacks` parameter is still sent, but it only covers failures of a model the account can use.

## Search

`calls.search_vector` is a stored generated `tsvector` over the AI analysis, redacted transcript, department and filename, with a GIN index. `search_calls()` adds org-scoped filters and `ts_headline` snippets and is callable only by the service role.

## Roles and workspaces

`ensure_user_profile()` gives every new sign-in its own organization, with the person as admin. Teams form by invitation: an admin's code is `HMAC(webhook secret, org id)` plus an expiry, so it verifies without a table — nothing to store, nothing to leak, and rotating the secret revokes every outstanding code. Redeeming one moves the user row into that organization as a support agent; the calls they already uploaded stay behind in their old workspace, which is reported back so the UI can say so.

Permissions live in one table (`backend/src/domain/permissions.ts`) and are applied by `requirePermission()` on each route. `/api/me` returns the caller's permission list, and the UI uses exactly that list to decide what to show, so the screens can never offer something the API will refuse. Profiles are cached for a minute in `ProfileCache`; joining a workspace or changing a role drops the affected entry, so the change applies on the very next request instead of a minute later.
