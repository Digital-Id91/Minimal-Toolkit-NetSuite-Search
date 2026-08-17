class TextEditor {
  constructor(container, options = {}) {
    this.container = container;
    this.options = {
      showSidebar: options.showSidebar !== false,
      showLineNumbers: options.showLineNumbers || false,
      darkMode: options.darkMode === true,
      fontSize: options.fontSize || 16,
      storagePrefix: options.storagePrefix || 'textEditor_',
      searchEnabled: options.searchEnabled !== false,
      ...options
    };
    this.currentNote = null;
    this.saveTimeout = null;
    this.draggedNoteIndex = null;
    this.DEBOUNCE_DELAY = 500;
    this.init();
  }
  init() {
    this.render();
    this.bindEvents();
    this.loadSettings();
    this.loadInitialData();
  }
  render() {
    const html = `
      <div class="text-editor-container ${this.options.darkMode ? 'text-editor-dark' : ''}">
        <div class="text-editor-main">
          <div class="text-editor-note-controls">
            <button id="textEditorNewNoteBtn" class="text-editor-new-note-btn" title="Create a new blank note">➕ New Note</button>
            <button id="textEditorDeleteNoteBtn" class="text-editor-delete-btn" title="Delete the current note">🗑️ Delete</button>
            <button id="textEditorSaveToClipBtn" title="Add this note (or just the selected text) to Saved Clipboard Values — usable anywhere via right-click → Paste Saved">📋 Save to Clipboard</button>
            ${this.options.showFullScreenButton !== false ? '<button id="textEditorOpenFullScreenBtn" class="text-editor-fullscreen-btn" title="Open editor in a full browser tab">⛶ Full Screen</button>' : ''}
          </div>
          <div class="text-editor-wrapper">
            <div class="text-editor-editor-container">
              <div id="textEditorLineNumbers" class="text-editor-line-numbers"></div>
              <textarea id="textEditorTextarea" placeholder="Enter your text here..."></textarea>
            </div>
            <div class="text-editor-bottom-controls">
              <div class="text-editor-settings">
                <div class="text-editor-font-size-control">
                  <label for="textEditorFontSize">Font Size:</label>
                  <input type="number" id="textEditorFontSize" min="12" max="72" value="${this.options.fontSize}" class="text-editor-font-size-input"/>
                  <span class="text-editor-font-size-unit">px</span>
                </div>
                <label class="text-editor-checkbox-label">
                  <input type="checkbox" id="textEditorLineNumbersToggle" ${this.options.showLineNumbers ? 'checked' : ''} />
                  <span class="text-editor-checkbox-text">Line Numbers</span>
                </label>
              </div>
            </div>
          </div>
        </div>
        ${this.options.showSidebar ? this.renderSidebar() : ''}
      </div>
    `;
    this.container.innerHTML = html;
  }
  renderSidebar() {
    return `
      <div class="text-editor-sidebar-header">
        <h2>Saved Notes</h2>
      </div>
      <div class="text-editor-sidebar">
        <ul id="textEditorNoteList"></ul>
      </div>
    `;
  }
  bindEvents() {
    this.editor = this.container.querySelector('#textEditorTextarea');
    this.lineNumbers = this.container.querySelector('#textEditorLineNumbers');
    this.editorContainer = this.container.querySelector('.text-editor-editor-container');
    this.noteList = this.container.querySelector('#textEditorNoteList');
    this.newNoteBtn = this.container.querySelector('#textEditorNewNoteBtn');
    this.deleteNoteBtn = this.container.querySelector('#textEditorDeleteNoteBtn');
    this.darkToggle = this.container.querySelector('#textEditorDarkModeToggle');
    this.lineNumbersToggle = this.container.querySelector('#textEditorLineNumbersToggle');
    this.textSizeSelect = this.container.querySelector('#textEditorFontSize');
    this.fullScreenButton = this.container.querySelector('#textEditorOpenFullScreenBtn');
    this.saveToClipBtn = this.container.querySelector('#textEditorSaveToClipBtn');

    this.newNoteBtn?.addEventListener('click', () => this.newNote());
    this.deleteNoteBtn?.addEventListener('click', () => this.deleteNote());
    this.editor.addEventListener('input', () => this.handleInput());
    this.editor.addEventListener('scroll', () => this.syncScroll());
    this.lineNumbersToggle?.addEventListener('change', () => this.toggleLineNumbers());
    this.textSizeSelect?.addEventListener('input', () => this.changeFontSize());
    this.fullScreenButton?.addEventListener('click', () => this.openFullScreen());
    this.saveToClipBtn?.addEventListener('click', () => this.saveToClipboardList());
  }
  handleInput() { this.debouncedSave(); this.updateLineNumbers(); }
  deriveName(content) {
    const t = content.trim();
    if (!t) return null;
    let name = t.split('\n')[0].replace(/\s+/g, ' ').trim();
    if (name.length > 200) name = name.substring(0, 200);
    return name;
  }
  loadLockedNames(cb) {
    chrome.storage.local.get(`${this.options.storagePrefix}nameLocked`, (d) =>
      cb(d[`${this.options.storagePrefix}nameLocked`] || []));
  }
  saveLockedNames(list) {
    chrome.storage.local.set({ [`${this.options.storagePrefix}nameLocked`]: list });
  }
  debouncedSave() {
    clearTimeout(this.saveTimeout);
    if (!this.currentNote) return;
    this.saveTimeout = setTimeout(() => {
      const content = this.editor.value;
      this.loadLockedNames(locked => {
        if (locked.includes(this.currentNote)) {
          chrome.storage.local.set({ [`${this.options.storagePrefix}note_${this.currentNote}`]: content });
          return;
        }
        const derived = this.deriveName(content);
        if (!derived || derived === this.currentNote) {
          chrome.storage.local.set({ [`${this.options.storagePrefix}note_${this.currentNote}`]: content });
          return;
        }
        this.loadNotesList(notes => {
          let finalName = derived, counter = 1;
          while (notes.includes(finalName) && finalName !== this.currentNote) {
            finalName = `${derived} (${counter++})`;
          }
          const oldName = this.currentNote;
          const updatedNotes = notes.map(n => (n === oldName ? finalName : n));
          chrome.storage.local.remove(`${this.options.storagePrefix}note_${oldName}`);
          chrome.storage.local.set({ [`${this.options.storagePrefix}note_${finalName}`]: content }, () => {
            this.saveNotesList(updatedNotes);
            this.currentNote = finalName;
            this.renderNoteList(updatedNotes);
          });
        });
      });
    }, this.DEBOUNCE_DELAY);
  }
  updateLineNumbers() {
    if (!this.lineNumbersToggle?.checked) return;
    const lines = this.editor.value.split('\n');
    let lineNumberText = '';
    for (let i = 1; i <= lines.length; i++) { lineNumberText += i + '\n'; }
    this.lineNumbers.textContent = lineNumberText;
  }
  toggleLineNumbers() {
    if (this.lineNumbersToggle.checked) {
      this.lineNumbers.classList.add('visible');
      this.editorContainer.classList.add('show-line-numbers');
      this.updateLineNumbers();
    } else {
      this.lineNumbers.classList.remove('visible');
      this.editorContainer.classList.remove('show-line-numbers');
    }
    this.saveSettings();
  }
  syncScroll() { if (this.lineNumbersToggle?.checked) this.lineNumbers.scrollTop = this.editor.scrollTop; }
  clearText() {
    this.editor.value = '';
    this.updateLineNumbers();
    if (this.currentNote) {
      const key = `${this.options.storagePrefix}note_${this.currentNote}`;
      chrome.storage.local.set({ [key]: '' });
    }
  }
  searchGoogle() {
    const text = this.editor.value.substring(this.editor.selectionStart, this.editor.selectionEnd) || this.editor.value;
    if (text.trim()) chrome.tabs.create({ url: `https://www.google.com/search?q=${encodeURIComponent(text.trim())}` });
  }
  async saveToClipboardList() {
    const btn = this.saveToClipBtn;
    const ORIG = '📋 Save to Clipboard';
    const flash = (msg) => {
      if (!btn) return;
      btn.textContent = msg;
      setTimeout(() => { btn.textContent = ORIG; }, 2000);
    };
    const sel = this.editor.value.substring(this.editor.selectionStart, this.editor.selectionEnd);
    const val = (sel || this.editor.value).trim();
    if (!val) { flash('⚠️ Nothing to save'); return; }
    try {
      const data = await chrome.storage.local.get(['savedClipboardValues']);
      const list = data.savedClipboardValues || [];
      if (list.includes(val)) { flash('✔ Already saved'); return; }
      list.push(val);
      await chrome.storage.local.set({ savedClipboardValues: list });
      flash('✅ Saved!');
    } catch (e) {
      alert('Could not save: the local clipboard list has reached its limit. Try removing some saved values first.');
    }
  }
  openFullScreen() { chrome.tabs.create({ url: 'editor.html' }); }
  applyDarkMode(isDark) {
    const textEditorContainer = this.container.querySelector('.text-editor-container');
    if (textEditorContainer) textEditorContainer.classList.toggle('text-editor-dark', isDark);
  }
  changeFontSize() {
    const fontSize = `${this.textSizeSelect.value}px`;
    this.editor.style.fontSize = fontSize;
    this.lineNumbers.style.fontSize = fontSize;
    this.saveSettings();
  }
  newNote() {
    this.loadNotesList(notes => {
      let name = 'Untitled', counter = 1;
      while (notes.includes(name)) name = `Untitled (${counter++})`;
      notes.push(name);
      this.saveNotesList(notes);
      chrome.storage.local.set({ [`${this.options.storagePrefix}note_${name}`]: '' }, () => {
        this.currentNote = name;
        this.editor.value = '';
        this.updateButtonStates();
        this.updateLineNumbers();
        this.renderNoteList(notes);
        this.editor.focus();
      });
    });
  }
  commitRename(oldName, newNameRaw, done) {
    const newName = (newNameRaw || '').trim();
    if (!newName || newName === oldName) { if (done) done(false); return; }
    this.loadNotesList(notes => {
      if (notes.includes(newName)) { alert('A note with that name already exists.'); if (done) done(false); return; }
      const oldKey = `${this.options.storagePrefix}note_${oldName}`;
      const newKey = `${this.options.storagePrefix}note_${newName}`;
      chrome.storage.local.get(oldKey, (data) => {
        chrome.storage.local.set({ [newKey]: data[oldKey] || '' }, () => {
          chrome.storage.local.remove(oldKey);
          const updatedNotes = notes.map(n => (n === oldName ? newName : n));
          this.saveNotesList(updatedNotes);
          this.loadLockedNames(locked => {
            const next = locked.filter(n => n !== oldName);
            if (!next.includes(newName)) next.push(newName);
            this.saveLockedNames(next);
            if (this.currentNote === oldName) this.currentNote = newName;
            this.renderNoteList(updatedNotes);
            if (done) done(true);
          });
        });
      });
    });
  }
  deleteNote() {
    if (!this.currentNote) return;
    const hasContent = this.editor.value.trim() !== '';
    if (hasContent && !confirm(`Delete note "${this.currentNote}"?`)) return;
    this.loadNotesList(notes => {
      const updatedNotes = notes.filter(n => n !== this.currentNote);
      const removedName = this.currentNote;
      chrome.storage.local.remove(`${this.options.storagePrefix}note_${removedName}`, () => {
        this.saveNotesList(updatedNotes);
        this.loadLockedNames(locked => this.saveLockedNames(locked.filter(n => n !== removedName)));
        if (updatedNotes.length > 0) this.loadNote(updatedNotes[0]);
        else {
          this.newNote(); 
        }
      });
    });
  }
  loadNote(noteName) {
    const key = `${this.options.storagePrefix}note_${noteName}`;
    chrome.storage.local.get(key, (data) => {
      this.editor.value = data[key] || '';
      this.currentNote = noteName;
      this.updateButtonStates();
      this.updateLineNumbers();
      this.loadNotesList(notes => this.renderNoteList(notes));
    });
  }
  updateButtonStates() {
    const noNote = !this.currentNote;
    if (this.deleteNoteBtn) this.deleteNoteBtn.disabled = noNote;
  }
  renderNoteList(notes) {
    if (!this.noteList) return;
    this.noteList.innerHTML = '';
    notes.forEach((note, index) => {
      const li = document.createElement('li');
      li.className = note === this.currentNote ? 'active' : '';
      li.draggable = true;

      const handle = document.createElement('span');
      handle.className = 'text-editor-note-handle';
      handle.textContent = '⋮⋮';
      handle.title = 'Drag to reorder';

      const nameSpan = document.createElement('span');
      nameSpan.className = 'text-editor-note-name';
      nameSpan.textContent = note;
      nameSpan.title = note;

      const pencil = document.createElement('button');
      pencil.className = 'text-editor-note-edit';
      pencil.innerHTML = '✏️';
      pencil.title = 'Rename this note';

      li.appendChild(handle);
      li.appendChild(nameSpan);
      li.appendChild(pencil);

      li.addEventListener('click', (e) => {
        if (e.target === pencil || e.target === handle || li.querySelector('input')) return;
        this.loadNote(note);
      });
      pencil.addEventListener('click', (e) => {
        e.stopPropagation();
        this.startInlineRename(li, nameSpan, note);
      });

      li.addEventListener('dragstart', (e) => {
        if (li.querySelector('input')) { e.preventDefault(); return; } 
        this.draggedNoteIndex = index;
        e.dataTransfer.effectAllowed = 'move';
        setTimeout(() => li.style.opacity = '0.4', 0);
      });
      li.addEventListener('dragend', () => {
        li.style.opacity = '1';
        this.draggedNoteIndex = null;
        this.noteList.querySelectorAll('li').forEach(el => {
          el.style.borderTop = '';
          el.style.borderBottom = '';
        });
      });
      li.addEventListener('dragover', (e) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        const b = li.getBoundingClientRect();
        const mid = b.y + b.height / 2;
        if (e.clientY - mid > 0) { li.style.borderBottom = '2px solid var(--text-editor-button-active)'; li.style.borderTop = ''; }
        else { li.style.borderTop = '2px solid var(--text-editor-button-active)'; li.style.borderBottom = ''; }
      });
      li.addEventListener('dragleave', () => { li.style.borderTop = ''; li.style.borderBottom = ''; });
      li.addEventListener('drop', (e) => {
        e.preventDefault();
        li.style.borderTop = ''; li.style.borderBottom = '';
        if (this.draggedNoteIndex === null || this.draggedNoteIndex === index) return;
        const b = li.getBoundingClientRect();
        const mid = b.y + b.height / 2;
        let insertIndex = index;
        if (e.clientY - mid > 0) insertIndex++;
        this.reorderNotes(this.draggedNoteIndex, insertIndex);
      });

      this.noteList.appendChild(li);
    });
  }
  reorderNotes(from, to) {
    this.loadNotesList(notes => {
      const next = [...notes];
      const [moved] = next.splice(from, 1);
      if (from < to) to--;
      next.splice(to, 0, moved);
      this.saveNotesList(next);
      this.renderNoteList(next);
    });
  }
  startInlineRename(li, nameSpan, note) {
    if (li.querySelector('input')) return; 
    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'text-editor-note-rename-input';
    input.value = note;
    nameSpan.replaceWith(input);
    input.focus();
    input.select();

    let finished = false;
    const commit = () => {
      if (finished) return;
      finished = true;
      this.commitRename(note, input.value, (ok) => {
        this.loadNotesList(n => this.renderNoteList(n));
      });
    };
    const cancel = () => {
      if (finished) return;
      finished = true;
      this.loadNotesList(n => this.renderNoteList(n));
    };
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); commit(); }
      else if (e.key === 'Escape') { e.preventDefault(); cancel(); }
    });
    input.addEventListener('blur', commit);
    input.addEventListener('click', (e) => e.stopPropagation());
  }
  saveNotesList(list) { chrome.storage.local.set({ [`${this.options.storagePrefix}notesList`]: list }); }
  loadNotesList(callback) { chrome.storage.local.get(`${this.options.storagePrefix}notesList`, (data) => callback(data[`${this.options.storagePrefix}notesList`] || [])); }
  saveSettings() {
    chrome.storage.local.set({
      [`${this.options.storagePrefix}lineNumbers`]: this.lineNumbersToggle?.checked,
      [`${this.options.storagePrefix}textSize`]: this.textSizeSelect?.value
    });
  }
  loadSettings() {
    const keys = [`${this.options.storagePrefix}darkMode`, `${this.options.storagePrefix}globalDarkMode`, `${this.options.storagePrefix}lineNumbers`, `${this.options.storagePrefix}textSize`];
    chrome.storage.local.get(keys, (data) => {
      const isDark = (data[`${this.options.storagePrefix}darkMode`]
                   ?? data[`${this.options.storagePrefix}globalDarkMode`]
                   ?? this.options.darkMode) !== false;
      const showLineNumbers = data[`${this.options.storagePrefix}lineNumbers`] ?? this.options.showLineNumbers;
      const textSize = data[`${this.options.storagePrefix}textSize`] || this.options.fontSize;
      if (this.lineNumbersToggle) this.lineNumbersToggle.checked = showLineNumbers;
      if (this.textSizeSelect) this.textSizeSelect.value = textSize;
      const container = this.container.querySelector('.text-editor-container');
      if (container) container.classList.toggle('text-editor-dark', isDark);
      this.toggleLineNumbers();
      this.editor.style.fontSize = `${textSize}px`;
      this.lineNumbers.style.fontSize = `${textSize}px`;
    });
  }
  loadInitialData() {
    this.loadNotesList(notes => {
      const migrated = notes.filter(n => !n.startsWith('New Text Entry'));
      const hadGhost = migrated.length !== notes.length;
      if (hadGhost) {
        notes.filter(n => n.startsWith('New Text Entry')).forEach(ghost => {
          chrome.storage.local.remove(`${this.options.storagePrefix}note_${ghost}`);
        });
        this.saveNotesList(migrated);
      }
      if (migrated.length === 0) {
        this.newNote();
      } else {
        this.loadNote(migrated[0]);
        this.renderNoteList(migrated);
      }
    });
  }
  destroy() { clearTimeout(this.saveTimeout); this.container.innerHTML = ''; }
}
if (typeof module !== 'undefined' && module.exports) module.exports = TextEditor;
else if (typeof window !== 'undefined') window.TextEditor = TextEditor;