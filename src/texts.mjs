// Тексты бота на трёх языках и тексты интерфейса, редактируемые в панели.

import { cleanText, clone } from './util.mjs';

const LANGUAGE_NAMES = { ru: 'Русский', en: 'English', es: 'Español' };
const LANGUAGE_SELECTED = {
  ru: 'Готово — выбран русский язык',
  en: 'Done — English is selected',
  es: 'Listo — has seleccionado español',
};
const MENU_LABELS = {
  ru: { objects: '🏘 Наши объекты', selection: '✨ Помогите подобрать объект', promotions: '🔥 Акции', favorites: '❤️ Избранное', contacts: '💬 Связаться с менеджером', request: '📞 Заказать звонок', about: 'ℹ️ О компании', help: '❓ Помощь', more: '☰ Ещё', language: '🌐 Сменить язык', placeholder: 'Выберите раздел' },
  en: { objects: '🏘 Our properties', selection: '✨ Help me find a property', promotions: '🔥 Offers', favorites: '❤️ Favorites', contacts: '💬 Contact a manager', request: '📞 Request a call', about: 'ℹ️ About', help: '❓ Help', more: '☰ More', language: '🌐 Change language', placeholder: 'Choose a menu item' },
  es: { objects: '🏘 Nuestros inmuebles', selection: '✨ Ayúdame a elegir', promotions: '🔥 Promociones', favorites: '❤️ Favoritos', contacts: '💬 Contactar con un gestor', request: '📞 Solicitar una llamada', about: 'ℹ️ La empresa', help: '❓ Ayuda', more: '☰ Más', language: '🌐 Cambiar idioma', placeholder: 'Elige una opción' },
};
const LEGACY_MENU_LABELS = {
  ru: { objects: 'Наши объекты', contacts: 'Контакты', promotions: 'Акции', favorites: 'Избранное', request: 'Оставить заявку', about: 'О нас', language: 'Сменить язык' },
  en: { objects: 'Our properties', contacts: 'Contacts', promotions: 'Special offers', favorites: 'Favorites', request: 'Contact an agent', about: 'About us', language: 'Change language' },
  es: { objects: 'Nuestros inmuebles', contacts: 'Contactos', promotions: 'Promociones', favorites: 'Favoritos', request: 'Contactar con un agente', about: 'Sobre nosotros', language: 'Cambiar idioma' },
};
const MENU_HINTS = {
  ru: 'Выберите интересующий раздел в меню ниже 👇',
  en: 'Choose a section from the menu below 👇',
  es: 'Elige una sección del menú 👇',
};
const MAIN_MENU_TEXT = {
  ru: 'Главное меню. Что вас интересует?',
  en: 'Main menu. What are you interested in?',
  es: 'Menú principal. ¿Qué te interesa?',
};
const MANAGER_CONTACT_TEXT = {
  ru: { intro: '💬 Выберите удобный способ связи с менеджером.', tapPhone: 'Нажмите на номер, чтобы позвонить.', call: 'Позвонить', whatsapp: 'WhatsApp', telegram: 'Telegram', website: 'Сайт', map: 'Карта', request: '📞 Заказать звонок', question: '❓ Задать вопрос', askQuestion: 'Напишите ваш вопрос. Менеджер ответит в этом чате.', received: 'Спасибо! Вопрос передан менеджеру.', replyHeader: '👨‍💼 Ответ менеджера', cancel: 'Отменить' },
  en: { intro: '💬 Choose a convenient way to contact a manager.', tapPhone: 'Tap a phone number to call.', call: 'Call', whatsapp: 'WhatsApp', telegram: 'Telegram', website: 'Website', map: 'Map', request: '📞 Request a call', question: '❓ Ask a question', askQuestion: 'Send your question. A manager will reply in this chat.', received: 'Thank you! Your question has been sent to a manager.', replyHeader: '👨‍💼 Manager reply', cancel: 'Cancel' },
  es: { intro: '💬 Elige una forma cómoda de contactar con un gestor.', tapPhone: 'Pulsa un número para llamar.', call: 'Llamar', whatsapp: 'WhatsApp', telegram: 'Telegram', website: 'Sitio web', map: 'Mapa', request: '📞 Solicitar una llamada', question: '❓ Hacer una pregunta', askQuestion: 'Escribe tu pregunta. Un gestor responderá en este chat.', received: '¡Gracias! Tu pregunta ha sido enviada a un gestor.', replyHeader: '👨‍💼 Respuesta del gestor', cancel: 'Cancelar' },
};
const NAVIGATION_TEXT = {
  ru: { mainMenu: 'Главное меню', backToCard: 'К карточке объекта', close: 'Закрыть', browse: 'Посмотреть объекты', readMore: 'Читать подробнее' },
  en: { mainMenu: 'Main menu', backToCard: 'Back to property', close: 'Close', browse: 'Browse properties', readMore: 'Read more' },
  es: { mainMenu: 'Menú principal', backToCard: 'Volver al inmueble', close: 'Cerrar', browse: 'Ver inmuebles', readMore: 'Leer más' },
};
const INTERACTION_TEXT = {
  ru: { failed: 'Не удалось выполнить действие. Попробуйте ещё раз.', duplicate: 'Подождите секунду…', stale: 'Это действие уже завершено. Выберите нужный раздел в меню.', unfinished: 'У вас осталась незавершённая форма. Продолжить с сохранённого шага или вернуться в главное меню?', continueForm: '▶️ Продолжить заполнение', discardForm: '✕ Закрыть форму', expired: 'Прошло больше суток, поэтому незавершённая форма была закрыта. Начните заново — ранее введённые данные не будут отправлены.', resume: '🔄 Начать заново', backToMenu: '🏠 Вернуться в главное меню', hideGallery: 'Скрыть фотографии и вернуться', reminderLead: '✍️ Вы начали оформлять заявку на звонок, но не закончили. Продолжим с того же места? Это займёт меньше минуты.', reminderViewing: '✍️ Вы начали запись на просмотр, но не закончили. Продолжим с того же места?', reminderSelection: '✍️ Вы начали подбор объекта, но не закончили. Продолжим с того же места? Осталось совсем немного.' },
  en: { failed: 'The action could not be completed. Please try again.', duplicate: 'Please wait a moment…', stale: 'This action has already finished. Choose a section from the menu.', unfinished: 'You have an unfinished form. Continue from the saved step or return to the main menu?', continueForm: '▶️ Continue form', discardForm: '✕ Close form', expired: 'More than 24 hours have passed, so the unfinished form was closed. Start again — your earlier entries will not be sent.', resume: '🔄 Start again', backToMenu: '🏠 Return to main menu', hideGallery: 'Hide photos and go back', reminderLead: '✍️ You started a call request but did not finish it. Shall we continue where you left off? It takes less than a minute.', reminderViewing: '✍️ You started booking a viewing but did not finish it. Shall we continue where you left off?', reminderSelection: '✍️ You started a property search but did not finish it. Shall we continue where you left off? Only a few questions are left.' },
  es: { failed: 'No se pudo completar la acción. Inténtalo de nuevo.', duplicate: 'Espera un momento…', stale: 'Esta acción ya ha terminado. Elige una sección del menú.', unfinished: 'Tienes un formulario sin terminar. ¿Quieres continuar desde el paso guardado o volver al menú principal?', continueForm: '▶️ Continuar formulario', discardForm: '✕ Cerrar formulario', expired: 'Han pasado más de 24 horas, por lo que el formulario sin terminar se ha cerrado. Empieza de nuevo; los datos anteriores no se enviarán.', resume: '🔄 Empezar de nuevo', backToMenu: '🏠 Volver al menú principal', hideGallery: 'Ocultar fotos y volver', reminderLead: '✍️ Empezaste a solicitar una llamada, pero no terminaste. ¿Seguimos donde lo dejaste? Tarda menos de un minuto.', reminderViewing: '✍️ Empezaste a reservar una visita, pero no terminaste. ¿Seguimos donde lo dejaste?', reminderSelection: '✍️ Empezaste la búsqueda de inmueble, pero no terminaste. ¿Seguimos donde lo dejaste? Quedan muy pocas preguntas.' },
};
const COMMAND_TEXT = {
  ru: { cancelled: 'Действие отменено. Вы вернулись в главное меню.', nothingToCancel: 'Сейчас нет незавершённых действий. Главное меню уже доступно.', unknown: 'Я не знаю такую команду. Выберите нужный раздел в меню или используйте /help.', myId: 'Ваш Telegram Chat ID:' },
  en: { cancelled: 'The action has been cancelled. You are back in the main menu.', nothingToCancel: 'There is no unfinished action right now. The main menu is ready.', unknown: 'I do not recognise that command. Choose a section from the menu or use /help.', myId: 'Your Telegram Chat ID:' },
  es: { cancelled: 'La acción se ha cancelado. Has vuelto al menú principal.', nothingToCancel: 'No hay ninguna acción pendiente. El menú principal está disponible.', unknown: 'No reconozco ese comando. Elige una sección del menú o usa /help.', myId: 'Tu ID de chat de Telegram:' },
};
const EMPTY_STATE_TEXT = {
  ru: { catalog: 'Сейчас в каталоге нет доступных объектов. Менеджер поможет подобрать подходящий вариант.', favorites: 'В избранном пока ничего нет. Откройте каталог и нажмите ❤️ у понравившегося объекта.', promotions: 'Активных акций сейчас нет. Посмотрите наши объекты или задайте вопрос менеджеру.' },
  en: { catalog: 'There are no available properties in the catalogue right now. A manager can help you find a suitable option.', favorites: 'Your favorites are empty. Open the catalogue and tap ❤️ on a property you like.', promotions: 'There are no active offers right now. Browse our properties or ask a manager.' },
  es: { catalog: 'Ahora mismo no hay inmuebles disponibles en el catálogo. Un gestor puede ayudarte a encontrar una opción.', favorites: 'Todavía no tienes favoritos. Abre el catálogo y pulsa ❤️ en un inmueble.', promotions: 'No hay promociones activas ahora mismo. Consulta nuestros inmuebles o pregunta a un gestor.' },
};
const PROPERTY_TYPE_LABELS = {
  ru: { apartment: 'Квартира', house: 'Дом', villa: 'Вилла', townhouse: 'Таунхаус', land: 'Участок', commercial: 'Коммерческая недвижимость', newbuild: 'Новостройка', other: 'Недвижимость' },
  en: { apartment: 'Apartment', house: 'House', villa: 'Villa', townhouse: 'Townhouse', land: 'Land', commercial: 'Commercial property', newbuild: 'New development', other: 'Property' },
  es: { apartment: 'Apartamento', house: 'Casa', villa: 'Villa', townhouse: 'Adosado', land: 'Terreno', commercial: 'Propiedad comercial', newbuild: 'Obra nueva', other: 'Inmueble' },
};
const PROPERTY_BADGE_LABELS = {
  ru: { new: 'Новинка', recommended: 'Рекомендуем', exclusive: 'Эксклюзив', price_reduced: 'Цена снижена' },
  en: { new: 'New', recommended: 'Recommended', exclusive: 'Exclusive', price_reduced: 'Price reduced' },
  es: { new: 'Nuevo', recommended: 'Recomendado', exclusive: 'Exclusivo', price_reduced: 'Precio reducido' },
};
const PROPERTY_CONDITION_LABELS = {
  ru: { new: 'Новое', renovated: 'После ремонта', needs_renovation: 'Требует ремонта', under_construction: 'Строится' },
  en: { new: 'New', renovated: 'Renovated', needs_renovation: 'Needs renovation', under_construction: 'Under construction' },
  es: { new: 'Nuevo', renovated: 'Reformado', needs_renovation: 'Para reformar', under_construction: 'En construcción' },
};
const PROPERTY_ACTION_TEXT = {
  ru: { details: 'Подробнее', contactManager: 'Связаться с менеджером', share: 'Поделиться', sharePrefix: 'Посмотрите этот объект: ', viewWebsite: 'Посмотреть на сайте', openMap: 'Открыть карту', interest: 'Заказать звонок', viewing: 'Записаться на просмотр', availability: 'Уточнить доступность', similar: 'Показать похожие объекты', question: 'Задать вопрос', gallery: 'Все фотографии', favoriteButton: 'Добавить в избранное', favoriteRemoveButton: 'Убрать из избранного', favoriteAdd: 'Добавлено в избранное', favoriteRemove: 'Удалено из избранного', askQuestion: 'Напишите ваш вопрос по этому объекту. Можно отправить текст, фотографию или голосовое сообщение.', cancel: 'Отменить действие', cancelled: 'Действие отменено', received: 'Спасибо! Менеджер получил ваше обращение и ответит в этом чате.', emptyFavorites: 'В избранном пока нет объектов. Добавляйте их кнопкой ❤️ под карточкой.', forRent: 'Аренда', forSale: 'Продажа', reserved: 'Забронирован', available: 'Доступен', priceMonth: '/ месяц', priceWeek: '/ неделю', priceOnRequest: 'Цена по запросу', floor: 'Этаж', reference: '№ объекта:', updated: 'Обновлено', propertyUnavailable: 'Этот объект уже недоступен.', propertyHeading: 'Объект', requestViewingPrefix: 'Запрос на просмотр:', questionPrefix: 'Вопрос по объекту:', interestPrefix: 'Интересует объект:', noSimilar: 'Сейчас похожих объектов нет. Менеджер может предложить другие варианты.', similarHeading: 'Похожий объект', managerPrompt: 'Как менеджер может помочь по этому объекту?', photosUnavailable: 'Фотографии пока недоступны', nextProperty: 'Следующий объект →', nextPrompt: 'Что вы хотите сделать дальше?', askPrice: 'Узнать цену', promotionAsk: 'Узнать подробнее' },
  en: { details: 'View details', contactManager: 'Contact a manager', share: 'Share property', sharePrefix: 'Take a look at this property: ', viewWebsite: 'View on website', openMap: 'Open map', interest: 'Request a call', viewing: 'Book a viewing', availability: 'Check availability', similar: 'Show similar properties', question: 'Ask a question', gallery: 'All photos', favoriteButton: 'Add to favorites', favoriteRemoveButton: 'Remove from favorites', favoriteAdd: 'Added to favorites', favoriteRemove: 'Removed from favorites', askQuestion: 'Send your question about this property. You can send text, a photo, or a voice message.', cancel: 'Cancel action', cancelled: 'Action cancelled', received: 'Thank you! A manager received your message and will reply in this chat.', emptyFavorites: 'Your favorites are empty. Add properties with the ❤️ button under a card.', forRent: 'For rent', forSale: 'For sale', reserved: 'Reserved', available: 'Available', priceMonth: '/ month', priceWeek: '/ week', priceOnRequest: 'Price on request', floor: 'Floor', reference: 'Ref:', updated: 'Updated', propertyUnavailable: 'This property is no longer available.', propertyHeading: 'Property', requestViewingPrefix: 'Viewing request:', questionPrefix: 'Question about:', interestPrefix: 'Interested in:', noSimilar: 'No similar properties are available right now. A manager can suggest alternatives.', similarHeading: 'Similar property', managerPrompt: 'How would you like the manager to help with this property?', photosUnavailable: 'Photos are not available yet', nextProperty: 'Next property →', nextPrompt: 'What would you like to do next?', askPrice: 'Ask for the price', promotionAsk: 'Learn more' },
  es: { details: 'Ver detalles', contactManager: 'Contactar con un gestor', share: 'Compartir inmueble', sharePrefix: 'Mira este inmueble: ', viewWebsite: 'Ver en el sitio web', openMap: 'Abrir mapa', interest: 'Solicitar una llamada', viewing: 'Reservar una visita', availability: 'Consultar disponibilidad', similar: 'Ver inmuebles similares', question: 'Hacer una pregunta', gallery: 'Todas las fotos', favoriteButton: 'Añadir a favoritos', favoriteRemoveButton: 'Quitar de favoritos', favoriteAdd: 'Añadido a favoritos', favoriteRemove: 'Eliminado de favoritos', askQuestion: 'Escribe tu pregunta sobre este inmueble. Puedes enviar texto, una foto o un mensaje de voz.', cancel: 'Cancelar acción', cancelled: 'Acción cancelada', received: '¡Gracias! Un gestor ha recibido tu mensaje y responderá en este chat.', emptyFavorites: 'Todavía no tienes favoritos. Añade inmuebles con el botón ❤️ de la ficha.', forRent: 'Alquiler', forSale: 'Venta', reserved: 'Reservado', available: 'Disponible', priceMonth: '/ mes', priceWeek: '/ semana', priceOnRequest: 'Precio a consultar', floor: 'Planta', reference: 'Ref.:', updated: 'Actualizado', propertyUnavailable: 'Este inmueble ya no está disponible.', propertyHeading: 'Inmueble', requestViewingPrefix: 'Solicitud de visita:', questionPrefix: 'Pregunta sobre:', interestPrefix: 'Interés en:', noSimilar: 'No hay inmuebles similares disponibles ahora mismo. Un gestor puede sugerirte alternativas.', similarHeading: 'Inmueble similar', managerPrompt: '¿Cómo quieres que te ayude el gestor con este inmueble?', photosUnavailable: 'Las fotos aún no están disponibles', nextProperty: 'Siguiente inmueble →', nextPrompt: '¿Qué quieres hacer ahora?', askPrice: 'Consultar el precio', promotionAsk: 'Más información' },
};
const LEAD_FORM_TEXT = {
  ru: {
    askName: 'Давайте быстро оформим заявку — это займёт меньше минуты.\n\n1 из 3. Как к вам обращаться?',
    askPhone: '2 из 3. Укажите номер телефона или нажмите «Отправить мой номер».\n\nОтправляя номер, вы разрешаете использовать его для связи по вашей заявке.',
    askTime: '3 из 3. Когда вам удобно принять звонок?',
    phoneButton: '📱 Отправить мой номер',
    cancel: '✕ Отменить заявку',
    cancelled: 'Заполнение заявки отменено.',
    invalidName: 'Пожалуйста, напишите имя — не менее двух символов.',
    invalidPhone: 'Не удалось распознать номер. Введите его с кодом страны или нажмите «Отправить мой номер».',
    invalidTime: 'Напишите удобное время, например: «завтра после 16:00».',
    timeOptions: ['Сегодня после 18:00', 'Завтра 10:00–13:00', 'В любое время'],
    review: 'Проверьте данные перед отправкой:',
    reviewLabels: ['Имя', 'Телефон', 'Удобное время'],
    confirm: '✅ Отправить заявку',
    edit: '✏️ Изменить данные',
    editName: '✏️ Изменить имя',
    editPhone: '📱 Изменить телефон',
    editTime: '🕒 Изменить время',
    savedName: 'Использовать имя',
    savedPhone: 'Использовать номер',
    success: 'Спасибо! Заявка отправлена. Менеджер свяжется с вами в указанное время.',
  },
  en: {
    askName: 'Let’s make a quick request — it will take less than a minute.\n\n1 of 3. What is your name?',
    askPhone: '2 of 3. Enter your phone number or tap “Share my phone number”.\n\nBy sending your number, you allow us to use it to contact you about this request.',
    askTime: '3 of 3. When is a convenient time for a call?',
    phoneButton: '📱 Share my phone number',
    cancel: '✕ Cancel request',
    cancelled: 'The request has been cancelled.',
    invalidName: 'Please enter your name using at least two characters.',
    invalidPhone: 'We could not recognise the number. Include the country code or tap “Share my phone number”.',
    invalidTime: 'Enter a convenient time, for example: “tomorrow after 4 pm”.',
    timeOptions: ['Today after 6 pm', 'Tomorrow 10 am–1 pm', 'Any time'],
    review: 'Please check your details before sending:',
    reviewLabels: ['Name', 'Phone', 'Preferred time'],
    confirm: '✅ Send request',
    edit: '✏️ Edit details',
    editName: '✏️ Edit name',
    editPhone: '📱 Edit phone',
    editTime: '🕒 Edit time',
    savedName: 'Use saved name',
    savedPhone: 'Use saved number',
    success: 'Thank you! Your request has been sent. A manager will contact you at the selected time.',
  },
  es: {
    askName: 'Vamos a completar una solicitud rápida; tardará menos de un minuto.\n\n1 de 3. ¿Cómo te llamas?',
    askPhone: '2 de 3. Indica tu teléfono o pulsa «Compartir mi teléfono».\n\nAl enviar tu número, permites que lo utilicemos para contactar contigo sobre esta solicitud.',
    askTime: '3 de 3. ¿Cuándo te viene bien recibir una llamada?',
    phoneButton: '📱 Compartir mi teléfono',
    cancel: '✕ Cancelar solicitud',
    cancelled: 'La solicitud ha sido cancelada.',
    invalidName: 'Escribe tu nombre con al menos dos caracteres.',
    invalidPhone: 'No pudimos reconocer el número. Incluye el prefijo del país o pulsa «Compartir mi teléfono».',
    invalidTime: 'Indica una hora conveniente, por ejemplo: «mañana después de las 16:00».',
    timeOptions: ['Hoy después de las 18:00', 'Mañana 10:00–13:00', 'A cualquier hora'],
    review: 'Comprueba tus datos antes de enviar:',
    reviewLabels: ['Nombre', 'Teléfono', 'Hora preferida'],
    confirm: '✅ Enviar solicitud',
    edit: '✏️ Cambiar datos',
    editName: '✏️ Cambiar nombre',
    editPhone: '📱 Cambiar teléfono',
    editTime: '🕒 Cambiar hora',
    savedName: 'Usar el nombre guardado',
    savedPhone: 'Usar el número guardado',
    success: '¡Gracias! Tu solicitud ha sido enviada. Un gestor te llamará a la hora indicada.',
  },
};
const VIEWING_FORM_TEXT = {
  ru: {
    askDate: '📅 Когда вам удобно посмотреть этот объект?',
    dateOptions: ['Сегодня', 'Завтра', 'В выходные', 'Другая дата'],
    askTime: '🕒 В какое время вам удобно?',
    timeOptions: ['Утром', 'Днём', 'Вечером', 'Другое время'],
    askCustom: 'Напишите удобные дату и время одним сообщением, например: «25 сентября после 16:00».',
    askCustomTime: 'Напишите удобное время, например: «после 16:00».',
    review: 'Проверьте запись на просмотр:',
    reviewLabels: ['Объект', 'Дата', 'Время'],
    unavailable: 'Этот объект больше недоступен для просмотра.',
    asSpecified: 'Как указано',
    confirm: '✅ Отправить менеджеру',
    restart: '✏️ Изменить дату и время',
    editDate: '📅 Изменить дату',
    editTime: '🕒 Изменить время',
    cancel: '✕ Отменить запись',
    cancelled: 'Запись на просмотр отменена.',
    invalid: 'Пожалуйста, выберите вариант на клавиатуре или напишите удобные дату и время.',
    success: 'Заявка на просмотр отправлена. Менеджер подтвердит дату и время в этом чате.',
    slotTaken: 'Это время только что заняли. Выберите, пожалуйста, другое.',
    slotGone: 'На это время уже нельзя записаться. Выберите, пожалуйста, другое.',
    slotBooked: '✅ Готово, вы записаны на просмотр! Подробности ниже.',
  },
  en: {
    askDate: '📅 When would you like to view this property?',
    dateOptions: ['Today', 'Tomorrow', 'This weekend', 'Another date'],
    askTime: '🕒 What time is convenient?',
    timeOptions: ['Morning', 'Afternoon', 'Evening', 'Another time'],
    askCustom: 'Send a convenient date and time in one message, for example: “25 September after 4 pm”.',
    askCustomTime: 'Send a convenient time, for example: “after 4 pm”.',
    review: 'Please check your viewing request:',
    reviewLabels: ['Property', 'Date', 'Time'],
    unavailable: 'This property is no longer available for viewing.',
    asSpecified: 'As specified',
    confirm: '✅ Send to manager',
    restart: '✏️ Change date and time',
    editDate: '📅 Change date',
    editTime: '🕒 Change time',
    cancel: '✕ Cancel viewing',
    cancelled: 'The viewing request has been cancelled.',
    invalid: 'Choose an option from the keyboard or send a convenient date and time.',
    success: 'Your viewing request has been sent. A manager will confirm the date and time in this chat.',
    slotTaken: 'This time has just been taken. Please choose another one.',
    slotGone: 'This time can no longer be booked. Please choose another one.',
    slotBooked: '✅ Done, your viewing is booked! Details below.',
  },
  es: {
    askDate: '📅 ¿Cuándo te gustaría visitar este inmueble?',
    dateOptions: ['Hoy', 'Mañana', 'Este fin de semana', 'Otra fecha'],
    askTime: '🕒 ¿A qué hora te viene bien?',
    timeOptions: ['Por la mañana', 'Por la tarde', 'Por la noche', 'Otra hora'],
    askCustom: 'Escribe una fecha y hora convenientes en un mensaje, por ejemplo: «25 de septiembre después de las 16:00».',
    askCustomTime: 'Escribe una hora conveniente, por ejemplo: «después de las 16:00».',
    review: 'Comprueba tu solicitud de visita:',
    reviewLabels: ['Inmueble', 'Fecha', 'Hora'],
    unavailable: 'Este inmueble ya no está disponible para visitas.',
    asSpecified: 'Según lo indicado',
    confirm: '✅ Enviar al gestor',
    restart: '✏️ Cambiar fecha y hora',
    editDate: '📅 Cambiar fecha',
    editTime: '🕒 Cambiar hora',
    cancel: '✕ Cancelar visita',
    cancelled: 'La solicitud de visita ha sido cancelada.',
    invalid: 'Elige una opción del teclado o escribe una fecha y hora convenientes.',
    success: 'Tu solicitud de visita ha sido enviada. Un gestor confirmará la fecha y hora en este chat.',
    slotTaken: 'Esta hora se acaba de ocupar. Por favor, elige otra.',
    slotGone: 'Esta hora ya no se puede reservar. Por favor, elige otra.',
    slotBooked: '✅ ¡Listo, tu visita está reservada! Los detalles, abajo.',
  },
};
const SELECTION_FORM_TEXT = {
  ru: {
    intro: '✨ Я задам несколько коротких вопросов и передам ваши пожелания менеджеру.',
    askDeal: '1 из 5. Вы рассматриваете покупку или аренду?',
    dealOptions: ['Покупка', 'Аренда', 'Пока не решил(а)'],
    askType: '2 из 5. Какая недвижимость вас интересует?',
    typeOptions: ['Квартира', 'Дом или вилла', 'Участок', 'Коммерческая', 'Не важно'],
    askLocation: '3 из 5. Какой город, район или направление вас интересует?',
    anyLocation: 'Район не важен',
    askBudget: '4 из 5. Какой бюджет вы рассматриваете? Можно написать сумму и валюту.',
    noBudget: 'Бюджет пока не определён',
    askBedrooms: '5 из 5. Сколько спален нужно?',
    bedroomOptions: ['1 спальня', '2 спальни', '3 спальни', '4+ спальни', 'Не важно'],
    review: 'Проверьте пожелания:',
    summaryTitle: 'Подбор объекта',
    labels: ['Цель', 'Тип', 'Район', 'Бюджет', 'Спальни'],
    confirm: '✅ Отправить менеджеру',
    restart: '✏️ Заполнить заново',
    editDeal: '✏️ Изменить цель',
    editType: '🏠 Изменить тип',
    editLocation: '📍 Изменить район',
    editBudget: '💶 Изменить бюджет',
    editBedrooms: '🛏 Изменить спальни',
    cancel: '✕ Отменить подбор',
    cancelled: 'Подбор объекта отменён.',
    invalid: 'Пожалуйста, напишите ответ или выберите один из вариантов.',
    success: 'Спасибо! Пожелания переданы менеджеру. Подходящие варианты придут в этот чат.',
    successMatches: 'Спасибо! Пожелания переданы менеджеру. А пока посмотрите, что уже есть в каталоге по вашему запросу 👇',
    matchesHeading: '✨ По вашему запросу',
  },
  en: {
    intro: '✨ I will ask a few short questions and send your preferences to a manager.',
    askDeal: '1 of 5. Are you looking to buy or rent?',
    dealOptions: ['Buy', 'Rent', 'Not sure yet'],
    askType: '2 of 5. What kind of property are you looking for?',
    typeOptions: ['Apartment', 'House or villa', 'Land', 'Commercial', 'Any'],
    askLocation: '3 of 5. Which city, area, or location interests you?',
    anyLocation: 'Any location',
    askBudget: '4 of 5. What budget are you considering? You can include the amount and currency.',
    noBudget: 'Budget not decided yet',
    askBedrooms: '5 of 5. How many bedrooms do you need?',
    bedroomOptions: ['1 bedroom', '2 bedrooms', '3 bedrooms', '4+ bedrooms', 'Any'],
    review: 'Please check your preferences:',
    summaryTitle: 'Property selection',
    labels: ['Purpose', 'Type', 'Location', 'Budget', 'Bedrooms'],
    confirm: '✅ Send to manager',
    restart: '✏️ Start again',
    editDeal: '✏️ Edit purpose',
    editType: '🏠 Edit type',
    editLocation: '📍 Edit location',
    editBudget: '💶 Edit budget',
    editBedrooms: '🛏 Edit bedrooms',
    cancel: '✕ Cancel selection',
    cancelled: 'Property selection has been cancelled.',
    invalid: 'Send an answer or choose one of the options.',
    success: 'Thank you! Your preferences have been sent to a manager. Suitable options will arrive in this chat.',
    successMatches: 'Thank you! Your preferences have been sent to a manager. Meanwhile, here is what we already have for your request 👇',
    matchesHeading: '✨ Matching your request',
  },
  es: {
    intro: '✨ Te haré unas preguntas breves y enviaré tus preferencias a un gestor.',
    askDeal: '1 de 5. ¿Quieres comprar o alquilar?',
    dealOptions: ['Comprar', 'Alquilar', 'Aún no lo sé'],
    askType: '2 de 5. ¿Qué tipo de inmueble buscas?',
    typeOptions: ['Apartamento', 'Casa o villa', 'Terreno', 'Local comercial', 'No importa'],
    askLocation: '3 de 5. ¿Qué ciudad, zona o ubicación te interesa?',
    anyLocation: 'Cualquier ubicación',
    askBudget: '4 de 5. ¿Qué presupuesto consideras? Puedes indicar la cantidad y la moneda.',
    noBudget: 'Presupuesto por definir',
    askBedrooms: '5 de 5. ¿Cuántos dormitorios necesitas?',
    bedroomOptions: ['1 dormitorio', '2 dormitorios', '3 dormitorios', '4+ dormitorios', 'No importa'],
    review: 'Comprueba tus preferencias:',
    summaryTitle: 'Selección de inmueble',
    labels: ['Objetivo', 'Tipo', 'Zona', 'Presupuesto', 'Dormitorios'],
    confirm: '✅ Enviar al gestor',
    restart: '✏️ Empezar de nuevo',
    editDeal: '✏️ Cambiar objetivo',
    editType: '🏠 Cambiar tipo',
    editLocation: '📍 Cambiar zona',
    editBudget: '💶 Cambiar presupuesto',
    editBedrooms: '🛏 Cambiar dormitorios',
    cancel: '✕ Cancelar selección',
    cancelled: 'La selección de inmueble ha sido cancelada.',
    invalid: 'Escribe una respuesta o elige una de las opciones.',
    success: '¡Gracias! Tus preferencias han sido enviadas a un gestor. Recibirás opciones adecuadas en este chat.',
    successMatches: '¡Gracias! Tus preferencias han sido enviadas a un gestor. Mientras tanto, mira lo que ya tenemos según tu solicitud 👇',
    matchesHeading: '✨ Según tu solicitud',
  },
};

