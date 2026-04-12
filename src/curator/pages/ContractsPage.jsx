import { useState, useCallback, useRef } from "react";
import { PDFDocument } from "pdf-lib";
import * as pdfjsLib from "pdfjs-dist";
import { Toast, useToast } from "../components/Toast";
import logoUrl from "../../assets/logovtxnoir.png";

// ── pdfjs worker (v5, ESM) ────────────────────────────────────────────────────
pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
  "pdfjs-dist/build/pdf.worker.min.mjs",
  import.meta.url
).toString();

const fmtSize = (n) =>
  n < 1_048_576 ? `${(n / 1024).toFixed(1)} Ko` : `${(n / 1_048_576).toFixed(1)} Mo`;

// ── Canvas text wrapper ───────────────────────────────────────────────────────
function wrapCanvasText(ctx, text, x, startY, maxWidth, lineHeight) {
  const words = text.split(" ");
  let line = "";
  let y = startY;
  for (const word of words) {
    const test = line ? `${line} ${word}` : word;
    if (ctx.measureText(test).width > maxWidth && line !== "") {
      ctx.fillText(line, x, y);
      line = word;
      y += lineHeight;
    } else {
      line = test;
    }
  }
  if (line) ctx.fillText(line, x, y);
  return y; // last baseline y
}

