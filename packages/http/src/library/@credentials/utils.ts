import {PermissionDeniedError} from '../errors.js';

import type {Credential} from './credential.js';

export function assertCredential(
  credential: Credential | undefined,
): asserts credential {
  if (!credential) {
    throw new PermissionDeniedError('Missing credential');
  }
}
