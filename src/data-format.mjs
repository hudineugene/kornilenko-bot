// Формат bot-data.json: значения по умолчанию, миграции и проверка загруженных данных.

import crypto from 'node:crypto';
import { cleanText, clone } from './util.mjs';
import { INTERFACE_TEXT_DEFAULTS } from './texts.mjs';
import { PREVIOUS_INTERFACE_TEXTS, VERSION_38_DEFAULT_HASHES } from './legacy-texts.mjs';
import { normalizedSimilarPropertyDetails } from './similar.mjs';

// Версия формата данных. Поднимается при каждом изменении набора полей: по ней
// бот отказывается запускаться на файле, созданном более новой версией, и делает
// копию перед обновлением формата. Отпечаток формата сверяет тест
// data-version.test.js — он не даст изменить набор полей и забыть про версию.
const DATA_VERSION = 52;
const PIPELINE_STAGES = ['new', 'contact', 'selection', 'viewing', 'negotiation', 'won', 'lost'];
// 0 turns reminders about unanswered inquiries off.
const RETENTION_MONTH_OPTIONS = [0, 12, 18, 24, 36, 48];
const REMINDER_HOUR_OPTIONS = [0, 1, 2, 4, 8, 24];
const TIME_ZONES = ['Europe/Madrid', 'Atlantic/Canary', 'Europe/Kyiv', 'Europe/Moscow', 'UTC'];

function normalizeTimeZone(value) {
  return TIME_ZONES.includes(String(value || '')) ? String(value) : 'Europe/Madrid';
}

function normalizePipelineStage(value, inquiry = {}) {
  const stage = cleanText(value, 24);
  if (PIPELINE_STAGES.includes(stage)) return stage;
  // Old closed conversations have no reliable sales outcome. They stay out
  // of the active funnel until the administrator explicitly marks the result.
  if (inquiry.status === 'closed') return '';
  if (inquiry.type === 'viewing') return 'viewing';
  if (inquiry.type === 'selection') return 'selection';
  if (inquiry.status === 'in_progress') return 'contact';
  return 'new';
}

// «Как купить в Испании»: пять коротких экранов для покупателя из другой
// страны. Тексты правятся в панели, как «О компании», — здесь только то, с
// чего владелец начнёт.
const DEFAULT_GUIDE_PAGES = [
  {
    id: 'nie',
    title: { ru: '1. NIE — номер иностранца', en: '1. NIE — foreigner number', es: '1. NIE — número de extranjero' },
    text: {
      ru: 'NIE — личный номер иностранца в Испании. Без него нельзя купить недвижимость, открыть счёт и подписать договоры. Оформляется в полиции или в консульстве, обычно за 1–3 недели. Мы помогаем записаться и собрать документы.',
      en: 'The NIE is a personal number for foreigners in Spain. Without it you cannot buy property, open a bank account or sign contracts. It is issued by the police or a consulate, usually within 1–3 weeks. We help you book the appointment and prepare the papers.',
      es: 'El NIE es el número personal de extranjero en España. Sin él no se puede comprar vivienda, abrir cuenta ni firmar contratos. Se tramita en la policía o en el consulado, normalmente en 1–3 semanas. Te ayudamos con la cita y los documentos.',
    },
  },
  {
    id: 'deal',
    title: { ru: '2. Этапы сделки', en: '2. Stages of a purchase', es: '2. Etapas de la compra' },
    text: {
      ru: 'Обычный порядок: выбор объекта → резерв (обычно 3 000–6 000 €) → проверка документов юристом → договор купли-продажи с задатком 10% → подписание у нотариуса и полный расчёт → регистрация. От резерва до нотариуса чаще всего проходит 4–8 недель.',
      en: 'The usual order: choose a property → reservation (usually €3,000–6,000) → legal checks → private contract with a 10% deposit → signing at the notary and full payment → registration. From reservation to notary it usually takes 4–8 weeks.',
      es: 'El orden habitual: elegir el inmueble → reserva (normalmente 3.000–6.000 €) → comprobación legal → contrato de arras con el 10% → firma ante notario y pago total → inscripción. De la reserva al notario suelen pasar 4–8 semanas.',
    },
  },
  {
    id: 'costs',
    title: { ru: '3. Сколько стоит сделка', en: '3. What the purchase costs', es: '3. Cuánto cuesta la compra' },
    text: {
      ru: 'Сверх цены объекта закладывайте 10–14%: налог (ITP на вторичное жильё или IVA на новостройку), нотариус, регистрация, оформление. Точную сумму по конкретному объекту бот считает в калькуляторе на карточке.',
      en: 'On top of the price, allow 10–14%: tax (ITP for resale or IVA for new builds), notary, registration and paperwork. The bot calculates the exact amount for a given property in the calculator on its card.',
      es: 'Además del precio, cuenta con un 10–14%: impuesto (ITP en segunda mano o IVA en obra nueva), notaría, registro y gestión. El importe exacto de cada inmueble lo calcula el bot en la ficha.',
    },
  },
  {
    id: 'mortgage',
    title: { ru: '4. Ипотека для нерезидентов', en: '4. Mortgage for non-residents', es: '4. Hipoteca para no residentes' },
    text: {
      ru: 'Испанские банки дают нерезидентам обычно до 60–70% стоимости, срок — до 20–25 лет. Нужны справка о доходах, выписки по счетам и NIE. Решение банка занимает 2–4 недели, поэтому начинать стоит вместе с поиском объекта.',
      en: 'Spanish banks usually lend non-residents up to 60–70% of the price for 20–25 years. You will need proof of income, bank statements and a NIE. A decision takes 2–4 weeks, so it is worth starting alongside the property search.',
      es: 'Los bancos españoles suelen financiar a no residentes hasta el 60–70% del precio, a 20–25 años. Hacen falta justificantes de ingresos, extractos y el NIE. La respuesta tarda 2–4 semanas, así que conviene empezar junto con la búsqueda.',
    },
  },
  {
    id: 'rent',
    title: { ru: '5. Аренда и содержание', en: '5. Renting out and upkeep', es: '5. Alquiler y mantenimiento' },
    text: {
      ru: 'Купленное жильё можно сдавать: для посуточной аренды нужна туристическая лицензия, для долгосрочной — обычный договор. Содержание — комунидад, налог на недвижимость (IBI), свет и вода. Мы подскажем, что подходит именно вашему объекту.',
      en: 'You can let the property out: short stays need a tourist licence, long lets use an ordinary contract. Running costs are the community fee, property tax (IBI), electricity and water. We will tell you what suits your property.',
      es: 'La vivienda se puede alquilar: para estancias cortas hace falta licencia turística, para larga duración basta un contrato normal. Los gastos son comunidad, IBI, luz y agua. Te diremos qué encaja con tu inmueble.',
    },
  },
];

// «Мой план покупки»: чек-лист шагов для покупателя из другой страны. Порядок и
// набор шагов заданы ботом, тексты владелец правит в панели. Формулировки
// нарочно осторожные («обычно», «часто»): это ориентир, а не юридическая
// консультация — сроки и суммы зависят от случая.
const DEFAULT_BUY_PLAN = [
  {
    id: 'nie',
    title: { ru: 'NIE — номер иностранца', en: 'NIE — foreigner number', es: 'NIE — número de extranjero' },
    text: {
      ru: 'Он нужен для покупки, банковского счёта и договоров. Обычно оформляется в полиции или консульстве; сроки зависят от места и записи на приём.',
      en: 'You need it to buy, to open a bank account and to sign contracts. It is usually issued by the police or a consulate; timing depends on the place and appointment availability.',
      es: 'Hace falta para comprar, abrir una cuenta y firmar contratos. Suele tramitarse en la policía o en un consulado; los plazos dependen del lugar y de las citas disponibles.',
    },
  },
  {
    id: 'bank',
    title: { ru: 'Банковский счёт в Испании', en: 'A bank account in Spain', es: 'Cuenta bancaria en España' },
    text: {
      ru: 'Через него обычно проходят задаток, налоги и коммунальные платежи. Как правило, нужны NIE, паспорт и подтверждение источника средств.',
      en: 'Usually the deposit, taxes and utility bills go through it. You typically need the NIE, a passport and proof of where the funds come from.',
      es: 'Normalmente se usa para la señal, los impuestos y los suministros. Suelen pedir el NIE, el pasaporte y justificar el origen de los fondos.',
    },
  },
  {
    id: 'lawyer',
    title: { ru: 'Независимый юрист', en: 'An independent lawyer', es: 'Un abogado independiente' },
    text: {
      ru: 'Юрист проверяет документы объекта, долги и обременения, а также договор. Лучше выбрать своего, а не юриста продавца; его услуги обычно оплачиваются отдельно.',
      en: 'A lawyer checks the property documents, debts and charges, and the contract. It is best to have your own rather than the seller’s; fees are usually paid separately.',
      es: 'El abogado revisa la documentación, las deudas y cargas, y el contrato. Conviene tener el propio y no el del vendedor; sus honorarios suelen pagarse aparte.',
    },
  },
  {
    id: 'mortgage',
    title: { ru: 'Ипотека (если нужна)', en: 'A mortgage (if you need one)', es: 'Hipoteca (si la necesitas)' },
    text: {
      ru: 'Нерезидентам банки обычно финансируют часть цены, остальное — собственные средства. Предварительное одобрение помогает понять бюджет до поиска объекта.',
      en: 'Banks usually finance non-residents for part of the price; the rest is your own funds. A pre-approval helps you understand your budget before you search.',
      es: 'Los bancos suelen financiar a los no residentes una parte del precio; el resto son fondos propios. Una preaprobación ayuda a conocer el presupuesto antes de buscar.',
    },
  },
  {
    id: 'search',
    title: { ru: 'Подбор объектов', en: 'Finding properties', es: 'Búsqueda de inmuebles' },
    text: {
      ru: 'Определите бюджет, район и то, что для вас важно; посмотрите варианты в каталоге бота или отправьте заявку на подбор — менеджер поможет сузить выбор.',
      en: 'Decide your budget, area and priorities; browse the bot’s catalog or send a selection request and an agent will help narrow the choice.',
      es: 'Define tu presupuesto, zona y prioridades; mira el catálogo del bot o envía una solicitud de búsqueda y un asesor te ayudará a acotar.',
    },
  },
  {
    id: 'viewing',
    title: { ru: 'Просмотр', en: 'Viewing', es: 'Visita' },
    text: {
      ru: 'Запишитесь на просмотр в боте: лично или онлайн по видеосвязи. Возьмите документ и список вопросов; спросите про расходы на содержание.',
      en: 'Book a viewing in the bot, in person or online by video. Bring an ID and a list of questions, and ask about running costs.',
      es: 'Reserva la visita en el bot, en persona o por videollamada. Lleva un documento y tus preguntas, y pregunta por los gastos de mantenimiento.',
    },
  },
  {
    id: 'reservation',
    title: { ru: 'Резервация', en: 'Reservation', es: 'Reserva' },
    text: {
      ru: 'Когда объект выбран, его обычно резервируют небольшой суммой — он снимается с продажи на оговорённый срок. Условия возврата уточняйте письменно.',
      en: 'Once you have chosen, the property is usually reserved with a small sum and taken off the market for an agreed period. Confirm the refund terms in writing.',
      es: 'Al elegir, el inmueble suele reservarse con una pequeña cantidad y se retira del mercado por un plazo acordado. Confirma por escrito las condiciones de devolución.',
    },
  },
  {
    id: 'contract',
    title: { ru: 'Контракт с задатком', en: 'Contract with a deposit', es: 'Contrato con señal' },
    text: {
      ru: 'Обычно подписывается предварительный договор с задатком (часто около 10% цены). Перед подписью его должен проверить ваш юрист.',
      en: 'A preliminary contract with a deposit (often around 10% of the price) is usually signed. Your lawyer should review it before you sign.',
      es: 'Normalmente se firma un contrato de arras con una señal (a menudo en torno al 10% del precio). Tu abogado debe revisarlo antes de firmar.',
    },
  },
  {
    id: 'notary',
    title: { ru: 'Нотариус', en: 'The notary', es: 'La notaría' },
    text: {
      ru: 'Основной договор подписывается у нотариуса: остаток оплаты, налоги и передача ключей. Приехать можно лично или оформить доверенность.',
      en: 'The deed is signed at the notary: the remaining payment, taxes and handover of the keys. You can attend in person or use a power of attorney.',
      es: 'La escritura se firma ante notario: pago del resto, impuestos y entrega de llaves. Puedes acudir en persona o mediante poder.',
    },
  },
  {
    id: 'register',
    title: { ru: 'Регистрация и коммунальные услуги', en: 'Registration and utilities', es: 'Inscripción y suministros' },
    text: {
      ru: 'После сделки право собственности регистрируют в реестре, а коммунальные услуги и налоги на недвижимость переоформляют на вас. Обычно этим занимается юрист или агент.',
      en: 'After completion the ownership is registered, and utilities and property taxes are put in your name. A lawyer or agent usually handles this.',
      es: 'Tras la compra se inscribe la propiedad y se ponen a tu nombre los suministros e impuestos. Normalmente lo gestiona el abogado o la agencia.',
    },
  },
];

