import {createHash} from 'crypto';

import ms from 'ms';

import {useEntrances} from '../entrances.js';
import {PermissionDeniedError} from '../errors.js';

import {Credential, credential_name} from './credential.js';

const TIMESTAMP_TOLERANCE = ms('1m');

export class PasswordCredential extends Credential {
  declare protected [credential_name]: 'password';

  static fromHash(hash: string, timestamp: number): PasswordCredential {
    const {
      options: {password},
    } = useEntrances();

    const now = Date.now();

    if (Math.abs(now - timestamp) > TIMESTAMP_TOLERANCE) {
      throw new PermissionDeniedError('Invalid timestamp.');
    }

    const refHash = createHash('sha256')
      .update(`${password}\n${timestamp}`)
      .digest('hex');

    if (hash !== refHash) {
      throw new PermissionDeniedError('Invalid password.');
    }

    return new PasswordCredential();
  }
}
