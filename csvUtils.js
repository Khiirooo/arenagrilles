// Éviter les formules actives lorsque les résultats sont ouverts dans Excel.
export function csvCell(value) {
  const raw = String(value ?? "");
  const safe = /^[\s\u0000-\u001f]*[=+\-@]/u.test(raw) ? "'" + raw : raw;
  return '"' + safe.replaceAll('"', '""') + '"';
}

export function csvFromRows(rows) {
  // Le séparateur « ; » est généralement reconnu par Excel en locale fr-BE.
  return rows.map((row) => row.map(csvCell).join(";")).join("\r\n");
}
