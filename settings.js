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
    showTooltips: true,
    tooltipTemplate: '',
    tooltipFontFamily: 'Arial',
    tooltipFontSize: 12,
    tooltipColor: '#222222',
    tooltipBackgroundColor: '#ffffff',
    tooltipBorderColor: '#b8b8b8',
    tooltipBold: false,
    tooltipItalic: false,
    settingsVersion: 9
  };

  let settings = { ...DEFAULTS };
  let saveTimer = null;
  const $ = id => document.getElementById(id);

  document.addEventListener('DOMContentLoaded', async () => {
    wireTabs();
    wireControls();
    try {
      const payload = await tableau.extensions.initializeDialogAsync();
      try { settings = { ...DEFAULTS, ...JSON.parse(payload || '{}') }; } catch (_) {}
      const persisted = tableau.extensions.settings.get('gradientProgressSettings');
      if (persisted) {
        try { settings = { ...settings, ...JSON.parse(persisted) }; } catch (_) {}
      }
      fill();
      await loadLabelFieldTokens();
      await loadTooltipFieldTokens();
    } catch (err) {
      $('saveStatus').textContent = 'Could not initialize settings';
    }
  });

  const LAST_TAB_KEY = 'gradientProgressLastFormatTab';

  function wireTabs() {
    document.querySelectorAll('.tab-btn').forEach(btn => btn.addEventListener('click', () => {
      activateTab(btn.dataset.tab, true);
    }));

    // Reopen Format Extension on the tab the user last worked in.
    // localStorage is used deliberately so changing tabs does not trigger a
    // Tableau SettingsChanged event or redraw the visualization.
    let remembered = 'worksheet';
    try { remembered = localStorage.getItem(LAST_TAB_KEY) || remembered; } catch (_) {}
    activateTab(remembered, false);
  }

  function activateTab(tabName, remember) {
    const target = document.querySelector(`.tab-btn[data-tab="${tabName}"]`);
    const page = document.querySelector(`.tab-page[data-page="${tabName}"]`);
    if (!target || !page) {
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
  }

  function fill() {
    Object.entries(settings).forEach(([k, v]) => {
      const el = $(k);
      if (!el) return;
      if (el.type === 'checkbox') el.checked = !!v;
      else el.value = v;
    });
    const radio = document.querySelector(`input[name="viewMode"][value="${settings.viewMode}"]`);
    if (radio) radio.checked = true;
    updateDependencies();
  }

  function liveChange() {
    // Text areas are draft-only. All other formatting controls remain live.
    const committedLabelTemplate = settings.labelTemplate;
    const committedTooltipTemplate = settings.tooltipTemplate;
    settings = read();
    settings.labelTemplate = committedLabelTemplate;
    settings.tooltipTemplate = committedTooltipTemplate;
    updateDependencies();
    queueSave();
  }

  function applyLabelText() {
    const committedTooltipTemplate = settings.tooltipTemplate;
    settings = read();
    settings.labelTemplate = $('labelTemplate').value || '';
    settings.tooltipTemplate = committedTooltipTemplate;
    $('saveStatus').textContent = 'Updating label…';
    saveNow();
  }

  function applyTooltipText() {
    const committedLabelTemplate = settings.labelTemplate;
    settings = read();
    settings.labelTemplate = committedLabelTemplate;
    settings.tooltipTemplate = $('tooltipTemplate').value || '';
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
      showTooltips: $('showTooltips').checked,
      tooltipTemplate: $('tooltipTemplate').value || '',
      tooltipFontFamily: $('tooltipFontFamily').value || 'Arial',
      tooltipFontSize: clamp(num($('tooltipFontSize').value, 12), 6, 72),
      tooltipColor: $('tooltipColor').value,
      tooltipBackgroundColor: $('tooltipBackgroundColor').value,
      tooltipBorderColor: $('tooltipBorderColor').value,
      tooltipBold: $('tooltipBold').checked,
      tooltipItalic: $('tooltipItalic').checked,
      settingsVersion: 9
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
    return String(name || '')
      .trim()
      .replace(/\s+/g, '')
      .replace(/^(SUM|AVG|MIN|MAX|ATTR|CNT|COUNT|COUNTD|MEDIAN)\((.*)\)$/i, '$2')
      .toLowerCase();
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

  function renderFieldButtons(holder, names, textarea) {
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
      b.addEventListener('click', () => insertAtCursor(textarea, `<${name}>`));
      holder.appendChild(b);
    });
  }

  async function loadLabelFieldTokens() {
    const holder = $('labelFieldTokens');
    if (!holder) return;
    holder.innerHTML = '';
    try {
      const sets = await getMarksFieldSets();
      if (!$('labelTemplate').value.trim() && sets.label.length) {
        $('labelTemplate').value = sets.label.map(n => `<${n}>`).join(' ');
      }
      renderFieldButtons(holder, sets.all, $('labelTemplate'));
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
      if (!$('tooltipTemplate').value.trim() && sets.tooltip.length) {
        $('tooltipTemplate').value = sets.tooltip.map(n => `<${n}>`).join('\n');
      }
      renderFieldButtons(holder, sets.all, $('tooltipTemplate'));
    } catch (err) {
      holder.textContent = 'Field tokens are unavailable in this Tableau build; you can still type tokens such as <Field> manually.';
    }
  }

  function insertAtCursor(el, text) {
    const start = Number.isFinite(el.selectionStart) ? el.selectionStart : el.value.length;
    const end = Number.isFinite(el.selectionEnd) ? el.selectionEnd : start;
    el.value = el.value.slice(0, start) + text + el.value.slice(end);
    el.selectionStart = el.selectionEnd = start + text.length;
    el.focus();
    // Token insertion changes only the draft. Use the adjacent Apply button to commit.
  }

  const num = (v, f) => Number.isFinite(Number(v)) ? Number(v) : f;
  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
})();
