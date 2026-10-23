// Save the canvas as a PNG. The canvas already holds the redacted image
// (boxes painted, toggles honored), so we just hand its bytes over.
//
// Inside the app this opens the native Save As dialog. The dialog plugin adds
// the chosen path to the fs scope, so `fs:allow-write-file` can only ever write
// the one file the user picked. In a plain browser (dev, tests) it falls back
// to a download.

export type SaveResult = "saved" | "cancelled" | "downloaded";

const inTauri = (): boolean => "__TAURI_INTERNALS__" in window;

export function canvasBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("Canvas is empty"))), "image/png"),
  );
}

export async function saveCanvas(canvas: HTMLCanvasElement, filename: string): Promise<SaveResult> {
  const blob = await canvasBlob(canvas);
  if (!inTauri()) {
    download(blob, filename);
    return "downloaded";
  }
  const { save } = await import("@tauri-apps/plugin-dialog");
  const path = await save({
    defaultPath: filename,
    filters: [{ name: "PNG image", extensions: ["png"] }],
  });
  if (!path) return "cancelled";
  const { writeFile } = await import("@tauri-apps/plugin-fs");
  await writeFile(path, new Uint8Array(await blob.arrayBuffer()));
  return "saved";
}

/**
 * Save several redacted images at once. Inside the app the user picks a folder
 * (the dialog adds it to the fs scope, so writes stay inside it); names that
 * collide get a numeric suffix. The browser build downloads each file.
 */
export async function saveAll(items: { canvas: HTMLCanvasElement; name: string }[]): Promise<SaveResult> {
  const names = uniqueNames(items.map((i) => i.name));
  if (!inTauri()) {
    for (const [i, item] of items.entries()) download(await canvasBlob(item.canvas), names[i]!);
    return "downloaded";
  }
  const { open } = await import("@tauri-apps/plugin-dialog");
  const dir = await open({ directory: true, title: "Save redacted images to…" });
  if (typeof dir !== "string") return "cancelled";
  const { writeFile } = await import("@tauri-apps/plugin-fs");
  const { join } = await import("@tauri-apps/api/path");
  for (const [i, item] of items.entries()) {
    const blob = await canvasBlob(item.canvas);
    await writeFile(await join(dir, names[i]!), new Uint8Array(await blob.arrayBuffer()));
  }
  return "saved";
}

/** "a.png", "a.png" -> "a.png", "a-2.png". */
export function uniqueNames(names: string[]): string[] {
  const seen = new Map<string, number>();
  return names.map((n) => {
    const key = n.toLowerCase();
    const count = (seen.get(key) ?? 0) + 1;
    seen.set(key, count);
    return count === 1 ? n : n.replace(/(\.[^.]+)?$/, `-${count}$1`);
  });
}

function download(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.append(a);
  a.click();
  // Defer cleanup so the download has been handed off before we revoke.
  setTimeout(() => {
    a.remove();
    URL.revokeObjectURL(url);
  }, 0);
}

/** A filename that says what it is: the source name plus "-redacted". */
export function redactedName(source: string | null): string {
  const base = (source ?? "")
    .replace(/\.[^.]+$/, "")
    .replace(/[^\w.-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return `${base && base !== "clipboard" ? base : "screenshot"}-redacted.png`;
}
