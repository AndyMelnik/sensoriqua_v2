import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import type { ReportTableColumn, ReportTableRow } from './ReportTable';

export type ReportLegendItem = { label: string; color: string };

export const DEFAULT_REPORT_TITLE = 'Sensor reading report';

export type FullReportExportInput = {
  title: string;
  description?: string;
  chartSvg: string;
  legendItems: ReportLegendItem[];
  columns: ReportTableColumn[];
  tableRows: ReportTableRow[];
  summaryColumns: ReportTableColumn[];
  summaryRows: ReportTableRow[];
  exportedAt?: Date;
};

export function reportFileSlug(title: string): string {
  return title.trim().replace(/[^\w\s-]/g, '').replace(/\s+/g, '-') || 'report';
}

type JsPdfWithAutoTable = jsPDF & {
  lastAutoTable?: { finalY: number };
};

const PDF_MARGIN_MM = 14;
const PDF_CHART_MAX_HEIGHT_MM = 72;

export function escapeReportHtml(s: string): string {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function formatTableCell(value: string | number | null | undefined, colKey: string): string {
  if (value == null || value === '') return '—';
  if (colKey === 'ts' || colKey === 'date') return String(value);
  if (typeof value === 'number') {
    return value.toLocaleString(undefined, { maximumFractionDigits: 4 });
  }
  const n = Number(value);
  if (!Number.isNaN(n) && String(value).trim() !== '') {
    return n.toLocaleString(undefined, { maximumFractionDigits: 4 });
  }
  return String(value);
}

export function buildFullReportHtml(input: FullReportExportInput): string {
  const exportedAt = input.exportedAt ?? new Date();
  const rawRows = input.tableRows
    .map(
      (row) =>
        `<tr>${input.columns.map((col) => `<td>${escapeReportHtml(formatTableCell(row[col.key], col.key))}</td>`).join('')}</tr>`
    )
    .join('');
  const rawHeader = `<thead><tr>${input.columns.map((c) => `<th>${escapeReportHtml(c.label)}</th>`).join('')}</tr></thead>`;
  const summaryRows = input.summaryRows
    .map(
      (row) =>
        `<tr>${input.summaryColumns.map((col) => `<td>${escapeReportHtml(formatTableCell(row[col.key], col.key))}</td>`).join('')}</tr>`
    )
    .join('');
  const summaryHeader = `<thead><tr>${input.summaryColumns.map((c) => `<th>${escapeReportHtml(c.label)}</th>`).join('')}</tr></thead>`;

  const title = (input.title || DEFAULT_REPORT_TITLE).trim() || DEFAULT_REPORT_TITLE;
  const description = (input.description || '').trim();

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <title>${escapeReportHtml(title)}</title>
  <style>
    @page { size: A4 landscape; margin: 1.2cm; }
    html, body { margin: 0; padding: 0; }
    body { font-family: system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: #fff; color: #0f172a; padding: 0.75rem 1rem; box-sizing: border-box; }
    h1 { font-size: 1.25rem; margin: 0 0 0.4rem; }
    h2 { font-size: 1.05rem; margin: 1.25rem 0 0.4rem; page-break-after: avoid; }
    .chart-wrap { margin-bottom: 0.5rem; overflow: visible; page-break-inside: avoid; }
    .chart-wrap svg, .chart-wrap img { display: block; width: 100%; height: auto; max-height: 9cm; }
    .chart-legend { display: flex; flex-wrap: wrap; gap: 0.4rem 0.9rem; margin: 0.35rem 0 0; padding: 0; list-style: none; font-size: 0.8rem; }
    .chart-legend-item { display: inline-flex; align-items: center; gap: 0.35rem; }
    .chart-legend-dot { width: 10px; height: 10px; border-radius: 50%; flex-shrink: 0; }
    table { width: 100%; border-collapse: collapse; font-size: 0.8rem; margin-bottom: 0.9rem; }
    th, td { padding: 0.35rem 0.5rem; text-align: left; border-bottom: 1px solid #d1d5db; color: #0f172a; }
    th { background: #f3f4f6; color: #374151; }
    .meta { font-size: 0.8rem; color: #4b5563; margin-bottom: 0.35rem; }
    .report-description { font-size: 0.9rem; color: #374151; margin: 0 0 0.6rem; line-height: 1.45; white-space: pre-wrap; }
    tr { page-break-inside: avoid; }
  </style>
</head>
<body>
  <h1>${escapeReportHtml(title)}</h1>
  ${description ? `<p class="report-description">${escapeReportHtml(description)}</p>` : ''}
  <p class="meta">Exported ${escapeReportHtml(exportedAt.toLocaleString())}</p>
  <h2>Graph</h2>
  <div class="chart-wrap">${input.chartSvg}</div>
  ${
    input.legendItems.length
      ? `<ul class="chart-legend">${input.legendItems
          .map(
            (item) =>
              `<li class="chart-legend-item"><span class="chart-legend-dot" style="background:${item.color}"></span><span>${escapeReportHtml(item.label)}</span></li>`
          )
          .join('')}</ul>`
      : ''
  }
  <h2>Raw data</h2>
  <table>${rawHeader}<tbody>${rawRows}</tbody></table>
  <h2>Summary</h2>
  <table>${summaryHeader}<tbody>${summaryRows}</tbody></table>
</body>
</html>`;
}

export function reportExportFilename(ext: 'html' | 'pdf', title?: string): string {
  const slug = reportFileSlug(title || DEFAULT_REPORT_TITLE);
  return `sensoriqua-${slug}-${new Date().toISOString().slice(0, 10)}.${ext}`;
}

export function downloadReportHtml(html: string, filename = reportExportFilename('html')): void {
  const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function prepareSvgMarkup(svgHtml: string): string {
  let s = svgHtml.trim();
  if (!s) return s;
  if (!/\sxmlns=/.test(s)) {
    s = s.replace(/<svg\b/, '<svg xmlns="http://www.w3.org/2000/svg"');
  }
  return s;
}

function parseSvgSize(svgHtml: string): { width: number; height: number } {
  const doc = new DOMParser().parseFromString(prepareSvgMarkup(svgHtml), 'image/svg+xml');
  const svg = doc.documentElement;
  const width = parseFloat(svg.getAttribute('width') || '700');
  const height = parseFloat(svg.getAttribute('height') || '280');
  return {
    width: Number.isFinite(width) && width > 0 ? width : 700,
    height: Number.isFinite(height) && height > 0 ? height : 280,
  };
}

async function svgToDataUrl(svgHtml: string): Promise<string> {
  const { width, height } = parseSvgSize(svgHtml);
  const svg = prepareSvgMarkup(svgHtml);
  const blob = new Blob([svg], { type: 'image/svg+xml;charset=utf-8' });
  const url = URL.createObjectURL(blob);

  try {
    return await new Promise<string>((resolve, reject) => {
      const img = new Image();
      img.onload = () => {
        const scale = 2;
        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.round(width * scale));
        canvas.height = Math.max(1, Math.round(height * scale));
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          reject(new Error('Canvas not available'));
          return;
        }
        ctx.scale(scale, scale);
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, width, height);
        ctx.drawImage(img, 0, 0, width, height);
        resolve(canvas.toDataURL('image/jpeg', 0.92));
      };
      img.onerror = () => reject(new Error('Failed to rasterize chart'));
      img.src = url;
    });
  } finally {
    URL.revokeObjectURL(url);
  }
}

function ensureSpace(doc: jsPDF, y: number, neededMm: number, pageHeight: number): number {
  if (y + neededMm <= pageHeight - PDF_MARGIN_MM) return y;
  doc.addPage();
  return PDF_MARGIN_MM;
}

function drawSectionTitle(doc: jsPDF, title: string, y: number): number {
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(12);
  doc.setTextColor(15, 23, 42);
  doc.text(title, PDF_MARGIN_MM, y);
  return y + 6;
}

function drawDataTable(
  doc: JsPdfWithAutoTable,
  columns: ReportTableColumn[],
  rows: ReportTableRow[],
  startY: number,
  pageWidth: number
): number {
  if (columns.length === 0 || rows.length === 0) {
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    doc.setTextColor(107, 114, 128);
    doc.text('No data', PDF_MARGIN_MM, startY);
    return startY + 6;
  }

  const head = [columns.map((c) => c.label)];
  const body = rows.map((row) => columns.map((col) => formatTableCell(row[col.key], col.key)));

  autoTable(doc, {
    startY,
    head,
    body,
    margin: { left: PDF_MARGIN_MM, right: PDF_MARGIN_MM },
    tableWidth: pageWidth - PDF_MARGIN_MM * 2,
    styles: {
      fontSize: 7,
      cellPadding: 1.5,
      overflow: 'linebreak',
      textColor: [15, 23, 42],
    },
    headStyles: {
      fillColor: [243, 244, 246],
      textColor: [55, 65, 81],
      fontStyle: 'bold',
    },
    alternateRowStyles: { fillColor: [249, 250, 251] },
    showHead: 'everyPage',
  });

  return (doc.lastAutoTable?.finalY ?? startY) + 8;
}

/** Build PDF programmatically (chart image + tables) — reliable alternative to HTML screenshot. */
export async function downloadReportPdf(
  input: FullReportExportInput,
  filename = reportExportFilename('pdf')
): Promise<void> {
  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' }) as JsPdfWithAutoTable;
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const contentWidth = pageWidth - PDF_MARGIN_MM * 2;
  let y = PDF_MARGIN_MM;

  const title = (input.title || DEFAULT_REPORT_TITLE).trim() || DEFAULT_REPORT_TITLE;
  const description = (input.description || '').trim();

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(16);
  doc.setTextColor(15, 23, 42);
  const titleLines = doc.splitTextToSize(title, contentWidth);
  doc.text(titleLines, PDF_MARGIN_MM, y);
  y += titleLines.length * 7 + 2;

  if (description) {
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(10);
    doc.setTextColor(55, 65, 81);
    const descLines = doc.splitTextToSize(description, contentWidth);
    y = ensureSpace(doc, y, descLines.length * 4 + 2, pageHeight);
    doc.text(descLines, PDF_MARGIN_MM, y);
    y += descLines.length * 4 + 4;
  }

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.setTextColor(75, 85, 99);
  doc.text(`Exported ${(input.exportedAt ?? new Date()).toLocaleString()}`, PDF_MARGIN_MM, y);
  y += 10;
  doc.setTextColor(15, 23, 42);

  if (input.chartSvg.trim()) {
    y = ensureSpace(doc, y, 12, pageHeight);
    y = drawSectionTitle(doc, 'Graph', y);

    try {
      const chartDataUrl = await svgToDataUrl(input.chartSvg);
      const { width, height } = parseSvgSize(input.chartSvg);
      let imgW = contentWidth;
      let imgH = (height / width) * imgW;
      if (imgH > PDF_CHART_MAX_HEIGHT_MM) {
        imgH = PDF_CHART_MAX_HEIGHT_MM;
        imgW = (width / height) * imgH;
      }
      y = ensureSpace(doc, y, imgH + 4, pageHeight);
      doc.addImage(chartDataUrl, 'JPEG', PDF_MARGIN_MM, y, imgW, imgH, undefined, 'FAST');
      y += imgH + 4;
    } catch {
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(9);
      doc.text('(Chart could not be embedded)', PDF_MARGIN_MM, y);
      y += 6;
    }

    if (input.legendItems.length > 0) {
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(8);
      const legendLines = input.legendItems.map((item) => `● ${item.label}`);
      const wrapped = doc.splitTextToSize(legendLines.join('    '), contentWidth);
      y = ensureSpace(doc, y, wrapped.length * 3.5 + 2, pageHeight);
      doc.text(wrapped, PDF_MARGIN_MM, y);
      y += wrapped.length * 3.5 + 6;
    }
  }

  y = ensureSpace(doc, y, 14, pageHeight);
  y = drawSectionTitle(doc, 'Raw data', y);
  y = drawDataTable(doc, input.columns, input.tableRows, y, pageWidth);

  y = ensureSpace(doc, y, 14, pageHeight);
  y = drawSectionTitle(doc, 'Summary', y);
  drawDataTable(doc, input.summaryColumns, input.summaryRows, y, pageWidth);

  doc.save(filename);
}
