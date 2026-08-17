const canvas = document.getElementById('canvas');
const ctx = canvas.getContext('2d');
const btnSquare = document.getElementById('btnSquare');
const btnArrow = document.getElementById('btnArrow');
const btnText = document.getElementById('btnText'); 
const btnUndo = document.getElementById('btnUndo');
const btnClear = document.getElementById('btnClear');
const colorPicker = document.getElementById('colorPicker');
const sizeSlider = document.getElementById('sizeSlider');
const btnCopy = document.getElementById('btnCopy');
const btnDownload = document.getElementById('btnDownload');
const btnViewGallery = document.getElementById('btnViewGallery');
const btnSave = document.getElementById('btnSave'); 
const galleryStatus = document.getElementById('galleryStatus'); 

let currentTool = 'square';
let isDrawing = false;
let textInputActive = false; 
let startX, startY;
let baseImage = new Image();
let historyStack = [];

// Track the specific gallery item we are editing
let currentTimestamp = null; 

// Clipboard status chip (separate from the gallery chip)
const clipStatus = document.getElementById('clipStatus');

// What the clipboard currently holds, so the clipboard chip can truthfully
// say whether the CURRENT canvas state has been copied. Any new drawing
// makes the canvas differ from this, flipping the chip back to "Not copied".
let lastCopiedDataUrl = null;

// True while the clipboard chip shows a transient warning (auto-copy blocked)
let clipNotice = false;

function updateClipStatus(currentImage) {
  if (!clipStatus || clipNotice) return;
  if (lastCopiedDataUrl && lastCopiedDataUrl === currentImage) {
    clipStatus.innerHTML = '📋 <span style="color: #10b981; font-weight: 500; margin-left: 4px;">Copied</span>';
  } else {
    clipStatus.innerHTML = '📋 <span style="color: #9ca3af; margin-left: 4px;">Not copied</span>';
  }
}

// Live Indicator logic — gallery chip and clipboard chip are independent
function updateIndicator() {
  const currentImage = canvas.toDataURL();
  updateClipStatus(currentImage);
  chrome.storage.local.get(['captured_screenshots'], (result) => {
    const images = result.captured_screenshots || [];
    const isSaved = images.some(img => img.dataUrl === currentImage);

    if (isSaved) {
      galleryStatus.innerHTML = '🟢 <span style="color: #10b981; font-weight: 500; margin-left: 4px;">In Gallery</span>';
      btnSave.style.opacity = '0.5';
      btnSave.style.pointerEvents = 'none';
    } else {
      galleryStatus.innerHTML = '⚪ <span style="color: #9ca3af; margin-left: 4px;">Unsaved Changes</span>';
      btnSave.style.opacity = '1';
      btnSave.style.pointerEvents = 'auto';
    }
  });
}

// 1. Load the image from storage
const urlParams = new URLSearchParams(window.location.search);
const viewTs = urlParams.get('ts');

if (viewTs) {
  currentTimestamp = parseInt(viewTs); // Capture the timestamp we are editing
  const isFreshCapture = urlParams.get('fresh') === '1';
  chrome.storage.local.get(['captured_screenshots', 'copy_on_capture'], (data) => {
    const imgs = data.captured_screenshots || [];
    const target = imgs.find(img => img.timestamp === currentTimestamp);
    if (target) {
      // Fresh full-screen capture honors copy-on-capture; reopening a gallery image does not
      const autoCopy = isFreshCapture && data.copy_on_capture === true;
      initCanvasWithImage(target.dataUrl, null, false, autoCopy);
    }
  });
} else {
  chrome.storage.local.get(['current_edit_image', 'current_crop_data', 'snip_cache_enabled', 'copy_on_capture'], (data) => {
    if (data.current_edit_image) {
      initCanvasWithImage(data.current_edit_image, data.current_crop_data, data.snip_cache_enabled !== false, data.copy_on_capture === true);
    }
  });
}

