// Entry point. The modules are loaded in this order on purpose: settings,
// texts and the data format first, then the data store (which reads
// bot-data.json while it loads), then everything that only uses them later.
// Starts the bot unless BOT_NO_START=1 (tests) and exposes what tests use.

import './config.mjs';
import { hashPassword } from './util.mjs';
import { PREVIOUS_HELP_DEFAULTS, normalizeLoadedData } from './data-format.mjs';
import { contentAddressImages, persistImage, referencedImageFiles } from './media.mjs';
import { CATALOG_FILTER_TEXT, COMMAND_TEXT, COMPARISON_TEXT, INTERACTION_TEXT, LEAD_FORM_TEXT, MENU_LABELS, MY_AREA_TEXT, PROPERTY_ACTION_TEXT, PROPERTY_ALERT_TEXT, SAVED_SEARCH_TEXT, SELECTION_FORM_TEXT, VIEWING_FORM_TEXT } from './texts.mjs';
import { getData, loadData, replaceData, restoreMissingMedia, runDailyBackup, runtime, saveDataNow } from './store.mjs';
import './analytics.mjs';
import { leadSourceFromPayload, normalizeUser, rebuildUserIndex, userByChatId, userById } from './users.mjs';
import { splitTelegramText, telegramRequest } from './telegram.mjs';
import { configureBotCommands, menuItemForText } from './menus.mjs';
import { formReminderDue, runFormReminders, viewingDateValue } from './forms.mjs';
import { awaitingReply, createInquiry } from './inquiries.mjs';
import { catalogFilterPanel, catalogRecords, contentButtons, objectCaption, objectCaptionHtml, propertyPublicationIssues, propertyPublicationReadiness, propertyReadyForLanguage } from './catalog.mjs';
import './sections.mjs';
import { handleUpdate, processUpdates } from './updates.mjs';
import { broadcastUsers, deliverBroadcast, runBroadcast } from './broadcasts.mjs';
import { runDailyDigest, runFollowUpReminders, runInquiryReminders, runWeeklyReport, weeklyReport } from './notices.mjs';
import { budgetLimit, currentSelectionRanking, deliverPropertyAlerts, locationMatches, propertyAlertDeliveries, queuePropertyAlerts, selectionEvaluation, selectionMatches } from './alerts.mjs';
import { confirmViewing, parseViewingDate, runViewingNotices, viewingAgenda } from './viewings.mjs';
import { myRequestsView } from './requests.mjs';
import { subscriptionPanel } from './subscriptions.mjs';
import { savedSearchMatches, savedSearchResults, savedSearchText } from './saved-search.mjs';
import { normalizedSimilarPropertyDetails, similarPropertyRanking } from './similar.mjs';
import { catalogRequest, naturalCatalogFilter, parseBedrooms, parseMaxPrice, parseMinPrice, parsePriceRange } from './search.mjs';
import { offHoursNote } from './hours.mjs';
import { monthlyPayment, purchaseEstimate } from './calculator.mjs';
import { decryptBackup, encryptBackup, runTelegramBackup, setBackupPassword } from './offsite.mjs';
import { applyImport, parseXml, planImport, planSummary, propertyTypeOf, publicAddress, readFeed, runDailyFeedImport } from './feed-import.mjs';
import { postToGroup, runDueGroupPosts } from './groups.mjs';
import { announceError, announceStart, sendStatusNotice, startNoticeText, stopNoticeText, telegramContactLost, telegramContactRestored } from './status.mjs';
import { hostAllowed, loginAttempts, requestIsRemote, sessions } from './admin-http.mjs';
import { parseContentRecord } from './admin-input.mjs';
import { xlsxWorkbook } from './excel.mjs';
import { startTunnel, stopTunnel, tunnelErrorFrom, tunnelUrlFrom } from './remote.mjs';
import { autostartStatus, autostartTaskName, autostartTaskXml, currentWindowsUser, setAutostart } from './autostart.mjs';
import { handleApi } from './admin-api.mjs';
import { server } from './server.mjs';
import { abruptStopNotice, clearRunMarker, previousRunEndedAbruptly, reportAbruptStop, start, writeRunMarker } from './lifecycle.mjs';

if (process.argv.includes('--no-auto-open')) process.env.NO_AUTO_OPEN = '1';
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
  myArea: MY_AREA_TEXT,
  comparison: COMPARISON_TEXT,
  savedSearch: SAVED_SEARCH_TEXT,
};

export {
  abruptStopNotice,
  announceError,
  announceStart,
  applyImport,
  autostartStatus,
  autostartTaskName,
  autostartTaskXml,
  broadcastUsers,
  awaitingReply,
  budgetLimit,
  catalogFilterPanel,
  catalogRecords,
  catalogRequest,
  clearRunMarker,
  configureBotCommands,
  confirmViewing,
  contentButtons,
  contentAddressImages,
  currentWindowsUser,
  createInquiry,
  currentSelectionRanking,
  decryptBackup,
  deliverBroadcast,
  deliverPropertyAlerts,
  encryptBackup,
  formReminderDue,
  getData,
  handleApi,
  handleUpdate,
  hashPassword,
  hostAllowed,
  leadSourceFromPayload,
  loadData,
  loginAttempts,
  locationMatches,
  menuItemForText,
  monthlyPayment,
  myRequestsView,
  normalizeLoadedData,
  normalizedSimilarPropertyDetails,
  naturalCatalogFilter,
  normalizeUser,
  offHoursNote,
  objectCaption,
  objectCaptionHtml,
  parseContentRecord,
  parseBedrooms,
  parseMinPrice,
  parseMaxPrice,
  parsePriceRange,
  parseViewingDate,
  parseXml,
  planImport,
  planSummary,
  postToGroup,
  PREVIOUS_HELP_DEFAULTS as previousHelpDefaults,
  propertyTypeOf,
  publicAddress,
  readFeed,
  persistImage,
  previousRunEndedAbruptly,
  processUpdates,
  propertyAlertDeliveries,
  propertyPublicationIssues,
  propertyPublicationReadiness,
  propertyReadyForLanguage,
  purchaseEstimate,
  queuePropertyAlerts,
  referencedImageFiles,
  reportAbruptStop,
  requestIsRemote,
  restoreMissingMedia,
  runBroadcast,
  runDailyBackup,
  runDueGroupPosts,
  runDailyDigest,
  runDailyFeedImport,
  runFollowUpReminders,
  runFormReminders,
  runInquiryReminders,
  runTelegramBackup,
  runViewingNotices,
  runWeeklyReport,
  runtime,
  saveDataNow,
  savedSearchMatches,
  savedSearchResults,
  savedSearchText,
  similarPropertyRanking,
  selectionEvaluation,
  selectionMatches,
  sendStatusNotice,
  server,
  sessions,
  setBackupPassword,
  setAutostart,
  setData,
  splitTelegramText,
  startNoticeText,
  startTunnel,
  stopNoticeText,
  subscriptionPanel,
  stopTunnel,
  telegramContactLost,
  telegramContactRestored,
  telegramRequest,
  text,
  tunnelErrorFrom,
  tunnelUrlFrom,
  userByChatId,
  userById,
  viewingAgenda,
  viewingDateValue,
  weeklyReport,
  writeRunMarker,
  xlsxWorkbook,
};
