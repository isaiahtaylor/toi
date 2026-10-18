// RFC 4180 CSV parser: quoted fields, doubled quotes, commas and newlines inside quotes,
// CRLF or LF line ends. Unquoted fields are sliced with indexOf, so a 6 MB file with
// 35,000 rows parses in a few hundred milliseconds. parseCSVAsync does the same work in
// slices and yields to the main thread between them, so scrolling stays smooth while
// the explorer loads.

// Parse up to maxRows complete rows from state; returns true when the text is used up.
function parseSome(state, maxRows) {
  const { text } = state;
  const n = text.length;
  let { i, row } = state;
  const { rows } = state;
  const stop = rows.length + maxRows;
  while (i < n && rows.length < stop) {
    let field;
    if (text.charCodeAt(i) === 34) { // opening quote
      let j = i + 1;
      let out = '';
      for (;;) {
        const q = text.indexOf('"', j);
        if (q < 0) { out += text.slice(j); j = n; break; }
        out += text.slice(j, q);
        if (text.charCodeAt(q + 1) === 34) { out += '"'; j = q + 2; continue; }
        j = q + 1;
        break;
      }
      field = out;
      i = j;
    } else {
      let comma = text.indexOf(',', i);
      let nl = text.indexOf('\n', i);
      if (comma < 0) comma = n;
      if (nl < 0) nl = n;
      const end = comma < nl ? comma : nl;
      field = text.slice(i, end);
      if (end === nl && field.endsWith('\r')) field = field.slice(0, -1);
      i = end;
    }
    row.push(field);
    const c = text.charCodeAt(i);
    if (c === 44) { i++; continue; } // comma: next field
    if (c === 13) i++;
    if (text.charCodeAt(i) === 10 || i >= n) {
      i++;
      if (!(row.length === 1 && row[0] === '')) rows.push(row);
      row = [];
    }
  }
  state.i = i;
  state.row = row;
  return i >= n;
}

function start(text) {
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  return { text, i: 0, row: [], rows: [] };
}

function finish(state) {
  const { rows, row } = state;
  if (row.length && !(row.length === 1 && row[0] === '')) rows.push(row);
  const header = rows.shift() || [];
  return { header, rows };
}

export function parseCSV(text) {
  const state = start(text);
  parseSome(state, Infinity);
  return finish(state);
}

export function yieldToMain() {
  if (globalThis.scheduler && typeof globalThis.scheduler.yield === 'function') return globalThis.scheduler.yield();
  return new Promise((resolve) => setTimeout(resolve, 0));
}

export async function parseCSVAsync(text, rowsPerSlice = 2000) {
  const state = start(text);
  while (!parseSome(state, rowsPerSlice)) await yieldToMain();
  return finish(state);
}