function initCanvasWithImage(dataUrl, cropData, snipCacheEnabled, autoCopy = false) {
  const rawImage = new Image();
  rawImage.src = dataUrl;
  
  rawImage.onload = () => {
    if (cropData) {
      // Derive the REAL scale from the captured image vs the original viewport.
      // At fractional Windows scaling (e.g. 125%), devicePixelRatio rounds
      // imprecisely; using the actual captured pixel width is exact.
      const scale = cropData.viewportWidth
        ? rawImage.width / cropData.viewportWidth
        : (cropData.devicePixelRatio || 1);

      const sourceX = Math.round(cropData.x * scale);
      const sourceY = Math.round(cropData.y * scale);
      const sourceW = Math.round(cropData.width * scale);
      const sourceH = Math.round(cropData.height * scale);

      canvas.width = sourceW;
      canvas.height = sourceH;
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(rawImage, sourceX, sourceY, sourceW, sourceH, 0, 0, sourceW, sourceH);
      
      const croppedDataUrl = canvas.toDataURL();
      baseImage.src = croppedDataUrl;
      chrome.storage.local.remove('current_crop_data');

      if (snipCacheEnabled) {
        chrome.storage.local.get(['captured_screenshots'], (result) => {
          let images = result.captured_screenshots || [];
          currentTimestamp = Date.now(); // Track the new auto-saved image
          images.unshift({ timestamp: currentTimestamp, dataUrl: croppedDataUrl });
          if (images.length > 10) images = images.slice(0, 10);
          
          chrome.storage.local.set({ 'captured_screenshots': images }, () => {
            historyStack = [canvas.toDataURL()];
            updateIndicator(); 
          });
        });
      } else {
        historyStack = [canvas.toDataURL()];
        updateIndicator();
      }
    } else {
      baseImage = rawImage;
      canvas.width = baseImage.width;
      canvas.height = baseImage.height;
      ctx.drawImage(baseImage, 0, 0);
      
      const canvasUrl = canvas.toDataURL();
      historyStack = [canvasUrl];

      // If this image is tracked in the gallery, make the stored copy byte-match the
      // canvas export so "In Gallery" detects correctly (PNG re-encoding can differ).
      if (currentTimestamp != null) {
        chrome.storage.local.get(['captured_screenshots'], (result) => {
          const imgs = result.captured_screenshots || [];
          const idx = imgs.findIndex(img => img.timestamp === currentTimestamp);
          if (idx !== -1 && imgs[idx].dataUrl !== canvasUrl) {
            imgs[idx].dataUrl = canvasUrl;
            chrome.storage.local.set({ 'captured_screenshots': imgs }, () => updateIndicator());
          } else {
            updateIndicator();
          }
        });
      } else {
        updateIndicator();
      }
    }
    
    if (canvas.width > window.innerWidth - 80) {
      canvas.style.maxWidth = "100%";
      canvas.style.height = "auto";
    }

    if (autoCopy) copyCanvasToClipboard(true);
  };
}

// Copy the current canvas to the clipboard.
// `auto` = triggered by the "Copy image on capture" setting (only ever
// called when that setting is enabled) rather than the Copy button.
async function copyCanvasToClipboard(auto = false) {
  try {
    const blob = await new Promise(resolve => canvas.toBlob(resolve));
    await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
    lastCopiedDataUrl = canvas.toDataURL();
    clipNotice = false;
    updateClipStatus(lastCopiedDataUrl);
    if (btnCopy) {
      btnCopy.textContent = "✅ Copied!";
      setTimeout(() => { btnCopy.textContent = "📋 Copy"; }, 2000);
    }
    return true;
  } catch (err) {
    if (auto) {
      // Auto-copy can fail if the tab isn't focused; warn quietly on the clipboard chip
      if (clipStatus) {
        clipNotice = true;
        clipStatus.innerHTML = '⚠️ <span style="color:#f59e0b;margin-left:4px;">Auto-copy blocked — use 📋 Copy</span>';
        setTimeout(() => { clipNotice = false; updateIndicator(); }, 5000);
      }
    } else {
      alert("Copy failed: " + err);
    }
    return false;
  }
}

