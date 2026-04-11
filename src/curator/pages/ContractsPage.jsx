import { useState, useCallback, useRef } from "react";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import * as pdfjsLib from "pdfjs-dist";
import { Toast, useToast } from "../components/Toast";
import logoUrl from "../../assets/logovtx.png";

// ── pdfjs worker setup (v5, ESM-only) ────────────────────────────────────────
pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
  "pdfjs-dist/build/pdf.worker.min.mjs",
  import.meta.url
).toString();

// ── Helpers ───────────────────────────────────────────────────────────────────

const fmtSize = (n) =>
  n < 1_048_576 ? `${(n / 1024).toFixed(1)} Ko` : `${(n / 1_048_576).toFixed(1)} Mo`;

/** Wrap text to fit maxWidth using pdf-lib font metrics */
function wrapText(text, font, size, maxWidth) {
  const words = text.split(" ");
  const lines = [];
  let cur = "";
  for (const w of words) {
    const test = cur ? `${cur} ${w}` : w;
    try {
      if (font.widthOfTextAtSize(test, size) <= maxWidth) {
        cur = test;
      } else {
        if (cur) lines.push(cur);
        cur = w;
      }
    } catch {
      cur = test; // fallback: don't break
    }
  }
  if (cur) lines.push(cur);
  return lines;
}

/**
 * Group pdfjs text items by approximate Y (same line = within 3pt).
 * Returns lines sorted top-to-bottom (descending y).
 * NOTE: pdf-lib and pdfjs both use PDF user space (origin bottom-left, y up).
 * Text item coordinates from pdfjs.getTextContent() are directly compatible
 * with pdf-lib drawing coordinates.
 */
function groupByLine(items) {
  const lines = [];
  for (const item of items) {
    if (typeof item.str !== "string") continue;
    const y = item.transform[5];
    const existing = lines.find((l) => Math.abs(l.y - y) < 3);
    if (existing) {
      existing.items.push(item);
      existing.str += item.str;
    } else {
      lines.push({ y, items: [item], str: item.str });
    }
  }
  return lines.sort((a, b) => b.y - a.y);
}

/** Estimate rendered font size from pdfjs transform matrix */
function estimateFontSize(transform) {
  const [a, b] = transform;
  return Math.max(Math.sqrt(a * a + b * b), 6);
}

// ── Drag & Drop zone ──────────────────────────────────────────────────────────

function DragZone({ onFile, dragging, setDragging }) {
  const inputRef = useRef(null);

  const handleDrop = (e) => {
    e.preventDefault();
    setDragging(false);
    const f = e.dataTransfer.files[0];
    if (f) onFile(f);
  };

  return (
    <div
      onDrop={handleDrop}
      onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
      onDragLeave={() => setDragging(false)}
      onClick={() => inputRef.current?.click()}
      style={{
        border: `2px dashed ${dragging ? "var(--green)" : "var(--border2)"}`,
        borderRadius: "var(--radius)",
        background: dragging ? "rgba(29,185,84,.06)" : "var(--surface2)",
        padding: "48px 24px",
        textAlign: "center",
        cursor: "pointer",
        transition: "all .2s",
        userSelect: "none",
      }}
    >
      <div style={{ fontSize: 36, marginBottom: 12 }}>📄</div>
      <div style={{ fontSize: 13, color: "var(--muted)", fontWeight: 500 }}>
        Glisse un PDF ici ou clique pour choisir
      </div>
      <div style={{ fontSize: 11, color: "var(--faint)", marginTop: 6 }}>
        Fichiers .pdf uniquement
      </div>
      <input
        ref={inputRef}
        type="file"
        accept=".pdf"
        style={{ display: "none" }}
        onChange={(e) => { if (e.target.files[0]) onFile(e.target.files[0]); }}
      />
    </div>
  );
}

