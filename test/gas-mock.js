// Minimal in-memory stand-ins for the Apps Script services Code.gs uses.
// Works in Node (require) and in a browser page (window.installGasMock).
(function (root) {
  function install(g) {
    const sheets = {};
    function makeSheet() {
      const rows = []; // array of arrays
      const range = (r, c, nr = 1, nc = 1) => ({
        getValues: () => Array.from({ length: nr }, (_, i) => Array.from({ length: nc }, (_, j) => ((rows[r - 1 + i] || [])[c - 1 + j] ?? ''))),
        getValue: () => (rows[r - 1] || [])[c - 1] ?? '',
        setValues(vals) {
          vals.forEach((row, i) => row.forEach((v, j) => {
            rows[r - 1 + i] = rows[r - 1 + i] || [];
            // Mimic Sheets: a leading apostrophe forces text and is not shown.
            rows[r - 1 + i][c - 1 + j] = typeof v === 'string' && v.startsWith("'") ? v.slice(1) : v;
            if (typeof v === 'string' && /^[=+\-@]/.test(v)) throw new Error('Formula written to sheet: ' + v);
          }));
          return this;
        },
        setNumberFormat() { return this; },
        setFontWeight() { return this; },
      });
      return {
        rows,
        getRange: range,
        getLastRow: () => rows.length,
        getMaxRows: () => 1000,
        setFrozenRows() {},
        deleteRow: (r) => rows.splice(r - 1, 1),
      };
    }
    const props = {};
    let uuid = 0;
    g.SpreadsheetApp = {
      getActiveSpreadsheet: () => ({
        getSheetByName: (n) => sheets[n] || null,
        insertSheet: (n) => (sheets[n] = makeSheet()),
      }),
    };
    g.LockService = { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) };
    g.PropertiesService = { getScriptProperties: () => ({ getProperty: (k) => props[k] ?? null, setProperty: (k, v) => (props[k] = v) }) };
    g.Utilities = {
      getUuid: () => 'uuid-' + ++uuid,
      formatDate: (d) => d.toISOString().slice(0, 16).replace('T', ' '),
    };
    g.Session = { getScriptTimeZone: () => 'America/New_York' };
    g.HtmlService = {};
    return { sheets, props };
  }
  if (typeof module === 'object' && module.exports) module.exports = install;
  else root.installGasMock = install;
})(this);
