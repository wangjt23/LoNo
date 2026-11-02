const { build } = require('./package.json');

module.exports = {
  ...build,
  extends: null,
  win: { ...build.win, target: 'nsis', artifactName: 'LoNo-Setup-${version}-win-${arch}.${ext}' },
  nsis: {
    oneClick: false,
    perMachine: false,
    allowToChangeInstallationDirectory: true,
    createDesktopShortcut: true,
    createStartMenuShortcut: true,
    shortcutName: 'LoNo',
    uninstallDisplayName: 'LoNo',
    installerIcon: 'src/assets/LoNo.ico',
    uninstallerIcon: 'src/assets/LoNo.ico',
    deleteAppDataOnUninstall: false,
    runAfterFinish: false,
  },
};
