import {
  MipsMessageError,
  decodeMipsMessage,
  encodeMipsMessage,
} from '../../local/message.js';

test('round-trips all MIPS message fields with UTF-8 byte lengths', () => {
  const encoded = encodeMipsMessage({
    id: 0xffffffff,
    from: 'local',
    returnTopic: '123/reply',
    payload: JSON.stringify({name: '美岸'}),
  });

  expect(decodeMipsMessage(encoded)).toEqual({
    id: 0xffffffff,
    from: 'local',
    returnTopic: '123/reply',
    payload: JSON.stringify({name: '美岸'}),
  });
});

test('decodes gateway string fields without trailing null bytes', () => {
  const encoded = Buffer.concat([
    createField(0, Buffer.from([1, 0, 0, 0])),
    createField(2, Buffer.from('{"ok":true}')),
  ]);

  expect(decodeMipsMessage(encoded)).toEqual({
    id: 1,
    from: undefined,
    returnTopic: undefined,
    payload: '{"ok":true}',
  });
});

test.each([
  ['truncated header', Buffer.from([4, 0, 0, 0])],
  ['field beyond bounds', Buffer.from([4, 0, 0, 0, 0, 1, 2, 3])],
  ['invalid ID length', Buffer.from([3, 0, 0, 0, 0, 1, 2, 3])],
  [
    'duplicate field',
    Buffer.concat([
      createField(0, Buffer.from([1, 0, 0, 0])),
      createField(0, Buffer.from([2, 0, 0, 0])),
    ]),
  ],
  ['missing ID', createField(2, Buffer.from('{}\0'))],
] as const)('rejects a %s', (_name, encoded) => {
  expect(() => decodeMipsMessage(encoded)).toThrow(MipsMessageError);
});

test('rejects invalid outbound fields', () => {
  expect(() => encodeMipsMessage({id: -1})).toThrow(MipsMessageError);
  expect(() => encodeMipsMessage({id: 1, payload: 'a\0b'})).toThrow(
    MipsMessageError,
  );
});

function createField(type: number, data: Buffer): Buffer {
  const header = Buffer.alloc(5);
  header.writeUInt32LE(data.length, 0);
  header[4] = type;
  return Buffer.concat([header, data]);
}
