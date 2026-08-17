// Helpdesk Admin Toolkit — background service worker
let currentEnv = 'prod';

const ENVIRONMENTS = {
  prod: { label: 'Production', suffix: '', icon: 'icon16.png' },
  sb1: { label: 'SB1', suffix: '-sb1', icon: 'icon16_1.png' },
  sb2: { label: 'SB2', suffix: '-sb2', icon: 'icon16_2.png' }
};

const SEARCH_OPTIONS = [
  { id: "netsuiteSearchDefault", title: "Quick Search", prefix: "" },
  { id: "netsuiteSearchSalesOrder", title: "Sales Order", prefix: "sales:" },
  { id: "netsuiteSearchPurchaseOrder", title: "Purchase Order", prefix: "purchase:" },
  { id: "netsuiteSearchTransferOrder", title: "Transfer Order", prefix: "" },
  { id: "netsuiteSearchItem", title: "Item", prefix: "item:" },
  { id: "netsuiteSearchReturn", title: "Return", prefix: "return:" }
];

function getEnv(env) { return ENVIRONMENTS[env] || ENVIRONMENTS.prod; }

function sanitizeAccountId(raw) {
  return (raw || '').toString().trim().toLowerCase().replace(/[^a-z0-9_-]/g, '');
}

function getBaseUrl(accountId, env) {
  const id = sanitizeAccountId(accountId);
  if (!id) return null;
  return `https://${id}${getEnv(env).suffix}.app.netsuite.com`;
}

async function updateIcon(env) { chrome.action.setIcon({ path: getEnv(env).icon }); }
async function updateEnvironment(env) { currentEnv = env; await updateIcon(env); rebuildContextMenu(); }

async function ensureContentScript(tabId) {
  try {
    await chrome.tabs.sendMessage(tabId, { type: 'PING' });
  } catch (error) {
    await chrome.scripting.executeScript({ target: { tabId }, files: ['content.js'] });
  }
}

async function rebuildContextMenu() {
  await chrome.contextMenus.removeAll();

  chrome.contextMenus.create({
    id: "captureSelectedArea",
    title: "📸 Capture Selected Area",
    contexts: ["all"]
  });

  const data = await chrome.storage.local.get(['savedClipboardValues']);
  const savedValues = data.savedClipboardValues || [];

  if (savedValues.length > 0) {
    chrome.contextMenus.create({
      id: "pasteSavedParent",
      title: "Paste Saved",
      contexts: ["editable"]
    });

    savedValues.forEach((val, index) => {
      const title = val.length > 20 ? val.substring(0, 20) + "..." : val;
      chrome.contextMenus.create({
        id: `pasteVal_${index}`,
        parentId: "pasteSavedParent",
        title: title,
        contexts: ["editable"]
      });
    });
  }

  chrome.contextMenus.create({
    id: "netsuiteGlobalSearch",
    title: `Search ${getEnv(currentEnv).label} Record`,
    contexts: ["selection"]
  });

  SEARCH_OPTIONS.forEach(opt =>
    chrome.contextMenus.create({
      id: opt.id,
      parentId: "netsuiteGlobalSearch",
      title: opt.title,
      contexts: ["selection"]
    })
  );
}

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'sync') {
    if (changes.netsuiteEnv) currentEnv = changes.netsuiteEnv.newValue || 'prod';
    if (changes.netsuiteEnv || changes.netsuiteAccountId) {
      rebuildContextMenu();
    }
  }
  if (area === 'local') {
    if (changes.savedClipboardValues) {
      rebuildContextMenu();
    }
  }
});

async function initializeExtension() {
  const s = await chrome.storage.sync.get(['netsuiteEnv']);
  currentEnv = s.netsuiteEnv || 'prod';
  await updateIcon(currentEnv);
  rebuildContextMenu();
}

