export const credential_name = Symbol('credential name');

export abstract class Credential {
  protected abstract [credential_name]: string;
}
