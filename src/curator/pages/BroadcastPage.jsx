import { useState, useEffect, useRef } from "react";
import {
  getAllPlaylists, searchTracks, getTrackById,
  addTrackToPlaylist, removeTrackFromPlaylist,
} from "../utils/spotify";
import { Toast, useToast } from "../components/Toast";

function extractSpotifyTrackId(input) {
  const m = input.match(/open\.spotify\.com\/(?:intl-[a-z]{2}\/)?track\/([A-Za-z0-9]+)/);
  return m ? m[1] : null;
}

export default function BroadcastPage() {
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
  const { toast, show } = useToast();

  useEffect(() => {
    getAllPlaylists()
      .then(setPlaylists)
      .catch(e => show("Erreur playlists : " + e.message, "error"))
      .finally(() => setLoading(false));
  }, []);

  // ── Search ────────────────────────────────────────────────────────────────

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
      try {
        const data = await searchTracks(q);
        setResults(data?.tracks?.items || []);
      } catch {}
      finally { setSearching(false); }
    }, 500);
  };

  // ── Selection ─────────────────────────────────────────────────────────────

  const toggleAll = () => {
    if (selected.size === playlists.length) setSelected(new Set());
    else setSelected(new Set(playlists.map(p => p.id)));
  };

  const toggle = (id) => {
    setSelected(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  // ── Run broadcast ─────────────────────────────────────────────────────────

  const resolvePosition = () => {
    if (posMode === "top")    return 0;
    if (posMode === "bottom") return undefined; // omit → Spotify appends at end
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
        if (mode === "add") {
          await addTrackToPlaylist(id, track.uri, resolvePosition());
        } else {
          await removeTrackFromPlaylist(id, track.uri);
        }
        ok++;
      } catch {
        failed++;
      }
      setProgress({ done: ok + failed, total: ids.length });
      await new Promise(r => setTimeout(r, 300));
    }

    const verb = mode === "add" ? "Ajouté à" : "Supprimé de";
    show(
      `${verb} ${ok}/${ids.length} playlists${failed ? ` (${failed} échoué)` : ""}`,
      ok === ids.length ? "success" : "error",
    );

    setWorking(false);
    setProgress(null);
  };

  const canRun = track && selected.size > 0 && !working;

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

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20, alignItems: "start" }}>

        {/* ── Left column ───────────────────────────── */}
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>

          {/* Mode toggle */}
          <div className="card" style={{ padding: 16 }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: "var(--muted)", letterSpacing: ".06em", marginBottom: 10 }}>ACTION</div>
            <div style={{ display: "flex", gap: 8 }}>
              {[
                { id: "add",    label: "Ajouter",    clr: "var(--green)", bg: "rgba(29,185,84,.12)", bd: "rgba(29,185,84,.3)" },
                { id: "remove", label: "Supprimer",  clr: "var(--red)",   bg: "rgba(255,85,85,.1)",  bd: "rgba(255,85,85,.3)" },
              ].map(m => (
                <button
                  key={m.id}
                  className="btn"
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
              <div style={{ display: "flex", alignItems: "center", gap: 12, padding: 10, background: "var(--surface2)", borderRadius: 10 }}>
                {track.album?.images?.[0]?.url && (
                  <img src={track.album.images[0].url} style={{ width: 46, height: 46, borderRadius: 8, objectFit: "cover", flexShrink: 0 }} />
                )}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 700, fontSize: 14, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{track.name}</div>
                  <div style={{ fontSize: 12, color: "var(--muted)" }}>{track.artists?.map(a => a.name).join(", ") ?? ""}</div>
                </div>
                <button className="btn btn-ghost btn-sm" onClick={() => { setTrack(null); setSearchQ(""); setResults([]); }}>
                  Changer
                </button>
              </div>
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
                      <div key={t.id} className="track-row" style={{ cursor: "pointer" }} onClick={() => { setTrack(t); setResults([]); setSearchQ(""); }}>
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
              : !track
              ? "Choisis un son"
              : selected.size === 0
              ? "Sélectionne des playlists"
              : mode === "add"
              ? `Ajouter sur ${selected.size} playlist${selected.size > 1 ? "s" : ""}`
              : `Supprimer de ${selected.size} playlist${selected.size > 1 ? "s" : ""}`
            }
          </button>

          {/* Progress bar */}
          {working && progress && (
            <div style={{ height: 4, background: "var(--border)", borderRadius: 4, overflow: "hidden" }}>
              <div style={{
                height: "100%",
                width: `${(progress.done / progress.total) * 100}%`,
                background: mode === "add" ? "var(--green)" : "var(--red)",
                borderRadius: 4,
                transition: "width .3s ease",
              }} />
            </div>
          )}
        </div>

        {/* ── Right column: playlist selector ────────── */}
        <div className="card" style={{ padding: 16, maxHeight: "calc(100vh - 180px)", overflowY: "auto" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: "var(--muted)", letterSpacing: ".06em" }}>
              PLAYLISTS&nbsp;
              <span style={{ color: "var(--green)" }}>{selected.size}</span>/{playlists.length}
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
