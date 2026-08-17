// --- CLIPBOARD MANAGER ---
class ClipboardManager {
  constructor() {
    this.trimEnabled = false;
    this.handleCopy = this.handleCopy.bind(this);
    this.init();
  }
  async init() {
    const data = await chrome.storage.sync.get(['alwaysTrimWhitespace']);
    this.trimEnabled = data.alwaysTrimWhitespace || false;
    document.addEventListener('copy', this.handleCopy);
  }
  updateSettings(enabled) { this.trimEnabled = enabled; }
  handleCopy(e) {
    if (!this.trimEnabled) return;
    const sel = window.getSelection(); if (!sel.rangeCount) return;
    const text = sel.toString(); if (!text) return;
    const trimmed = text.trim();
    if (text !== trimmed) { e.clipboardData.setData('text/plain', trimmed); e.preventDefault(); }
  }
}

// --- OVERLAY MANAGER ---
class OverlayManager {
  constructor() { this.overlay = null; this.dragOffset = { x: 0, y: 0 }; this.isDragging = false; this.rafId = null; this.currentRotation = 0; this.onDrag = this.onDrag.bind(this); this.onStopDrag = this.onStopDrag.bind(this); }
  create(text, alpha, position, fontSize, customX, customY, allowDrag = true, fontFamily = 'Arial', color = '#AAA', rotation = 0) {
    this.remove(); this.overlay = document.createElement('div'); this.overlay.textContent = text; this.currentRotation = rotation;
    Object.assign(this.overlay.style, { position: 'fixed', fontSize: `${fontSize || 10}vw`, fontWeight: 'bold', fontFamily: fontFamily, color: color, opacity: alpha, zIndex: '999999', pointerEvents: allowDrag ? 'auto' : 'none', userSelect: 'none', transform: `rotate(${this.currentRotation}deg)`, cursor: allowDrag ? 'move' : 'default', willChange: allowDrag ? 'transform' : 'auto', textShadow: '2px 2px 4px rgba(0,0,0,0.3)', transition: 'transform 0.1s cubic-bezier(0.4, 0.0, 0.2, 1), opacity 0.2s ease' });
    this.setPosition(position, customX, customY); if (allowDrag) this.enableDragging(); document.body.appendChild(this.overlay);
  }
  setPosition(position, customX, customY) { if (customX !== undefined && customY !== undefined) { this.overlay.style.left = `${customX}px`; this.overlay.style.top = `${customY}px`; } else { Object.assign(this.overlay.style, { bottom: '5%', right: '5%' }); } }
  enableDragging() { this.overlay.addEventListener('mousedown', this.onStartDrag.bind(this), { passive: false }); }
  onStartDrag(e) { e.preventDefault(); this.isDragging = true; this.dragOffset = { x: e.clientX - this.overlay.offsetLeft, y: e.clientY - this.overlay.offsetTop }; this.overlay.style.transition = 'opacity 0.2s ease'; document.addEventListener('mousemove', this.onDrag); document.addEventListener('mouseup', this.onStopDrag); document.body.style.userSelect = 'none'; }
  onDrag(e) { if (!this.isDragging || !this.overlay) return; if (this.rafId) cancelAnimationFrame(this.rafId); this.rafId = requestAnimationFrame(() => { if (this.overlay) { this.overlay.style.left = `${e.clientX - this.dragOffset.x}px`; this.overlay.style.top = `${e.clientY - this.dragOffset.y}px`; this.overlay.style.right = 'auto'; this.overlay.style.bottom = 'auto'; this.overlay.style.transform = `rotate(${this.currentRotation}deg)`; } }); }
  onStopDrag() { if (!this.isDragging) return; this.isDragging = false; document.body.style.userSelect = ''; if (this.overlay) { this.overlay.style.transition = 'transform 0.1s cubic-bezier(0.4, 0.0, 0.2, 1), opacity 0.2s ease'; chrome.storage.sync.set({ overlayCustomX: this.overlay.offsetLeft, overlayCustomY: this.overlay.offsetTop }); } document.removeEventListener('mousemove', this.onDrag); document.removeEventListener('mouseup', this.onStopDrag); if (this.rafId) { cancelAnimationFrame(this.rafId); this.rafId = null; } }
  updateAlpha(alpha) { if (this.overlay) this.overlay.style.opacity = alpha; }
  updateSize(size) { if (this.overlay) this.overlay.style.fontSize = `${size}vw`; }
  updateFont(fontFamily) { if (this.overlay) this.overlay.style.fontFamily = fontFamily; }
  updateColor(color) { if (this.overlay) this.overlay.style.color = color; }
  updateRotation(rotation) { if (this.overlay) { this.currentRotation = rotation; requestAnimationFrame(() => { if (this.overlay) this.overlay.style.transform = `rotate(${rotation}deg)`; }); } }
  updateDragState(allowDrag) { if (this.overlay) { this.overlay.style.pointerEvents = allowDrag ? 'auto' : 'none'; this.overlay.style.cursor = allowDrag ? 'move' : 'default'; this.overlay.style.willChange = allowDrag ? 'transform' : 'auto'; } }
  remove() { if (this.overlay) { if (this.rafId) { cancelAnimationFrame(this.rafId); this.rafId = null; } document.removeEventListener('mousemove', this.onDrag); document.removeEventListener('mouseup', this.onStopDrag); this.overlay.remove(); this.overlay = null; this.isDragging = false; } }
  exists() { return !!this.overlay; }
}

