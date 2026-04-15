import { useState, useEffect, useRef } from "react";
import {
  getAllPlaylists, searchTracks, getTrackById,
  addTrackToPlaylist, removeTrackFromPlaylist, getPlaylistTracks,
} from "../utils/spotify";
import { Toast, useToast } from "../components/Toast";

function extractSpotifyTrackId(input) {
  const m = input.match(/open\.spotify\.com\/(?:intl-[a-z]{2}\/)?track\/([A-Za-z0-9]+)/);
  return m ? m[1] : null;
}

// ── Position badge (colour by rank) ──────────────────────────────────────────
function PosBadge({ pos }) {
  const [color, bg] =
    pos <= 5  ? ["var(--green)", "rgba(29,185,84,.15)"]  :
    pos <= 15 ? ["#ffaa00",      "rgba(255,170,0,.15)"]   :
                ["var(--muted)", "rgba(100,100,120,.15)"];
  return (
    <span style={{
      background: bg, color, border: `1px solid ${color}`,
      borderRadius: 6, padding: "2px 8px", fontSize: 11, fontWeight: 700, flexShrink: 0,
    }}>
      #{pos}
    </span>
  );
}

// ── Mini track chip ───────────────────────────────────────────────────────────
function TrackChip({ track, onClear }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 12px", background: "var(--surface2)", borderRadius: 10 }}>
      {track.album?.images?.[0]?.url && (
        <img src={track.album.images[0].url} style={{ width: 42, height: 42, borderRadius: 7, objectFit: "cover", flexShrink: 0 }} />
      )}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontWeight: 700, fontSize: 13, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{track.name}</div>
        <div style={{ fontSize: 11, color: "var(--muted)" }}>{track.artists?.map(a => a.name).join(", ")}</div>
      </div>
      {onClear && <button className="btn btn-ghost btn-sm" onClick={onClear}>Changer</button>}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
export default function BroadcastPage() {

  // ── Existing states ───────────────────────────────────────────────────────
  const [playlists,  setPlaylists]  = useState([]);
  const [loading,    setLoading]    = useState(true);
  const [searchQ,    setSearchQ]    = useState("");
  const [results,    setResults]    = useState([]);
  const [searching,  setSearching]  = useState(false);
  const [track,      setTrack]      = useState(null);
  const [selected,   setSelected]   = useState(new Set());
  const [position,   setPosition]   = useState(1);
  const [posMode,    setPosMode]    = useState("top");
  const [mode,       setMode]       = useState("add");
  const [working,    setWorking]    = useState(false);
  const [progress,   setProgress]   = useState(null);
  const searchTimer = useRef(null);

  // ── Scanner states ────────────────────────────────────────────────────────
  const [scanQ,          setScanQ]          = useState("");
  const [scanResults,    setScanResults]    = useState([]);
  const [scanSearching,  setScanSearching]  = useState(false);
  const [scanTrack,      setScanTrack]      = useState(null);
  const [scanning,       setScanning]       = useState(false);
  const [scanProgress,   setScanProgress]   = useState(null); // {done, total}
  const [scanFound,      setScanFound]      = useState(null); // {present:[{playlist,position}], absent:[playlist]}
  const [uniformizePos,  setUniformizePos]  = useState(1);
  const [selectedRemove, setSelectedRemove] = useState(new Set());
  const [selectedAdd,    setSelectedAdd]    = useState(new Set());
  const [addAbsentPos,   setAddAbsentPos]   = useState(1);
  const [actionWorking,  setActionWorking]  = useState(false);
  const [actionProgress, setActionProgress] = useState(null);
  const [confirmRemove,  setConfirmRemove]  = useState(false);
  const scanTimer = useRef(null);

  const { toast, show } = useToast();

  useEffect(() => {
    getAllPlaylists()
      .then(setPlaylists)
      .catch(e => show("Erreur playlists : " + e.message, "error"))
      .finally(() => setLoading(false));
  }, []);

  // ── Existing: broadcast search ────────────────────────────────────────────
  const handleSearch = (rawQ) => {
    setSearchQ(rawQ);
    clearTimeout(searchTimer.current);
    const q = rawQ.trim();
    if (!q) { setResults([]); setSearching(false); return; }
    const spotifyId = extractSpotifyTrackId(q);
    if (spotifyId) {
      setSearching(true);
      getTrackById(spotifyId)
        .then(t => setResults(t ? [t] : []))
        .catch(() => setResults([]))
        .finally(() => setSearching(false));
      return;
    }
    if (q.length < 3) { setResults([]); setSearching(false); return; }
    setSearching(true);
    searchTimer.current = setTimeout(async () => {
      try { const data = await searchTracks(q); setResults(data?.tracks?.items || []); }
      catch {} finally { setSearching(false); }
    }, 500);
  };

  // ── Existing: selection ───────────────────────────────────────────────────
  const toggleAll = () => {
    if (selected.size === playlists.length) setSelected(new Set());
    else setSelected(new Set(playlists.map(p => p.id)));
  };
  const toggle = (id) => setSelected(prev => {
    const next = new Set(prev);
    next.has(id) ? next.delete(id) : next.add(id);
    return next;
  });

  // ── Existing: broadcast run ───────────────────────────────────────────────
  const resolvePosition = () => {
    if (posMode === "top")    return 0;
    if (posMode === "bottom") return undefined;
    return Math.max(0, position - 1);
  };
  const run = async () => {
    if (!track || selected.size === 0) return;
    setWorking(true);
    setProgress({ done: 0, total: selected.size });
    const ids = [...selected];
    let ok = 0, failed = 0;
    for (const id of ids) {
      try {
        if (mode === "add") await addTrackToPlaylist(id, track.uri, resolvePosition());
        else                await removeTrackFromPlaylist(id, track.uri);
        ok++;
      } catch { failed++; }
      setProgress({ done: ok + failed, total: ids.length });
      await new Promise(r => setTimeout(r, 300));
    }
    const verb = mode === "add" ? "Ajouté à" : "Supprimé de";
    show(`${verb} ${ok}/${ids.length} playlists${failed ? ` (${failed} échoué)` : ""}`,
      ok === ids.length ? "success" : "error");
    setWorking(false); setProgress(null);
  };
  const canRun = track && selected.size > 0 && !working;

  // ── Scanner: search input ─────────────────────────────────────────────────
  const handleScanSearch = (rawQ) => {
    setScanQ(rawQ);
    clearTimeout(scanTimer.current);
    const q = rawQ.trim();
    if (!q) { setScanResults([]); setScanSearching(false); return; }
    const spotifyId = extractSpotifyTrackId(q);
    if (spotifyId) {
      setScanSearching(true);
      getTrackById(spotifyId)
        .then(t => setScanResults(t ? [t] : []))
        .catch(() => setScanResults([]))
        .finally(() => setScanSearching(false));
      return;
    }
    if (q.length < 3) { setScanResults([]); return; }
    setScanSearching(true);
    scanTimer.current = setTimeout(async () => {
      try { const data = await searchTracks(q); setScanResults(data?.tracks?.items || []); }
      catch {} finally { setScanSearching(false); }
    }, 500);
  };

  // ── Scanner: scan all playlists ───────────────────────────────────────────
  const runScan = async (trackOverride) => {
    const t = trackOverride || scanTrack;
    if (!t || !playlists.length) return;
    setScanning(true);
    setScanProgress({ done: 0, total: playlists.length });
    setScanFound(null);
    setConfirmRemove(false);

    const present = [], absent = [];
    for (let i = 0; i < playlists.length; i++) {
      const pl = playlists[i];
      try {
        const tracks = await getPlaylistTracks(pl.id);
        const idx = tracks.findIndex(it => it.track?.id === t.id);
        if (idx >= 0) present.push({ playlist: pl, position: idx + 1 });
        else          absent.push(pl);
      } catch { absent.push(pl); }
      setScanProgress({ done: i + 1, total: playlists.length });
      await new Promise(r => setTimeout(r, 300));
    }

    setScanFound({ present, absent });
    setSelectedRemove(new Set(present.map(p => p.playlist.id))); // all checked
    setSelectedAdd(new Set());
    setScanning(false);
    setScanProgress(null);
  };

  // ── Scanner: uniformize position ──────────────────────────────────────────
  const runUniformize = async () => {
    if (!scanFound || !scanTrack) return;
    setActionWorking(true);
    setActionProgress({ done: 0, total: scanFound.present.length });
    let ok = 0, failed = 0;
    for (const { playlist } of scanFound.present) {
      try {
        await removeTrackFromPlaylist(playlist.id, scanTrack.uri);
        await addTrackToPlaylist(playlist.id, scanTrack.uri, uniformizePos - 1);
        ok++;
      } catch { failed++; }
      setActionProgress({ done: ok + failed, total: scanFound.present.length });
      await new Promise(r => setTimeout(r, 300));
    }
    show(`✓ Uniformisé sur ${ok} playlist${ok > 1 ? "s" : ""} — position ${uniformizePos}`,
      ok > 0 ? "success" : "error");
    setActionWorking(false); setActionProgress(null);
    runScan();
  };

  // ── Scanner: remove from selected ─────────────────────────────────────────
  const runRemove = async () => {
    if (!scanFound || !scanTrack || selectedRemove.size === 0) return;
    setActionWorking(true); setConfirmRemove(false);
    const toRemove = scanFound.present.filter(p => selectedRemove.has(p.playlist.id));
    setActionProgress({ done: 0, total: toRemove.length });
    let ok = 0, failed = 0;
    for (const { playlist } of toRemove) {
      try { await removeTrackFromPlaylist(playlist.id, scanTrack.uri); ok++; }
      catch { failed++; }
      setActionProgress({ done: ok + failed, total: toRemove.length });
      await new Promise(r => setTimeout(r, 300));
    }
    show(`✓ Supprimé de ${ok} playlist${ok > 1 ? "s" : ""}`, ok > 0 ? "success" : "error");
    setActionWorking(false); setActionProgress(null);
    runScan();
  };

  // ── Scanner: add to absent ────────────────────────────────────────────────
  const runAddToAbsent = async () => {
    if (!scanFound || !scanTrack || selectedAdd.size === 0) return;
    setActionWorking(true);
    const toAdd = scanFound.absent.filter(pl => selectedAdd.has(pl.id));
    setActionProgress({ done: 0, total: toAdd.length });
    let ok = 0, failed = 0;
    for (const playlist of toAdd) {
      try { await addTrackToPlaylist(playlist.id, scanTrack.uri, addAbsentPos - 1); ok++; }
      catch { failed++; }
      setActionProgress({ done: ok + failed, total: toAdd.length });
      await new Promise(r => setTimeout(r, 300));
    }
    show(`✓ Ajouté à ${ok} playlist${ok > 1 ? "s" : ""} — position ${addAbsentPos}`,
      ok > 0 ? "success" : "error");
    setActionWorking(false); setActionProgress(null);
    runScan();
  };

  // ── Helpers for scanner ───────────────────────────────────────────────────
  const positionsVary = scanFound
    ? new Set(scanFound.present.map(p => p.position)).size > 1
    : false;
  const showUniformize = (scanFound?.present.length ?? 0) >= 1;

  const toggleRemove = (id) => setSelectedRemove(prev => {
    const next = new Set(prev); next.has(id) ? next.delete(id) : next.add(id); return next;
  });
  const toggleAdd = (id) => setSelectedAdd(prev => {
    const next = new Set(prev); next.has(id) ? next.delete(id) : next.add(id); return next;
  });

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="fade-in">
      <div style={{ marginBottom: 24 }}>
        <h1 style={{ fontFamily: "var(--head)", fontSize: 26, fontWeight: 800, letterSpacing: "-.8px" }}>
          Multi-Playlist
        </h1>
        <p style={{ color: "var(--muted)", fontSize: 13, marginTop: 5 }}>
          Ajoute ou supprime un son sur toutes tes playlists en même temps.
        </p>
      </div>

      {/* ══════════════════════════════════════════════════════════════════
          SECTION — SCANNER MES PLAYLISTS
      ══════════════════════════════════════════════════════════════════ */}
      <div style={{ marginBottom: 32 }}>
        <div style={{ fontSize: 11, fontWeight: 700, color: "var(--muted)", letterSpacing: ".06em", marginBottom: 14 }}>
          SCANNER MES PLAYLISTS
        </div>

        {/* Track picker */}
        <div className="card" style={{ padding: 16, marginBottom: 12 }}>
          {scanTrack ? (
            <TrackChip track={scanTrack} onClear={() => { setScanTrack(null); setScanQ(""); setScanResults([]); setScanFound(null); }} />
          ) : (
            <>
              <input
                type="text"
                placeholder="Colle un lien Spotify ou tape un titre…"
                value={scanQ}
                onChange={e => handleScanSearch(e.target.value)}
              />
              {scanSearching && <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 8 }}>Recherche…</div>}
              {scanResults.length > 0 && (
                <div style={{ marginTop: 8, maxHeight: 200, overflowY: "auto", display: "flex", flexDirection: "column", gap: 1, borderTop: "1px solid var(--border)", paddingTop: 8 }}>
                  {scanResults.map(t => (
                    <div key={t.id} className="track-row" style={{ cursor: "pointer" }}
                      onClick={() => { setScanTrack(t); setScanResults([]); setScanQ(""); setScanFound(null); }}>
                      {t.album?.images?.[0]?.url && (
                        <img src={t.album.images[0].url} style={{ width: 34, height: 34, borderRadius: 5, objectFit: "cover", flexShrink: 0 }} />
                      )}
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 13, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{t.name}</div>
                        <div style={{ fontSize: 11, color: "var(--muted)" }}>{t.artists?.map(a => a.name).join(", ")}</div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
        </div>

        {/* Scan button */}
        {scanTrack && !scanFound && (
          <button
            className="btn btn-green"
            disabled={scanning || loading}
            onClick={() => runScan()}
            style={{ padding: "12px 24px", fontSize: 14, marginBottom: 12 }}
          >
            {scanning
              ? `Scan en cours… ${scanProgress?.done ?? 0}/${scanProgress?.total ?? playlists.length}`
              : "🔍 Analyser mes playlists"}
          </button>
        )}

        {/* Scan progress bar */}
        {scanning && scanProgress && (
          <div style={{ height: 4, background: "var(--border)", borderRadius: 4, overflow: "hidden", marginBottom: 12 }}>
            <div style={{
              height: "100%", background: "var(--green)", borderRadius: 4,
              width: `${(scanProgress.done / scanProgress.total) * 100}%`,
              transition: "width .3s ease",
            }} />
          </div>
        )}

        {/* Action progress bar */}
        {actionWorking && actionProgress && (
          <div style={{ height: 4, background: "var(--border)", borderRadius: 4, overflow: "hidden", marginBottom: 12 }}>
            <div style={{
              height: "100%", background: "var(--green)", borderRadius: 4,
              width: `${(actionProgress.done / actionProgress.total) * 100}%`,
              transition: "width .3s ease",
            }} />
          </div>
        )}

        {/* Results */}
        {scanFound && !scanning && (
          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>

            {/* ✅ Present */}
            <div className="card" style={{ padding: 16 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: "var(--muted)", letterSpacing: ".06em" }}>
                  ✅ PRÉSENT DANS {scanFound.present.length} PLAYLIST{scanFound.present.length !== 1 ? "S" : ""}
                </div>
                <div style={{ display: "flex", gap: 6 }}>
                  <button
                    className="btn btn-ghost btn-sm"
                    onClick={() => {
                      if (selectedRemove.size === scanFound.present.length)
                        setSelectedRemove(new Set());
                      else
                        setSelectedRemove(new Set(scanFound.present.map(p => p.playlist.id)));
                    }}
                    disabled={actionWorking}
                  >
                    {selectedRemove.size === scanFound.present.length ? "Tout décocher" : "Tout cocher"}
                  </button>
                  <button className="btn btn-ghost btn-sm" onClick={() => runScan()} disabled={actionWorking}>
                    ↺ Re-scanner
                  </button>
                </div>
              </div>

              {scanFound.present.length === 0 ? (
                <div style={{ fontSize: 13, color: "var(--faint)" }}>Absent de toutes les playlists.</div>
              ) : (
                <>
                  {/* Playlist list with positions */}
                  <div style={{ display: "flex", flexDirection: "column", gap: 2, marginBottom: 14 }}>
                    {scanFound.present.map(({ playlist, position: pos }) => (
                      <label key={playlist.id} className="check-pl">
                        <input
                          type="checkbox"
                          checked={selectedRemove.has(playlist.id)}
                          onChange={() => toggleRemove(playlist.id)}
                          disabled={actionWorking}
                        />
                        {playlist.images?.[0]?.url
                          ? <img src={playlist.images[0].url} style={{ width: 32, height: 32, borderRadius: 5, objectFit: "cover", flexShrink: 0 }} />
                          : <div style={{ width: 32, height: 32, borderRadius: 5, background: "var(--surface2)", flexShrink: 0 }} />
                        }
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontSize: 13, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{playlist.name}</div>
                        </div>
                        <PosBadge pos={pos} />
                      </label>
                    ))}
                  </div>

                  {/* Action: Uniformize */}
                  {showUniformize && (
                    <div style={{ borderTop: "1px solid var(--border)", paddingTop: 12, marginBottom: 12 }}>
                      <div style={{ fontSize: 11, fontWeight: 700, color: "var(--muted)", letterSpacing: ".05em", marginBottom: 8 }}>
                        UNIFORMISER LA POSITION
                      </div>
                      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                        <span style={{ fontSize: 12, color: "var(--muted)" }}>Cible</span>
                        <input
                          type="number" min="1" value={uniformizePos}
                          onChange={e => setUniformizePos(Math.max(1, parseInt(e.target.value) || 1))}
                          style={{ width: 72 }}
                          disabled={actionWorking}
                        />
                        <button
                          className="btn btn-ghost btn-sm"
                          onClick={runUniformize}
                          disabled={actionWorking}
                        >
                          Uniformiser sur {scanFound.present.length} playlists
                        </button>
                      </div>
                    </div>
                  )}

                  {/* Action: Remove from selected */}
                  <div style={{ borderTop: "1px solid var(--border)", paddingTop: 12 }}>
                    {!confirmRemove ? (
                      <button
                        className="btn btn-danger"
                        disabled={actionWorking || selectedRemove.size === 0}
                        onClick={() => setConfirmRemove(true)}
                        style={{ padding: "7px 14px", fontSize: 12 }}
                      >
                        🗑 Supprimer de {selectedRemove.size} playlist{selectedRemove.size !== 1 ? "s" : ""} sélectionnée{selectedRemove.size !== 1 ? "s" : ""}
                      </button>
                    ) : (
                      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                        <span style={{ fontSize: 12, color: "var(--red)", fontWeight: 600 }}>
                          Confirmer la suppression de {selectedRemove.size} playlist{selectedRemove.size !== 1 ? "s" : ""} ?
                        </span>
                        <button className="btn btn-danger" onClick={runRemove} style={{ padding: "6px 12px", fontSize: 12 }}>
                          Confirmer
                        </button>
                        <button className="btn btn-ghost btn-sm" onClick={() => setConfirmRemove(false)}>
                          Annuler
                        </button>
                      </div>
                    )}
                  </div>
                </>
              )}
            </div>

            {/* ❌ Absent */}
            <div className="card" style={{ padding: 16 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: "var(--muted)", letterSpacing: ".06em" }}>
                  ❌ ABSENT DE {scanFound.absent.length} PLAYLIST{scanFound.absent.length !== 1 ? "S" : ""}
                </div>
                {scanFound.absent.length > 0 && (
                  <button
                    className="btn btn-ghost btn-sm"
                    onClick={() => {
                      if (selectedAdd.size === scanFound.absent.length)
                        setSelectedAdd(new Set());
                      else
                        setSelectedAdd(new Set(scanFound.absent.map(pl => pl.id)));
                    }}
                    disabled={actionWorking}
                  >
                    {selectedAdd.size === scanFound.absent.length ? "Tout décocher" : "Tout cocher"}
                  </button>
                )}
              </div>

              {scanFound.absent.length === 0 ? (
                <div style={{ fontSize: 13, color: "var(--faint)" }}>Présent dans toutes les playlists.</div>
              ) : (
                <>
                  <div style={{ display: "flex", flexDirection: "column", gap: 2, marginBottom: 14 }}>
                    {scanFound.absent.map(pl => (
                      <label key={pl.id} className="check-pl">
                        <input
                          type="checkbox"
                          checked={selectedAdd.has(pl.id)}
                          onChange={() => toggleAdd(pl.id)}
                          disabled={actionWorking}
                        />
                        {pl.images?.[0]?.url
                          ? <img src={pl.images[0].url} style={{ width: 32, height: 32, borderRadius: 5, objectFit: "cover", flexShrink: 0 }} />
                          : <div style={{ width: 32, height: 32, borderRadius: 5, background: "var(--surface2)", flexShrink: 0 }} />
                        }
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontSize: 13, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{pl.name}</div>
                        </div>
                      </label>
                    ))}
                  </div>

                  <div style={{ borderTop: "1px solid var(--border)", paddingTop: 12, display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                    <span style={{ fontSize: 12, color: "var(--muted)" }}>Ajouter à la position</span>
                    <input
                      type="number" min="1" value={addAbsentPos}
                      onChange={e => setAddAbsentPos(Math.max(1, parseInt(e.target.value) || 1))}
                      style={{ width: 72 }}
                      disabled={actionWorking}
                    />
                    <button
                      className="btn btn-green btn-sm"
                      disabled={actionWorking || selectedAdd.size === 0}
                      onClick={runAddToAbsent}
                    >
                      + Ajouter à {selectedAdd.size} playlist{selectedAdd.size !== 1 ? "s" : ""}
                    </button>
                  </div>
                </>
              )}
            </div>
          </div>
        )}
      </div>

      {/* ══════════════════════════════════════════════════════════════════
          SEPARATOR
      ══════════════════════════════════════════════════════════════════ */}
      <div style={{ borderTop: "1px solid var(--border)", marginBottom: 32 }} />

      {/* ══════════════════════════════════════════════════════════════════
          SECTION — MULTI-PLAYLIST (existing, unchanged)
      ══════════════════════════════════════════════════════════════════ */}
      <div style={{ fontSize: 11, fontWeight: 700, color: "var(--muted)", letterSpacing: ".06em", marginBottom: 14 }}>
        AJOUT / SUPPRESSION EN MASSE
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20, alignItems: "start" }}>

        {/* ── Left column ───────────────────────────── */}
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>

          {/* Mode toggle */}
          <div className="card" style={{ padding: 16 }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: "var(--muted)", letterSpacing: ".06em", marginBottom: 10 }}>ACTION</div>
            <div style={{ display: "flex", gap: 8 }}>
              {[
                { id: "add",    label: "Ajouter",   clr: "var(--green)", bg: "rgba(29,185,84,.12)", bd: "rgba(29,185,84,.3)" },
                { id: "remove", label: "Supprimer", clr: "var(--red)",   bg: "rgba(255,85,85,.1)",  bd: "rgba(255,85,85,.3)" },
              ].map(m => (
                <button
                  key={m.id} className="btn"
                  style={{
                    flex: 1, padding: "10px 0", fontSize: 13,
                    background: mode === m.id ? m.bg : "var(--surface2)",
                    color:      mode === m.id ? m.clr : "var(--muted)",
                    border:     `1px solid ${mode === m.id ? m.bd : "transparent"}`,
                  }}
                  onClick={() => setMode(m.id)}
                >
                  {m.label}
                </button>
              ))}
            </div>
          </div>

          {/* Track selection */}
          <div className="card" style={{ padding: 16 }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: "var(--muted)", letterSpacing: ".06em", marginBottom: 10 }}>SON</div>
            {track ? (
              <TrackChip track={track} onClear={() => { setTrack(null); setSearchQ(""); setResults([]); }} />
            ) : (
              <>
                <input
                  type="text"
                  placeholder="Titre, artiste ou lien Spotify…"
                  value={searchQ}
                  onChange={e => handleSearch(e.target.value)}
                />
                {searching && <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 8 }}>Recherche…</div>}
                {results.length > 0 && (
                  <div style={{ marginTop: 8, maxHeight: 220, overflowY: "auto", display: "flex", flexDirection: "column", gap: 1, borderTop: "1px solid var(--border)", paddingTop: 8 }}>
                    {results.map(t => (
                      <div key={t.id} className="track-row" style={{ cursor: "pointer" }}
                        onClick={() => { setTrack(t); setResults([]); setSearchQ(""); }}>
                        {t.album?.images?.[0]?.url && (
                          <img src={t.album.images[0].url} style={{ width: 34, height: 34, borderRadius: 5, objectFit: "cover", flexShrink: 0 }} />
                        )}
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontSize: 13, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{t.name}</div>
                          <div style={{ fontSize: 11, color: "var(--muted)" }}>{t.artists?.map(a => a.name).join(", ") ?? ""}</div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </>
            )}
          </div>

          {/* Position (add mode only) */}
          {mode === "add" && (
            <div className="card" style={{ padding: 16 }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: "var(--muted)", letterSpacing: ".06em", marginBottom: 12 }}>
                POSITION DANS LES PLAYLISTS
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {[
                  { id: "top",    label: "En première position" },
                  { id: "bottom", label: "En dernière position" },
                  { id: "custom", label: "Position personnalisée" },
                ].map(p => (
                  <label key={p.id} style={{
                    display: "flex", alignItems: "center", gap: 10, padding: "9px 12px", borderRadius: 9, cursor: "pointer",
                    background: posMode === p.id ? "rgba(29,185,84,.08)" : "transparent",
                    border: `1px solid ${posMode === p.id ? "rgba(29,185,84,.2)" : "transparent"}`,
                  }}>
                    <input
                      type="radio" name="posMode" value={p.id}
                      checked={posMode === p.id}
                      onChange={() => setPosMode(p.id)}
                      style={{ accentColor: "var(--green)", width: 15, height: 15 }}
                    />
                    <span style={{ fontSize: 13, fontWeight: 500, color: posMode === p.id ? "var(--text)" : "var(--muted)" }}>{p.label}</span>
                  </label>
                ))}
                {posMode === "custom" && (
                  <div style={{ display: "flex", alignItems: "center", gap: 10, paddingLeft: 12, marginTop: 4 }}>
                    <span style={{ fontSize: 12, color: "var(--muted)" }}>Insérer à la position</span>
                    <input
                      type="number" min="1" value={position}
                      onChange={e => setPosition(Math.max(1, parseInt(e.target.value) || 1))}
                      style={{ width: 72 }}
                    />
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Run button */}
          <button
            className="btn"
            disabled={!canRun}
            onClick={run}
            style={{
              padding: "14px", fontSize: 14, fontWeight: 700, borderRadius: 12,
              background: !canRun ? "var(--surface2)" : mode === "add" ? "var(--green)" : "var(--red)",
              color: !canRun ? "var(--faint)" : "#000",
              cursor: canRun ? "pointer" : "not-allowed",
              transition: "all .2s",
            }}
          >
            {working && progress
              ? `En cours… ${progress.done}/${progress.total}`
              : !track            ? "Choisis un son"
              : selected.size === 0 ? "Sélectionne des playlists"
              : mode === "add"    ? `Ajouter sur ${selected.size} playlist${selected.size > 1 ? "s" : ""}`
              :                     `Supprimer de ${selected.size} playlist${selected.size > 1 ? "s" : ""}`
            }
          </button>

          {/* Progress bar */}
          {working && progress && (
            <div style={{ height: 4, background: "var(--border)", borderRadius: 4, overflow: "hidden" }}>
              <div style={{
                height: "100%",
                width: `${(progress.done / progress.total) * 100}%`,
                background: mode === "add" ? "var(--green)" : "var(--red)",
                borderRadius: 4, transition: "width .3s ease",
              }} />
            </div>
          )}
        </div>

        {/* ── Right column: playlist selector ────────── */}
        <div className="card" style={{ padding: 16, maxHeight: "calc(100vh - 180px)", overflowY: "auto" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: "var(--muted)", letterSpacing: ".06em" }}>
              PLAYLISTS&nbsp;<span style={{ color: "var(--green)" }}>{selected.size}</span>/{playlists.length}
            </div>
            <button className="btn btn-ghost btn-sm" onClick={toggleAll}>
              {selected.size === playlists.length ? "Tout désélect." : "Tout sélect."}
            </button>
          </div>
          {loading ? (
            <div style={{ color: "var(--muted)", fontSize: 13 }}>Chargement…</div>
          ) : (
            playlists.map(pl => (
              <label key={pl.id} className="check-pl" style={{ opacity: working ? 0.5 : 1 }}>
                <input
                  type="checkbox"
                  checked={selected.has(pl.id)}
                  onChange={() => !working && toggle(pl.id)}
                  disabled={working}
                />
                {pl.images?.[0]?.url
                  ? <img src={pl.images[0].url} style={{ width: 34, height: 34, borderRadius: 6, objectFit: "cover", flexShrink: 0 }} />
                  : <div style={{ width: 34, height: 34, borderRadius: 6, background: "var(--surface2)", flexShrink: 0 }} />
                }
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{pl.name}</div>
                  <div style={{ fontSize: 11, color: "var(--faint)" }}>{pl.tracks?.total ?? pl.items?.total ?? "?"} tracks</div>
                </div>
              </label>
            ))
          )}
        </div>
      </div>

      <Toast toast={toast} />
    </div>
  );
}