function normalizeBuyPlan(value) {
  const saved = Array.isArray(value) ? value : [];
  return DEFAULT_BUY_PLAN.map((step) => {
    const stored = saved.find((item) => item && item.id === step.id) || {};
    return {
      id: step.id,
      title: Object.fromEntries(['ru', 'en', 'es'].map((language) => [language, cleanText((stored.title || {})[language], 120) || step.title[language]])),
      text: Object.fromEntries(['ru', 'en', 'es'].map((language) => [language, cleanText((stored.text || {})[language], 1500) || step.text[language]])),
    };
  });
}

const defaultData = {
  version: DATA_VERSION,
  config: {
    botToken: '',
    adminChatId: '',
    adminNotificationVerifiedAt: '',
    passwordSalt: '',
    passwordHash: '',
    messages: {
      ru: {
        greeting: 'Здравствуйте, {first_name}! Рад вас видеть. Чем могу помочь?',
        help: '👋 Чем я могу помочь?\n\n🏘 Объекты — посмотреть недвижимость\n✨ Подбор — рассказать, что вы ищете, и получить подходящие варианты\n💬 Связаться — задать вопрос, заказать звонок или написать в WhatsApp\n👤 Моё — избранное, сравнение, заявки, уведомления и ваши данные\n\nВы также можете написать вопрос обычным сообщением. Менеджер ответит в этом чате.',
        fallback: 'Спасибо! Сообщение получено. Менеджер ответит в этом чате.',
      },
      en: {
        greeting: 'Hello, {first_name}! Nice to meet you. How can I help?',
        help: '👋 How can I help?\n\n🏘 Properties — browse available real estate\n✨ Help me choose — tell us what you are looking for and get matching options\n💬 Contact us — ask a question, request a call or write on WhatsApp\n👤 My account — saved properties, comparison, requests, notifications and your data\n\nYou can also send a regular message. An agent will reply in this chat.',
        fallback: 'Thank you! Your message has been received. An agent will reply in this chat.',
      },
      es: {
        greeting: '¡Hola, {first_name}! Me alegra verte. ¿Cómo puedo ayudarte?',
        help: '👋 ¿Cómo puedo ayudarte?\n\n🏘 Inmuebles — ver las propiedades disponibles\n✨ Buscar por mí — cuéntanos qué buscas y recibe opciones adecuadas\n💬 Contactar — hacer una pregunta, pedir una llamada o escribir por WhatsApp\n👤 Mi espacio — inmuebles guardados, comparación, solicitudes, avisos y tus datos\n\nTambién puedes enviar un mensaje normal. Un asesor responderá en este chat.',
        fallback: '¡Gracias! Hemos recibido tu mensaje. Un asesor responderá en este chat.',
      },
    },
    menu: {
      ru: {
        objects: 'Информация о наших объектах скоро появится.',
        contacts: 'Добавьте контактные данные в панели администратора.',
        promotions: 'Актуальных акций пока нет.',
        about: 'Добавьте информацию о компании в панели администратора.',
      },
      en: {
        objects: 'Information about our properties will be available soon.',
        contacts: 'Add your contact details in the admin panel.',
        promotions: 'There are no current special offers.',
        about: 'Add information about the company in the admin panel.',
      },
      es: {
        objects: 'La información sobre nuestras propiedades estará disponible pronto.',
        contacts: 'Añade tus datos de contacto en el panel de administración.',
        promotions: 'No hay promociones disponibles actualmente.',
        about: 'Añade información sobre la empresa en el panel de administración.',
      },
    },
    active: true,
    notifyMode: 'inquiries',
    reminderHours: 2,
    timeZone: 'Europe/Madrid',
    remoteAccess: false,
    tunnelToken: '',
    tunnelHostname: '',
  },
  bot: {
    id: null,
    username: '',
    firstName: '',
  },
  rules: [
    {
      id: 'welcome-demo',
      trigger: 'привет',
      type: 'contains',
      answer: 'Привет! Чем могу помочь?',
      language: 'ru',
      enabled: true,
      createdAt: new Date().toISOString(),
    },
  ],
  users: {},
  welcomeImages: { ru: null, en: null, es: null },
  objects: [],
  promotions: [],
  contacts: {
    managerName: '',
    phone: '',
    whatsapp: '',
    whatsappEnabled: true,
    telegram: '',
    email: '',
    website: '',
    mapUrl: '',
    // Фото менеджера: клиент видит его над экраном «Связаться».
    photo: null,
    text: { ru: '', en: '', es: '' },
  },
  interfaceText: {},
  // «Почему мы»: то, что владелец сам решил показать клиентам как основание для
  // доверия. Пока пусто, экран клиентам не показывается; ничего не подставляется.
  trust: { yearsOnMarket: 0, dealsCount: 0, registration: '', officeAddress: '', reviewsUrl: '', reviews: [] },
  guidePages: clone(DEFAULT_GUIDE_PAGES),
  buyPlan: clone(DEFAULT_BUY_PLAN),
  groups: [],
  groupPosts: [],
  stats: {
    messagesReceived: 0,
    messagesSent: 0,
    reactionsReceived: 0,
    startedAt: null,
    lastUpdateAt: null,
  },
  analytics: { daily: {}, properties: {} },
  errors: [],
  adminNotificationStates: {},
  broadcasts: [],
  inquiries: [],
  replyTemplates: [],
  adminReplyTargets: {},
  adminReplyTargetsSince: '',
  sharedLists: {},
  telegramOffset: 0,
  // Номера последних обработанных обновлений: защита от повторной обработки
  // после нештатной остановки.
  handledUpdateIds: [],
};

function normalizeStoredImages(record) {
  const source = Array.isArray(record && record.images) && record.images.length
    ? record.images
    : record && record.image
      ? [record.image]
      : [];
  return source.filter((image) => image && typeof image === 'object' && (image.dataBase64 || image.storageFile)).slice(0, 10).map((image) => ({
    ...image,
    id: cleanText(image.id, 80) || crypto.randomUUID(),
  }));
}

function normalizePropertyImages(record) {
  const stored = record && record.imagesByLanguage;
  if (stored && typeof stored === 'object' && !Array.isArray(stored)) {
    return Object.fromEntries(['ru', 'en', 'es'].map((language) => [
      language,
      normalizeStoredImages({ images: Array.isArray(stored[language]) ? stored[language] : [] }),
    ]));
  }
  // Images from older versions are treated as Russian so they are never
  // accidentally shown to English- or Spanish-speaking users.
  return { ru: normalizeStoredImages(record || {}), en: [], es: [] };
}

function normalizeAdminNotificationStates(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return Object.fromEntries(Object.entries(value).slice(0, 1000).map(([id, state]) => {
    const source = state && typeof state === 'object' && !Array.isArray(state) ? state : {};
    const snapshot = source.snapshot && typeof source.snapshot === 'object' ? source.snapshot : null;
    return [cleanText(id, 240), {
      readAt: cleanText(source.readAt, 40),
      handledAt: cleanText(source.handledAt, 40),
      snapshot: snapshot ? {
        id: cleanText(snapshot.id || id, 240), kind: cleanText(snapshot.kind, 30), severity: cleanText(snapshot.severity, 20),
        title: cleanText(snapshot.title, 180), text: cleanText(snapshot.text, 500), createdAt: cleanText(snapshot.createdAt, 40),
        route: {
          view: cleanText(snapshot.route && snapshot.route.view, 40), tab: cleanText(snapshot.route && snapshot.route.tab, 40),
          inquiryId: cleanText(snapshot.route && snapshot.route.inquiryId, 100),
        },
      } : null,
    }];
  }).filter(([id]) => id));
}

function normalizeLocalizedField(value, maximum) {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return Object.fromEntries(['ru', 'en', 'es'].map((language) => [language, cleanText(value[language], maximum)]));
  }
  const legacy = cleanText(value, maximum);
  return { ru: legacy, en: legacy, es: legacy };
}

// One-time upgrade of texts that still equal defaults from older versions.
function migrateDefaultTexts(messages) {
  if (messages.ru.help === 'Отправьте сообщение, и я постараюсь подобрать ответ.' || messages.ru.help.startsWith('Отправьте сообщение, и я постараюсь подобрать ответ. Чтобы сменить язык')) {
    messages.ru.help = defaultData.config.messages.ru.help;
  }
  if (messages.en.help.includes('Use the main menu buttons:') && !messages.en.help.includes('❤️ Favorites')) {
    messages.en.help = defaultData.config.messages.en.help;
  }
  if (messages.es.help.includes('Utiliza los botones del menú principal:') && !messages.es.help.includes('❤️ Favoritos')) {
    messages.es.help = defaultData.config.messages.es.help;
  }
  if (messages.ru.help.includes('Оставить заявку') || messages.ru.help.includes('☎️ Контакты')) messages.ru.help = defaultData.config.messages.ru.help;
  if (messages.en.help.includes('Contact a manager — request a call') || messages.en.help.includes('☎️ Contacts')) messages.en.help = defaultData.config.messages.en.help;
  if (messages.es.help.includes('Contactar con un gestor — solicitar una llamada') || messages.es.help.includes('☎️ Contactos')) messages.es.help = defaultData.config.messages.es.help;
  if (messages.ru.help.includes('🏘 Наши объекты —') && messages.ru.help.includes('❤️ Избранное —') && !messages.ru.help.includes('✨ Помогите подобрать объект')) messages.ru.help = defaultData.config.messages.ru.help;
  if (messages.en.help.includes('🏘 Our properties —') && messages.en.help.includes('❤️ Favorites —') && !messages.en.help.includes('✨ Help me find a property')) messages.en.help = defaultData.config.messages.en.help;
  if (messages.es.help.includes('🏘 Nuestros inmuebles —') && messages.es.help.includes('❤️ Favoritos —') && !messages.es.help.includes('✨ Ayúdame a elegir')) messages.es.help = defaultData.config.messages.es.help;
  if (!messages.ru.help.includes('☰ Ещё') && messages.ru.help.includes('ℹ️ О компании —') && messages.ru.help.includes('❓ Помощь —')) messages.ru.help = defaultData.config.messages.ru.help;
  if (!messages.en.help.includes('☰ More') && messages.en.help.includes('ℹ️ About —') && messages.en.help.includes('❓ Help —')) messages.en.help = defaultData.config.messages.en.help;
  if (!messages.es.help.includes('☰ Más') && messages.es.help.includes('ℹ️ La empresa —') && messages.es.help.includes('❓ Ayuda —')) messages.es.help = defaultData.config.messages.es.help;
  if (messages.ru.fallback === 'Спасибо за сообщение! Я передал его администратору.') messages.ru.fallback = defaultData.config.messages.ru.fallback;
  if (messages.en.fallback === 'Thank you for your message! I have passed it on to the administrator.') messages.en.fallback = defaultData.config.messages.en.fallback;
  if (messages.es.fallback === '¡Gracias por tu mensaje! Se lo he enviado al administrador.') messages.es.fallback = defaultData.config.messages.es.fallback;
}

