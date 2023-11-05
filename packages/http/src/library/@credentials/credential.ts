export declare const credential_name: unique symbol;

export abstract class Credential {
  protected abstract [credential_name]: string;
}
