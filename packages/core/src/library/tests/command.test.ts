import {Command, StatefulCommand} from '../command.js';

test('stateful commands supersede only their exact command class by default', () => {
  const command = new FirstStatefulCommand();

  expect(command.supersedes(new FirstStatefulCommand())).toBe(true);
  expect(command.supersedes(new DerivedStatefulCommand())).toBe(false);
  expect(command.supersedes(new SecondStatefulCommand())).toBe(false);
  expect(new DerivedStatefulCommand().supersedes(command)).toBe(false);
});

test('non-stateful commands do not supersede by default', () => {
  expect(new StatelessCommand().supersedes(new StatelessCommand())).toBe(false);
});

class FirstStatefulCommand extends StatefulCommand {}

class DerivedStatefulCommand extends FirstStatefulCommand {}

class SecondStatefulCommand extends StatefulCommand {}

class StatelessCommand extends Command {}