const LANGUAGE_PICKER_TEXT = {
  ru: '🌐 Choose your language\nElige tu idioma\nВыберите язык',
  en: '🌐 Choose your language\nElige tu idioma\nВыберите язык',
  es: '🌐 Choose your language\nElige tu idioma\nВыберите язык',
};

const BOT_COMMAND_DESCRIPTIONS = {
  ru: { start: 'Запустить бота', menu: 'Открыть главное меню', requests: 'Мои заявки', language: 'Сменить язык', help: 'Помощь', cancel: 'Отменить текущее действие' },
  en: { start: 'Start the bot', menu: 'Open main menu', requests: 'My requests', language: 'Change language', help: 'Help', cancel: 'Cancel current action' },
  es: { start: 'Iniciar el bot', menu: 'Abrir el menú principal', requests: 'Mis solicitudes', language: 'Cambiar idioma', help: 'Ayuda', cancel: 'Cancelar la acción actual' },
};

// "My requests": the client sees what happened to what they sent.
const MY_REQUESTS_TEXT = {
  ru: {
    menuButton: '📋 Мои заявки',
    title: '📋 Ваши последние заявки и обращения:',
    none: 'У вас пока нет заявок. Когда вы закажете звонок, запишетесь на просмотр или зададите вопрос, здесь будет видно, что с заявкой происходит.',
    footer: 'Если нужно что-то уточнить, просто напишите сообщение — менеджер ответит в этом чате.',
    typeViewing: '📅 Просмотр',
    typeLead: '📞 Звонок',
    typeSelection: '✨ Подбор',
    typeQuestion: '❓ Вопрос',
    typeInterest: '🏠 Интерес к объекту',
    typeGeneral: '💬 Сообщение',
    statusNew: '🆕 получена, скоро возьмём в работу',
    statusInProgress: '⏳ в работе у менеджера',
    statusClosed: '✔️ завершена',
    statusConfirmed: '✅ просмотр подтверждён',
    statusCancelled: '✕ отменена',
    sentOn: 'отправлена',
    cancelViewing: '✕ Отменить просмотр',
    cancelAsk: 'Отменить просмотр? Менеджер получит уведомление.',
    cancelYes: '✕ Да, отменить',
    cancelNo: '↩️ Нет, оставить',
    cancelDone: 'Просмотр отменён, менеджер получил уведомление. Записаться снова можно из карточки объекта.',
    kept: 'Хорошо, просмотр остаётся в силе.',
  },
  en: {
    menuButton: '📋 My requests',
    title: '📋 Your latest requests and messages:',
    none: 'You have no requests yet. When you request a call, book a viewing or ask a question, you will see its progress here.',
    footer: 'If you need anything else, just send a message — a manager will reply in this chat.',
    typeViewing: '📅 Viewing',
    typeLead: '📞 Call',
    typeSelection: '✨ Property search',
    typeQuestion: '❓ Question',
    typeInterest: '🏠 Interest in a property',
    typeGeneral: '💬 Message',
    statusNew: '🆕 received, a manager will pick it up soon',
    statusInProgress: '⏳ a manager is working on it',
    statusClosed: '✔️ completed',
    statusConfirmed: '✅ viewing confirmed',
    statusCancelled: '✕ cancelled',
    sentOn: 'sent',
    cancelViewing: '✕ Cancel viewing',
    cancelAsk: 'Cancel this viewing? The manager will be notified.',
    cancelYes: '✕ Yes, cancel',
    cancelNo: '↩️ No, keep it',
    cancelDone: 'The viewing is cancelled and the manager has been notified. You can book again from the property card.',
    kept: 'Fine, the viewing stays as planned.',
  },
  es: {
    menuButton: '📋 Mis solicitudes',
    title: '📋 Tus últimas solicitudes y mensajes:',
    none: 'Todavía no tienes solicitudes. Cuando pidas una llamada, reserves una visita o hagas una pregunta, aquí verás en qué punto está.',
    footer: 'Si necesitas algo más, escribe un mensaje: un gestor responderá en este chat.',
    typeViewing: '📅 Visita',
    typeLead: '📞 Llamada',
    typeSelection: '✨ Búsqueda de inmueble',
    typeQuestion: '❓ Pregunta',
    typeInterest: '🏠 Interés en un inmueble',
    typeGeneral: '💬 Mensaje',
    statusNew: '🆕 recibida, un gestor la atenderá pronto',
    statusInProgress: '⏳ un gestor la está atendiendo',
    statusClosed: '✔️ completada',
    statusConfirmed: '✅ visita confirmada',
    statusCancelled: '✕ cancelada',
    sentOn: 'enviada',
    cancelViewing: '✕ Cancelar visita',
    cancelAsk: '¿Cancelar la visita? El gestor recibirá un aviso.',
    cancelYes: '✕ Sí, cancelar',
    cancelNo: '↩️ No, mantenerla',
    cancelDone: 'La visita se ha cancelado y el gestor ha recibido un aviso. Puedes reservar otra desde la ficha del inmueble.',
    kept: 'De acuerdo, la visita se mantiene.',
  },
};

