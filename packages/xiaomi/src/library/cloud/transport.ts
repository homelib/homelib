import type {BackendClient} from '../backend/index.js';
import {MiotEndpointConnectionTransport} from '../endpoint-connection.js';
import type {MiotExecutionRequest, MiotExecutionResult} from '../miot/index.js';

export class MiotEndpointConnectionCloudTransport extends MiotEndpointConnectionTransport {
  private readonly backendClient: BackendClient;

  constructor(backendClient: BackendClient) {
    super();
    this.backendClient = backendClient;
  }

  override async executeRequest(
    request: MiotExecutionRequest,
  ): Promise<MiotExecutionResult> {
    const results = await this.backendClient.setProperties([request]);

    if (results.length !== 1) {
      throw new Error(
        `Cloud returned ${results.length} results for one MIoT request.`,
      );
    }

    const [result] = results;

    if (result === undefined) {
      throw new Error('Cloud returned no result for a MIoT request.');
    } else if (
      result.did !== request.property.did ||
      result.siid !== request.property.siid ||
      result.piid !== request.property.piid
    ) {
      throw new Error('Cloud returned a result for an unexpected property.');
    }

    return result;
  }
}
