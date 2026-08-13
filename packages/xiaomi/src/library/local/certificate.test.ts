import {execFile} from 'node:child_process';
import {X509Certificate, createHash} from 'node:crypto';
import {mkdtemp, readFile, rm, stat, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {promisify} from 'node:util';

import {
  LocalCertificateManager,
  createCertificateRequest,
  createEd25519PrivateKey,
  getCertificateCommonName,
  getVirtualDid,
  isMipsGatewayCertificate,
} from './certificate.js';

const execFileAsync = promisify(execFile);
const UUID = '0123456789abcdef0123456789abcdef';
const USER_ID = '123456789';

test('derives a stable virtual DID and certificate common name', () => {
  const virtualDid = getVirtualDid(UUID);

  expect(virtualDid).toBe(BigInt('0x0123456789abcdef').toString());
  expect(getCertificateCommonName(USER_ID, virtualDid)).toMatch(
    /^mips\.123456789\.[\da-f]{40}\.2$/u,
  );
  expect(() => getVirtualDid('not-a-uuid')).toThrow(
    'Local MQTT UUID must be 32 lowercase hex characters.',
  );
});

test('creates an Ed25519 CSR with the Mijia identity subject', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'homelib-xiaomi-cert-test-'));
  const requestPath = join(directory, 'request.pem');

  try {
    const privateKey = createEd25519PrivateKey();
    const virtualDid = getVirtualDid(UUID);
    const request = await createCertificateRequest(
      privateKey,
      USER_ID,
      virtualDid,
    );

    await writeFile(requestPath, request, 'utf8');
    const {stdout: subject} = await execFileAsync(
      'openssl',
      ['req', '-in', requestPath, '-noout', '-subject', '-nameopt', 'RFC2253'],
      {timeout: 10_000},
    );
    const {stdout: publicKeyAlgorithm} = await execFileAsync(
      'openssl',
      ['req', '-in', requestPath, '-noout', '-text'],
      {timeout: 10_000},
    );

    expect(subject.trim()).toBe(
      `subject=CN=${getCertificateCommonName(USER_ID, virtualDid)},O=Mijia Device,C=CN`,
    );
    expect(publicKeyAlgorithm).toContain('ED25519');
  } finally {
    await rm(directory, {recursive: true, force: true});
  }
});

test('matches a gateway certificate to its expected DID identity', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'homelib-xiaomi-cert-test-'));
  const certificatePath = join(directory, 'gateway.pem');
  const gatewayDid = '1180923980';
  const didHash = createHash('sha1').update(gatewayDid).digest('hex');

  try {
    await execFileAsync(
      'openssl',
      [
        'req',
        '-x509',
        '-newkey',
        'ed25519',
        '-nodes',
        '-subj',
        `/C=CN/O=Mijia Device/CN=mips.123456789.${didHash}.14`,
        '-days',
        '7',
        '-keyout',
        join(directory, 'gateway.key'),
        '-out',
        certificatePath,
      ],
      {timeout: 10_000},
    );
    const certificate = new X509Certificate(
      await readFile(certificatePath, 'utf8'),
    );

    expect(isMipsGatewayCertificate(certificate, gatewayDid)).toBe(true);
    expect(isMipsGatewayCertificate(certificate, '1180923981')).toBe(false);
  } finally {
    await rm(directory, {recursive: true, force: true});
  }
});

test('atomically stores, reuses, and joins creation of a local certificate', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'homelib-xiaomi-cert-test-'));
  const path = join(directory, 'credentials', 'local.json');
  const signer = await createTestSigner(directory);
  let signingCount = 0;
  const manager = new LocalCertificateManager({
    path,
    uuid: UUID,
    userId: USER_ID,
    getCertificate: async request => {
      signingCount += 1;
      return signer(request);
    },
  });

  try {
    const certificates = await Promise.all([
      manager.ensureCertificate(),
      manager.ensureCertificate(),
      manager.ensureCertificate(),
    ]);
    const loaded = await new LocalCertificateManager({
      path,
      uuid: UUID,
      userId: USER_ID,
      getCertificate: async () => {
        throw new Error('A valid cached certificate must not be renewed.');
      },
    }).ensureCertificate();

    expect(signingCount).toBe(1);
    expect(certificates[1]).toEqual(certificates[0]);
    expect(certificates[2]).toEqual(certificates[0]);
    expect(loaded).toEqual(certificates[0]);

    if (process.platform !== 'win32') {
      expect((await stat(path)).mode & 0o777).toBe(0o600);
    }
  } finally {
    await rm(directory, {recursive: true, force: true});
  }
});

test('keeps a valid existing Ed25519 key while replacing an invalid cert', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'homelib-xiaomi-cert-test-'));
  const path = join(directory, 'local.json');
  const privateKey = createEd25519PrivateKey();
  const signer = await createTestSigner(directory);

  try {
    await writeFile(
      path,
      JSON.stringify({
        version: 1,
        userId: USER_ID,
        virtualDid: getVirtualDid(UUID),
        privateKey,
        certificate: 'invalid',
      }),
      {encoding: 'utf8', mode: 0o600},
    );

    const certificate = await new LocalCertificateManager({
      path,
      uuid: UUID,
      userId: USER_ID,
      getCertificate: signer,
    }).ensureCertificate();

    expect(certificate.privateKey).toBe(privateKey);
  } finally {
    await rm(directory, {recursive: true, force: true});
  }
});

async function createTestSigner(
  directory: string,
): Promise<(request: string) => Promise<string>> {
  const caKeyPath = join(directory, 'test-ca.key');
  const caCertificatePath = join(directory, 'test-ca.pem');
  let sequence = 0;

  await execFileAsync(
    'openssl',
    [
      'req',
      '-x509',
      '-newkey',
      'ed25519',
      '-nodes',
      '-subj',
      '/CN=homelib test CA',
      '-days',
      '30',
      '-keyout',
      caKeyPath,
      '-out',
      caCertificatePath,
    ],
    {timeout: 10_000},
  );

  return async request => {
    sequence += 1;

    const requestPath = join(directory, `request-${sequence}.pem`);
    const certificatePath = join(directory, `certificate-${sequence}.pem`);

    await writeFile(requestPath, request, 'utf8');
    await execFileAsync(
      'openssl',
      [
        'x509',
        '-req',
        '-in',
        requestPath,
        '-CA',
        caCertificatePath,
        '-CAkey',
        caKeyPath,
        '-CAcreateserial',
        '-days',
        '7',
        '-out',
        certificatePath,
      ],
      {timeout: 10_000},
    );

    return readFile(certificatePath, 'utf8');
  };
}
