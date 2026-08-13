import {
  calcGroupId,
  discoverCentralRoutes,
  parseCentralProfile,
} from './discovery.js';

test('calculates a stable home central-service group id', () => {
  expect(calcGroupId('123', '456')).toBe('6a5516efc53d8557');
  expect(calcGroupId(123, 456)).toBe('6a5516efc53d8557');
});

test('strictly parses an MQTT primary-role central profile', () => {
  const profile = createProfile({
    did: '1180923980',
    groupId: '0123456789abcdef',
    role: 1,
    suiteMqtt: true,
  });

  expect(parseCentralProfile(profile)).toEqual({
    did: '1180923980',
    groupId: '0123456789abcdef',
    role: 1,
    suiteMqtt: true,
  });
});

test.each([
  '!',
  Buffer.alloc(22).toString('base64'),
  createProfile({did: '0', role: 1, suiteMqtt: true}),
  createProfile({did: '1', role: 2, suiteMqtt: true}),
  createProfile({did: '1', role: 1, suiteMqtt: false}),
])('rejects an invalid or incompatible central profile', profile => {
  expect(parseCentralProfile(profile)).toBeUndefined();
});

test('does no network discovery without gateway candidates', async () => {
  await expect(
    discoverCentralRoutes({
      candidates: [],
      userId: '123',
      virtualDid: '456',
      timeout: 0,
    }),
  ).resolves.toEqual([]);
});

function createProfile(options: {
  readonly did: string;
  readonly groupId?: string;
  readonly role: number;
  readonly suiteMqtt: boolean;
}): string {
  const profile = Buffer.alloc(23);
  const groupId = Buffer.from(options.groupId ?? '0123456789abcdef', 'hex');

  profile.writeBigUInt64BE(BigInt(options.did), 1);
  Buffer.from(groupId).reverse().copy(profile, 9);
  profile[20] = options.role << 4;

  if (options.suiteMqtt) {
    profile[22] = 0b10;
  }

  return profile.toString('base64');
}
