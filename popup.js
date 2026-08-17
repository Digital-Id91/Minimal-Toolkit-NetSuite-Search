const PREF_PATH = '/app/center/userprefs.nl?sc=-29&whence=';
const ENV_SUFFIX = { prod: '', sb1: '-sb1', sb2: '-sb2' };

function sanitizeAccountId(raw) {
  return (raw || '').toString().trim().toLowerCase().replace(/[^a-z0-9_-]/g, '');
}
function getBaseUrl(accountId, env) {
  const id = sanitizeAccountId(accountId);
  if (!id) return null;
  return `https://${id}${ENV_SUFFIX[env] !== undefined ? ENV_SUFFIX[env] : ''}.app.netsuite.com`;
}
const elements = {};
let textEditor = null;
let draggedClipboardIndex = null;
let selectedScreenshots = new Set(); 

class DarkModeManager {
  constructor() { this.storageKey = 'helpdesk_toolkit_globalDarkMode'; this.init(); }
  async init() {
    const res = await chrome.storage.local.get([this.storageKey]);
    const isDark = res[this.storageKey] !== false; 
    this.applyDarkMode(isDark);
    if(elements.globalDarkModeToggle) {
      elements.globalDarkModeToggle.checked = isDark;
      elements.globalDarkModeToggle.addEventListener('change', () => {
        this.applyDarkMode(elements.globalDarkModeToggle.checked);
        chrome.storage.local.set({ [this.storageKey]: elements.globalDarkModeToggle.checked });
        if(textEditor) chrome.storage.local.set({ [`${textEditor.options.storagePrefix}darkMode`]: elements.globalDarkModeToggle.checked });
      });
    }
  }
  applyDarkMode(isDark) {
    document.body.classList.toggle('dark', isDark);
    if(textEditor) textEditor.applyDarkMode(isDark);
  }
  syncWithTextEditor() {}
}

class TabManager {
  constructor() { this.init(); }
  init() {
    document.querySelectorAll('.tab-btn').forEach(btn => btn.addEventListener('click', () => this.switchTab(btn.dataset.tab)));
    
    const urlParams = new URLSearchParams(window.location.search);
    const urlTab = urlParams.get('tab');
    
    if (urlTab) {
      this.switchTab(urlTab);
    } else {
      chrome.storage.local.get(['activeTab'], (res) => this.switchTab(res.activeTab || 'overlay'));
    }
  }
  switchTab(tabId) {
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    document.querySelector(`[data-tab="${tabId}"]`)?.classList.add('active');
    document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
    document.getElementById(tabId)?.classList.add('active');
    if (tabId === 'text-editor' && !textEditor) this.initTextEditor();
    if (tabId === 'screenshots') initScreenshotTool();
    if (tabId === 'clipboard') renderClipboardList(); 
    chrome.storage.local.set({ activeTab: tabId });
  }
  async initTextEditor() {
    const container = document.getElementById('text-editor-container');
    if (container && !textEditor) {
      const res = await chrome.storage.local.get(['helpdesk_toolkit_globalDarkMode']);
      
      textEditor = new TextEditor(container, { 
        showSidebar: true, 
        darkMode: res.helpdesk_toolkit_globalDarkMode !== false, 
        fontSize: 14, 
        storagePrefix: 'helpdesk_toolkit_', 
        searchEnabled: true, 
        showActionButtons: false, 
        showDarkModeToggle: false, 
        showFullScreenButton: true
      });
    }
  }
}

function openTextEditorInNewTab() { chrome.tabs.create({ url: 'editor.html' }); }

function cacheElements() {
  const ids = [
    'envSelect', 'prefLink', 'tipImage', 'overlayToggle', 'dragToggle', 
    'transparencyRange', 'sizeRange', 'illustrateLink', 'fontSelect', 'colorPicker', 'rotationRange',
    'btnCapture', 'chkCache', 'chkSnipCache', 'chkCopyOnCapture', 'btnClearGallery', 'galleryList', 'globalDarkModeToggle',
    'labelSB1', 'labelSB2', 'customUrl', 'customText', 'addCustomBtn', 'customOverlayList',
    'chkAlwaysTrim', 'clipboardInput', 'addClipboardBtn', 'clipboardList',
    'bulkActions', 'selectedCount', 'btnOpenSelected', 'btnDeleteSelected',
    'accountIdInput', 
    'envBadge', 
    'backToPopupBtn', 
    'globalPopOutBtn', 
    'globalPopOutTabBtn'
  ];
  ids.forEach(id => elements[id] = document.getElementById(id));
}

