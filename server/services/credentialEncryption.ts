import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

export const MEMBER_SMTP_AAD = 'romani:member-smtp:v1';
export const EVOLUTION_TOKEN_AAD = 'romani:evolution-token:v1';

export class CredentialEncryptionError extends Error {
  readonly status: number;
  constructor(readonly code: 'encryption_not_configured' | 'credential_authentication_failed') {
    super(code === 'encryption_not_configured' ? 'Encryption is not configured.' : 'Stored credentials cannot be decrypted.');
    this.name = 'CredentialEncryptionError';
    this.status = code === 'encryption_not_configured' ? 503 : 500;
  }
}

function decodeKey(encoded: string | null): Buffer | null {
  if (!encoded || !/^[A-Za-z0-9_-]{43}$/.test(encoded)) return null;
  const key = Buffer.from(encoded, 'base64url');
  return key.length === 32 ? key : null;
}

export class CredentialEncryption {
  private constructor(private readonly key: Buffer | null) {}
  static fromEncoded(encoded: string | null): CredentialEncryption {
    return new CredentialEncryption(decodeKey(encoded));
  }
  encrypt(plaintext: string, associatedData: string): string {
    if (!this.key) throw new CredentialEncryptionError('encryption_not_configured');
    const nonce = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.key, nonce);
    cipher.setAAD(Buffer.from(associatedData, 'utf8'));
    const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    return Buffer.concat([nonce, cipher.getAuthTag(), ciphertext]).toString('base64url');
  }
  decrypt(payload: string, associatedData: string): string {
    if (!this.key) throw new CredentialEncryptionError('encryption_not_configured');
    try {
      const bytes = Buffer.from(payload, 'base64url');
      if (bytes.length < 29 || bytes.toString('base64url') !== payload) throw new Error('invalid payload');
      const decipher = createDecipheriv('aes-256-gcm', this.key, bytes.subarray(0, 12));
      decipher.setAAD(Buffer.from(associatedData, 'utf8'));
      decipher.setAuthTag(bytes.subarray(12, 28));
      return Buffer.concat([decipher.update(bytes.subarray(28)), decipher.final()]).toString('utf8');
    } catch {
      throw new CredentialEncryptionError('credential_authentication_failed');
    }
  }
}

export function createCredentialEncryption(encoded: string | null): CredentialEncryption {
  return CredentialEncryption.fromEncoded(encoded);
}