// ── Core: render each page to canvas, apply corrections, embed in new PDF ────
async function processContract(pdfBytes, onProgress) {
  const SCALE = 2.0;

  onProgress("Chargement…");
  const pdfJsDoc = await pdfjsLib.getDocument({ data: pdfBytes }).promise;
  const numPages = pdfJsDoc.numPages;
  const newPdfDoc = await PDFDocument.create();

  // Pre-load logo bitmap
  let logoBitmap = null;
  try {
    const res = await fetch(logoUrl);
    if (res.ok) logoBitmap = await createImageBitmap(await res.blob());
  } catch (e) {
    console.warn("[contracts] Logo:", e.message);
  }

  const corrLog = { c1: 0, c2: false, c3: false, c4: false };

  for (let pn = 1; pn <= numPages; pn++) {
    onProgress(`Page ${pn}/${numPages}…`);

    const page     = await pdfJsDoc.getPage(pn);
    const viewport = page.getViewport({ scale: SCALE });
    const canvas   = document.createElement("canvas");
    canvas.width   = viewport.width;
    canvas.height  = viewport.height;
    const ctx      = canvas.getContext("2d");

    // Render page to canvas
    await page.render({ canvasContext: ctx, viewport }).promise;

    const tc    = await page.getTextContent();
    const items = tc.items.filter((it) => typeof it.str === "string" && it.str.trim());

    // ── PDF → canvas coordinate helpers ──────────────────────────────────
    // PDF: origin bottom-left, y↑.  Canvas: origin top-left, y↓.
    const cxP  = (px)    => px * SCALE;
    const cyBL = (py)    => viewport.height - py * SCALE;        // canvas baseline
    const cyT  = (py, h) => viewport.height - (py + h) * SCALE; // canvas top of box

    // Sample background color at a canvas pixel
    const sampleBg = (px, py) => {
      const d = ctx.getImageData(
        Math.max(0, Math.floor(px)),
        Math.max(0, Math.floor(py)),
        1, 1
      ).data;
      return `rgb(${d[0]},${d[1]},${d[2]})`;
    };

    // ── C1: RYLARIS → VELTRIX RECORDS ────────────────────────────────────
    for (const item of items) {
      if (!item.str.includes("RYLARIS")) continue;
      const px = item.transform[4], py = item.transform[5];
      const ph = item.height || 10, pw = item.width || item.str.length * 6.5;
      const bx = cxP(px) - 4, by = cyT(py, ph) - 4;
      const bw = pw * SCALE + 22, bh = ph * SCALE + 8;
      // Cover with background color
      ctx.fillStyle = sampleBg(bx + 2, by + 2);
      ctx.fillRect(bx, by, bw, bh);
      // Write replacement
      const fs = Math.max(Math.round(ph * SCALE * 0.72), 7);
      ctx.font = `${fs}px Arial`;
      ctx.fillStyle = "#9a9a9a";
      ctx.fillText("VELTRIX RECORDS", cxP(px), cyBL(py) - 1);
      corrLog.c1++;
    }

    // ── C2: Remove "minimum of 1,000 €" — replace entire fund paragraph ──
    if (!corrLog.c2) {
      const fundStart = items.find(
        (it) => it.str.includes("Label will fund") && it.str.includes("administer")
      );
      if (fundStart) {
        const startPY = fundStart.transform[5];
        const startH  = fundStart.height || 10;

        // All items within 90pt below the start line (the full paragraph)
        const paraItems = items.filter(
          (it) => it.transform[5] < startPY && it.transform[5] >= startPY - 90
        );
        // Last item in the paragraph that contains "Royalty"
        const royaltyItem = [...paraItems].reverse().find((it) => it.str.includes("Royalty"));
        const endPY = royaltyItem ? royaltyItem.transform[5] : startPY - 52;

        // Single white rect covering the whole paragraph
        const rectTop = cyT(startPY, startH * 1.3);
        const rectBot = cyBL(endPY) + startH * SCALE * 0.7;
        ctx.fillStyle = "#ffffff";
        ctx.fillRect(
          36, rectTop,
          viewport.width - 72,
          Math.max(rectBot - rectTop, startH * SCALE * 4)
        );

        // Replacement text (no "minimum of 1,000 €")
        const fs = Math.max(Math.round(startH * SCALE * 0.80), 8);
        ctx.font = `${fs}px Arial`;
        ctx.fillStyle = "#1a1a1a";
        wrapCanvasText(
          ctx,
          "Label will fund and administer a marketing budget for third-party expenses " +
          "incurred in connection with the marketing and promotion of the Master " +
          "\u00ab the Fund \u00bb). This Fund shall be recoupable against Licensor\u2019s Royalty.",
          cxP(fundStart.transform[4]),
          cyBL(startPY) - 1,
          viewport.width - 120,
          fs * 1.5
        );
        corrLog.c2 = true;
      }
    }

    // ── C3: Playlist Placement clause ─────────────────────────────────────
    if (!corrLog.c3) {
      // Anchor = end of "The Fund will be administered…relevant third / parties." paragraph
      const anchor =
        items.find((it) => it.str.trim() === "parties.") ||
        items.find((it) => it.str.includes("relevant third"));
      if (anchor) {
        const ph  = anchor.height || 9;
        const fs  = Math.max(Math.round(ph * SCALE * 0.80), 7);
        // Insert below anchor (higher canvas y = lower on page)
        const insertX = cxP(anchor.transform[4]);
        const insertY = cyBL(anchor.transform[5]) + fs * 3.5;
        ctx.font = `${fs}px Arial`;
        ctx.fillStyle = "#1a1a1a";
        // TODO: scroll down fix — may overlap next paragraph if insufficient vertical space
        wrapCanvasText(
          ctx,
          "Playlist Placement. The Label shall provide promotional services including playlist " +
          "placement, valued at \u20ac50 (fifty euros) as a non-cash marketing advance, " +
          "recoupable against Licensor\u2019s Royalty.",
          insertX, insertY,
          viewport.width - insertX - 42,
          fs * 1.5
        );
        corrLog.c3 = true;
      }
    }

    // ── C4: Replace logo on page 1 ────────────────────────────────────────
    if (pn === 1 && logoBitmap) {
      try {
        const opList = await page.getOperatorList();
        let placed = false;

        for (let i = 0; i < opList.fnArray.length && !placed; i++) {
          if (opList.fnArray[i] !== pdfjsLib.OPS.paintImageXObject) continue;
          // Look backwards for the preceding transform (cm operator)
          for (let j = i - 1; j >= Math.max(0, i - 6); j--) {
            if (opList.fnArray[j] !== pdfjsLib.OPS.transform) continue;
            const m   = opList.argsArray[j]; // [a,b,c,d,e,f]
            const iw  = Math.abs(m[0]), ih = Math.abs(m[3]);
            const ix  = m[4],  iy = m[5];
            const ccx = cxP(ix), ccy = cyT(iy, ih);
            const ccw = iw * SCALE, cch = ih * SCALE;
            // Cover old logo
            ctx.fillStyle = "#ffffff";
            ctx.fillRect(ccx - 12, ccy - 12, ccw + 24, cch + 24);
            // Draw new logo
            ctx.drawImage(logoBitmap, ccx, ccy, ccw, cch);
            placed = corrLog.c4 = true;
            break;
          }
        }

        if (!placed) {
          // Fallback: upper-center of page (approx. where cover logo sits)
          const lw = 110 * SCALE;
          const lh = (logoBitmap.height / logoBitmap.width) * lw;
          const lx = (viewport.width - lw) / 2;
          const ly = 80;
          ctx.fillStyle = "#ffffff";
          ctx.fillRect(lx - 20, ly - 10, lw + 40, lh + 30);
          ctx.drawImage(logoBitmap, lx, ly, lw, lh);
          corrLog.c4 = true;
        }
      } catch (e) {
        console.warn("[contracts] Logo error:", e.message);
      }
    }

    // ── Embed canvas as PNG → new PDF page (original point dimensions) ────
    onProgress(`Encodage ${pn}/${numPages}…`);
    const dataUrl  = canvas.toDataURL("image/png", 0.92);
    const pngBytes = Uint8Array.from(atob(dataUrl.split(",")[1]), (c) => c.charCodeAt(0));
    const embedded = await newPdfDoc.embedPng(pngBytes);
    const origVP   = page.getViewport({ scale: 1.0 });
    const newPage  = newPdfDoc.addPage([origVP.width, origVP.height]);
    newPage.drawImage(embedded, { x: 0, y: 0, width: origVP.width, height: origVP.height });
  }

  onProgress("Finalisation…");
  return { pdfBytes: await newPdfDoc.save(), corrLog };
}

