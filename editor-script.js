document.addEventListener('DOMContentLoaded', () => {
  // --- VARIABLES ---
  const editor = document.getElementById('editor');
  const lineNumbers = document.getElementById('lineNumbers');
  const noteList = document.getElementById('noteList');
  const newNoteBtn = document.getElementById('newNoteBtn');
  const deleteNoteBtn = document.getElementById('deleteNoteBtn');
  const darkToggle = document.getElementById('darkModeToggle');
  const lineNumbersToggle = document.getElementById('lineNumbersToggle');
  const textSizeSelect = document.getElementById('textSize');
  const saveAsButton = document.getElementById('saveAsButton');
  
  let currentNote = null;
  let saveTimeout;

  const STORAGE_KEYS = {
    NOTES_LIST: 'helpdesk_toolkit_notesList',
    NAME_LOCKED: 'helpdesk_toolkit_nameLocked',
    DARK_MODE: 'helpdesk_toolkit_globalDarkMode',
    LINE_NUMBERS: 'helpdesk_toolkit_lineNumbers',
    TEXT_SIZE: 'helpdesk_toolkit_textSize'
  };

  // --- HELPERS ---
  // Matches deriveName in textEditor.js — both editors share the same
  // stored notes, so the naming rule must be identical or names would
  // flip back and forth depending on which editor last saved.
  const deriveName = (content) => {
    const t = content.trim();
    if (!t) return null;
    let name = t.split('\n')[0].replace(/\s+/g, ' ').trim();
    if (name.length > 200) name = name.substring(0, 200);
    return name || null;
  };
  const loadLockedNames = (cb) =>
    chrome.storage.local.get(STORAGE_KEYS.NAME_LOCKED, (d) => cb(d[STORAGE_KEYS.NAME_LOCKED] || []));
  const saveLockedNames = (list) =>
    chrome.storage.local.set({ [STORAGE_KEYS.NAME_LOCKED]: list });

  // --- EDITOR LOGIC ---

  const debouncedSave = () => {
    clearTimeout(saveTimeout);
    if (!currentNote) return;
    saveTimeout = setTimeout(() => {
      const content = editor.value;
      loadLockedNames(locked => {
        if (locked.includes(currentNote)) {
          chrome.storage.local.set({ [`helpdesk_toolkit_note_${currentNote}`]: content });
          return;
        }
        const derived = deriveName(content);
        if (!derived || derived === currentNote) {
          chrome.storage.local.set({ [`helpdesk_toolkit_note_${currentNote}`]: content });
          return;
        }
        loadNotesList(notes => {
          let finalName = derived, counter = 1;
          while (notes.includes(finalName) && finalName !== currentNote) {
            finalName = `${derived} (${counter++})`;
          }
          const oldName = currentNote;
          const updated = notes.map(n => (n === oldName ? finalName : n));
          chrome.storage.local.remove(`helpdesk_toolkit_note_${oldName}`);
          chrome.storage.local.set({ [`helpdesk_toolkit_note_${finalName}`]: content }, () => {
            saveNotesList(updated);
            currentNote = finalName;
            renderNoteList(updated);
          });
        });
      });
    }, 500);
  };

  const saveNotesList = (list) => {
    chrome.storage.local.set({ [STORAGE_KEYS.NOTES_LIST]: list });
  };

  const loadNotesList = (callback) => {
    chrome.storage.local.get(STORAGE_KEYS.NOTES_LIST, (data) => {
      const notes = data[STORAGE_KEYS.NOTES_LIST] || [];
      callback(notes);
    });
  };

  let draggedNoteIndex = null;

  const reorderNotes = (from, to) => {
    loadNotesList(notes => {
      const next = [...notes];
      const [moved] = next.splice(from, 1);
      if (from < to) to--;
      next.splice(to, 0, moved);
      saveNotesList(next);
      renderNoteList(next);
    });
  };

  const renderNoteList = (notes) => {
    noteList.innerHTML = '';
    notes.forEach((note, index) => {
      const li = document.createElement('li');
      li.className = note === currentNote ? 'active' : '';
      li.draggable = true;

      const handle = document.createElement('span');
      handle.className = 'note-handle';
      handle.textContent = '⋮⋮';
      handle.title = 'Drag to reorder';

      const nameSpan = document.createElement('span');
      nameSpan.className = 'note-name';
      nameSpan.textContent = note;
      nameSpan.title = note;

      const pencil = document.createElement('span');
      pencil.className = 'note-edit';
      pencil.textContent = '✏️';
      pencil.title = 'Rename this note';

      li.appendChild(handle);
      li.appendChild(nameSpan);
      li.appendChild(pencil);

      li.addEventListener('click', (e) => {
        if (e.target === pencil || e.target === handle || li.querySelector('input')) return;
        loadNote(note);
      });
      pencil.addEventListener('click', (e) => {
        e.stopPropagation();
        startInlineRename(li, nameSpan, note);
      });

      li.addEventListener('dragstart', (e) => {
        if (li.querySelector('input')) { e.preventDefault(); return; }
        draggedNoteIndex = index;
        e.dataTransfer.effectAllowed = 'move';
        setTimeout(() => li.style.opacity = '0.4', 0);
      });
      li.addEventListener('dragend', () => {
        li.style.opacity = '1';
        draggedNoteIndex = null;
        noteList.querySelectorAll('li').forEach(el => { el.style.borderTop = ''; el.style.borderBottom = ''; });
      });
      li.addEventListener('dragover', (e) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        const b = li.getBoundingClientRect();
        const mid = b.y + b.height / 2;
        if (e.clientY - mid > 0) { li.style.borderBottom = '2px solid var(--button-active)'; li.style.borderTop = ''; }
        else { li.style.borderTop = '2px solid var(--button-active)'; li.style.borderBottom = ''; }
      });
      li.addEventListener('dragleave', () => { li.style.borderTop = ''; li.style.borderBottom = ''; });
      li.addEventListener('drop', (e) => {
        e.preventDefault();
        li.style.borderTop = ''; li.style.borderBottom = '';
        if (draggedNoteIndex === null || draggedNoteIndex === index) return;
        const b = li.getBoundingClientRect();
        const mid = b.y + b.height / 2;
        let insertIndex = index;
        if (e.clientY - mid > 0) insertIndex++;
        reorderNotes(draggedNoteIndex, insertIndex);
      });

      noteList.appendChild(li);
    });
  };

  const startInlineRename = (li, nameSpan, note) => {
    if (li.querySelector('input')) return;
    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'note-rename-input';
    input.value = note;
    nameSpan.replaceWith(input);
    input.focus();
    input.select();

    let finished = false;
    const commit = () => {
      if (finished) return;
      finished = true;
      commitRename(note, input.value, () => loadNotesList(renderNoteList));
    };
    const cancel = () => {
      if (finished) return;
      finished = true;
      loadNotesList(renderNoteList);
    };
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); commit(); }
      else if (e.key === 'Escape') { e.preventDefault(); cancel(); }
    });
    input.addEventListener('blur', commit);
    input.addEventListener('click', (e) => e.stopPropagation());
  };

  const commitRename = (oldName, newNameRaw, done) => {
    const newName = (newNameRaw || '').trim();
    if (!newName || newName === oldName) { if (done) done(); return; }
    loadNotesList(notes => {
      if (notes.includes(newName)) { alert('A note with that name already exists.'); if (done) done(); return; }
      const oldKey = `helpdesk_toolkit_note_${oldName}`;
      const newKey = `helpdesk_toolkit_note_${newName}`;
      chrome.storage.local.get(oldKey, (data) => {
        chrome.storage.local.set({ [newKey]: data[oldKey] || '' }, () => {
          chrome.storage.local.remove(oldKey);
          const updated = notes.map(n => (n === oldName ? newName : n));
          saveNotesList(updated);
          loadLockedNames(locked => {
            const next = locked.filter(n => n !== oldName);
            if (!next.includes(newName)) next.push(newName);
            saveLockedNames(next);
            if (currentNote === oldName) currentNote = newName;
            if (done) done();
          });
        });
      });
    });
  };

  const loadNote = (noteName) => {
    const key = `helpdesk_toolkit_note_${noteName}`;
    chrome.storage.local.get(key, (data) => {
      editor.value = data[key] || '';
      currentNote = noteName;
      updateLineNumbers();
      updateButtonStates();
      loadNotesList(renderNoteList);
    });
  };

  const updateButtonStates = () => {
    deleteNoteBtn.disabled = !currentNote;
  };

  const newNote = () => {
    loadNotesList(notes => {
      let name = 'Untitled', counter = 1;
      while (notes.includes(name)) name = `Untitled (${counter++})`;
      notes.push(name);
      saveNotesList(notes);
      chrome.storage.local.set({ [`helpdesk_toolkit_note_${name}`]: '' }, () => {
        currentNote = name;
        editor.value = '';
        updateLineNumbers();
        updateButtonStates();
        renderNoteList(notes);
        editor.focus();
      });
    });
  };

  const updateLineNumbers = () => {
    if (!lineNumbersToggle.checked) return;
    const lines = editor.value.split('\n').length;
    lineNumbers.textContent = Array.from({length: lines}, (_, i) => i + 1).join('\n');
  };

  const toggleLineNumbers = (show) => {
    if (show) {
      lineNumbers.classList.add('visible');
      updateLineNumbers();
    } else {
      lineNumbers.classList.remove('visible');
    }
  };

  const deleteNote = () => {
    if (!currentNote) return;
    // Skip confirmation for empty notes; only confirm when there's content to lose
    const hasContent = editor.value.trim() !== '';
    if (hasContent && !confirm(`Delete ${currentNote}?`)) return;
    loadNotesList(notes => {
      const removedName = currentNote;
      const updated = notes.filter(n => n !== removedName);
      chrome.storage.local.remove(`helpdesk_toolkit_note_${removedName}`);
      saveNotesList(updated);
      loadLockedNames(locked => saveLockedNames(locked.filter(n => n !== removedName)));
      currentNote = null;
      editor.value = '';
      if (updated.length > 0) loadNote(updated[0]);
      else newNote(); // always keep at least one note
    });
  };

  // --- INITIALIZATION ---
  newNoteBtn.addEventListener('click', newNote);
  deleteNoteBtn.addEventListener('click', deleteNote);

  // Toggle this standalone editor back into the full toolkit tab (Notes tab).
  // Same-tab navigation so it behaves like a mode switch, not a new window.
  document.getElementById('backToToolkitBtn')?.addEventListener('click', () => {
    window.location.href = chrome.runtime.getURL('popup.html?tab=text-editor&full=1');
  });

  // Add the selected text (or the whole note) to Saved Clipboard Values.
  // background.js watches that key and rebuilds the right-click Paste Saved menu.
  const saveToClipboardBtn = document.getElementById('saveToClipboardBtn');
  saveToClipboardBtn?.addEventListener('click', async () => {
    const ORIG = '📋 Save to Clipboard';
    const flash = (msg) => {
      saveToClipboardBtn.textContent = msg;
      setTimeout(() => { saveToClipboardBtn.textContent = ORIG; }, 2000);
    };
    const sel = editor.value.substring(editor.selectionStart, editor.selectionEnd);
    const val = (sel || editor.value).trim();
    if (!val) { flash('⚠️ Nothing to save'); return; }
    try {
      const data = await chrome.storage.sync.get(['savedClipboardValues']);
      const list = data.savedClipboardValues || [];
      if (list.includes(val)) { flash('✔ Already saved'); return; }
      list.push(val);
      await chrome.storage.sync.set({ savedClipboardValues: list });
      flash('✅ Saved!');
    } catch (e) {
      // storage.sync caps the whole saved-values list at ~8 KB
      alert('Could not save: the synced clipboard list is limited to roughly 8 KB in total. Try saving a shorter selection, or remove some saved values first.');
    }
  });
  
  editor.addEventListener('input', () => { debouncedSave(); updateLineNumbers(); });
  editor.addEventListener('scroll', () => { if(lineNumbersToggle.checked) lineNumbers.scrollTop = editor.scrollTop; });
  
  saveAsButton.addEventListener('click', () => {
    const blob = new Blob([editor.value], { type: 'text/plain' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${currentNote || 'note'}.txt`;
    a.click();
  });

  // Settings Events
  darkToggle.addEventListener('change', () => {
    document.body.classList.toggle('dark', darkToggle.checked);
    chrome.storage.local.set({ [STORAGE_KEYS.DARK_MODE]: darkToggle.checked });
  });

  lineNumbersToggle.addEventListener('change', () => {
    toggleLineNumbers(lineNumbersToggle.checked);
    chrome.storage.local.set({ [STORAGE_KEYS.LINE_NUMBERS]: lineNumbersToggle.checked });
  });

  textSizeSelect.addEventListener('input', () => {
    // Apply to BOTH columns — the shared unitless line-height in CSS
    // then keeps gutter rows locked to text rows at any size.
    editor.style.fontSize = `${textSizeSelect.value}px`;
    lineNumbers.style.fontSize = `${textSizeSelect.value}px`;
    chrome.storage.local.set({ [STORAGE_KEYS.TEXT_SIZE]: textSizeSelect.value });
  });

  // Init Settings
  chrome.storage.local.get([STORAGE_KEYS.DARK_MODE, STORAGE_KEYS.LINE_NUMBERS, STORAGE_KEYS.TEXT_SIZE], (data) => {
    const isDark = data[STORAGE_KEYS.DARK_MODE] !== false; // dark by default; explicit false = light
    darkToggle.checked = isDark;
    document.body.classList.toggle('dark', isDark);
    if (data[STORAGE_KEYS.LINE_NUMBERS]) {
      lineNumbersToggle.checked = true;
      toggleLineNumbers(true);
    }
    if (data[STORAGE_KEYS.TEXT_SIZE]) {
      textSizeSelect.value = data[STORAGE_KEYS.TEXT_SIZE];
      editor.style.fontSize = `${data[STORAGE_KEYS.TEXT_SIZE]}px`;
      lineNumbers.style.fontSize = `${data[STORAGE_KEYS.TEXT_SIZE]}px`;
    }
  });

  // Load Initial Data
  loadNotesList(notes => {
    // Migrate legacy "New Text Entry" ghost notes from older versions
    const clean = notes.filter(n => !n.startsWith('New Text Entry'));
    if (clean.length !== notes.length) {
      notes.filter(n => n.startsWith('New Text Entry')).forEach(g =>
        chrome.storage.local.remove(`helpdesk_toolkit_note_${g}`));
      saveNotesList(clean);
    }
    if (clean.length > 0) {
      loadNote(clean[0]);
    } else {
      updateButtonStates(); // nothing to edit yet -> grey out rename/delete
      renderNoteList(clean);
    }
  });
});