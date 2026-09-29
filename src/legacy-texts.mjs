// Прежние значения по умолчанию для текстов интерфейса — то, что до версии 39
// бот записывал в bot-data.json как «сохранённые» тексты и что перекрывало новые
// значения по умолчанию (клиент видел «gestor» и «manager», хотя в словаре давно
// «asesor» и «agent»). Миграция 39 убирает из сохранённого только эти строки:
// всё, что владелец написал сам, в таблице не значится и остаётся как есть.
// Набор снят с реальных данных и сверен с историей проекта.

export const PREVIOUS_INTERFACE_TEXTS = {
  "menuLabels": {
    "en": {
      "contacts": [
        "💬 Manager"
      ]
    },
    "es": {
      "contacts": [
        "💬 Gestor"
      ]
    }
  },
  "managerContact": {
    "en": {
      "intro": [
        "💬 Choose a convenient way to contact a manager."
      ],
      "askQuestion": [
        "Send your question. A manager will reply in this chat."
      ],
      "received": [
        "Thank you! Your question has been sent to a manager."
      ],
      "replyHeader": [
        "👨‍💼 Manager reply"
      ]
    },
    "es": {
      "intro": [
        "💬 Elige una forma cómoda de contactar con un gestor."
      ],
      "askQuestion": [
        "Escribe tu pregunta. Un gestor responderá en este chat."
      ],
      "received": [
        "¡Gracias! Tu pregunta ha sido enviada a un gestor."
      ],
      "replyHeader": [
        "👨‍💼 Respuesta del gestor"
      ]
    }
  },
  "emptyStates": {
    "en": {
      "catalog": [
        "There are no available properties in the catalogue right now. A manager can help you find a suitable option."
      ],
      "promotions": [
        "There are no active offers right now. Browse our properties or ask a manager."
      ]
    },
    "es": {
      "catalog": [
        "Ahora mismo no hay inmuebles disponibles en el catálogo. Un gestor puede ayudarte a encontrar una opción."
      ],
      "promotions": [
        "No hay promociones activas ahora mismo. Consulta nuestros inmuebles o pregunta a un gestor."
      ]
    }
  },
  "propertyActions": {
    "ru": {
      "sharePrefix": [
        "Посмотрите этот объект:"
      ],
      "similar": [
        "Показать похожие объекты"
      ],
      "similarHeading": [
        "Похожий объект"
      ]
    },
    "en": {
      "contactManager": [
        "Contact a manager"
      ],
      "sharePrefix": [
        "Take a look at this property:"
      ],
      "similar": [
        "Show similar properties"
      ],
      "cardFavoriteRemove": [
        "Unsave"
      ],
      "received": [
        "Thank you! A manager received your message and will reply in this chat."
      ],
      "noSimilar": [
        "No similar properties are available right now. A manager can suggest alternatives."
      ],
      "similarHeading": [
        "Similar property"
      ],
      "managerPrompt": [
        "How would you like the manager to help with this property?"
      ]
    },
    "es": {
      "contactManager": [
        "Contactar con un gestor"
      ],
      "sharePrefix": [
        "Mira este inmueble:"
      ],
      "similar": [
        "Ver inmuebles similares"
      ],
      "received": [
        "¡Gracias! Un gestor ha recibido tu mensaje y responderá en este chat."
      ],
      "noSimilar": [
        "No hay inmuebles similares disponibles ahora mismo. Un gestor puede sugerirte alternativas."
      ],
      "similarHeading": [
        "Inmueble similar"
      ],
      "managerPrompt": [
        "¿Cómo quieres que te ayude el gestor con este inmueble?"
      ]
    }
  },
  "callbackForm": {
    "ru": {
      "askName": [
        "Давайте быстро оформим заявку — это займёт меньше минуты.\n\n1 из 3. Как к вам обр"
      ],
      "askPhone": [
        "2 из 3. Укажите номер телефона или нажмите «Отправить мой номер».\n\nОтправляя номер, вы разрешаете использовать его для связи по вашей заявке."
      ],
      "askTime": [
        "3 из 3. Когда вам удобно принять звонок?"
      ]
    },
    "en": {
      "askName": [
        "Let’s make a quick request — it will take less than a minute.\n\n1 of 3. What is y"
      ],
      "askPhone": [
        "2 of 3. Enter your phone number or tap “Share my phone number”.\n\nBy sending your number, you allow us to use it to contact you about this request."
      ],
      "askTime": [
        "3 of 3. When is a convenient time for a call?"
      ],
      "success": [
        "Thank you! Your request has been sent. A manager will contact you at the selected time."
      ]
    },
    "es": {
      "askName": [
        "Vamos a completar una solicitud rápida; tardará menos de un minuto.\n\n1 de 3. ¿Có"
      ],
      "askPhone": [
        "2 de 3. Indica tu teléfono o pulsa «Compartir mi teléfono».\n\nAl enviar tu número, permites que lo utilicemos para contactar contigo sobre esta solicitud."
      ],
      "askTime": [
        "3 de 3. ¿Cuándo te viene bien recibir una llamada?"
      ],
      "success": [
        "¡Gracias! Tu solicitud ha sido enviada. Un gestor te llamará a la hora indicada."
      ]
    }
  },
  "viewingForm": {
    "ru": {
      "slotBooked": [
        "✅ Готово, вы записаны на просмотр! Подробности ниже."
      ]
    },
    "en": {
      "success": [
        "Your viewing request has been sent. A manager will confirm the date and time in this chat."
      ],
      "slotBooked": [
        "✅ Done, your viewing is booked! Details below."
      ]
    },
    "es": {
      "confirm": [
        "✅ Enviar al gestor"
      ],
      "success": [
        "Tu solicitud de visita ha sido enviada. Un gestor confirmará la fecha y hora en este chat."
      ],
      "slotBooked": [
        "✅ ¡Listo, tu visita está reservada! Los detalles, abajo."
      ]
    }
  },
  "selectionForm": {
    "en": {
      "intro": [
        "✨ I will ask a few short questions and send your preferences to a manager."
      ],
      "success": [
        "Thank you! Your preferences have been sent to a manager. Suitable options will arrive in this chat."
      ],
      "successMatches": [
        "Thank you! Your preferences have been sent to a manager. Meanwhile, here is what we already have for your request 👇"
      ],
      "noMatchesYet": [
        "Nothing in the catalog matches exactly yet. While a manager looks for options, you can browse all properties."
      ],
      "warningPriceMissing": [
        "the manager will confirm the price"
      ],
      "warningBedroomsMissing": [
        "the manager will confirm the bedroom count"
      ]
    },
    "es": {
      "intro": [
        "✨ Te haré unas preguntas breves y enviaré tus preferencias a un gestor."
      ],
      "askBudget": [
        "4 de 5. ¿Qué presupuesto consideras? Puedes indicar la cantidad y la moneda."
      ],
      "confirm": [
        "✅ Enviar al gestor"
      ],
      "success": [
        "¡Gracias! Tus preferencias han sido enviadas a un gestor. Recibirás opciones adecuadas en este chat."
      ],
      "successMatches": [
        "¡Gracias! Tus preferencias han sido enviadas a un gestor. Mientras tanto, mira lo que ya tenemos según tu solicitud 👇"
      ],
      "noMatchesYet": [
        "Todavía no hay coincidencias exactas en el catálogo. Mientras un gestor busca opciones, puedes ver todos los inmuebles."
      ],
      "warningPriceMissing": [
        "el gestor confirmará el precio"
      ],
      "warningBedroomsMissing": [
        "el gestor confirmará los dormitorios"
      ]
    }
  },
  "catalogFilter": {
    "en": {
      "empty": [
        "No properties match these options yet. Change the filter or leave your wishes — a manager will find options for you."
      ],
      "sendToManager": [
        "Send criteria to a manager"
      ],
      "sentToManager": [
        "Your criteria have been sent to a manager. They will reply in this chat."
      ]
    },
    "es": {
      "empty": [
        "Todavía no hay inmuebles con estas opciones. Cambia el filtro o deja tus preferencias y un gestor buscará opciones."
      ],
      "sendToManager": [
        "Enviar criterios al gestor"
      ],
      "sentToManager": [
        "Tus criterios se han enviado a un gestor. Responderá en este chat."
      ]
    }
  },
  "myRequests": {
    "en": {
      "footer": [
        "If you need anything else, just send a message — a manager will reply in this chat."
      ],
      "statusNew": [
        "🆕 received, a manager will pick it up soon"
      ],
      "statusInProgress": [
        "⏳ a manager is working on it"
      ],
      "cancelAsk": [
        "Cancel this viewing? The manager will be notified."
      ],
      "cancelDone": [
        "The viewing is cancelled and the manager has been notified. You can book again from the property card."
      ]
    },
    "es": {
      "footer": [
        "Si necesitas algo más, escribe un mensaje: un gestor responderá en este chat."
      ],
      "statusNew": [
        "🆕 recibida, un gestor la atenderá pronto"
      ],
      "statusInProgress": [
        "⏳ un gestor la está atendiendo"
      ],
      "cancelAsk": [
        "¿Cancelar la visita? El gestor recibirá un aviso."
      ],
      "cancelDone": [
        "La visita se ha cancelado y el gestor ha recibido un aviso. Puedes reservar otra desde la ficha del inmueble."
      ]
    }
  },
  "privacy": {
    "en": {
      "eraseWarning": [
        "This removes your requests and the conversation with the manager, favorites, comparison, saved search, viewing history, phone and name. It cannot be undone. You can start again any time."
      ]
    },
    "es": {
      "eraseWarning": [
        "Se eliminarán tus solicitudes y la conversación con el gestor, favoritos, comparación, búsqueda guardada, historial de vistos, teléfono y nombre. No se puede deshacer. Puedes empezar de nuevo cuando quieras."
      ]
    }
  },
  "viewingNotices": {
    "en": {
      "reminderFooter": [
        "If your plans have changed, cancel the viewing with the button below or message the manager."
      ],
      "likedReply": [
        "Great! A manager will contact you to discuss the next steps."
      ],
      "questionsReply": [
        "Send your question — a manager will reply in this chat."
      ]
    },
    "es": {
      "reminderFooter": [
        "Si han cambiado tus planes, cancela la visita con el botón de abajo o escribe al gestor."
      ],
      "likedReply": [
        "¡Genial! Un gestor se pondrá en contacto contigo para hablar de los siguientes pasos."
      ],
      "questionsReply": [
        "Escribe tu pregunta: un gestor responderá en este chat."
      ]
    }
  },
  "subscriptions": {
    "en": {
      "title": [
        "🔔 Which messages should we send you?\n\nTap an item to turn it on or off. Manager replies and messages about your requests always arrive."
      ]
    },
    "es": {
      "title": [
        "🔔 ¿Qué mensajes quieres recibir?\n\nPulsa una opción para activarla o desactivarla. Las respuestas del gestor y los mensajes sobre tus solicitudes llegan siempre."
      ]
    }
  },
  "calculator": {
    "en": {
      "disclaimer": [
        "This is an estimate: rates depend on the region, the bank and your situation. A manager will give you exact figures."
      ],
      "discuss": [
        "💬 Discuss with a manager"
      ]
    },
    "es": {
      "disclaimer": [
        "El cálculo es aproximado: los tipos dependen de la región, del banco y de tu situación. Un gestor te dará las cifras exactas."
      ],
      "discuss": [
        "💬 Hablar con un gestor"
      ]
    }
  }
};
