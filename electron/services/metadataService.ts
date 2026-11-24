import fs from 'node:fs/promises';
import path from 'node:path';
import exifr from 'exifr';

export type DateSource = 'exif' | 'video-atom' | 'mtime';

export interface MediaDateResult {
  shotTimeMs: number;
  dateSource: DateSource;
}

const IMAGE_OR_RAW_EXTS = new Set([
  '.jpg', '.jpeg', '.heic', '.tif', '.tiff',
  '.arw', '.cr2', '.cr3', '.nef', '.raf', '.dng', '.orf', '.rw2', '.pef',
]);

const MP4_MOV_EXTS = new Set(['.mp4', '.mov', '.m4v', '.3gp']);

// QuickTime / MP4 mvhd epoch starts at 1904-01-01T00:00:00Z
const QT_EPOCH_OFFSET_SEC = 2082844800;

/**
 * Fast pure-Node reader for MP4/MOV 'mvhd' creation_time atom.
 * Scans top-level boxes (and descends into 'moov') without loading the whole video into memory.
 */
async function readMp4CreationTimeMs(filePath: string): Promise<number | null> {
  let handle: fs.FileHandle | null = null;
  try {
    handle = await fs.open(filePath, 'r');
    const stat = await handle.stat();
    const fileSize = stat.size;
    const headerBuf = Buffer.alloc(16);

    const findMvhd = async (start: number, end: number): Promise<number | null> => {
      let offset = start;
      let guard = 0;
      while (offset + 8 <= end && guard < 200) {
        guard += 1;
        const { bytesRead } = await handle!.read(headerBuf, 0, 16, offset);
        if (bytesRead < 8) break;

        let boxSize = headerBuf.readUInt32BE(0);
        const boxType = headerBuf.toString('ascii', 4, 8);
        let headerLen = 8;

        if (boxSize === 1 && bytesRead >= 16) {
          boxSize = Number(headerBuf.readBigUInt64BE(8));
          headerLen = 16;
        } else if (boxSize === 0) {
          boxSize = end - offset;
        }

        if (boxSize < headerLen || offset + boxSize > end) break;

        if (boxType === 'moov') {
          const found = await findMvhd(offset + headerLen, offset + boxSize);
          if (found !== null) return found;
        } else if (boxType === 'mvhd') {
          const mvhdBuf = Buffer.alloc(28);
          const { bytesRead: mRead } = await handle!.read(mvhdBuf, 0, 28, offset + headerLen);
          if (mRead >= 12) {
            const version = mvhdBuf.readUInt8(0);
            let creationSec = 0;
            if (version === 0) {
              creationSec = mvhdBuf.readUInt32BE(4);
            } else if (version === 1 && mRead >= 20) {
              creationSec = Number(mvhdBuf.readBigUInt64BE(4));
            }
            if (creationSec > QT_EPOCH_OFFSET_SEC) {
              const unixMs = (creationSec - QT_EPOCH_OFFSET_SEC) * 1000;
              // Sanity check: year between 2000 and 2100
              if (unixMs > 946684800000 && unixMs < 4102444800000) {
                return unixMs;
              }
            }
          }
          return null;
        }

        offset += boxSize;
      }
      return null;
    };

    return await findMvhd(0, fileSize);
  } catch {
    return null;
  } finally {
    if (handle) await handle.close().catch(() => {});
  }
}

export async function readMediaShotDate(filePath: string, fallbackMtimeMs: number): Promise<MediaDateResult> {
  const ext = path.extname(filePath).toLowerCase();

  if (IMAGE_OR_RAW_EXTS.has(ext)) {
    try {
      const exif = await exifr.parse(filePath, ['DateTimeOriginal', 'CreateDate']);
      const dt = exif?.DateTimeOriginal ?? exif?.CreateDate;
      if (dt instanceof Date && !Number.isNaN(dt.getTime())) {
        return { shotTimeMs: dt.getTime(), dateSource: 'exif' };
      }
    } catch {
      // Fallback to mtime
    }
  } else if (MP4_MOV_EXTS.has(ext)) {
    const mp4Time = await readMp4CreationTimeMs(filePath);
    if (mp4Time !== null) {
      return { shotTimeMs: mp4Time, dateSource: 'video-atom' };
    }
  }

  return { shotTimeMs: fallbackMtimeMs, dateSource: 'mtime' };
}
