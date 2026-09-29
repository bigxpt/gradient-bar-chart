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
  let worksheet = null;
  let rendering = false;
  let rerenderQueued = false;
  let lastDataTable = null;
  let nativeHoverToken = 0;
  let nativeHoverDisabled = false;
  const progressMemory = new Map();
  const $ = id => document.getElementById(id);

  document.addEventListener('DOMContentLoaded', async () => {
    try {
      await tableau.extensions.initializeAsync({ configure: openSettingsDialog });
      worksheet = tableau.extensions.worksheetContent.worksheet;
      loadSettings();

      worksheet.addEventListener(tableau.TableauEventType.SummaryDataChanged, scheduleRender);
      tableau.extensions.settings.addEventListener(tableau.TableauEventType.SettingsChanged, () => {
        loadSettings();
        scheduleRender();
      });
      window.addEventListener('resize', scheduleRender);

      await render();
    } catch (err) {
      showFatal('The extension could not initialize. ' + formatError(err));
    }
  });

  function loadSettings() {
    try {
      const saved = tableau.extensions.settings.get('gradientProgressSettings');
      const parsed = saved ? JSON.parse(saved) : {};
      settings = { ...DEFAULTS, ...parsed };
      // Migrate older versions to the new requested defaults once.
      if (!parsed.settingsVersion || parsed.settingsVersion < 9) {
        settings.stripeColor = '#000000';
        settings.stripeWidth = 2;
        settings.stripeGap = 7;
        if (!parsed.settingsVersion || parsed.settingsVersion < 7) settings.maxValue = 100;
        settings.settingsVersion = 9;
      }
      if (settings.gapUsesBackground === undefined && settings.transparentGap !== undefined) {
        settings.gapUsesBackground = !!settings.transparentGap;
      }
    } catch (_) {
      settings = { ...DEFAULTS };
    }
  }

  async function openSettingsDialog() {
    // Use Tableau's native Window style. This gives the configuration UI one
    // native title bar/close button and lets the user move and resize it.
    // Keeping the popup on the same localhost origin is required by Tableau.
    const basePath = window.location.pathname.replace(/\/[^/]*$/, '');
    const url = `${window.location.origin}${basePath}/settings.html`;
    const payload = JSON.stringify(settings);

    const stylesToTry = [];
    if (tableau.DialogStyle && tableau.DialogStyle.Window) stylesToTry.push(tableau.DialogStyle.Window);
    if (tableau.DialogStyle && tableau.DialogStyle.Modeless) stylesToTry.push(tableau.DialogStyle.Modeless);
    stylesToTry.push(null); // final compatibility fallback: Tableau's default modal dialog

    let lastError = null;
    for (const dialogStyle of stylesToTry) {
      try {
        const options = { width: 420, height: 700 };
        if (dialogStyle) options.dialogStyle = dialogStyle;
        await tableau.extensions.ui.displayDialogAsync(url, payload, options);
        return;
      } catch (err) {
        // Closing with Tableau's native X is expected and should not surface as an error.
        if (err && tableau.ErrorCodes && err.errorCode === tableau.ErrorCodes.DialogClosedByUser) return;
        lastError = err;
      }
    }

    // Do not throw back into Tableau's Format Extension command. Keep the
    // worksheet usable and record the diagnostic in the developer console.
    console.error('Unable to open settings dialog:', lastError);
  }

  function scheduleRender() {
    if (rendering) {
      rerenderQueued = true;
      return Promise.resolve();
    }
    return render();
  }

  async function render() {
    if (!worksheet) return;
    rendering = true;
    hideError();

    try {
      const encodingMap = await getEncodingMap();
      if (!encodingMap.value) {
        applyBackground();
        renderEmpty('Add a measure to Value', 'Drag a numeric measure to Value. Target, Category and Label are optional.');
        return;
      }

      const reader = await worksheet.getSummaryDataReaderAsync();
      let dataTable;
      try { dataTable = await reader.getAllPagesAsync(); }
      finally { await reader.releaseAsync(); }
      lastDataTable = dataTable;

      const valueCol = findColumn(dataTable, encodingMap.value);
      const targetCol = encodingMap.target ? findColumn(dataTable, encodingMap.target) : null;
      const categoryCol = encodingMap.category ? findColumn(dataTable, encodingMap.category) : null;
      const labelCols = uniqueColumns((encodingMap.label || []).map(n => findColumn(dataTable, n)).filter(Boolean));
      const tooltipCols = uniqueColumns((encodingMap.tooltip || []).map(n => findColumn(dataTable, n)).filter(Boolean));
      const allCols = uniqueColumns((encodingMap.all || []).map(n => findColumn(dataTable, n)).filter(Boolean));
      if (!valueCol) throw new Error(`Could not find the Value field "${encodingMap.value}".`);

      const rows = dataTable.data.map((dataRow, i) => {
        const value = Number(nativeValue(dataRow[valueCol.index]));
        const dynamicTarget = targetCol ? Number(nativeValue(dataRow[targetCol.index])) : NaN;
        const target = settings.useTargetField && targetCol && Number.isFinite(dynamicTarget) ? dynamicTarget : settings.maxValue;
        const category = categoryCol ? displayValue(dataRow[categoryCol.index]) : '';

        // Every field used anywhere on the active Marks card is available as a token
        // in both Label and Tooltip templates. Duplicate uses of the same field are
        // collapsed by normalized field name.
        const allValues = {};
        allCols.forEach(c => {
          const shown = displayValue(dataRow[c.index]);
          allValues[c.fieldName] = shown;
          allValues[normalizeFieldName(c.fieldName)] = shown;
        });

        const autoLabel = labelCols.map(c => displayValue(dataRow[c.index])).filter(Boolean).join(' · ');
        const label = renderLabelTemplate(settings.labelTemplate, allValues, autoLabel);
        const tooltipLines = tooltipCols.map(c => `${c.fieldName}: ${displayValue(dataRow[c.index])}`);
        const tooltip = renderLabelTemplate(settings.tooltipTemplate, allValues, tooltipLines.join('\n'));
        return { key: i, rowIndex: i, dataRow, value, target, category, label, tooltip };
      }).filter(d => Number.isFinite(d.value) && Number.isFinite(d.target));

      applyBackground();
      if (!rows.length) {
        renderEmpty('No numeric data to display', 'Check the fields on the Marks card.');
        return;
      }
      drawBars(rows);
    } catch (err) {
      showFatal('Unable to render the progress bar. ' + formatError(err));
    } finally {
      rendering = false;
      if (rerenderQueued) {
        rerenderQueued = false;
        setTimeout(render, 0);
      }
    }
  }

  async function getEncodingMap() {
    const visualSpec = await worksheet.getVisualSpecificationAsync();
    const marksSpec = visualSpec.marksSpecifications[visualSpec.activeMarksSpecificationIndex];
    const result = { label: [], tooltip: [], all: [] };
    for (const encoding of marksSpec.encodings || []) {
      const id = String(encoding.id || '').toLowerCase();
      const fields = [];
      if (encoding.field) fields.push(encoding.field);
      if (Array.isArray(encoding.fields)) fields.push(...encoding.fields);
      const names = fields.map(f => f && f.name).filter(Boolean);
      result.all.push(...names);
      if (['value', 'target', 'category'].includes(id) && names[0]) result[id] = names[0];
      if (id === 'label') result.label.push(...names);
      if (id === 'tooltip') result.tooltip.push(...names);
    }
    result.all = uniqueFieldNames(result.all);
    result.label = uniqueFieldNames(result.label);
    result.tooltip = uniqueFieldNames(result.tooltip);
    return result;
  }

  function uniqueFieldNames(names) {
    const seen = new Set();
    return names.filter(name => {
      const key = normalizeFieldName(name);
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  function uniqueColumns(columns) {
    const seen = new Set();
    return columns.filter(c => {
      const key = normalizeFieldName(c && c.fieldName);
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  function drawBars(rows) {
    const content = $('content');
    content.innerHTML = '';
    content.className = '';
    content.classList.add(`view-${settings.viewMode}`);

    const viewport = document.createElement('div');
    viewport.className = 'chart-viewport';
    const stage = document.createElement('div');
    stage.className = 'chart-stage';
    const bars = document.createElement('div');
    bars.className = 'bars';
    bars.style.setProperty('--row-gap', `${settings.rowGap}px`);

    rows.forEach(d => {
      const denom = d.target - settings.minValue;
      const rawRatio = denom === 0 ? 0 : (d.value - settings.minValue) / denom;
      const ratio = clamp(rawRatio, 0, 1);
      const pct = ratio * 100;

      const row = document.createElement('section');
      row.className = 'bar-row';
      const track = document.createElement('div');
      track.className = 'progress-track';
      track.style.height = `${settings.barHeight}px`;
      track.style.borderRadius = `${settings.cornerRadius}px`;
      track.tabIndex = 0;

      const fill = document.createElement('div');
      fill.className = 'progress-fill';
      const progressKey = d.category ? `category:${d.category}::${d.key}` : `row:${d.key}`;
      const previousPct = progressMemory.has(progressKey) ? progressMemory.get(progressKey) : 0;
      fill.style.width = `${previousPct}%`;
      fill.style.setProperty('--gradient-start', settings.gradientStart);
      fill.style.setProperty('--gradient-end', settings.gradientEnd);

      const rest = document.createElement('div');
      rest.className = 'progress-rest';
      rest.style.width = `${100 - previousPct}%`;
      rest.style.setProperty('--stripe-angle', `${settings.stripeAngle}deg`);
      rest.style.setProperty('--stripe-color', settings.stripeColor);
      const effectiveGapColor = settings.gapUsesBackground
        ? (settings.transparentBackground ? 'transparent' : settings.backgroundColor)
        : settings.gapColor;
      rest.style.setProperty('--gap-color', effectiveGapColor);
      rest.style.setProperty('--stripe-width', `${settings.stripeWidth}px`);
      rest.style.setProperty('--stripe-gap', `${settings.stripeGap}px`);

      track.append(fill, rest);

      row.appendChild(track);

      if (settings.showLabels && d.label) {
        const label = document.createElement('div');
        label.className = `mark-label label-placement-${settings.labelPlacement} label-h-${settings.labelHorizontal} label-v-${settings.labelVertical}`;
        label.textContent = d.label;
        label.style.fontFamily = settings.labelFontFamily;
        label.style.fontSize = `${settings.labelFontSize}px`;
        label.style.color = settings.labelColor;
        label.style.fontWeight = settings.labelBold ? '700' : '400';
        label.style.fontStyle = settings.labelItalic ? 'italic' : 'normal';
        label.style.setProperty('--label-gap', `${settings.labelGap}px`);
        row.appendChild(label);
      }

      // Custom tooltip: field values still come from Tableau's Tooltip shelf,
      // while text and formatting are controlled entirely in Format Extension.
      track.addEventListener('mouseenter', e => showConfiguredTooltip(d, e));
      track.addEventListener('mousemove', positionTooltip);
      track.addEventListener('mouseleave', hideConfiguredTooltip);
      track.addEventListener('focus', e => showConfiguredTooltip(d, e));
      track.addEventListener('blur', hideConfiguredTooltip);
      fill.dataset.targetWidth = String(pct);
      rest.dataset.targetWidth = String(100 - pct);
      row.dataset.progressKey = progressKey;
      bars.appendChild(row);
    });

    stage.appendChild(bars);
    viewport.appendChild(stage);
    content.appendChild(viewport);

    // Lock the visualization against mouse-wheel/browser zoom so its configured
    // size remains the authoritative size. Scrollbars can still be dragged.
    viewport.addEventListener('wheel', event => {
      event.preventDefault();
      event.stopPropagation();
    }, { passive: false });

    requestAnimationFrame(() => {
      applyLabelReserve(bars);
      applyViewMode(stage, bars, rows.length);
      // Animate from the previous value to the new value after layout is painted.
      requestAnimationFrame(() => {
        bars.querySelectorAll('.bar-row').forEach(row => {
          const fill = row.querySelector('.progress-fill');
          const rest = row.querySelector('.progress-rest');
          if (!fill || !rest) return;
          fill.style.width = `${fill.dataset.targetWidth}%`;
          rest.style.width = `${rest.dataset.targetWidth}%`;
          progressMemory.set(row.dataset.progressKey, Number(fill.dataset.targetWidth));
        });
      });
    });
  }

  function applyLabelReserve(bars) {
    bars.style.paddingLeft = '0px';
    bars.style.paddingRight = '0px';
    bars.style.paddingTop = '0px';
    bars.style.paddingBottom = '0px';
    if (!settings.showLabels || settings.labelPlacement !== 'outside') return;

    const labels = [...bars.querySelectorAll('.mark-label')];
    if (!labels.length) return;
    const maxWidth = Math.max(...labels.map(label => label.getBoundingClientRect().width), 0);
    const lineHeight = Math.max(settings.labelFontSize * 1.25, ...labels.map(label => label.getBoundingClientRect().height));
    const reserveX = Math.ceil(maxWidth + settings.labelGap + 8);
    const reserveY = Math.ceil(lineHeight + settings.labelGap + 6);

    if (settings.labelVertical === 'middle' && settings.labelHorizontal === 'left') bars.style.paddingLeft = `${reserveX}px`;
    if (settings.labelVertical === 'middle' && settings.labelHorizontal === 'right') bars.style.paddingRight = `${reserveX}px`;
    if (settings.labelVertical === 'top') bars.style.paddingTop = `${reserveY}px`;
    if (settings.labelVertical === 'bottom') bars.style.paddingBottom = `${reserveY}px`;
  }

  function applyViewMode(stage, bars, rowCount) {
    const content = $('content');
    const pad = 20;
    const availW = Math.max(80, content.clientWidth - pad);
    const availH = Math.max(40, content.clientHeight - pad);
    const naturalW = 800;
    const naturalH = Math.max(settings.barHeight, rowCount * settings.barHeight + Math.max(0, rowCount - 1) * settings.rowGap);

    stage.style.transform = '';
    stage.style.width = '';
    stage.style.height = '';
    bars.style.width = '';

    if (settings.viewMode === 'standard') {
      stage.style.width = `${naturalW}px`;
      bars.style.width = `${naturalW}px`;
      return;
    }
    if (settings.viewMode === 'fit-width') {
      stage.style.width = `${availW}px`;
      bars.style.width = '100%';
      return;
    }
    if (settings.viewMode === 'fit-height') {
      const scale = Math.max(0.05, availH / Math.max(1, naturalH));
      stage.style.width = `${naturalW}px`;
      stage.style.height = `${availH}px`;
      bars.style.width = `${naturalW}px`;
      bars.style.transformOrigin = 'top left';
      bars.style.transform = `scaleY(${scale})`;
      return;
    }
    if (settings.viewMode === 'entire-view') {
      const sx = availW / naturalW;
      const sy = availH / Math.max(1, naturalH);
      stage.style.width = `${availW}px`;
      stage.style.height = `${availH}px`;
      bars.style.width = `${naturalW}px`;
      bars.style.transformOrigin = 'top left';
      bars.style.transform = `scale(${sx}, ${sy})`;
    }
  }

  function showConfiguredTooltip(d, event) {
    const tooltip = $('tableauTooltip');
    if (!tooltip || !settings.showTooltips || !d.tooltip) return;

    tooltip.textContent = d.tooltip;
    tooltip.style.fontFamily = settings.tooltipFontFamily;
    tooltip.style.fontSize = `${settings.tooltipFontSize}px`;
    tooltip.style.color = settings.tooltipColor;
    tooltip.style.backgroundColor = settings.tooltipBackgroundColor;
    tooltip.style.borderColor = settings.tooltipBorderColor;
    tooltip.style.fontWeight = settings.tooltipBold ? '700' : '400';
    tooltip.style.fontStyle = settings.tooltipItalic ? 'italic' : 'normal';
    tooltip.classList.remove('hidden');
    positionTooltip(event);
  }

  function positionTooltip(event) {
    const tooltip = $('tableauTooltip');
    if (!tooltip || tooltip.classList.contains('hidden')) return;
    const margin = 14;
    const x = event && Number.isFinite(event.clientX) ? event.clientX : 0;
    const y = event && Number.isFinite(event.clientY) ? event.clientY : 0;
    requestAnimationFrame(() => {
      const r = tooltip.getBoundingClientRect();
      let left = x + margin;
      let top = y + margin;
      if (left + r.width > window.innerWidth - 6) left = Math.max(6, x - r.width - margin);
      if (top + r.height > window.innerHeight - 6) top = Math.max(6, y - r.height - margin);
      tooltip.style.left = `${left}px`;
      tooltip.style.top = `${top}px`;
    });
  }

  function hideConfiguredTooltip() {
    const tooltip = $('tableauTooltip');
    if (tooltip) tooltip.classList.add('hidden');
  }

  function renderLabelTemplate(template, values, fallback) {
    const source = String(template || '').trim();
    if (!source) return fallback;
    return source.replace(/<([^<>]+)>/g, (match, field) => {
      const exact = values[field];
      if (exact !== undefined) return exact;
      const normalized = values[normalizeFieldName(field)];
      return normalized !== undefined ? normalized : match;
    });
  }

  function applyBackground() {
    const bg = settings.transparentBackground ? 'transparent' : settings.backgroundColor;
    [document.documentElement, document.body, $('app'), $('content')].forEach(el => {
      if (!el) return;
      el.style.setProperty('background-color', bg, 'important');
      el.style.setProperty('background-image', 'none', 'important');
    });
  }

  function findColumn(dataTable, fieldName) {
    if (!fieldName) return null;
    let col = dataTable.columns.find(c => c.fieldName === fieldName);
    if (col) return col;
    const normalized = normalizeFieldName(fieldName);
    return dataTable.columns.find(c => normalizeFieldName(c.fieldName) === normalized) || null;
  }

  function normalizeFieldName(name) {
    return String(name || '').replace(/\s+/g, '').replace(/^(SUM|AVG|MIN|MAX|ATTR|CNT|COUNT|MEDIAN)\((.*)\)$/i, '$2').toLowerCase();
  }
  function nativeValue(cell) {
    if (!cell) return null;
    if ('nativeValue' in cell && cell.nativeValue !== undefined) return cell.nativeValue;
    return cell.value;
  }
  function displayValue(cell) {
    if (!cell) return '';
    if (cell.formattedValue != null) return String(cell.formattedValue);
    if (cell.value != null) return String(cell.value);
    if (cell.nativeValue != null) return String(cell.nativeValue);
    return '';
  }
  function renderEmpty(title, body) {
    $('content').innerHTML = `<div class="empty-state"><div><strong>${escapeHtml(title)}</strong><span>${escapeHtml(body)}</span></div></div>`;
  }
  function showFatal(message) { applyBackground(); renderEmpty('Gradient Progress Bar', message); showError(message); }
  function showError(message) { const t = $('errorToast'); t.textContent = message; t.classList.remove('hidden'); setTimeout(hideError, 7000); }
  function hideError() { $('errorToast').classList.add('hidden'); }
  function clamp(v, min, max) { return Math.min(max, Math.max(min, v)); }
  function formatError(err) { return err && err.message ? err.message : String(err); }
  function escapeHtml(s) { return String(s).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&#039;'); }
})();
