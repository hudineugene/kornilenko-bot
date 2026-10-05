// Смена пароля панели, когда войти не получается.
//
// Запуск: bot.exe --reset-password  (или node tools\set-panel-password.js)
// Бот при этом должен быть остановлен: он держит данные в памяти и при
// сохранении затрёт правку в файле.
//
// Новый пароль вводится здесь же, в окне. На экране он не показывается, в
// журнал не пишется и никуда не отправляется — в файл попадает только его
// необратимый отпечаток (scrypt), как и раньше.
//
// Модуль не подключает хранилище и настройки бота: они при загрузке читают и
// могут менять живой файл данных, а здесь нужен только сам файл.

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import * as sea from 'node:sea';

// Тот же выбор папки, что и в config.mjs: рядом с bot.exe или папка проекта.
function appDirectory() {
  return globalThis.BOT_APP_DIRECTORY || (sea.isSea() ? path.dirname(process.execPath) : process.cwd());
}
function dataFilePath() {
  return process.env.BOT_DATA_FILE || path.join(appDirectory(), 'bot-data.json');
}
function runningFilePath() {
  return path.join(path.dirname(dataFilePath()), 'bot-running.json');
}
// Сессии панели лежат рядом с данными (только хеши cookie); бот при запуске их поднимает.
function sessionFilePaths() {
  const base = path.join(path.dirname(dataFilePath()), 'bot-sessions.json');
  return [base, base + '.tmp'];
}

function fail(message) {
  console.error('\n  ' + message + '\n');
  process.exit(1);
}

// Пока бот работает, правку файла он перезапишет своей копией из памяти.
function botIsRunning() {
  if (!fs.existsSync(runningFilePath())) return false;
  try {
    const marker = JSON.parse(fs.readFileSync(runningFilePath(), 'utf8'));
    const alive = Date.now() - Date.parse(marker.lastAliveAt || marker.startedAt || 0) < 5 * 60 * 1000;
    return alive ? marker.pid : false;
  } catch {
    return false;
  }
}

// Ввод без показа на экране: ни в окне, ни в истории команд пароля не остаётся.
// Оба вопроса задаёт один и тот же ввод: два подряд съедали бы строки друг у
// друга, и второй ответ приходил пустым.
// Если ввод подан не с клавиатуры (проверка скрипта), читаем строки как есть:
// прятать там нечего, а обещание «не показываем» относится к живому окну.
function createPrompt() {
  const output = process.stdout;
  const interactive = Boolean(process.stdin.isTTY);
  const rl = readline.createInterface({ input: process.stdin, output, terminal: interactive });
  // Строки складываем в очередь и раздаём по одной: если ввод закончился
  // раньше второго вопроса (так бывает при проверке скрипта), ответ всё равно
  // не потеряется.
  const lines = [];
  const waiting = [];
  let finished = false;
  rl.on('line', (line) => {
    if (waiting.length) waiting.shift()(String(line));
    else lines.push(String(line));
  });
  rl.on('close', () => {
    finished = true;
    while (waiting.length) waiting.shift()('');
  });
  // На живом вводе символы пароля не печатаем: видно только сам вопрос.
  if (interactive) rl._writeToOutput = () => {};
  return {
    ask(question) {
      output.write(question);
      return new Promise((resolve) => {
        // Пока символы не печатаются, не печатается и перевод строки после
        // Enter: второй вопрос вставал в ту же строку, что и первый.
        const done = (answer) => {
          if (interactive) output.write('\n');
          resolve(answer);
        };
        if (lines.length) return done(lines.shift());
        if (finished) return done('');
        waiting.push(done);
      });
    },
    close() { rl.close(); },
  };
}

async function runReset() {
  const dataFile = dataFilePath();
  if (!fs.existsSync(dataFile)) fail('Файл данных не найден: ' + dataFile);
  const running = botIsRunning();
  if (running) fail('Бот сейчас работает (процесс ' + running + '). Остановите его (Ctrl+C в окне бота или tools\\stop-bot.ps1) и запустите эту команду снова.');

  const data = JSON.parse(fs.readFileSync(dataFile, 'utf8'));
  if (!data.config || !data.config.botToken) fail('В файле данных нет настроенного бота — менять пароль не от чего.');

  console.log('\n  Смена пароля панели для ' + dataFile);
  console.log('  Пароль не показывается на экране. Минимум 8 знаков.\n');
  const prompt = createPrompt();
  const first = await prompt.ask('  Новый пароль: ');
  const second = await prompt.ask('  Повторите пароль: ');
  prompt.close();
  if (first.length < 8) fail('Пароль должен содержать минимум 8 знаков. Ничего не изменено.');
  if (first !== second) fail('Пароли не совпали. Ничего не изменено.');

  // Копия на случай, если что-то пойдёт не так.
  const stamp = new Date().toISOString().replace(/[:T]/g, '-').slice(0, 19);
  const backupDirectory = path.join(path.dirname(dataFile), 'backups');
  fs.mkdirSync(backupDirectory, { recursive: true });
  const backup = path.join(backupDirectory, 'bot-data-before-password-' + stamp + '.json');
  fs.copyFileSync(dataFile, backup);

  // Тот же расчёт, что и при проверке пароля в боте (scrypt, 64 байта).
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(first, salt, 64).toString('hex');
  data.config.passwordSalt = salt;
  data.config.passwordHash = hash;
  fs.writeFileSync(dataFile, JSON.stringify(data));

  // Пароль меняют, когда он мог попасть не в те руки. Тот, кто уже вошёл со
  // старым, остаётся в панели, пока жива его сессия, — поэтому файл сессий
  // удаляется: бот при запуске никого не «вспомнит», и входить придётся заново.
  let endedSessions = false;
  for (const file of sessionFilePaths()) {
    if (fs.existsSync(file)) {
      fs.rmSync(file, { force: true });
      endedSessions = true;
    }
  }

  console.log('\n  Готово. Пароль изменён.');
  console.log(endedSessions ? '  Все прежние входы в панель завершены: войти нужно заново.' : '  Сохранённых входов в панель не было.');
  console.log('  Копия прежних данных: ' + backup);
  console.log(process.platform === 'win32' ? '  Запустите бота (start-bot.ps1) и войдите с новым паролем.\n' : '  Бот запустится сам; войдите в панель с новым паролем.\n');
}

async function resetPassword() {
  try {
    await runReset();
  } catch (error) {
    fail('Не удалось изменить пароль: ' + error.message);
  }
}

export { resetPassword };