// ── Drag & Drop zone ──────────────────────────────────────────────────────────
function DragZone({ onFile, dragging, setDragging }) {
  const inputRef = useRef(null);
  return (
    <div
      onDrop={(e) => { e.preventDefault(); setDragging(false); if (e.dataTransfer.files[0]) onFile(e.dataTransfer.files[0]); }}
      onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
      onDragLeave={() => setDragging(false)}
      onClick={() => inputRef.current?.click()}
      style={{
        border: `2px dashed ${dragging ? "var(--green)" : "var(--border2)"}`,
        borderRadius: "var(--radius)",
        background: dragging ? "rgba(29,185,84,.06)" : "var(--surface2)",
        padding: "48px 24px", textAlign: "center", cursor: "pointer",
        transition: "all .2s", userSelect: "none",
      }}
    >
      <div style={{ fontSize: 36, marginBottom: 12 }}>📄</div>
      <div style={{ fontSize: 13, color: "var(--muted)", fontWeight: 500 }}>
        Glisse un PDF ici ou clique pour choisir
      </div>
      <div style={{ fontSize: 11, color: "var(--faint)", marginTop: 6 }}>Fichiers .pdf uniquement</div>
      <input
        ref={inputRef} type="file" accept=".pdf" style={{ display: "none" }}
        onChange={(e) => { if (e.target.files[0]) onFile(e.target.files[0]); }}
      />
    </div>
  );
}

function FileCard({ file, onReset }) {
  return (
    <div className="card" style={{ padding: 16, display: "flex", alignItems: "center", gap: 14 }}>
      <span style={{ fontSize: 28, flexShrink: 0 }}>📄</span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {file.name}
        </div>
        <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 3 }}>{fmtSize(file.size)}</div>
      </div>
      <button className="btn btn-ghost btn-sm" onClick={onReset}>Changer</button>
    </div>
  );
}

