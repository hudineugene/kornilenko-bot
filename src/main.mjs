// Entry point. The modules are loaded in this order on purpose: settings,
// texts and the data format first, then the data store (which reads
// bot-data.json while it loads), then everything that only uses them later.
// Starts the bot unless BOT_NO_START=1 (tests) and exposes what tests use.

import './config.mjs';
import { hashPassword } from './util.mjs';
import { normalizeLoadedData } from './data-format.mjs';
import { contentAddressImages, persistImage, referencedImageFiles } from './media.mjs';
import { CATALOG_FILTER_TEXT, COMMAND_TEXT, INTERACTION_TEXT, LEAD_FORM_TEXT, MENU_LABELS, PROPERTY_ACTION_TEXT, PROPERTY_ALERT_TEXT, SELECTION_FORM_TEXT, VIEWING_FORM_TEXT } from './texts.mjs';
import { getData, loadData, replaceData, restoreMissingMedia, runDailyBackup, runtime, saveDataNow } from './store.mjs';
import './analytics.mjs';
import { leadSourceFromPayload, normalizeUser, rebuildUserIndex, userByChatId, userById } from './users.mjs';
import { splitTelegramText, telegramRequest } from './telegram.mjs';
import './menus.mjs';
import { viewingDateValue } from './forms.mjs';
import { createInquiry } from './inquiries.mjs';
import { catalogFilterPanel, catalogRecords } from './catalog.mjs';
import './sections.mjs';
import { handleUpdate, processUpdates } from './updates.mjs';
import './broadcasts.mjs';
import { runDailyDigest, runInquiryReminders } from './notices.mjs';
import { budgetLimit, deliverPropertyAlerts, propertyAlertDeliveries, queuePropertyAlerts, selectionMatches } from './alerts.mjs';
import { confirmViewing, parseViewingDate, runViewingNotices, viewingAgenda } from './viewings.mjs';
import { myRequestsView } from './requests.mjs';
import { hostAllowed, loginAttempts, requestIsRemote, sessions } from './admin-http.mjs';
import './admin-input.mjs';
import { xlsxWorkbook } from './excel.mjs';
import { startTunnel, stopTunnel, tunnelErrorFrom, tunnelUrlFrom } from './remote.mjs';
import { handleApi } from './admin-api.mjs';
import './admin-page.mjs';
import { server } from './server.mjs';
import { abruptStopNotice, clearRunMarker, previousRunEndedAbruptly, reportAbruptStop, start, writeRunMarker } from './lifecycle.mjs';

if (process.env.BOT_NO_START !== '1') start();

function setData(next) {
  replaceData(next);
  rebuildUserIndex();
}

const text = {
  lead: LEAD_FORM_TEXT,
  viewing: VIEWING_FORM_TEXT,
  selection: SELECTION_FORM_TEXT,
  menu: MENU_LABELS,
  interaction: INTERACTION_TEXT,
  commands: COMMAND_TEXT,
  propertyActions: PROPERTY_ACTION_TEXT,
  propertyAlerts: PROPERTY_ALERT_TEXT,
  catalogFilter: CATALOG_FILTER_TEXT,
};

export {
  abruptStopNotice,
  budgetLimit,
  catalogFilterPanel,
  catalogRecords,
  clearRunMarker,
  confirmViewing,
  contentAddressImages,
  createInquiry,
  deliverPropertyAlerts,
  getData,
  handleApi,
  handleUpdate,
  hashPassword,
  hostAllowed,
  leadSourceFromPayload,
  loadData,
  loginAttempts,
  myRequestsView,
  normalizeLoadedData,
  normalizeUser,
  parseViewingDate,
  persistImage,
  previousRunEndedAbruptly,
  processUpdates,
  propertyAlertDeliveries,
  queuePropertyAlerts,
  referencedImageFiles,
  reportAbruptStop,
  requestIsRemote,
  restoreMissingMedia,
  runDailyBackup,
  runDailyDigest,
  runInquiryReminders,
  runViewingNotices,
  runtime,
  saveDataNow,
  selectionMatches,
  server,
  sessions,
  setData,
  splitTelegramText,
  startTunnel,
  stopTunnel,
  telegramRequest,
  text,
  tunnelErrorFrom,
  tunnelUrlFrom,
  userByChatId,
  userById,
  viewingAgenda,
  viewingDateValue,
  writeRunMarker,
  xlsxWorkbook,
};