/** File info card shown after upload */
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
  const [step,     setStep]     = useState("idle"); // idle | processing | done
  const [progress, setProgress] = useState("");
  const [log,      setLog]      = useState([]);
  const [result,   setResult]   = useState(null);
  const [dragging, setDragging] = useState(false);

  const handleFile = useCallback((f) => {
    if (!f.name.toLowerCase().endsWith(".pdf")) {
      show("Fichier PDF requis", "error");
      return;
    }
    setFile(f);
    setStep("idle");
    setLog([]);
    setResult(null);
    const reader = new FileReader();
    reader.onload = (e) => setBytes(new Uint8Array(e.target.result));
    reader.readAsArrayBuffer(f);
  }, [show]);

  const reset = () => { setFile(null); setBytes(null); setStep("idle"); setLog([]); setResult(null); };

  const apply = async () => {
    if (!bytes) return;
    setStep("processing");
    setLog([]);
    const corrections = [];

    try {
      // ── Load PDF with both libraries ────────────────────────────────────────
      const pdfDoc   = await PDFDocument.load(bytes, { ignoreEncryption: true });
      const pdfJsDoc = await pdfjsLib.getDocument({ data: bytes }).promise;
      const pageCount = pdfDoc.getPageCount();

      const helvetica     = await pdfDoc.embedFont(StandardFonts.Helvetica);
      const helveticaBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

      // ── Extract text items per page ─────────────────────────────────────────
      setProgress("Analyse du document…");
      const pageItems = [];
      for (let i = 0; i < pageCount; i++) {
        const pjsPage = await pdfJsDoc.getPage(i + 1);
        const content  = await pjsPage.getTextContent();
        pageItems.push(content.items.filter((it) => typeof it.str === "string"));
      }

      // ── CORRECTION 1: RYLARIS → VELTRIX RECORDS ────────────────────────────
      // pdf-lib cannot modify existing content streams (FlateDecode / binary).
      // Instead we draw white rectangles over old text and render new text on top.
      setProgress("1/4 — Remplacement RYLARIS…");
      let c1count = 0;
      for (let pi = 0; pi < pageCount; pi++) {
        const page = pdfDoc.getPage(pi);
        for (const item of pageItems[pi]) {
          if (!item.str.includes("RYLARIS")) continue;
          const [, , , , x, y] = item.transform;
          const fs = estimateFontSize(item.transform);
          const w  = item.width > 0 ? item.width : fs * item.str.length * 0.55;
          // White cover
          page.drawRectangle({
            x: x - 2, y: y - fs * 0.3,
            width: w + 12, height: fs * 1.5,
            color: rgb(1, 1, 1),
          });
          const newStr = item.str
            .replace(/RYLARIS MUSIC/g, "VELTRIX RECORDS")
            .replace(/RYLARIS/g,       "VELTRIX RECORDS");
          page.drawText(newStr, {
            x, y,
            size: Math.max(fs * 0.85, 6),
            font: helvetica,
            color: rgb(0.68, 0.68, 0.68),
          });
          c1count++;
        }
      }
      corrections.push({
        ok:    c1count > 0,
        label: `RYLARIS → VELTRIX RECORDS (${c1count} occurrence${c1count > 1 ? "s" : ""})`,
      });

      // ── CORRECTION 2: Suppression montant 1 000 € ──────────────────────────
      // Strategy: find the ENTIRE paragraph ("Label will fund...Royalty.") and
      // cover it with a single white rectangle, then redraw the replacement text.
      setProgress("2/4 — Clause marketing…");
      let c2done = false;
      outerC2: for (let pi = 0; pi < pageCount; pi++) {
        const page  = pdfDoc.getPage(pi);
        const lines = groupByLine(pageItems[pi]);
        const { width: pw } = page.getSize();

        // Find start line: "Label will fund and administer..."
        const startIdx = lines.findIndex((l) =>
          l.str.includes("Label will fund") && l.str.includes("administer")
        );
        if (startIdx < 0) continue;

        // Find end line: first line after start that contains "Royalty"
        const endIdx = lines.findIndex((l, i) =>
          i > startIdx && l.str.includes("Royalty")
        );
        const safeEnd = endIdx >= 0 ? endIdx : Math.min(startIdx + 5, lines.length - 1);

        const startLine = lines[startIdx];
        const endLine   = lines[safeEnd];
        const fs     = Math.max(estimateFontSize(startLine.items[0].transform) * 0.9, 7);
        const startX = Math.min(...startLine.items.map((it) => it.transform[4]));

        // Single white rect covering the entire paragraph block
        const topY    = startLine.y + fs * 1.3;
        const bottomY = endLine.y - fs * 0.5;
        page.drawRectangle({
          x: 36, y: bottomY,
          width: pw - 72,
          height: Math.max(topY - bottomY, fs * 3.5),
          color: rgb(1, 1, 1),
        });

        // Replacement paragraph (no "minimum of 1,000 €")
        const replacement =
          "Label will fund and administer a marketing budget for third-party expenses " +
          "incurred in connection with the marketing and promotion of the Master (\u00ab the Fund \u00bb). " +
          "This Fund shall be recoupable against Licensor\u2019s Royalty.";
        const wrapped = wrapText(replacement, helvetica, fs, pw - 130);
        let dy = startLine.y;
        for (const wl of wrapped) {
          page.drawText(wl, { x: startX, y: dy, size: fs, font: helvetica, color: rgb(0.1, 0.1, 0.1) });
          dy -= fs * 1.5;
        }
        c2done = true;
        break outerC2;
      }
      corrections.push({ ok: c2done, label: "Montant 1 000 \u20ac supprim\u00e9 \u2014 clause marketing r\u00e9\u00e9crite" });

      // ── CORRECTION 3: Ajout clause Playlist Placement ──────────────────────
      setProgress("3/4 — Clause Playlist…");
      let c3done = false;
      outerC3: for (let pi = 0; pi < pageCount; pi++) {
        const page  = pdfDoc.getPage(pi);
        const lines = groupByLine(pageItems[pi]);

        // Anchor = line ending the paragraph ("relevant third parties" or "third parties.")
        const anchor = lines.find(
          (l) => l.str.includes("relevant third") ||
                 (l.str.toLowerCase().includes("third") && l.str.toLowerCase().includes("parties"))
        );
        if (!anchor) continue;

        const [, , , , anchorX] = anchor.items[0].transform;
        const anchorY = anchor.y;
        const fs      = Math.max(estimateFontSize(anchor.items[0].transform) * 0.85, 7.5);

        const clause =
          "Playlist Placement. The Label shall place the Master in its promotional playlist network " +
          "as part of its marketing efforts. Such playlist placement shall be valued at \u20ac20 (twenty euros) " +
          "per month and shall be considered a marketing expense recoupable against Licensor\u2019s Royalty " +
          "pursuant to this Section 3, for as long as the Master remains active in the Label\u2019s playlist " +
          "network. The Label does not guarantee any specific streaming results or audience numbers from such placements.";

        const wrapped = wrapText(clause, helvetica, fs, 460);
        let dy = anchorY - fs * 2.4; // gap below anchor paragraph
        for (const wl of wrapped) {
          page.drawText(wl, { x: anchorX, y: dy, size: fs, font: helvetica, color: rgb(0.1, 0.1, 0.1) });
          dy -= fs * 1.55;
        }
        c3done = true;
        break outerC3;
      }
      corrections.push({ ok: c3done, label: "Clause Playlist Placement ajout\u00e9e (\u00a73)" });

      // ── CORRECTION 4: Remplacement logo page 1 ─────────────────────────────
      setProgress("4/4 — Remplacement logo…");
      let c4done = false;
      try {
        const logoRes = await fetch(logoUrl);
        if (!logoRes.ok) throw new Error("Logo introuvable (/logovtx.png)");
        const logoBytes = await logoRes.arrayBuffer();
        const logoImg   = await pdfDoc.embedPng(logoBytes);

        const page0 = pdfDoc.getPage(0);
        const { width: pw, height: ph } = page0.getSize();

        // Centre the logo horizontally, place it where the original logo was (upper-middle area)
        const iw = 100;
        const ih = (logoImg.height / logoImg.width) * iw;
        const ix = (pw - iw) / 2;
        const iy = ph - 175; // approx top-area of A4/Letter page

        // White rect to cover the original RYLARIS logo
        page0.drawRectangle({
          x: ix - 30, y: iy - 20,
          width: iw + 60, height: ih + 50,
          color: rgb(1, 1, 1),
        });
        page0.drawImage(logoImg, { x: ix, y: iy, width: iw, height: ih });
        c4done = true;
      } catch (e) {
        console.warn("[contracts] Logo error:", e.message);
      }
      corrections.push({ ok: c4done, label: "Logo Veltrix Records int\u00e9gr\u00e9 (page\u00a01)" });

      // ── Save ────────────────────────────────────────────────────────────────
      setProgress("Finalisation du PDF…");
      const saved = await pdfDoc.save();
      setResult(saved);
      setLog(corrections);
      setStep("done");

    } catch (e) {
      console.error("[contracts]", e);
      show("Erreur traitement : " + e.message, "error");
      setStep("idle");
    }
  };

  const download = () => {
    if (!result) return;
    const blob = new Blob([result], { type: "application/pdf" });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement("a");
    a.href     = url;
    a.download = (file?.name || "contrat").replace(/\.pdf$/i, "") + "_veltrix.pdf";
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
            height: "100%", width: "100%",
            background: "var(--green)", borderRadius: 4,
            animation: "indeterminate 1.4s ease infinite",
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

function CheckTab({ show }) {
  const [file,     setFile]     = useState(null);
  const [bytes,    setBytes]    = useState(null);
  const [checking, setChecking] = useState(false);
  const [results,  setResults]  = useState(null);
  const [dragging, setDragging] = useState(false);

  const handleFile = useCallback((f) => {
    if (!f.name.toLowerCase().endsWith(".pdf")) {
      show("Fichier PDF requis", "error");
      return;
    }
    setFile(f);
    setResults(null);
    const reader = new FileReader();
    reader.onload = (e) => setBytes(new Uint8Array(e.target.result));
    reader.readAsArrayBuffer(f);
  }, [show]);

  const reset = () => { setFile(null); setBytes(null); setResults(null); };

  const runChecks = async () => {
    if (!bytes) return;
    setChecking(true);
    setResults(null);
    try {
      const pdfJsDoc = await pdfjsLib.getDocument({ data: bytes }).promise;
      let fullText = "";
      for (let i = 1; i <= pdfJsDoc.numPages; i++) {
        const page    = await pdfJsDoc.getPage(i);
        const content = await page.getTextContent();
        fullText += " " + content.items
          .filter((it) => typeof it.str === "string")
          .map((it) => it.str)
          .join(" ");
      }

      // NOTE: checks use POSITIVE presence tests (not absence tests).
      // pdfjs extracts the full content stream — text visually covered by
      // white rectangles is still readable in the stream. So we check that
      // the REPLACEMENT text is present, not that the old text is absent.
      const checks = [
        {
          label:  "Clause marketing sans budget minimum de 1\u202f000\u202f\u20ac",
          detail: "La clause de budget minimum a \u00e9t\u00e9 remplac\u00e9e",
          // The replacement paragraph starts with this phrase — absent in raw contracts.
          pass:   /a marketing budget for third-party expenses/i.test(fullText),
        },
        {
          label:  "Clause Playlist Placement pr\u00e9sente",
          detail: "La valorisation \u20ac20\/mois est int\u00e9gr\u00e9e",
          pass:
            /Playlist\s*Placement/i.test(fullText) &&
            /\u20ac\s*20|twenty\s+euros|20\s*euros/i.test(fullText),
        },
      ];

      setResults(checks);
    } catch (e) {
      show("Erreur analyse : " + e.message, "error");
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
              <div
                key={i}
                className="card"
                style={{ padding: "14px 18px", display: "flex", alignItems: "center", gap: 16 }}
              >
                <span style={{ fontSize: 22, flexShrink: 0 }}>{r.pass ? "\u2705" : "\u274C"}</span>
                <div>
                  <div style={{ fontSize: 13, fontWeight: 600, color: r.pass ? "var(--text)" : "var(--red)" }}>
                    {r.label}
                  </div>
                  <div style={{ fontSize: 11, color: "var(--faint)", marginTop: 4 }}>{r.detail}</div>
                </div>
              </div>
            ))}
          </div>

          <div style={{
            padding: "20px 24px",
            borderRadius: 12,
            background: allPass ? "rgba(29,185,84,.1)" : "rgba(255,85,85,.08)",
            border:     `1px solid ${allPass ? "rgba(29,185,84,.3)" : "rgba(255,85,85,.3)"}`,
            textAlign: "center",
          }}>
            <div style={{ fontSize: 32, marginBottom: 10 }}>{allPass ? "\u2705" : "\u274C"}</div>
            <div style={{
              fontFamily: "var(--head)", fontSize: 20, fontWeight: 800,
              color: allPass ? "var(--green)" : "var(--red)",
            }}>
              {allPass ? "Contrat conforme" : "Contrat non conforme"}
            </div>
            <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 8 }}>
              {allPass
                ? "Toutes les corrections Veltrix ont \u00e9t\u00e9 appliqu\u00e9es."
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
          Correction automatique et v\u00e9rification de conformit\u00e9 des contrats PDF. Traitement 100% local.
        </p>
      </div>

      {/* Tab switcher */}
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
