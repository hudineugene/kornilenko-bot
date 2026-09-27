// Windows Task Scheduler integration. The task is created only after an
// explicit click in the admin panel and starts the same standalone bot.exe
// after the user signs in. Task Scheduler restarts it after a failure.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import * as sea from 'node:sea';
import { APP_DIRECTORY } from './config.mjs';

function xml(value) {
  return String(value || '').replace(/[&<>"']/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;',
  })[character]);
}

function currentWindowsUser(environment = process.env) {
  const username = String(environment.USERNAME || '').trim();
  const domain = String(environment.USERDOMAIN || '').trim();
  if (!username) return '';
  return domain ? domain + '\\' + username : username;
}

function autostartTaskName(appDirectory = APP_DIRECTORY) {
  const suffix = crypto.createHash('sha256').update(path.resolve(appDirectory).toLocaleLowerCase('en-US')).digest('hex').slice(0, 10);
  return 'Construcciones Kornilenko Bot ' + suffix;
}

function autostartTaskXml(executablePath, workingDirectory, userName) {
  return '<?xml version="1.0" encoding="UTF-16"?>\r\n' +
    '<Task version="1.4" xmlns="http://schemas.microsoft.com/windows/2004/02/mit/task">' +
      '<RegistrationInfo><Description>Автозапуск Telegram-бота Construcciones Kornilenko</Description></RegistrationInfo>' +
      '<Triggers><LogonTrigger><Enabled>true</Enabled><UserId>' + xml(userName) + '</UserId></LogonTrigger></Triggers>' +
      '<Principals><Principal id="Author"><UserId>' + xml(userName) + '</UserId><LogonType>InteractiveToken</LogonType><RunLevel>LeastPrivilege</RunLevel></Principal></Principals>' +
      '<Settings>' +
        '<MultipleInstancesPolicy>IgnoreNew</MultipleInstancesPolicy>' +
        '<DisallowStartIfOnBatteries>false</DisallowStartIfOnBatteries>' +
        '<StopIfGoingOnBatteries>false</StopIfGoingOnBatteries>' +
        '<AllowHardTerminate>true</AllowHardTerminate>' +
        '<StartWhenAvailable>true</StartWhenAvailable>' +
        '<RunOnlyIfNetworkAvailable>false</RunOnlyIfNetworkAvailable>' +
        '<IdleSettings><StopOnIdleEnd>false</StopOnIdleEnd><RestartOnIdle>false</RestartOnIdle></IdleSettings>' +
        '<AllowStartOnDemand>true</AllowStartOnDemand>' +
        '<Enabled>true</Enabled>' +
        '<Hidden>false</Hidden>' +
        '<RunOnlyIfIdle>false</RunOnlyIfIdle>' +
        '<WakeToRun>false</WakeToRun>' +
        '<ExecutionTimeLimit>PT0S</ExecutionTimeLimit>' +
        '<Priority>7</Priority>' +
        '<RestartOnFailure><Interval>PT1M</Interval><Count>999</Count></RestartOnFailure>' +
      '</Settings>' +
      '<Actions Context="Author"><Exec><Command>' + xml(executablePath) + '</Command><Arguments>--no-auto-open</Arguments><WorkingDirectory>' + xml(workingDirectory) + '</WorkingDirectory></Exec></Actions>' +
    '</Task>';
}

function scheduler(args) {
  return spawnSync('schtasks.exe', args, {
    windowsHide: true,
    encoding: 'buffer',
    timeout: 15000,
  });
}

function autostartSupported() {
  return process.platform === 'win32' && sea.isSea();
}

function autostartStatus() {
  const supported = autostartSupported();
  if (!supported) return { supported: false, enabled: false };
  const result = scheduler(['/Query', '/TN', autostartTaskName(), '/FO', 'LIST']);
  return { supported: true, enabled: !result.error && result.status === 0 };
}

function setAutostart(enabled) {
  if (!autostartSupported()) throw new Error('Автозапуск доступен только в автономном bot.exe на Windows');
  const taskName = autostartTaskName();
  if (!enabled) {
    const current = autostartStatus();
    if (!current.enabled) return current;
    const removed = scheduler(['/Delete', '/TN', taskName, '/F']);
    if (removed.error || removed.status !== 0) throw new Error('Windows не удалось отключить автозапуск');
    return autostartStatus();
  }

  const userName = currentWindowsUser();
  if (!userName) throw new Error('Не удалось определить пользователя Windows');
  const executablePath = process.execPath;
  const taskFile = path.join(os.tmpdir(), 'kornilenko-autostart-' + process.pid + '-' + crypto.randomUUID() + '.xml');
  try {
    const document = autostartTaskXml(executablePath, APP_DIRECTORY, userName);
    fs.writeFileSync(taskFile, '\uFEFF' + document, { encoding: 'utf16le', mode: 0o600 });
    const created = scheduler(['/Create', '/TN', taskName, '/XML', taskFile, '/F']);
    if (created.error || created.status !== 0) throw new Error('Windows не удалось включить автозапуск. Попробуйте запустить bot.exe от обычного пользователя и повторить.');
  } finally {
    try { fs.unlinkSync(taskFile); } catch {}
  }
  return autostartStatus();
}

export {
  autostartStatus,
  autostartSupported,
  autostartTaskName,
  autostartTaskXml,
  currentWindowsUser,
  setAutostart,
};
