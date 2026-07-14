/**
 * Table rendering and export functionality
 */

/**
 * Render the capabilities table with vehicle data
 */
function renderCapabilitiesTable(vehicleData) {
  const tbody = document.querySelector('#capabilities-table tbody');
  tbody.innerHTML = '';

  let hasData = false;

  for (const cap of CAPABILITY_MAPPINGS) {
    // Try to find the raw value - check multiple possible key formats
    const rawKey = cap.rawKey;
    let rawValue = vehicleData[rawKey];

    // Also try camelCase variants
    if (rawValue === undefined) {
      const camelKey = rawKey.charAt(0).toUpperCase() + rawKey.slice(1);
      rawValue = vehicleData[camelKey];
    }

    const notReported = rawValue === undefined;

    if (!notReported) hasData = true;

    let displayValue = '';
    let rawDisplay = '';
    if (notReported) {
      displayValue = '<span class="not-reported">Not reported by vehicle</span>';
      rawDisplay = '<span class="not-reported">—</span>';
    } else {
      let homeyValue;
      try {
        homeyValue = cap.transform(rawValue);
      } catch (e) {
        homeyValue = String(rawValue);
      }
      const formatted = cap.unit ? `${homeyValue} ${cap.unit}` : String(homeyValue);
      displayValue = escapeHtml(formatted);
      rawDisplay = `<code>${escapeHtml(String(rawValue))}</code>`;
    }

    const tr = document.createElement('tr');
    if (notReported) tr.classList.add('row-not-reported');
    tr.innerHTML = `
      <td>${escapeHtml(cap.title)}</td>
      <td>${displayValue}</td>
      <td><code>${escapeHtml(rawKey)}</code></td>
      <td>${rawDisplay}</td>
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
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${escapeHtml(flow.title)}</td>
      <td><span class="badge badge-${flow.type.toLowerCase()}">${escapeHtml(flow.type)}</span></td>
      <td>${escapeHtml(flow.id)}</td>
      <td>${escapeHtml(flow.description)}</td>
    `;
    tbody.appendChild(tr);
  }
}

/**
 * Copy capabilities table to clipboard as TSV (tab-separated values)
 */
async function copyTableToClipboard() {
  let output = 'Capability Name\tHomey Value\tRaw Data Key\tRaw Value\n';

  const capRows = document.querySelectorAll('#capabilities-table tbody tr');
  for (const row of capRows) {
    const cells = row.querySelectorAll('td');
    if (cells.length === 4) {
      output += `${cells[0].textContent}\t${cells[1].textContent}\t${cells[2].textContent}\t${cells[3].textContent}\n`;
    }
  }

  await copyToClipboard(output, 'copy-btn', 'Table copied to clipboard');
}

/**
 * Copy raw key/value pairs to clipboard
 */
async function copyRawDataToClipboard() {
  let output = '';

  const capRows = document.querySelectorAll('#capabilities-table tbody tr');
  for (const row of capRows) {
    const cells = row.querySelectorAll('td');
    if (cells.length === 4) {
      output += `${cells[2].textContent} = ${cells[3].textContent}\n`;
    }
  }

  await copyToClipboard(output, 'copy-raw-btn', 'Raw data copied to clipboard');
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
  let output = '';
  const keys = Object.keys(currentVehicleData).sort();
  for (const key of keys) {
    output += `${key} = ${currentVehicleData[key]}\n`;
  }
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
