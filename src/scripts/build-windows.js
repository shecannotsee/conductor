// Use an isolated copy of the pinned NSIS templates, preserving builder's
// normal two-stage installer/uninstaller generation and signing pipeline.
const templates = require('./prepare-installer');
require('app-builder-lib/out/targets/nsis/nsisUtil').nsisTemplatesDir = templates;
const { build, Platform, Arch } = require('electron-builder');
build({ targets: Platform.WINDOWS.createTarget(['nsis'], Arch.x64), config: 'electron-builder.windows.yml' })
  .catch(error => { console.error(error); process.exit(1); });
