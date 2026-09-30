(() => {
  'use strict';

  const DEFAULTS = {
    minValue: 0,
    maxValue: 100,
    useTargetField: true,
    transparentBackground: true,
    backgroundColor: '#ffffff',
    viewMode: 'standard',
    gradientStart: '#ffffff',
    gradientEnd: '#050505',
    stripeColor: '#000000',
    gapUsesBackground: true,
    gapColor: '#d8d8d8',
    stripeWidth: 2,
    stripeGap: 7,
    stripeAngle: 135,
    barHeight: 32,
    cornerRadius: 0,
    rowGap: 16,
    showLabels: true,
    labelFontFamily: 'Arial',
    labelFontSize: 12,
    labelColor: '#222222',
    labelBold: false,
    labelItalic: false,
    labelPlacement: 'outside',
    labelHorizontal: 'right',
    labelVertical: 'middle',
    labelGap: 10,
    labelTemplate: '',
    labelTemplateRich: '',
    showTooltips: true,
    tooltipTemplate: '',
    tooltipTemplateRich: '',
    tooltipFontFamily: 'Arial',
    tooltipFontSize: 12,
    tooltipColor: '#222222',
    tooltipBackgroundColor: '#ffffff',
    tooltipBorderColor: '#b8b8b8',
    tooltipBold: false,
    tooltipItalic: false,
    settingsVersion: 10
  };

  const LAST_TAB_KEY = 'gradientProgressLastFormatTab';
  const DIALOG_GEOMETRY_KEY = 'gradientProgressDialogGeometryV1';
  const $ = id => document.getElementById(id);
  let settings = { ...DEFAULTS };
  let saveTimer = null;
  let geometryTimer = null;

  document.addEventListener('DOMContentLoaded', async () => {
    restoreWindowGeometry();
    startWindowGeometryTracking();
    wireTabs();
    wireControls();
    wireRichTextEditor('labelRichEditor');
    wireRichTextEditor('tooltipRichEditor');

    try {
      const payload = await tableau.extensions.initializeDialogAsync();
      // Tableau may finish creating the native Window frame only after dialog initialization.
      // Retry geometry restoration so the last size and screen position are reapplied reliably.
      restoreWindowGeometry();
      setTimeout(restoreWindowGeometry, 250);
      setTimeout(restoreWindowGeometry, 700);
      try { settings = { ...DEFAULTS, ...JSON.parse(payload || '{}') }; } catch (_) {}
      const persisted = tableau.extensions.settings.get('gradientProgressSettings');
      if (persisted) {
        try { settings = { ...settings, ...JSON.parse(persisted) }; } catch (_) {}
      }
      migrateRichText();
      fill();
      await loadLabelFieldTokens();
      await loadTooltipFieldTokens();
    } catch (err) {
      $('saveStatus').textContent = 'Could not initialize settings';
    }
  });

  function migrateRichText() {
    if (!settings.labelTemplateRich && settings.labelTemplate) {
      settings.labelTemplateRich = plainTextToHtml(settings.labelTemplate);
    }
    if (!settings.tooltipTemplateRich && settings.tooltipTemplate) {
      settings.tooltipTemplateRich = plainTextToHtml(settings.tooltipTemplate);
    }
    settings.settingsVersion = 10;
  }

  function wireTabs() {
    document.querySelectorAll('.tab-btn').forEach(btn => btn.addEventListener('click', () => {
      activateTab(btn.dataset.tab, true);
    }));
    let remembered = 'worksheet';
    try { remembered = localStorage.getItem(LAST_TAB_KEY) || remembered; } catch (_) {}
    activateTab(remembered, false);
  }

  function activateTab(tabName, remember) {
    if (!document.querySelector(`.tab-btn[data-tab="${tabName}"]`) || !document.querySelector(`.tab-page[data-page="${tabName}"]`)) {
      tabName = 'worksheet';
    }
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.toggle('active', b.dataset.tab === tabName));
    document.querySelectorAll('.tab-page').forEach(p => p.classList.toggle('active', p.dataset.page === tabName));
    if (remember) {
      try { localStorage.setItem(LAST_TAB_KEY, tabName); } catch (_) {}
    }
  }

  function wireControls() {
    document.querySelectorAll('input, select').forEach(el => {
      el.addEventListener('input', liveChange);
      el.addEventListener('change', liveChange);
    });
    $('labelApplyBtn').addEventListener('click', applyLabelText);
    $('tooltipApplyBtn').addEventListener('click', applyTooltipText);
    $('resetBtn').addEventListener('click', () => {
      settings = { ...DEFAULTS };
      fill();
      queueSave();
    });

    document.querySelectorAll('[data-rich-command]').forEach(button => {
      button.addEventListener('mousedown', e => e.preventDefault());
      button.addEventListener('click', () => {
        const editor = $(button.dataset.editor);
        if (!editor) return;
        editor.focus();
        const command = button.dataset.richCommand;
        if (command === 'insertTab') {
          insertTextAtSelection(editor, '\u00a0\u00a0\u00a0\u00a0');
          return;
        }
        try { document.execCommand('styleWithCSS', false, false); } catch (_) {}
        if (command === 'clear') document.execCommand('removeFormat', false, null);
        else document.execCommand(command, false, null);
      });
    });
  }

  function wireRichTextEditor(editorId) {
    const editor = $(editorId);
    if (!editor) return;
    editor.addEventListener('keydown', event => {
      if ((event.ctrlKey || event.metaKey) && event.key === 'Tab') {
        event.preventDefault();
        event.stopPropagation();
        insertTextAtSelection(editor, '\u00a0\u00a0\u00a0\u00a0');
      }
    });
    editor.addEventListener('paste', event => {
      event.preventDefault();
      const text = (event.clipboardData || window.clipboardData).getData('text/plain');
      insertTextAtSelection(editor, text);
    });
  }

  function fill() {
    Object.entries(settings).forEach(([k, v]) => {
      const el = $(k);
      if (!el) return;
      if (el.type === 'checkbox') el.checked = !!v;
      else el.value = v;
    });
    $('labelRichEditor').innerHTML = sanitizeRichHtml(settings.labelTemplateRich || plainTextToHtml(settings.labelTemplate || ''));
    $('tooltipRichEditor').innerHTML = sanitizeRichHtml(settings.tooltipTemplateRich || plainTextToHtml(settings.tooltipTemplate || ''));
    const radio = document.querySelector(`input[name="viewMode"][value="${settings.viewMode}"]`);
    if (radio) radio.checked = true;
    updateDependencies();
  }

  function liveChange() {
    const committedLabelRich = settings.labelTemplateRich;
    const committedTooltipRich = settings.tooltipTemplateRich;
    const legacyLabel = settings.labelTemplate;
    const legacyTooltip = settings.tooltipTemplate;
    settings = read();
    settings.labelTemplateRich = committedLabelRich;
    settings.tooltipTemplateRich = committedTooltipRich;
    settings.labelTemplate = legacyLabel;
    settings.tooltipTemplate = legacyTooltip;
    updateDependencies();
    queueSave();
  }

  function applyLabelText() {
    const committedTooltipRich = settings.tooltipTemplateRich;
    const committedTooltipLegacy = settings.tooltipTemplate;
    settings = read();
    settings.labelTemplateRich = sanitizeRichHtml($('labelRichEditor').innerHTML);
    settings.labelTemplate = richHtmlToPlainText(settings.labelTemplateRich);
    settings.tooltipTemplateRich = committedTooltipRich;
    settings.tooltipTemplate = committedTooltipLegacy;
    $('saveStatus').textContent = 'Updating label…';
    saveNow();
  }

  function applyTooltipText() {
    const committedLabelRich = settings.labelTemplateRich;
    const committedLabelLegacy = settings.labelTemplate;
    settings = read();
    settings.tooltipTemplateRich = sanitizeRichHtml($('tooltipRichEditor').innerHTML);
    settings.tooltipTemplate = richHtmlToPlainText(settings.tooltipTemplateRich);
    settings.labelTemplateRich = committedLabelRich;
    settings.labelTemplate = committedLabelLegacy;
    $('saveStatus').textContent = 'Updating tooltip…';
    saveNow();
  }

  function read() {
    const chosenView = document.querySelector('input[name="viewMode"]:checked');
    return {
      minValue: num($('minValue').value, DEFAULTS.minValue),
      maxValue: num($('maxValue').value, DEFAULTS.maxValue),
      useTargetField: $('useTargetField').checked,
      transparentBackground: $('transparentBackground').checked,
      backgroundColor: $('backgroundColor').value,
      viewMode: chosenView ? chosenView.value : DEFAULTS.viewMode,
      gradientStart: $('gradientStart').value,
      gradientEnd: $('gradientEnd').value,
      stripeColor: $('stripeColor').value,
      gapUsesBackground: $('gapUsesBackground').checked,
      gapColor: $('gapColor').value,
      stripeWidth: clamp(num($('stripeWidth').value, 2), 1, 30),
      stripeGap: clamp(num($('stripeGap').value, 7), 1, 40),
      stripeAngle: clamp(num($('stripeAngle').value, 135), 0, 180),
      barHeight: clamp(num($('barHeight').value, 32), 8, 160),
      cornerRadius: clamp(num($('cornerRadius').value, 0), 0, 80),
      rowGap: clamp(num($('rowGap').value, 16), 0, 80),
      showLabels: $('showLabels').checked,
      labelPlacement: $('labelPlacement').value,
      labelFontFamily: $('labelFontFamily').value || 'Arial',
      labelFontSize: clamp(num($('labelFontSize').value, 12), 6, 72),
      labelColor: $('labelColor').value,
      labelBold: $('labelBold').checked,
      labelItalic: $('labelItalic').checked,
      labelHorizontal: $('labelHorizontal').value,
      labelVertical: $('labelVertical').value,
      labelGap: clamp(num($('labelGap').value, 10), 0, 80),
      labelTemplate: settings.labelTemplate || '',
      labelTemplateRich: settings.labelTemplateRich || '',
      showTooltips: $('showTooltips').checked,
      tooltipTemplate: settings.tooltipTemplate || '',
      tooltipTemplateRich: settings.tooltipTemplateRich || '',
      tooltipFontFamily: $('tooltipFontFamily').value || 'Arial',
      tooltipFontSize: clamp(num($('tooltipFontSize').value, 12), 6, 72),
      tooltipColor: $('tooltipColor').value,
      tooltipBackgroundColor: $('tooltipBackgroundColor').value,
      tooltipBorderColor: $('tooltipBorderColor').value,
      tooltipBold: $('tooltipBold').checked,
      tooltipItalic: $('tooltipItalic').checked,
      settingsVersion: 10
    };
  }

  function updateDependencies() {
    $('backgroundColor').disabled = $('transparentBackground').checked;
    $('gapColor').disabled = $('gapUsesBackground').checked;
  }

  function queueSave() {
    clearTimeout(saveTimer);
    $('saveStatus').textContent = 'Updating…';
    saveTimer = setTimeout(saveNow, 90);
  }

  async function saveNow() {
    if (settings.maxValue === settings.minValue) {
      $('saveStatus').textContent = 'Maximum must differ from minimum';
      return;
    }
    try {
      settings.settingsVersion = 10;
      tableau.extensions.settings.set('gradientProgressSettings', JSON.stringify(settings));
      await tableau.extensions.settings.saveAsync();
      $('saveStatus').textContent = 'Live';
    } catch (err) {
      $('saveStatus').textContent = 'Could not save';
    }
  }

  async function getMarksFieldSets() {
    const ws = tableau.extensions.worksheetContent && tableau.extensions.worksheetContent.worksheet;
    if (!ws) return { all: [], label: [], tooltip: [] };
    const visualSpec = await ws.getVisualSpecificationAsync();
    const marks = visualSpec.marksSpecifications[visualSpec.activeMarksSpecificationIndex];
    const all = [];
    const label = [];
    const tooltip = [];

    for (const encoding of (marks.encodings || [])) {
      const id = String(encoding.id || '').toLowerCase();
      const names = fieldNamesFromEncoding(encoding);
      all.push(...names);
      if (id === 'label') label.push(...names);
      if (id === 'tooltip') tooltip.push(...names);
    }
    return {
      all: uniqueFieldNames(all),
      label: uniqueFieldNames(label),
      tooltip: uniqueFieldNames(tooltip)
    };
  }

  function fieldNamesFromEncoding(encoding) {
    const fields = [];
    if (encoding && encoding.field) fields.push(encoding.field);
    if (encoding && Array.isArray(encoding.fields)) fields.push(...encoding.fields);
    return fields.map(f => f && f.name).filter(Boolean);
  }

  function normalizeFieldName(name) {
    return String(name || '').trim().replace(/\s+/g, '').replace(/^(SUM|AVG|MIN|MAX|ATTR|CNT|COUNT|COUNTD|MEDIAN)\((.*)\)$/i, '$2').toLowerCase();
  }

  function uniqueFieldNames(names) {
    const seen = new Set();
    const result = [];
    names.forEach(name => {
      const key = normalizeFieldName(name);
      if (!key || seen.has(key)) return;
      seen.add(key);
      result.push(name);
    });
    return result;
  }

  function renderFieldButtons(holder, names, editor) {
    holder.innerHTML = '';
    if (!names.length) {
      holder.textContent = 'Add fields to the Marks card, reopen Format Extension, and their tokens will appear here.';
      return;
    }
    names.forEach(name => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'token-btn';
      b.textContent = `<${name}>`;
      b.addEventListener('mousedown', e => e.preventDefault());
      b.addEventListener('click', () => insertTextAtSelection(editor, `<${name}>`));
      holder.appendChild(b);
    });
  }

  async function loadLabelFieldTokens() {
    const holder = $('labelFieldTokens');
    if (!holder) return;
    holder.innerHTML = '';
    try {
      const sets = await getMarksFieldSets();
      if (!richHtmlToPlainText($('labelRichEditor').innerHTML).trim() && sets.label.length) {
        $('labelRichEditor').textContent = sets.label.map(n => `<${n}>`).join(' ');
      }
      renderFieldButtons(holder, sets.all, $('labelRichEditor'));
    } catch (err) {
      holder.textContent = 'Field tokens are unavailable in this Tableau build; you can still type tokens such as <Field> manually.';
    }
  }

  async function loadTooltipFieldTokens() {
    const holder = $('tooltipFieldTokens');
    if (!holder) return;
    holder.innerHTML = '';
    try {
      const sets = await getMarksFieldSets();
      if (!richHtmlToPlainText($('tooltipRichEditor').innerHTML).trim() && sets.tooltip.length) {
        $('tooltipRichEditor').textContent = sets.tooltip.map(n => `<${n}>`).join('\n');
      }
      renderFieldButtons(holder, sets.all, $('tooltipRichEditor'));
    } catch (err) {
      holder.textContent = 'Field tokens are unavailable in this Tableau build; you can still type tokens such as <Field> manually.';
    }
  }

  function insertTextAtSelection(editor, text) {
    editor.focus();
    const selection = window.getSelection();
    if (!selection || !selection.rangeCount || !editor.contains(selection.anchorNode)) {
      editor.appendChild(document.createTextNode(text));
      placeCaretAtEnd(editor);
      return;
    }
    const range = selection.getRangeAt(0);
    range.deleteContents();
    const node = document.createTextNode(text);
    range.insertNode(node);
    range.setStartAfter(node);
    range.collapse(true);
    selection.removeAllRanges();
    selection.addRange(range);
  }

  function placeCaretAtEnd(el) {
    const range = document.createRange();
    range.selectNodeContents(el);
    range.collapse(false);
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
  }

  function plainTextToHtml(text) {
    return escapeHtml(String(text || '')).replace(/\r?\n/g, '<br>');
  }

  function richHtmlToPlainText(html) {
    const template = document.createElement('template');
    template.innerHTML = sanitizeRichHtml(html || '');
    template.content.querySelectorAll('br').forEach(br => br.replaceWith('\n'));
    template.content.querySelectorAll('div,p').forEach(block => block.append('\n'));
    return (template.content.textContent || '').replace(/\u00a0/g, ' ');
  }

  function sanitizeRichHtml(html) {
    const template = document.createElement('template');
    template.innerHTML = String(html || '');
    const allowed = new Set(['B','STRONG','I','EM','U','BR','DIV','P','SPAN']);
    const walk = node => {
      [...node.childNodes].forEach(child => {
        if (child.nodeType === Node.ELEMENT_NODE) {
          if (!allowed.has(child.tagName)) {
            child.replaceWith(...child.childNodes);
            return;
          }
          [...child.attributes].forEach(attr => child.removeAttribute(attr.name));
          walk(child);
        }
      });
    };
    walk(template.content);
    return template.innerHTML;
  }

  function escapeHtml(value) {
    return String(value).replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[ch]));
  }

  function restoreWindowGeometry() {
    let geometry;
    try { geometry = JSON.parse(localStorage.getItem(DIALOG_GEOMETRY_KEY) || 'null'); } catch (_) { return; }
    if (!geometry) return;
    const applyGeometry = () => {
      try {
        if (Number.isFinite(geometry.width) && Number.isFinite(geometry.height)) {
          const maxW = (screen && screen.availWidth) ? screen.availWidth : 1400;
          const maxH = (screen && screen.availHeight) ? screen.availHeight : 1000;
          window.resizeTo(clamp(geometry.width, 360, maxW), clamp(geometry.height, 480, maxH));
        }
        if (Number.isFinite(geometry.left) && Number.isFinite(geometry.top)) {
          const availLeft = Number.isFinite(screen.availLeft) ? screen.availLeft : 0;
          const availTop = Number.isFinite(screen.availTop) ? screen.availTop : 0;
          const availWidth = screen.availWidth || 1400;
          const availHeight = screen.availHeight || 1000;
          const width = Math.round(window.outerWidth || window.innerWidth || geometry.width || 420);
          const height = Math.round(window.outerHeight || window.innerHeight || geometry.height || 700);
          window.moveTo(
            clamp(geometry.left, availLeft, availLeft + Math.max(0, availWidth - Math.min(width, 120))),
            clamp(geometry.top, availTop, availTop + Math.max(0, availHeight - Math.min(height, 80)))
          );
        }
      } catch (_) {
        // Some Tableau/Chromium hosts can block moveTo; saved size still restores through dialog options.
      }
    };
    setTimeout(applyGeometry, 80);
  }

  function startWindowGeometryTracking() {
    let last = '';
    const capture = () => {
      const geometry = {
        width: Math.round(window.outerWidth || window.innerWidth || 420),
        height: Math.round(window.outerHeight || window.innerHeight || 700),
        left: Math.round(Number.isFinite(window.screenX) ? window.screenX : (Number.isFinite(window.screenLeft) ? window.screenLeft : 0)),
        top: Math.round(Number.isFinite(window.screenY) ? window.screenY : (Number.isFinite(window.screenTop) ? window.screenTop : 0))
      };
      const serialized = JSON.stringify(geometry);
      if (serialized === last) return;
      last = serialized;
      try { localStorage.setItem(DIALOG_GEOMETRY_KEY, serialized); } catch (_) {}
    };
    capture();
    window.addEventListener('resize', capture);
    window.addEventListener('pagehide', capture);
    window.addEventListener('beforeunload', capture);
    document.addEventListener('visibilitychange', () => { if (document.hidden) capture(); });
    geometryTimer = setInterval(capture, 250);
  }

  const num = (v, f) => Number.isFinite(Number(v)) ? Number(v) : f;
  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
})();
