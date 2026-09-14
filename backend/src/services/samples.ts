import { randomUUID } from 'node:crypto';
import { copyFile, mkdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import { POLICY_PRESETS } from '../domain/types.js';

/** Bundled synthetic recordings (backend/samples). Works from both src/ and dist/. */
export const SAMPLES_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../samples');

const SampleSchema = z.object({
  id: z.string().regex(/^[a-z0-9-]+$/),
  title: z.string(),
  file: z.string().regex(/^[\w.-]+\.(wav|mp3)$/),
  department: z.string(),
  policyPreset: z.enum(POLICY_PRESETS),
  description: z.string(),
  expectedPii: z.array(z.string()),
});
const ManifestSchema = z.object({ notice: z.string(), samples: z.array(SampleSchema) });

export type SampleDefinition = z.infer<typeof SampleSchema>;

export interface SampleCatalog {
  list(): Promise<{ notice: string; samples: SampleDefinition[] }>;
  get(id: string): Promise<SampleDefinition | null>;
  /** Copies a sample into temp storage so it goes through the exact same intake path as an upload. */
  copyToTemp(sample: SampleDefinition, tempDir: string): Promise<{ path: string; sizeBytes: number }>;
}

export class FileSampleCatalog implements SampleCatalog {
  private manifest: z.infer<typeof ManifestSchema> | null = null;

  constructor(private readonly dir: string = SAMPLES_DIR) {}

  private async load() {
    if (!this.manifest) {
      const raw = JSON.parse(await readFile(path.join(this.dir, 'samples.json'), 'utf8'));
      this.manifest = ManifestSchema.parse(raw);
    }
    return this.manifest;
  }

  async list() {
    return this.load();
  }

  async get(id: string): Promise<SampleDefinition | null> {
    return (await this.load()).samples.find((sample) => sample.id === id) ?? null;
  }

  async copyToTemp(sample: SampleDefinition, tempDir: string): Promise<{ path: string; sizeBytes: number }> {
    await mkdir(tempDir, { recursive: true });
    const target = path.join(tempDir, `${randomUUID()}-${sample.file}`);
    await copyFile(path.join(this.dir, sample.file), target);
    const { size } = await stat(target);
    return { path: target, sizeBytes: size };
  }
}