// --- SNIP MANAGER ---
class SnipManager {
  constructor() { 
    this.isSnipping = false; 
    this.startX = 0; 
    this.startY = 0; 
    this.frozenBg = null; 
    this.overlay = null; 
    this.selectionBox = null; 
    this.onMouseDown = this.onMouseDown.bind(this); 
    this.onMouseMove = this.onMouseMove.bind(this); 
    this.onMouseUp = this.onMouseUp.bind(this); 
    this.onKeyDown = this.onKeyDown.bind(this); 
  }
  
  async start() { 
    if (this.isSnipping) return; 
    this.isSnipping = true; 

    const data = await chrome.storage.local.get(['temp_snip_image']);
    const frozenImgUrl = data.temp_snip_image;

    this.frozenBg = document.createElement('div');
    Object.assign(this.frozenBg.style, {
      position: 'fixed', top: '0', left: '0', width: '100vw', height: '100vh',
      backgroundImage: `url(${frozenImgUrl})`, backgroundSize: '100% 100%',
      zIndex: '2147483646', pointerEvents: 'none' 
    });

    this.overlay = document.createElement('div'); 
    Object.assign(this.overlay.style, { 
      position: 'fixed', top: '0', left: '0', width: '100%', height: '100%', 
      backgroundColor: 'rgba(0, 0, 0, 0.3)', cursor: 'crosshair', zIndex: '2147483647' 
    }); 
    
    this.selectionBox = document.createElement('div'); 
    Object.assign(this.selectionBox.style, { 
      position: 'fixed', border: '2px solid #00ff00', backgroundColor: 'rgba(0, 255, 0, 0.1)', 
      display: 'none', pointerEvents: 'none', zIndex: '2147483648' 
    }); 
    
    document.body.appendChild(this.frozenBg);
    document.body.appendChild(this.overlay); 
    document.body.appendChild(this.selectionBox); 
    
    this.overlay.addEventListener('mousedown', this.onMouseDown); 
    document.addEventListener('keydown', this.onKeyDown); 
  }

  onMouseDown(e) { this.startX = e.clientX; this.startY = e.clientY; this.selectionBox.style.left = `${this.startX}px`; this.selectionBox.style.top = `${this.startY}px`; this.selectionBox.style.width = '0px'; this.selectionBox.style.height = '0px'; this.selectionBox.style.display = 'block'; document.addEventListener('mousemove', this.onMouseMove); document.addEventListener('mouseup', this.onMouseUp); }
  
  onMouseMove(e) { const width = Math.abs(e.clientX - this.startX); const height = Math.abs(e.clientY - this.startY); this.selectionBox.style.width = `${width}px`; this.selectionBox.style.height = `${height}px`; this.selectionBox.style.left = `${Math.min(e.clientX, this.startX)}px`; this.selectionBox.style.top = `${Math.min(e.clientY, this.startY)}px`; }
  
  onMouseUp(e) { 
    document.removeEventListener('mousemove', this.onMouseMove); 
    document.removeEventListener('mouseup', this.onMouseUp); 
    const rect = this.selectionBox.getBoundingClientRect(); 
    this.stop(); 
    if (rect.width < 5 || rect.height < 5) return; 
    
    chrome.runtime.sendMessage({ 
      type: 'CROP_SCREENSHOT', 
      cropData: { x: rect.left, y: rect.top, width: rect.width, height: rect.height, devicePixelRatio: window.devicePixelRatio || 1, viewportWidth: window.innerWidth, viewportHeight: window.innerHeight } 
    }); 
  }
  
