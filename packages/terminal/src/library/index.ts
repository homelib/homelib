import {basename} from 'node:path';

import {addLogListener, registerBootstrapFrontend} from '@homelib/core';

import {isAutomationRequested} from './@bootstrap-arguments.js';
import {presentStartup} from './@tui/startup.js';
import {writeLogEvent} from './log.js';

registerBootstrapFrontend(context => {
  if (isAutomationRequested(process.argv)) {
    return;
  }

  return presentStartup(context, getScriptName());
});

addLogListener(writeLogEvent);

export * from './log.js';
export * from './tui.js';

function getScriptName(): string {
  const scriptPath = process.argv.at(1);

  if (scriptPath === undefined) {
    return 'automation';
  }

  return basename(scriptPath);
}
