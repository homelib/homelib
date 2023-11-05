import type {x} from '@homelib/x';

export function convertDefinitionKeyToAPIPath(
  prefix: string,
  key: string,
  path: string | undefined,
): string {
  return `${prefix}${
    path ?? `/${key.replaceAll('__', '/').replaceAll('_', '-')}`
  }`;
}

export type Definition<
  TRequest extends x.XTypeOfValue<object> = x.XTypeOfValue<object>,
  TResponse extends x.XTypeOfValue<object> = x.XTypeOfValue<object>,
> = {
  path: string;
  request: TRequest;
  response: TResponse;
};

export function define<
  TRequest extends x.XTypeOfValue<object>,
  TResponse extends x.XTypeOfValue<object>,
>(
  request: TRequest,
  response: TResponse,
  path?: string,
): Definition<TRequest, TResponse> {
  return {
    path: path!,
    request,
    response,
  };
}

export function setupDefinitions<TNamespace extends Record<string, Definition>>(
  prefix: string,
  namespace: TNamespace,
): void {
  for (const key of Object.keys(namespace)) {
    (namespace as any)[key].path = convertDefinitionKeyToAPIPath(
      prefix,
      key,
      namespace[key].path,
    );
  }
}