// Версия 39. До неё панель и бот записывали в bot-data.json все тексты
// интерфейса целиком, вместе с теми, что владелец не менял. Сохранённое
// перекрывало словарь: после правки формулировок клиент продолжал видеть
// старые («gestor», «manager», кнопки, которых уже нет). Теперь из сохранённого
// убираем строки, равные прежним или нынешним значениям по умолчанию; всё,
// что владелец написал сам, остаётся. Прежняя подмена «агент → менеджер» при
// загрузке (managerTerminology) убрана — она перекрывала словарь так же.
// Тексты помощи, которые бот сам записывал в прежних версиях (заводские значения
// всех трёх языков), — по отпечаткам. Заменяется только помощь, ЦЕЛИКОМ равная
// одному из них: раньше заменялась любая, где встречалась хотя бы одна прежняя
// строка вроде «❤️ Избранное —», и правки владельца, оставившего эту строку рядом
// со своими, пропадали.
const OBSOLETE_HELP_HASHES = new Set([
  'bd3bace420b2',
  '786a39f7a115',
  'a82a9493e102',
  '60cf498acefe',
  'b6da5ba6f618',
  'a4f05a836c29',
  'a19b9feb0d69',
  'a815969e6310',
  '778d6d9628f1',
  '7251fec1b856',
  '87f2e4278220',
  '868cefb9d998',
  '819bd0a718ae',
  'b81345b512d7',
  '55afec8125d1',
  '830b95eb287a',
  '44427f9107af',
  'be206e3580cb',
]);
// Приветствие на английском и испанском было презентацией компании из четырёх
// абзацев (350–400 знаков), а русское — короткое. Презентация живёт в «О
// компании» (menu.*.about), приветствию она не нужна: клиент видит её вместе с
// подсказкой и сводкой каталога, и первый экран не помещается. Заменяем только
// эти два известных текста; приветствие, написанное иначе, остаётся.
const OBSOLETE_GREETINGS = {
  en: '🏗️ Welcome to Construcciones Kornilenko! 👋\n\n🏡 We specialize in building cottages and private homes, creating modern, reliable, and comfortable spaces for everyday living.\n\nIn this bot, you can explore our services, learn more about our company, and quickly get in touch with our team.\n\n🤝 Quality construction. Responsible work. Homes made for living.',
  es: '¡Bienvenido a Construcciones Kornilenko! 👋\n\n🏡 Nos especializamos en la construcción de chalets y viviendas unifamiliares, creando espacios modernos, fiables y confortables para vivir.\n\nEn este bot puedes conocer nuestros servicios, obtener más información sobre la empresa y contactar rápidamente con nuestro equipo.\n\n🤝 Construimos con calidad. Trabajamos con responsabilidad. Creamos hogares para vivir.',
};
const OBSOLETE_FALLBACKS = {
  en: ['Thank you! Your message has been received. A manager will reply in this chat.', 'Thank you for your message! I have passed it on to the administrator.'],
  es: ['¡Gracias! Hemos recibido tu mensaje. Un gestor responderá en este chat.', '¡Gracias por tu mensaje! Se lo he enviado al administrador.'],
};
const textFingerprint = (value) => crypto.createHash('sha1').update(JSON.stringify(value)).digest('hex').slice(0, 12);
function migrateStaleTexts(interfaceText, messages) {
  const same = (first, second) => JSON.stringify(first) === JSON.stringify(second);
  for (const [group, languages] of Object.entries(INTERFACE_TEXT_DEFAULTS)) {
    for (const language of ['ru', 'en', 'es']) {
      const stored = interfaceText && interfaceText[group] && interfaceText[group][language];
      if (!stored || typeof stored !== 'object') continue;
      const previous = (PREVIOUS_INTERFACE_TEXTS[group] && PREVIOUS_INTERFACE_TEXTS[group][language]) || {};
      for (const [key, fallback] of Object.entries(languages[language])) {
        if (!Object.hasOwn(stored, key)) continue;
        const value = stored[key];
        // Сохранённое равно нынешнему значению, прежнему значению по умолчанию
        // (в том числе тому, что было в версии 38) или испорчено («[object
        // Object]» вместо набора названий).
        const spoiled = fallback && typeof fallback === 'object' && !Array.isArray(fallback) && typeof value === 'string';
        const wasDefault = VERSION_38_DEFAULT_HASHES[group + '.' + language + '.' + key] === textFingerprint(value);
        if (same(value, fallback) || (previous[key] || []).some((old) => same(old, value)) || wasDefault || spoiled) delete stored[key];
      }
    }
  }
  for (const language of ['ru', 'en', 'es']) {
    const current = messages[language];
    if (!current) continue;
    const help = String(current.help || '');
    if (help && OBSOLETE_HELP_HASHES.has(textFingerprint(help))) current.help = defaultData.config.messages[language].help;
    if (language !== 'ru' && OBSOLETE_GREETINGS[language] === String(current.greeting || '')) current.greeting = defaultData.config.messages[language].greeting;
    if (language !== 'ru' && OBSOLETE_FALLBACKS[language].includes(String(current.fallback || ''))) current.fallback = defaultData.config.messages[language].fallback;
  }
}

// Version 16 added "property type" as step 2 of the selection form. Saved
// texts (the defaults are stored too) still say "1 of 4"; their step numbers
// are moved, keeping any wording the administrator changed.
const SELECTION_STEP_NUMBERS = { askDeal: 1, askLocation: 3, askBudget: 4, askBedrooms: 5 };

function migrateSelectionSteps(interfaceText) {
  const form = interfaceText && interfaceText.selectionForm;
  if (!form || typeof form !== 'object') return;
  for (const language of ['ru', 'en', 'es']) {
    const texts = form[language];
    if (!texts || typeof texts !== 'object') continue;
    for (const [key, step] of Object.entries(SELECTION_STEP_NUMBERS)) {
      if (typeof texts[key] !== 'string') continue;
      texts[key] = texts[key].replace(/^\s*[1-4]\s+(из|of|de)\s+4\./u, (match, word) => step + ' ' + word + ' 5.');
    }
  }
}

// Version 17 shortened the main menu buttons and moved "Call me back" onto
// the main keyboard. Saved labels and help texts (the defaults are stored
// too) that still equal the old defaults get the new ones; wording the
// administrator changed is kept.
const PREVIOUS_MENU_DEFAULTS = {
  ru: { objects: '🏘 Наши объекты', selection: '✨ Помогите подобрать объект', contacts: '💬 Связаться с менеджером', request: '📞 Заказать звонок' },
  en: { objects: '🏘 Our properties', selection: '✨ Help me find a property', contacts: '💬 Contact a manager', request: '📞 Request a call' },
  es: { objects: '🏘 Nuestros inmuebles', selection: '✨ Ayúdame a elegir', contacts: '💬 Contactar con un gestor', request: '📞 Solicitar una llamada' },
};
const PREVIOUS_HELP_DEFAULTS = {
  ru: '👋 Чем я могу помочь?\n\n🏘 Наши объекты — посмотреть недвижимость\n✨ Помогите подобрать объект — оставить пожелания менеджеру\n❤️ Избранное — вернуться к сохранённым объектам\n🔥 Акции — посмотреть специальные предложения\n💬 Связаться с менеджером — задать вопрос или заказать звонок\n☰ Ещё — открыть информацию о компании и помощь\n🌐 Сменить язык — выбрать другой язык\n\nВы также можете написать вопрос обычным сообщением. Менеджер ответит в этом чате.',
  en: '👋 How can I help?\n\n🏘 Our properties — browse available real estate\n✨ Help me find a property — send your preferences to a manager\n❤️ Favorites — return to saved properties\n🔥 Offers — view current promotions\n💬 Contact a manager — ask a question or request a call\n☰ More — open company information and help\n🌐 Change language — select another language\n\nYou can also send a regular message. A manager will reply in this chat.',
  es: '👋 ¿Cómo puedo ayudarte?\n\n🏘 Nuestros inmuebles — ver las propiedades disponibles\n✨ Ayúdame a elegir — enviar tus preferencias a un gestor\n❤️ Favoritos — volver a los inmuebles guardados\n🔥 Promociones — consultar las ofertas actuales\n💬 Contactar con un gestor — hacer una pregunta o solicitar una llamada\n☰ Más — abrir la información de la empresa y la ayuda\n🌐 Cambiar idioma — seleccionar otro idioma\n\nTambién puedes enviar un mensaje normal. Un gestor responderá en este chat.',
};

// Версия 48: английские и испанские ярлыки и фразы «как родные» («Help me choose», «My account»,
// «Buscar por mí»). Прежние значения по умолчанию, оставшиеся у владельца нетронутыми, заменяются на
// новые; то, что он правил сам, не трогаем.
const V47_WORDING = {
  en: { greeting: 'Hello, {first_name}! Glad to see you. How can I help?', help: '👋 How can I help?\n\n🏘 Properties — browse available real estate\n✨ Find for me — tell us what you are looking for and get matching options\n💬 Contact us — ask a question, request a call or write on WhatsApp\n👤 My space — saved properties, comparison, requests, notifications and your data\n\nYou can also send a regular message. An agent will reply in this chat.' },
  es: { help: '👋 ¿Cómo puedo ayudarte?\n\n🏘 Inmuebles — ver las propiedades disponibles\n✨ Búsqueda — cuéntanos qué buscas y recibe opciones adecuadas\n💬 Contactar — hacer una pregunta, pedir una llamada o escribir por WhatsApp\n👤 Mi espacio — inmuebles guardados, comparación, solicitudes, avisos y tus datos\n\nTambién puedes enviar un mensaje normal. Un asesor responderá en este chat.' },
};
const V47_MENU_LABELS = {
  en: { selection: '✨ Find for me', more: '👤 My space' },
  es: { selection: '✨ Búsqueda' },
};

function migrateWording(interfaceText, messages) {
  for (const language of ['en', 'es']) {
    const saved = messages && messages[language];
    for (const [key, previous] of Object.entries(V47_WORDING[language])) {
      if (saved && saved[key] === previous) saved[key] = defaultData.config.messages[language][key];
    }
    const labels = interfaceText && interfaceText.menuLabels && interfaceText.menuLabels[language];
    if (labels && typeof labels === 'object') {
      for (const [key, previous] of Object.entries(V47_MENU_LABELS[language])) {
        if (labels[key] === previous) labels[key] = INTERFACE_TEXT_DEFAULTS.menuLabels[language][key];
      }
    }
  }
}

function migrateShortMenu(interfaceText, messages) {
  const labels = interfaceText && interfaceText.menuLabels;
  for (const language of ['ru', 'en', 'es']) {
    const saved = labels && labels[language];
    if (saved && typeof saved === 'object') {
      for (const [key, previous] of Object.entries(PREVIOUS_MENU_DEFAULTS[language])) {
        if (saved[key] === previous) saved[key] = INTERFACE_TEXT_DEFAULTS.menuLabels[language][key];
      }
    }
    if (messages && messages[language] && messages[language].help === PREVIOUS_HELP_DEFAULTS[language]) {
      messages[language].help = defaultData.config.messages[language].help;
    }
  }
}

// Version 18 turns the former catch-all "More" screen into a personal area.
// Only untouched defaults are renamed; administrator wording is preserved.
const VERSION_17_MY_DEFAULTS = {
  ru: {
    label: '☰ Ещё',
    help: '👋 Чем я могу помочь?\n\n🏘 Объекты — посмотреть недвижимость\n✨ Подбор — рассказать, что вы ищете, и получить подходящие варианты\n❤️ Избранное — вернуться к сохранённым объектам\n🔥 Акции — специальные предложения\n📞 Позвоните мне — менеджер перезвонит в удобное время\n💬 Менеджер — задать вопрос, позвонить или написать в WhatsApp\n☰ Ещё — мои заявки, уведомления, о компании, смена языка\n\nВы также можете написать вопрос обычным сообщением. Менеджер ответит в этом чате.',
    newsOff: 'Вы отписались от рассылок. Включить их снова можно в «☰ Ещё → 🔔 Уведомления».',
    viewingFooter: 'Если планы изменятся, откройте «☰ Ещё → 📋 Мои заявки» или просто напишите нам.',
  },
  en: {
    label: '☰ More',
    help: '👋 How can I help?\n\n🏘 Properties — browse available real estate\n✨ Find for me — tell us what you are looking for and get matching options\n❤️ Favorites — return to saved properties\n🔥 Offers — current promotions\n📞 Call me back — a manager will call you at a convenient time\n💬 Manager — ask a question, call or write on WhatsApp\n☰ More — my requests, notifications, about us, language\n\nYou can also send a regular message. A manager will reply in this chat.',
    newsOff: 'You have unsubscribed from our news. You can turn it back on in “☰ More → 🔔 Notifications”.',
    viewingFooter: 'If your plans change, open “☰ More → 📋 My requests” or just send us a message.',
  },
  es: {
    label: '☰ Más',
    help: '👋 ¿Cómo puedo ayudarte?\n\n🏘 Inmuebles — ver las propiedades disponibles\n✨ Búsqueda — cuéntanos qué buscas y recibe opciones adecuadas\n❤️ Favoritos — volver a los inmuebles guardados\n🔥 Promociones — ofertas actuales\n📞 Llámame — un gestor te llamará cuando te venga bien\n💬 Gestor — hacer una pregunta, llamar o escribir por WhatsApp\n☰ Más — mis solicitudes, avisos, la empresa, idioma\n\nTambién puedes enviar un mensaje normal. Un gestor responderá en este chat.',
    newsOff: 'Te has dado de baja de las novedades. Puedes activarlas de nuevo en «☰ Más → 🔔 Avisos».',
    viewingFooter: 'Si cambian tus planes, abre «☰ Más → 📋 Mis solicitudes» o escríbenos.',
  },
};