// What the client agrees to receive: broadcasts and property alerts.
const SUBSCRIPTION_TEXT = {
  ru: {
    menuButton: '🔔 Уведомления',
    title: '🔔 Какие сообщения присылать?\n\nНажмите на пункт, чтобы включить или выключить его. Ответы менеджера и сообщения по вашим заявкам приходят всегда.',
    news: 'Новости и акции',
    alerts: 'Объекты: снижение цены и новые по вашему запросу',
    unsubscribe: '🔕 Отписаться от рассылок',
    newsOff: 'Вы отписались от рассылок. Включить их снова можно в «☰ Ещё → 🔔 Уведомления».',
    newsOn: 'Рассылки снова включены.',
    undo: '↩️ Вернуть рассылки',
  },
  en: {
    menuButton: '🔔 Notifications',
    title: '🔔 Which messages should we send you?\n\nTap an item to turn it on or off. Manager replies and messages about your requests always arrive.',
    news: 'News and offers',
    alerts: 'Properties: price drops and new matches for your request',
    unsubscribe: '🔕 Unsubscribe from news',
    newsOff: 'You have unsubscribed from our news. You can turn it back on in “☰ More → 🔔 Notifications”.',
    newsOn: 'News messages are on again.',
    undo: '↩️ Resubscribe',
  },
  es: {
    menuButton: '🔔 Avisos',
    title: '🔔 ¿Qué mensajes quieres recibir?\n\nPulsa una opción para activarla o desactivarla. Las respuestas del gestor y los mensajes sobre tus solicitudes llegan siempre.',
    news: 'Novedades y promociones',
    alerts: 'Inmuebles: bajadas de precio y novedades según tu solicitud',
    unsubscribe: '🔕 Darse de baja de las novedades',
    newsOff: 'Te has dado de baja de las novedades. Puedes activarlas de nuevo en «☰ Más → 🔔 Avisos».',
    newsOn: 'Las novedades vuelven a estar activadas.',
    undo: '↩️ Volver a suscribirme',
  },
};