function updatePrefLink(env) {
  const base = getBaseUrl(elements.accountIdInput?.value, env);
  if (base) {
    elements.prefLink.href = base + PREF_PATH;
    elements.prefLink.title = '';
  } else {
    elements.prefLink.href = '#';
    elements.prefLink.title = 'Enter your NetSuite Account ID above first';
  }
}
const ENV_BADGES = { prod: 'PROD', sb1: 'SB1', sb2: 'SB2' };
function updateEnvBadge(env) {
  if (!elements.envBadge) return;
  const key = ENV_BADGES[env] ? env : 'prod';
  elements.envBadge.textContent = ENV_BADGES[key];
  elements.envBadge.className = `env-badge env-${key}`;
}

function sendIconUpdate(env) { chrome.runtime.sendMessage({ type: 'updateIcon', env }); }
async function sendTabMessage(msg) {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if(tab?.id) await chrome.tabs.sendMessage(tab.id, msg);
  } catch(e) {}
}

async function renderClipboardList() {
  const data = await chrome.storage.local.get(['savedClipboardValues']);
  const list = data.savedClipboardValues || [];
  if(!elements.clipboardList) return;
  
  elements.clipboardList.innerHTML = list.length 
    ? '' 
    : '<li style="padding:10px;text-align:center;color:var(--text-muted);font-style:italic;">No saved values yet.</li>';
  
  list.forEach((val, index) => {
    const li = document.createElement('li');
    li.draggable = true;
    li.style.cssText = "display: flex; justify-content: space-between; padding: 8px; border-bottom: 1px solid var(--border-color); align-items: center; cursor: grab; background: var(--bg-secondary); transition: background-color 0.2s;";
    
    const leftContainer = document.createElement('div');
    leftContainer.style.cssText = "display: flex; align-items: center; gap: 8px; overflow: hidden; flex: 1; min-width: 0;";
    leftContainer.innerHTML = `
      <span style="cursor: grab; opacity: 0.4; font-size: 14px; user-select: none; flex-shrink: 0;" title="Drag to reorder">⋮⋮</span>
      <span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:1;min-width:0;" title="${val}">${val}</span>
    `;
    
    const actionsContainer = document.createElement('div');
    actionsContainer.style.cssText = "display: flex; gap: 10px; align-items: center; flex-shrink: 0; margin-left: 8px;";

    const editBtn = document.createElement('span');
    editBtn.innerHTML = '✏️';
    editBtn.style.cssText = "cursor: pointer; opacity: 0.7; font-size: 13px;";
    editBtn.title = "Edit";
    editBtn.onmouseover = () => editBtn.style.opacity = 1;
    editBtn.onmouseout = () => editBtn.style.opacity = 0.7;
    
    editBtn.onclick = async () => {
      const valueSpan = leftContainer.querySelector('span:last-child');
      if (!valueSpan || leftContainer.querySelector('input')) return; 

      li.draggable = false;

      const input = document.createElement('input');
      input.type = 'text';
      input.value = val;
      input.style.cssText = "flex:1; min-width:0; padding:3px 6px; font-size:13px; border:1px solid var(--accent-color); border-radius:4px; background:var(--input-bg); color:var(--text-primary); outline:none; font-family:inherit;";

      valueSpan.replaceWith(input);
      input.focus();
      input.select();

      let finished = false;

      const commit = async () => {
        if (finished) return;
        finished = true;
        const trimmedVal = input.value.trim();
        if (trimmedVal && trimmedVal !== val) {
          if (!list.includes(trimmedVal)) {
            list[index] = trimmedVal;
            await chrome.storage.local.set({ savedClipboardValues: list });
          } else {
            alert('Value already exists!');
          }
        }
        renderClipboardList(); 
      };

      const cancel = () => {
        if (finished) return;
        finished = true;
        renderClipboardList();
      };

      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') { e.preventDefault(); commit(); }
        else if (e.key === 'Escape') { e.preventDefault(); cancel(); }
      });
      input.addEventListener('blur', commit);
    };

    const delBtn = document.createElement('span');
    delBtn.innerHTML = '🗑️';
    delBtn.style.cssText = "cursor: pointer; opacity: 0.7; font-size: 13px;";
    delBtn.title = "Remove";
    delBtn.onmouseover = () => delBtn.style.opacity = 1;
    delBtn.onmouseout = () => delBtn.style.opacity = 0.7;
    
    delBtn.onclick = async () => {
      list.splice(index, 1);
      await chrome.storage.local.set({ savedClipboardValues: list });
      renderClipboardList();
    };
    
    actionsContainer.appendChild(editBtn);
    actionsContainer.appendChild(delBtn);

    li.appendChild(leftContainer);
    li.appendChild(actionsContainer);

    li.addEventListener('dragstart', (e) => {
      draggedClipboardIndex = index;
      e.dataTransfer.effectAllowed = 'move';
      setTimeout(() => li.style.opacity = '0.4', 0); 
    });

    li.addEventListener('dragend', () => {
      li.style.opacity = '1';
      draggedClipboardIndex = null;
      document.querySelectorAll('#clipboardList li').forEach(el => {
        el.style.borderTop = '';
        el.style.borderBottom = '1px solid var(--border-color)';
      });
    });

    li.addEventListener('dragover', (e) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      
      const bounding = li.getBoundingClientRect();
      const offset = bounding.y + (bounding.height / 2);
      
      if (e.clientY - offset > 0) {
        li.style.borderBottom = '2px solid var(--accent-color)';
        li.style.borderTop = '';
      } else {
        li.style.borderTop = '2px solid var(--accent-color)';
        li.style.borderBottom = '1px solid var(--border-color)';
      }
    });

    li.addEventListener('dragleave', () => {
      li.style.borderTop = '';
      li.style.borderBottom = '1px solid var(--border-color)';
    });

    li.addEventListener('drop', async (e) => {
      e.preventDefault();
      li.style.borderTop = '';
      li.style.borderBottom = '1px solid var(--border-color)';
      
      if (draggedClipboardIndex === null || draggedClipboardIndex === index) return;

      const bounding = li.getBoundingClientRect();
      const offset = bounding.y + (bounding.height / 2);
      let insertIndex = index;
      
      if (e.clientY - offset > 0) insertIndex++;

      const newList = [...list];
      const itemToMove = newList.splice(draggedClipboardIndex, 1)[0];
      
      if (draggedClipboardIndex < insertIndex) insertIndex--;
      
      newList.splice(insertIndex, 0, itemToMove);

      await chrome.storage.local.set({ savedClipboardValues: newList });
      renderClipboardList();
    });

    elements.clipboardList.appendChild(li);
  });
}

