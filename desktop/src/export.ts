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
