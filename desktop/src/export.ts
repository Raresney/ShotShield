// Save the canvas as a PNG. The canvas already holds the redacted image
// (boxes painted, toggles honored), so we just hand its bytes to a download.
//
// TODO: when running under Tauri, swap this for a native Save As dialog
// (@tauri-apps/plugin-dialog + plugin-fs) instead of a browser download.
export function downloadCanvas(canvas: HTMLCanvasElement, filename: string): void {
  canvas.toBlob((blob) => {
    if (!blob) return;
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
  }, "image/png");
}
