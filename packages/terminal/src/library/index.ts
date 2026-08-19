import {basename} from 'node:path';

import {addLogListener, registerBootstrapFrontend} from '@homelib/core';

import {getRequestedLocale, isRunRequested} from './@bootstrap-arguments.js';
import {presentStartup} from './@tui/startup.js';
import {writeLogEvent} from './log.js';

registerBootstrapFrontend(context => {
  if (isRunRequested(process.argv)) {
    return;
  }

  return presentStartup(
    context,
    getScriptName(),
    getRequestedLocale(
      process.argv,
      process.env.HOMELIB_LOCALE,
      Intl.DateTimeFormat().resolvedOptions().locale,
    ),
  );
});

addLogListener(writeLogEvent);

export * from './log.js';
export * from './i18n.js';
export * from './tui.js';

function getScriptName(): string {
  const scriptPath = process.argv.at(1);

  if (scriptPath === undefined) {
    return 'automation';
  }

  return basename(scriptPath);
}
