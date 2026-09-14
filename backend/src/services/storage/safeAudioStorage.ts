import type { SupabaseClient } from '@supabase/supabase-js';

/** Private object storage for REDACTED audio only. */
export interface SafeAudioStorage {
  ensureBucket(): Promise<void>;
  upload(objectPath: string, data: Buffer, contentType: string): Promise<void>;
  /** Short-lived signed URL; the bucket itself is never public. */
  createSignedUrl(objectPath: string, expiresInSeconds: number): Promise<string>;
  remove(objectPaths: string[]): Promise<void>;
}

export const AUDIO_CONTENT_TYPES = { mp3: 'audio/mpeg', wav: 'audio/wav' } as const;

/** `org_<orgId>/YYYY/MM/<callId>.<ext>` */
export function buildSafeAudioPath(orgId: string, callId: string, createdAt: string | Date, format: 'mp3' | 'wav'): string {
  const date = new Date(createdAt);
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  return `org_${orgId}/${year}/${month}/${callId}.${format}`;
}

export class SupabaseSafeAudioStorage implements SafeAudioStorage {
  constructor(
    private readonly client: SupabaseClient,
    private readonly bucket: string,
    private readonly maxBytes: number,
  ) {}

  async ensureBucket(): Promise<void> {
    const { data, error } = await this.client.storage.getBucket(this.bucket);
    if (data) {
      if (data.public) {
        // Never serve call audio from a public bucket.
        const { error: updateError } = await this.client.storage.updateBucket(this.bucket, { public: false });
        if (updateError) throw new Error(`Storage bucket "${this.bucket}" is public and could not be made private.`);
      }
      return;
    }
    if (error && !/not found/i.test(error.message)) {
      throw new Error(`Could not read storage bucket "${this.bucket}": ${error.message}`);
    }
    const { error: createError } = await this.client.storage.createBucket(this.bucket, {
      public: false,
      fileSizeLimit: this.maxBytes,
      allowedMimeTypes: ['audio/mpeg', 'audio/wav', 'audio/x-wav'],
    });
    if (createError && !/already exists/i.test(createError.message)) {
      throw new Error(`Could not create storage bucket "${this.bucket}": ${createError.message}`);
    }
  }

  async upload(objectPath: string, data: Buffer, contentType: string): Promise<void> {
    const { error } = await this.client.storage.from(this.bucket).upload(objectPath, data, {
      contentType,
      upsert: true,
      cacheControl: 'no-store',
    });
    if (error) throw new Error(`Safe audio upload failed: ${error.message}`);
  }

  async createSignedUrl(objectPath: string, expiresInSeconds: number): Promise<string> {
    const { data, error } = await this.client.storage.from(this.bucket).createSignedUrl(objectPath, expiresInSeconds);
    if (error || !data?.signedUrl) throw new Error(`Could not sign safe audio URL: ${error?.message ?? 'no URL'}`);
    return data.signedUrl;
  }

  async remove(objectPaths: string[]): Promise<void> {
    if (objectPaths.length === 0) return;
    const { error } = await this.client.storage.from(this.bucket).remove(objectPaths);
    if (error) throw new Error(`Safe audio delete failed: ${error.message}`);
  }
}
