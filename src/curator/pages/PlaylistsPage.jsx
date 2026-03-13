import { useState, useEffect, useRef } from "react";
import {
  getAllPlaylists, getPlaylistTracks, getTrackById,
  removeTrackFromPlaylist, addTrackToPlaylist, searchTracks,
} from "../utils/spotify";
import { Toast, useToast } from "../components/Toast";

function extractSpotifyTrackId(input) {
  const m = input.match(/open\.spotify\.com\/(?:intl-[a-z]{2}\/)?track\/([A-Za-z0-9]+)/);
  return m ? m[1] : null;
}

const fmt = (ms) => {
  const s = Math.floor(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};

export default function PlaylistsPage() {
  const [playlists,  setPlaylists]  = useState([]);
  const [selected,   setSelected]   = useState(null);
  const [tracks,     setTracks]     = useState([]);
  const [loadingPl,  setLoadingPl]  = useState(true);
  const [loadingTr,  setLoadingTr]  = useState(false);
  const [errorPl,    setErrorPl]    = useState(null);
  const [errorTr,    setErrorTr]    = useState(null);
  const [searchQ,    setSearchQ]    = useState("");
  const [results,    setResults]    = useState([]);
  const [searching,  setSearching]  = useState(false);
  const [addPos,     setAddPos]     = useState(1);
  const searchTimer = useRef(null);
  const { toast, show } = useToast();

  useEffect(() => {
    getAllPlaylists()
      .then(setPlaylists)
      .catch(e => setErrorPl(e.message))
      .finally(() => setLoadingPl(false));
  }, []);

  // ── Load tracks for a playlist ────────────────────────────────────────────

  const loadTracks = async (pl) => {
    if (selected?.id === pl.id) return;
    setSelected(pl);
    setTracks([]);
    setResults([]);
    setSearchQ("");
    setErrorTr(null);
    setLoadingTr(true);
    try {
      setTracks(await getPlaylistTracks(pl.id));
    } catch (e) {
      setErrorTr(e.message);
    } finally {
      setLoadingTr(false);
    }
  };

  // ── Remove track ──────────────────────────────────────────────────────────

  const handleRemove = async (track) => {
    try {
      await removeTrackFromPlaylist(selected.id, track.uri);
      setTracks(prev => prev.filter(t => t.track.uri !== track.uri));
      show(`"${track.name}" supprimé`, "success");
    } catch (e) {
      show("Erreur : " + e.message, "error");
    }
  };

  // ── Search (URL Spotify or text) ──────────────────────────────────────────

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
        .catch(() => { setResults([]); show("Track introuvable", "error"); })
        .finally(() => setSearching(false));
      return;
    }

    if (q.length < 3) { setResults([]); setSearching(false); return; }
    setSearching(true);
    searchTimer.current = setTimeout(async () => {
      try {
        const data = await searchTracks(q);
        setResults(data?.tracks?.items || []);
      } catch (e) {
        show("Erreur recherche : " + e.message, "error");
      } finally {
        setSearching(false);
      }
    }, 500);
  };

  // ── Add track ─────────────────────────────────────────────────────────────

  const handleAdd = async (track) => {
    try {
      const pos = Math.max(0, addPos - 1);
      await addTrackToPlaylist(selected.id, track.uri, pos);
      show(`"${track.name}" ajouté en position ${addPos}`, "success");
      setSearchQ("");
      setResults([]);
      // Refresh la liste en arrière-plan, sans bloquer
      getPlaylistTracks(selected.id).then(setTracks).catch(() => {});
    } catch (e) {
      show("Erreur ajout : " + e.message, "error");
    }
  };

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="fade-in" style={{ display: "flex", gap: 20, height: "calc(100vh - 64px)" }}>

      {/* ── Left: playlist list ────────────────────── */}
      <div style={{ width: 280, minWidth: 280, overflowY: "auto", paddingRight: 4 }}>
        <h2 style={{ fontFamily: "var(--head)", fontSize: 20, fontWeight: 800, marginBottom: 14, letterSpacing: "-.5px" }}>
          Mes Playlists
          {!loadingPl && (
            <span style={{ marginLeft: 8, fontSize: 13, color: "var(--muted)", fontWeight: 400, fontFamily: "var(--sans)" }}>
              {playlists.length}
            </span>
          )}
        </h2>

        {loadingPl && (
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {[...Array(6)].map((_, i) => (
              <div key={i} style={{ display: "flex", gap: 10, alignItems: "center", opacity: 1 - i * 0.12 }}>
                <div style={{ width: 38, height: 38, borderRadius: 7, background: "var(--surface2)" }} />
                <div style={{ flex: 1 }}>
                  <div style={{ height: 11, width: "70%", background: "var(--surface2)", borderRadius: 4, marginBottom: 6 }} />
                  <div style={{ height: 9, width: "40%", background: "var(--border)", borderRadius: 4 }} />
                </div>
              </div>
            ))}
          </div>
        )}

        {errorPl && (
          <div style={{ color: "var(--red)", fontSize: 13, padding: 12, background: "rgba(255,85,85,.08)", borderRadius: 10 }}>
            ⚠ {errorPl}
          </div>
        )}

        {playlists.map(pl => (
          <div
            key={pl.id}
            className={`pl-row ${selected?.id === pl.id ? "selected" : ""}`}
            onClick={() => loadTracks(pl)}
          >
            {pl.images?.[0]?.url
              ? <img src={pl.images[0].url} style={{ width: 38, height: 38, borderRadius: 7, objectFit: "cover", flexShrink: 0 }} />
              : <div style={{ width: 38, height: 38, borderRadius: 7, background: "var(--surface2)", flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center" }}>♪</div>
            }
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: 13, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{pl.name}</div>
              <div style={{ fontSize: 11, color: "var(--faint)" }}>{pl.tracks?.total ?? pl.items?.total ?? "?"} tracks</div>
            </div>
          </div>
        ))}
      </div>

      {/* ── Right: track detail ────────────────────── */}
      <div style={{ flex: 1, overflowY: "auto", minWidth: 0 }}>
        {!selected ? (
          <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100%", color: "var(--faint)", flexDirection: "column", gap: 10 }}>
            <span style={{ fontSize: 36 }}>←</span>
            <span style={{ fontSize: 14 }}>Sélectionne une playlist</span>
          </div>
        ) : (
          <>
            {/* Header */}
            <div style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: 20 }}>
              {selected.images?.[0]?.url && (
                <img src={selected.images[0].url} style={{ width: 58, height: 58, borderRadius: 10, objectFit: "cover" }} />
              )}
              <div>
                <h2 style={{ fontFamily: "var(--head)", fontSize: 22, fontWeight: 800, letterSpacing: "-.5px" }}>{selected.name}</h2>
                <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 3 }}>
                  {loadingTr ? "Chargement…" : `${tracks.length} sons`}
                </div>
              </div>
            </div>

            {/* Error */}
            {errorTr && (
              <div style={{ color: "var(--red)", fontSize: 13, padding: 14, background: "rgba(255,85,85,.08)", borderRadius: 10, marginBottom: 16, lineHeight: 1.5 }}>
                ⚠ {errorTr}
              </div>
            )}

            {/* Add track */}
            <div className="card" style={{ padding: 14, marginBottom: 16 }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: "var(--muted)", letterSpacing: ".06em", marginBottom: 10 }}>
                AJOUTER UN SON
              </div>
              <div style={{ display: "flex", gap: 10, marginBottom: 8, alignItems: "center" }}>
                <input
                  type="text"
                  placeholder="Titre, artiste ou lien Spotify…"
                  value={searchQ}
                  onChange={e => handleSearch(e.target.value)}
                  style={{ flex: 1 }}
                />
                <div style={{ display: "flex", alignItems: "center", gap: 6, flexShrink: 0 }}>
                  <span style={{ fontSize: 11, color: "var(--muted)", whiteSpace: "nowrap" }}>Position</span>
                  <input
                    type="number" min="1"
                    value={addPos}
                    onChange={e => setAddPos(Math.max(1, parseInt(e.target.value) || 1))}
                    style={{ width: 68 }}
                  />
                </div>
              </div>

              {searching && <div style={{ fontSize: 12, color: "var(--muted)", padding: "4px 0" }}>Recherche…</div>}

              {results.length > 0 && (
                <div style={{ maxHeight: 220, overflowY: "auto", borderTop: "1px solid var(--border)", paddingTop: 8, display: "flex", flexDirection: "column", gap: 1 }}>
                  {results.map(t => (
                    <div key={t.id} className="track-row" style={{ cursor: "pointer" }} onClick={() => handleAdd(t)}>
                      {t.album?.images?.[0]?.url && (
                        <img src={t.album.images[0].url} style={{ width: 32, height: 32, borderRadius: 5, objectFit: "cover", flexShrink: 0 }} />
                      )}
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 13, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{t.name}</div>
                        <div style={{ fontSize: 11, color: "var(--muted)" }}>{t.artists?.map(a => a.name).join(", ") ?? ""}</div>
                      </div>
                      <span style={{ fontSize: 11, color: "var(--green)", fontWeight: 700, flexShrink: 0 }}>+ Ajouter</span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Track list */}
            {loadingTr ? (
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                {[...Array(8)].map((_, i) => (
                  <div key={i} style={{ display: "flex", gap: 10, alignItems: "center", padding: "8px 10px", opacity: 1 - i * 0.1 }}>
                    <div style={{ width: 28, height: 11, background: "var(--border)", borderRadius: 3 }} />
                    <div style={{ width: 36, height: 36, borderRadius: 6, background: "var(--surface2)", flexShrink: 0 }} />
                    <div style={{ flex: 1 }}>
                      <div style={{ height: 11, width: "55%", background: "var(--surface2)", borderRadius: 4, marginBottom: 6 }} />
                      <div style={{ height: 9,  width: "35%", background: "var(--border)",   borderRadius: 4 }} />
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 1 }}>
                {tracks.map((item, i) => {
                  const t = item.track;
                  return (
                    <div key={`${t.id}-${i}`} className="track-row">
                      <span style={{ fontSize: 11, color: "var(--faint)", width: 28, textAlign: "right", flexShrink: 0, fontFamily: "var(--mono)" }}>
                        {i + 1}
                      </span>
                      {t.album?.images?.[0]?.url && (
                        <img src={t.album.images[0].url} style={{ width: 36, height: 36, borderRadius: 6, objectFit: "cover", flexShrink: 0 }} />
                      )}
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 13, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{t.name}</div>
                        <div style={{ fontSize: 11, color: "var(--muted)" }}>
                          {t.artists?.map(a => a.name).join(", ") ?? ""}{t.album?.name ? ` · ${t.album.name}` : ""}
                        </div>
                      </div>
                      <span style={{ fontSize: 11, color: "var(--faint)", flexShrink: 0, fontFamily: "var(--mono)" }}>
                        {fmt(t.duration_ms)}
                      </span>
                      <div className="track-actions">
                        <button className="btn btn-danger btn-sm" onClick={() => handleRemove(t)}>Supprimer</button>
                      </div>
                    </div>
                  );
                })}
                {tracks.length === 0 && !errorTr && (
                  <div style={{ color: "var(--faint)", fontSize: 13, padding: 20 }}>Playlist vide</div>
                )}
              </div>
            )}
          </>
        )}
      </div>

      <Toast toast={toast} />
    </div>
  );
}
