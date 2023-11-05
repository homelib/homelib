import {AsyncLocalStorage} from 'async_hooks';

import {ExpectedError} from '@homelib/core';
import {x, xData} from '@homelib/x';
import {xNode} from '@homelib/x/node';
import type {Express, Handler, Request, Response} from 'express';

import type {IDefinition} from '../definitions/index.js';

import {PasswordCredential, assertCredential} from './@credentials/index.js';

const UNKNOWN_ERROR = {
  name: 'UnknownError',
  message: 'Unknown error.',
};

export type RouteContext = {
  handlers: Handler[];
};

export const routeContextStorage = new AsyncLocalStorage<RouteContext>();

export function route<TDefinition extends IDefinition>(
  app: Express,
  definition: TDefinition,
  handlers?: Handler[],
): RouteConfigurator<TDefinition>;
export function route(
  app: Express,
  definition: IDefinition,
  handlers: Handler[] = [],
): RouteConfigurator<IDefinition> {
  return {
    processor: processor => {
      console.debug('route', {path: definition.path});

      app.post(definition.path, ...handlers, async (request, response) => {
        const path = request.baseUrl + request.path;
        const body = request.body;

        const xBodyHeader = request.header('x-body');

        const requestPayload = {
          ...(typeof xBodyHeader === 'string'
            ? JSON.parse(xBodyHeader)
            : undefined),
          ...(Object.getPrototypeOf(body) === Object.prototype
            ? body
            : undefined),
        };

        let decodedPayload: object;

        try {
          decodedPayload = definition.request.transform(
            xData,
            xNode,
            requestPayload,
          ) as object;
        } catch (error) {
          let message: string;

          if (error instanceof x.TypeConstraintError) {
            const {issues} = error;

            console.error('route-invalid-request', {
              path,
              request: requestPayload,
              issues,
            });

            message = error.message;
          } else {
            console.error('route-invalid-request', {
              path,
              request: requestPayload,
              error,
            });

            message = '无效的请求';
          }

          response.json({
            error: {
              name: 'InvalidRequestError',
              message,
            },
          });

          return;
        }

        const passwordHash = request.header('x-password-hash');

        const passwordTimestamp = request.header('x-password-timestamp');

        let ret: any;

        try {
          const password =
            passwordHash !== undefined && passwordTimestamp !== undefined
              ? PasswordCredential.fromHash(
                  passwordHash,
                  Number(passwordTimestamp),
                )
              : undefined;

          ret = await processor(decodedPayload, {
            optionalPassword: password,
            get password() {
              assertCredential(password);
              return password;
            },
            request,
            response,
          });
        } catch (error) {
          if (error instanceof ExpectedError) {
            console.warn('route-rpc-error', {
              path,
              error: {
                name: error.name,
                message: error.message,
              },
            });

            response.json({
              error: {
                name: error.name,
                message: error.message,
              },
            });
          } else {
            console.error('route-unknown-error', {
              path,
              request: requestPayload,
            });

            console.error(error);

            response.status(500).json({
              error: UNKNOWN_ERROR,
            });
          }

          return;
        }

        if (response.headersSent) {
          return;
        }

        try {
          ret = definition.response.transform(xNode, xData, ret);
        } catch (error) {
          console.error('route-invalid-response', {
            path,
            request: requestPayload,
            response: ret,
            ...(error instanceof x.TypeConstraintError
              ? {issues: error.issues}
              : {error}),
          });

          response.status(500).json({
            error: UNKNOWN_ERROR,
          });

          return;
        }

        response.json({
          value: ret,
        });
      });
    },
  };
}

export type ServerRequestOf<TDefinition extends IDefinition> = x.MediumTypeOf<
  'x-node',
  TDefinition['request']
>;

export type ServerResponseOf<TDefinition extends IDefinition> = x.MediumTypeOf<
  'x-node',
  TDefinition['response']
>;

export type RouteConfigurator<TDefinition extends IDefinition> = {
  processor(processor: APIProcessor<TDefinition>): void;
};

export type APIProcessor<TDefinition extends IDefinition> = (
  request: ServerRequestOf<TDefinition>,
  context: APIProcessorContext,
) => ServerResponseOf<TDefinition> | Promise<ServerResponseOf<TDefinition>>;

export type APIProcessorContext = {
  optionalPassword: PasswordCredential | undefined;
  password: PasswordCredential;
  request: Request;
  response: Response;
};
