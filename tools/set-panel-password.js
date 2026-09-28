// Смена пароля панели, когда войти не получается.
//
// Запуск: node tools\set-panel-password.js
// Бот при этом должен быть остановлен: он держит данные в памяти и при
// сохранении затрёт правку в файле.
//
// Новый пароль вводится здесь же, в окне. На экране он не показывается, в
// журнал не пишется и никуда не отправляется — в файл попадает только его
// необратимый отпечаток (scrypt), как и раньше.

'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const readline = require('node:readline');

const root = path.resolve(__dirname, '..');
const dataFile = process.env.BOT_DATA_FILE || path.join(root, 'bot-data.json');
const runningFile = path.join(path.dirname(dataFile), 'bot-running.json');

function fail(message) {
  console.error('\n  ' + message + '\n');
  process.exit(1);
}

// Пока бот работает, правку файла он перезапишет своей копией из памяти.
function botIsRunning() {
  if (!fs.existsSync(runningFile)) return false;
  try {
    const marker = JSON.parse(fs.readFileSync(runningFile, 'utf8'));
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
        if (lines.length) return resolve(lines.shift());
        if (finished) return resolve('');
        waiting.push(resolve);
      });
    },
    close() { rl.close(); },
  };
}

async function main() {
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

  console.log('\n  Готово. Пароль изменён.');
  console.log('  Копия прежних данных: ' + backup);
  console.log('  Запустите бота (start-bot.ps1) и войдите с новым паролем.\n');
}

main().catch((error) => fail('Не удалось изменить пароль: ' + error.message));
