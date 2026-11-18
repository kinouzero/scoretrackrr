export function serializeCsv(rows: readonly (readonly (string | number)[])[]) {
  return (
    rows
      .map((row) =>
        row
          .map((value) => {
            const text =
              typeof value === 'number'
                ? String(value)
                : /^[\s\uFEFF]*[=+\-@]|^[\t\r\n]/.test(value)
                  ? `'${value}`
                  : value;
            return `"${text.replaceAll('"', '""')}"`;
          })
          .join(','),
      )
      .join('\r\n') + '\r\n'
  );
}
