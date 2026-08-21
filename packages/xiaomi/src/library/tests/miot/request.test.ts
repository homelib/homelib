import {
  MiotInvokeActionRequest,
  MiotSetPropertyRequest,
  getMiotExecutionRequestDid,
} from '../../miot/request.js';

test('gets the target device from property and action requests', () => {
  expect(
    getMiotExecutionRequestDid(
      new MiotSetPropertyRequest(
        {did: 'property-device', siid: 2, piid: 1},
        true,
      ),
    ),
  ).toBe('property-device');
  expect(
    getMiotExecutionRequestDid(
      new MiotInvokeActionRequest({did: 'action-device', siid: 2, aiid: 1}, [
        {piid: 8, value: 10},
      ]),
    ),
  ).toBe('action-device');
});

test('rejects duplicate action input properties', () => {
  expect(
    () =>
      new MiotInvokeActionRequest({did: 'device', siid: 2, aiid: 1}, [
        {piid: 8, value: 10},
        {piid: 8, value: 20},
      ]),
  ).toThrow('Duplicate MIoT action input property.');
});
