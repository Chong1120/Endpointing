import type { AuditRepository, PolicyRepository, UserRepository } from '../db/types.js';
import type { AuthVerifier } from '../middleware/auth.js';
import type { PipelineDeps } from '../pipeline/deps.js';
import type { VoiceAgentService } from '../services/assemblyai/voiceAgent.js';
import type { SampleCatalog } from '../services/samples.js';

export interface AppDeps extends PipelineDeps {
  users: UserRepository;
  auditEvents: AuditRepository;
  policies: PolicyRepository;
  authVerifier: AuthVerifier;
  samples: SampleCatalog;
  voiceAgent: VoiceAgentService;
}
