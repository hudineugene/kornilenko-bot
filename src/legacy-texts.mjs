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

// Отпечатки (первые 12 знаков SHA-1 от JSON) значений по умолчанию, какими они
// были в версии 38: «группа.язык.ключ» → отпечаток. Пока бот сохранял тексты
// целиком, в файле лежали именно эти значения; если формулировку в словаре
// меняют позже, сохранённое старое значение по отпечатку всё равно узнаётся как
// «не своё» и уступает новому. Так не надо вписывать каждое изменение в таблицу.
export const VERSION_38_DEFAULT_HASHES = {"languageSelected.ru.text":"d7a4cce1e9f1","languageSelected.en.text":"99d4e6dbe8e1","languageSelected.es.text":"5b6b7855b698","languagePicker.ru.text":"95f2055709bc","languagePicker.en.text":"95f2055709bc","languagePicker.es.text":"95f2055709bc","commandDescriptions.ru.start":"6ec94a4a45b8","commandDescriptions.ru.menu":"6cd9ac0731d6","commandDescriptions.ru.requests":"46cc525c777e","commandDescriptions.ru.language":"0611352c9e42","commandDescriptions.ru.privacy":"3341fd66703a","commandDescriptions.ru.help":"f2116deab81d","commandDescriptions.ru.cancel":"21f5420c3d53","commandDescriptions.en.start":"40f49ee9bf7b","commandDescriptions.en.menu":"c249b1bd49ce","commandDescriptions.en.requests":"c09b8e4227f3","commandDescriptions.en.language":"190669ee755a","commandDescriptions.en.privacy":"e057249c19fb","commandDescriptions.en.help":"97151c9bf7c2","commandDescriptions.en.cancel":"480b64ecf429","commandDescriptions.es.start":"cb9f6a9f2251","commandDescriptions.es.menu":"2a333f186307","commandDescriptions.es.requests":"e6cb03d5a31b","commandDescriptions.es.language":"f23edaf30c40","commandDescriptions.es.privacy":"a9576c266bb2","commandDescriptions.es.help":"936567a80ac8","commandDescriptions.es.cancel":"510eb02291fb","menuLabels.ru.objects":"995f93e95af3","menuLabels.ru.selection":"0fb6ef6834e9","menuLabels.ru.promotions":"e1c91c2d4225","menuLabels.ru.favorites":"6d25e6bc3fe1","menuLabels.ru.contacts":"22cf1eff9aea","menuLabels.ru.request":"8df04b1bd161","menuLabels.ru.about":"1131d6f8ed07","menuLabels.ru.help":"b96ba6afa8d4","menuLabels.ru.more":"848e5b83b416","menuLabels.ru.language":"137b33f5c44c","menuLabels.ru.placeholder":"f6c9474dd0b2","menuLabels.en.objects":"4a0c7325e5e1","menuLabels.en.selection":"40caebb42610","menuLabels.en.promotions":"005da179d44e","menuLabels.en.favorites":"c54f61c6d410","menuLabels.en.contacts":"aa877e26fd9e","menuLabels.en.request":"c122f5d44456","menuLabels.en.about":"682913676af8","menuLabels.en.help":"80d54656f8ba","menuLabels.en.more":"71a67a5798a7","menuLabels.en.language":"2512dfa70be9","menuLabels.en.placeholder":"973d72a1ee22","menuLabels.es.objects":"fd1009e878f7","menuLabels.es.selection":"5b9cd0de52dd","menuLabels.es.promotions":"9ea40cacb40e","menuLabels.es.favorites":"6585279f0405","menuLabels.es.contacts":"34da388d70d0","menuLabels.es.request":"826fc2ad9d6e","menuLabels.es.about":"c00590b2bcbe","menuLabels.es.help":"15ea408078c8","menuLabels.es.more":"a0760f4bd0ba","menuLabels.es.language":"cbd6c0f93529","menuLabels.es.placeholder":"b6c3c1b6ff9d","menuHints.ru.text":"8f22d1c915b7","menuHints.en.text":"20b93b3cf7d3","menuHints.es.text":"7d8f594968f8","catalogSummary.ru.line":"5170f454711f","catalogSummary.ru.empty":"40a0b006b3ec","catalogSummary.ru.one":"6783ab674abf","catalogSummary.ru.few":"280c9719842b","catalogSummary.ru.many":"7a874f04cfef","catalogSummary.en.line":"6870a000f4fe","catalogSummary.en.empty":"bb2ac350bf06","catalogSummary.en.one":"110ba45ba385","catalogSummary.en.few":"28d397d5ce47","catalogSummary.en.many":"28d397d5ce47","catalogSummary.es.line":"fd3dff084868","catalogSummary.es.empty":"f73b32081a38","catalogSummary.es.one":"f56d3c63744b","catalogSummary.es.few":"59db4c4d82c2","catalogSummary.es.many":"59db4c4d82c2","mainMenu.ru.text":"79ae2c359f82","mainMenu.en.text":"103d6bb05384","mainMenu.es.text":"f5458147ba76","myArea.ru.title":"848e5b83b416","myArea.ru.intro":"2824fb8625a4","myArea.ru.recent":"0b2bbeefcfc8","myArea.ru.recentHeading":"0b2bbeefcfc8","myArea.ru.recentEmpty":"f8e5ec86cad1","myArea.en.title":"71a67a5798a7","myArea.en.intro":"2dc233834a65","myArea.en.recent":"3fbf7699a87f","myArea.en.recentHeading":"3fbf7699a87f","myArea.en.recentEmpty":"148494e6f462","myArea.es.title":"a0760f4bd0ba","myArea.es.intro":"a338f97c8bf1","myArea.es.recent":"0f24254f88b6","myArea.es.recentHeading":"0f24254f88b6","myArea.es.recentEmpty":"75b861fa2d65","savedSearch.ru.title":"d4ceb563a9e1","savedSearch.ru.menuButton":"d4ceb563a9e1","savedSearch.ru.empty":"2c031cfa28f4","savedSearch.ru.active":"37ad5181610f","savedSearch.ru.paused":"d6028422985c","savedSearch.ru.notificationsOff":"a02e7cf0068e","savedSearch.ru.criteria":"d16896fe1054","savedSearch.ru.matches":"b990769f973a","savedSearch.ru.save":"862a7bc88d0b","savedSearch.ru.update":"e8d9f32ebf80","savedSearch.ru.open":"706d403d7697","savedSearch.ru.saved":"a9f7a106f5de","savedSearch.ru.requiresFilter":"713b364ae0cb","savedSearch.ru.showResults":"332c21449d9d","savedSearch.ru.edit":"7417310e557f","savedSearch.ru.pause":"3b6dcb4729ec","savedSearch.ru.resume":"7d907fd6873c","savedSearch.ru.remove":"e5b7be712b21","savedSearch.ru.removed":"2c5ad999a67d","savedSearch.ru.pausedNotice":"cf6dcf57f1bc","savedSearch.ru.resumedNotice":"41b9f84eb79d","savedSearch.ru.onShort":"5692526b1c91","savedSearch.ru.pausedShort":"3ffd815a546d","savedSearch.ru.newMatch":"8cf0fe4988bc","savedSearch.en.title":"fc4dd03c10f2","savedSearch.en.menuButton":"fc4dd03c10f2","savedSearch.en.empty":"d096950d589b","savedSearch.en.active":"3be7c4a04505","savedSearch.en.paused":"6d8df6e66150","savedSearch.en.notificationsOff":"ff34458dfbe1","savedSearch.en.criteria":"87c82fd723b8","savedSearch.en.matches":"af51d8895ba4","savedSearch.en.save":"d6f33cfd7098","savedSearch.en.update":"4bbafd57fe5c","savedSearch.en.open":"7ce84834ef0b","savedSearch.en.saved":"cb0b35686f27","savedSearch.en.requiresFilter":"f485eb27aa8b","savedSearch.en.showResults":"c6f18bcf95fa","savedSearch.en.edit":"88d2cc25c9d3","savedSearch.en.pause":"de9697cc0f98","savedSearch.en.resume":"0d31c3b2c714","savedSearch.en.remove":"4ca45c2794af","savedSearch.en.removed":"5d797671beb2","savedSearch.en.pausedNotice":"c2778b5972a7","savedSearch.en.resumedNotice":"fbbf632a2411","savedSearch.en.onShort":"9bc378a6b903","savedSearch.en.pausedShort":"cc0f827a1cd3","savedSearch.en.newMatch":"32530dd2c502","savedSearch.es.title":"5bcd2d458bd7","savedSearch.es.menuButton":"5bcd2d458bd7","savedSearch.es.empty":"e20b47013447","savedSearch.es.active":"0f9e9f1b983a","savedSearch.es.paused":"64d28deba7d5","savedSearch.es.notificationsOff":"e917c4072b77","savedSearch.es.criteria":"67b25887aeb2","savedSearch.es.matches":"fb0b7659edce","savedSearch.es.save":"51bfec70193c","savedSearch.es.update":"869ba3a0c9a4","savedSearch.es.open":"2a7ded61b206","savedSearch.es.saved":"083d1b81b36e","savedSearch.es.requiresFilter":"23e384a8de1f","savedSearch.es.showResults":"27f8614e231b","savedSearch.es.edit":"56b08bb2c55c","savedSearch.es.pause":"a1fde56123f4","savedSearch.es.resume":"8637da0fb965","savedSearch.es.remove":"a7344b0e5cc5","savedSearch.es.removed":"d6bbf8bf75d7","savedSearch.es.pausedNotice":"04d361e76579","savedSearch.es.resumedNotice":"d8215687aaa5","savedSearch.es.onShort":"e27c786e1fdf","savedSearch.es.pausedShort":"3f56fc2e286e","savedSearch.es.newMatch":"f6c2b92fa802","comparison.ru.title":"1bf58d9ce508","comparison.ru.menuButton":"bb6da4390e83","comparison.ru.intro":"c16cab11775e","comparison.ru.empty":"31d61faad648","comparison.ru.needMore":"6caad3b023a8","comparison.ru.cardAdd":"da7ee0012b17","comparison.ru.cardSelected":"8b26740ee8ee","comparison.ru.cardAddShort":"f888263f079b","comparison.ru.cardSelectedShort":"ee94f5095537","comparison.ru.added":"7a6059327ce2","comparison.ru.limit":"6da7c4febaa6","comparison.ru.removed":"83d63741b3d6","comparison.ru.cleared":"09e588207604","comparison.ru.open":"18eb2688006d","comparison.ru.remove":"d2b801829e81","comparison.ru.clear":"37dd0bb9cb30","comparison.ru.browse":"d538a29eb51f","comparison.ru.selectedCount":"5e9fdf83a84e","comparison.ru.price":"f4289a563d2e","comparison.ru.location":"c0a07295bf4d","comparison.ru.type":"0227915df662","comparison.ru.area":"f44778e55000","comparison.ru.plotArea":"3ae72513ed98","comparison.ru.bedrooms":"f5f50d8ac9e9","comparison.ru.bathrooms":"93993dbc2847","comparison.ru.condition":"c004604a412f","comparison.ru.floor":"76763813c672","comparison.ru.distanceSea":"0c5616459bff","comparison.ru.status":"6d16deb1becc","comparison.ru.reference":"1d1dcd515e00","comparison.ru.notSpecified":"cc32a72e28a1","comparison.en.title":"34abe817333d","comparison.en.menuButton":"eacec69fde3c","comparison.en.intro":"497b020c73a7","comparison.en.empty":"33115d730848","comparison.en.needMore":"fae9ef2e12c5","comparison.en.cardAdd":"f44052ba73c8","comparison.en.cardSelected":"23f81988d214","comparison.en.cardAddShort":"48c402986e7b","comparison.en.cardSelectedShort":"48c402986e7b","comparison.en.added":"40413f155c39","comparison.en.limit":"b8bbd1aad660","comparison.en.removed":"a545095c1421","comparison.en.cleared":"9d83bf877684","comparison.en.open":"da890d091c97","comparison.en.remove":"05cf1c0ea54a","comparison.en.clear":"01bbe6dc63ae","comparison.en.browse":"02392e8c13c8","comparison.en.selectedCount":"ab182ac12774","comparison.en.price":"d8338f131468","comparison.en.location":"9c9841139c6b","comparison.en.type":"1e37f9fd7c4f","comparison.en.area":"66bd7320bcab","comparison.en.plotArea":"b2589b13f7e9","comparison.en.bedrooms":"82a4c909eef3","comparison.en.bathrooms":"96043cd292e2","comparison.en.condition":"1e76ea6a5f69","comparison.en.floor":"73e88aadd334","comparison.en.distanceSea":"a8f3c9506431","comparison.en.status":"c68f46325cf1","comparison.en.reference":"4fc9339ca70d","comparison.en.notSpecified":"cc32a72e28a1","comparison.es.title":"588764ef3ade","comparison.es.menuButton":"d95a38213387","comparison.es.intro":"49ec226aaa39","comparison.es.empty":"d6d291da191e","comparison.es.needMore":"959c84be5bbe","comparison.es.cardAdd":"41796a7f7b33","comparison.es.cardSelected":"d96363c65cd7","comparison.es.cardAddShort":"ec0253003f5f","comparison.es.cardSelectedShort":"4a0d408cef5e","comparison.es.added":"849bcec007f1","comparison.es.limit":"05d3ab2d8a20","comparison.es.removed":"b4f51acc67b1","comparison.es.cleared":"19b5b83c1397","comparison.es.open":"04657d3d987f","comparison.es.remove":"6ab350ddb110","comparison.es.clear":"6449981cf9b2","comparison.es.browse":"d914212d1cf9","comparison.es.selectedCount":"7c9e59dff035","comparison.es.price":"d3ead1a8151d","comparison.es.location":"b21c3de4be6e","comparison.es.type":"b51988503977","comparison.es.area":"1a3f8f1b50fa","comparison.es.plotArea":"5a22c27483a2","comparison.es.bedrooms":"7950c0f01102","comparison.es.bathrooms":"36ab582dbaa1","comparison.es.condition":"7a243eb8f6dc","comparison.es.floor":"486e6c0b7a79","comparison.es.distanceSea":"111fa373e5af","comparison.es.status":"1354811cf92a","comparison.es.reference":"073a979fdd56","comparison.es.notSpecified":"cc32a72e28a1","managerContact.ru.intro":"25059e3a0382","managerContact.ru.tapPhone":"d97214faf4c4","managerContact.ru.call":"aa73813afb7d","managerContact.ru.whatsapp":"c3a5781be722","managerContact.ru.telegram":"f87ec213f3fd","managerContact.ru.website":"af54e18fa398","managerContact.ru.map":"08a62dbf28cc","managerContact.ru.request":"ee44633140f6","managerContact.ru.question":"c62601c4aca2","managerContact.ru.askQuestion":"ad2d29df0b48","managerContact.ru.received":"d73a77c5bba9","managerContact.ru.replyHeader":"f7bd8135f25e","managerContact.ru.cancel":"6ea9e96b9009","managerContact.en.intro":"ac03910cdb82","managerContact.en.tapPhone":"6d773d8c7bf9","managerContact.en.call":"d25eef5885ca","managerContact.en.whatsapp":"c3a5781be722","managerContact.en.telegram":"f87ec213f3fd","managerContact.en.website":"3ea7672cfe6f","managerContact.en.map":"c0a45cc7e7c5","managerContact.en.request":"0c7a8599797e","managerContact.en.question":"458b6d7fa7f2","managerContact.en.askQuestion":"0a750ae07326","managerContact.en.received":"69b4ac6e235d","managerContact.en.replyHeader":"2da20016c4dc","managerContact.en.cancel":"ef133eb749a9","managerContact.es.intro":"297ab36608ec","managerContact.es.tapPhone":"871a6e69a15e","managerContact.es.call":"b4a23242a53c","managerContact.es.whatsapp":"c3a5781be722","managerContact.es.telegram":"f87ec213f3fd","managerContact.es.website":"cf0df4c25370","managerContact.es.map":"2003abc6817e","managerContact.es.request":"b2517254b7bb","managerContact.es.question":"234a14870500","managerContact.es.askQuestion":"b7d3b9c73855","managerContact.es.received":"13a37c2ea349","managerContact.es.replyHeader":"0badb4762bec","managerContact.es.cancel":"e91b88e6ae0d","navigation.ru.guide":"d7f7fe7b9cc0","navigation.ru.guideConsult":"5f3d9367ec88","navigation.ru.mainMenu":"ec1349925744","navigation.ru.backToCard":"5f7c03aa178f","navigation.ru.close":"3bd03e2d1208","navigation.ru.browse":"609f36a78d92","navigation.ru.readMore":"f0beeb6e49ce","navigation.en.guide":"3fb0c0aeae87","navigation.en.guideConsult":"bc4447cd230f","navigation.en.mainMenu":"cf362340db13","navigation.en.backToCard":"9f9f17fbdc3d","navigation.en.close":"771bd90492fb","navigation.en.browse":"270e63b052e9","navigation.en.readMore":"c86383a64d93","navigation.es.guide":"d985a78c80dc","navigation.es.guideConsult":"91f32efe923f","navigation.es.mainMenu":"32876f5bcad3","navigation.es.backToCard":"bfc882d7ad9a","navigation.es.close":"4bfd2cbe87db","navigation.es.browse":"580eec92ace9","navigation.es.readMore":"f28d031e98f6","interaction.ru.collapseDetails":"36f703fe9712","interaction.ru.failed":"b2e1064f899a","interaction.ru.duplicate":"92cf746a2b31","interaction.ru.stale":"5b13c4da1de0","interaction.ru.unfinished":"7eef978f25c3","interaction.ru.continueForm":"e40131650593","interaction.ru.discardForm":"b2e67ee913f0","interaction.ru.expired":"ed346385e063","interaction.ru.resume":"b9b45029afe6","interaction.ru.backToMenu":"2a42b9704fa5","interaction.ru.hideGallery":"ff53f7dc5a94","interaction.ru.reminderLead":"bef4f4fc75c1","interaction.ru.reminderViewing":"89ec476ac63a","interaction.ru.reminderSelection":"aa155084c5f6","interaction.en.collapseDetails":"fa611e1bf4cb","interaction.en.failed":"28e0c0c279b1","interaction.en.duplicate":"01d6b3e57cd3","interaction.en.stale":"cc86cc9f2ba3","interaction.en.unfinished":"bd4192775868","interaction.en.continueForm":"2e6ae16d4269","interaction.en.discardForm":"5fe4823b21ef","interaction.en.expired":"c0d58ae0ccb2","interaction.en.resume":"aaa654653a2e","interaction.en.backToMenu":"e4499404ebf3","interaction.en.hideGallery":"b332106e5ed4","interaction.en.reminderLead":"3c0984005efc","interaction.en.reminderViewing":"03b85543e35d","interaction.en.reminderSelection":"d06bb0621f0d","interaction.es.collapseDetails":"282b51568dde","interaction.es.failed":"f8c17e53289b","interaction.es.duplicate":"4b43c040de04","interaction.es.stale":"fb0b5b847672","interaction.es.unfinished":"587bfd83744e","interaction.es.continueForm":"43f0d8a0e7b1","interaction.es.discardForm":"99e83b9889eb","interaction.es.expired":"37a0a92d360a","interaction.es.resume":"b6a6746eb64e","interaction.es.backToMenu":"e3062c143571","interaction.es.hideGallery":"30040b11064c","interaction.es.reminderLead":"4c857bc2bc34","interaction.es.reminderViewing":"9f237e96fa13","interaction.es.reminderSelection":"e1a67d76294f","commands.ru.cancelled":"d6f584249c07","commands.ru.nothingToCancel":"5fcf9fa0224a","commands.ru.unknown":"0accf4d23b7a","commands.ru.myId":"2e05774c1a66","commands.en.cancelled":"e0549237217c","commands.en.nothingToCancel":"be8980494768","commands.en.unknown":"32b9970b3a7d","commands.en.myId":"4b2aef7da0c2","commands.es.cancelled":"1be68ebebd6a","commands.es.nothingToCancel":"41bb02c5277a","commands.es.unknown":"35b25cb4c9e7","commands.es.myId":"83ca8a8a4c6d","emptyStates.ru.catalog":"cb18f28fbe4f","emptyStates.ru.favorites":"81f7bc23c611","emptyStates.ru.promotions":"a3e7b393ff9d","emptyStates.en.catalog":"5393ad386376","emptyStates.en.favorites":"f77510ad6d88","emptyStates.en.promotions":"8f032c4119de","emptyStates.es.catalog":"7069de602d51","emptyStates.es.favorites":"0ec49cc6b89b","emptyStates.es.promotions":"25bd1565708c","propertyTypes.ru.apartment":"8b6fa0a72287","propertyTypes.ru.house":"f2b602a13cff","propertyTypes.ru.villa":"fe8e84d23f1f","propertyTypes.ru.townhouse":"590a91dcfa8a","propertyTypes.ru.land":"ab1c4336d368","propertyTypes.ru.commercial":"30b567847bbc","propertyTypes.ru.newbuild":"6771b405f2a3","propertyTypes.ru.other":"10303ec81555","propertyTypes.en.apartment":"a0f3264af46a","propertyTypes.en.house":"065aafde6c44","propertyTypes.en.villa":"829e0653c051","propertyTypes.en.townhouse":"8ee79a657726","propertyTypes.en.land":"0da47e32f9fb","propertyTypes.en.commercial":"ee80b5ca8fe4","propertyTypes.en.newbuild":"0687afea3bd7","propertyTypes.en.other":"a56932cc73ac","propertyTypes.es.apartment":"afb6221afbcc","propertyTypes.es.house":"99242fa8123c","propertyTypes.es.villa":"829e0653c051","propertyTypes.es.townhouse":"61b3f320f6e0","propertyTypes.es.land":"966876712bbd","propertyTypes.es.commercial":"6fab3e0f7df3","propertyTypes.es.newbuild":"fb4c46dd97b2","propertyTypes.es.other":"f0cc2e81e9ce","propertyBadges.ru.new":"c7cf105387c4","propertyBadges.ru.recommended":"f5db2911f450","propertyBadges.ru.exclusive":"df1f02f10a42","propertyBadges.ru.price_reduced":"0ff726b5e2a1","propertyBadges.en.new":"744f394805fd","propertyBadges.en.recommended":"54d48c51a351","propertyBadges.en.exclusive":"3366f1bafeec","propertyBadges.en.price_reduced":"04bfd20b68e2","propertyBadges.es.new":"eb6b861a4813","propertyBadges.es.recommended":"4fbdb55d5913","propertyBadges.es.exclusive":"d0a62f6d301d","propertyBadges.es.price_reduced":"917bc297a5aa","propertyConditions.ru.new":"b3ce662c3ed8","propertyConditions.ru.renovated":"373150e1c427","propertyConditions.ru.needs_renovation":"51331a7a08df","propertyConditions.ru.under_construction":"a1c8f10d3e14","propertyConditions.en.new":"744f394805fd","propertyConditions.en.renovated":"525d8ee3322a","propertyConditions.en.needs_renovation":"49edaf8a89e4","propertyConditions.en.under_construction":"4241cbe86ba8","propertyConditions.es.new":"eb6b861a4813","propertyConditions.es.renovated":"c98de7f50043","propertyConditions.es.needs_renovation":"826408e0ceea","propertyConditions.es.under_construction":"ddd02afa7505","propertyActions.ru.details":"71cc0d04e03c","propertyActions.ru.contact":"5f10a5be40d8","propertyActions.ru.photos":"6f03e38e0643","propertyActions.ru.contactManager":"eaa9cafff324","propertyActions.ru.share":"14e58a4bb961","propertyActions.ru.sharePrefix":"b7615ee67a06","propertyActions.ru.viewWebsite":"478dde97da4a","propertyActions.ru.videoTour":"0c0bdf03a33f","propertyActions.ru.openMap":"5a4c9395141d","propertyActions.ru.interest":"3e97b6bb1d11","propertyActions.ru.viewing":"b96666350f03","propertyActions.ru.availability":"1606adb5fe1d","propertyActions.ru.similar":"04917aa823cc","propertyActions.ru.question":"acfc05724212","propertyActions.ru.gallery":"1d86df1892b5","propertyActions.ru.favoriteButton":"f7134b7d70d2","propertyActions.ru.favoriteRemoveButton":"93b235d763c2","propertyActions.ru.cardFavorite":"ba0fa8d7ecd6","propertyActions.ru.cardFavoriteRemove":"cb5ba34e1d58","propertyActions.ru.favoriteAdd":"246b7102742f","propertyActions.ru.favoriteRemove":"0485f3ae2dc1","propertyActions.ru.askQuestion":"ecddf352d9cd","propertyActions.ru.cancel":"33f931eea6b5","propertyActions.ru.cancelled":"4363295243ac","propertyActions.ru.received":"9c537ad7efdb","propertyActions.ru.emptyFavorites":"439488ec455f","propertyActions.ru.forRent":"b18adba659d0","propertyActions.ru.forSale":"658202b4bf51","propertyActions.ru.reserved":"55cab25f1469","propertyActions.ru.available":"0eb4d31fa38f","propertyActions.ru.priceMonth":"33163ef9fd0e","propertyActions.ru.priceWeek":"6da8c5878806","propertyActions.ru.priceOnRequest":"c14590ba9c8d","propertyActions.ru.floor":"6ca599400149","propertyActions.ru.bedroomsLabel":"e83e7449c285","propertyActions.ru.bathroomsLabel":"943f8449e901","propertyActions.ru.areaLabel":"c17ce5de23cd","propertyActions.ru.plotAreaLabel":"ab1c4336d368","propertyActions.ru.distanceSeaLabel":"b82230bc8290","propertyActions.ru.conditionLabel":"9dc532132c7d","propertyActions.ru.specificationsTitle":"b325395dc3c5","propertyActions.ru.descriptionTitle":"285f04b00cd8","propertyActions.ru.reference":"052caa0f953d","propertyActions.ru.updated":"4599a5a591a0","propertyActions.ru.propertyUnavailable":"6a449732508a","propertyActions.ru.propertyHeading":"472fb1e9948f","propertyActions.ru.requestViewingPrefix":"d1802b225a93","propertyActions.ru.questionPrefix":"5b990482ec0f","propertyActions.ru.interestPrefix":"6bea74d75995","propertyActions.ru.noSimilar":"9babae414fe3","propertyActions.ru.similarHeading":"04917aa823cc","propertyActions.ru.similarWhy":"63c51a106720","propertyActions.ru.similarNote":"d7dc6ca8c637","propertyActions.ru.similarReasonType":"02ddd6918f40","propertyActions.ru.similarReasonRelatedType":"5177e1c4aa66","propertyActions.ru.similarReasonCity":"6ad788facc48","propertyActions.ru.similarReasonDistrict":"2ff7354f29cb","propertyActions.ru.similarReasonPrice":"0a317a6a792a","propertyActions.ru.similarReasonBedrooms":"5f567881000d","propertyActions.ru.similarReasonArea":"fa60aa5c03c6","propertyActions.ru.similarWarningPriceDifferent":"8e3dedc15a52","propertyActions.ru.similarWarningPriceMissing":"10078cc23a19","propertyActions.ru.similarWarningCurrency":"ee7d793474eb","propertyActions.ru.managerPrompt":"c69f54410c59","propertyActions.ru.photosUnavailable":"387d4ccc669e","propertyActions.ru.nextProperty":"3a51479f28b8","propertyActions.ru.nextPrompt":"ed1e32a5ea9f","propertyActions.ru.askPrice":"010f8e64cd49","propertyActions.ru.promotionAsk":"99c362b7d1d7","propertyActions.en.details":"5e813548816e","propertyActions.en.contact":"223f4cc20070","propertyActions.en.photos":"754d29c847fe","propertyActions.en.contactManager":"dc2dc16102a6","propertyActions.en.share":"9f1a887fa316","propertyActions.en.sharePrefix":"0b30e2bb1fe6","propertyActions.en.viewWebsite":"26dd63db4f98","propertyActions.en.videoTour":"8949790be5b4","propertyActions.en.openMap":"3fd996d88794","propertyActions.en.interest":"1d3fb0245fd1","propertyActions.en.viewing":"da92ff7f0f79","propertyActions.en.availability":"44046da8b063","propertyActions.en.similar":"a34330ed0076","propertyActions.en.question":"a71022987336","propertyActions.en.gallery":"5d60794fa7bc","propertyActions.en.favoriteButton":"275556c36b3a","propertyActions.en.favoriteRemoveButton":"2936ad6cdb1d","propertyActions.en.cardFavorite":"f9ad2294804e","propertyActions.en.cardFavoriteRemove":"a0c9206d6d7c","propertyActions.en.favoriteAdd":"2eff613cbbbe","propertyActions.en.favoriteRemove":"3b0de53f5133","propertyActions.en.askQuestion":"e4a423c37cd2","propertyActions.en.cancel":"6ba07849a723","propertyActions.en.cancelled":"a9b2be902fb7","propertyActions.en.received":"78cc9b26f67a","propertyActions.en.emptyFavorites":"7a1956ac7950","propertyActions.en.forRent":"f646489ddac3","propertyActions.en.forSale":"93bbe418fe32","propertyActions.en.reserved":"e9cbabc3b54a","propertyActions.en.available":"da19dea004a2","propertyActions.en.priceMonth":"2cf6a9fdd82f","propertyActions.en.priceWeek":"05905571d8c5","propertyActions.en.priceOnRequest":"add6a6d35685","propertyActions.en.floor":"5b88f48999b7","propertyActions.en.bedroomsLabel":"18c0dde811fb","propertyActions.en.bathroomsLabel":"7168820fba45","propertyActions.en.areaLabel":"8bb8dd447f32","propertyActions.en.plotAreaLabel":"e6d715fdb1a0","propertyActions.en.distanceSeaLabel":"ec1c3eb689ec","propertyActions.en.conditionLabel":"2738c6371b4c","propertyActions.en.specificationsTitle":"b6dd370911d6","propertyActions.en.descriptionTitle":"cdddf3a954ea","propertyActions.en.reference":"81c5c1d7c3bc","propertyActions.en.updated":"8e9303c55dfe","propertyActions.en.propertyUnavailable":"e28e330c3018","propertyActions.en.propertyHeading":"a56932cc73ac","propertyActions.en.requestViewingPrefix":"9acd8d0f9e83","propertyActions.en.questionPrefix":"4f23432cff4a","propertyActions.en.interestPrefix":"cff6079b47bc","propertyActions.en.noSimilar":"db437b31437e","propertyActions.en.similarHeading":"a34330ed0076","propertyActions.en.similarWhy":"54d3c62b8b53","propertyActions.en.similarNote":"81ea918ced90","propertyActions.en.similarReasonType":"f610c08811b9","propertyActions.en.similarReasonRelatedType":"2455062224d2","propertyActions.en.similarReasonCity":"99537bb9c8a5","propertyActions.en.similarReasonDistrict":"cf685dafe3b9","propertyActions.en.similarReasonPrice":"0d817a3654d2","propertyActions.en.similarReasonBedrooms":"056b4180c50b","propertyActions.en.similarReasonArea":"180f2723cb9e","propertyActions.en.similarWarningPriceDifferent":"f0c861e514e1","propertyActions.en.similarWarningPriceMissing":"0e9ae2d1d902","propertyActions.en.similarWarningCurrency":"743671315512","propertyActions.en.managerPrompt":"f2dc47e594d9","propertyActions.en.photosUnavailable":"5787df98cb87","propertyActions.en.nextProperty":"1d93db86d8c9","propertyActions.en.nextPrompt":"8962d6457cd7","propertyActions.en.askPrice":"4d7632bd9ca0","propertyActions.en.promotionAsk":"585c17e9c1e9","propertyActions.es.details":"e09e4fd431d5","propertyActions.es.contact":"f047caa4305d","propertyActions.es.photos":"13b1252455fa","propertyActions.es.contactManager":"28beadc453e5","propertyActions.es.share":"19ec81d10977","propertyActions.es.sharePrefix":"2598b7604dab","propertyActions.es.viewWebsite":"fc6c360ae2d5","propertyActions.es.videoTour":"59b9bea0a65f","propertyActions.es.openMap":"332b30160954","propertyActions.es.interest":"047ad34ab440","propertyActions.es.viewing":"0727d6de5a0c","propertyActions.es.availability":"cc1b3be436f3","propertyActions.es.similar":"de101de54ee9","propertyActions.es.question":"56a2fa2b9b61","propertyActions.es.gallery":"8c0dd2616f90","propertyActions.es.favoriteButton":"659fb823690f","propertyActions.es.favoriteRemoveButton":"20422606c495","propertyActions.es.cardFavorite":"6201a9e10726","propertyActions.es.cardFavoriteRemove":"6ab350ddb110","propertyActions.es.favoriteAdd":"073ffed16a4e","propertyActions.es.favoriteRemove":"b30975fd6f3a","propertyActions.es.askQuestion":"5bf7a59abc1a","propertyActions.es.cancel":"d8065491263b","propertyActions.es.cancelled":"080cc3d56450","propertyActions.es.received":"858c42c62197","propertyActions.es.emptyFavorites":"7a2331d43ee8","propertyActions.es.forRent":"0206482dd5a1","propertyActions.es.forSale":"7bffe5e35c04","propertyActions.es.reserved":"1bc283b8a185","propertyActions.es.available":"308cfd338410","propertyActions.es.priceMonth":"2d36b901f379","propertyActions.es.priceWeek":"9f18034a67a1","propertyActions.es.priceOnRequest":"1158bb3e986a","propertyActions.es.floor":"64c1b29011e9","propertyActions.es.bedroomsLabel":"edd6b398bdfe","propertyActions.es.bathroomsLabel":"cfe451c02dad","propertyActions.es.areaLabel":"5f943ab9989b","propertyActions.es.plotAreaLabel":"f8849a0c2194","propertyActions.es.distanceSeaLabel":"9524168641da","propertyActions.es.conditionLabel":"79567899c4f6","propertyActions.es.specificationsTitle":"f02c6cfe8a9c","propertyActions.es.descriptionTitle":"0602f55984e3","propertyActions.es.reference":"7e72aeddbb75","propertyActions.es.updated":"d3c8b43bd478","propertyActions.es.propertyUnavailable":"fdc918e0b7b0","propertyActions.es.propertyHeading":"f0cc2e81e9ce","propertyActions.es.requestViewingPrefix":"d7b9b3aa9d72","propertyActions.es.questionPrefix":"2b0d589b0a0a","propertyActions.es.interestPrefix":"7c05ddaa92e3","propertyActions.es.noSimilar":"82166d8a3eba","propertyActions.es.similarHeading":"de101de54ee9","propertyActions.es.similarWhy":"cc895afb2755","propertyActions.es.similarNote":"c7f288abf320","propertyActions.es.similarReasonType":"7cb036c84edf","propertyActions.es.similarReasonRelatedType":"b5ac5e43e8d3","propertyActions.es.similarReasonCity":"bc124bd68c89","propertyActions.es.similarReasonDistrict":"ca1731d7e31d","propertyActions.es.similarReasonPrice":"d27c52a6f9a8","propertyActions.es.similarReasonBedrooms":"d1fac891d334","propertyActions.es.similarReasonArea":"720af6136cb3","propertyActions.es.similarWarningPriceDifferent":"80c37904fec3","propertyActions.es.similarWarningPriceMissing":"1bcdd643450d","propertyActions.es.similarWarningCurrency":"b343f21ea477","propertyActions.es.managerPrompt":"97fc6b00aea3","propertyActions.es.photosUnavailable":"16bf449b6379","propertyActions.es.nextProperty":"a31334fb473b","propertyActions.es.nextPrompt":"1e218d34e0a3","propertyActions.es.askPrice":"35b9dff450dd","propertyActions.es.promotionAsk":"29f3d0bfeb58","callbackForm.ru.askName":"ab434812a656","callbackForm.ru.askPhone":"7cc0f93ab217","callbackForm.ru.askTime":"4f3bc283f13c","callbackForm.ru.callbackToast":"62e5bbcdf9d7","callbackForm.ru.instantSuccess":"e2fbcd2bc652","callbackForm.ru.changeDetails":"50dde9468628","callbackForm.ru.chooseMethod":"7cfa62455303","callbackForm.ru.methodCall":"8df04b1bd161","callbackForm.ru.methodWhatsapp":"b742ddb04f33","callbackForm.ru.methodTelegram":"589bb9979849","callbackForm.ru.askWhatsapp":"1249ef4217c7","callbackForm.ru.whatsappSuccess":"063801e1c667","callbackForm.ru.telegramSuccess":"d1528ae4a4a9","callbackForm.ru.phoneButton":"8a38d33e62aa","callbackForm.ru.cancel":"24d8167e4a6b","callbackForm.ru.cancelled":"6ea7dc6a7f53","callbackForm.ru.invalidName":"b46142ea2d4c","callbackForm.ru.invalidPhone":"e984614153ef","callbackForm.ru.invalidTime":"0b001ba979c1","callbackForm.ru.timeOptions":"ced6d9d5f3d6","callbackForm.ru.review":"14b66079b9dd","callbackForm.ru.reviewLabels":"02b306a862ce","callbackForm.ru.confirm":"d1d8d559e012","callbackForm.ru.edit":"67d11ec3467e","callbackForm.ru.editName":"8e7515df8692","callbackForm.ru.editPhone":"4f60ffddbc16","callbackForm.ru.editTime":"36d48ae090f8","callbackForm.ru.savedName":"7ca3c9c48185","callbackForm.ru.savedPhone":"fe35beb8524b","callbackForm.ru.success":"6894fe73d32d","callbackForm.en.askName":"26abe3b1f4dc","callbackForm.en.askPhone":"b6a5c3ad834e","callbackForm.en.askTime":"825cf9897df3","callbackForm.en.callbackToast":"4d3f5ef41541","callbackForm.en.instantSuccess":"83f4dea1da02","callbackForm.en.changeDetails":"927ab02556b1","callbackForm.en.chooseMethod":"705a00e68eb3","callbackForm.en.methodCall":"ab7ae2eef010","callbackForm.en.methodWhatsapp":"4ad23e33515e","callbackForm.en.methodTelegram":"da8754ade28b","callbackForm.en.askWhatsapp":"115daf6023c1","callbackForm.en.whatsappSuccess":"5bea5a535144","callbackForm.en.telegramSuccess":"5e74655520ad","callbackForm.en.phoneButton":"71a2b429c8f9","callbackForm.en.cancel":"bc5c7e7462ef","callbackForm.en.cancelled":"99476fa37c96","callbackForm.en.invalidName":"3c2a2f2a62d0","callbackForm.en.invalidPhone":"83562f7dcdf4","callbackForm.en.invalidTime":"3ec83f12717f","callbackForm.en.timeOptions":"f3566d6d7a8d","callbackForm.en.review":"299eb79f9da4","callbackForm.en.reviewLabels":"a4d6f0b08daf","callbackForm.en.confirm":"a79ca5357fdf","callbackForm.en.edit":"5eb22316059d","callbackForm.en.editName":"69a9807382da","callbackForm.en.editPhone":"da2ef7d3b196","callbackForm.en.editTime":"8e599d94083b","callbackForm.en.savedName":"6faba4521a6d","callbackForm.en.savedPhone":"0b479c079745","callbackForm.en.success":"d17ea9751f74","callbackForm.es.askName":"f12a7f4e382d","callbackForm.es.askPhone":"efa126086315","callbackForm.es.askTime":"429dc8de8565","callbackForm.es.callbackToast":"61b3f7bcead5","callbackForm.es.instantSuccess":"8c3983fef048","callbackForm.es.changeDetails":"0acab6e9b3a3","callbackForm.es.chooseMethod":"97c6766736dc","callbackForm.es.methodCall":"a05338038847","callbackForm.es.methodWhatsapp":"a40745219ab4","callbackForm.es.methodTelegram":"b3edb5d88192","callbackForm.es.askWhatsapp":"2e836a38657f","callbackForm.es.whatsappSuccess":"428fd1ce47bd","callbackForm.es.telegramSuccess":"5c951e2e8432","callbackForm.es.phoneButton":"55e075933c88","callbackForm.es.cancel":"2cd714c6dd9c","callbackForm.es.cancelled":"0ef0feb20f45","callbackForm.es.invalidName":"8a0e88681fbb","callbackForm.es.invalidPhone":"0a8e2ff96a78","callbackForm.es.invalidTime":"6877a949efe7","callbackForm.es.timeOptions":"7ea92d79ea5d","callbackForm.es.review":"f1cac69c63cc","callbackForm.es.reviewLabels":"a45779c8cd53","callbackForm.es.confirm":"7f650a19be95","callbackForm.es.edit":"5a19bad0d040","callbackForm.es.editName":"76051aa04717","callbackForm.es.editPhone":"3bf2e32c5845","callbackForm.es.editTime":"ffbd4e512970","callbackForm.es.savedName":"65d4941e8312","callbackForm.es.savedPhone":"58c8e90c9cc0","callbackForm.es.success":"cc9a4733c692","viewingForm.ru.askDate":"672dd553a4c1","viewingForm.ru.online":"fea0a253b461","viewingForm.ru.onlineChosen":"f8f21949a2d1","viewingForm.ru.onlineLabel":"e5590c321dac","viewingForm.ru.dateOptions":"96909f69cbdd","viewingForm.ru.askTime":"37226f6ed721","viewingForm.ru.timeOptions":"238e9fe9dbeb","viewingForm.ru.askCustom":"a178bb5e5f15","viewingForm.ru.askCustomTime":"6a89f2f5e0a7","viewingForm.ru.review":"215932da372b","viewingForm.ru.reviewLabels":"8b59e8643c11","viewingForm.ru.unavailable":"b6a68bb302d4","viewingForm.ru.asSpecified":"9347b1603023","viewingForm.ru.confirm":"915ca7d0bd26","viewingForm.ru.restart":"85c21673ce46","viewingForm.ru.editDate":"679f0a272296","viewingForm.ru.editTime":"36d48ae090f8","viewingForm.ru.cancel":"b7332c499981","viewingForm.ru.cancelled":"366578659b8c","viewingForm.ru.invalid":"b8965968584a","viewingForm.ru.success":"32a500ffe266","viewingForm.ru.slotTaken":"1057e17084c6","viewingForm.ru.slotGone":"5bde766a463a","viewingForm.ru.slotBooked":"1f374e1a51d5","viewingForm.ru.sharePhoneForViewing":"a79d46eb70ae","viewingForm.ru.phoneForViewingSaved":"ae85e58e6664","viewingForm.en.askDate":"600b192cdece","viewingForm.en.online":"d28c74c5985b","viewingForm.en.onlineChosen":"5188d5b7db8e","viewingForm.en.onlineLabel":"6e68076c2c9b","viewingForm.en.dateOptions":"d4c5dba3f9bf","viewingForm.en.askTime":"670a29fd3723","viewingForm.en.timeOptions":"0de7c1d7579a","viewingForm.en.askCustom":"f1864ced92c5","viewingForm.en.askCustomTime":"58ef94e4ba67","viewingForm.en.review":"1702b442bbf5","viewingForm.en.reviewLabels":"ba07d919c128","viewingForm.en.unavailable":"9bc72659d81a","viewingForm.en.asSpecified":"359c0b1a695b","viewingForm.en.confirm":"2e5e15c31e1f","viewingForm.en.restart":"cccc727194d2","viewingForm.en.editDate":"d0a2b0fae9bf","viewingForm.en.editTime":"2e3945a4de1f","viewingForm.en.cancel":"6137c3d648d0","viewingForm.en.cancelled":"66414a28969c","viewingForm.en.invalid":"63b9d8ab5411","viewingForm.en.success":"67af9d537329","viewingForm.en.slotTaken":"6a57cc058bcd","viewingForm.en.slotGone":"739ee226fc94","viewingForm.en.slotBooked":"60167ef8f17d","viewingForm.en.sharePhoneForViewing":"79f434ee3165","viewingForm.en.phoneForViewingSaved":"45502bea2512","viewingForm.es.askDate":"638d4f9bdfab","viewingForm.es.online":"3973860772c0","viewingForm.es.onlineChosen":"8657cc2b4b50","viewingForm.es.onlineLabel":"5509f0e80e37","viewingForm.es.dateOptions":"b4a85c73e797","viewingForm.es.askTime":"bad1ba90218c","viewingForm.es.timeOptions":"27e694afbcb5","viewingForm.es.askCustom":"d23f9a676e53","viewingForm.es.askCustomTime":"bec7a09cc61b","viewingForm.es.review":"836fe972047b","viewingForm.es.reviewLabels":"08609af28b51","viewingForm.es.unavailable":"b81e2ed6a6e3","viewingForm.es.asSpecified":"b45a4afb3516","viewingForm.es.confirm":"8cc89155dce8","viewingForm.es.restart":"a01a519f06bc","viewingForm.es.editDate":"8e029fa48dbb","viewingForm.es.editTime":"ffbd4e512970","viewingForm.es.cancel":"12d8d611fc33","viewingForm.es.cancelled":"fb3aa1f93eba","viewingForm.es.invalid":"077177096496","viewingForm.es.success":"fd17d2a7c278","viewingForm.es.slotTaken":"c11563069d5d","viewingForm.es.slotGone":"b1664c7118bf","viewingForm.es.slotBooked":"005a041fc09b","viewingForm.es.sharePhoneForViewing":"d143e434f352","viewingForm.es.phoneForViewingSaved":"6459abe6b977","selectionForm.ru.intro":"ba252b33b315","selectionForm.ru.wizardTitle":"7511c8e8ed34","selectionForm.ru.wizardDeal":"f4567849c42c","selectionForm.ru.wizardType":"979a5f5661db","selectionForm.ru.wizardCity":"be386ede9141","selectionForm.ru.wizardBudget":"7985c6252a3f","selectionForm.ru.wizardBedrooms":"27c935abe96e","selectionForm.ru.wizardFound":"d847a0707c63","selectionForm.ru.wizardNothing":"ebd4bacf9256","selectionForm.ru.wizardBack":"654743f4ab1d","selectionForm.ru.wizardSkip":"6a826c44d849","selectionForm.ru.wizardShow":"14b2fc14039c","selectionForm.ru.wizardNotify":"4fbcb3bec47f","selectionForm.ru.wizardManager":"8aff8e9711f4","selectionForm.ru.wizardRestart":"8598e88e9a1e","selectionForm.ru.askDeal":"42af62f0519a","selectionForm.ru.dealOptions":"eb906c4e7290","selectionForm.ru.askType":"26e8e13cddee","selectionForm.ru.typeOptions":"15537d6d6e12","selectionForm.ru.askLocation":"ee0140b156f3","selectionForm.ru.anyLocation":"ecbd9700f9ec","selectionForm.ru.askBudget":"387db3820bcb","selectionForm.ru.noBudget":"cfbb9ff75aec","selectionForm.ru.askBedrooms":"6b2737859d42","selectionForm.ru.bedroomOptions":"40be050d6893","selectionForm.ru.review":"f937f186b946","selectionForm.ru.summaryTitle":"f7ef77b0f64c","selectionForm.ru.labels":"9a6ee8325193","selectionForm.ru.confirm":"915ca7d0bd26","selectionForm.ru.restart":"a369b506097b","selectionForm.ru.editDeal":"0937d09cc118","selectionForm.ru.editType":"562af97da7c5","selectionForm.ru.editLocation":"0e6c85472fdc","selectionForm.ru.editBudget":"8bc07c9b15c9","selectionForm.ru.editBedrooms":"411fbd9f30e4","selectionForm.ru.cancel":"1e4b88d487b8","selectionForm.ru.cancelled":"5b601f718cbd","selectionForm.ru.invalid":"b68d1767120b","selectionForm.ru.success":"5321d66f3c41","selectionForm.ru.successMatches":"ebfa7727d83c","selectionForm.ru.noMatchesYet":"2fe147794cb7","selectionForm.ru.matchesHeading":"166f1b64d38f","selectionForm.ru.matchSummary":"a13ac1c820bb","selectionForm.ru.tierExact":"82f14563af71","selectionForm.ru.tierClose":"bfa3b55d9ae2","selectionForm.ru.tierConsider":"55ac2ba112e9","selectionForm.ru.whyMatch":"e2f3f07ce8ae","selectionForm.ru.noteMatch":"8a796866ba83","selectionForm.ru.reasonDeal":"109cb3d67f3e","selectionForm.ru.reasonType":"bc91b772e688","selectionForm.ru.reasonLocation":"cdcfab5665d2","selectionForm.ru.reasonBudget":"fad6e77bd715","selectionForm.ru.reasonBedrooms":"ded96d559a5e","selectionForm.ru.reasonGeneral":"261b5691c045","selectionForm.ru.warningLocation":"1adfc8011ea5","selectionForm.ru.warningBudgetClose":"711c7a42a551","selectionForm.ru.warningBudgetHigh":"d025dbe5b9a9","selectionForm.ru.warningPriceMissing":"4bf153e9d0dc","selectionForm.ru.warningCurrency":"972957bc321e","selectionForm.ru.warningPeriodConverted":"f1f1b9bacb64","selectionForm.ru.warningBedroomsClose":"d089f1c3227b","selectionForm.ru.warningBedroomsMissing":"633fb1a116a0","selectionForm.en.intro":"de7fc2e7f539","selectionForm.en.wizardTitle":"68440bf130ba","selectionForm.en.wizardDeal":"c09dd47f0f4a","selectionForm.en.wizardType":"9bddd95b9022","selectionForm.en.wizardCity":"7a6edc7038e3","selectionForm.en.wizardBudget":"dbf85a66dad7","selectionForm.en.wizardBedrooms":"f3331367a338","selectionForm.en.wizardFound":"b25966ec147b","selectionForm.en.wizardNothing":"bc76bd31068f","selectionForm.en.wizardBack":"621fd0961887","selectionForm.en.wizardSkip":"207dec2b930e","selectionForm.en.wizardShow":"3750b6d3ca4d","selectionForm.en.wizardNotify":"4240b096d6d1","selectionForm.en.wizardManager":"8e0e49d9a240","selectionForm.en.wizardRestart":"536c73f9acee","selectionForm.en.askDeal":"4341ee602f11","selectionForm.en.dealOptions":"dfeb13b31993","selectionForm.en.askType":"64f24f0ecd19","selectionForm.en.typeOptions":"f677e4fc7c7e","selectionForm.en.askLocation":"f4ffc306e3c2","selectionForm.en.anyLocation":"f77a270fc828","selectionForm.en.askBudget":"30340c9e336c","selectionForm.en.noBudget":"0a07de5cae63","selectionForm.en.askBedrooms":"2b880c21e49c","selectionForm.en.bedroomOptions":"5b7f21e5a6a9","selectionForm.en.review":"11f8e3be6d8e","selectionForm.en.summaryTitle":"92b8729b0051","selectionForm.en.labels":"045b4ee2e3fa","selectionForm.en.confirm":"2e5e15c31e1f","selectionForm.en.restart":"bff4276c3f65","selectionForm.en.editDeal":"b0a788fedcf6","selectionForm.en.editType":"9855758b27e8","selectionForm.en.editLocation":"e522971cbc59","selectionForm.en.editBudget":"84e75e5aaf24","selectionForm.en.editBedrooms":"6c941b1b4bde","selectionForm.en.cancel":"98bce68a2157","selectionForm.en.cancelled":"1474629d78af","selectionForm.en.invalid":"e77f5021b2e9","selectionForm.en.success":"6fd89fd665a4","selectionForm.en.successMatches":"f5ce2eed3495","selectionForm.en.noMatchesYet":"a94bcfa6c667","selectionForm.en.matchesHeading":"855f5bb5d3d1","selectionForm.en.matchSummary":"c671da65fbcd","selectionForm.en.tierExact":"3a1db797f9bf","selectionForm.en.tierClose":"5881df5ced70","selectionForm.en.tierConsider":"3a2122f75efc","selectionForm.en.whyMatch":"96fda693ce06","selectionForm.en.noteMatch":"81ea918ced90","selectionForm.en.reasonDeal":"179e89a3cb60","selectionForm.en.reasonType":"c0edb6a0a8d9","selectionForm.en.reasonLocation":"2b2f20b0d187","selectionForm.en.reasonBudget":"8aa58ec0a34f","selectionForm.en.reasonBedrooms":"d7f8f5934065","selectionForm.en.reasonGeneral":"a13567f30766","selectionForm.en.warningLocation":"3187b0025448","selectionForm.en.warningBudgetClose":"c4ce5934edec","selectionForm.en.warningBudgetHigh":"41d63fbabd73","selectionForm.en.warningPriceMissing":"a4bf119471da","selectionForm.en.warningCurrency":"043c5f835e2e","selectionForm.en.warningPeriodConverted":"b8a8656f8fc8","selectionForm.en.warningBedroomsClose":"eea3fe04266b","selectionForm.en.warningBedroomsMissing":"a2eeaf474a44","selectionForm.es.intro":"7caa047feffa","selectionForm.es.wizardTitle":"8552a3e8e7bf","selectionForm.es.wizardDeal":"3aba1f488c29","selectionForm.es.wizardType":"33d480806e13","selectionForm.es.wizardCity":"bfb7cac8a87a","selectionForm.es.wizardBudget":"fd2fec0e709b","selectionForm.es.wizardBedrooms":"3974c90a57eb","selectionForm.es.wizardFound":"046c661d88cf","selectionForm.es.wizardNothing":"51edb9523776","selectionForm.es.wizardBack":"ba1d8465725f","selectionForm.es.wizardSkip":"362c29bda5af","selectionForm.es.wizardShow":"57566b9add16","selectionForm.es.wizardNotify":"b5ce36a89c1f","selectionForm.es.wizardManager":"b613f5e22ef8","selectionForm.es.wizardRestart":"7b5771a98079","selectionForm.es.askDeal":"7a99631eb326","selectionForm.es.dealOptions":"8c1372f4061e","selectionForm.es.askType":"758acdafb0fe","selectionForm.es.typeOptions":"3b945146f991","selectionForm.es.askLocation":"06d40c46c526","selectionForm.es.anyLocation":"e345b7a4988c","selectionForm.es.askBudget":"e885569653a9","selectionForm.es.noBudget":"3159526c747c","selectionForm.es.askBedrooms":"c80e3dae1d40","selectionForm.es.bedroomOptions":"abe71d91470b","selectionForm.es.review":"c6581bd93589","selectionForm.es.summaryTitle":"26bef9af1f97","selectionForm.es.labels":"ad829662709f","selectionForm.es.confirm":"8cc89155dce8","selectionForm.es.restart":"cc2b33e7bae6","selectionForm.es.editDeal":"3a24a46e0d42","selectionForm.es.editType":"e36ee6d9a1da","selectionForm.es.editLocation":"6dfe82880f61","selectionForm.es.editBudget":"d66e8a9fa87c","selectionForm.es.editBedrooms":"acaded2d187f","selectionForm.es.cancel":"29664f217a69","selectionForm.es.cancelled":"ac40221c21ed","selectionForm.es.invalid":"5f79ac82216c","selectionForm.es.success":"f4a4984026b1","selectionForm.es.successMatches":"42fb4b7af23d","selectionForm.es.noMatchesYet":"fa7fb19a61a6","selectionForm.es.matchesHeading":"a83857cfa79f","selectionForm.es.matchSummary":"7e3e2cbb0ef5","selectionForm.es.tierExact":"79dbdee9bbac","selectionForm.es.tierClose":"fb29190c4aff","selectionForm.es.tierConsider":"48ddb6de3782","selectionForm.es.whyMatch":"74a330ca65ec","selectionForm.es.noteMatch":"c7f288abf320","selectionForm.es.reasonDeal":"85f56a4d69d7","selectionForm.es.reasonType":"23baf9efee07","selectionForm.es.reasonLocation":"6f45904570fc","selectionForm.es.reasonBudget":"6bdf6acb616c","selectionForm.es.reasonBedrooms":"5ec01d6b9f5b","selectionForm.es.reasonGeneral":"a876778096b7","selectionForm.es.warningLocation":"010b324608db","selectionForm.es.warningBudgetClose":"58e007b95d50","selectionForm.es.warningBudgetHigh":"d51247c40594","selectionForm.es.warningPriceMissing":"3202a280e1ef","selectionForm.es.warningCurrency":"9a2325317795","selectionForm.es.warningPeriodConverted":"bda2b2bf2b4c","selectionForm.es.warningBedroomsClose":"14b03a3c0b08","selectionForm.es.warningBedroomsMissing":"92efa9c6d24e","propertyAlerts.ru.priceDrop":"4ec2cb733575","propertyAlerts.ru.backAvailable":"1a88eb35bd71","propertyAlerts.ru.newMatch":"3c6bb2716874","propertyAlerts.ru.turnOff":"5d95871074cd","propertyAlerts.ru.turnedOff":"63b21187f3ab","propertyAlerts.ru.turnOn":"7c06696fac56","propertyAlerts.ru.turnedOn":"9d7cac1cc772","propertyAlerts.en.priceDrop":"7e2779a040aa","propertyAlerts.en.backAvailable":"c03a03d291a8","propertyAlerts.en.newMatch":"c1bf3f983788","propertyAlerts.en.turnOff":"3e4291c68c23","propertyAlerts.en.turnedOff":"7aec2ef259e3","propertyAlerts.en.turnOn":"6260427b80e1","propertyAlerts.en.turnedOn":"127188653021","propertyAlerts.es.priceDrop":"d6cdda0b4ef3","propertyAlerts.es.backAvailable":"c473c070ce59","propertyAlerts.es.newMatch":"73d1ae1956ef","propertyAlerts.es.turnOff":"9e5bd5126f91","propertyAlerts.es.turnedOff":"fa1ad0dde490","propertyAlerts.es.turnOn":"a0c43f862830","propertyAlerts.es.turnedOn":"e78fb035c501","catalogFilter.ru.button":"e469a608090e","catalogFilter.ru.listMode":"3e436089e91d","catalogFilter.ru.cardMode":"84c174982b03","catalogFilter.ru.listTitle":"b098f1dd481d","catalogFilter.ru.listHint":"fd490d684478","catalogFilter.ru.title":"1d4380ef8987","catalogFilter.ru.anyDeal":"ba11e65a32b9","catalogFilter.ru.anyType":"3836fc857e9d","catalogFilter.ru.anyBedrooms":"4a7b73001b60","catalogFilter.ru.bedrooms":"312250af9fec","catalogFilter.ru.show":"e08da0381570","catalogFilter.ru.reset":"ee4f9f3bed43","catalogFilter.ru.empty":"b10cdba0e555","catalogFilter.ru.anyCity":"b713a77f36cb","catalogFilter.ru.chooseCity":"21bc58ba8fa0","catalogFilter.ru.chooseDistrict":"d65e181cd04a","catalogFilter.ru.cityPickerTitle":"fd2579e9e3de","catalogFilter.ru.districtPickerTitle":"1ac586a9a7e2","catalogFilter.ru.changeCity":"8802d9b91989","catalogFilter.ru.backToFilter":"1358d8bd117e","catalogFilter.ru.moreOptions":"c75c3cdc5e66","catalogFilter.ru.anyPrice":"d30cb0d641c2","catalogFilter.ru.from":"dcabeb2a54e9","catalogFilter.ru.upTo":"c077980840ad","catalogFilter.ru.sortAsc":"d3cb8c34630f","catalogFilter.ru.sortDesc":"19a80fe7e1e1","catalogFilter.ru.sendToManager":"926b53406e2a","catalogFilter.ru.sentToManager":"f38909527c95","catalogFilter.ru.handedOver":"65d41a3250b2","catalogFilter.ru.requestHeading":"d439420df96b","catalogFilter.ru.anyDistrict":"dfa5feca422c","catalogFilter.ru.minimumPrice":"769f9fdb27b0","catalogFilter.ru.askMinimumPrice":"17f7d38f6230","catalogFilter.ru.minimumPricePlaceholder":"d821dad0989b","catalogFilter.ru.minimumPriceApplied":"ae1d77ba7542","catalogFilter.ru.customPrice":"fda803f4892a","catalogFilter.ru.askCustomPrice":"7708698372bc","catalogFilter.ru.customPricePlaceholder":"26957f6a17c6","catalogFilter.ru.invalidCustomPrice":"25ea5ada439d","catalogFilter.ru.invalidPriceRange":"218fb77eb39a","catalogFilter.ru.customPriceApplied":"16690427d073","catalogFilter.ru.cancelCustomPrice":"3fa4d3ee0b1e","catalogFilter.ru.customPriceCancelled":"1fd33f6a388c","catalogFilter.en.button":"b6502c5b5d47","catalogFilter.en.listMode":"1768846950c9","catalogFilter.en.cardMode":"07ac7ce6d68e","catalogFilter.en.listTitle":"48817c8ed092","catalogFilter.en.listHint":"cff744841de9","catalogFilter.en.title":"730287e5ce29","catalogFilter.en.anyDeal":"2517e6709d97","catalogFilter.en.anyType":"6f703f365aab","catalogFilter.en.anyBedrooms":"6026c0e839d4","catalogFilter.en.bedrooms":"8ff0b1ab6741","catalogFilter.en.show":"f492ba9c8880","catalogFilter.en.reset":"d6892dbae171","catalogFilter.en.empty":"92003745c90d","catalogFilter.en.anyCity":"5ae35b6b7694","catalogFilter.en.chooseCity":"3ec631862573","catalogFilter.en.chooseDistrict":"e1bb2d86bfe8","catalogFilter.en.cityPickerTitle":"1b4cdb1e331d","catalogFilter.en.districtPickerTitle":"8b3d8016351b","catalogFilter.en.changeCity":"02f2ce6e7371","catalogFilter.en.backToFilter":"587d60822511","catalogFilter.en.moreOptions":"0a9a71ec7261","catalogFilter.en.anyPrice":"5ccd7170d10c","catalogFilter.en.from":"8a82db63b1c9","catalogFilter.en.upTo":"0f0e620066cc","catalogFilter.en.sortAsc":"6a6b0c35606c","catalogFilter.en.sortDesc":"bbf1b0b160bb","catalogFilter.en.sendToManager":"dc1077c68976","catalogFilter.en.sentToManager":"045754ea49ad","catalogFilter.en.handedOver":"62fdac0d0466","catalogFilter.en.requestHeading":"8ae31d306fbb","catalogFilter.en.anyDistrict":"d6bb75bdf6a7","catalogFilter.en.minimumPrice":"c36f4c6cfc37","catalogFilter.en.askMinimumPrice":"a49e221b87a8","catalogFilter.en.minimumPricePlaceholder":"f4d26f120981","catalogFilter.en.minimumPriceApplied":"41c208969396","catalogFilter.en.customPrice":"f5cbeccec2b2","catalogFilter.en.askCustomPrice":"725c12db335e","catalogFilter.en.customPricePlaceholder":"124dabf9c9fc","catalogFilter.en.invalidCustomPrice":"a6cd5c1ed137","catalogFilter.en.invalidPriceRange":"90fbf206d99a","catalogFilter.en.customPriceApplied":"4c18501d5bf2","catalogFilter.en.cancelCustomPrice":"17d4b1e7ab0d","catalogFilter.en.customPriceCancelled":"c27b47f62c8c","catalogFilter.es.button":"50e6d9383bd3","catalogFilter.es.listMode":"eee7eb966241","catalogFilter.es.cardMode":"a6a20c84ea60","catalogFilter.es.listTitle":"d73bbc12aca7","catalogFilter.es.listHint":"4d289b93190f","catalogFilter.es.title":"b23d184f4624","catalogFilter.es.anyDeal":"ed4ef7fd062e","catalogFilter.es.anyType":"6237c73b0899","catalogFilter.es.anyBedrooms":"6f4f1e0ad62a","catalogFilter.es.bedrooms":"c78ec88a1d46","catalogFilter.es.show":"b82775c65582","catalogFilter.es.reset":"2aad8d90de0e","catalogFilter.es.empty":"63c60950ab8a","catalogFilter.es.anyCity":"ead26f9a0cd2","catalogFilter.es.chooseCity":"a76435491086","catalogFilter.es.chooseDistrict":"fe3fd0aaae95","catalogFilter.es.cityPickerTitle":"acab1a602958","catalogFilter.es.districtPickerTitle":"f8c39650ad7c","catalogFilter.es.changeCity":"9fca192527e6","catalogFilter.es.backToFilter":"fa2d7f9d7018","catalogFilter.es.moreOptions":"4c46c663b6e5","catalogFilter.es.anyPrice":"5f560b5c8c5d","catalogFilter.es.from":"afef33fa037c","catalogFilter.es.upTo":"e9a62fc7a2aa","catalogFilter.es.sortAsc":"a8812287d3cd","catalogFilter.es.sortDesc":"bcda8177bd33","catalogFilter.es.sendToManager":"21c48bdb876d","catalogFilter.es.sentToManager":"14c9c7cfeb5b","catalogFilter.es.handedOver":"54ebf5c4fb4b","catalogFilter.es.requestHeading":"390a503c96f7","catalogFilter.es.anyDistrict":"f72ace2919fd","catalogFilter.es.minimumPrice":"a2288056f592","catalogFilter.es.askMinimumPrice":"dd2e7848282d","catalogFilter.es.minimumPricePlaceholder":"10aab953a70a","catalogFilter.es.minimumPriceApplied":"76bbf05ec85b","catalogFilter.es.customPrice":"33e0375229cb","catalogFilter.es.askCustomPrice":"451c6da06b23","catalogFilter.es.customPricePlaceholder":"5d515079a4f3","catalogFilter.es.invalidCustomPrice":"5fa5e8e145bd","catalogFilter.es.invalidPriceRange":"a6510f46366f","catalogFilter.es.customPriceApplied":"cca24435917e","catalogFilter.es.cancelCustomPrice":"067a92a79add","catalogFilter.es.customPriceCancelled":"ae60db5f739d","myRequests.ru.menuButton":"9617d2e46791","myRequests.ru.title":"489523ec8304","myRequests.ru.none":"9c12a6538c31","myRequests.ru.footer":"f2b245a814a9","myRequests.ru.typeViewing":"214fb5df14b2","myRequests.ru.typeLead":"be6d82aad4d2","myRequests.ru.typeSelection":"0fb6ef6834e9","myRequests.ru.typeQuestion":"4194ed1976c7","myRequests.ru.typeInterest":"45e0bd9ad741","myRequests.ru.typeGeneral":"cad24fd03276","myRequests.ru.statusNew":"4fcbb89db3f9","myRequests.ru.statusInProgress":"d418b70f09d8","myRequests.ru.statusClosed":"c02ee60925ea","myRequests.ru.statusConfirmed":"b8ccf9fe8ceb","myRequests.ru.statusCancelled":"2216259df1e4","myRequests.ru.sentOn":"82136d5d40f8","myRequests.ru.cancelViewing":"aa493eba5635","myRequests.ru.cancelAsk":"3b7511c7e293","myRequests.ru.cancelYes":"b176190974db","myRequests.ru.cancelNo":"8cc783d32823","myRequests.ru.cancelDone":"2c78b6b88c34","myRequests.ru.kept":"6eab94025714","myRequests.en.menuButton":"bf51d10a2660","myRequests.en.title":"b79f471ba7cb","myRequests.en.none":"37b19a8149be","myRequests.en.footer":"7702d6e1e48f","myRequests.en.typeViewing":"f397097cc40d","myRequests.en.typeLead":"8ef3f00d154e","myRequests.en.typeSelection":"b0a2c92afa11","myRequests.en.typeQuestion":"ac840e800d02","myRequests.en.typeInterest":"6f7bb1f6b37b","myRequests.en.typeGeneral":"25933787501d","myRequests.en.statusNew":"583d4a18ed94","myRequests.en.statusInProgress":"e8d7a653c357","myRequests.en.statusClosed":"64ce352f5a65","myRequests.en.statusConfirmed":"0f6b588141c5","myRequests.en.statusCancelled":"af2cd6f1090f","myRequests.en.sentOn":"3a09cfde5453","myRequests.en.cancelViewing":"6137c3d648d0","myRequests.en.cancelAsk":"dba977d4bb4d","myRequests.en.cancelYes":"3ff05119c39c","myRequests.en.cancelNo":"6c944dfdb303","myRequests.en.cancelDone":"8f34e20930b2","myRequests.en.kept":"f5be53e26bb2","myRequests.es.menuButton":"f0b267b48526","myRequests.es.title":"b3207851a713","myRequests.es.none":"7e1ce95a26d0","myRequests.es.footer":"5b714da6fff3","myRequests.es.typeViewing":"629849cc7eef","myRequests.es.typeLead":"d39284f6c0e6","myRequests.es.typeSelection":"8552a3e8e7bf","myRequests.es.typeQuestion":"a507a8253729","myRequests.es.typeInterest":"d79602981293","myRequests.es.typeGeneral":"8b4af5fd15a9","myRequests.es.statusNew":"36b00da93e2d","myRequests.es.statusInProgress":"6f4a93659ec0","myRequests.es.statusClosed":"55ba16e2f1ce","myRequests.es.statusConfirmed":"eb78375e229c","myRequests.es.statusCancelled":"23e928f80093","myRequests.es.sentOn":"13d3f426c456","myRequests.es.cancelViewing":"12d8d611fc33","myRequests.es.cancelAsk":"aa9d60521118","myRequests.es.cancelYes":"8b5a0596d831","myRequests.es.cancelNo":"9ac676c2bbf1","myRequests.es.cancelDone":"bf175146354c","myRequests.es.kept":"c66683e6b9d1","privacy.ru.menuButton":"330130b44bb9","privacy.ru.title":"91dfce21fdf1","privacy.ru.intro":"b14f3ff149c2","privacy.ru.storedTitle":"ed47400be517","privacy.ru.policyButton":"9674ff876fad","privacy.ru.policyTitle":"9674ff876fad","privacy.ru.policy":"a9c32d10b591","privacy.ru.eraseButton":"54f864489a03","privacy.ru.eraseTitle":"b631fe1feb57","privacy.ru.eraseWarning":"b96e871ba0da","privacy.ru.eraseConfirm":"68b9ca7a3150","privacy.ru.eraseCancel":"2cd92a343660","privacy.ru.erased":"ade9490c6b93","privacy.ru.phoneNotice":"c66641cd96c2","privacy.ru.back":"d2ace4486580","privacy.ru.nothing":"c9ead8420368","privacy.en.menuButton":"a462a33ad3a7","privacy.en.title":"abb4614277ba","privacy.en.intro":"2281ca2b56bb","privacy.en.storedTitle":"333197ada299","privacy.en.policyButton":"c4ba61e0c47a","privacy.en.policyTitle":"c4ba61e0c47a","privacy.en.policy":"1b3852371e5c","privacy.en.eraseButton":"c46c3abd5dbd","privacy.en.eraseTitle":"284d5feb798c","privacy.en.eraseWarning":"9f98e448150d","privacy.en.eraseConfirm":"7661053027a4","privacy.en.eraseCancel":"d124de932b8a","privacy.en.erased":"91b6a654ba99","privacy.en.phoneNotice":"252fd81937e0","privacy.en.back":"1f85a27f75e9","privacy.en.nothing":"40e38e09e436","privacy.es.menuButton":"566bca2d8054","privacy.es.title":"111b98027386","privacy.es.intro":"08363c9ebc3c","privacy.es.storedTitle":"ddf795b3293a","privacy.es.policyButton":"3a3de96005ac","privacy.es.policyTitle":"3a3de96005ac","privacy.es.policy":"7e11c0ccf5c3","privacy.es.eraseButton":"3e69bf3c8281","privacy.es.eraseTitle":"2ebeedc2ff67","privacy.es.eraseWarning":"d0e2d6a84b16","privacy.es.eraseConfirm":"982130114108","privacy.es.eraseCancel":"a4e376a77850","privacy.es.erased":"920642dede0e","privacy.es.phoneNotice":"242b3fa9cca0","privacy.es.back":"a6ecd3f85c41","privacy.es.nothing":"30d3bfb40b93","viewingNotices.ru.confirmed":"263695002758","viewingNotices.ru.date":"9bfc067592c5","viewingNotices.ru.time":"02cbd147faf1","viewingNotices.ru.address":"b6c84bb37cae","viewingNotices.ru.online":"eb9576f7537d","viewingNotices.ru.confirmedFooter":"0a785811e780","viewingNotices.ru.reminder":"a285f7ec4d1e","viewingNotices.ru.reminderFooter":"f755e951e1ef","viewingNotices.ru.feedbackQuestion":"b2d6a52a99ee","viewingNotices.ru.liked":"30318daa67e7","viewingNotices.ru.questions":"eb8189a06f94","viewingNotices.ru.disliked":"4ed496268643","viewingNotices.ru.likedReply":"ce69f9b7102b","viewingNotices.ru.questionsReply":"9baf35870705","viewingNotices.ru.dislikedReply":"95f731609f6d","viewingNotices.ru.openMap":"9632c2a21b45","viewingNotices.en.confirmed":"9a479ef2bad1","viewingNotices.en.date":"119403fb2442","viewingNotices.en.time":"803349cb31c3","viewingNotices.en.address":"900ba4c11c64","viewingNotices.en.online":"80fe3db58b70","viewingNotices.en.confirmedFooter":"55176d08c1c4","viewingNotices.en.reminder":"f3ac1e6330d7","viewingNotices.en.reminderFooter":"42efcadb8268","viewingNotices.en.feedbackQuestion":"667940b6094e","viewingNotices.en.liked":"5eee31e7bed8","viewingNotices.en.questions":"9bca9df55544","viewingNotices.en.disliked":"a7542595d5a2","viewingNotices.en.likedReply":"5fdfbe18794c","viewingNotices.en.questionsReply":"db84a1d5a0c9","viewingNotices.en.dislikedReply":"d656a2aa7310","viewingNotices.en.openMap":"3b6badf65b68","viewingNotices.es.confirmed":"c9da54b429a1","viewingNotices.es.date":"c5a2204ede08","viewingNotices.es.time":"f7b4d21dfb97","viewingNotices.es.address":"efa890d1e48a","viewingNotices.es.online":"0c94b9771c96","viewingNotices.es.confirmedFooter":"2905a2d40ef2","viewingNotices.es.reminder":"bac9870aaf63","viewingNotices.es.reminderFooter":"d00fc4da5c3c","viewingNotices.es.feedbackQuestion":"898babbd28a2","viewingNotices.es.liked":"1e3faef1bfa3","viewingNotices.es.questions":"4ba461255e7a","viewingNotices.es.disliked":"42aa5fda6c0f","viewingNotices.es.likedReply":"7b837fd8df48","viewingNotices.es.questionsReply":"de4022c46184","viewingNotices.es.dislikedReply":"785a119916ae","viewingNotices.es.openMap":"4207f452e246","subscriptions.ru.menuButton":"894526f7e1f9","subscriptions.ru.title":"974a0f50882b","subscriptions.ru.news":"f3eb87c040f1","subscriptions.ru.alerts":"3dc346752793","subscriptions.ru.unsubscribe":"592cb725c33c","subscriptions.ru.newsOff":"45d560187997","subscriptions.ru.newsOn":"8f442161519b","subscriptions.ru.undo":"17b716173998","subscriptions.ru.newsConsent":"64226c59a2f4","subscriptions.en.menuButton":"a31e0810a24f","subscriptions.en.title":"d4d786267de1","subscriptions.en.news":"c3124ef85142","subscriptions.en.alerts":"c602660c32bb","subscriptions.en.unsubscribe":"d0bbb215d716","subscriptions.en.newsOff":"a7696a1bd4d9","subscriptions.en.newsOn":"ac28db4d07a0","subscriptions.en.undo":"10e2b8aac512","subscriptions.en.newsConsent":"3f9fa91b82b2","subscriptions.es.menuButton":"b25a1e4dac33","subscriptions.es.title":"ae1284c03294","subscriptions.es.news":"09076beb96ae","subscriptions.es.alerts":"9397a8eb2bc3","subscriptions.es.unsubscribe":"8177b5cf2bbb","subscriptions.es.newsOff":"9f10b2f14bef","subscriptions.es.newsOn":"16f02d0bfd3b","subscriptions.es.undo":"c379e0f26451","subscriptions.es.newsConsent":"a41e62c511b7","calculator.ru.openButton":"dc7f1e5ee2e9","calculator.ru.title":"0ef291685ba2","calculator.ru.price":"c394dd158287","calculator.ru.costs":"d2696d2eec7e","calculator.ru.resaleTax":"4a48bf29900f","calculator.ru.newBuildTax":"beef01dadb8b","calculator.ru.businessTax":"c0ec1aaa87b0","calculator.ru.stampDuty":"97153307093a","calculator.ru.otherCosts":"7f7a47793de6","calculator.ru.total":"c3afa2416e25","calculator.ru.mortgage":"0f75d9156ed5","calculator.ru.downPayment":"0a272e73f8df","calculator.ru.loan":"ebfda7864618","calculator.ru.years":"f0ae8c35c00a","calculator.ru.monthly":"8322083a6969","calculator.ru.upfront":"9bee30159283","calculator.ru.businessNote":"a74088fd561b","calculator.ru.disclaimer":"9fdd2b727f8e","calculator.ru.discuss":"cfceb177bba1","calculator.en.openButton":"462e8f598b54","calculator.en.title":"99fc5bc4e3ea","calculator.en.price":"c63e525ed2be","calculator.en.costs":"576dc0d06ba6","calculator.en.resaleTax":"dae55bdb7206","calculator.en.newBuildTax":"e0974bea7b0f","calculator.en.businessTax":"476731ea7c98","calculator.en.stampDuty":"ad229a00b31d","calculator.en.otherCosts":"7fb8bac19a03","calculator.en.total":"469764b6b661","calculator.en.mortgage":"9b470a4646b7","calculator.en.downPayment":"42adf7237226","calculator.en.loan":"1f01c08b0e4d","calculator.en.years":"215356a656fa","calculator.en.monthly":"ef190e37fdd9","calculator.en.upfront":"761a44b13c7d","calculator.en.businessNote":"394ea1ec19b1","calculator.en.disclaimer":"797d9cee3e2f","calculator.en.discuss":"54226412fa6a","calculator.es.openButton":"78b295ffac4f","calculator.es.title":"cc150b4b1e00","calculator.es.price":"6f93f5b454c5","calculator.es.costs":"92c26cd5143c","calculator.es.resaleTax":"c01b313d7dd8","calculator.es.newBuildTax":"3fa7d5ffb798","calculator.es.businessTax":"486ad663fa31","calculator.es.stampDuty":"067e1fe13f20","calculator.es.otherCosts":"a681fd33d698","calculator.es.total":"9e397f1fc765","calculator.es.mortgage":"9e6f5224ba1d","calculator.es.downPayment":"d06ef8e6e091","calculator.es.loan":"afcf7f7aaf79","calculator.es.years":"4fe1a3010839","calculator.es.monthly":"9477b0931498","calculator.es.upfront":"f6de66d7d601","calculator.es.businessNote":"d8ec5c4db525","calculator.es.disclaimer":"872ff26c014f","calculator.es.discuss":"6f200133a804"};
