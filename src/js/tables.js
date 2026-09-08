/**
 * Table rendering and export functionality
 */

/**
 * Resolve the raw attribute(s) a capability reads from.
 * Returns { keys: [...actual keys found], values: {key: value} }
 */
function resolveRawValues(cap, vehicleData) {
  const wanted = cap.rawKeys || (cap.rawKey ? [cap.rawKey] : []);
  const found = [];
  for (const key of wanted) {
    const actual = findRawKey(vehicleData, key);
    if (actual !== undefined) {
      found.push(actual);
      if (!cap.merge) break; // fallback order: first present wins
    }
  }
  const values = {};
  for (const k of found) values[k] = vehicleData[k];
  return { keys: found, values };
}

function formatRaw(value) {
  if (value !== null && typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

function formatHomeyValue(value, unit) {
  if (value === undefined || value === null || Number.isNaN(value)) return '';
  return unit ? `${value} ${unit}` : String(value);
}

const NOT_REPORTED = '<span class="not-reported">Not reported by vehicle</span>';
const PUSH_ONLY = '<span class="not-reported">Not in REST data (push only)</span>';
const NOT_HERE = '<span class="not-reported">Not available here</span>';

/**
 * Render the capabilities table with vehicle data
 */
function renderCapabilitiesTable(vehicleData) {
  const tbody = document.querySelector('#capabilities-table tbody');
  tbody.innerHTML = '';

  let hasData = false;

  for (const cap of CAPABILITY_MAPPINGS) {
    const { keys, values } = resolveRawValues(cap, vehicleData);
    const notReported = keys.length === 0;
    const wanted = cap.rawKeys || (cap.rawKey ? [cap.rawKey] : []);

    let homeyValue;
    let rawKeyDisplay;
    let rawValueDisplay;
    let rowClass = '';
    let absentText = NOT_REPORTED;

    if (!notReported) {
      hasData = true;
      try {
        homeyValue = cap.merge
          ? cap.transform(values, keys, vehicleData)
          : cap.transform(values[keys[0]], keys[0], vehicleData);
      } catch (e) {
        homeyValue = formatRaw(values[keys[0]]);
      }
      rawKeyDisplay = keys.map(k => `<code>${escapeHtml(k)}</code>`).join('<br>');
      rawValueDisplay = keys.map(k => `<code>${escapeHtml(formatRaw(values[k]))}</code>`).join('<br>');
    } else if (cap.source) {
      rowClass = 'row-other-source';
      absentText = NOT_HERE;
      rawKeyDisplay = `<span class="other-source">${escapeHtml(cap.source)}</span>`;
      rawValueDisplay = '<span class="not-reported">—</span>';
    } else {
      const fallback = cap.whenAbsent ? cap.whenAbsent(vehicleData) : undefined;
      homeyValue = fallback;
      if (cap.pushOnly) {
        rowClass = 'row-other-source';
        absentText = PUSH_ONLY;
      } else {
        rowClass = fallback !== undefined ? 'row-defaulted' : 'row-not-reported';
      }
      rawKeyDisplay = wanted.map(k => `<code>${escapeHtml(k)}</code>`).join('<br>');
      if (cap.pushOnly) rawKeyDisplay += `<div class="other-source">${escapeHtml(PUSH_ONLY_NOTE)}</div>`;
      rawValueDisplay = '<span class="not-reported">—</span>';
    }

    let valueDisplay;
    if (homeyValue === undefined || homeyValue === null || homeyValue === '' || Number.isNaN(homeyValue)) {
      valueDisplay = absentText;
    } else {
      valueDisplay = escapeHtml(formatHomeyValue(homeyValue, cap.unit));
      if (notReported) valueDisplay += ' <span class="note">(default when absent)</span>';
    }

    const noteHtml = cap.note ? `<div class="note">${escapeHtml(cap.note)}</div>` : '';
    const proposedHtml = cap.proposed ? ` <span class="badge badge-proposed" title="${escapeHtml(cap.proposed)}">Proposed</span>` : '';

    const tr = document.createElement('tr');
    if (rowClass) tr.classList.add(rowClass);
    if (cap.proposed) tr.classList.add('row-proposed');
    tr.innerHTML = `
      <td><span class="cap-title">${escapeHtml(cap.title)}</span>${proposedHtml}<div class="cap-id"><code>${escapeHtml(cap.id)}</code></div>${noteHtml}</td>
      <td>${valueDisplay}</td>
      <td>${rawKeyDisplay}</td>
      <td>${rawValueDisplay}</td>
    `;
    tbody.appendChild(tr);
  }

  if (!hasData) {
    const tr = document.createElement('tr');
    tr.innerHTML = '<td colspan="4" class="no-data">No capability data available</td>';
    tbody.appendChild(tr);
  }
}

/**
 * Render the table of raw attributes that no Homey capability reads
 */
function renderUnmappedTable(vehicleData) {
  const tbody = document.querySelector('#unmapped-table tbody');
  tbody.innerHTML = '';

  // Every attribute name any capability mapping can read (case-insensitive)
  const mapped = new Set();
  for (const cap of CAPABILITY_MAPPINGS) {
    for (const key of cap.rawKeys || (cap.rawKey ? [cap.rawKey] : [])) {
      mapped.add(key.toLowerCase());
    }
  }
  const meta = new Set(['vin', 'timestamp', 'full_update']);

  const unmapped = Object.keys(vehicleData)
    .filter(key => !meta.has(key) && !key.endsWith('_display') && !key.endsWith('_unit'))
    .filter(key => !mapped.has(key.toLowerCase()))
    .sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()));

  for (const key of unmapped) {
    const display = vehicleData[`${key}_display`];
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td><code>${escapeHtml(key)}</code></td>
      <td><code>${escapeHtml(formatRaw(vehicleData[key]))}</code></td>
      <td>${display !== undefined ? escapeHtml(String(display)) : '<span class="not-reported">—</span>'}</td>
    `;
    tbody.appendChild(tr);
  }

  if (unmapped.length === 0) {
    const tr = document.createElement('tr');
    tr.innerHTML = '<td colspan="3" class="no-data">Every attribute received is read by a Homey capability</td>';
    tbody.appendChild(tr);
  }

  progressLog(`${unmapped.length} attribute(s) received that no Homey capability reads`);
}

/**
 * Render the logic flows table
 */
function renderFlowsTable() {
  const tbody = document.querySelector('#flows-table tbody');
  tbody.innerHTML = '';

  const allFlows = [
    ...FLOW_ACTIONS.map(f => ({ ...f, type: 'Action' })),
    ...FLOW_CONDITIONS.map(f => ({ ...f, type: 'Condition' })),
    ...FLOW_TRIGGERS.map(f => ({ ...f, type: 'Trigger' })),
  ];

  for (const flow of allFlows) {
    const extras = [];
    if (flow.args) extras.push(`<div class="note"><strong>Arguments:</strong> ${escapeHtml(flow.args)}</div>`);
    if (flow.tokens) extras.push(`<div class="note"><strong>Tokens:</strong> ${escapeHtml(flow.tokens)}</div>`);
    const deprecated = flow.deprecated ? ' <span class="badge badge-deprecated">Deprecated</span>' : '';
    const proposed = flow.proposed ? ` <span class="badge badge-proposed" title="${escapeHtml(flow.proposed)}">Proposed</span>` : '';

    const tr = document.createElement('tr');
    if (flow.deprecated) tr.classList.add('row-deprecated');
    if (flow.proposed) tr.classList.add('row-proposed');
    tr.innerHTML = `
      <td>${escapeHtml(flow.title)}</td>
      <td><span class="badge badge-${flow.type.toLowerCase()}">${escapeHtml(flow.type)}</span>${deprecated}${proposed}</td>
      <td><code>${escapeHtml(flow.id)}</code></td>
      <td>${escapeHtml(flow.description)}${extras.join('')}</td>
    `;
    tbody.appendChild(tr);
  }
}

/**
 * Copy capabilities table to clipboard as TSV (tab-separated values)
 */
async function copyTableToClipboard() {
  let output = 'Capability Name\tCapability ID\tHomey Value\tRaw Data Key\tRaw Value\n';

  const capRows = document.querySelectorAll('#capabilities-table tbody tr');
  for (const row of capRows) {
    const cells = row.querySelectorAll('td');
    if (cells.length === 4) {
      const titleEl = cells[0].querySelector('.cap-title');
      const idEl = cells[0].querySelector('.cap-id');
      const title = titleEl ? titleEl.textContent.trim() : cells[0].textContent.trim();
      const id = idEl ? idEl.textContent.trim() : '';
      const keys = Array.from(cells[2].querySelectorAll('code')).map(c => c.textContent).join(' | ') || cells[2].textContent.trim();
      const values = Array.from(cells[3].querySelectorAll('code')).map(c => c.textContent).join(' | ') || cells[3].textContent.trim();
      output += `${title}\t${id}\t${cells[1].textContent.trim()}\t${keys}\t${values}\n`;
    }
  }

  await copyToClipboard(output, 'copy-btn', 'Table copied to clipboard');
}

/**
 * Copy raw key/value pairs to clipboard
 */
async function copyRawDataToClipboard() {
  let output = '';
  const seen = new Set();

  const capRows = document.querySelectorAll('#capabilities-table tbody tr');
  for (const row of capRows) {
    const cells = row.querySelectorAll('td');
    if (cells.length === 4) {
      const keys = Array.from(cells[2].querySelectorAll('code')).map(c => c.textContent);
      const values = Array.from(cells[3].querySelectorAll('code')).map(c => c.textContent);
      keys.forEach((key, i) => {
        if (seen.has(key)) return;
        seen.add(key);
        output += `${key} = ${values[i] !== undefined ? values[i] : '—'}\n`;
      });
    }
  }

  output += powertrainExport();

  await copyToClipboard(output, 'copy-raw-btn', 'Raw data copied to clipboard');
}

/**
 * The powertrain block both raw exports carry.
 *
 * Whichever raw button an owner presses, the paste has to answer why their car
 * was classified the way it was - that is the whole point of asking them for
 * an export - so neither button is allowed to be the one that leaves it out.
 */
function powertrainExport() {
  if (typeof powertrainExportText !== 'function') return '';
  return powertrainExportText(typeof currentPowertrain !== 'undefined' ? currentPowertrain : null);
}

/**
 * Helper: write text to clipboard with button feedback
 */
async function copyToClipboard(text, btnId, logMessage) {
  try {
    await navigator.clipboard.writeText(text);
    showCopyFeedback(btnId);
    progressLog(logMessage);
  } catch (e) {
    progressLog('Failed to copy: ' + e.message);
    const ta = document.createElement('textarea');
    ta.value = text;
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    document.body.removeChild(ta);
    showCopyFeedback(btnId);
    progressLog(logMessage + ' (fallback)');
  }
}

/**
 * Copy all raw API key/value pairs to clipboard
 */
async function copyRawApiToClipboard() {
  // Which build produced the export: a report from a stale page has cost a
  // round trip before.
  const build = (typeof PROXY_CONFIG !== 'undefined' && PROXY_CONFIG.build) || 'unknown';
  let output = `# Mercedes-Benz Data Explorer (build ${build})\n\n`;

  const keys = Object.keys(currentVehicleData).sort();
  for (const key of keys) {
    output += `${key} = ${formatRaw(currentVehicleData[key])}\n`;
  }

  output += powertrainExport();

  await copyToClipboard(output, 'copy-raw-api-btn', 'Raw API values copied to clipboard');
}

function showCopyFeedback(btnId) {
  const btn = document.getElementById(btnId);
  const originalText = btn.textContent;
  btn.textContent = 'Copied!';
  btn.classList.add('copied');
  setTimeout(() => {
    btn.textContent = originalText;
    btn.classList.remove('copied');
  }, 2000);
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}