// 2. Tool Logic
function setTool(tool) {
  currentTool = tool;
  btnSquare.classList.toggle('active', tool === 'square');
  btnArrow.classList.toggle('active', tool === 'arrow');
  btnText.classList.toggle('active', tool === 'text');
}
btnSquare.addEventListener('click', () => setTool('square'));
btnArrow.addEventListener('click', () => setTool('arrow'));
btnText.addEventListener('click', () => setTool('text'));

// 3. Drawing Logic
function getPos(e) {
  const rect = canvas.getBoundingClientRect();
  const scaleX = canvas.width / rect.width;
  const scaleY = canvas.height / rect.height;
  return {
    x: (e.clientX - rect.left) * scaleX,
    y: (e.clientY - rect.top) * scaleY
  };
}

canvas.addEventListener('mousedown', (e) => {
  if (textInputActive) return; // Prevent drawing if currently typing
  isDrawing = true;
  const pos = getPos(e);
  startX = pos.x;
  startY = pos.y;
});

canvas.addEventListener('mousemove', (e) => {
  if (!isDrawing) return;
  const pos = getPos(e);
  
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(baseImage, 0, 0);
  
  ctx.beginPath();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  if (currentTool === 'text') {
    // Draw a dashed placeholder box for the text tool
    ctx.strokeStyle = '#3b82f6';
    ctx.lineWidth = 2;
    ctx.setLineDash([5, 5]);
    ctx.strokeRect(startX, startY, pos.x - startX, pos.y - startY);
    ctx.setLineDash([]);
  } else {
    // Standard drawing tools
    ctx.strokeStyle = colorPicker.value;
    ctx.lineWidth = sizeSlider.value;
    if (currentTool === 'square') {
      ctx.strokeRect(startX, startY, pos.x - startX, pos.y - startY);
    } else {
      drawArrow(ctx, startX, startY, pos.x, pos.y);
    }
    ctx.stroke();
  }
});

canvas.addEventListener('mouseup', (e) => {
  if (!isDrawing) return;
  isDrawing = false;
  
  if (currentTool === 'text') {
    const pos = getPos(e);
    // Re-render base image to clear the dashed placeholder box
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(baseImage, 0, 0);
    
    createTextOverlay(startX, startY, pos.x, pos.y);
    return; // Halt here until the user is done typing
  }
  
  const newState = canvas.toDataURL();
  historyStack.push(newState);
  
  const newImg = new Image();
  newImg.src = newState;
  newImg.onload = () => { 
    baseImage = newImg; 
    updateIndicator(); 
  };
});

// NEW: Text Tool Input Logic
function createTextOverlay(x1, y1, x2, y2) {
  textInputActive = true;
  
  const x = Math.min(x1, x2);
  const y = Math.min(y1, y2);
  const w = Math.max(Math.abs(x2 - x1), 100); 
  const h = Math.max(Math.abs(y2 - y1), 40);  

  const rect = canvas.getBoundingClientRect();
  const scaleX = rect.width / canvas.width;
  const scaleY = rect.height / canvas.height;

  const screenX = rect.left + (x * scaleX);
  const screenY = rect.top + (y * scaleY);
  const screenW = w * scaleX;
  const screenH = h * scaleY;

  const fontSize = parseInt(sizeSlider.value) * 4;

  const ta = document.createElement('textarea');
  ta.style.position = 'fixed';
  ta.style.left = screenX + 'px';
  ta.style.top = screenY + 'px';
  ta.style.width = screenW + 'px';
  ta.style.height = screenH + 'px';
  ta.style.background = 'transparent';
  ta.style.color = colorPicker.value;
  ta.style.fontSize = (fontSize * scaleY) + 'px';
  ta.style.fontFamily = 'Arial, sans-serif';
  ta.style.lineHeight = '1.2';
  ta.style.border = '1px dashed #fff';
  ta.style.boxShadow = '0 0 0 1px #000';
  ta.style.outline = 'none';
  ta.style.resize = 'none';
  ta.style.zIndex = '100000';
  ta.style.padding = '0px';
  ta.style.margin = '0px';
  ta.style.overflow = 'hidden';
  ta.style.whiteSpace = 'pre'; 

  document.body.appendChild(ta);
  ta.focus();

  ta.addEventListener('blur', () => {
     const text = ta.value;
     document.body.removeChild(ta);
     textInputActive = false;

     if (text.trim() !== '') {
        ctx.font = `${fontSize}px Arial, sans-serif`;
        ctx.fillStyle = colorPicker.value;
        ctx.textBaseline = 'top';

        const lines = text.split('\n');
        const lineHeight = fontSize * 1.2;

        lines.forEach((line, i) => {
           ctx.fillText(line, x, y + (i * lineHeight));
        });

        const newState = canvas.toDataURL();
        historyStack.push(newState);
        
        const newImg = new Image();
        newImg.src = newState;
        newImg.onload = () => { 
          baseImage = newImg; 
          updateIndicator(); 
        };
     }
  });
}