// Версия 35: короткое меню («Связаться» вместо «Менеджера»), подсказка про
// свободный поиск и такое же приглашение в поле ввода. Трогаем только те
// строки, которые остались прежними значениями по умолчанию.
const VERSION_34_DEFAULTS = {
  ru: { contacts: '💬 Менеджер', placeholder: 'Выберите раздел', hint: 'Выберите интересующий раздел в меню ниже 👇' },
  en: { contacts: '💬 Agent', placeholder: 'Choose a menu item', hint: 'Choose a section from the menu below 👇' },
  es: { contacts: '💬 Asesor', placeholder: 'Elige una opción', hint: 'Elige una sección del menú 👇' },
};

function migrateShortGreeting(interfaceText) {
  for (const language of ['ru', 'en', 'es']) {
    const previous = VERSION_34_DEFAULTS[language];
    const labels = interfaceText && interfaceText.menuLabels && interfaceText.menuLabels[language];
    if (labels && typeof labels === 'object') {
      if (labels.contacts === previous.contacts) labels.contacts = INTERFACE_TEXT_DEFAULTS.menuLabels[language].contacts;
      if (labels.placeholder === previous.placeholder) labels.placeholder = INTERFACE_TEXT_DEFAULTS.menuLabels[language].placeholder;
    }
    const hints = interfaceText && interfaceText.menuHints && interfaceText.menuHints[language];
    if (hints && typeof hints === 'object' && hints.text === previous.hint) {
      hints.text = INTERFACE_TEXT_DEFAULTS.menuHints[language].text;
    }
  }
}

function migrateMyArea(interfaceText, messages) {
  for (const language of ['ru', 'en', 'es']) {
    const previous = VERSION_17_MY_DEFAULTS[language];
    const labels = interfaceText && interfaceText.menuLabels && interfaceText.menuLabels[language];
    if (labels && labels.more === previous.label) labels.more = INTERFACE_TEXT_DEFAULTS.menuLabels[language].more;
    if (messages && messages[language] && messages[language].help === previous.help) messages[language].help = defaultData.config.messages[language].help;
    const subscriptions = interfaceText && interfaceText.subscriptions && interfaceText.subscriptions[language];
    if (subscriptions && subscriptions.newsOff === previous.newsOff) subscriptions.newsOff = INTERFACE_TEXT_DEFAULTS.subscriptions[language].newsOff;
    const notices = interfaceText && interfaceText.viewingNotices && interfaceText.viewingNotices[language];
    if (notices && notices.confirmedFooter === previous.viewingFooter) notices.confirmedFooter = INTERFACE_TEXT_DEFAULTS.viewingNotices[language].confirmedFooter;
  }
}

// Version 19 adds property comparison to the personal area. Keep wording
// written by the administrator and update only the exact version 18 defaults.
const VERSION_18_COMPARISON_DEFAULTS = {
  ru: {
    intro: 'Здесь собраны сохранённые объекты, история просмотров, ваши заявки и личные настройки.',
    help: '👋 Чем я могу помочь?\n\n🏘 Объекты — посмотреть недвижимость\n✨ Подбор — рассказать, что вы ищете, и получить подходящие варианты\n❤️ Избранное — вернуться к сохранённым объектам\n🔥 Акции — специальные предложения\n📞 Позвоните мне — менеджер перезвонит в удобное время\n💬 Менеджер — задать вопрос, позвонить или написать в WhatsApp\n👤 Моё — избранное, история просмотров, заявки и уведомления\n\nВы также можете написать вопрос обычным сообщением. Менеджер ответит в этом чате.',
  },
  en: {
    intro: 'Your saved properties, viewing history, requests and personal settings are all here.',
    help: '👋 How can I help?\n\n🏘 Properties — browse available real estate\n✨ Find for me — tell us what you are looking for and get matching options\n❤️ Favorites — return to saved properties\n🔥 Offers — current promotions\n📞 Call me back — a manager will call you at a convenient time\n💬 Manager — ask a question, call or write on WhatsApp\n👤 My space — favorites, recently viewed properties, requests and notifications\n\nYou can also send a regular message. A manager will reply in this chat.',
  },
  es: {
    intro: 'Aquí encontrarás los inmuebles guardados, el historial de visitas, tus solicitudes y ajustes personales.',
    help: '👋 ¿Cómo puedo ayudarte?\n\n🏘 Inmuebles — ver las propiedades disponibles\n✨ Búsqueda — cuéntanos qué buscas y recibe opciones adecuadas\n❤️ Favoritos — volver a los inmuebles guardados\n🔥 Promociones — ofertas actuales\n📞 Llámame — un gestor te llamará cuando te venga bien\n💬 Gestor — hacer una pregunta, llamar o escribir por WhatsApp\n👤 Mi espacio — favoritos, inmuebles vistos, solicitudes y avisos\n\nTambién puedes enviar un mensaje normal. Un gestor responderá en este chat.',
  },
};

function migrateComparison(interfaceText, messages) {
  for (const language of ['ru', 'en', 'es']) {
    const previous = VERSION_18_COMPARISON_DEFAULTS[language];
    const myArea = interfaceText && interfaceText.myArea && interfaceText.myArea[language];
    if (myArea && myArea.intro === previous.intro) myArea.intro = INTERFACE_TEXT_DEFAULTS.myArea[language].intro;
    if (messages && messages[language] && messages[language].help === previous.help) {
      messages[language].help = defaultData.config.messages[language].help;
    }
  }
}

// Version 20 adds the explicit saved search. As before, only untouched
// defaults are extended; administrator-written wording is never replaced.
const VERSION_19_SAVED_SEARCH_DEFAULTS = {
  ru: {
    intro: 'Здесь собраны сохранённые и сравниваемые объекты, история просмотров, ваши заявки и личные настройки.',
    help: '👋 Чем я могу помочь?\n\n🏘 Объекты — посмотреть недвижимость\n✨ Подбор — рассказать, что вы ищете, и получить подходящие варианты\n❤️ Избранное — вернуться к сохранённым объектам\n🔥 Акции — специальные предложения\n📞 Позвоните мне — менеджер перезвонит в удобное время\n💬 Менеджер — задать вопрос, позвонить или написать в WhatsApp\n👤 Моё — избранное, сравнение, история просмотров, заявки и уведомления\n\nВы также можете написать вопрос обычным сообщением. Менеджер ответит в этом чате.',
  },
  en: {
    intro: 'Your saved and compared properties, viewing history, requests and personal settings are all here.',
    help: '👋 How can I help?\n\n🏘 Properties — browse available real estate\n✨ Find for me — tell us what you are looking for and get matching options\n❤️ Favorites — return to saved properties\n🔥 Offers — current promotions\n📞 Call me back — a manager will call you at a convenient time\n💬 Manager — ask a question, call or write on WhatsApp\n👤 My space — favorites, comparison, recently viewed properties, requests and notifications\n\nYou can also send a regular message. A manager will reply in this chat.',
  },
  es: {
    intro: 'Aquí encontrarás los inmuebles guardados y comparados, el historial, tus solicitudes y ajustes personales.',
    help: '👋 ¿Cómo puedo ayudarte?\n\n🏘 Inmuebles — ver las propiedades disponibles\n✨ Búsqueda — cuéntanos qué buscas y recibe opciones adecuadas\n❤️ Favoritos — volver a los inmuebles guardados\n🔥 Promociones — ofertas actuales\n📞 Llámame — un gestor te llamará cuando te venga bien\n💬 Gestor — hacer una pregunta, llamar o escribir por WhatsApp\n👤 Mi espacio — favoritos, comparación, inmuebles vistos, solicitudes y avisos\n\nTambién puedes enviar un mensaje normal. Un gestor responderá en este chat.',
  },
};

function migrateSavedSearch(interfaceText, messages) {
  for (const language of ['ru', 'en', 'es']) {
    const previous = VERSION_19_SAVED_SEARCH_DEFAULTS[language];
    const myArea = interfaceText && interfaceText.myArea && interfaceText.myArea[language];
    if (myArea && myArea.intro === previous.intro) myArea.intro = INTERFACE_TEXT_DEFAULTS.myArea[language].intro;
    if (messages && messages[language] && messages[language].help === previous.help) {
      messages[language].help = defaultData.config.messages[language].help;
    }
  }
}

const SAVED_SEARCH_FEATURES = ['sea', 'pool', 'terrace', 'parking', 'garden'];
const SAVED_SEARCH_TYPES = new Set(['apartment', 'house', 'villa', 'townhouse', 'land', 'commercial', 'newbuild', 'other']);
function normalizeSavedSearchData(value) {
  const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  const incoming = source.filter && typeof source.filter === 'object' && !Array.isArray(source.filter) ? source.filter : {};
  const filter = {
    deal: ['sale', 'rent'].includes(incoming.deal) ? incoming.deal : '',
    type: SAVED_SEARCH_TYPES.has(incoming.type) ? incoming.type : '',
    bedrooms: [1, 2, 3, 4].includes(Number(incoming.bedrooms)) ? Number(incoming.bedrooms) : 0,
    city: cleanText(incoming.city, 160),
    district: cleanText(incoming.district, 160),
    minPrice: Number.isFinite(Number(incoming.minPrice)) && Number(incoming.minPrice) > 0 && Number(incoming.minPrice) <= 1000000000
      ? Math.round(Number(incoming.minPrice))
      : 0,
    maxPrice: Number.isFinite(Number(incoming.maxPrice)) && Number(incoming.maxPrice) > 0 && Number(incoming.maxPrice) <= 1000000000
      ? Math.round(Number(incoming.maxPrice))
      : 0,
    sort: '',
  };
  const features = Array.isArray(incoming.features) ? SAVED_SEARCH_FEATURES.filter((key) => incoming.features.includes(key)) : [];
  if (features.length) filter.features = features;
  if (filter.minPrice && filter.maxPrice && filter.minPrice > filter.maxPrice) filter.minPrice = 0;
  if (!filter.deal && !filter.type && !filter.bedrooms && !filter.city && !filter.district && !filter.minPrice && !filter.maxPrice && !features.length) return null;
  return {
    filter,
    enabled: source.enabled !== false,
    createdAt: cleanText(source.createdAt, 40),
    updatedAt: cleanText(source.updatedAt, 40),
  };
}

const SELECTION_MATCH_TIERS = new Set(['exact', 'close', 'consider']);
const SELECTION_MATCH_REASONS = new Set(['deal', 'type', 'location', 'budget', 'bedrooms', 'general']);
const SELECTION_MATCH_WARNINGS = new Set(['location', 'budgetClose', 'budgetHigh', 'priceMissing', 'currency', 'periodConverted', 'bedroomsClose', 'bedroomsMissing']);

function normalizeSelectionMatchDetails(value) {
  return (Array.isArray(value) ? value : []).map((item) => ({
    id: cleanText(item && item.id, 100),
    tier: SELECTION_MATCH_TIERS.has(item && item.tier) ? item.tier : 'consider',
    score: Math.max(0, Math.min(100, Math.round(Number(item && item.score) || 0))),
    reasons: (Array.isArray(item && item.reasons) ? item.reasons : []).filter((key) => SELECTION_MATCH_REASONS.has(key)).slice(0, 6),
    warnings: (Array.isArray(item && item.warnings) ? item.warnings : []).filter((key) => SELECTION_MATCH_WARNINGS.has(key)).slice(0, 8),
  })).filter((item) => item.id).slice(0, 20);
}

function normalizeSelectionMatching(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return {
    results: normalizeSelectionMatchDetails(value.results),
    generatedAt: cleanText(value.generatedAt, 40),
  };
}

// Оформление постов в группах и каналах: постоянная подпись под текстом и
// рубричные плашки — картинки с названием рубрики.
const MAX_RUBRICS = 12;
const MAX_POST_BUTTONS = 6;

