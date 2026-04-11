import {home_1} from './@scope-cases/index.js';

function formatDevices(queries: string[]): string[] {
  return home_1
    ._queryDevices(queries)
    .map(device => `${device._requireScope()._path.join('/')}:${device.name}`)
    .sort();
}

describe('Scope._queryDevices', () => {
  test('returns all devices for an empty query', () => {
    expect(formatDevices([])).toEqual([
      'Bedroom/Duplicate/Duplicate:Light',
      'Bedroom/Level 2/Level 3/Level 4/Level 5/Level 6/Level 7:Light',
      'Living Room/Balcony:Light',
      'Living Room:Television',
    ]);
  });

  test('resolves matches recursively under the current subtree', () => {
    expect(formatDevices(['Living Room', 'Light'])).toEqual([
      'Living Room/Balcony:Light',
    ]);

    expect(formatDevices(['Bedroom'])).toEqual([
      'Bedroom/Duplicate/Duplicate:Light',
      'Bedroom/Level 2/Level 3/Level 4/Level 5/Level 6/Level 7:Light',
    ]);
  });

  test('dedupes overlapping duplicate-name matches', () => {
    expect(formatDevices(['Bedroom', 'Duplicate'])).toEqual([
      'Bedroom/Duplicate/Duplicate:Light',
    ]);
  });

  test('returns no devices after a terminal device match', () => {
    expect(formatDevices(['Living Room', 'Light', 'Light'])).toEqual([]);
  });
});
