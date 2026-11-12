const fs = require('node:fs');
const assert = require('node:assert/strict');
for (const file of process.argv.slice(2)) {
  const handle = fs.openSync(file, 'r');
  try {
    const bytes = Buffer.alloc(2 * 1024 * 1024);
    const count = fs.readSync(handle, bytes, 0, bytes.length, 0);
    const stub = bytes.subarray(0, count).toString('utf8');
    assert.match(stub, /<dpiAwareness[^>]*>PerMonitorV2,PerMonitor<\/dpiAwareness>/);
    assert.match(stub, /<dpiAware[^>]*>true<\/dpiAware>/);
  } finally { fs.closeSync(handle); }
}
console.log('PASS: installer and uninstaller PE manifests include PerMonitorV2 and legacy DPI fallback.');