// 4. Undo / Clear
function restoreState(dataUrl) {
  const img = new Image();
  img.src = dataUrl;
  img.onload = () => {
    baseImage = img;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(baseImage, 0, 0);
    updateIndicator(); 
  };
}

btnUndo.addEventListener('click', () => {
  if (historyStack.length > 1) {
    historyStack.pop();
    const previousState = historyStack[historyStack.length - 1];
    restoreState(previousState);
  }
});

btnClear.addEventListener('click', () => {
  if (historyStack.length > 1) {
    const originalState = historyStack[0];
    historyStack = [originalState];
    restoreState(originalState);
  }
});

function drawArrow(ctx, fromx, fromy, tox, toy) {
  const headlen = parseInt(sizeSlider.value) * 4; 
  const dx = tox - fromx;
  const dy = toy - fromy;
  const angle = Math.atan2(dy, dx);
  ctx.moveTo(fromx, fromy);
  ctx.lineTo(tox, toy);
  ctx.lineTo(tox - headlen * Math.cos(angle - Math.PI / 6), toy - headlen * Math.sin(angle - Math.PI / 6));
  ctx.moveTo(tox, toy);
  ctx.lineTo(tox - headlen * Math.cos(angle + Math.PI / 6), toy - headlen * Math.sin(angle + Math.PI / 6));
}

// 5. Save Actions

// Save the current image to the gallery (updates the tracked entry, or creates one)
btnSave.addEventListener('click', () => {
  const currentImage = canvas.toDataURL();
  
  chrome.storage.local.get(['captured_screenshots'], (result) => {
    let images = result.captured_screenshots || [];
    
    if (currentTimestamp) {
      // Find the existing image and update it
      const index = images.findIndex(img => img.timestamp === currentTimestamp);
      if (index !== -1) {
        images[index].dataUrl = currentImage;
      } else {
        // Fallback: If not found, act as new
        currentTimestamp = Date.now();
        images.unshift({ timestamp: currentTimestamp, dataUrl: currentImage });
      }
    } else {
      // Brand new image
      currentTimestamp = Date.now();
      images.unshift({ timestamp: currentTimestamp, dataUrl: currentImage });
    }
    
    if (images.length > 10) images = images.slice(0, 10);
    
    chrome.storage.local.set({ 'captured_screenshots': images }, () => {
      updateIndicator(); 
      const originalText = btnSave.textContent;
      btnSave.textContent = "✅ Saved!";
      btnSave.style.background = "#10b981"; 
      setTimeout(() => {
        btnSave.textContent = originalText;
        btnSave.style.background = ""; 
      }, 2000);
    });
  });
});

btnDownload.addEventListener('click', () => {
  const link = document.createElement('a');
  link.download = `capture-${Date.now()}.png`;
  link.href = canvas.toDataURL();
  link.click();
});

btnCopy.addEventListener('click', () => copyCanvasToClipboard(false));

btnViewGallery?.addEventListener('click', () => {
  chrome.tabs.create({ url: chrome.runtime.getURL('popup.html?tab=screenshots&full=1') });
});