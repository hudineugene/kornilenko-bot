'use strict';
// Подгружается в дочерний процесс бота через --require: любой запрос к Telegram
// получает ответ «токен отклонён» (401), сети тест не касается. Каждый такой
// запрос печатается строкой, по которой тест видит повторные попытки.
const original = global.fetch;
global.fetch = (url, init) => {
  if (String(url).includes('api.telegram.org')) {
    console.log('STUB-REJECT ' + String(url).split('/').pop());
    return Promise.resolve(new Response(JSON.stringify({ ok: false, error_code: 401, description: 'Unauthorized' }), { status: 401, headers: { 'content-type': 'application/json' } }));
  }
  return original(url, init);
};
