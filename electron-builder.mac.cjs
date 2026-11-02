const { build } = require('./package.json');

// Local/CI test artifacts: explicitly re-sign Electron's renamed bundle without
// requiring a Developer ID. A production release needs its own signing profile.
module.exports = {
  ...build,
  extends: null,
  mac: {
    ...build.mac,
    identity: '-',
    hardenedRuntime: false,
    notarize: false,
  },
  dmg: { ...build.dmg, sign: false },
};
