// Готовый набор шаблонов ответов. В панели («Тексты бота → Автоответы → Шаблоны ответов») кнопка «Добавить готовый набор» добавляет
// эти шаблоны к вашим: ничего не пишется само и не отправляется клиентам. Тексты нейтральные, без цен и сроков; {имя} и
// {объект} подставляются именем клиента и названием объекта из заявки. Менеджер правит их под себя.

const STARTER_TEMPLATES = [
  {
    title: 'Приветствие',
    text: {
      ru: 'Здравствуйте, {имя}! Спасибо, что написали в Construcciones Kornilenko. Сейчас отвечу на ваш вопрос.',
      en: 'Hello {name}! Thank you for contacting Construcciones Kornilenko. I will answer your question shortly.',
      es: '¡Hola, {name}! Gracias por escribir a Construcciones Kornilenko. Enseguida respondo a tu pregunta.',
    },
  },
  {
    title: 'Цены и прайс',
    text: {
      ru: '{имя}, цена по {объект} зависит от выбранного варианта. Пришлю актуальный прайс и свободные варианты. Подскажите, пожалуйста, сколько спален вам нужно и какой у вас бюджет?',
      en: '{name}, the price for {property} depends on the option you choose. I will send you the current price list and the available options. Could you tell me how many bedrooms you need and your budget?',
      es: '{name}, el precio de {property} depende de la opción elegida. Te enviaré la lista de precios actual y las opciones disponibles. ¿Cuántos dormitorios necesitas y cuál es tu presupuesto?',
    },
  },
  {
    title: 'Приглашение на просмотр',
    text: {
      ru: '{имя}, с удовольствием покажем {объект}. Когда вам удобно: в будни или в выходные, утром или днём? Можем также провести онлайн-показ по видеосвязи.',
      en: '{name}, we would be happy to show you {property}. When suits you: weekdays or weekend, morning or afternoon? We can also do an online viewing by video call.',
      es: '{name}, estaremos encantados de enseñarte {property}. ¿Cuándo te viene bien: entre semana o fin de semana, por la mañana o por la tarde? También podemos hacer una visita online por videollamada.',
    },
  },
  {
    title: 'Условия оплаты',
    text: {
      ru: '{имя}, по условиям оплаты и графику платежей по {объект} пришлю подробности в этом чате. Если удобнее, можем обсудить по телефону — напишите номер и удобное время.',
      en: '{name}, I will send you the payment terms and schedule for {property} in this chat. If you prefer, we can discuss it by phone — send me your number and a convenient time.',
      es: '{name}, te enviaré en este chat las condiciones y el calendario de pago de {property}. Si lo prefieres, lo hablamos por teléfono: dime tu número y una hora que te venga bien.',
    },
  },
  {
    title: 'Документы для покупки',
    text: {
      ru: '{имя}, обычно для покупки в Испании нужны паспорт, номер NIE и банковский счёт; мы поможем с каждым шагом. Порядок покупки есть в боте, в разделе «Как купить». Если нужно, расскажу подробнее.',
      en: '{name}, buying in Spain usually requires a passport, an NIE number and a bank account; we will help with every step. The buying process is in the bot, under “Buying in Spain”. I can explain in more detail if you wish.',
      es: '{name}, para comprar en España normalmente hacen falta pasaporte, número NIE y una cuenta bancaria; te ayudaremos en cada paso. El proceso de compra está en el bot, en «Cómo comprar». Si quieres, te lo explico con más detalle.',
    },
  },
  {
    title: 'Планировки и материалы',
    text: {
      ru: '{имя}, планировки и дополнительные материалы по {объект} пришлю в этот чат в ближайшее время.',
      en: '{name}, I will send the floor plans and extra materials for {property} to this chat shortly.',
      es: '{name}, te enviaré a este chat los planos y más material de {property} en breve.',
    },
  },
  {
    title: 'Просьба оставить телефон',
    text: {
      ru: '{имя}, удобно ли, если мы позвоним вам? Напишите номер телефона и удобное время.',
      en: '{name}, would it be convenient if we called you? Please send your phone number and a convenient time.',
      es: '{name}, ¿te viene bien que te llamemos? Envíame tu número de teléfono y una hora que te venga bien.',
    },
  },
  {
    title: 'Напоминание о себе',
    text: {
      ru: '{имя}, добрый день! Напоминаю о себе: удалось ли вам посмотреть материалы по {объект}? Если остались вопросы — отвечу.',
      en: '{name}, good day! Just a reminder from us: did you have a chance to look at the materials for {property}? If you have any questions, I am here to answer.',
      es: '{name}, ¡buenas! Te escribimos para recordarte: ¿has podido ver el material de {property}? Si te quedan dudas, aquí estoy para resolverlas.',
    },
  },
  {
    title: 'Вариант уже занят',
    text: {
      ru: '{имя}, к сожалению, {объект} уже забронирован. Подберу похожие варианты — подскажите, пожалуйста, бюджет и количество спален.',
      en: '{name}, unfortunately {property} has already been reserved. I will find similar options — could you tell me your budget and number of bedrooms?',
      es: '{name}, lamentablemente {property} ya está reservado. Buscaré opciones parecidas: ¿me indicas tu presupuesto y el número de dormitorios?',
    },
  },
  {
    title: 'Спасибо за обращение',
    text: {
      ru: '{имя}, спасибо за обращение! Если появятся вопросы — пишите в любое время.',
      en: '{name}, thank you for getting in touch! If you have any questions, write to us at any time.',
      es: '{name}, ¡gracias por tu mensaje! Si tienes cualquier duda, escríbenos cuando quieras.',
    },
  },
];

export { STARTER_TEMPLATES };
