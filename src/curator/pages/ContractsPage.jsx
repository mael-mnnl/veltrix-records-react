import { useState, useCallback, useRef } from "react";
import * as pdfjsLib from "pdfjs-dist";
import { Toast, useToast } from "../components/Toast";

// ── pdfjs worker (v5, ESM) ────────────────────────────────────────────────────
pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
  "pdfjs-dist/build/pdf.worker.min.mjs",
  import.meta.url
).toString();

const fmtSize = (n) =>
  n < 1_048_576 ? `${(n / 1024).toFixed(1)} Ko` : `${(n / 1_048_576).toFixed(1)} Mo`;

const REPLACEMENT_FUND =
  "Label will fund and administer a marketing budget for third-party expenses " +
  "incurred in connection with the marketing and promotion of the Master " +
  "(\u00ab the Fund \u00bb). This Fund shall be recoupable against Licensor\u2019s Royalty.";

const REPLACEMENT_PLAYLIST =
  "Playlist Placement. The Label shall provide promotional services including " +
  "playlist placement, valued at \u20ac50 (fifty euros) as a non-cash marketing " +
  "advance, recoupable against Licensor\u2019s Royalty.";

// ── Drag & Drop zone ──────────────────────────────────────────────────────────
function DragZone({ onFile, dragging, setDragging }) {
  const inputRef = useRef(null);
  return (
    <div
      onDrop={(e) => {
        e.preventDefault(); setDragging(false);
        if (e.dataTransfer.files[0]) onFile(e.dataTransfer.files[0]);
      }}
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

// ── Copy button ───────────────────────────────────────────────────────────────
function CopyBtn({ text, show }) {
  const copy = () => {
    navigator.clipboard.writeText(text).then(() => show("Copié !", "success"));
  };
  return (
    <button
      className="btn btn-ghost btn-sm"
      onClick={copy}
      style={{ flexShrink: 0, fontSize: 12 }}
    >
      📋 Copier
    </button>
  );
}

// ── Check card ────────────────────────────────────────────────────────────────
function CheckCard({ pass, label, findLabel, findText, replaceLabel, replaceText, show }) {
  return (
    <div
      className="card"
      style={{
        padding: "18px 20px",
        border: `1px solid ${pass ? "rgba(29,185,84,.25)" : "rgba(255,170,0,.25)"}`,
        display: "flex", flexDirection: "column", gap: 14,
      }}
    >
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <span style={{ fontSize: 20, flexShrink: 0 }}>{pass ? "✅" : "❌"}</span>
        <span style={{
          fontSize: 14, fontWeight: 700,
          color: pass ? "var(--green)" : "#ffaa00",
        }}>
          {label}
        </span>
      </div>

      {/* Instructions when failing */}
      {!pass && (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>

          {/* Find block */}
          <div style={{ fontSize: 11, fontWeight: 700, color: "var(--muted)", letterSpacing: ".05em" }}>
            📋 {findLabel}
          </div>
          <textarea
            readOnly
            value={findText}
            rows={3}
            style={{
              fontFamily: "var(--mono)", fontSize: 11, background: "var(--surface2)",
              border: "1px solid var(--border2)", borderRadius: 8, padding: "10px 12px",
              color: "var(--muted)", resize: "none", width: "100%", lineHeight: 1.6,
              outline: "none",
            }}
          />

          {/* Replace block */}
          <div style={{ fontSize: 11, fontWeight: 700, color: "var(--muted)", letterSpacing: ".05em", marginTop: 4 }}>
            ✏️ {replaceLabel}
          </div>
          <div style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
            <textarea
              readOnly
              value={replaceText}
              rows={3}
              style={{
                fontFamily: "var(--mono)", fontSize: 11, background: "var(--surface2)",
                border: "1px solid var(--border2)", borderRadius: 8, padding: "10px 12px",
                color: "var(--text)", resize: "none", flex: 1, lineHeight: 1.6,
                outline: "none",
              }}
            />
            <CopyBtn text={replaceText} show={show} />
          </div>
        </div>
      )}
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────
export default function ContractsPage() {
  const { toast, show } = useToast();

  const [file,     setFile]     = useState(null);
  const [dragging, setDragging] = useState(false);
  const [status,   setStatus]   = useState("idle"); // idle | scanning | done | error
  const [checks,   setChecks]   = useState(null);

  const handleFile = useCallback(async (f) => {
    if (!f.name.toLowerCase().endsWith(".pdf")) {
      show("Fichier PDF requis", "error"); return;
    }
    setFile(f);
    setChecks(null);
    setStatus("scanning");

    try {
      const buf     = await f.arrayBuffer();
      const pdfDoc  = await pdfjsLib.getDocument({ data: new Uint8Array(buf) }).promise;
      let fullText  = "";

      for (let i = 1; i <= pdfDoc.numPages; i++) {
        const pg      = await pdfDoc.getPage(i);
        const content = await pg.getTextContent();
        fullText += " " + content.items
          .filter((it) => typeof it.str === "string")
          .map((it) => it.str)
          .join(" ");
      }

      // ── Check 1: Fund clause without fixed amount ─────────────────────
      const fundOk = /a marketing budget for third-party expenses/i.test(fullText);

      // ── Check 2: Playlist clause ──────────────────────────────────────
      const playlistOk =
        /non-cash marketing advance/i.test(fullText) ||
        (/playlist\s*placement/i.test(fullText) && /50/i.test(fullText));

      setChecks({ fundOk, playlistOk });
      setStatus("done");
    } catch (e) {
      console.error("[contracts]", e);
      show("Erreur d'analyse\u00a0: " + e.message, "error");
      setStatus("error");
    }
  }, [show]);

  const reset = () => { setFile(null); setChecks(null); setStatus("idle"); };

  const allPass = checks?.fundOk && checks?.playlistOk;
  const failCount = checks ? [checks.fundOk, checks.playlistOk].filter((v) => !v).length : 0;

  return (
    <div className="fade-in" style={{ maxWidth: 720 }}>
      {/* Warning banner */}
      <div style={{
        background: "rgba(255,85,85,.12)", border: "1px solid rgba(255,85,85,.4)",
        borderRadius: 10, padding: "12px 18px", marginBottom: 22,
        color: "var(--red)", fontSize: 13, fontWeight: 600,
      }}>
        ⚠️ L&apos;utilise pas encore Axel, ça marche pas.
      </div>

      {/* Header */}
      <div style={{ marginBottom: 28 }}>
        <h1 style={{ fontFamily: "var(--head)", fontSize: 26, fontWeight: 800, letterSpacing: "-.8px" }}>
          Contrats
        </h1>
        <p style={{ color: "var(--muted)", fontSize: 13, marginTop: 5 }}>
          Scanner un contrat PDF et v\u00e9rifier sa conformit\u00e9 aux clauses Veltrix.
        </p>
      </div>

      {/* Upload zone */}
      {!file ? (
        <DragZone onFile={handleFile} dragging={dragging} setDragging={setDragging} />
      ) : (
        <div className="card" style={{ padding: "14px 16px", display: "flex", alignItems: "center", gap: 14, marginBottom: 20 }}>
          <span style={{ fontSize: 26, flexShrink: 0 }}>📄</span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 13, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {file.name}
            </div>
            <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 2 }}>{fmtSize(file.size)}</div>
          </div>
          <button className="btn btn-ghost btn-sm" onClick={reset}>Changer</button>
        </div>
      )}

      {/* Scanning state */}
      {status === "scanning" && (
        <div style={{ display: "flex", alignItems: "center", gap: 12, color: "var(--muted)", fontSize: 13, marginTop: 20 }}>
          <div style={{
            width: 16, height: 16, border: "2px solid var(--border2)",
            borderTop: "2px solid var(--green)", borderRadius: "50%",
            animation: "spin .8s linear infinite",
          }} />
          Analyse en cours\u2026
          <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
        </div>
      )}

      {/* Results */}
      {status === "done" && checks && (
        <div style={{ display: "flex", flexDirection: "column", gap: 14, marginTop: 4 }}>

          {/* Check 1 */}
          <CheckCard
            pass={checks.fundOk}
            label={checks.fundOk ? "Clause Fund correcte" : "Clause Fund \u00e0 modifier"}
            findLabel="Trouve ce paragraphe dans le contrat\u00a0:"
            findText={
              "Label will fund and administer an all-marketing budget with a minimum of 1,000 \u20ac\n" +
              "(One Thousand Euros) for third-party expenses..."
            }
            replaceLabel="Remplace-le par\u00a0:"
            replaceText={REPLACEMENT_FUND}
            show={show}
          />

          {/* Check 2 */}
          <CheckCard
            pass={checks.playlistOk}
            label={checks.playlistOk ? "Clause Playlist correcte" : "Clause Playlist \u00e0 ajouter"}
            findLabel="Trouve cette phrase dans le contrat (Section\u00a03)\u00a0:"
            findText={
              "The Fund will be administered by the Label. Payments shall be made\n" +
              "directly by Label to relevant third parties."
            }
            replaceLabel="Ajoute ce paragraphe juste apr\u00e8s\u00a0:"
            replaceText={REPLACEMENT_PLAYLIST}
            show={show}
          />

          {/* Global verdict */}
          <div style={{
            padding: "20px 24px", borderRadius: 12, textAlign: "center", marginTop: 4,
            background: allPass ? "rgba(29,185,84,.08)" : "rgba(255,170,0,.08)",
            border: `1px solid ${allPass ? "rgba(29,185,84,.25)" : "rgba(255,170,0,.3)"}`,
          }}>
            <div style={{ fontSize: 28, marginBottom: 8 }}>{allPass ? "✅" : "⚠️"}</div>
            <div style={{
              fontFamily: "var(--head)", fontSize: 19, fontWeight: 800,
              color: allPass ? "var(--green)" : "#ffaa00",
            }}>
              {allPass ? "Contrat conforme" : "Modifications n\u00e9cessaires"}
            </div>
            {!allPass && (
              <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 6 }}>
                {failCount} point{failCount > 1 ? "s" : ""} \u00e0 corriger avant signature.
              </div>
            )}
          </div>
        </div>
      )}

      <Toast toast={toast} />
    </div>
  );
}