function normalizePublishing(value) {
  const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  return {
    signature: cleanText(source.signature, 1000),
    signatureEnabled: source.signatureEnabled !== false,
    // Как отправлять подпись: как набрана, одной строкой или через разделитель.
    signatureWrap: ['keep', 'space', 'dot'].includes(source.signatureWrap) ? source.signatureWrap : 'keep',
    signatureQuote: Boolean(source.signatureQuote),
    signatureDivider: ['none', 'thin', 'bold', 'dots', 'dash'].includes(source.signatureDivider) ? source.signatureDivider : 'none',
    // Кнопки-ссылки под постом: по ним удобнее попадать, чем по значку в тексте.
    buttons: (Array.isArray(source.buttons) ? source.buttons : []).slice(0, MAX_POST_BUTTONS).map((item) => ({
      text: cleanText(item && item.text, 64),
      url: cleanText(item && item.url, 500),
    })).filter((item) => item.text && /^https?:\/\//i.test(item.url)),
    buttonsPerRow: [1, 2, 3].includes(Number(source.buttonsPerRow)) ? Number(source.buttonsPerRow) : 3,
    rubrics: (Array.isArray(source.rubrics) ? source.rubrics : []).slice(0, MAX_RUBRICS).map((item) => ({
      id: cleanText(item && item.id, 60) || crypto.randomUUID(),
      name: cleanText(item && item.name, 60),
      placement: ['top', 'separate'].includes(item && item.placement) ? item.placement : 'bottom',
      image: item && item.image && typeof item.image === 'object' ? item.image : null,
    })).filter((item) => item.name),
  };
}

// Groups and channels the bot is in, and what it saw there. A chat id is
// negative; messages are capped when loading too.
const GROUP_STATUSES = ['creator', 'administrator', 'member', 'restricted', 'left', 'kicked'];

// Темы форума (подгруппы). Список тем Telegram боту не отдаёт: он запоминает те,
// о которых узнал по сообщениям, или те, что добавили вручную. Тема «Общая» —
// номер 1, в неё сообщения уходят без номера темы.
function normalizeTopics(value) {
  if (!Array.isArray(value)) return [];
  const seen = new Set();
  const topics = [];
  for (const item of value) {
    const id = Math.floor(Number(item && item.id));
    if (!Number.isFinite(id) || id < 1 || seen.has(id)) continue;
    seen.add(id);
    topics.push({
      id,
      name: cleanText(item.name, 128),
      closed: Boolean(item.closed),
      manual: Boolean(item.manual),
      lastMessageAt: cleanText(item.lastMessageAt, 40),
    });
    if (topics.length >= 100) break;
  }
  return topics;
}

function normalizeGroups(value) {
  if (!Array.isArray(value)) return [];
  return value.filter((item) => item && /^-?\d{4,20}$/.test(String(item.id))).slice(0, 50).map((item) => ({
    id: String(item.id),
    title: cleanText(item.title, 200),
    type: cleanText(item.type, 20),
    username: cleanText(item.username, 60),
    status: GROUP_STATUSES.includes(item.status) ? item.status : 'member',
    rights: item.rights && typeof item.rights === 'object' && !Array.isArray(item.rights)
      ? Object.fromEntries(Object.entries(item.rights).slice(0, 20).map(([key, on]) => [cleanText(key, 40), Boolean(on)]))
      : {},
    memberCount: Math.max(0, Number(item.memberCount) || 0),
    memberCountAt: cleanText(item.memberCountAt, 40),
    isForum: Boolean(item.isForum),
    topics: normalizeTopics(item.topics),
    description: cleanText(item.description, 1000),
    inviteLink: cleanText(item.inviteLink, 200),
    pinnedMessageId: Math.max(0, Number(item.pinnedMessageId) || 0),
    messages: (Array.isArray(item.messages) ? item.messages : []).slice(-200).map((message) => ({
      messageId: Math.max(0, Number(message.messageId) || 0),
      userId: cleanText(message.userId, 40),
      name: cleanText(message.name, 120),
      username: cleanText(message.username, 60),
      text: cleanText(message.text, 1000),
      kind: cleanText(message.kind, 20) || 'text',
      fromBot: Boolean(message.fromBot),
      threadId: Math.max(0, Math.floor(Number(message.threadId)) || 0),
      date: cleanText(message.date, 40),
    })),
    joinRequests: (Array.isArray(item.joinRequests) ? item.joinRequests : []).slice(-100).map((request) => ({
      userId: cleanText(request.userId, 40),
      name: cleanText(request.name, 120),
      username: cleanText(request.username, 60),
      at: cleanText(request.at, 40),
    })),
    addedAt: cleanText(item.addedAt, 40),
    updatedAt: cleanText(item.updatedAt, 40),
    lastMessageAt: cleanText(item.lastMessageAt, 40),
    lastPostAt: cleanText(item.lastPostAt, 40),
    // Номер группы в метке источника («g3»): выдаётся один раз при первой публикации и не меняется.
    sourceCode: /^\d{1,4}$/.test(String(item.sourceCode || '')) ? String(item.sourceCode) : '',
    // Язык, на котором последний раз публиковали объявление: подставляется по умолчанию.
    listingLanguage: ['ru', 'en', 'es'].includes(item.listingLanguage) ? item.listingLanguage : '',
    lastError: cleanText(item.lastError, 500),
  }));
}

function normalizePublications(value) {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 30).map((item) => ({
    groupId: cleanText(item && item.groupId, 40),
    title: cleanText(item && item.title, 200),
    language: ['ru', 'en', 'es'].includes(item && item.language) ? item.language : 'ru',
    at: cleanText(item && item.at, 40),
    messageId: Math.max(0, Number(item && item.messageId) || 0),
    messageIds: (Array.isArray(item && item.messageIds) ? item.messageIds : []).map((value) => Math.max(0, Math.floor(Number(value)) || 0)).filter(Boolean).slice(0, 12),
    threadId: Math.max(0, Math.floor(Number(item && item.threadId)) || 0),
    captionId: Math.max(0, Math.floor(Number(item && item.captionId)) || 0),
    textId: Math.max(0, Math.floor(Number(item && item.textId)) || 0),
    layout: item && item.layout === 'split' ? 'split' : item && item.layout === 'single' ? 'single' : '',
    withoutSignature: Boolean(item && item.withoutSignature),
    ...(item && item.priceDrop === true ? { priceDrop: true } : {}),
    updatedAt: cleanText(item && item.updatedAt, 40),
    link: cleanText(item && item.link, 300),
  })).filter((item) => item.groupId);
}

function normalizeGroupPosts(value) {
  if (!Array.isArray(value)) return [];
  return value.slice(-100).map((item) => ({
    id: cleanText(item.id, 60) || crypto.randomUUID(),
    groupId: cleanText(item.groupId, 40),
    threadId: Math.max(0, Math.floor(Number(item.threadId)) || 0),
    text: cleanText(item.text, 4000),
    buttonText: cleanText(item.buttonText, 64),
    buttonUrl: cleanText(item.buttonUrl, 500),
    image: item.image && typeof item.image === 'object' ? item.image : null,
    rubricId: cleanText(item.rubricId, 60),
    withoutSignature: Boolean(item.withoutSignature),
    pin: Boolean(item.pin),
    notify: item.notify !== false,
    listing: item.listing && item.listing.objectId ? { objectId: cleanText(item.listing.objectId, 100), language: ['ru', 'en', 'es'].includes(item.listing.language) ? item.listing.language : 'ru', layout: item.listing.layout === 'split' ? 'split' : 'single', ...(item.listing.priceDrop === true ? { priceDrop: true } : {}) } : null,
    status: ['scheduled', 'sent', 'failed', 'cancelled'].includes(item.status) ? item.status : 'scheduled',
    sendAt: cleanText(item.sendAt, 40),
    sentAt: cleanText(item.sentAt, 40),
    createdAt: cleanText(item.createdAt, 40) || new Date().toISOString(),
    messageId: Math.max(0, Number(item.messageId) || 0),
    error: cleanText(item.error, 500),
    attempts: Math.max(0, Math.min(99, Number(item.attempts) || 0)),
  })).filter((item) => item.groupId);
}

// Analytics buckets for deleted properties are never shown, so drop them.
function pruneOrphanPropertyAnalytics(root) {
  const properties = root && root.analytics && root.analytics.properties;
  if (!properties || typeof properties !== 'object') return;
  const existing = new Set((Array.isArray(root.objects) ? root.objects : []).map((record) => String(record.id)));
  for (const id of Object.keys(properties)) if (!existing.has(id)) delete properties[id];
}

// Подборки, которыми клиенты делятся ссылкой: короткий код → список объектов. Живут 90 дней; хозяин нужен, чтобы удалить
// подборки вместе с его данными.
function normalizeSharedLists(value) {
  const result = {};
  if (!value || typeof value !== 'object' || Array.isArray(value)) return result;
  for (const [code, list] of Object.entries(value).slice(0, 1000)) {
    if (!/^[A-Za-z0-9_-]{6,32}$/.test(code) || !list || typeof list !== 'object') continue;
    const ids = (Array.isArray(list.ids) ? list.ids : []).map((id) => cleanText(id, 100)).filter(Boolean).slice(0, 20);
    if (!ids.length) continue;
    result[code] = {
      ids,
      owner: cleanText(list.owner, 40),
      createdAt: cleanText(list.createdAt, 40) || new Date().toISOString(),
      opens: Number.isFinite(Number(list.opens)) ? Math.max(0, Math.min(1000000, Math.round(Number(list.opens)))) : 0,
      // Что получатели отметили 🤍: «клиент → объекты», чтобы отправителю не писать дважды об одном и том же.
      marked: Object.fromEntries(Object.entries(list.marked && typeof list.marked === 'object' && !Array.isArray(list.marked) ? list.marked : {})
        .slice(0, 20).map(([userId, marked]) => [cleanText(userId, 40), (Array.isArray(marked) ? marked : []).map((id) => cleanText(id, 100)).filter(Boolean).slice(0, 20)])),
    };
  }
  return result;
}

function normalizeAdminReplyTargets(value) {
  const result = {};
  if (!value || typeof value !== 'object' || Array.isArray(value)) return result;
  for (const [messageId, target] of Object.entries(value)) {
    // "123" in the main admin chat, "<chat id>:123" in a manager's chat.
    if (!/^(-?\d{4,20}:)?\d{1,20}$/.test(messageId) || !target || typeof target !== 'object') continue;
    const chatId = cleanText(target.chatId, 40);
    if (!/^-?\d{1,20}$/.test(chatId)) continue;
    result[messageId] = {
      chatId,
      inquiryId: cleanText(target.inquiryId, 100),
      sourceMessageId: Number.isFinite(Number(target.sourceMessageId)) && target.sourceMessageId != null ? Number(target.sourceMessageId) : null,
      createdAt: cleanText(target.createdAt, 40),
      // Текст карточки заявки без строки состояния — чтобы обновлять её у всех менеджеров.
      ...(target.card ? { card: cleanText(target.card, 1500) } : {}),
    };
  }
  return result;
}

const DAY_KEY_PATTERN = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;
const CLOCK_TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;

// Office hours. Off by default: until the administrator sets them, the bot
// never tells clients that the office is closed.
const DEFAULT_WORKING_HOURS = {
  enabled: false,
  days: [1, 2, 3, 4, 5],
  from: '09:00',
  to: '19:00',
  note: {
    ru: 'Сейчас нерабочее время — менеджер ответит {next}. Ваше сообщение сохранено.',
    en: 'Our office is closed now — a manager will reply {next}. Your message is saved.',
    es: 'Ahora estamos fuera de horario: un gestor responderá {next}. Tu mensaje está guardado.',
  },
};

// The purchase calculator under a property. Off until the administrator
// checks the rates: taxes depend on the region and change over time.
const DEFAULT_CALCULATOR = {
  enabled: false,
  resaleTaxPercent: 10,
  newBuildTaxPercent: 10,
  businessTaxPercent: 21,
  stampDutyPercent: 1.5,
  otherCostsPercent: 1.5,
  downPaymentPercent: 30,
  interestPercent: 4,
  years: 25,
};

function normalizeCalculator(value) {
  const source = value && typeof value === 'object' ? value : {};
  const number = (key, min, max) => {
    const parsed = Number(source[key]);
    return Number.isFinite(parsed) && parsed >= min && parsed <= max ? Math.round(parsed * 100) / 100 : DEFAULT_CALCULATOR[key];
  };
  return {
    enabled: source.enabled === true,
    resaleTaxPercent: number('resaleTaxPercent', 0, 30),
    newBuildTaxPercent: number('newBuildTaxPercent', 0, 30),
    businessTaxPercent: number('businessTaxPercent', 0, 30),
    stampDutyPercent: number('stampDutyPercent', 0, 10),
    otherCostsPercent: number('otherCostsPercent', 0, 10),
    downPaymentPercent: number('downPaymentPercent', 0, 100),
    interestPercent: number('interestPercent', 0, 20),
    years: Math.round(number('years', 1, 40)),
  };
}

// When viewings can be booked: weekdays and start times. Off by default:
// then the client names a convenient time and the manager confirms it.
const DEFAULT_VIEWING_SLOTS = { enabled: false, days: [1, 2, 3, 4, 5, 6], times: ['10:00', '12:00', '16:00', '18:00'], daysAhead: 7, perSlot: 1 };

