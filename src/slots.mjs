// Свободное время для просмотров: администратор задаёт дни недели и часы
// начала, клиент выбирает из того, что ещё не занято подтверждёнными
// просмотрами, и просмотр подтверждается сразу.

import { dateFromDayKey, localDayKey } from './util.mjs';
import { normalizeViewingSlots } from './data-format.mjs';
import { data } from './store.mjs';
import { viewingDateLabel } from './viewings.mjs';

// A slot today can still be booked up to an hour before it starts.
const SLOT_MIN_NOTICE_MS = 60 * 60 * 1000;
const SLOT_DAYS_SHOWN = 8;

function slotSettings() {
  return normalizeViewingSlots(data.config && data.config.viewingSlots);
}

function slotsEnabled() {
  return slotSettings().enabled;
}

// Confirmed viewings at that time, whoever confirmed them.
function bookedViewings(day, time, exceptInquiryId = '') {
  return data.inquiries.filter((inquiry) => inquiry.type === 'viewing' && inquiry.id !== exceptInquiryId
    && inquiry.status !== 'closed' && inquiry.viewing && inquiry.viewing.confirmedAt && !inquiry.viewing.cancelledAt
    && inquiry.viewing.confirmedDate === day && inquiry.viewing.confirmedTime === time).length;
}

function slotFree(day, time, now = new Date(), settings = slotSettings()) {
  if (!settings.times.includes(time)) return false;
  const start = dateFromDayKey(day);
  if (!settings.days.includes(start.getDay())) return false;
  const [hours, minutes] = time.split(':').map(Number);
  start.setHours(hours, minutes, 0, 0);
  if (start.getTime() - now.getTime() < SLOT_MIN_NOTICE_MS) return false;
  return bookedViewings(day, time) < settings.perSlot;
}

function freeTimes(day, now = new Date(), settings = slotSettings()) {
  return settings.times.filter((time) => slotFree(day, time, now, settings));
}

// The next days with at least one free slot, as keyboard labels.
function availableSlotDays(language, now = new Date(), settings = slotSettings()) {
  const days = [];
  for (let offset = 0; offset < settings.daysAhead && days.length < SLOT_DAYS_SHOWN; offset += 1) {
    const date = new Date(now.getFullYear(), now.getMonth(), now.getDate() + offset);
    const key = localDayKey(date);
    const times = freeTimes(key, now, settings);
    if (times.length) days.push({ key, label: viewingDateLabel(key, language), times });
  }
  return days;
}

export {
  SLOT_MIN_NOTICE_MS,
  availableSlotDays,
  bookedViewings,
  freeTimes,
  slotFree,
  slotSettings,
  slotsEnabled,
};
