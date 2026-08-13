import {StateMatcher} from './state-matcher.js';

type Level = 'high' | 'normal';

function createMatcher(): StateMatcher<Level, number> {
  return new StateMatcher([
    {
      state: 'high',
      enter: value => value > 10,
      leave: value => value <= 8,
    },
    {
      state: 'normal',
      enter: value => value <= 10,
      leave: value => value > 10,
    },
  ]);
}

test('matches the first applicable state', () => {
  const matcher = createMatcher();

  expect(matcher.state).toBeUndefined();
  expect(matcher.update(11)).toEqual({state: 'high', changed: true});
  expect(matcher.state).toBe('high');
});

test('rejects an input that has no initial match', () => {
  const matcher = new StateMatcher<string, number>([
    {
      state: 'positive',
      enter: value => value > 0,
      leave: value => value <= 0,
    },
  ]);

  expect(() => matcher.update(0)).toThrow(
    'No matching state for input 0; previous state: undefined.',
  );
  expect(matcher.state).toBeUndefined();
});

test('keeps the current state until its leave predicate is satisfied', () => {
  const matcher = createMatcher();

  matcher.update(11);

  expect(matcher.update(9)).toEqual({state: 'high', changed: false});
  expect(matcher.update(8)).toEqual({state: 'normal', changed: true});
  expect(matcher.update(8)).toEqual({state: 'normal', changed: false});
});

test('clears the current state when no definition matches', () => {
  const matcher = new StateMatcher<string, number>([
    {
      state: 'positive',
      enter: value => value > 0,
      leave: value => value <= 0,
    },
  ]);

  matcher.update(1);

  expect(() => matcher.update(0)).toThrow(
    'No matching state for input 0; previous state: positive.',
  );
  expect(matcher.state).toBeUndefined();
});
