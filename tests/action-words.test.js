'use strict';

// Одно действие — одни слова (этап 50, хвост; сторож этапа 52). Клиент видит одно и то же действие под одним названием:
//   «Обсудить» / «Discuss» / «Consultar» — начать разговор с менеджером из любого места (сравнение, расчёт, мастер подбора);
//   «Отправить заявку» / «Send request» / «Enviar solicitud» — отправить заполненную форму (звонок, просмотр, подбор);
//   «список» — избранное, которым делятся ссылкой (а «подбор» — это мастер): слова «подборка» в тексте для клиента нет;
//   тон — «мы», а не «бот»: «мы сообщим», «мы проверяем» (о том, что бот хранит данные, говорить «бот» можно: это факт).

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { literals } = require('./helpers/literals');

const strings = literals(fs.readFileSync(path.join(__dirname, '..', 'src', 'texts.mjs'), 'utf8'));
const hits = (pattern) => strings.filter((item) => pattern.test(item.text)).map((item) => 'texts.mjs:' + item.line + ' ' + item.text.slice(0, 80).replace(/\n/g, ' '));

test('кнопки «к менеджеру» названы одинаково: нет «Отправить менеджеру», «Send to agent», «Enviar al asesor», «Обсудить с менеджером», «Discuss with an agent», «Hablar con un asesor»', () => {
  assert.deepEqual(hits(/Отправить менеджеру|Send to agent|Enviar al asesor|Обсудить с менеджером|Discuss with an agent|Hablar con un asesor|💬 Менеджеру|💬 To agent|💬 Al asesor/), []);
});

test('формы подтверждаются одним словом: звонок, просмотр и подбор — «Отправить заявку» / «Send request» / «Enviar solicitud»', () => {
  const { bot } = require('./helpers/chat');
  for (const [language, label] of [['ru', '✅ Отправить заявку'], ['en', '✅ Send request'], ['es', '✅ Enviar solicitud']]) {
    assert.equal(bot.text.lead[language].confirm, label);
    assert.equal(bot.text.viewing[language].confirm, label);
  }
});

test('избранное, которым делятся, — «список», а не «подборка»/«selección»; «подбор» остаётся именем мастера', () => {
  assert.deepEqual(hits(/[Пп]одборк/), []);
  assert.deepEqual(hits(/📤 Compartir la selección|📤 Selección|Te han enviado una selección/), []);
});

test('тон поиска и уведомлений — «мы»: нет «бот сообщит», «Бот проверяет», «the bot will tell you», «el bot te avisará»', () => {
  assert.deepEqual(hits(/бот сообщит|Бот проверяет|the bot will tell|The bot checks|el bot te avisará|El bot comprueba/), []);
});
