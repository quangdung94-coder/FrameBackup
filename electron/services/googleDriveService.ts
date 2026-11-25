/**
 * Google Drive API v3 — barrel giữ nguyên đường dẫn import cũ.
 * Code thật nằm trong ./googleDrive/: storage (credentials/token), auth (OAuth loopback + PKCE),
 * picker (Google Picker), folders (kiểm tra / tạo thư mục / batch list), upload (Resumable 32/64 MB, 3 luồng).
 */
export type {
  DriveAuthStatus,
  DriveFolderCheckResult,
  DriveRemoteFile,
  DriveUploadItem,
  DriveUploadProgressEvent,
  DriveUploadRequest,
  DriveUploadSummary,
} from '../shared/types';
export { importOAuthCredentials, initGoogleDriveStorage, removeCustomClient } from './googleDrive/storage';
export { cancelGoogleSignIn, getDriveAuthStatus, signInGoogleDrive, signOutGoogleDrive } from './googleDrive/auth';
export { checkDriveFolderAccess } from './googleDrive/folders';
export { cancelDrivePick, pickDriveFolder } from './googleDrive/picker';
export { cancelDriveUpload, uploadProjectToDrive } from './googleDrive/upload';