async function addClipboardValue() {
  const val = elements.clipboardInput.value.trim();
  if(!val) return;
  
  const data = await chrome.storage.local.get(['savedClipboardValues']);
  const list = data.savedClipboardValues || [];
  
  if(!list.includes(val)) {
    list.push(val);
    await chrome.storage.local.set({ savedClipboardValues: list });
    elements.clipboardInput.value = '';
    renderClipboardList();
  } else {
    alert('Value already exists!');
  }
}

async function renderCustomList() {
  const data = await chrome.storage.sync.get(['customOverlays']);
  const list = data.customOverlays || [];
  if(!elements.customOverlayList) return;
  elements.customOverlayList.innerHTML = '';
  list.forEach((item, index) => {
    const li = document.createElement('li');
    li.style.cssText = "display: flex; justify-content: space-between; padding: 4px; border-bottom: 1px solid var(--border-color); font-size: 12px;";
    li.innerHTML = `<span><b>${item.text}</b> on ${item.url}</span>`;
    const delBtn = document.createElement('span'); delBtn.textContent = '✖'; delBtn.style.cssText = "color: #ef4444; cursor: pointer; font-weight: bold;";
    delBtn.onclick = async () => { list.splice(index, 1); await chrome.storage.sync.set({ customOverlays: list }); renderCustomList(); sendTabMessage({ type: 'refreshOverlay' }); };
    li.appendChild(delBtn); elements.customOverlayList.appendChild(li);
  });
}
async function addCustomOverlay() {
  const url = elements.customUrl.value.trim(); const text = elements.customText.value.trim();
  if(!url || !text) return;
  const data = await chrome.storage.sync.get(['customOverlays']);
  const list = data.customOverlays || [];
  list.push({ url, text });
  await chrome.storage.sync.set({ customOverlays: list });
  elements.customUrl.value = ''; elements.customText.value = '';
  renderCustomList(); sendTabMessage({ type: 'refreshOverlay' });
}
async function saveLabels() {
  await chrome.storage.sync.set({ labelSB1: elements.labelSB1.value, labelSB2: elements.labelSB2.value });
  sendTabMessage({ type: 'refreshOverlay' });
}

