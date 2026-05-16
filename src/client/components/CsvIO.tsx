import React, { useRef, useState } from 'react';

interface Props {
  exportUrl: string;
  exportFilename: string;
  // Returns {created, updated, errors}; thrown errors are caught & shown.
  onImport: (csvText: string) => Promise<{ created: number; updated: number; errors: string[] }>;
  onImported?: () => void;
  // Optional second export (e.g. group measurements). When set a second
  // button appears next to the main one.
  secondaryExport?: { url: string; filename: string; label: string };
}

const btnStyle: React.CSSProperties = {
  padding: '6px 14px',
  border: '1px solid #cbd5e1',
  borderRadius: 4,
  background: '#fff',
  cursor: 'pointer',
  fontSize: 13,
  fontWeight: 600,
  color: '#0f172a',
  textDecoration: 'none',
  display: 'inline-flex',
  alignItems: 'center',
  gap: 6,
};

export default function CsvIO({ exportUrl, exportFilename, onImport, onImported, secondaryExport }: Props) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const handleFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setBusy(true);
    setStatus(null);
    try {
      const text = await file.text();
      const result = await onImport(text);
      const parts = [
        `${result.created} created`,
        `${result.updated} updated`,
      ];
      if (result.errors.length > 0) parts.push(`${result.errors.length} errors`);
      setStatus(parts.join(' · ') + (result.errors.length ? '\n' + result.errors.slice(0, 5).join('\n') : ''));
      onImported?.();
    } catch (err) {
      setStatus('Import failed: ' + (err as Error).message);
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  return (
    <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
      <a href={exportUrl} download={exportFilename} style={btnStyle}>
        ⬇ Export CSV
      </a>
      {secondaryExport && (
        <a href={secondaryExport.url} download={secondaryExport.filename} style={btnStyle}>
          ⬇ {secondaryExport.label}
        </a>
      )}
      <button
        type="button"
        style={{ ...btnStyle, opacity: busy ? 0.6 : 1 }}
        onClick={() => fileRef.current?.click()}
        disabled={busy}
      >
        ⬆ Import CSV
      </button>
      <input
        ref={fileRef}
        type="file"
        accept=".csv,text/csv"
        onChange={handleFile}
        style={{ display: 'none' }}
      />
      {status && (
        <span style={{ fontSize: 12, color: status.startsWith('Import failed') ? '#dc2626' : '#475569', whiteSpace: 'pre-line' }}>
          {status}
        </span>
      )}
    </div>
  );
}
