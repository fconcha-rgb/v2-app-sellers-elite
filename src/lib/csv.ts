/** Descarga CSV con BOM UTF-8 (Excel es-CL friendly). Extraido de App.tsx
 *  para poder reutilizarlo desde las tablas de grupos. */
export const downloadCSV = (filename: string, headers: string[], rows: string[][]) => {
  var csv =
    headers.join(',') +
    '\n' +
    rows
      .map(function (r) {
        return r
          .map(function (c) {
            return '"' + String(c).replace(/"/g, '""') + '"';
          })
          .join(',');
      })
      .join('\n');
  var blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
  var url = URL.createObjectURL(blob);
  var a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
};
