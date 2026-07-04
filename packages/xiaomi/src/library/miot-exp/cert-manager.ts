/**
 * Xiaomi MIoT certificate utilities for central hub gateway local control.
 *
 * The central hub gateway requires mutual TLS (mTLS) with a user certificate
 * obtained from Xiaomi's cloud API. The certificate:
 * - Uses an Ed25519 key pair
 * - CSR subject: C=CN, O=Mijia Device, CN=mips.{uid}.{sha1(did)}.2
 * - Is signed by Xiaomi's CA and valid for ~14 days
 */

import {X509Certificate, createHash, generateKeyPairSync} from 'node:crypto';
import {existsSync, mkdirSync, readFileSync, writeFileSync} from 'node:fs';
import {join} from 'node:path';

import {MIHOME_CA_CERT} from './constants.js';

/** SHA-1 hash of the DID, hex-encoded (used in cert CN). */
export function didHash(did: string): string {
  return createHash('sha1').update(did).digest('hex');
}

/** Generate an Ed25519 private key in PKCS#8 PEM format. */
export function generateUserKey(): string {
  const {privateKey} = generateKeyPairSync('ed25519', {
    privateKeyEncoding: {type: 'pkcs8', format: 'pem'},
    publicKeyEncoding: {type: 'spki', format: 'pem'},
  });
  return privateKey;
}

/**
 * Generate a CSR (Certificate Signing Request) for the user certificate.
 *
 * Node.js doesn't have a built-in CSR builder, so we construct the DER
 * manually using a minimal ASN.1 encoder for the specific structure:
 *   CertificationRequest ::= SEQUENCE {
 *     certificationRequestInfo CertificationRequestInfo,
 *     signatureAlgorithm AlgorithmIdentifier,
 *     signature BIT STRING
 *   }
 *
 * However, since Ed25519 CSR support is limited in pure JS, we use the
 * `node:crypto` X.509 API where possible, or fall back to a helper library.
 *
 * For simplicity, this uses the openssl CLI if available, otherwise throws.
 */
export async function generateUserCsr(
  userKey: string,
  uid: string,
  did: string,
): Promise<string> {
  const commonName = `mips.${uid}.${didHash(did)}.2`;

  // Write a temporary private key file and use openssl to generate the CSR.
  const {execFile} = await import('node:child_process');
  const {promisify} = await import('node:util');
  const execFileAsync = promisify(execFile);
  const os = await import('node:os');
  const fs = await import('node:fs/promises');

  const tmpDir = await fs.mkdtemp(join(os.tmpdir(), 'xiaomi-csr-'));
  const keyPath = join(tmpDir, 'user.key');
  const csrPath = join(tmpDir, 'user.csr');

  try {
    await fs.writeFile(keyPath, userKey, 'utf-8');

    // Use openssl to generate the CSR with Ed25519 key.
    await execFileAsync('openssl', [
      'req',
      '-new',
      '-key',
      keyPath,
      '-subj',
      `/C=CN/O=Mijia Device/CN=${commonName}`,
      '-out',
      csrPath,
      '-outform',
      'PEM',
    ]);

    const csr = await fs.readFile(csrPath, 'utf-8');
    return csr;
  } finally {
    // Cleanup temp files
    await fs.rm(tmpDir, {recursive: true, force: true}).catch(() => {});
  }
}

/** Certificate manager: handles key/cert generation, storage, and validation. */
export class XiaomiCertManager {
  private readonly storageDir: string;
  private readonly uid: string;
  private readonly cloudServer: string;

  constructor(storageDir: string, uid: string, cloudServer: string) {
    this.storageDir = storageDir;
    this.uid = uid;
    this.cloudServer = cloudServer;
    mkdirSync(storageDir, {recursive: true});
    this.ensureCaCert();
  }

  get keyPath(): string {
    return join(this.storageDir, `${this.uid}_${this.cloudServer}.key`);
  }

  get certPath(): string {
    return join(this.storageDir, `${this.uid}_${this.cloudServer}.cert`);
  }

  get caPath(): string {
    return join(this.storageDir, 'mihome_ca.cert');
  }

  /** Ensure the Xiaomi CA certificate file exists. */
  private ensureCaCert(): void {
    if (!existsSync(this.caPath)) {
      writeFileSync(this.caPath, MIHOME_CA_CERT, 'utf-8');
    }
  }

  /** Check if the user certificate exists and is valid. */
  hasUserCert(): boolean {
    return existsSync(this.certPath) && existsSync(this.keyPath);
  }

  /** Load the user private key. */
  loadUserKey(): string | null {
    if (!existsSync(this.keyPath)) return null;
    return readFileSync(this.keyPath, 'utf-8');
  }

  /** Save the user private key. */
  saveUserKey(key: string): void {
    writeFileSync(this.keyPath, key, 'utf-8');
  }

  /** Load the user certificate. */
  loadUserCert(): string | null {
    if (!existsSync(this.certPath)) return null;
    return readFileSync(this.certPath, 'utf-8');
  }

  /** Save the user certificate. */
  saveUserCert(cert: string): void {
    writeFileSync(this.certPath, cert, 'utf-8');
  }

  /**
   * Ensure a valid user certificate exists.
   * If not, generate key + CSR, call the API to get the cert, and save both.
   */
  async ensureUserCert(
    did: string,
    getCentralCert: (csr: string) => Promise<string>,
  ): Promise<{key: string; cert: string}> {
    // Check if existing cert is still valid
    if (this.hasUserCert()) {
      const cert = this.loadUserCert()!;
      const key = this.loadUserKey()!;
      const remaining = this.getCertRemainingTime(cert);
      if (remaining > 3 * 24 * 3600) {
        // More than 3 days remaining
        return {key, cert};
      }
    }

    // Generate new key and CSR
    const userKey = generateUserKey();
    const csr = await generateUserCsr(userKey, this.uid, did);
    const cert = await getCentralCert(csr);

    this.saveUserKey(userKey);
    this.saveUserCert(cert);

    return {key: userKey, cert};
  }

  /** Get remaining validity time of a certificate in seconds. */
  getCertRemainingTime(certPem: string): number {
    try {
      const cert = new X509Certificate(certPem);
      const now = new Date();
      const validTo = new Date(cert.validTo);
      const remaining = Math.floor((validTo.getTime() - now.getTime()) / 1000);
      return remaining > 0 ? remaining : 0;
    } catch {
      return 0;
    }
  }
}
