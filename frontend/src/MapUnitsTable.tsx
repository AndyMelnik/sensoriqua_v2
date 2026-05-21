import { useState, useMemo } from 'react';
import { downloadXlsxFile } from './exportXlsx';

export type MapTableColumn = { key: string; label: string };
export type MapTableRow = Record<string, string | number | null | undefined>;

export function MapUnitsTable({
  columns,
  rows,
  defaultHiddenKeys = [],
}: {
  columns: MapTableColumn[];
  rows: MapTableRow[];
  defaultHiddenKeys?: string[];
}) {
  const [sortBy, setSortBy] = useState<string | null>(null);
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');
  const [search, setSearch] = useState('');
  const [hiddenKeys, setHiddenKeys] = useState<Set<string>>(new Set(defaultHiddenKeys));
  const [pageSize, setPageSize] = useState(20);
  const [page, setPage] = useState(1);

  const visibleColumns = useMemo(
    () => columns.filter((c) => !hiddenKeys.has(c.key)),
    [columns, hiddenKeys]
  );

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

  const toggleColumn = (key: string) => {
    setHiddenKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const formatCell = (key: string, value: string | number | null | undefined): string => {
    if (value == null) return '—';
    if (key === 'lat' || key === 'lon') {
      return typeof value === 'number' ? value.toFixed(6) : String(value);
    }
    if (typeof value === 'number') {
      return value.toLocaleString(undefined, { maximumFractionDigits: 4 });
    }
    return String(value);
  };

  const exportXlsx = () => {
    const visibleCols = columns.filter((c) => !hiddenKeys.has(c.key));
    void downloadXlsxFile(
      `sensoriqua-map-units-${new Date().toISOString().slice(0, 10)}.xlsx`,
      'Map units',
      visibleCols.map((c) => c.label),
      sortedRows.map((r) => visibleCols.map((c) => formatCell(c.key, r[c.key])))
    );
  };

  return (
    <div className="map-units-table-container">
      <div className="map-units-table-toolbar">
        <input
          type="text"
          className="map-units-table-search"
          placeholder="Lookup / filter…"
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
            setPage(1);
          }}
          aria-label="Search table"
        />
        <details className="map-units-table-columns-toggle">
          <summary>Columns</summary>
          <div className="map-units-table-columns-list">
            {columns.map((col) => (
              <label key={col.key} className="map-units-table-column-check">
                <input
                  type="checkbox"
                  checked={!hiddenKeys.has(col.key)}
                  onChange={() => toggleColumn(col.key)}
                />
                {col.label}
              </label>
            ))}
          </div>
        </details>
        <div className="map-units-table-pagination-controls">
          <label htmlFor="map-units-pagesize" className="map-units-pagesize-label">Rows</label>
          <select
            id="map-units-pagesize"
            className="map-units-pagesize-select"
            value={pageSize}
            onChange={(e) => {
              setPageSize(Number(e.target.value));
              setPage(1);
            }}
            aria-label="Rows per page"
          >
            {[10, 20, 50, 100].map((n) => (
              <option key={n} value={n}>{n}</option>
            ))}
          </select>
        </div>
        <button type="button" className="btn-sm" onClick={exportXlsx}>
          Export XLSX
        </button>
      </div>
      <div className="map-units-table-wrap">
        <table className="map-units-table">
          <thead>
            <tr>
              {visibleColumns.map((col) => (
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
                {visibleColumns.map((col) => (
                  <td key={col.key}>{formatCell(col.key, row[col.key])}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="map-units-table-pagination">
        <span className="map-units-table-pagination-info">
          {totalRows === 0
            ? '0 rows'
            : `Showing ${start + 1}–${Math.min(start + pageSize, totalRows)} of ${totalRows}`}
        </span>
        <div className="map-units-table-pagination-buttons">
          <button
            type="button"
            className="btn-sm"
            disabled={currentPage <= 1}
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            aria-label="Previous page"
          >
            Prev
          </button>
          <span className="map-units-table-page-num">
            Page {currentPage} / {totalPages}
          </span>
          <button
            type="button"
            className="btn-sm"
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
