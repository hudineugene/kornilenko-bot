// Точка входа для bot.exe: обычный запуск бота или служебный режим.
//
//   bot.exe                  — запустить бота и панель
//   bot.exe --reset-password — сменить пароль панели (бот должен быть остановлен)
//
// Служебный режим не загружает бота: при загрузке бот читает живой файл данных,
// а сменить пароль нужно, не трогая ничего лишнего.

const reset = process.argv.includes('--reset-password');
(reset
  ? import('./password-reset.mjs').then((module) => module.resetPassword())
  : import('./main.mjs')
).catch((error) => {
  console.error(error && error.stack ? error.stack : error);
  process.exit(1);
});