// The purchase calculator under a property for sale.
const CALCULATOR_TEXT = {
  ru: {
    openButton: '🧮 Расчёт покупки и ипотеки',
    title: '🧮 Примерный расчёт покупки',
    price: 'Цена',
    costs: 'Налоги и расходы',
    resaleTax: 'Налог на передачу собственности (ITP)',
    newBuildTax: 'НДС на новостройку (IVA)',
    stampDuty: 'Гербовый сбор (AJD)',
    otherCosts: 'Нотариус, регистрация, гестор',
    total: 'Итого с расходами',
    mortgage: 'Ипотека',
    downPayment: 'первый взнос',
    loan: 'кредит',
    years: 'лет',
    monthly: 'в месяц',
    upfront: 'Нужно на старте (взнос и расходы)',
    disclaimer: 'Расчёт примерный: ставки зависят от региона, банка и вашей ситуации. Точные цифры подскажет менеджер.',
    discuss: '💬 Обсудить с менеджером',
  },
  en: {
    openButton: '🧮 Purchase and mortgage estimate',
    title: '🧮 Approximate purchase costs',
    price: 'Price',
    costs: 'Taxes and costs',
    resaleTax: 'Transfer tax (ITP)',
    newBuildTax: 'VAT on new builds (IVA)',
    stampDuty: 'Stamp duty (AJD)',
    otherCosts: 'Notary, land registry, gestor',
    total: 'Total with costs',
    mortgage: 'Mortgage',
    downPayment: 'down payment',
    loan: 'loan',
    years: 'years',
    monthly: 'per month',
    upfront: 'Needed upfront (down payment and costs)',
    disclaimer: 'This is an estimate: rates depend on the region, the bank and your situation. A manager will give you exact figures.',
    discuss: '💬 Discuss with a manager',
  },
  es: {
    openButton: '🧮 Cálculo de compra e hipoteca',
    title: '🧮 Cálculo aproximado de la compra',
    price: 'Precio',
    costs: 'Impuestos y gastos',
    resaleTax: 'Impuesto de transmisiones (ITP)',
    newBuildTax: 'IVA de obra nueva',
    stampDuty: 'Actos jurídicos documentados (AJD)',
    otherCosts: 'Notaría, registro, gestoría',
    total: 'Total con gastos',
    mortgage: 'Hipoteca',
    downPayment: 'entrada',
    loan: 'préstamo',
    years: 'años',
    monthly: 'al mes',
    upfront: 'Necesario al inicio (entrada y gastos)',
    disclaimer: 'El cálculo es aproximado: los tipos dependen de la región, del banco y de tu situación. Un gestor te dará las cifras exactas.',
    discuss: '💬 Hablar con un gestor',
  },
};

