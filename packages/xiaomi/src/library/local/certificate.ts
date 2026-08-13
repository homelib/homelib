import {execFile} from 'node:child_process';
import {
  X509Certificate,
  createHash,
  createPrivateKey,
  createPublicKey,
  generateKeyPairSync,
} from 'node:crypto';
import {mkdtemp, readFile, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

import * as x from 'x-value';

import {writePrivateJsonFile} from '../storage.js';

const CERTIFICATE_RENEWAL_MARGIN = 3 * 24 * 60 * 60 * 1000;
const OPENSSL_TIMEOUT = 10_000;
const MIJIA_CA_CERTIFICATE_SHA256 =
  '8b7bf306be3632e08b0ead308249e5f2b2520dc921ad143872d5fcc7c68d6759';

/** Xiaomi's root and central-gateway CA certificates used by local MIPS TLS. */
export const MIJIA_CA_CERTIFICATE = [
  '-----BEGIN CERTIFICATE-----',
  'MIIBazCCAQ+gAwIBAgIEA/UKYDAMBggqhkjOPQQDAgUAMCIxEzARBgNVBAoTCk1p',
  'amlhIFJvb3QxCzAJBgNVBAYTAkNOMCAXDTE2MTEyMzAxMzk0NVoYDzIwNjYxMTEx',
  'MDEzOTQ1WjAiMRMwEQYDVQQKEwpNaWppYSBSb290MQswCQYDVQQGEwJDTjBZMBMG',
  'ByqGSM49AgEGCCqGSM49AwEHA0IABL71iwLa4//4VBqgRI+6xE23xpovqPCxtv96',
  '2VHbZij61/Ag6jmi7oZ/3Xg/3C+whglcwoUEE6KALGJ9vccV9PmjLzAtMAwGA1Ud',
  'EwQFMAMBAf8wHQYDVR0OBBYEFJa3onw5sblmM6n40QmyAGDI5sURMAwGCCqGSM49',
  'BAMCBQADSAAwRQIgchciK9h6tZmfrP8Ka6KziQ4Lv3hKfrHtAZXMHPda4IYCIQCG',
  'az93ggFcbrG9u2wixjx1HKW4DUA5NXZG0wWQTpJTbQ==',
  '-----END CERTIFICATE-----',
  '-----BEGIN CERTIFICATE-----',
  'MIIBjzCCATWgAwIBAgIBATAKBggqhkjOPQQDAjAiMRMwEQYDVQQKEwpNaWppYSBS',
  'b290MQswCQYDVQQGEwJDTjAgFw0yMjA2MDkxNDE0MThaGA8yMDcyMDUyNzE0MTQx',
  'OFowLDELMAkGA1UEBhMCQ04xHTAbBgNVBAoMFE1JT1QgQ0VOVFJBTCBHQVRFV0FZ',
  'MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAEdYrzbnp/0x/cZLZnuEDXTFf8mhj4',
  'CVpZPwgj9e9Ve5r3K7zvu8Jjj7JF1JjQYvEC6yhp1SzBgglnK4L8xQzdiqNQME4w',
  'HQYDVR0OBBYEFCf9+YBU7pXDs6K6CAQPRhlGJ+cuMB8GA1UdIwQYMBaAFJa3onw5',
  'sblmM6n40QmyAGDI5sURMAwGA1UdEwQFMAMBAf8wCgYIKoZIzj0EAwIDSAAwRQIh',
  'AKUv+c8v98vypkGMTzMwckGjjVqTef8xodsy6PhcSCq+AiA/n9mDs62hAo5zXyJy',
  'Bs1s7mqXPf1XgieoxIvs1MqyiA==',
  '-----END CERTIFICATE-----',
  '',
].join('\n');

const StoredCertificateValue = x.object({
  version: x.literal(1),
  userId: x.string,
  virtualDid: x.string,
  privateKey: x.string,
  certificate: x.string,
});

export type LocalCertificate = {
  readonly privateKey: string;
  readonly certificate: string;
  readonly caCertificate: string;
};

export type LocalCertificateManagerOptions = {
  /** Path of the private, atomically replaced JSON credential cache. */
  readonly path: string;
  /** Stable 32-character OAuth environment UUID. */
  readonly uuid: string;
  readonly userId: string;
  readonly getCertificate: (certificateRequest: string) => Promise<string>;
};

export class LocalCertificateManager {
  private readonly path: string;

  private readonly virtualDid: string;

  private readonly userId: string;

  private readonly getCertificate: (
    certificateRequest: string,
  ) => Promise<string>;

  private pendingCertificate?: Promise<LocalCertificate>;

  constructor(options: LocalCertificateManagerOptions) {
    validateMijiaCaCertificate();

    this.path = options.path;
    this.virtualDid = getVirtualDid(options.uuid);
    this.userId = validateDecimalIdentifier(options.userId, 'user id');
    this.getCertificate = options.getCertificate;
  }

  ensureCertificate(): Promise<LocalCertificate> {
    if (this.pendingCertificate === undefined) {
      const pendingCertificate = this.loadOrCreateCertificate();

      this.pendingCertificate = pendingCertificate;
      const complete = (): void => {
        if (this.pendingCertificate === pendingCertificate) {
          this.pendingCertificate = undefined;
        }
      };

      void pendingCertificate.then(complete, complete);
    }

    return this.pendingCertificate;
  }

  private async loadOrCreateCertificate(): Promise<LocalCertificate> {
    const stored = await readStoredCertificate(this.path);
    let privateKey: string;

    if (
      stored !== undefined &&
      stored.userId === this.userId &&
      stored.virtualDid === this.virtualDid &&
      isEd25519PrivateKey(stored.privateKey)
    ) {
      privateKey = stored.privateKey;

      if (
        isUsableCertificate(
          stored.certificate,
          privateKey,
          getCertificateCommonName(this.userId, this.virtualDid),
        )
      ) {
        return createLocalCertificate(privateKey, stored.certificate);
      }
    } else {
      privateKey = createEd25519PrivateKey();
    }

    const certificateRequest = await createCertificateRequest(
      privateKey,
      this.userId,
      this.virtualDid,
    );
    const certificate = await this.getCertificate(certificateRequest);
    const commonName = getCertificateCommonName(this.userId, this.virtualDid);

    if (!isUsableCertificate(certificate, privateKey, commonName)) {
      throw new Error('Cloud returned an invalid local MQTT certificate.');
    }

    await writePrivateJsonFile(this.path, {
      version: 1,
      userId: this.userId,
      virtualDid: this.virtualDid,
      privateKey,
      certificate,
    });

    return createLocalCertificate(privateKey, certificate);
  }
}

export function getVirtualDid(uuid: string): string {
  if (!/^[\da-f]{32}$/u.test(uuid)) {
    throw new TypeError('Local MQTT UUID must be 32 lowercase hex characters.');
  }

  return BigInt(`0x${uuid.slice(0, 16)}`).toString();
}

export function getCertificateCommonName(
  userId: string,
  virtualDid: string,
): string {
  const validUserId = validateDecimalIdentifier(userId, 'user id');
  const validVirtualDid = validateDecimalIdentifier(
    virtualDid,
    'virtual device id',
  );
  const didHash = createHash('sha1').update(validVirtualDid).digest('hex');

  return `mips.${validUserId}.${didHash}.2`;
}

export function isMipsGatewayCertificate(
  certificate: X509Certificate,
  gatewayDid: string,
): boolean {
  const validGatewayDid = validateDecimalIdentifier(gatewayDid, 'gateway DID');
  const didHash = createHash('sha1').update(validGatewayDid).digest('hex');
  const subject = parseCertificateSubject(certificate.subject);

  return (
    subject.get('C') === 'CN' &&
    subject.get('O') === 'Mijia Device' &&
    new RegExp(`^mips\\.\\d+\\.${didHash}\\.14$`, 'u').test(
      subject.get('CN') ?? '',
    )
  );
}

export function createEd25519PrivateKey(): string {
  const {privateKey} = generateKeyPairSync('ed25519', {
    privateKeyEncoding: {format: 'pem', type: 'pkcs8'},
    publicKeyEncoding: {format: 'pem', type: 'spki'},
  });

  return privateKey;
}

export async function createCertificateRequest(
  privateKey: string,
  userId: string,
  virtualDid: string,
): Promise<string> {
  if (!isEd25519PrivateKey(privateKey)) {
    throw new TypeError('Local MQTT private key must be Ed25519.');
  }

  const directory = await mkdtemp(join(tmpdir(), 'homelib-xiaomi-csr-'));
  const keyPath = join(directory, 'private-key.pem');
  const requestPath = join(directory, 'certificate-request.pem');

  try {
    await writeFile(keyPath, privateKey, {encoding: 'utf8', mode: 0o600});
    await executeOpenSsl([
      'req',
      '-new',
      '-key',
      keyPath,
      '-subj',
      `/C=CN/O=Mijia Device/CN=${getCertificateCommonName(userId, virtualDid)}`,
      '-out',
      requestPath,
      '-outform',
      'PEM',
    ]);

    return await readFile(requestPath, 'utf8');
  } finally {
    await rm(directory, {recursive: true, force: true});
  }
}

function createLocalCertificate(
  privateKey: string,
  certificate: string,
): LocalCertificate {
  return {
    privateKey,
    certificate,
    caCertificate: MIJIA_CA_CERTIFICATE,
  };
}

async function readStoredCertificate(
  path: string,
): Promise<x.TypeOf<typeof StoredCertificateValue> | undefined> {
  let source: string;

  try {
    source = await readFile(path, 'utf8');
  } catch (error) {
    if (isFileNotFoundError(error)) {
      return undefined;
    }

    throw error;
  }

  try {
    return StoredCertificateValue.satisfies(JSON.parse(source) as unknown);
  } catch {
    return undefined;
  }
}

function isUsableCertificate(
  certificate: string,
  privateKey: string,
  commonName: string,
): boolean {
  try {
    const parsedCertificate = new X509Certificate(certificate);
    const validFrom = Date.parse(parsedCertificate.validFrom);
    const validTo = Date.parse(parsedCertificate.validTo);
    const now = Date.now();

    if (
      parsedCertificate.subject !== `C=CN\nO=Mijia Device\nCN=${commonName}` ||
      !Number.isFinite(validFrom) ||
      !Number.isFinite(validTo) ||
      validFrom > now ||
      validTo <= now + CERTIFICATE_RENEWAL_MARGIN
    ) {
      return false;
    }

    const expectedPublicKey = createPublicKey(privateKey).export({
      format: 'der',
      type: 'spki',
    });
    const certificatePublicKey = parsedCertificate.publicKey.export({
      format: 'der',
      type: 'spki',
    });

    return expectedPublicKey.equals(certificatePublicKey);
  } catch {
    return false;
  }
}

function isEd25519PrivateKey(privateKey: string): boolean {
  try {
    return createPrivateKey(privateKey).asymmetricKeyType === 'ed25519';
  } catch {
    return false;
  }
}

function validateMijiaCaCertificate(): void {
  if (
    createHash('sha256').update(MIJIA_CA_CERTIFICATE).digest('hex') !==
    MIJIA_CA_CERTIFICATE_SHA256
  ) {
    throw new Error('Embedded Mijia CA certificate bundle failed validation.');
  }

  const certificates =
    MIJIA_CA_CERTIFICATE.match(
      /-----BEGIN CERTIFICATE-----[\s\S]+?-----END CERTIFICATE-----/gu,
    ) ?? [];

  if (certificates.length !== 2) {
    throw new Error('Embedded Mijia CA certificate bundle is invalid.');
  }

  const root = new X509Certificate(certificates[0]!);
  const gateway = new X509Certificate(certificates[1]!);

  if (
    !root.ca ||
    !gateway.ca ||
    root.subject !== 'O=Mijia Root\nC=CN' ||
    root.issuer !== root.subject ||
    gateway.subject !== 'C=CN\nO=MIOT CENTRAL GATEWAY' ||
    !root.verify(root.publicKey) ||
    !gateway.checkIssued(root) ||
    !gateway.verify(root.publicKey)
  ) {
    throw new Error('Embedded Mijia CA certificate bundle failed validation.');
  }
}

function validateDecimalIdentifier(value: string, name: string): string {
  if (!/^(?:0|[1-9]\d*)$/u.test(value)) {
    throw new TypeError(`Local MQTT ${name} must be a decimal integer.`);
  }

  return value;
}

function parseCertificateSubject(subject: string): ReadonlyMap<string, string> {
  return new Map(
    subject.split('\n').flatMap(component => {
      const separator = component.indexOf('=');

      if (separator < 1) {
        return [];
      }

      return [[component.slice(0, separator), component.slice(separator + 1)]];
    }),
  );
}

function executeOpenSsl(arguments_: readonly string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    execFile(
      'openssl',
      arguments_,
      {timeout: OPENSSL_TIMEOUT, windowsHide: true},
      error => {
        if (error === null) {
          resolve();
        } else {
          reject(
            new Error('Failed to create local MQTT certificate request.', {
              cause: error,
            }),
          );
        }
      },
    );
  });
}

function isFileNotFoundError(error: unknown): boolean {
  if (typeof error !== 'object' || error === null || !('code' in error)) {
    return false;
  }

  return error.code === 'ENOENT';
}
