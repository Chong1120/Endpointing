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

## Architecture
Three hosted pieces only: website on Vercel, one API app on Railway, Supabase (Postgres + Auth + Storage). No Redis, no separate worker, no Docker.
Background work runs inside the API process (`backend/src/queue/backgroundQueue.ts`); the database is the source of truth and `sweepCalls` resumes interrupted calls, so run a single API instance.

## Layout
- `backend/src/pipeline/` — intake (upload → AssemblyAI) and `processCall` (webhook-triggered, idempotent, resumable stages)
- `backend/src/services/assemblyai/` — request builder, safe-transcript conversion, verified PII policy names
- `backend/src/routes/` — REST API + `/webhooks/assemblyai`
- `database/migrations/` — schema (applied with `npm run db:migrate`)
- `frontend/src/` — React + MUI dashboard

## Commands
- `npm test` (backend, Vitest; AssemblyAI is mocked) · `npm run typecheck` · `npm run dev`