function normalizeViewingSlots(value) {
  const source = value && typeof value === 'object' ? value : {};
  const days = Array.isArray(source.days)
    ? Array.from(new Set(source.days.map(Number).filter((day) => Number.isInteger(day) && day >= 0 && day <= 6))).sort()
    : DEFAULT_VIEWING_SLOTS.days.slice();
  const times = Array.isArray(source.times)
    ? Array.from(new Set(source.times.map((time) => String(time).trim()).filter((time) => CLOCK_TIME_PATTERN.test(time)))).sort().slice(0, 12)
    : DEFAULT_VIEWING_SLOTS.times.slice();
  const daysAhead = Number(source.daysAhead);
  const perSlot = Number(source.perSlot);
  return {
    enabled: source.enabled === true && days.length > 0 && times.length > 0,
    days,
    times,
    daysAhead: Number.isInteger(daysAhead) && daysAhead >= 1 && daysAhead <= 30 ? daysAhead : DEFAULT_VIEWING_SLOTS.daysAhead,
    perSlot: Number.isInteger(perSlot) && perSlot >= 1 && perSlot <= 5 ? perSlot : DEFAULT_VIEWING_SLOTS.perSlot,
  };
}

// A weekly encrypted copy of the data sent to the admin chat. The key is
// derived from a password only the administrator knows; the password itself
// is not stored.
function normalizeTelegramBackup(value) {
  const source = value && typeof value === 'object' ? value : {};
  const salt = /^[0-9a-f]{32}$/.test(String(source.salt || '')) ? String(source.salt) : '';
  const key = /^[0-9a-f]{64}$/.test(String(source.key || '')) ? String(source.key) : '';
  return {
    enabled: source.enabled === true && Boolean(salt && key),
    salt,
    key,
    lastSentAt: cleanText(source.lastSentAt, 40),
    lastError: cleanText(source.lastError, 300),
  };
}

// Managers besides the main admin: each gets client inquiries in their own
// chat with the bot and can answer them.
const MAX_MANAGERS = 10;

function normalizeManagers(value, adminChatId = '') {
  if (!Array.isArray(value)) return [];
  const seen = new Set([String(adminChatId || '')]);
  const managers = [];
  for (const item of value) {
    const chatId = cleanText(item && item.chatId, 40);
    const name = cleanText(item && item.name, 60);
    if (!/^-?\d{4,20}$/.test(chatId) || !name || seen.has(chatId)) continue;
    seen.add(chatId);
    managers.push({ id: cleanText(item.id, 100) || crypto.randomUUID(), name, chatId, verifiedAt: cleanText(item.verifiedAt, 40) });
    if (managers.length >= MAX_MANAGERS) break;
  }
  return managers;
}

// Варианты срока ответа для панели: минуты, которые можно обещать честно.
const REPLY_MINUTES_CHOICES = [0, 5, 10, 15, 30, 60, 120, 240];

function normalizeWorkingHours(value) {
  const source = value && typeof value === 'object' ? value : {};
  const days = Array.isArray(source.days)
    ? Array.from(new Set(source.days.map(Number).filter((day) => Number.isInteger(day) && day >= 0 && day <= 6))).sort()
    : DEFAULT_WORKING_HOURS.days.slice();
  const from = CLOCK_TIME_PATTERN.test(String(source.from || '')) ? String(source.from) : DEFAULT_WORKING_HOURS.from;
  const to = CLOCK_TIME_PATTERN.test(String(source.to || '')) ? String(source.to) : DEFAULT_WORKING_HOURS.to;
  const note = source.note && typeof source.note === 'object' ? source.note : {};
  // Сколько обычно ждать ответа. 0 — ничего не обещаем.
  const replyMinutes = REPLY_MINUTES_CHOICES.includes(Number(source.replyMinutes)) ? Number(source.replyMinutes) : 0;
  return {
    enabled: source.enabled === true && days.length > 0 && from < to,
    days,
    from,
    to,
    replyMinutes,
    note: Object.fromEntries(['ru', 'en', 'es'].map((language) => [language, cleanText(note[language], 500) || DEFAULT_WORKING_HOURS.note[language]])),
  };
}

// Уведомления администратору в Telegram: что приходит со звуком, что без звука, что не приходит совсем, и
// тихие часы (в них всё со звуком приходит без звука — ничего не теряется). Заявки и сообщения клиентов
// отключить нельзя: их пропуск стоил бы клиента.
const NOTIFY_KINDS = ['inquiry', 'reminder', 'viewing', 'digest', 'system'];
const NOTIFY_KINDS_WITHOUT_OFF = ['inquiry', 'system'];
function normalizeNotifyPrefs(value) {
  const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  const kinds = source.kinds && typeof source.kinds === 'object' ? source.kinds : {};
  const quiet = source.quiet && typeof source.quiet === 'object' ? source.quiet : {};
  const from = CLOCK_TIME_PATTERN.test(String(quiet.from || '')) ? String(quiet.from) : '22:00';
  const to = CLOCK_TIME_PATTERN.test(String(quiet.to || '')) ? String(quiet.to) : '08:00';
  return {
    kinds: Object.fromEntries(NOTIFY_KINDS.map((kind) => {
      const allowed = NOTIFY_KINDS_WITHOUT_OFF.includes(kind) ? ['sound', 'silent'] : ['sound', 'silent', 'off'];
      return [kind, allowed.includes(kinds[kind]) ? kinds[kind] : 'sound'];
    })),
    quiet: { enabled: quiet.enabled === true && from !== to, from, to },
  };
}

// Автоматические сообщения клиентам: недельный дайджест и мягкий возврат. Оба
// выключены, пока владелец сам не включит: на демо-каталоге слать нечего, а
// сообщение «ни о чём» отпугивает.
function normalizeEngagement(value) {
  const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  return { digest: source.digest === true, comeback: source.comeback === true, planReminder: source.planReminder === true };
}

// «Почему мы»: годы на рынке, число сделок, регистрационные данные, адрес офиса,
// ссылка на отзывы и до пяти отзывов. Отзыв показывается клиентам, только если
// владелец подтвердил, что у него есть разрешение автора на публикацию (allowed).
const MAX_TRUST_REVIEWS = 5;

function normalizeTrust(value) {
  const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  const count = (input, limit) => {
    const number = Math.round(Number(input));
    return Number.isFinite(number) && number > 0 ? Math.min(number, limit) : 0;
  };
  let reviewsUrl = cleanText(source.reviewsUrl, 500);
  try {
    if (!['http:', 'https:'].includes(new URL(reviewsUrl).protocol)) reviewsUrl = '';
  } catch {
    reviewsUrl = '';
  }
  const seen = new Set();
  const reviews = (Array.isArray(source.reviews) ? source.reviews : []).map((item) => {
    const review = item && typeof item === 'object' ? item : {};
    let id = cleanText(review.id, 60);
    if (!id || seen.has(id)) id = crypto.randomUUID();
    seen.add(id);
    return {
      id,
      name: cleanText(review.name, 80),
      country: cleanText(review.country, 80),
      text: cleanText(review.text, 600),
      // Только настоящее «да»: разрешение на публикацию не выводится из отсутствия ответа.
      allowed: review.allowed === true,
    };
  }).filter((review) => review.name || review.text).slice(0, MAX_TRUST_REVIEWS);
  return {
    yearsOnMarket: count(source.yearsOnMarket, 200),
    dealsCount: count(source.dealsCount, 1000000),
    registration: cleanText(source.registration, 500),
    officeAddress: cleanText(source.officeAddress, 300),
    reviewsUrl,
    reviews,
  };
}

// Одна заметка вместо двух: раньше была «по этой заявке» и «общая о клиенте».
// Заметки по заявкам переезжают в заметку клиента строкой «По заявке от ДД.ММ: …»
// (что уже есть в заметке — не повторяем). Не помещается в 2000 знаков — заметка
// остаётся у заявки: терять написанное нельзя.
// Заметка о клиенте — одна на все его заявки; в ней помещается около трёх страниц.
const CLIENT_NOTE_LIMIT = 6000;

// Порядок слияния — от старых заявок к новым; не поместилось в лимит — заметка остаётся у заявки.
function mergeInquiryNotes(normalized) {
  const pad = (value) => String(value).padStart(2, '0');
  const oldestFirst = [...normalized.inquiries].sort((a, b) => (Date.parse(a.createdAt) || 0) - (Date.parse(b.createdAt) || 0));
  for (const inquiry of oldestFirst) {
    const note = cleanText(inquiry.note, CLIENT_NOTE_LIMIT);
    const user = normalized.users[String(inquiry.userId)];
    if (!note || !user) continue;
    const existing = cleanText(user.note, CLIENT_NOTE_LIMIT);
    if (existing.includes(note)) {
      inquiry.note = '';
      continue;
    }
    const created = new Date(inquiry.createdAt);
    const label = Number.isFinite(created.getTime()) ? ' от ' + pad(created.getDate()) + '.' + pad(created.getMonth() + 1) : '';
    const merged = (existing ? existing + '\n\n' : '') + 'По заявке' + label + ': ' + note;
    if (merged.length > CLIENT_NOTE_LIMIT) continue;
    user.note = merged;
    inquiry.note = '';
  }
}

// A viewing request: what the client asked for (date may be unknown, for
// "at the weekend" or a free-text answer), what the manager confirmed and
// what the bot already sent about it.
// Страницы гида «Как купить в Испании»: заголовок и текст на трёх языках.
// Набор страниц задан ботом, владелец правит тексты — как в «О компании».
function normalizeGuidePages(value) {
  const saved = Array.isArray(value) ? value : [];
  return DEFAULT_GUIDE_PAGES.map((page) => {
    const stored = saved.find((item) => item && item.id === page.id) || {};
    return {
      id: page.id,
      title: Object.fromEntries(['ru', 'en', 'es'].map((language) => [
        language,
        cleanText((stored.title || {})[language], 120) || page.title[language],
      ])),
      text: Object.fromEntries(['ru', 'en', 'es'].map((language) => [
        language,
        cleanText((stored.text || {})[language], 3000) || page.text[language],
      ])),
    };
  });
}

function normalizeViewing(value) {
  if (!value || typeof value !== 'object') return null;
  const day = (text) => (DAY_KEY_PATTERN.test(String(text || '')) ? String(text) : '');
  return {
    // Показ по видеосвязи: менеджеру ехать не надо, клиенту — тем более.
    online: value.online === true,
    date: day(value.date),
    dateText: cleanText(value.dateText, 160),
    timeText: cleanText(value.timeText, 160),
    confirmedDate: day(value.confirmedDate),
    confirmedTime: CLOCK_TIME_PATTERN.test(String(value.confirmedTime || '')) ? String(value.confirmedTime) : '',
    confirmedAt: cleanText(value.confirmedAt, 40),
    cancelledAt: cleanText(value.cancelledAt, 40),
    remindedAt: cleanText(value.remindedAt, 40),
    feedbackAskedAt: cleanText(value.feedbackAskedAt, 40),
    feedback: ['liked', 'questions', 'disliked'].includes(value.feedback) ? value.feedback : '',
    feedbackAt: cleanText(value.feedbackAt, 40),
    // Идентификатор встречи в календаре клиента (после переноса — прежний).
    ...(value.calendarUid ? { calendarUid: cleanText(value.calendarUid, 80) } : {}),
  };
}

const MAX_REPLY_TEMPLATES = 50;
const MAX_INQUIRY_MESSAGES = 200;

function normalizeInquiryMessage(item, fallbackAt = '') {
  if (!item || typeof item !== 'object') return null;
  const direction = item.direction === 'out' ? 'out' : 'in';
  const kind = ['text', 'photo', 'video', 'voice', 'audio', 'document', 'location', 'contact', 'sticker', 'other'].includes(item.kind)
    ? item.kind
    : 'text';
  return {
    id: cleanText(item.id, 100) || crypto.randomUUID(),
    direction,
    kind,
    text: cleanText(item.text, 4000),
    fileId: cleanText(item.fileId, 512),
    fileName: cleanText(item.fileName, 200),
    mimeType: cleanText(item.mimeType, 120),
    telegramMessageId: Number.isFinite(Number(item.telegramMessageId)) && item.telegramMessageId != null ? Number(item.telegramMessageId) : null,
    replyToTelegramMessageId: Number.isFinite(Number(item.replyToTelegramMessageId)) && item.replyToTelegramMessageId != null ? Number(item.replyToTelegramMessageId) : null,
    replyToText: cleanText(item.replyToText, 300),
    deliveryStatus: direction === 'out' ? (item.deliveryStatus === 'failed' ? 'failed' : 'delivered') : '',
    clientRequestId: cleanText(item.clientRequestId, 100),
    source: cleanText(item.source, 40),
    by: cleanText(item.by, 80),
    reactions: Array.isArray(item.reactions) ? item.reactions.map((reaction) => cleanText(reaction, 20)).filter(Boolean).slice(0, 20) : [],
    reactionUpdatedAt: cleanText(item.reactionUpdatedAt, 40),
    createdAt: cleanText(item.createdAt, 40) || fallbackAt || new Date().toISOString(),
  };
}