// ── TAB 1 — Corriger le contrat ───────────────────────────────────────────────
function FixTab({ show }) {
  const [file,     setFile]     = useState(null);
  const [bytes,    setBytes]    = useState(null);
  const [step,     setStep]     = useState("idle");
  const [progress, setProgress] = useState("");
  const [log,      setLog]      = useState([]);
  const [result,   setResult]   = useState(null);
  const [dragging, setDragging] = useState(false);

  const handleFile = useCallback((f) => {
    if (!f.name.toLowerCase().endsWith(".pdf")) { show("Fichier PDF requis", "error"); return; }
    setFile(f); setStep("idle"); setLog([]); setResult(null);
    const reader = new FileReader();
    reader.onload = (e) => setBytes(new Uint8Array(e.target.result));
    reader.readAsArrayBuffer(f);
  }, [show]);

  const reset = () => { setFile(null); setBytes(null); setStep("idle"); setLog([]); setResult(null); };

  const apply = async () => {
    if (!bytes) return;
    setStep("processing"); setLog([]);
    try {
      const { pdfBytes: saved, corrLog } = await processContract(bytes, setProgress);
      setResult(saved);
      setLog([
        { ok: corrLog.c1 > 0, label: `RYLARIS \u2192 VELTRIX RECORDS (${corrLog.c1} occurrence${corrLog.c1 !== 1 ? "s" : ""})` },
        { ok: corrLog.c2,      label: "Montant 1\u202f000\u00a0\u20ac supprim\u00e9 \u2014 clause marketing r\u00e9\u00e9crite" },
        { ok: corrLog.c3,      label: "Clause Playlist Placement ajout\u00e9e (\u00a73)" },
        { ok: corrLog.c4,      label: "Logo Veltrix Records int\u00e9gr\u00e9 (page\u00a01)" },
      ]);
      setStep("done");
    } catch (e) {
      console.error("[contracts]", e);
      show("Erreur traitement\u00a0: " + e.message, "error");
      setStep("idle");
    }
  };

  const download = () => {
    if (!result) return;
    const url = URL.createObjectURL(new Blob([result], { type: "application/pdf" }));
    const a   = Object.assign(document.createElement("a"), {
      href:     url,
      download: (file?.name || "contrat").replace(/\.pdf$/i, "") + "_veltrix.pdf",
    });
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      {!file
        ? <DragZone onFile={handleFile} dragging={dragging} setDragging={setDragging} />
        : <FileCard file={file} onReset={reset} />
      }

      {file && step !== "done" && (
        <button
          className="btn btn-green"
          disabled={!bytes || step === "processing"}
          onClick={apply}
          style={{ fontSize: 14, padding: "12px 20px" }}
        >
          {step === "processing"
            ? `\u23F3 ${progress || "Traitement\u2026"}`
            : "\u26A1 Appliquer les corrections"}
        </button>
      )}

      {step === "processing" && (
        <div style={{ height: 4, background: "var(--border)", borderRadius: 4, overflow: "hidden" }}>
          <div style={{
            height: "100%", width: "100%", background: "var(--green)",
            borderRadius: 4, animation: "indeterminate 1.4s ease infinite",
          }} />
        </div>
      )}

      {step === "done" && log.length > 0 && (
        <div className="card" style={{ padding: 18 }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: "var(--muted)", letterSpacing: ".06em", marginBottom: 14 }}>
            CORRECTIONS APPLIQU\u00c9ES
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 10, marginBottom: 18 }}>
            {log.map((c, i) => (
              <div key={i} style={{ display: "flex", alignItems: "center", gap: 12 }}>
                <span style={{ fontSize: 18, flexShrink: 0 }}>{c.ok ? "\u2705" : "\u274C"}</span>
                <span style={{ fontSize: 13, color: c.ok ? "var(--text)" : "var(--red)" }}>{c.label}</span>
              </div>
            ))}
          </div>
          <button
            className="btn btn-green"
            onClick={download}
            style={{ width: "100%", padding: "12px 0", fontSize: 14 }}
          >
            \u2B07 T\u00e9l\u00e9charger le contrat corrig\u00e9
          </button>
        </div>
      )}
    </div>
  );
}