// Messages about a viewing after the request: confirmation, a reminder the
// evening before and a question about how it went.
const VIEWING_NOTICE_TEXT = {
  ru: {
    confirmed: '✅ Просмотр подтверждён',
    date: 'Дата',
    time: 'Время',
    address: 'Адрес',
    confirmedFooter: 'Если планы изменятся, откройте «☰ Ещё → 📋 Мои заявки» или просто напишите нам.',
    reminder: '⏰ Напоминаем: завтра просмотр',
    reminderFooter: 'Если планы изменились, отмените просмотр кнопкой ниже или напишите менеджеру.',
    feedbackQuestion: 'Как прошёл просмотр? Нам важно ваше мнение.',
    liked: '👍 Понравилось, хочу обсудить',
    questions: '🤔 Остались вопросы',
    disliked: '👎 Не подошло, покажите другое',
    likedReply: 'Отлично! Менеджер свяжется с вами, чтобы обсудить следующие шаги.',
    questionsReply: 'Напишите ваш вопрос — менеджер ответит в этом чате.',
    dislikedReply: 'Спасибо за честный ответ! Посмотрите похожий вариант:',
    openMap: '📍 Как добраться',
  },
  en: {
    confirmed: '✅ Your viewing is confirmed',
    date: 'Date',
    time: 'Time',
    address: 'Address',
    confirmedFooter: 'If your plans change, open “☰ More → 📋 My requests” or just send us a message.',
    reminder: '⏰ Reminder: your viewing is tomorrow',
    reminderFooter: 'If your plans have changed, cancel the viewing with the button below or message the manager.',
    feedbackQuestion: 'How was the viewing? Your opinion matters to us.',
    liked: '👍 I liked it, let’s talk',
    questions: '🤔 I have questions',
    disliked: '👎 Not for me, show others',
    likedReply: 'Great! A manager will contact you to discuss the next steps.',
    questionsReply: 'Send your question — a manager will reply in this chat.',
    dislikedReply: 'Thank you for your honest answer! Take a look at a similar option:',
    openMap: '📍 How to get there',
  },
  es: {
    confirmed: '✅ Visita confirmada',
    date: 'Fecha',
    time: 'Hora',
    address: 'Dirección',
    confirmedFooter: 'Si cambian tus planes, abre «☰ Más → 📋 Mis solicitudes» o escríbenos.',
    reminder: '⏰ Recordatorio: mañana tienes la visita',
    reminderFooter: 'Si han cambiado tus planes, cancela la visita con el botón de abajo o escribe al gestor.',
    feedbackQuestion: '¿Qué tal fue la visita? Tu opinión nos importa.',
    liked: '👍 Me gustó, quiero hablarlo',
    questions: '🤔 Tengo preguntas',
    disliked: '👎 No me convence, ver otros',
    likedReply: '¡Genial! Un gestor se pondrá en contacto contigo para hablar de los siguientes pasos.',
    questionsReply: 'Escribe tu pregunta: un gestor responderá en este chat.',
    dislikedReply: '¡Gracias por tu sinceridad! Echa un vistazo a una opción similar:',
    openMap: '📍 Cómo llegar',
  },
};