function normalizeInquiryMessages(item) {
  if (Array.isArray(item.messages) && item.messages.length) {
    return item.messages.map((message) => normalizeInquiryMessage(message, item.createdAt)).filter(Boolean).slice(-MAX_INQUIRY_MESSAGES);
  }
  const messages = [];
  if (cleanText(item.text, 4000)) {
    messages.push(normalizeInquiryMessage({
      direction: 'in',
      kind: 'text',
      text: item.text,
      telegramMessageId: item.sourceMessageId,
      source: 'migration',
      createdAt: item.createdAt,
    }, item.createdAt));
  }
  for (const reply of Array.isArray(item.replies) ? item.replies : []) {
    messages.push(normalizeInquiryMessage({
      id: reply.id,
      direction: 'out',
      kind: 'text',
      text: reply.text,
      telegramMessageId: reply.telegramMessageId,
      source: reply.source,
      by: reply.by,
      createdAt: reply.createdAt,
    }, item.updatedAt || item.createdAt));
  }
  return messages.filter(Boolean).slice(-MAX_INQUIRY_MESSAGES);
}

function normalizeReplyTemplates(value) {
  if (!Array.isArray(value)) return [];
  return value.map((item) => ({
    id: cleanText(item && item.id, 100) || crypto.randomUUID(),
    title: cleanText(item && item.title, 80),
    text: Object.fromEntries(['ru', 'en', 'es'].map((language) => [language, cleanText(item && item.text && item.text[language], 4000)])),
    updatedAt: cleanText(item && item.updatedAt, 40) || new Date().toISOString(),
  })).filter((item) => item.title && (item.text.ru || item.text.en || item.text.es)).slice(0, MAX_REPLY_TEMPLATES);
}

function legacyConfigRemoved(config) {
  const { greeting, help, fallback, ...rest } = config;
  return rest;
}

function normalizeLoadedData(parsed) {
    const parsedConfig = parsed.config || {};
    const parsedMessages = parsedConfig.messages || {};
    const parsedMenu = parsedConfig.menu || {};
    // Text migrations below rewrite stored texts, so they must run only once:
    // for files written before DATA_VERSION. Running them on every load used
    // to silently discard the administrator's own edits after each restart.
    const storedVersion = Number(parsed.version) || 0;
    const legacyFormat = storedVersion < 14;
    const messages = {};
    const menu = {};
    for (const language of ['ru', 'en', 'es']) {
      messages[language] = {
        ...defaultData.config.messages[language],
        ...(parsedMessages[language] || {}),
      };
      menu[language] = {
        ...defaultData.config.menu[language],
        ...(parsedMenu[language] || {}),
      };
    }
    // Migrate data created by the previous one-language version. These fields
    // only matter when the file has no multilingual texts yet.
    if (!parsedMessages.ru) {
      if (typeof parsedConfig.greeting === 'string') messages.ru.greeting = parsedConfig.greeting;
      if (typeof parsedConfig.help === 'string') messages.ru.help = parsedConfig.help;
      if (typeof parsedConfig.fallback === 'string') messages.ru.fallback = parsedConfig.fallback;
    }
    if (legacyFormat) migrateDefaultTexts(messages);
    const users = parsed.users && typeof parsed.users === 'object' ? parsed.users : {};
    for (const [id, user] of Object.entries(users)) {
      users[id] = {
        ...user,
        id: String(user.id || id),
        contactName: cleanText(user.contactName, 120),
        phone: cleanText(user.phone, 80),
        preferredContactTime: cleanText(user.preferredContactTime, 160),
        tags: Array.isArray(user.tags) ? user.tags.map((tag) => cleanText(tag, 40)).filter(Boolean).slice(0, 20) : [],
        note: cleanText(user.note, CLIENT_NOTE_LIMIT),
        favorites: Array.isArray(user.favorites) ? user.favorites.map(String).slice(0, 500) : [],
        comparisonIds: Array.isArray(user.comparisonIds)
          ? user.comparisonIds.map(String).filter((value, index, values) => value && values.indexOf(value) === index).slice(0, 3)
          : [],
        savedSearch: normalizeSavedSearchData(user.savedSearch),
        // Кто закрыл переписку: Telegram (клиент заблокировал бота) или
        // администратор галочкой «не писать этому клиенту». Первое снимается
        // само, когда клиент возвращается, второе — только руками.
        blockedBy: ['admin', 'telegram'].includes(user.blockedBy) ? user.blockedBy : (user.blocked ? 'telegram' : ''),
        // Согласие на рассылки: у данных прежних версий его нет — значит нет и
        // согласия, рассылать таким клиентам нельзя, пока сами не включат.
        newsConsentAt: cleanText(user.newsConsentAt, 40),
        selectionMatchIds: Array.isArray(user.selectionMatchIds) ? user.selectionMatchIds.map(String).slice(0, 20) : [],
        selectionMatchDetails: normalizeSelectionMatchDetails(user.selectionMatchDetails),
        similarPropertyIds: Array.isArray(user.similarPropertyIds)
          ? user.similarPropertyIds.map(String).filter((value, index, values) => value && values.indexOf(value) === index).slice(0, 20)
          : [],
        similarPropertyDetails: normalizedSimilarPropertyDetails(user.similarPropertyDetails),
        similarPropertySourceId: cleanText(user.similarPropertySourceId, 100),
        recentlyViewed: Array.isArray(user.recentlyViewed)
          ? user.recentlyViewed.map(String).filter((value, index, values) => value && values.indexOf(value) === index).slice(0, 20)
          : [],
        catalogMessageIds: Array.isArray(user.catalogMessageIds)
          ? user.catalogMessageIds.map(Number).filter(Number.isFinite).slice(0, 20)
          : [],
        uiMessageIds: Array.isArray(user.uiMessageIds)
          ? user.uiMessageIds.map(Number).filter(Number.isFinite).slice(0, 20)
          : [],
        galleryMessageIds: Array.isArray(user.galleryMessageIds)
          ? user.galleryMessageIds.map(Number).filter(Number.isFinite).slice(0, 20)
          : [],
        lastCallback: user.lastCallback && typeof user.lastCallback === 'object' ? {
          key: cleanText(user.lastCallback.key, 120),
          at: Number(user.lastCallback.at) || 0,
        } : null,
        lastInboundMessageId: user.lastInboundMessageId != null && Number.isFinite(Number(user.lastInboundMessageId)) ? Number(user.lastInboundMessageId) : null,
        catalogContext: user.catalogContext && typeof user.catalogContext === 'object' ? {
          mode: ['all', 'favorites', 'matches', 'similar', 'recent', 'comparison', 'digest', 'shared'].includes(user.catalogContext.mode) ? user.catalogContext.mode : 'all',
          page: Math.max(0, Number(user.catalogContext.page) || 0),
          propertyId: cleanText(user.catalogContext.propertyId, 100),
        } : { mode: 'all', page: 0, propertyId: '' },
        // Форма подбора «property_selection» давно заменена мастером: клиент,
        // застрявший в ней, не должен висеть с незавершённым действием.
        pendingAction: user.pendingAction && typeof user.pendingAction === 'object' && user.pendingAction.type !== 'property_selection' ? user.pendingAction : null,
        expiredAction: user.expiredAction && typeof user.expiredAction === 'object' ? {
          type: cleanText(user.expiredAction.type, 40),
          propertyId: cleanText(user.expiredAction.propertyId, 100),
          createdAt: user.expiredAction.createdAt || new Date().toISOString(),
        } : null,
        pendingStartPayload: cleanText(user.pendingStartPayload, 100),
        activity: Array.isArray(user.activity) ? user.activity.slice(-20) : [],
      };
    }
    const rules = Array.isArray(parsed.rules)
      ? parsed.rules.map((rule, index) => ({
          ...rule,
          language: rule.language || 'ru',
          order: Number.isFinite(Number(rule.order)) ? Number(rule.order) : index,
          updatedAt: rule.updatedAt || rule.createdAt || new Date().toISOString(),
        }))
      : clone(defaultData.rules);
    const broadcasts = Array.isArray(parsed.broadcasts) ? parsed.broadcasts.map((source) => {
      const entry = source.messages ? { ...source } : {
        ...source,
        messages: { ru: source.text || '', en: source.text || '', es: source.text || '' },
        languages: [],
        tags: [],
        buttonText: { ru: '', en: '', es: '' },
        buttonUrl: '',
      };
      if (entry.status === 'running') entry.status = 'queued';
      entry.pipelineStages = Array.isArray(entry.pipelineStages) ? entry.pipelineStages.filter((stage) => PIPELINE_STAGES.includes(stage)).slice(0, PIPELINE_STAGES.length) : [];
      entry.sources = Array.isArray(entry.sources) ? entry.sources.map((source) => cleanText(source, 80)).filter(Boolean).slice(0, 20) : [];
      entry.propertyId = cleanText(entry.propertyId, 100);
      // Рассылка карточкой: фотография объекта и кнопки, как под карточкой в
      // каталоге. Без объекта отправлять нечего, поэтому и флага нет.
      entry.sendAsCard = Boolean(entry.propertyId) && entry.sendAsCard === true;
      entry.propertySignal = ['any', 'favorite', 'comparison', 'viewed', 'match', 'inquiry'].includes(entry.propertySignal) ? entry.propertySignal : 'any';
      for (const field of ['processedUserIds', 'respondedUserIds', 'inquiryUserIds', 'unsubscribedUserIds', 'photoOnlyUserIds']) {
        entry[field] = Array.isArray(entry[field]) ? entry[field].map(String).slice(0, 100000) : [];
      }
      entry.failures = Array.isArray(entry.failures) ? entry.failures.slice(-100) : [];
      return entry;
    }) : [];
    const inquiries = Array.isArray(parsed.inquiries) ? parsed.inquiries.map((item) => ({
      ...item,
      id: String(item.id || crypto.randomUUID()),
      userId: String(item.userId || ''),
      chatId: item.chatId == null ? '' : String(item.chatId),
      language: ['ru', 'en', 'es'].includes(item.language) ? item.language : 'ru',
      text: cleanText(item.text, 4000),
      status: ['new', 'in_progress', 'closed'].includes(item.status) ? item.status : 'new',
      pipelineStage: normalizePipelineStage(item.pipelineStage, item),
      note: cleanText(item.note, CLIENT_NOTE_LIMIT),
      type: ['question', 'interest', 'selection', 'viewing', 'lead', 'general'].includes(item.type) ? item.type : 'general',
      propertyId: cleanText(item.propertyId, 100),
      sourceMessageId: Number.isFinite(Number(item.sourceMessageId)) ? Number(item.sourceMessageId) : null,
      lead: item.lead && typeof item.lead === 'object' ? {
        name: cleanText(item.lead.name, 120),
        phone: cleanText(item.lead.phone, 80),
        preferredTime: cleanText(item.lead.preferredTime, 160),
        method: ['call', 'whatsapp', 'telegram'].includes(item.lead.method) ? item.lead.method : 'call',
      } : null,
      selection: item.selection && typeof item.selection === 'object' ? {
        deal: cleanText(item.selection.deal, 200),
        type: cleanText(item.selection.type, 200),
        location: cleanText(item.selection.location, 200),
        budget: cleanText(item.selection.budget, 200),
        bedrooms: cleanText(item.selection.bedrooms, 200),
      } : null,
      matching: item.type === 'selection' ? normalizeSelectionMatching(item.matching) : null,
      replies: Array.isArray(item.replies) ? item.replies.slice(-50) : [],
      // A compact conversation timeline is used by the panel. Old requests
      // are converted without marking years of history as unread.
      messages: normalizeInquiryMessages(item),
      readAt: cleanText(item.readAt, 40) || (storedVersion < 26 ? (cleanText(item.clientMessageAt, 40) || item.updatedAt || item.createdAt || new Date().toISOString()) : ''),
      remindedAt: cleanText(item.remindedAt, 40),
      // С какого момента клиент ждал, когда о нём напомнили: напоминание — на каждое «жду», а не одно на заявку.
      remindedSince: cleanText(item.remindedSince, 40),
      // Когда менеджер взял заявку «В работу» (для строки состояния в карточке).
      takenAt: cleanText(item.takenAt, 40),
      // When the client was last told that the message is with the manager:
      // messages in a row are acknowledged once, a later one again.
      acknowledgedAt: cleanText(item.acknowledgedAt, 40),
      // The client searched in their own words and got the catalog: the
      // manager sees the request, but nobody is waiting for an answer.
      searchLead: item.searchLead === true,
      viewing: item.type === 'viewing' ? normalizeViewing(item.viewing || {}) : null,
      // When the manager plans to contact the client again.
      followUpDate: DAY_KEY_PATTERN.test(String(item.followUpDate || '')) ? String(item.followUpDate) : '',
      followUpTime: CLOCK_TIME_PATTERN.test(String(item.followUpTime || '')) ? String(item.followUpTime) : '',
      followUpNotifiedAt: cleanText(item.followUpNotifiedAt, 40),
      // Когда обращение стало сделкой (для недельного отчёта); у прежних — пусто.
      wonAt: cleanText(item.wonAt, 40)
        // Версия 43: сделки, записанные до появления wonAt, получают дату один раз —
        // по последней правке на момент обновления. Без неё отчёт считал их по
        // updatedAt, а любая правка заметки двигала сделку в другую неделю.
        || (storedVersion < 43 && normalizePipelineStage(item.pipelineStage, item) === 'won' ? cleanText(item.updatedAt || item.createdAt, 40) : ''),
      // Who took the inquiry: the admin or one of the managers.
      assignee: cleanText(item.assignee, 60),
      createdAt: item.createdAt || new Date().toISOString(),
      updatedAt: item.updatedAt || item.createdAt || new Date().toISOString(),
      // The client's last message, to tell whose turn it is.
      clientMessageAt: cleanText(item.clientMessageAt, 40) || item.createdAt || '',
    })) : [];
    // Если обращений больше предела, в первую очередь сохраняем живые: молча
    // потерять обращение, где клиент ждёт ответа, нельзя.
    const MAX_STORED_INQUIRIES = 5000;
    if (inquiries.length > MAX_STORED_INQUIRIES) {
      const open = inquiries.filter((item) => item.status !== 'closed');
      const closed = inquiries.filter((item) => item.status === 'closed');
      const kept = open.slice(0, MAX_STORED_INQUIRIES)
        .concat(closed.slice(0, Math.max(0, MAX_STORED_INQUIRIES - open.length)));
      kept.sort((first, second) => (Date.parse(second.createdAt) || 0) - (Date.parse(first.createdAt) || 0));
      inquiries.length = 0;
      inquiries.push(...kept);
    }
    const normalized = {
      ...clone(defaultData),
      ...parsed,
      version: DATA_VERSION,
      config: { ...defaultData.config, ...legacyConfigRemoved(parsedConfig), messages, menu },
      bot: { ...defaultData.bot, ...(parsed.bot || {}) },
      stats: { ...defaultData.stats, ...(parsed.stats || {}) },
      rules,
      users,
      welcomeImages: {
        ...defaultData.welcomeImages,
        ...(parsed.welcomeImages || {}),
      },
      objects: Array.isArray(parsed.objects) ? parsed.objects.map((record) => {
        const imagesByLanguage = normalizePropertyImages(record);
        const { image: legacyImage, images: legacyImages, ...propertyRecord } = record;
        return {
          ...propertyRecord,
          imagesByLanguage,
          dealType: ['sale', 'rent'].includes(record.dealType) ? record.dealType : 'sale',
          propertyType: cleanText(record.propertyType, 40) || 'apartment',
          reference: cleanText(record.reference, 80),
          city: normalizeLocalizedField(record.city, 160),
          district: normalizeLocalizedField(record.district, 160),
          price: normalizeLocalizedField(record.price, 120),
          currency: cleanText(record.currency, 10) || 'EUR',
          pricePeriod: ['total', 'month', 'week'].includes(record.pricePeriod) ? record.pricePeriod : 'total',
          // Цена «от»: у комплекса — цена самого дешёвого варианта.
          priceFrom: record.priceFrom === true,
          badges: Array.isArray(record.badges) ? record.badges.map((item) => cleanText(item, 30)).filter(Boolean).slice(0, 6) : [],
          // Видео или 3D-тур: ссылка на YouTube, Matterport и подобное.
          videoUrl: cleanText(record.videoUrl, 500),
          // Прежняя цена: остаётся на карточке зачёркнутой, пока снижение свежее.
          previousPriceValue: Number(record.previousPriceValue) > 0 ? Number(record.previousPriceValue) : 0,
          priceChangedAt: cleanText(record.priceChangedAt, 40),
          // Когда объект впервые стал доступен клиентам: по нему дайджест находит новые.
          publishedAt: cleanText(record.publishedAt, 40),
          // Куда объявление уже публиковали в группах и каналах (последние 30).
          publications: normalizePublications(record.publications),
        };
      }) : [],
      promotions: Array.isArray(parsed.promotions) ? parsed.promotions.map((record) => {
        const imagesByLanguage = normalizePropertyImages(record);
        const { image: legacyImage, images: legacyImages, ...promotionRecord } = record;
        return { ...promotionRecord, imagesByLanguage };
      }) : [],
      contacts: {
        ...defaultData.contacts,
        ...(parsed.contacts || {}),
        photo: parsed.contacts && parsed.contacts.photo && typeof parsed.contacts.photo === 'object' ? parsed.contacts.photo : null,
        text: { ...defaultData.contacts.text, ...((parsed.contacts && parsed.contacts.text) || {}) },
      },
      interfaceText: parsed.interfaceText && typeof parsed.interfaceText === 'object' && !Array.isArray(parsed.interfaceText)
        ? parsed.interfaceText
        : {},
      analytics: {
        daily: parsed.analytics && parsed.analytics.daily && typeof parsed.analytics.daily === 'object'
          ? parsed.analytics.daily
          : {},
        properties: parsed.analytics && parsed.analytics.properties && typeof parsed.analytics.properties === 'object'
          ? parsed.analytics.properties
          : {},
        // Открытия бота по ссылкам с меткой источника; появляется при первом открытии.
        ...(parsed.analytics && parsed.analytics.sourceOpens && typeof parsed.analytics.sourceOpens === 'object' && !Array.isArray(parsed.analytics.sourceOpens)
          ? { sourceOpens: Object.fromEntries(Object.entries(parsed.analytics.sourceOpens).slice(0, 200).map(([key, value]) => [cleanText(key, 40), Math.max(0, Math.floor(Number(value)) || 0)]).filter(([key]) => key)) }
          : {}),
      },
      errors: Array.isArray(parsed.errors) ? parsed.errors.slice(0, 100) : [],
      adminNotificationStates: normalizeAdminNotificationStates(parsed.adminNotificationStates),
      broadcasts,
      inquiries,
      telegramOffset: Number.isFinite(Number(parsed.telegramOffset)) ? Math.max(0, Number(parsed.telegramOffset)) : 0,
      handledUpdateIds: Array.isArray(parsed.handledUpdateIds)
        ? parsed.handledUpdateIds.map((id) => Number(id)).filter((id) => Number.isFinite(id)).slice(-200)
        : [],
      adminReplyTargets: normalizeAdminReplyTargets(parsed.adminReplyTargets),
      sharedLists: normalizeSharedLists(parsed.sharedLists),
      // Notifications sent before this version have no entry in the map.
      adminReplyTargetsSince: cleanText(parsed.adminReplyTargetsSince, 40) || new Date().toISOString(),
    };
    // Version 15 made "only inquiries" the default: navigation is sent as a
    // daily digest instead of one message per click.
    if (storedVersion < 15) normalized.config.notifyMode = 'inquiries';
    if (storedVersion < 16) migrateSelectionSteps(normalized.interfaceText);
    if (storedVersion < 17) migrateShortMenu(normalized.interfaceText, normalized.config.messages);
    if (storedVersion < 18) migrateMyArea(normalized.interfaceText, normalized.config.messages);
    if (storedVersion < 19) migrateComparison(normalized.interfaceText, normalized.config.messages);
    if (storedVersion < 20) migrateSavedSearch(normalized.interfaceText, normalized.config.messages);
    if (storedVersion < 35) migrateShortGreeting(normalized.interfaceText);
    if (storedVersion < 39) migrateStaleTexts(normalized.interfaceText, normalized.config.messages);
    if (storedVersion < 47) mergeInquiryNotes(normalized);
    if (storedVersion < 48) migrateWording(normalized.interfaceText, normalized.config.messages);
    normalized.config.notifyMode = ['all', 'inquiries'].includes(normalized.config.notifyMode) ? normalized.config.notifyMode : 'inquiries';
    normalized.lastDigestFor = cleanText(parsed.lastDigestFor, 10);
    normalized.lastDiskWarningFor = cleanText(parsed.lastDiskWarningFor, 10);
    normalized.lastInquiryOverflowFor = cleanText(parsed.lastInquiryOverflowFor, 10);
    normalized.lastViewingAgendaFor = cleanText(parsed.lastViewingAgendaFor, 10);
    normalized.lastWeeklyReportFor = cleanText(parsed.lastWeeklyReportFor, 10);
    normalized.replyTemplates = normalizeReplyTemplates(parsed.replyTemplates);
    normalized.guidePages = normalizeGuidePages(parsed.guidePages);
    normalized.buyPlan = normalizeBuyPlan(parsed.buyPlan);
    normalized.trust = normalizeTrust(parsed.trust);
    normalized.config.publishing = normalizePublishing(normalized.config.publishing);
    normalized.groups = normalizeGroups(parsed.groups);
    normalized.groupPosts = normalizeGroupPosts(parsed.groupPosts);
    normalized.config.reminderHours = REMINDER_HOUR_OPTIONS.includes(Number(normalized.config.reminderHours)) ? Number(normalized.config.reminderHours) : 2;
    // Срок хранения данных клиента: 0 — хранить без срока (так работали раньше).
    normalized.config.retentionMonths = RETENTION_MONTH_OPTIONS.includes(Number(normalized.config.retentionMonths)) ? Number(normalized.config.retentionMonths) : 0;
    normalized.lastRetentionRunFor = cleanText(parsed.lastRetentionRunFor, 10);
    normalized.config.timeZone = normalizeTimeZone(normalized.config.timeZone);
    normalized.config.workingHours = normalizeWorkingHours(normalized.config.workingHours);
    normalized.config.notifyPrefs = normalizeNotifyPrefs(normalized.config.notifyPrefs);
    normalized.config.calculator = normalizeCalculator(normalized.config.calculator);
    normalized.config.engagement = normalizeEngagement(normalized.config.engagement);
    normalized.config.viewingSlots = normalizeViewingSlots(normalized.config.viewingSlots);
    normalized.config.telegramBackup = normalizeTelegramBackup(normalized.config.telegramBackup);
    normalized.config.adminName = cleanText(normalized.config.adminName, 60);
    // Messages about the bot itself (started, stopped, connection): on unless switched off.
    // Доступ из интернета — только настоящее «да». Любое другое значение
    // (например, объект из старых данных или из подготовленной песочницы)
    // считалось бы истиной, и бот поднял бы туннель наружу.
    normalized.config.remoteAccess = normalized.config.remoteAccess === true;
    normalized.config.statusNotices = normalized.config.statusNotices !== false;
    normalized.config.managers = normalizeManagers(normalized.config.managers, normalized.config.adminChatId);
    pruneOrphanPropertyAnalytics(normalized);
    return normalized;
}