function updateBulkActions() {
  if (!elements.bulkActions) return;
  if (selectedScreenshots.size > 0) {
    elements.bulkActions.style.display = 'flex';
    elements.selectedCount.textContent = `${selectedScreenshots.size} selected`;
  } else {
    elements.bulkActions.style.display = 'none';
  }
}

function initScreenshotTool() {
  chrome.storage.local.get(['screenshot_cache_enabled', 'snip_cache_enabled', 'copy_on_capture'], (d) => { 
    if(d.screenshot_cache_enabled !== undefined && elements.chkCache) elements.chkCache.checked = d.screenshot_cache_enabled; 
    if(d.snip_cache_enabled !== undefined && elements.chkSnipCache) elements.chkSnipCache.checked = d.snip_cache_enabled; 
    if(d.copy_on_capture !== undefined && elements.chkCopyOnCapture) elements.chkCopyOnCapture.checked = d.copy_on_capture; 
  });
  renderGallery();
}

function renderGallery() {
  if (!elements.galleryList) return;
  selectedScreenshots.clear();
  updateBulkActions();

  chrome.storage.local.get(['captured_screenshots'], (d) => {
    const imgs = d.captured_screenshots || [];
    elements.galleryList.innerHTML = imgs.length ? '' : '<div style="text-align:center;color:var(--text-muted);padding:20px;grid-column:1 / -1;">No screenshots yet.</div>';
    
    imgs.forEach((img, index) => {
      const div = document.createElement('div'); 
      div.className = 'screenshot-item';
      div.style.position = 'relative'; 
      
      const chk = document.createElement('input');
      chk.type = 'checkbox';
      chk.style.cssText = "position: absolute; top: 6px; left: 6px; z-index: 10; width: 24px; height: 24px; cursor: pointer; accent-color: var(--accent-color); opacity: 0.9; box-shadow: 0 0 0 2px rgba(0,0,0,0.3); border-radius: 3px;";
      
      chk.onclick = (e) => {
        e.stopPropagation(); 
        if(chk.checked) selectedScreenshots.add(index);
        else selectedScreenshots.delete(index);
        
        div.style.borderColor = chk.checked ? 'var(--accent-color)' : '';
        div.style.boxShadow = chk.checked ? '0 0 0 3px var(--accent-color-light)' : '';
        
        updateBulkActions();
      };

      div.innerHTML = `<img src="${img.dataUrl}"><div class="screenshot-meta">${new Date(img.timestamp).toLocaleTimeString()}</div>`;
      div.appendChild(chk);

      div.onclick = () => {
        chrome.storage.local.set({ 'current_edit_image': img.dataUrl }, () => {
          chrome.tabs.create({ url: `screenshot-editor.html?ts=${img.timestamp}` });
        });
      };
      
      elements.galleryList.appendChild(div);
    });
  });
}
function updateRangeValue(el, s='') { const sp = el.parentElement.querySelector('.range-value'); if(sp) sp.textContent = el.value + s; }

async function initializePopup() {
  const settings = await chrome.storage.sync.get([
    'netsuiteEnv', 'netsuiteAccountId', 'showOverlay', 'overlayAlpha', 'overlaySize', 'allowDrag', 'overlayFont', 'overlayColor', 'overlayRotation',
    'labelSB1', 'labelSB2', 'customOverlays', 'alwaysTrimWhitespace'
  ]);
  if(elements.accountIdInput) elements.accountIdInput.value = settings.netsuiteAccountId || '';
  if(elements.envSelect) elements.envSelect.value = settings.netsuiteEnv || 'prod'; updatePrefLink(settings.netsuiteEnv || 'prod'); updateEnvBadge(settings.netsuiteEnv || 'prod');
  if(elements.overlayToggle) elements.overlayToggle.checked = settings.showOverlay || false;
  if(elements.dragToggle) elements.dragToggle.checked = settings.allowDrag !== false;
  if(elements.transparencyRange) { elements.transparencyRange.value = settings.overlayAlpha || 0.3; updateRangeValue(elements.transparencyRange); }
  if(elements.sizeRange) { elements.sizeRange.value = settings.overlaySize || 10; updateRangeValue(elements.sizeRange, 'vw'); }
  if(elements.rotationRange) { elements.rotationRange.value = settings.overlayRotation || 0; updateRangeValue(elements.rotationRange, '°'); }
  if(elements.fontSelect) elements.fontSelect.value = settings.overlayFont || 'Arial';
  if(elements.colorPicker) elements.colorPicker.value = settings.overlayColor || '#AAAAAA';
  if(elements.labelSB1) elements.labelSB1.value = settings.labelSB1 || 'SB1';
  if(elements.labelSB2) elements.labelSB2.value = settings.labelSB2 || 'SB2';
  if(elements.chkAlwaysTrim) elements.chkAlwaysTrim.checked = settings.alwaysTrimWhitespace || false;
  
  renderCustomList();
  renderClipboardList(); 
}

