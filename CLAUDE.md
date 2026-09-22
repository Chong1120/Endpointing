# SafeCall — notes for coding agents

Before writing AssemblyAI code, read https://www.assemblyai.com/docs/agent-instructions.md
and https://www.assemblyai.com/docs/llms.txt. The API has changed — do not rely on
memorized parameter names. (Docs MCP: `claude mcp add assemblyai-docs --transport http https://assemblyai.com/docs/mcp`)

## Non-negotiable privacy rules
- Never request `redact_pii_return_unredacted`, and never persist, log or display unredacted transcript/audio.
- Only redacted text may reach an LLM. `LlmGatewayAnalysisService.analyze()` takes the branded `SafeText` type — keep it that way.
- Raw uploads live only in the OS temp dir and are deleted right after `files.upload` (see `backend/src/pipeline/intake.ts`).
- Audit metadata carries IDs/counts only (`sanitizeAuditMetadata`). The storage bucket is private; playback is via short-lived signed URLs.
- Don't claim automated redaction makes anyone HIPAA/PCI compliant.
- Live agent: the browser talks to AssemblyAI's Voice Agent API directly with a single-use token from `POST /api/voice-agent/session`. The API never relays live audio, and the UI never shows live transcripts (they are unredacted). After hang-up, `archiveVoiceSession` runs the recording through intake and deletes the AssemblyAI session.
- Escalations carry a reason from a fixed list and nothing else — no free text from the agent or the caller. The queue is derived from `FOLLOW_UP_REQUESTED` / `FOLLOW_UP_RESOLVED` audit events.
- A customer may only ever see calls they created. `calls:read:all` is the staff permission; without it, list queries filter on `created_by` and single-call routes return 404, never 403.
- Demo passwords are derived from the webhook secret and used server-side only. Never ship a demo credential to the browser or the repo.

## Architecture
Three hosted pieces only: website on Vercel, one API app on Railway, Supabase (Postgres + Auth + Storage). No Redis, no separate worker, no Docker.
Background work runs inside the API process (`backend/src/queue/backgroundQueue.ts`); the database is the source of truth and `sweepCalls` resumes interrupted calls, so run a single API instance.

## Layout
- `backend/src/pipeline/` — intake (upload → AssemblyAI), `processCall` (webhook-triggered, idempotent, resumable stages) and `redactionRecheck` (second pass over an archived call, using `redact_static_entities`)
- `backend/src/services/assemblyai/` — request builder, safe-transcript conversion, verified PII policy names
- `backend/src/routes/` — REST API + `/webhooks/assemblyai`
- `backend/src/domain/permissions.ts` — role → permission table; routes guard with `requirePermission()` and `/api/me` returns the list the UI hides by
- `database/migrations/` — schema (applied with `npm run db:migrate`)
- `frontend/src/` — React + MUI: `layouts/AppLayout` is the staff console, `layouts/CustomerLayout` is the customer's own page; `App.tsx` picks one by role

## Commands
- `npm test` (both suites: API with AssemblyAI mocked, plus the browser voice client) · `npm run typecheck` · `npm run dev` (API + website)
- `npm run db:migrate` needs `DATABASE_URL`; migrations 0002 and 0003 add the support-agent and customer roles, and must be applied before roles can be saved.