export {
  CLIENT_NOTE_LIMIT,
  CLOCK_TIME_PATTERN,
  DEFAULT_BUY_PLAN,
  normalizeBuyPlan,
  normalizeEngagement,
  NOTIFY_KINDS,
  normalizeNotifyPrefs,
  MAX_TRUST_REVIEWS,
  normalizeTrust,
  DATA_VERSION,
  DAY_KEY_PATTERN,
  DEFAULT_CALCULATOR,
  DEFAULT_VIEWING_SLOTS,
  DEFAULT_WORKING_HOURS,
  MAX_MANAGERS,
  MAX_REPLY_TEMPLATES,
  MAX_INQUIRY_MESSAGES,
  PIPELINE_STAGES,
  REMINDER_HOUR_OPTIONS,
  RETENTION_MONTH_OPTIONS,
  TIME_ZONES,
  defaultData,
  legacyConfigRemoved,
  migrateDefaultTexts,
  migrateSelectionSteps,
  migrateShortMenu,
  migrateMyArea,
  migrateComparison,
  MAX_POST_BUTTONS,
  MAX_RUBRICS,
  normalizeGroupPosts,
  normalizeGroups,
  normalizePublishing,
  PREVIOUS_HELP_DEFAULTS,
  normalizeAdminReplyTargets,
  normalizeAdminNotificationStates,
  normalizeCalculator,
  normalizeManagers,
  normalizePipelineStage,
  normalizeTimeZone,
  normalizeSelectionMatching,
  normalizeLoadedData,
  normalizeLocalizedField,
  normalizePropertyImages,
  normalizeReplyTemplates,
  normalizeStoredImages,
  normalizeViewing,
  normalizeTelegramBackup,
  normalizeViewingSlots,
  REPLY_MINUTES_CHOICES,
  normalizeGuidePages,
  normalizeWorkingHours,
  pruneOrphanPropertyAnalytics,
};
