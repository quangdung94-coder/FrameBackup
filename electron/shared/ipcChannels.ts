/**
 * Tên kênh IPC — nguồn duy nhất cho main (ipcMain.handle / webContents.send) và preload (invoke / on).
 * Đổi tên kênh ở đây thì cả 2 phía đổi theo, tránh lệch chuỗi.
 */
export const IPC = {
  system: {
    getInfo: 'system:getInfo',
    setPreventSleep: 'system:setPreventSleep',
    openExternal: 'system:openExternal',
    powerAction: 'system:powerAction',
    openPath: 'system:openPath',
    showInFolder: 'system:showInFolder',
  },
  disk: {
    listDrives: 'disk:listDrives',
    listDirectory: 'disk:listDirectory',
    scanRecursive: 'disk:scanRecursive',
    scanRecursiveQuick: 'disk:scanRecursiveQuick',
    readShotDates: 'disk:readShotDates',
    cancelShotDates: 'disk:cancelShotDates',
    createFolder: 'disk:createFolder',
    rename: 'disk:rename',
    properties: 'disk:properties',
    specialFolders: 'disk:specialFolders',
    ensureDir: 'disk:ensureDir',
    safeEject: 'disk:safeEject',
    deletePartFiles: 'disk:deletePartFiles',
  },
  mediaView: {
    probe: 'media:probe',
    thumbnail: 'media:thumbnail',
  },
  dialog: {
    pickDirectory: 'dialog:pickDirectory',
  },
  copy: {
    listEngines: 'copy:listEngines',
    start: 'copy:start',
    cancel: 'copy:cancel',
    preflight: 'copy:preflight',
  },
  watch: {
    start: 'watch:start',
    stop: 'watch:stop',
    triggerNow: 'watch:triggerNow',
  },
  media: {
    inspectAndReport: 'media:inspectAndReport',
    buildReport: 'media:buildReport',
    showLedger: 'media:showLedger',
  },
  pack: {
    start: 'package:start',
    cancel: 'package:cancel',
  },
  drive: {
    getAuthStatus: 'drive:getAuthStatus',
    importCredentials: 'drive:importCredentials',
    signIn: 'drive:signIn',
    signOut: 'drive:signOut',
    cancelSignIn: 'drive:cancelSignIn',
    listBrowsers: 'drive:listBrowsers',
    useBuiltInClient: 'drive:useBuiltInClient',
    checkFolder: 'drive:checkFolder',
    pickFolder: 'drive:pickFolder',
    cancelPick: 'drive:cancelPick',
    upload: 'drive:upload',
    cancelUpload: 'drive:cancelUpload',
  },
} as const;

/** Kênh sự kiện main -> renderer (tiến trình). */
export const IPC_EVENTS = {
  copyProgress: 'copy:progress',
  watchStatus: 'watch:status',
  packageProgress: 'package:progress',
  driveUploadProgress: 'drive:uploadProgress',
  shotDates: 'disk:shotDates',
  drivesChanged: 'disk:drivesChanged',
} as const;

export type IpcEventChannel = (typeof IPC_EVENTS)[keyof typeof IPC_EVENTS];