function setupEventListeners() {
  elements.envSelect?.addEventListener('change', async () => { await chrome.storage.sync.set({ netsuiteEnv: elements.envSelect.value }); updatePrefLink(elements.envSelect.value); sendIconUpdate(elements.envSelect.value); updateEnvBadge(elements.envSelect.value); });
  elements.illustrateLink?.addEventListener('click', () => chrome.tabs.create({ url: chrome.runtime.getURL('popup_image.png') }));
  elements.overlayToggle?.addEventListener('change', async () => { await chrome.storage.sync.set({ showOverlay: elements.overlayToggle.checked }); sendTabMessage({ type: 'toggleOverlay' }); });
  elements.dragToggle?.addEventListener('change', async () => { await chrome.storage.sync.set({ allowDrag: elements.dragToggle.checked }); sendTabMessage({ type: 'toggleDrag', enabled: elements.dragToggle.checked }); });
  
  const updateStyle = (key, val, msg) => { chrome.storage.sync.set({ [key]: val }); sendTabMessage({ type: msg, [msg === 'updateOverlayColor' ? 'color' : msg === 'updateOverlayFont' ? 'font' : key.replace('overlay', '').toLowerCase()]: val }); };
  elements.transparencyRange?.addEventListener('input', (e) => { updateStyle('overlayAlpha', parseFloat(e.target.value), 'updateOverlayAlpha'); updateRangeValue(e.target); });
  elements.sizeRange?.addEventListener('input', (e) => { updateStyle('overlaySize', parseFloat(e.target.value), 'updateOverlaySize'); updateRangeValue(e.target, 'vw'); });
  elements.rotationRange?.addEventListener('input', (e) => { updateStyle('overlayRotation', parseInt(e.target.value), 'updateOverlayRotation'); updateRangeValue(e.target, '°'); });
  elements.fontSelect?.addEventListener('change', (e) => updateStyle('overlayFont', e.target.value, 'updateOverlayFont'));
  elements.colorPicker?.addEventListener('input', (e) => updateStyle('overlayColor', e.target.value, 'updateOverlayColor'));
  
  elements.labelSB1?.addEventListener('input', saveLabels); elements.labelSB2?.addEventListener('input', saveLabels);
  elements.addCustomBtn?.addEventListener('click', addCustomOverlay);

  elements.accountIdInput?.addEventListener('input', async () => {
    await chrome.storage.sync.set({ netsuiteAccountId: sanitizeAccountId(elements.accountIdInput.value) });
    updatePrefLink(elements.envSelect?.value || 'prod');
  });
  elements.accountIdInput?.addEventListener('change', () => {
    elements.accountIdInput.value = sanitizeAccountId(elements.accountIdInput.value);
  });
  
  elements.btnCapture?.addEventListener('click', () => { chrome.runtime.sendMessage({ type: 'CAPTURE_SCREENSHOT', shouldCache: elements.chkCache.checked }); window.close(); });
  elements.btnClearGallery?.addEventListener('click', () => { if(confirm("Clear gallery?")) chrome.storage.local.set({ 'captured_screenshots': [] }, renderGallery); });
  
  elements.chkCache?.addEventListener('change', () => chrome.storage.local.set({ screenshot_cache_enabled: elements.chkCache.checked }));
  elements.chkSnipCache?.addEventListener('change', () => chrome.storage.local.set({ snip_cache_enabled: elements.chkSnipCache.checked }));
  elements.chkCopyOnCapture?.addEventListener('change', () => chrome.storage.local.set({ copy_on_capture: elements.chkCopyOnCapture.checked }));
  
  elements.btnOpenSelected?.addEventListener('click', () => {
    chrome.storage.local.get(['captured_screenshots'], (d) => {
      const imgs = d.captured_screenshots || [];
      selectedScreenshots.forEach(idx => {
        const img = imgs[idx];
        if (img) chrome.tabs.create({ url: `screenshot-editor.html?ts=${img.timestamp}` });
      });
      selectedScreenshots.clear();
      renderGallery();
    });
  });

  elements.btnDeleteSelected?.addEventListener('click', () => {
    if (!confirm(`Delete ${selectedScreenshots.size} image(s)?`)) return;
    chrome.storage.local.get(['captured_screenshots'], (d) => {
      let imgs = d.captured_screenshots || [];
      const indices = Array.from(selectedScreenshots).sort((a,b) => b - a);
      indices.forEach(idx => imgs.splice(idx, 1));
      
      chrome.storage.local.set({ 'captured_screenshots': imgs }, () => {
        selectedScreenshots.clear();
        renderGallery();
      });
    });
  });

  elements.chkAlwaysTrim?.addEventListener('change', async () => { await chrome.storage.sync.set({ alwaysTrimWhitespace: elements.chkAlwaysTrim.checked }); sendTabMessage({ type: 'toggleAlwaysTrim', enabled: elements.chkAlwaysTrim.checked }); });
  
  elements.addClipboardBtn?.addEventListener('click', addClipboardValue);

  const params = new URLSearchParams(window.location.search);
  const isPoppedOut = params.has('tab');
  const isFullWindow = params.get('full') === '1';
  if (isPoppedOut) {
    if (elements.globalPopOutBtn) elements.globalPopOutBtn.style.display = 'none';
    if (isFullWindow && elements.globalPopOutTabBtn) elements.globalPopOutTabBtn.style.display = 'none';
    if (elements.btnCapture) elements.btnCapture.style.display = 'none';
  }
  if (isPoppedOut || isFullWindow) {
    document.body.classList.add('popped-tab');
  }
  if (isFullWindow && elements.backToPopupBtn) {
    elements.backToPopupBtn.style.display = 'inline-flex';
  }

  elements.backToPopupBtn?.addEventListener('click', async () => {
    const activeTab = document.querySelector('.tab-btn.active')?.dataset.tab || 'overlay';
    const POPUP_W = 665;
    const POPUP_H = 645;
    const RIGHT_INSET = 290;
    const toolbarH = Math.max(0, window.outerHeight - window.innerHeight);
    const left = Math.round(Math.max(window.screenX, window.screenX + window.outerWidth - POPUP_W - RIGHT_INSET));
    const top = Math.round(window.screenY + toolbarH);
    try {
      await chrome.windows.create({
        url: chrome.runtime.getURL(`popup.html?tab=${activeTab}`),
        type: 'popup',
        width: POPUP_W,
        height: POPUP_H,
        left: left,
        top: top
      });
      const tab = await chrome.tabs.getCurrent();
      if (tab?.id) chrome.tabs.remove(tab.id);
    } catch (e) {}
  });
  
  elements.globalPopOutBtn?.addEventListener('click', () => {
    const activeTab = document.querySelector('.tab-btn.active')?.dataset.tab || 'overlay';
    
    chrome.windows.create({
      url: chrome.runtime.getURL(`popup.html?tab=${activeTab}`),
      type: 'popup',
      width: window.outerWidth || 650,
      height: window.outerHeight || 700,
      left: window.screenX,
      top: window.screenY
    });
    window.close();
  });

  elements.globalPopOutTabBtn?.addEventListener('click', async () => {
    const activeTab = document.querySelector('.tab-btn.active')?.dataset.tab || 'overlay';
    const url = chrome.runtime.getURL(`popup.html?tab=${activeTab}&full=1`);
    try {
      const wins = await chrome.windows.getAll({ windowTypes: ['normal'] });
      const target = wins.find(w => w.focused) || wins[0];
      if (target) {
        await chrome.tabs.create({ url, windowId: target.id, active: true });
        chrome.windows.update(target.id, { focused: true });
      } else {
        await chrome.windows.create({ url });
      }
    } catch (e) {
      chrome.tabs.create({ url });
    }
    window.close();
  });
}

document.addEventListener('DOMContentLoaded', async () => { new TabManager(); new DarkModeManager(); cacheElements(); setupEventListeners(); await initializePopup(); initScreenshotTool(); });