// ── TAB 2 — Vérifier le contrat ───────────────────────────────────────────────
// Designed for TEXT-BASED PDFs (raw contracts before correction).
// Canvas-output PDFs are image-based and have no extractable text.
function CheckTab({ show }) {
  const [file,     setFile]     = useState(null);
  const [bytes,    setBytes]    = useState(null);
  const [checking, setChecking] = useState(false);
  const [results,  setResults]  = useState(null);
  const [dragging, setDragging] = useState(false);

  const handleFile = useCallback((f) => {
    if (!f.name.toLowerCase().endsWith(".pdf")) { show("Fichier PDF requis", "error"); return; }
    setFile(f); setResults(null);
    const reader = new FileReader();
    reader.onload = (e) => setBytes(new Uint8Array(e.target.result));
    reader.readAsArrayBuffer(f);
  }, [show]);

  const reset = () => { setFile(null); setBytes(null); setResults(null); };

  const runChecks = async () => {
    if (!bytes) return;
    setChecking(true); setResults(null);
    try {
      const pdfJsDoc = await pdfjsLib.getDocument({ data: bytes }).promise;
      let fullText = "";
      for (let i = 1; i <= pdfJsDoc.numPages; i++) {
        const pg = await pdfJsDoc.getPage(i);
        const c  = await pg.getTextContent();
        fullText += " " + c.items.filter((it) => typeof it.str === "string").map((it) => it.str).join(" ");
      }

      const checks = [
        {
          label:  "Aucune clause budget minimum 1\u202f000\u202f\u20ac",
          detail: "La mention \u00ab minimum of 1,000 \u20ac \u00bb est absente",
          pass:   !/minimum\s+of\s*1[,\s.]?000/i.test(fullText) && !/One\s+Thousand/i.test(fullText),
        },
        {
          label:  "Clause Playlist Placement pr\u00e9sente",
          detail: "La valorisation \u20ac20\/mois est int\u00e9gr\u00e9e",
          pass:
            /Playlist\s*Placement/i.test(fullText) &&
            /\u20ac\s*50|fifty\s+euros|50\s*euros|non-cash/i.test(fullText),
        },
      ];

      setResults(checks);
    } catch (e) {
      show("Erreur analyse\u00a0: " + e.message, "error");
    } finally {
      setChecking(false);
    }
  };

  const allPass = results?.every((r) => r.pass);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      {!file
        ? <DragZone onFile={handleFile} dragging={dragging} setDragging={setDragging} />
        : <FileCard file={file} onReset={reset} />
      }

      {file && (
        <button
          className="btn btn-green"
          disabled={!bytes || checking}
          onClick={runChecks}
          style={{ fontSize: 14, padding: "12px 20px" }}
        >
          {checking ? "\u23F3 Analyse en cours\u2026" : "\uD83D\uDD0D Lancer la v\u00e9rification"}
        </button>
      )}

      {results && (
        <>
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {results.map((r, i) => (
              <div key={i} className="card" style={{ padding: "14px 18px", display: "flex", alignItems: "center", gap: 16 }}>
                <span style={{ fontSize: 22, flexShrink: 0 }}>{r.pass ? "\u2705" : "\u274C"}</span>
                <div>
                  <div style={{ fontSize: 13, fontWeight: 600, color: r.pass ? "var(--text)" : "var(--red)" }}>{r.label}</div>
                  <div style={{ fontSize: 11, color: "var(--faint)", marginTop: 4 }}>{r.detail}</div>
                </div>
              </div>
            ))}
          </div>

          <div style={{
            padding: "20px 24px", borderRadius: 12, textAlign: "center",
            background: allPass ? "rgba(29,185,84,.1)" : "rgba(255,85,85,.08)",
            border: `1px solid ${allPass ? "rgba(29,185,84,.3)" : "rgba(255,85,85,.3)"}`,
          }}>
            <div style={{ fontSize: 32, marginBottom: 10 }}>{allPass ? "\u2705" : "\u274C"}</div>
            <div style={{ fontFamily: "var(--head)", fontSize: 20, fontWeight: 800, color: allPass ? "var(--green)" : "var(--red)" }}>
              {allPass ? "Contrat conforme" : "Contrat non conforme"}
            </div>
            <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 8 }}>
              {allPass
                ? "Toutes les clauses Veltrix sont pr\u00e9sentes."
                : `${results.filter((r) => !r.pass).length} point(s) \u00e0 corriger avant signature.`}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

// ── Main export ───────────────────────────────────────────────────────────────
export default function ContractsPage() {
  const [activeTab, setActiveTab] = useState("fix");
  const { toast, show } = useToast();

  const TABS = [
    { id: "fix",   label: "\u26A1 Corriger le contrat" },
    { id: "check", label: "\uD83D\uDD0D V\u00e9rifier le contrat" },
  ];

  return (
    <div className="fade-in">
      <div style={{ marginBottom: 22 }}>
        <h1 style={{ fontFamily: "var(--head)", fontSize: 26, fontWeight: 800, letterSpacing: "-.8px" }}>
          Contrats
        </h1>
        <p style={{ color: "var(--muted)", fontSize: 13, marginTop: 5 }}>
          Correction automatique et v\u00e9rification de conformit\u00e9. Traitement 100\u00a0% local.
        </p>
      </div>

      <div style={{ display: "flex", gap: 8, marginBottom: 22 }}>
        {TABS.map((t) => (
          <button
            key={t.id}
            className="btn btn-sm"
            onClick={() => setActiveTab(t.id)}
            style={{
              background: activeTab === t.id ? "rgba(29,185,84,.12)" : "var(--surface2)",
              border:     `1px solid ${activeTab === t.id ? "rgba(29,185,84,.3)" : "var(--border2)"}`,
              color:      activeTab === t.id ? "var(--green)" : "var(--muted)",
              fontSize: 13, padding: "8px 18px",
            }}
          >
            {t.label}
          </button>
        ))}
      </div>

      {activeTab === "fix"   && <FixTab   show={show} />}
      {activeTab === "check" && <CheckTab show={show} />}

      <Toast toast={toast} />
    </div>
  );
}