// Every phrase below is shown to a bot user. The administrator can override it
// without changing this file; these values remain the safe multilingual defaults.
const CATALOG_FILTER_TEXT = {
  ru: {
    button: '🔎 Фильтр',
    title: '🔎 Подберите объекты по параметрам. Отмеченное ✓ уже выбрано.',
    anyDeal: 'Продажа и аренда',
    anyType: 'Все типы',
    anyBedrooms: 'Спальни: любое',
    bedrooms: 'спален',
    show: '✅ Показать',
    reset: '↺ Сбросить фильтр',
    empty: 'По этим параметрам объектов пока нет. Измените фильтр или оставьте пожелания — менеджер подберёт варианты.',
    anyCity: 'Любой город',
    anyPrice: 'Цена: любая',
    upTo: 'до',
    sortAsc: 'Сначала дешевле',
    sortDesc: 'Сначала дороже',
  },
  en: {
    button: '🔎 Filter',
    title: '🔎 Narrow down the properties. Options marked ✓ are selected.',
    anyDeal: 'Sale and rent',
    anyType: 'All types',
    anyBedrooms: 'Bedrooms: any',
    bedrooms: 'bedrooms',
    show: '✅ Show',
    reset: '↺ Reset filter',
    empty: 'No properties match these options yet. Change the filter or leave your wishes — a manager will find options for you.',
    anyCity: 'Any city',
    anyPrice: 'Price: any',
    upTo: 'up to',
    sortAsc: 'Cheapest first',
    sortDesc: 'Most expensive first',
  },
  es: {
    button: '🔎 Filtro',
    title: '🔎 Filtra los inmuebles. Las opciones con ✓ están seleccionadas.',
    anyDeal: 'Venta y alquiler',
    anyType: 'Todos los tipos',
    anyBedrooms: 'Dormitorios: cualquiera',
    bedrooms: 'dormitorios',
    show: '✅ Mostrar',
    reset: '↺ Quitar filtro',
    empty: 'Todavía no hay inmuebles con estas opciones. Cambia el filtro o deja tus preferencias y un gestor buscará opciones.',
    anyCity: 'Cualquier ciudad',
    anyPrice: 'Precio: cualquiera',
    upTo: 'hasta',
    sortAsc: 'Más baratos primero',
    sortDesc: 'Más caros primero',
  },
};

