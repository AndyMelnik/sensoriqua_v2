import ExcelJS from 'exceljs';

/** Build and download an .xlsx file (write-only; no parsing of untrusted uploads). */
export async function downloadXlsxFile(
  filename: string,
  sheetName: string,
  headerRow: string[],
  dataRows: (string | number | null | undefined)[][]
): Promise<void> {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet(sheetName);
  sheet.addRow(headerRow);
  dataRows.forEach((row) => sheet.addRow(row.map((cell) => cell ?? '')));
  const buffer = await workbook.xlsx.writeBuffer();
  const blob = new Blob([buffer], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
