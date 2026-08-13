const HEADER_SIZE = 5;
const UINT32_MAX = 0xffffffff;

const enum MipsMessageField {
  Id = 0,
  ReturnTopic = 1,
  Payload = 2,
  From = 3,
}

export type MipsMessage = {
  readonly id: number;
  readonly returnTopic?: string;
  readonly payload?: string;
  readonly from?: string;
};

export class MipsMessageError extends Error {
  override readonly name = 'MipsMessageError';
}

export function encodeMipsMessage(message: MipsMessage): Buffer {
  assertMessageId(message.id);

  const fields = [encodeIdField(message.id)];

  if (message.from !== undefined) {
    fields.push(encodeStringField(MipsMessageField.From, message.from, 'from'));
  }

  if (message.returnTopic !== undefined) {
    fields.push(
      encodeStringField(
        MipsMessageField.ReturnTopic,
        message.returnTopic,
        'return topic',
      ),
    );
  }

  if (message.payload !== undefined) {
    fields.push(
      encodeStringField(MipsMessageField.Payload, message.payload, 'payload'),
    );
  }

  return Buffer.concat(fields);
}

export function decodeMipsMessage(data: Uint8Array): MipsMessage {
  const buffer = Buffer.from(data.buffer, data.byteOffset, data.byteLength);
  let offset = 0;
  let id: number | undefined;
  let returnTopic: string | undefined;
  let payload: string | undefined;
  let from: string | undefined;
  const seenFieldSet = new Set<number>();

  while (offset < buffer.length) {
    if (buffer.length - offset < HEADER_SIZE) {
      throw new MipsMessageError('Truncated MIPS message field header.');
    }

    const length = buffer.readUInt32LE(offset);
    const type = buffer[offset + 4];
    const dataOffset = offset + HEADER_SIZE;
    const remaining = buffer.length - dataOffset;

    if (length > remaining) {
      throw new MipsMessageError('MIPS message field exceeds payload bounds.');
    }

    if (type === undefined) {
      throw new MipsMessageError('Missing MIPS message field type.');
    }

    const fieldData = buffer.subarray(dataOffset, dataOffset + length);

    if (isKnownField(type)) {
      if (seenFieldSet.has(type)) {
        throw new MipsMessageError('Duplicate MIPS message field.');
      }

      seenFieldSet.add(type);
    }

    if (type === MipsMessageField.Id) {
      if (fieldData.length !== 4) {
        throw new MipsMessageError('Invalid MIPS message ID field length.');
      }

      id = fieldData.readUInt32LE(0);
    } else if (type === MipsMessageField.ReturnTopic) {
      returnTopic = decodeStringField(fieldData, 'return topic');
    } else if (type === MipsMessageField.Payload) {
      payload = decodeStringField(fieldData, 'payload');
    } else if (type === MipsMessageField.From) {
      from = decodeStringField(fieldData, 'from');
    }

    offset = dataOffset + length;
  }

  if (id === undefined) {
    throw new MipsMessageError('MIPS message has no ID field.');
  }

  return {id, returnTopic, payload, from};
}

function encodeIdField(id: number): Buffer {
  const field = Buffer.alloc(HEADER_SIZE + 4);
  field.writeUInt32LE(4, 0);
  field[4] = MipsMessageField.Id;
  field.writeUInt32LE(id, HEADER_SIZE);
  return field;
}

function encodeStringField(
  type: MipsMessageField,
  value: string,
  name: string,
): Buffer {
  if (value.includes('\0')) {
    throw new MipsMessageError(`MIPS message ${name} contains a null byte.`);
  }

  const encoded = Buffer.from(value, 'utf8');
  const length = encoded.length + 1;

  if (length > UINT32_MAX) {
    throw new MipsMessageError(`MIPS message ${name} is too long.`);
  }

  const field = Buffer.alloc(HEADER_SIZE + length);
  field.writeUInt32LE(length, 0);
  field[4] = type;
  encoded.copy(field, HEADER_SIZE);
  return field;
}

function decodeStringField(data: Buffer, name: string): string {
  // Requests conventionally include the trailing NUL, while real central
  // gateways also emit replies whose TLV length excludes it.
  const content =
    data.length > 0 && data[data.length - 1] === 0
      ? data.subarray(0, -1)
      : data;

  if (content.includes(0)) {
    throw new MipsMessageError(`MIPS message ${name} contains a null byte.`);
  }

  try {
    return new TextDecoder('utf-8', {fatal: true}).decode(content);
  } catch {
    throw new MipsMessageError(`MIPS message ${name} is not valid UTF-8.`);
  }
}

function assertMessageId(id: number): void {
  if (!Number.isInteger(id) || id < 0 || id > UINT32_MAX) {
    throw new MipsMessageError('Invalid MIPS message ID.');
  }
}

function isKnownField(type: number): boolean {
  return (
    type === MipsMessageField.Id ||
    type === MipsMessageField.ReturnTopic ||
    type === MipsMessageField.Payload ||
    type === MipsMessageField.From
  );
}