const PROPERTY_ALERT_TEXT = {
  ru: {
    priceDrop: '📉 Цена снизилась — объект из вашего избранного',
    backAvailable: '✅ Снова доступен — объект из вашего избранного',
    newMatch: '✨ Новый объект по вашему запросу',
    turnOff: '🔕 Не присылать такие уведомления',
    turnedOff: 'Хорошо, больше не будем присылать уведомления об объектах.',
    turnOn: '🔔 Снова присылать уведомления',
    turnedOn: 'Уведомления об объектах снова включены.',
  },
  en: {
    priceDrop: '📉 Price reduced — a property from your favorites',
    backAvailable: '✅ Available again — a property from your favorites',
    newMatch: '✨ A new property matching your request',
    turnOff: '🔕 Stop these notifications',
    turnedOff: 'Done — we will not send property notifications any more.',
    turnOn: '🔔 Send notifications again',
    turnedOn: 'Property notifications are on again.',
  },
  es: {
    priceDrop: '📉 Precio rebajado — un inmueble de tus favoritos',
    backAvailable: '✅ Disponible de nuevo — un inmueble de tus favoritos',
    newMatch: '✨ Un nuevo inmueble según tu solicitud',
    turnOff: '🔕 No enviar estos avisos',
    turnedOff: 'Hecho: ya no te enviaremos avisos sobre inmuebles.',
    turnOn: '🔔 Volver a enviar avisos',
    turnedOn: 'Los avisos sobre inmuebles vuelven a estar activados.',
  },
};

