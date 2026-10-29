import { useEffect, useRef, useState } from "react";
import type { PDFDocumentProxy, RenderTask } from "pdfjs-dist";

/** Load the renderer and its local worker only when a PDF is opened. */
export function PdfPreview({ source }: { source: string }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [document, setDocument] = useState<PDFDocumentProxy | null>(null);
  const [pageNumber, setPageNumber] = useState(1);
  const [error, setError] = useState("");
  const [rendering, setRendering] = useState(true);
  useEffect(() => {
    let cancelled = false;
    let loadedDocument: PDFDocumentProxy | null = null;
    setDocument(null); setPageNumber(1); setError("");
    async function load() {
      try {
        const [pdf, worker, response] = await Promise.all([
          import("pdfjs-dist"),
          import("pdfjs-dist/build/pdf.worker.min.mjs?url"),
          fetch(source),
        ]);
        if (cancelled) return;
        pdf.GlobalWorkerOptions.workerSrc = worker.default;
        loadedDocument = await pdf.getDocument({ data: new Uint8Array(await response.arrayBuffer()) }).promise;
        if (cancelled) { void loadedDocument.loadingTask.destroy(); return; }
        setDocument(loadedDocument);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : "Could not read this PDF.");
      }
    }
    void load();
    return () => { cancelled = true; if (loadedDocument) void loadedDocument.loadingTask.destroy(); };
  }, [source]);
  useEffect(() => {
    if (!document) return;
    let cancelled = false;
    let task: RenderTask | undefined;
    setRendering(true); setError("");
    async function render() {
      try {
        const page = await document!.getPage(pageNumber);
        const target = canvas.current;
        if (cancelled || !target) return;
        const viewport = page.getViewport({ scale: 1.15 });
        target.width = viewport.width; target.height = viewport.height;
        const context = target.getContext("2d");
        if (!context) throw new Error("PDF rendering is unavailable in this browser.");
        task = page.render({ canvas: target, canvasContext: context, viewport });
        await task.promise;
        if (!cancelled) setRendering(false);
      } catch (err) {
        if (!cancelled) {setError(err instanceof Error ? err.message : "Could not render this page."); setRendering(false);}
      }
    }
    void render();
    return () => {cancelled = true; task?.cancel();};
  }, [document, pageNumber]);
  return <div className="pdf-preview">
    {error ? <p role="alert" className="error-panel">PDF preview unavailable: {error}. Download the original file to inspect it.</p> : <>
      {document && <div className="pdf-controls"><button className="button button-secondary" disabled={pageNumber <= 1 || rendering} onClick={() => setPageNumber(n => n - 1)}>Previous page</button><span>Page {pageNumber} of {document.numPages}</span><button className="button button-secondary" disabled={pageNumber >= document.numPages || rendering} onClick={() => setPageNumber(n => n + 1)}>Next page</button></div>}
      {(!document || rendering) && <p role="status">Loading PDF preview…</p>}
      <canvas ref={canvas} role="img" aria-label={`PDF document page ${pageNumber}`} style={{ display: document ? "block" : "none" }} />
    </>}
  </div>;
}
