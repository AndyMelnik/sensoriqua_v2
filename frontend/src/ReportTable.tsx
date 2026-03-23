import { useState, useMemo } from 'react';
import * as XLSX from 'xlsx';

export type ReportTableColumn = { key: string; label: string };
export type ReportTableRow = { ts?: string; date?: string; [key: string]: string | number | null | undefined };

export function ReportTable({
  columns,
  rows,
  chartSvgHtml,
  onExportHtml,
  showExportHtml = true,
}: {
  columns: ReportTableColumn[];
  rows: ReportTableRow[];
  chartSvgHtml?: string | null;
  onExportHtml?: () => string | null;
  showExportHtml?: boolean;
}) {
  const [sortBy, setSortBy] = useState<string | null>(null);
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');
  const [search, setSearch] = useState('');
  const [pageSize, setPageSize] = useState(20);
  const [page, setPage] = useState(1);

  const filteredRows = useMemo(() => {
    if (!search.trim()) return rows;
    const q = search.trim().toLowerCase();
    return rows.filter((row) =>
      columns.some((col) => {
        const v = row[col.key];
        return v != null && String(v).toLowerCase().includes(q);
      })
    );
  }, [rows, columns, search]);

  const sortedRows = useMemo(() => {
    if (!sortBy) return filteredRows;
    const col = columns.find((c) => c.key === sortBy);
    if (!col) return filteredRows;
    return [...filteredRows].sort((a, b) => {
      const va = a[sortBy];
      const vb = b[sortBy];
      const aNum = typeof va === 'number' ? va : va != null ? Number(va) : NaN;
      const bNum = typeof vb === 'number' ? vb : vb != null ? Number(vb) : NaN;
      if (!Number.isNaN(aNum) && !Number.isNaN(bNum)) {
        return sortDir === 'asc' ? aNum - bNum : bNum - aNum;
      }
      const aStr = va != null ? String(va) : '';
      const bStr = vb != null ? String(vb) : '';
      const cmp = aStr.localeCompare(bStr);
      return sortDir === 'asc' ? cmp : -cmp;
    });
  }, [filteredRows, sortBy, sortDir, columns]);

  const pageSizeOptions = [20, 50, 100];
  const totalRows = sortedRows.length;
  const totalPages = Math.max(1, Math.ceil(totalRows / pageSize));
  const currentPage = Math.min(Math.max(1, page), totalPages);
  const start = (currentPage - 1) * pageSize;
  const paginatedRows = sortedRows.slice(start, start + pageSize);

  const handleSort = (key: string) => {
    setPage(1);
    if (sortBy === key) setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    else {
      setSortBy(key);
      setSortDir('asc');
    }
  };

  const handlePageSizeChange = (size: number) => {
    setPageSize(size);
    setPage(1);
  };

  const exportXlsx = () => {
    const wsData = [columns.map((c) => c.label), ...sortedRows.map((r) => columns.map((c) => r[c.key] ?? ''))];
    const ws = XLSX.utils.aoa_to_sheet(wsData);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Report');
    XLSX.writeFile(wb, `sensoriqua-report-${new Date().toISOString().slice(0, 10)}.xlsx`);
  };

  const exportHtml = () => {
    const chartSection = onExportHtml?.() ?? chartSvgHtml ?? '';
    const tableRows = sortedRows
      .map(
        (row) =>
          `<tr>${columns.map((col) => `<td>${escapeHtml(String(row[col.key] ?? ''))}</td>`).join('')}</tr>`
      )
      .join('');
    const tableHeader = `<thead><tr>${columns.map((c) => `<th>${escapeHtml(c.label)}</th>`).join('')}</tr></thead>`;
    const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <title>Sensoriqua Report</title>
  <style>
    @page { size: A4 landscape; margin: 1.2cm; }
    html, body { margin: 0; padding: 0; }
    body { font-family: system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: transparent; color: #0f172a; padding: 0.75rem 1rem; }
    h1 { font-size: 1.25rem; margin-bottom: 0.5rem; }
    .chart-wrap { margin-bottom: 1rem; overflow-x: auto; }
    .chart-wrap svg { width: 100%; height: auto; }
    table { width: 100%; border-collapse: collapse; font-size: 0.8rem; }
    th, td { padding: 0.35rem 0.5rem; text-align: left; border-bottom: 1px solid #d1d5db; }
    th { background: #f3f4f6; color: #374151; }
    .meta { font-size: 0.8rem; color: #4b5563; margin-bottom: 0.75rem; }
  </style>
</head>
<body>
  <h1>Sensor reading report</h1>
  <p class="meta">Exported ${new Date().toLocaleString()}</p>
  ${chartSection ? `<div class="chart-wrap">${chartSection}</div>` : ''}
  <table>
    ${tableHeader}
    <tbody>${tableRows}</tbody>
  </table>
</body>
</html>`;
    const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `sensoriqua-report-${new Date().toISOString().slice(0, 10)}.html`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="report-table-container">
      <div className="report-table-toolbar">
        <input
          type="text"
          className="report-table-search"
          placeholder="Search in table…"
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
            setPage(1);
          }}
          aria-label="Search table"
        />
        <div className="report-table-pagination-controls">
          <label htmlFor="report-table-pagesize" className="report-table-pagesize-label">Rows per page</label>
          <select
            id="report-table-pagesize"
            className="report-table-pagesize-select"
            value={pageSize}
            onChange={(e) => handlePageSizeChange(Number(e.target.value))}
            aria-label="Rows per page"
          >
            {pageSizeOptions.map((n) => (
              <option key={n} value={n}>{n}</option>
            ))}
          </select>
        </div>
        <div className="report-table-export">
          <button type="button" className="btn-sm" onClick={exportXlsx}>
            Export XLSX
          </button>
          {showExportHtml && (
            <button type="button" className="btn-sm" onClick={exportHtml}>
              Export HTML
            </button>
          )}
        </div>
      </div>
      <div className="reports-table-wrap">
        <table className="reports-table">
          <thead>
            <tr>
              {columns.map((col) => (
                <th
                  key={col.key}
                  className={sortBy === col.key ? 'sortable sorted' : 'sortable'}
                  onClick={() => handleSort(col.key)}
                  title="Click to sort"
                >
                  {col.label}
                  {sortBy === col.key && (sortDir === 'asc' ? ' ↑' : ' ↓')}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {paginatedRows.map((row, ri) => (
              <tr key={ri}>
                {columns.map((col) => (
                  <td key={col.key}>
                    {col.key === 'ts'
                      ? row.ts
                      : col.key === 'date'
                        ? row.date
                        : row[col.key] != null
                          ? Number(row[col.key]).toLocaleString(undefined, { maximumFractionDigits: 4 })
                          : '—'}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="report-table-pagination">
        <span className="report-table-pagination-info">
          {totalRows === 0
            ? '0 rows'
            : `Showing ${start + 1}–${Math.min(start + pageSize, totalRows)} of ${totalRows}`}
        </span>
        <div className="report-table-pagination-buttons">
          <button
            type="button"
            className="btn-sm report-table-page-btn"
            disabled={currentPage <= 1}
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            aria-label="Previous page"
          >
            Previous
          </button>
          <span className="report-table-page-num">
            Page {currentPage} of {totalPages}
          </span>
          <button
            type="button"
            className="btn-sm report-table-page-btn"
            disabled={currentPage >= totalPages}
            onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
            aria-label="Next page"
          >
            Next
          </button>
        </div>
      </div>
    </div>
  );
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
