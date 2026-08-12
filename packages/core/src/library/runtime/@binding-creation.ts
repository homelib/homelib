import type {EndpointConnectionBinding} from '../endpoint.js';
import type {EndpointConnectionBindingPlan} from '../provider.js';

export async function createEndpointConnectionBindings(
  plans: readonly EndpointConnectionBindingPlan[],
): Promise<readonly EndpointConnectionBinding[]> {
  const results = await Promise.allSettled(
    plans.map(async plan => plan.create()),
  );
  const creationErrors = results.flatMap(result =>
    result.status === 'rejected' ? [result.reason] : [],
  );

  if (creationErrors.length === 0) {
    return results.flatMap(result =>
      result.status === 'fulfilled' ? [result.value] : [],
    );
  }

  const disposalErrors = await disposeEndpointConnectionBindings(
    results.flatMap(result =>
      result.status === 'fulfilled' ? [result.value] : [],
    ),
  );
  const errors = [...creationErrors, ...disposalErrors];
  const [error] = errors;

  if (errors.length === 1 && error !== undefined) {
    throw error;
  }

  throw new AggregateError(
    errors,
    'Failed to create endpoint connection bindings.',
  );
}

export async function disposeEndpointConnectionBindings(
  bindings: readonly EndpointConnectionBinding[],
): Promise<readonly unknown[]> {
  const results = await Promise.allSettled(
    bindings.map(async binding => binding.dispose()),
  );

  return results.flatMap(result =>
    result.status === 'rejected' ? [result.reason] : [],
  );
}
