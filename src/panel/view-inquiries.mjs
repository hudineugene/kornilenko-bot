// Обращения, просмотры и клиенты: списки слева, карточка справа.

const INQUIRIES_JS = String.raw`
var inquiryFilter = { status: "waiting", type: "", search: "" };
var selectedInquiry = "";
var clientSearch = "";

function userOf(item) {
  return (state.users || []).find(function (entry) { return entry.id === String(item.userId); }) || { firstName: "Клиент", id: item.userId };
}
function userName(user) {
  return [user.firstName, user.lastName].filter(Boolean).join(" ") || "Без имени";
}
function statusChip(item) {
  if (item.status === "closed") return '<span class="chip">закрыто</span>';
  if (awaitsReply(item)) return '<span class="chip bad">ждёт ответа</span>';
  if (item.status === "in_progress") return '<span class="chip warn">в работе</span>';
  return '<span class="chip">новое</span>';
}
function inquiryMatches(item) {
  if (inquiryFilter.status === "waiting" && !awaitsReply(item)) return false;
  if (inquiryFilter.status === "open" && item.status === "closed") return false;
  if (inquiryFilter.status === "closed" && item.status !== "closed") return false;
  if (inquiryFilter.type && item.type !== inquiryFilter.type) return false;
  if (inquiryFilter.search) {
    var haystack = (item.text + " " + userName(userOf(item)) + " " + (userOf(item).phone || "")).toLowerCase();
    if (haystack.indexOf(inquiryFilter.search.toLowerCase()) < 0) return false;
  }
  return true;
}

function openInquiry(id) {
  selectedInquiry = id;
  go("inquiries", "inbox");
}

function inquiryRows() {
  return (state.inquiries || []).filter(inquiryMatches);
}

function openTemplates() {
  var templates = state.replyTemplates || [];
  openDialog({
    title: "Шаблоны ответов",
    body: '<div class="stack" id="templateList">' + (templates.length ? templates.map(function (template) {
      return '<div class="card"><div class="card-body stack" data-template="' + esc(template.id) + '">' +
        '<input data-field="title" value="' + esc(template.title) + '" placeholder="Название шаблона">' +
        LANGUAGES.map(function (language) {
          return '<textarea data-field="' + language[0] + '" placeholder="' + language[1] + '">' + esc((template.text || {})[language[0]] || "") + "</textarea>";
        }).join("") +
        '<div class="row"><button class="btn secondary small" data-save="1" type="button">Сохранить</button><button class="btn ghost small" data-drop="1" type="button">Удалить</button></div>' +
      "</div></div>";
    }).join("") : '<div class="empty"><b>Шаблонов нет</b>Готовый текст можно вставить в ответ одним кликом</div>') + "</div>",
    footer: '<button class="btn secondary" id="addTemplate" type="button">＋ Шаблон</button><div class="grow"></div><button class="btn" data-close="1" type="button">Готово</button>',
    ready: function (dialog) {
      function bind() {
        dialog.querySelectorAll("[data-template]").forEach(function (card) {
          var id = card.dataset.template;
          var payload = function () {
            var text = {};
            LANGUAGES.forEach(function (language) { text[language[0]] = card.querySelector('[data-field="' + language[0] + '"]').value; });
            return { title: card.querySelector('[data-field="title"]').value, text: text };
          };
          card.querySelector("[data-save]").onclick = async function () {
            try {
              if (id === "new") await send("/api/reply-templates", "POST", payload());
              else await send("/api/reply-templates/" + encodeURIComponent(id), "PUT", payload());
              toast("Сохранено");
              await reload(false);
              dialog.close();
              openTemplates();
            } catch (error) { fail(error); }
          };
          card.querySelector("[data-drop]").onclick = async function () {
            if (id === "new") return card.closest(".card").remove();
            if (!(await confirmDialog("Удалить шаблон?", "Шаблон исчезнет из списка.", "Удалить", true))) return;
            try { await api("/api/reply-templates/" + encodeURIComponent(id), { method: "DELETE" }); await reload(false); dialog.close(); openTemplates(); } catch (error) { fail(error); }
          };
        });
      }
      bind();
      dialog.querySelector("#addTemplate").onclick = function () {
        var list = dialog.querySelector("#templateList");
        var card = document.createElement("div");
        card.className = "card";
        card.innerHTML = '<div class="card-body stack" data-template="new"><input data-field="title" placeholder="Название шаблона">' +
          LANGUAGES.map(function (language) { return '<textarea data-field="' + language[0] + '" placeholder="' + language[1] + '"></textarea>'; }).join("") +
          '<div class="row"><button class="btn secondary small" data-save="1" type="button">Сохранить</button><button class="btn ghost small" data-drop="1" type="button">Удалить</button></div></div>';
        list.appendChild(card);
        bind();
      };
    },
  });
}

function renderInquiryList(host) {
  var rows = inquiryRows();
  pageAction("✎ Шаблоны ответов", openTemplates, "secondary");
  pageAction("🧹 Очистить", openCleanup, "ghost");
  var counts = {
    waiting: (state.inquiries || []).filter(awaitsReply).length,
    open: (state.inquiries || []).filter(function (item) { return item.status !== "closed"; }).length,
    all: (state.inquiries || []).length,
  };
  host.innerHTML =
    '<div class="toolbar">' +
      '<div class="tabs" id="inqStatus">' +
        '<button type="button" data-status="waiting" class="' + (inquiryFilter.status === "waiting" ? "active" : "") + '">Ждут ответа' + (counts.waiting ? " · " + counts.waiting : "") + "</button>" +
        '<button type="button" data-status="open" class="' + (inquiryFilter.status === "open" ? "active" : "") + '">Открытые · ' + counts.open + "</button>" +
        '<button type="button" data-status="closed" class="' + (inquiryFilter.status === "closed" ? "active" : "") + '">Закрытые</button>' +
        '<button type="button" data-status="" class="' + (inquiryFilter.status === "" ? "active" : "") + '">Все · ' + counts.all + "</button>" +
      "</div>" +
      '<div class="search"><input id="inqSearch" placeholder="Имя, телефон или текст" value="' + esc(inquiryFilter.search) + '"></div>' +
      '<select id="inqType" style="max-width:190px">' + [["", "Все типы"], ["general", "Сообщения"], ["lead", "Заявки на звонок"], ["viewing", "Просмотры"], ["selection", "Подбор"], ["question", "Вопросы по объекту"], ["interest", "Интерес к объекту"]].map(function (option) {
        return '<option value="' + option[0] + '"' + (inquiryFilter.type === option[0] ? " selected" : "") + ">" + option[1] + "</option>";
      }).join("") + "</select>" +
      '<button class="btn secondary small" id="exportInq" type="button">⬇ Excel</button>' +
    "</div>" +
    '<div class="split"><div class="card"><div class="table-wrap"><table><thead><tr><th>Клиент</th><th>Обращение</th><th>Статус</th><th class="right">Когда</th></tr></thead><tbody>' +
      (rows.length ? rows.map(function (item) {
        var user = userOf(item);
        return '<tr class="clickable' + (item.id === selectedInquiry ? " selected" : "") + '" data-id="' + esc(item.id) + '">' +
          '<td><div class="row"><span class="avatar">' + esc(initials(user.firstName)) + '</span><span><b>' + esc(userName(user)) + "</b>" + (user.phone ? '<br><span class="small faint">' + esc(user.phone) + "</span>" : "") + "</span></div></td>" +
          '<td><span class="small faint">' + esc(inquiryTypeName(item)) + "</span><br>" + esc(String(item.text || "").replace(/\s+/g, " ").slice(0, 80)) + "</td>" +
          "<td>" + statusChip(item) + "</td>" +
          '<td class="right small faint nowrap">' + ago(item.clientMessageAt || item.createdAt) + "</td></tr>";
      }).join("") : '<tr><td colspan="4"><div class="empty"><b>Ничего не найдено</b>Измените фильтр</div></td></tr>') +
    "</tbody></table></div></div>" +
    '<div id="inquiryCard"></div></div>';

  host.querySelectorAll("#inqStatus button").forEach(function (button) {
    button.onclick = function () { inquiryFilter.status = button.dataset.status; renderInquiryList(host); };
  });
  host.querySelector("#inqType").onchange = function (event) { inquiryFilter.type = event.target.value; renderInquiryList(host); };
  var search = host.querySelector("#inqSearch");
  search.oninput = function () {
    inquiryFilter.search = search.value.trim();
    clearTimeout(search._timer);
    search._timer = setTimeout(function () { renderInquiryList(host); host.querySelector("#inqSearch").focus(); }, 250);
  };
  host.querySelector("#exportInq").onclick = exportInquiries;
  host.querySelectorAll("tr[data-id]").forEach(function (row) {
    row.onclick = function () { selectedInquiry = row.dataset.id; renderInquiryList(host); };
  });
  renderInquiryCard(host.querySelector("#inquiryCard"));
}

// Уборка списка: закрытые, отвеченные или всё подряд, с отсечкой по возрасту.
function openCleanup() {
  var all = state.inquiries || [];
  var closed = all.filter(function (item) { return item.status === "closed"; }).length;
  openDialog({
    title: "Очистить обращения",
    body: '<div class="stack">' +
      '<p class="muted small">Обращения удаляются из панели без возможности восстановления. Клиенты и переписка в Telegram остаются.</p>' +
      '<div class="field"><label for="cleanScope">Какие удалить</label><select id="cleanScope">' +
        '<option value="closed">Только закрытые (' + closed + ")</option>" +
        '<option value="answered">Закрытые и отвеченные</option>' +
        '<option value="all">Все, включая ждущие ответа (' + all.length + ")</option>" +
      "</select></div>" +
      '<div class="field"><label for="cleanAge">Старше чем</label><select id="cleanAge">' +
        '<option value="0">любого возраста</option><option value="30">30 дней</option><option value="90" selected>90 дней</option><option value="180">180 дней</option><option value="365">года</option>' +
      "</select></div>" +
      '<div id="cleanPreview" class="chip warn"></div></div>',
    footer: '<button class="btn secondary" data-close="1" type="button">Отмена</button><button class="btn danger" id="doClean" type="button">Удалить</button>',
    ready: function (dialog) {
      function matching() {
        var scope = dialog.querySelector("#cleanScope").value;
        var days = Number(dialog.querySelector("#cleanAge").value);
        var before = days ? Date.now() - days * 864e5 : Infinity;
        return all.filter(function (item) {
          var old = (Date.parse(item.updatedAt || item.createdAt) || 0) < before;
          var matches = scope === "all" ? true : scope === "closed" ? item.status === "closed" : item.status !== "new";
          return matches && old;
        }).length;
      }
      function preview() { dialog.querySelector("#cleanPreview").textContent = "Будет удалено: " + matching(); }
      preview();
      dialog.querySelector("#cleanScope").onchange = preview;
      dialog.querySelector("#cleanAge").onchange = preview;
      dialog.querySelector("#doClean").onclick = async function () {
        if (!(await confirmDialog("Удалить обращения?", "Будет удалено: " + matching() + ". Отменить это нельзя.", "Удалить", true))) return;
        try {
          var result = await send("/api/inquiries/cleanup", "POST", { scope: dialog.querySelector("#cleanScope").value, olderThanDays: Number(dialog.querySelector("#cleanAge").value) });
          dialog.close();
          selectedInquiry = "";
          toast("Удалено: " + result.removed + ", осталось: " + result.left);
          await reload();
        } catch (error) { fail(error); }
      };
    },
  });
}

async function exportInquiries() {
  try {
    var response = await fetch("/api/inquiries/export", { method: "POST", headers: { "content-type": "application/json", "x-csrf-token": csrf }, body: JSON.stringify({ ids: inquiryRows().map(function (item) { return item.id; }) }) });
    if (!response.ok) throw new Error("Не удалось выгрузить");
    var blob = await response.blob();
    var link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = "Обращения.xlsx";
    link.click();
    URL.revokeObjectURL(link.href);
  } catch (error) { fail(error); }
}

function renderInquiryCard(host) {
  var item = (state.inquiries || []).find(function (entry) { return entry.id === selectedInquiry; });
  if (!item) {
    host.innerHTML = '<div class="card"><div class="empty"><b>Выберите обращение</b>Здесь будет переписка и ответ</div></div>';
    return;
  }
  var user = userOf(item);
  var property = item.propertyId ? (state.objects || []).find(function (record) { return record.id === item.propertyId; }) : null;
  var viewing = item.viewing || null;
  host.innerHTML = '<div class="card"><header><h3>' + esc(userName(user)) + "</h3><div class=\"actions\">" + statusChip(item) + "</div></header>" +
    '<div class="card-body stack">' +
      '<div class="small muted">' + esc(inquiryTypeName(item)) + " · " + dateTime(item.createdAt) +
        (user.username ? " · @" + esc(user.username) : "") + (user.phone ? " · " + esc(user.phone) : "") +
        (user.source ? ' · 📣 ' + esc(user.source) : "") + "</div>" +
      (property ? '<div class="chip brand">' + esc(localized(property.title, "ru")) + "</div>" : "") +
      '<div class="msg">' + esc(item.text || "") + "</div>" +
      (viewing ? '<div class="msg">📅 ' + esc((viewing.confirmedDate || viewing.dateText || "дата не выбрана") + " · " + (viewing.confirmedTime || viewing.timeText || "")) +
        (viewing.confirmedAt ? '<br><span class="small" style="color:var(--ok)">подтверждён</span>' : '<br><span class="small" style="color:var(--warn)">ждёт подтверждения</span>') + "</div>" : "") +
      ((item.replies || []).map(function (reply) {
        return '<div class="msg out">' + esc(reply.text) + '<div class="msg-meta">' + esc(reply.by || "панель") + " · " + dateTime(reply.createdAt) + "</div></div>";
      }).join("")) +
      '<div class="field"><label>Ответ клиенту</label><textarea id="replyText" placeholder="Текст уйдёт клиенту в Telegram"></textarea></div>' +
      '<div class="row wrap"><button class="btn" id="sendReply" type="button">Отправить</button>' +
        '<label class="check"><input type="checkbox" id="keepOpen"> оставить открытым</label>' +
        (state.replyTemplates && state.replyTemplates.length ? '<select id="replyTemplate" style="max-width:190px"><option value="">Шаблон…</option>' + state.replyTemplates.map(function (template) {
          return '<option value="' + esc(template.id) + '">' + esc(template.title) + "</option>";
        }).join("") + "</select>" : "") +
      "</div>" +
      (viewing && !viewing.confirmedAt ? '<div class="row wrap"><input type="date" id="viewDate" style="max-width:150px" value="' + esc(viewing.date || "") + '"><input type="time" id="viewTime" style="max-width:110px" value="' + esc(viewing.confirmedTime || "") + '"><button class="btn secondary small" id="confirmViewing" type="button">Подтвердить просмотр</button></div>' : "") +
      '<div class="row wrap"><button class="btn secondary small" data-status="in_progress" type="button">В работу</button>' +
        '<button class="btn secondary small" data-status="closed" type="button">Закрыть</button>' +
        '<button class="btn secondary small" data-status="new" type="button">Открыть снова</button></div>' +
      '<div class="field"><label>Заметка для себя</label><textarea id="inqNote">' + esc(item.note || "") + "</textarea></div>" +
      '<div class="row"><div class="field grow"><label>Связаться снова</label><input type="date" id="followDate" value="' + esc(item.followUpDate || "") + '"></div>' +
      '<div class="field" style="max-width:110px"><label>Время</label><input type="time" id="followTime" value="' + esc(item.followUpTime || "") + '"></div></div>' +
      '<div class="row"><button class="btn secondary small" id="saveInq" type="button">Сохранить заметку и напоминание</button>' +
      '<div class="grow"></div><button class="btn ghost small" id="deleteInq" type="button">Удалить обращение</button></div>' +
    "</div></div>";

  host.querySelector("#sendReply").onclick = async function () {
    var text = host.querySelector("#replyText").value.trim();
    if (!text) return toast("Введите ответ", true);
    try {
      await send("/api/inquiries/" + encodeURIComponent(item.id) + "/reply", "POST", { text: text, keepOpen: host.querySelector("#keepOpen").checked });
      toast("Ответ отправлен");
      await reload();
    } catch (error) { fail(error); }
  };
  var templates = host.querySelector("#replyTemplate");
  if (templates) templates.onchange = function () {
    var template = (state.replyTemplates || []).find(function (entry) { return entry.id === templates.value; });
    if (template) host.querySelector("#replyText").value = localized(template.text, item.language || "ru") || template.text.ru || "";
  };
  host.querySelectorAll("[data-status]").forEach(function (button) {
    button.onclick = async function () {
      try {
        await send("/api/inquiries/" + encodeURIComponent(item.id), "PATCH", { status: button.dataset.status });
        await reload();
      } catch (error) { fail(error); }
    };
  });
  host.querySelector("#saveInq").onclick = async function () {
    try {
      await send("/api/inquiries/" + encodeURIComponent(item.id), "PATCH", {
        note: host.querySelector("#inqNote").value,
        followUpDate: host.querySelector("#followDate").value,
        followUpTime: host.querySelector("#followTime").value,
      });
      toast("Сохранено");
      await reload();
    } catch (error) { fail(error); }
  };
  host.querySelector("#deleteInq").onclick = async function () {
    if (!(await confirmDialog("Удалить обращение?", "Оно исчезнет из панели. Переписка в Telegram останется.", "Удалить", true))) return;
    try {
      await api("/api/inquiries/" + encodeURIComponent(item.id), { method: "DELETE" });
      selectedInquiry = "";
      toast("Удалено");
      await reload();
    } catch (error) { fail(error); }
  };
  var confirmButton = host.querySelector("#confirmViewing");
  if (confirmButton) confirmButton.onclick = async function () {
    try {
      await send("/api/inquiries/" + encodeURIComponent(item.id) + "/viewing", "POST", { date: host.querySelector("#viewDate").value, time: host.querySelector("#viewTime").value });
      toast("Просмотр подтверждён, клиент получил сообщение");
      await reload();
    } catch (error) { fail(error); }
  };
}

// --- Просмотры ----------------------------------------------------------------
function renderViewings(host) {
  var rows = (state.inquiries || []).filter(function (item) { return item.type === "viewing" && item.viewing; });
  var upcoming = rows.filter(function (item) { return !item.viewing.cancelledAt && item.status !== "closed"; });
  host.innerHTML = '<div class="grid cols-3" style="margin-bottom:12px">' +
      kpiCard("Всего записей", num(rows.length)) +
      kpiCard("Подтверждено", num(upcoming.filter(function (item) { return item.viewing.confirmedAt; }).length)) +
      kpiCard("Ждут подтверждения", num(upcoming.filter(function (item) { return !item.viewing.confirmedAt; }).length), "клиент ждёт ответа", "down") +
    "</div>" +
    '<div class="card"><div class="table-wrap"><table><thead><tr><th>Когда</th><th>Клиент</th><th>Объект</th><th>Статус</th><th></th></tr></thead><tbody>' +
    (rows.length ? rows.map(function (item) {
      var user = userOf(item);
      var property = (state.objects || []).find(function (record) { return record.id === item.propertyId; });
      var viewing = item.viewing;
      var when = (viewing.confirmedDate ? dateShort(viewing.confirmedDate) : viewing.dateText || "—") + " " + (viewing.confirmedTime || viewing.timeText || "");
      return '<tr class="clickable" data-id="' + esc(item.id) + '"><td class="nowrap">' + esc(when) + "</td>" +
        "<td>" + esc(userName(user)) + (user.phone ? ' <span class="small faint">' + esc(user.phone) + "</span>" : "") + "</td>" +
        "<td>" + esc(property ? localized(property.title, "ru") : "—") + "</td>" +
        "<td>" + (viewing.cancelledAt ? '<span class="chip">отменён</span>' : viewing.confirmedAt ? '<span class="chip ok">подтверждён</span>' : '<span class="chip warn">ждёт подтверждения</span>') + "</td>" +
        '<td class="right"><button class="btn ghost small" type="button">Открыть</button></td></tr>';
    }).join("") : '<tr><td colspan="5"><div class="empty"><b>Записей на просмотр нет</b>Клиенты записываются кнопкой под карточкой объекта</div></td></tr>') +
    "</tbody></table></div></div>";
  host.querySelectorAll("tr[data-id]").forEach(function (row) {
    row.onclick = function () { openInquiry(row.dataset.id); };
  });
}

// --- Клиенты --------------------------------------------------------------------
function renderClients(host) {
  var rows = (state.users || []).filter(function (user) {
    if (!clientSearch) return true;
    var haystack = (userName(user) + " " + (user.username || "") + " " + (user.phone || "") + " " + (user.id || "")).toLowerCase();
    return haystack.indexOf(clientSearch.toLowerCase()) >= 0;
  });
  host.innerHTML = '<div class="toolbar"><div class="search"><input id="clientSearch" placeholder="Имя, телефон, @username" value="' + esc(clientSearch) + '"></div>' +
      '<span class="small faint">Всего ' + num(state.userCount) + " · активных " + num(state.activeUserCount) + " · без рассылок " + num(state.broadcastOptOutCount) + "</span></div>" +
    '<div class="card"><div class="table-wrap"><table><thead><tr><th>Клиент</th><th>Язык</th><th class="right">Сообщений</th><th>Обращения</th><th class="right">Последний раз</th></tr></thead><tbody>' +
    (rows.length ? rows.slice(0, 200).map(function (user) {
      var count = (state.inquiries || []).filter(function (item) { return String(item.userId) === user.id; }).length;
      return '<tr class="clickable" data-id="' + esc(user.id) + '"><td><div class="row"><span class="avatar">' + esc(initials(user.firstName)) + "</span><span><b>" + esc(userName(user)) + "</b>" +
        (user.username ? ' <span class="small faint">@' + esc(user.username) + "</span>" : "") +
        (user.phone ? '<br><span class="small faint">' + esc(user.phone) + "</span>" : "") + "</span></div></td>" +
        "<td>" + esc((user.preferredLanguage || "—").toUpperCase()) + (user.blocked ? ' <span class="chip bad">заблокирован</span>' : "") + "</td>" +
        '<td class="right">' + num(user.messages) + "</td><td>" + (count ? num(count) : "—") + "</td>" +
        '<td class="right small faint nowrap">' + ago(user.lastSeenAt) + "</td></tr>";
    }).join("") : '<tr><td colspan="5"><div class="empty"><b>Никого не найдено</b></div></td></tr>') +
    "</tbody></table></div></div>";
  var search = host.querySelector("#clientSearch");
  search.oninput = function () {
    clientSearch = search.value.trim();
    clearTimeout(search._timer);
    search._timer = setTimeout(function () { renderClients(host); host.querySelector("#clientSearch").focus(); }, 250);
  };
  host.querySelectorAll("tr[data-id]").forEach(function (row) {
    row.onclick = function () { openClient(row.dataset.id); };
  });
}

function openClient(id) {
  var user = (state.users || []).find(function (entry) { return entry.id === id; });
  if (!user) return;
  var inquiries = (state.inquiries || []).filter(function (item) { return String(item.userId) === id; });
  openDialog({
    title: userName(user),
    body: '<div class="stack">' +
      '<div class="small muted">ID ' + esc(user.id) + (user.username ? " · @" + esc(user.username) : "") + " · первый раз " + dateTime(user.firstSeenAt) + " · последний " + dateTime(user.lastSeenAt) + "</div>" +
      '<div class="grid cols-3">' + kpiCard("Сообщений", num(user.messages)) + kpiCard("Обращений", num(inquiries.length)) + kpiCard("В избранном", num((user.favorites || []).length)) + "</div>" +
      (user.phone ? '<div class="field"><span class="field-label">Телефон</span><div>' + esc(user.phone) + "</div></div>" : "") +
      '<div class="field"><label for="clientNote">Заметка</label><textarea id="clientNote">' + esc(user.note || "") + "</textarea></div>" +
      '<div class="field"><label for="clientTags">Теги через запятую</label><input id="clientTags" value="' + esc((user.tags || []).join(", ")) + '"></div>' +
      '<label class="check"><input type="checkbox" id="clientBlocked"' + (user.blocked ? " checked" : "") + "> не писать этому клиенту</label>" +
      (inquiries.length ? '<div class="card"><header><h3>Обращения</h3></header><div class="list">' + inquiries.slice(0, 10).map(function (item) {
        return '<div class="list-item"><span class="grow"><b>' + esc(inquiryTypeName(item)) + "</b><br><span class=\"muted small\">" + esc(String(item.text || "").slice(0, 70)) + "</span></span><span class=\"small faint\">" + dateShort(item.createdAt) + "</span></div>";
      }).join("") + "</div></div>" : "") +
    "</div>",
      footer: '<button class="btn danger" id="eraseClient" type="button">Удалить данные</button><button class="btn ghost" id="exportClient" type="button">Выгрузить данные</button><div class="grow"></div><button class="btn secondary" data-close="1" type="button">Закрыть</button><button class="btn" id="saveClient" type="button">Сохранить</button>',
    ready: function (dialog) {
      dialog.querySelector("#saveClient").onclick = async function () {
        try {
          await send("/api/users/" + encodeURIComponent(user.id), "PATCH", {
            note: dialog.querySelector("#clientNote").value,
            tags: dialog.querySelector("#clientTags").value.split(",").map(function (tag) { return tag.trim(); }).filter(Boolean),
            blocked: dialog.querySelector("#clientBlocked").checked,
          });
          dialog.close();
          toast("Сохранено");
          await reload();
        } catch (error) { fail(error); }
      };
      dialog.querySelector("#exportClient").onclick = function () {
        window.location.href = "/api/users/" + encodeURIComponent(user.id) + "/export";
      };
      dialog.querySelector("#eraseClient").onclick = async function () {
        if (!(await confirmDialog("Удалить данные клиента?", "Переписка, заявки и контакты этого клиента будут удалены без возможности восстановления.", "Удалить", true))) return;
        try {
          await api("/api/users/" + encodeURIComponent(user.id), { method: "DELETE" });
          dialog.close();
          toast("Данные удалены");
          await reload();
        } catch (error) { fail(error); }
      };
    },
  });
}

VIEWS.inquiries = {
  subtitle: function () { return "Переписка с клиентами, просмотры и карточки клиентов"; },
  render: function (host, tab) {
    if (tab === "viewings") return renderViewings(host);
    if (tab === "clients") return renderClients(host);
    renderInquiryList(host);
  },
};
`;

export { INQUIRIES_JS };