chrome.runtime.onInstalled.addListener(initializeExtension);
chrome.runtime.onStartup.addListener(initializeExtension);

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'updateIcon') updateEnvironment(message.env);

  if (message.type === 'CAPTURE_SCREENSHOT') {
    const targetWindowId = sender.tab ? sender.tab.windowId : null;
    chrome.tabs.captureVisibleTab(targetWindowId, { format: 'png' }, (dataUrl) => handleScreenshot(dataUrl, message.shouldCache));
  }

  if (message.type === 'CROP_SCREENSHOT') {
    chrome.storage.local.get(['temp_snip_image'], (data) => {
      chrome.storage.local.set({
        'current_edit_image': data.temp_snip_image,
        'current_crop_data': message.cropData
      }, () => chrome.tabs.create({ url: 'screenshot-editor.html' }));
    });
  }
});

function handleScreenshot(dataUrl, cache) {
  if (chrome.runtime.lastError) return;
  chrome.storage.local.remove('current_crop_data');

  if (cache) {
    chrome.storage.local.get(['captured_screenshots'], (r) => {
      let imgs = r.captured_screenshots || [];
      const ts = Date.now();
      imgs.unshift({ timestamp: ts, dataUrl: dataUrl });
      if (imgs.length > 10) imgs = imgs.slice(0, 10);
      chrome.storage.local.set({ 'captured_screenshots': imgs, 'current_edit_image': dataUrl }, () => {
        chrome.tabs.create({ url: `screenshot-editor.html?ts=${ts}&fresh=1` });
      });
    });
  } else {
    chrome.storage.local.set({ 'current_edit_image': dataUrl }, () => chrome.tabs.create({ url: 'screenshot-editor.html' }));
  }
}

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId === "captureSelectedArea") {
    chrome.tabs.captureVisibleTab(tab.windowId, { format: 'png' }, async (dataUrl) => {
      if (chrome.runtime.lastError) return;
      await chrome.storage.local.set({ 'temp_snip_image': dataUrl });
      await ensureContentScript(tab.id);
      chrome.tabs.sendMessage(tab.id, { type: 'START_SNIP' });
    });
    return;
  }

  if (info.menuItemId.startsWith("pasteVal_")) {
    const index = parseInt(info.menuItemId.split('_')[1]);
    const data = await chrome.storage.local.get(['savedClipboardValues']);
    const list = data.savedClipboardValues || [];

    if (list[index]) {
      await ensureContentScript(tab.id);
      chrome.tabs.sendMessage(tab.id, { type: 'PASTE_TEXT', text: list[index] });
    }
    return;
  }

  const opt = SEARCH_OPTIONS.find(o => o.id === info.menuItemId);
  if (!opt) return;

  const settings = await chrome.storage.sync.get(['netsuiteEnv', 'netsuiteAccountId']);
  const baseUrl = getBaseUrl(settings.netsuiteAccountId, settings.netsuiteEnv || 'prod');

  if (!baseUrl) {
    chrome.tabs.create({ url: chrome.runtime.getURL('popup.html?tab=context-menu&full=1') });
    return;
  }

  const text = (info.selectionText || "").trim();
  chrome.tabs.create({ url: `${baseUrl}/app/common/search/ubersearchresults.nl?quicksearch=T&searchtype=Uber&frame=be&Uber_NAMEtype=KEYWORDSTARTSWITH&Uber_NAME=${encodeURIComponent(opt.prefix + text)}` });
});

chrome.commands.onCommand.addListener(async (command) => {
  if (command === "capture_selected_area") {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab && tab.id) {
      chrome.tabs.captureVisibleTab(tab.windowId, { format: 'png' }, async (dataUrl) => {
        if (chrome.runtime.lastError) return;
        await chrome.storage.local.set({ 'temp_snip_image': dataUrl });
        await ensureContentScript(tab.id);
        chrome.tabs.sendMessage(tab.id, { type: 'START_SNIP' });
      });
    }
  }
});