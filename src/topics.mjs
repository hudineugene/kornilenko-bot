// Тема обращения: по словам клиента (на трёх языках) понятно, о чём он спрашивает. Метка «🏷 Тема: цена, рассрочка» стоит на карточке
// заявки в Telegram и в диалоге в панели: менеджер видит суть, не читая всё сообщение, и выбирает шаблон ответа. Метка — подсказка по
// ключевым словам, а не решение: переписка клиента остаётся как есть.

const TOPICS = [
  { label: 'цена', words: ['цена', 'цены', 'цену', 'цене', 'ценах', 'стоимост', 'сколько стоит', 'прайс', 'почём', 'почем', 'price', 'how much', 'precio', 'cuánto cuesta', 'cuanto cuesta', 'cuánto vale',
    'ціна', 'ціни', 'ціну', 'ціні', 'ціною', 'цінах', 'вартіст', 'скільки коштує', 'скільки це коштує', 'скільки вартує', 'почому'] },
  { label: 'рассрочка и оплата', words: ['рассрочк', 'оплат', 'платеж', 'платёж', 'первый взнос', 'задаток', 'бронь', 'резерв', 'instalment', 'installment', 'payment', 'deposit', 'reservation', 'pago', 'plazos', 'entrada', 'reserva',
    'розстрочк', 'платіж', 'внесок', 'завдаток', 'бронюван', 'передоплат'] },
  { label: 'ипотека', words: ['ипотек', 'кредит', 'mortgage', 'loan', 'hipoteca', 'préstamo', 'prestamo', 'іпотек'] },
  { label: 'налоги и расходы', words: ['налог', 'расходы', 'комисси', 'нотариус', 'itp', 'iva', 'tax', 'costs', 'notary', 'impuesto', 'gastos', 'notario', 'податк', 'податок', 'витрат', 'комісі', 'нотаріус'] },
  { label: 'просмотр', words: ['посмотреть', 'просмотр', 'показать', 'приехать', 'viewing', 'visit', 'see the', 'visita', 'ver el', 'ver la', 'подивит', 'переглян', 'перегляд', 'показати', 'приїхат', 'приїзд'] },
  { label: 'документы', words: ['документ', 'nie', 'паспорт', 'договор', 'юрист', 'адвокат', 'documents', 'contract', 'lawyer', 'documentos', 'contrato', 'abogado', 'договір', 'юрист', 'адвокат'] },
  { label: 'планировка и фото', words: ['планировк', 'фото', 'видео', 'чертеж', 'чертёж', 'floor plan', 'floorplan', 'photos', 'video', 'planos', 'fotos', 'vídeo', 'плануванн', 'планувальн', 'відео', 'креслен'] },
  { label: 'сроки сдачи', words: ['сдач', 'срок', 'когда будет готов', 'строительств', 'delivery', 'completion', 'when will it', 'entrega', 'finalización', 'finalizacion', 'здач', 'термін', 'коли буде готов', 'будівництв'] },
  { label: 'аренда и доход', words: ['аренд', 'доход', 'окупаем', 'инвест', 'rental', 'yield', 'investment', 'rentabilidad', 'alquiler', 'inversión', 'inversion', 'оренд', 'дохід', 'окупн', 'інвест'] },
  { label: 'ВНЖ и виза', words: ['внж', 'вид на жительство', 'резидент', 'golden visa', 'visa', 'residenc', 'посвідк', 'вид на проживання', 'віза', 'візу', 'візи', 'візов'] },
  { label: 'о компании', words: ['кто вы', 'застройщик', 'гарант', 'надёжн', 'надежн', 'who are you', 'developer', 'guarantee', 'quiénes sois', 'quienes sois', 'promotor', 'garantía', 'garantia', 'хто ви', 'забудовник', 'надійн', 'довіря'] },
  { label: 'контакты', words: ['телефон', 'позвонить', 'офис', 'ваш адрес', 'phone', 'call you', 'office', 'teléfono', 'telefono', 'oficina', 'зателефон', 'подзвон', 'передзвон', 'офіс', 'ваша адреса', 'вашу адресу'] },
];

import { mentions } from './words.mjs';

const MAX_TOPICS = 3;
const MAX_TEXT = 4000;
const MIN_TEXT = 80;

function normalized(text) {
  return String(text || '').slice(0, MAX_TEXT).toLocaleLowerCase('ru-RU').replace(/ё/g, 'е');
}

// Темы в порядке списка: сначала самые частые вопросы. Не больше трёх.
function topicsOf(text) {
  const message = normalized(text);
  if (!message) return [];
  const found = [];
  for (const topic of TOPICS) {
    if (topic.words.some((word) => mentions(message, normalized(word)))) found.push(topic.label);
    if (found.length >= MAX_TOPICS) break;
  }
  return found;
}

// Метка на заявке: ставится у обычных вопросов и сообщений; у записи на просмотр, заявки на звонок и подбора тема и так ясна из вида заявки.
function refreshTopics(inquiry) {
  if (!inquiry) return;
  if (!['general', 'question', 'interest'].includes(inquiry.type)) {
    delete inquiry.topics;
    return;
  }
  // Короткое сообщение («Нужна консультация по ВНЖ») говорит о себе само; метка нужна там, где текст длинный или вопросов несколько.
  // Стандартные кнопки («Узнать цену», «Уточнить доступность») тоже меток не получают.
  const text = String(inquiry.text || '');
  if (text.length < MIN_TEXT || /(^|\n)(Узнать цену|Уточнить доступность)\s*$/.test(text)) {
    delete inquiry.topics;
    return;
  }
  const found = topicsOf(text);
  if (found.length) inquiry.topics = found;
  else delete inquiry.topics;
}

export { TOPICS, refreshTopics, topicsOf };