  onKeyDown(e) { if (e.key === 'Escape') this.stop(); }
  
  stop() { 
    this.isSnipping = false; 
    if (this.frozenBg) this.frozenBg.remove();
    if (this.overlay) this.overlay.remove(); 
    if (this.selectionBox) this.selectionBox.remove(); 
    document.removeEventListener('keydown', this.onKeyDown); 
  }
}

const overlayManager = new OverlayManager();
const snipManager = new SnipManager();
const clipboardManager = new ClipboardManager();

function determineOverlayText(host, data) {
  if (host.includes('sb1.app.netsuite.com')) return data.labelSB1 || 'SB1';
  if (host.includes('sb2.app.netsuite.com')) return data.labelSB2 || 'SB2';
  const customs = data.customOverlays || [];
  for (const item of customs) { const cleanInput = item.url.replace(/^https?:\/\//, '').replace(/\/$/, ''); if (host.includes(cleanInput)) return item.text; }
  return null;
}

async function initOverlay() {
  const host = window.location.host;
  try {
    const data = await chrome.storage.sync.get(['showOverlay', 'overlayAlpha', 'overlayPosition', 'overlaySize', 'overlayCustomX', 'overlayCustomY', 'allowDrag', 'overlayFont', 'overlayColor', 'overlayRotation', 'labelSB1', 'labelSB2', 'customOverlays']);
    const overlayText = determineOverlayText(host, data);
    if (data.showOverlay && overlayText) {
      overlayManager.create(overlayText, data.overlayAlpha || 0.3, data.overlayPosition || 'bottom-right', data.overlaySize || 10, data.overlayCustomX, data.overlayCustomY, data.allowDrag !== false, data.overlayFont || 'Arial', data.overlayColor || '#AAA', data.overlayRotation !== undefined ? data.overlayRotation : 0);
    }
  } catch (error) { console.error('Error initializing overlay:', error); }
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'START_SNIP') { snipManager.start(); return; }
  if (message.type === 'toggleAlwaysTrim') { clipboardManager.updateSettings(message.enabled); return; }
  
  if (message.type === 'PASTE_TEXT') {
    const activeElement = document.activeElement;
    if (activeElement) {
      activeElement.focus();
      if (activeElement.tagName === 'INPUT' || activeElement.tagName === 'TEXTAREA') {
        try {
          const start = activeElement.selectionStart || 0;
          const end = activeElement.selectionEnd || 0;
          const text = activeElement.value;
          activeElement.value = text.slice(0, start) + message.text + text.slice(end);
          activeElement.selectionStart = activeElement.selectionEnd = start + message.text.length;
        } catch (e) {
          activeElement.value += message.text;
        }
        activeElement.dispatchEvent(new Event('input', { bubbles: true }));
        activeElement.dispatchEvent(new Event('change', { bubbles: true }));
      } else {
        document.execCommand('insertText', false, message.text);
      }
    }
    return;
  }

  if (message.type === 'refreshOverlay') { overlayManager.remove(); initOverlay(); return; }
  if (!overlayManager.exists()) { if (message.type === 'toggleOverlay') initOverlay(); return; }

  switch (message.type) {
    case 'toggleOverlay': overlayManager.remove(); initOverlay(); break;
    case 'updateOverlayAlpha': overlayManager.updateAlpha(message.alpha); break;
    case 'updateOverlayPosition': chrome.storage.sync.remove(['overlayCustomX', 'overlayCustomY'], () => initOverlay()); break;
    case 'updateOverlaySize': overlayManager.updateSize(message.size); break;
    case 'updateOverlayFont': overlayManager.updateFont(message.font); break;
    case 'updateOverlayColor': overlayManager.updateColor(message.color); break;
    case 'updateOverlayRotation': overlayManager.updateRotation(message.rotation); break;
    case 'toggleDrag': if (message.enabled !== undefined) chrome.storage.sync.set({ allowDrag: message.enabled }, () => { overlayManager.updateDragState(message.enabled); if (message.enabled) { overlayManager.remove(); initOverlay(); } }); break;
  }
});

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initOverlay);
else initOverlay();
window.addEventListener('beforeunload', () => overlayManager.remove());