const INTERFACE_TEXT_TARGETS = {
  languageSelected: { target: LANGUAGE_SELECTED, scalarKey: 'text' },
  languagePicker: { target: LANGUAGE_PICKER_TEXT, scalarKey: 'text' },
  commandDescriptions: { target: BOT_COMMAND_DESCRIPTIONS },
  menuLabels: { target: MENU_LABELS },
  menuHints: { target: MENU_HINTS, scalarKey: 'text' },
  mainMenu: { target: MAIN_MENU_TEXT, scalarKey: 'text' },
  managerContact: { target: MANAGER_CONTACT_TEXT },
  navigation: { target: NAVIGATION_TEXT },
  interaction: { target: INTERACTION_TEXT },
  commands: { target: COMMAND_TEXT },
  emptyStates: { target: EMPTY_STATE_TEXT },
  propertyTypes: { target: PROPERTY_TYPE_LABELS },
  propertyBadges: { target: PROPERTY_BADGE_LABELS },
  propertyConditions: { target: PROPERTY_CONDITION_LABELS },
  propertyActions: { target: PROPERTY_ACTION_TEXT },
  callbackForm: { target: LEAD_FORM_TEXT },
  viewingForm: { target: VIEWING_FORM_TEXT },
  selectionForm: { target: SELECTION_FORM_TEXT },
  propertyAlerts: { target: PROPERTY_ALERT_TEXT },
  catalogFilter: { target: CATALOG_FILTER_TEXT },
  myRequests: { target: MY_REQUESTS_TEXT },
  viewingNotices: { target: VIEWING_NOTICE_TEXT },
  subscriptions: { target: SUBSCRIPTION_TEXT },
  calculator: { target: CALCULATOR_TEXT },
};

const INTERFACE_TEXT_DEFAULTS = Object.fromEntries(Object.entries(INTERFACE_TEXT_TARGETS).map(([group, descriptor]) => [
  group,
  Object.fromEntries(['ru', 'en', 'es'].map((language) => [
    language,
    descriptor.scalarKey
      ? { [descriptor.scalarKey]: descriptor.target[language] }
      : clone(descriptor.target[language]),
  ])),
]));

function normalizedInterfaceText(value, strict = false) {
  const incoming = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  const result = {};
  for (const [group, languages] of Object.entries(INTERFACE_TEXT_DEFAULTS)) {
    result[group] = {};
    for (const language of ['ru', 'en', 'es']) {
      const defaults = languages[language];
      const source = incoming[group] && incoming[group][language] && typeof incoming[group][language] === 'object'
        ? incoming[group][language]
        : {};
      result[group][language] = {};
      for (const [key, fallback] of Object.entries(defaults)) {
        if (Array.isArray(fallback)) {
          const values = Array.isArray(source[key])
            ? source[key].map((item) => cleanText(item, 80)).filter(Boolean)
            : [];
          if (strict && values.length !== fallback.length) {
            throw new Error('В списке «' + group + ' / ' + key + '» должно быть ' + fallback.length + ' строк');
          }
          result[group][language][key] = values.length === fallback.length ? values : clone(fallback);
          continue;
        }
        const text = cleanText(source[key], String(fallback).length > 55 || String(fallback).includes('\n') ? 4000 : 80);
        if (strict && !text) throw new Error('Все тексты интерфейса должны быть заполнены');
        result[group][language][key] = text || fallback;
      }
    }
  }
  return result;
}

function applyInterfaceText(value) {
  const next = normalizedInterfaceText(value);
  for (const [group, descriptor] of Object.entries(INTERFACE_TEXT_TARGETS)) {
    for (const language of ['ru', 'en', 'es']) {
      const languageValue = next[group][language];
      if (descriptor.scalarKey) descriptor.target[language] = languageValue[descriptor.scalarKey];
      else descriptor.target[language] = clone(languageValue);
    }
  }
  return next;

}

export {
  BOT_COMMAND_DESCRIPTIONS,
  CALCULATOR_TEXT,
  CATALOG_FILTER_TEXT,
  COMMAND_TEXT,
  EMPTY_STATE_TEXT,
  INTERACTION_TEXT,
  INTERFACE_TEXT_DEFAULTS,
  INTERFACE_TEXT_TARGETS,
  LANGUAGE_NAMES,
  LANGUAGE_PICKER_TEXT,
  LANGUAGE_SELECTED,
  LEAD_FORM_TEXT,
  LEGACY_MENU_LABELS,
  MAIN_MENU_TEXT,
  MANAGER_CONTACT_TEXT,
  MENU_HINTS,
  MENU_LABELS,
  MY_REQUESTS_TEXT,
  NAVIGATION_TEXT,
  PROPERTY_ACTION_TEXT,
  PROPERTY_ALERT_TEXT,
  PROPERTY_BADGE_LABELS,
  PROPERTY_CONDITION_LABELS,
  PROPERTY_TYPE_LABELS,
  SELECTION_FORM_TEXT,
  SUBSCRIPTION_TEXT,
  VIEWING_FORM_TEXT,
  VIEWING_NOTICE_TEXT,
  applyInterfaceText,
  normalizedInterfaceText,
};
