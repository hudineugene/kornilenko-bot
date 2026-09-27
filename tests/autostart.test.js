'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

test('the Windows autostart task is tied to this bot folder and restarts failures', async () => {
  const { autostartTaskName, autostartTaskXml, currentWindowsUser } = await import('../src/autostart.mjs');
  const first = autostartTaskName('C:\\Bots\\Main');
  assert.equal(first, autostartTaskName('C:\\Bots\\Main'));
  assert.notEqual(first, autostartTaskName('C:\\Bots\\Second'));
  assert.equal(currentWindowsUser({ USERDOMAIN: 'OFFICE', USERNAME: 'Manager' }), 'OFFICE\\Manager');

  const document = autostartTaskXml('C:\\Олег & Co\\bot.exe', 'C:\\Олег & Co', 'OFFICE\\Manager');
  assert.match(document, /<LogonTrigger>/);
  assert.match(document, /<RestartOnFailure><Interval>PT1M<\/Interval><Count>999<\/Count><\/RestartOnFailure>/);
  assert.match(document, /<ExecutionTimeLimit>PT0S<\/ExecutionTimeLimit>/);
  assert.match(document, /<Arguments>--no-auto-open<\/Arguments>/);
  assert.match(document, /C:\\Олег &amp; Co\\bot\.exe/);
  assert.ok(!document.includes('Олег & Co'), 'XML special characters must be escaped');
});
