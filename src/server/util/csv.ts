// Minimal RFC-4180-ish CSV serializer/parser. UTF-8 BOM + CRLF on output
// so Excel opens the file with the correct encoding.

export function csvEscape(value: unknown): string {
  if (value == null) return '';
  let s = typeof value === 'string' ? value : String(value);
  // Quote when value contains ", , CR, LF, or leading/trailing whitespace
  const needsQuote = /[",\r\n]/.test(s) || /^\s|\s$/.test(s);
  if (needsQuote) {
    s = '"' + s.replace(/"/g, '""') + '"';
  }
  return s;
}

export function toCsv(rows: Record<string, unknown>[], columns: string[]): string {
  const header = columns.map(csvEscape).join(',');
  const lines = rows.map(r => columns.map(c => csvEscape(r[c])).join(','));
  // BOM helps Excel pick up UTF-8
  return '﻿' + [header, ...lines].join('\r\n') + '\r\n';
}

// Parse a CSV string into an array of objects keyed by the header row.
// Supports quoted fields, escaped quotes, CRLF or LF line endings.
export function parseCsv(text: string): Record<string, string>[] {
  if (!text) return [];
  // Strip BOM
  if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1);

  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let i = 0;
  let inQuotes = false;
  const len = text.length;

  while (i < len) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (i + 1 < len && text[i + 1] === '"') {
          field += '"';
          i += 2;
        } else {
          inQuotes = false;
          i++;
        }
      } else {
        field += ch;
        i++;
      }
    } else {
      if (ch === '"') {
        inQuotes = true;
        i++;
      } else if (ch === ',') {
        row.push(field);
        field = '';
        i++;
      } else if (ch === '\r' || ch === '\n') {
        row.push(field);
        field = '';
        rows.push(row);
        row = [];
        // Skip CRLF as one line break
        if (ch === '\r' && i + 1 < len && text[i + 1] === '\n') i += 2;
        else i++;
      } else {
        field += ch;
        i++;
      }
    }
  }
  // Flush trailing field/row
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }

  // Drop fully-empty trailing rows
  while (rows.length > 0 && rows[rows.length - 1].every(c => c === '')) rows.pop();

  if (rows.length === 0) return [];

  const headers = rows[0].map(h => h.trim());
  const out: Record<string, string>[] = [];
  for (let r = 1; r < rows.length; r++) {
    const obj: Record<string, string> = {};
    for (let c = 0; c < headers.length; c++) {
      obj[headers[c]] = (rows[r][c] ?? '').trim();
    }
    out.push(obj);
  }
  return out;
}
