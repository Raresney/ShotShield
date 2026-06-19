// In-app updates. Asks GitHub whether a newer signed release exists and, if so,
// downloads, verifies and installs it, then relaunches. Everything here is
// best-effort: an offline machine, a missing release, or running outside the
// Tauri shell (e.g. the dev server in a plain browser) must never get in the
// way of using the app, so the check resolves to null instead of throwing.

import { check } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";

export type DownloadProgress = (downloaded: number, total: number | null) => void;

export interface PendingUpdate {
  version: string;
  /** Download + install the update, reporting progress, then relaunch. */
  install: (onProgress?: DownloadProgress) => Promise<void>;
}

export async function checkForUpdate(): Promise<PendingUpdate | null> {
  let update;
  try {
    update = await check();
  } catch (err) {
    // No network, no published manifest yet, or no Tauri IPC (browser dev). All
    // fine — just don't surface an update.
    console.warn("Update check skipped:", err);
    return null;
  }
  if (!update) return null;

  return {
    version: update.version,
    install: async (onProgress) => {
      let downloaded = 0;
      let total: number | null = null;
      await update.downloadAndInstall((event) => {
        if (event.event === "Started") {
          total = event.data.contentLength ?? null;
        } else if (event.event === "Progress") {
          downloaded += event.data.chunkLength;
          onProgress?.(downloaded, total);
        } else if (event.event === "Finished") {
          onProgress?.(total ?? downloaded, total);
        }
      });
      await relaunch();
    },
  };
}
