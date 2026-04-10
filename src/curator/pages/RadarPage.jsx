import { useState, useEffect, Fragment } from "react";
import {
  searchArtist, getArtistAlbums, getAlbumTracks, getTrackById,
  getAllPlaylists, addTrackToPlaylist,
  getMe, createPlaylist, addTracksToPlaylist, getRecommendations, uploadPlaylistCover,
  isRLError, rlSecsFromError, isRateLimited,
} from "../utils/spotify";
import { fmtAge, TTL } from "../utils/cache";
import { Toast, useToast } from "../components/Toast";
import { SEED_ARTISTS } from "../utils/constants";

const INLINE_DESC_SUFFIX = "1 HOUR PLAYLIST ig: pxroducer - SEKIMANE - CONFESS YOUR LOVE - DJ SAMIR - LXNGVX - VIRAL - MXZI - JXNDRO - SAYFALSE - PREY - JMILTON - SMA$HER - CAPE - SEKIMANE - ZXKAI - DJ FKU";

// ── Cache keys ────────────────────────────────────────────────────────────────
const LS_IDS    = "radar_ids_v1";          // name → id  (30 days, never refetch)
const LS_ART    = "radar_artist_cache_v2"; // artistId → { releases[], cachedAt }  (12h)
const LS_RESUME = "radar_scan_resume_v1";  // { index, total, cachedAt }  (30 min)
const RESUME_TTL = 30 * 60_000;

const delay = (ms) => new Promise(r => setTimeout(r, ms));
const d500  = () => delay(500);

function isWithin30Days(dateStr) {
  const ts = new Date(dateStr).getTime();
  return !isNaN(ts) && Date.now() - ts <= 30 * 86_400_000;
}
async function imageToBase64(url) {
  const res  = await fetch(url);
  const blob = await res.blob();
  return new Promise((res2, rej) => {
    const r = new FileReader();
    r.onload  = () => res2(r.result.split(",")[1]);
    r.onerror = rej;
    r.readAsDataURL(blob);
  });
}

// ── Per-artist album cache ────────────────────────────────────────────────────
function loadArtistCache() {
  try { return JSON.parse(localStorage.getItem(LS_ART)) || {}; } catch { return {}; }
}
function saveArtistCache(c) {
  localStorage.setItem(LS_ART, JSON.stringify(c));
}

// ── Build display releases from artist cache ──────────────────────────────────
function buildReleases(artistCache) {
  const all  = [];
  const seen = new Set();
  let   oldestCachedAt = Date.now();
  for (const [, entry] of Object.entries(artistCache)) {
    if (!entry?.releases) continue;
    if (entry.cachedAt < oldestCachedAt) oldestCachedAt = entry.cachedAt;
    for (const r of entry.releases) {
      if (!seen.has(r.id)) { seen.add(r.id); all.push(r); }
    }
  }
  all.sort((a, b) => new Date(b.releaseDate) - new Date(a.releaseDate));
  return { releases: all, oldestCachedAt };
}

// ── Resume state ──────────────────────────────────────────────────────────────
function loadResume() {
  try {
    const r = JSON.parse(localStorage.getItem(LS_RESUME));
    return (r && Date.now() - r.cachedAt < RESUME_TTL) ? r : null;
  } catch { return null; }
}

// ── Component ─────────────────────────────────────────────────────────────────
export default function RadarPage() {
  const [releases,     setReleases]     = useState([]);
  const [cacheAge,     setCacheAge]     = useState(null);
  const [scanning,     setScanning]     = useState(false);
  const [progress,     setProgress]     = useState(null);
  const [error,        setError]        = useState(null);
  const [resumeInfo,   setResumeInfo]   = useState(null);
  const [playlists,    setPlaylists]    = useState([]);
  const [pickerFor,    setPickerFor]    = useState(null);
  const [addingTo,     setAddingTo]     = useState(null);
  const [userId,       setUserId]       = useState(null);
  const [creating,     setCreating]     = useState(new Set());
  const [bulkProgress, setBulkProgress] = useState(null);
  const [expandedId,   setExpandedId]   = useState(null);
  const [copiedField,  setCopiedField]  = useState(null);
  const { toast, show } = useToast();

  // ── Mount: load from cache only, zero API calls ──────────────────────────
  useEffect(() => {
    getAllPlaylists().then(setPlaylists).catch(() => {});
    getMe().then(me => setUserId(me?.id ?? null)).catch(() => {});

    const ac = loadArtistCache();
    if (Object.keys(ac).length > 0) {
      const { releases: rel, oldestCachedAt } = buildReleases(ac);
      setReleases(rel);
      setCacheAge(oldestCachedAt);
    }
    const resume = loadResume();
    if (resume) setResumeInfo(resume);
  }, []);

  // ── Scan ──────────────────────────────────────────────────────────────────
  async function scan(forceRefresh = false) {
    if (isRateLimited()) { setError("Rate limit actif — attends le cooldown"); return; }
    setScanning(true);
    setError(null);
    localStorage.removeItem(LS_RESUME);
    setResumeInfo(null);

    const ac  = loadArtistCache();
    const now = Date.now();

    try {
      // ── Phase 1: resolve artist IDs (30-day cache, never refetch if present) ──
      let ids;
      try { ids = JSON.parse(localStorage.getItem(LS_IDS)) || {}; } catch { ids = {}; }

      const toResolve = SEED_ARTISTS.filter(n => !ids[n]);
      for (let i = 0; i < toResolve.length; i++) {
        setProgress({ label: `Résolution ${i + 1}/${toResolve.length}`, done: i + 1, total: toResolve.length });
        try {
          const d = await searchArtist(toResolve[i]);
          const a = d?.artists?.items?.[0];
          if (a?.id) ids[toResolve[i]] = a.id;
        } catch (e) {
          if (isRLError(e)) {
            localStorage.setItem(LS_IDS, JSON.stringify(ids));
            setError(`Rate limit — réessaie dans ${Math.ceil(rlSecsFromError(e) / 60)} min`);
            return;
          }
        }
        await d500();
      }
      localStorage.setItem(LS_IDS, JSON.stringify(ids));

      // ── Phase 2: per-artist album scan (12h TTL, incremental display) ─────
      const entries = Object.entries(ids);
      let   skipped = 0, fetched = 0, rateLim = 0;

      for (let i = 0; i < entries.length; i++) {
        const [name, artistId] = entries[i];
        const cached = ac[artistId];

        if (!forceRefresh && cached && (now - cached.cachedAt) < TTL.H12) {
          skipped++;
          continue; // skip — cache still fresh
        }

        setProgress({
          label:   `Scan ${i + 1}/${entries.length}`,
          done:    i + 1, total: entries.length, skipped, fetched,
        });

        try {
          const data     = await getArtistAlbums(artistId);
          const releases = (data?.items || [])
            .filter(a => isWithin30Days(a.release_date))
            .map(a => ({
              id:          a.id,
              uri:         a.uri,
              trackId:     null,
              name:        a.name,
              artistName:  a.artists?.[0]?.name ?? name,
              releaseDate: a.release_date,
              cover:       a.images?.[0]?.url ?? null,
              coverMedium: a.images?.[1]?.url ?? a.images?.[0]?.url ?? null,
              type:        a.album_type,
              // album.popularity from simplified object — 0 if absent, no extra request
              popularity:  a.popularity ?? 0,
            }));

          ac[artistId] = { releases, cachedAt: now };
          fetched++;

          // Show results immediately as they arrive
          const { releases: partial } = buildReleases(ac);
          setReleases(partial);

        } catch (e) {
          if (isRLError(e)) {
            localStorage.setItem(LS_RESUME, JSON.stringify({ index: i, total: entries.length, cachedAt: now }));
            saveArtistCache(ac);
            const secs = rlSecsFromError(e);
            setError(`Rate limit — réessaie dans ${Math.ceil(secs / 60)} min · ${skipped + fetched}/${entries.length} artistes traités`);
            setResumeInfo({ index: i, total: entries.length });
            return;
          }
          rateLim++;
        }

        await d500();
      }

      saveArtistCache(ac);

      const { releases: final, oldestCachedAt } = buildReleases(ac);
      setReleases(final);
      setCacheAge(oldestCachedAt);

      if (rateLim > 0) setError(`${rateLim} artiste(s) non scanné(s) (erreur réseau).`);
      else setError(null);

    } finally {
      setScanning(false);
      setProgress(null);
    }
  }

  function handleForceRefresh() {
    localStorage.removeItem(LS_ART);
    scan(true);
  }

  // ── Create playlist ───────────────────────────────────────────────────────
  async function createAutoPlaylist(release) {
    if (!userId) { show("user_id non disponible", "error"); return; }
    setCreating(prev => new Set(prev).add(release.id));
    let coverFailed = false;
    try {
      let trackUri = release.uri;
      let trackId  = release.trackId;
      if (!trackId) {
        try {
          const td = await getAlbumTracks(release.id);
          const ft = td?.items?.[0];
          if (ft?.id) {
            const tr = await getTrackById(ft.id);
            trackUri = tr?.uri ?? trackUri;
            trackId  = ft.id;
            setReleases(prev => prev.map(r => r.id === release.id ? { ...r, trackId: ft.id, uri: tr?.uri ?? r.uri } : r));
          }
        } catch {}
      }

      const pl = await createPlaylist(userId, `${release.name} - 1 HOUR`, `${release.name} ${PLAYLIST_DESC}`);
      await addTracksToPlaylist(pl.id, Array(5).fill(trackUri));

      if (trackId) {
        try {
          const recs    = await getRecommendations(trackId);
          const recUris = (recs?.tracks || []).map(t => t.uri).filter(Boolean);
          if (recUris.length > 0) await addTracksToPlaylist(pl.id, recUris);
        } catch {}
      }

      const coverUrl = release.coverMedium ?? release.cover;
      if (coverUrl) {
        try { const b64 = await imageToBase64(coverUrl); await uploadPlaylistCover(pl.id, b64); }
        catch { coverFailed = true; }
      }

      show(coverFailed ? `"${release.name}" créée ✓ (cover non uploadée)` : `"${release.name}" créée ✓`, "success");
      return pl;
    } catch (e) {
      show(`Erreur : ${e.message}`, "error");
      return null;
    } finally {
      setCreating(prev => { const n = new Set(prev); n.delete(release.id); return n; });
    }
  }

  async function createAll() {
    if (!releases.length) return;
    setBulkProgress({ done: 0, total: releases.length });
    for (let i = 0; i < releases.length; i++) {
      await createAutoPlaylist(releases[i]);
      setBulkProgress({ done: i + 1, total: releases.length });
      if (i < releases.length - 1) await delay(1500);
    }
    setBulkProgress(null);
  }

  async function addToPlaylist(playlistId, release) {
    setAddingTo(playlistId);
    try {
      await addTrackToPlaylist(playlistId, release.uri, 0);
      show("Ajouté !", "success");
      setPickerFor(null);
    } catch (e) { show("Erreur : " + e.message, "error"); }
    finally { setAddingTo(null); }
  }

  // ── Cover download ────────────────────────────────────────────────────────
  async function downloadCover(url, name) {
    try {
      const res    = await fetch(url);
      const blob   = await res.blob();
      const objUrl = URL.createObjectURL(blob);
      const a      = document.createElement("a");
      a.href       = objUrl;
      a.download   = name.toUpperCase().replace(/\s+/g, "-") + "-cover.jpg";
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(objUrl);
    } catch {}
  }

  // ── Copy to clipboard ─────────────────────────────────────────────────────
  function handleCopy(text, fieldKey) {
    navigator.clipboard.writeText(text).then(() => {
      setCopiedField(fieldKey);
      setTimeout(() => setCopiedField(f => f === fieldKey ? null : f), 2000);
    }).catch(() => {});
  }

  // ── Render ────────────────────────────────────────────────────────────────
  const pct      = progress     ? Math.round((progress.done / progress.total) * 100) : 0;
  const bulkPct  = bulkProgress ? Math.round((bulkProgress.done / bulkProgress.total) * 100) : 0;
  const isBulking = bulkProgress !== null;
  const hasCache  = cacheAge !== null;

  return (
    <div className="fade-in">

      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 16 }}>
        <div>
          <h1 style={{ fontFamily: "var(--head)", fontSize: 26, fontWeight: 800, letterSpacing: "-.8px" }}>Radar</h1>
          <p style={{ color: "var(--muted)", fontSize: 13, marginTop: 5 }}>
            {scanning
              ? (progress?.label ?? "Scan…")
              : hasCache
                ? `Cache ${fmtAge(cacheAge)} · ${SEED_ARTISTS.length} artistes · ${releases.length} sorties`
                : `${SEED_ARTISTS.length} artistes — aucune donnée`}
          </p>
        </div>
        <div style={{ display: "flex", gap: 8, marginTop: 4, flexWrap: "wrap", justifyContent: "flex-end" }}>
          {!scanning && releases.length > 0 && (
            <button className="btn btn-green btn-sm" onClick={createAll} disabled={isBulking || !userId} style={{ fontSize: 12 }}>
              🚀 Tout créer ({releases.length})
            </button>
          )}
          {!scanning && hasCache && (
            <button className="btn btn-ghost btn-sm" onClick={() => scan(false)} disabled={isBulking}>
              ↻ Scan incrémental
            </button>
          )}
          <button className="btn btn-ghost btn-sm" onClick={handleForceRefresh} disabled={scanning || isBulking} style={{ color: "var(--red)", fontSize: 12 }}>
            🔄 Forcer la mise à jour
          </button>
          {!scanning && !hasCache && (
            <button className="btn btn-sm" onClick={() => scan(false)} style={{ background: "rgba(29,185,84,.15)", color: "var(--green)", border: "1px solid rgba(29,185,84,.25)" }}>
              🔍 Scanner
            </button>
          )}
        </div>
      </div>

      {/* Resume hint */}
      {resumeInfo && !scanning && (
        <div style={{ marginBottom: 12, padding: "10px 14px", borderRadius: 10, background: "rgba(245,166,35,.1)", border: "1px solid rgba(245,166,35,.2)", fontSize: 12, color: "#f5a623", display: "flex", alignItems: "center", gap: 10 }}>
          ⚡ Scan interrompu à {resumeInfo.index}/{resumeInfo.total}.
          <button className="btn btn-ghost btn-sm" onClick={() => scan(false)} style={{ fontSize: 11, color: "#f5a623" }}>Reprendre</button>
        </div>
      )}

      {/* Scan progress */}
      {scanning && progress && (
        <div style={{ marginBottom: 14 }}>
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, color: "var(--muted)", marginBottom: 4 }}>
            <span>{progress.label}</span>
            {progress.skipped !== undefined && (
              <span style={{ color: "var(--faint)" }}>
                {progress.skipped} cache · {progress.fetched} actualisés
              </span>
            )}
          </div>
          <div style={{ height: 4, background: "var(--border)", borderRadius: 4, overflow: "hidden" }}>
            <div style={{ height: "100%", width: `${pct}%`, background: "var(--green)", borderRadius: 4, transition: "width .2s ease" }} />
          </div>
        </div>
      )}

      {/* Bulk progress */}
      {isBulking && (
        <div style={{ marginBottom: 14 }}>
          <div style={{ fontSize: 12, color: "var(--muted)", marginBottom: 6 }}>Création playlists… {bulkProgress.done}/{bulkProgress.total}</div>
          <div style={{ height: 4, background: "var(--border)", borderRadius: 4, overflow: "hidden" }}>
            <div style={{ height: "100%", width: `${bulkPct}%`, background: "var(--green)", borderRadius: 4, transition: "width .4s ease" }} />
          </div>
        </div>
      )}

      {error && (
        <div style={{ color: "var(--red)", fontSize: 13, marginBottom: 14, padding: "10px 14px", borderRadius: 10, background: "rgba(255,85,85,.08)" }}>
          ⚠ {error}
        </div>
      )}

      {!scanning && releases.length === 0 && !error && (
        <div style={{ color: "var(--muted)", fontSize: 13 }}>
          {hasCache ? "Aucune sortie dans les 30 derniers jours." : "Lance un scan pour voir les sorties récentes."}
        </div>
      )}

      {/* Release list */}
      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        {releases.map(r => {
          const isCreating = creating.has(r.id);
          const isExpanded = expandedId === r.id;
          const nameUp     = r.name.toUpperCase();
          const plTitle    = `${nameUp} - 1 HOUR`;
          const plDesc     = `${nameUp} - ${INLINE_DESC_SUFFIX}`;
          const titleKey   = `title-${r.id}`;
          const descKey    = `desc-${r.id}`;

          return (
            <Fragment key={r.id}>
              <div
                className="track-row"
                style={{ alignItems: "center", cursor: "pointer" }}
                onClick={() => setExpandedId(isExpanded ? null : r.id)}
              >
                {r.cover
                  ? <img src={r.cover} style={{ width: 44, height: 44, borderRadius: 8, objectFit: "cover", flexShrink: 0 }} />
                  : <div style={{ width: 44, height: 44, borderRadius: 8, background: "var(--surface2)", flexShrink: 0 }} />
                }
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.name}</div>
                  <div style={{ fontSize: 11, color: "var(--muted)", display: "flex", gap: 8, marginTop: 2, flexWrap: "wrap" }}>
                    <span>{r.artistName}</span>
                    <span style={{ color: "var(--faint)" }}>·</span>
                    <span>{r.releaseDate}</span>
                    <span style={{ color: "var(--faint)" }}>·</span>
                    <span style={{ textTransform: "uppercase", fontSize: 10, letterSpacing: ".05em" }}>{r.type}</span>
                    {r.popularity > 0 && (
                      <><span style={{ color: "var(--faint)" }}>·</span>
                      <span style={{ color: r.popularity >= 70 ? "var(--green)" : r.popularity >= 40 ? "#f5a623" : "var(--faint)" }}>♦ {r.popularity}</span></>
                    )}
                  </div>
                </div>
                <div className="track-actions" style={{ opacity: 1, display: "flex", gap: 6 }}>
                  <button className="btn btn-ghost btn-sm" onClick={e => { e.stopPropagation(); setPickerFor(pickerFor?.id === r.id ? null : r); }} disabled={isCreating || isBulking}>
                    + Playlist
                  </button>
                  <button
                    className="btn btn-sm"
                    onClick={e => { e.stopPropagation(); createAutoPlaylist(r); }}
                    disabled={isCreating || isBulking || !userId}
                    style={{ background: isCreating ? "var(--surface2)" : "rgba(29,185,84,.15)", color: isCreating ? "var(--faint)" : "var(--green)", border: "1px solid rgba(29,185,84,.25)", minWidth: 118 }}
                  >
                    {isCreating ? "Création…" : "🎵 Créer playlist"}
                  </button>
                </div>
              </div>

              {isExpanded && (
                <div style={{
                  margin: "0 0 6px 56px",
                  background: "var(--surface2)",
                  border: "1px solid var(--border)",
                  borderRadius: 12,
                  padding: 16,
                  display: "flex",
                  gap: 20,
                  alignItems: "flex-start",
                  animation: "fadeIn .2s ease",
                }}>
                  {/* Cover */}
                  {r.cover && (
                    <div style={{ flexShrink: 0 }}>
                      <img
                        src={r.cover}
                        style={{ width: 200, height: 200, borderRadius: 10, objectFit: "cover", boxShadow: "0 4px 24px rgba(0,0,0,.5)", display: "block" }}
                      />
                      <button
                        className="btn btn-ghost btn-sm"
                        style={{ marginTop: 8, width: "100%", fontSize: 11 }}
                        onClick={() => downloadCover(r.cover, r.name)}
                      >
                        ⬇ Télécharger la cover
                      </button>
                    </div>
                  )}

                  {/* Fields */}
                  <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 14, minWidth: 0 }}>
                    <div style={{ display: "flex", justifyContent: "flex-end" }}>
                      <button
                        className="btn btn-ghost btn-sm"
                        style={{ fontSize: 13, padding: "2px 8px" }}
                        onClick={() => setExpandedId(null)}
                      >
                        ✕
                      </button>
                    </div>

                    {/* Titre */}
                    <div>
                      <div style={{ fontSize: 11, fontWeight: 700, color: "var(--muted)", letterSpacing: ".06em", marginBottom: 6 }}>TITRE DE PLAYLIST</div>
                      <div style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
                        <textarea
                          readOnly
                          value={plTitle}
                          rows={1}
                          className="curator-textarea"
                        />
                        <button
                          className="btn btn-ghost btn-sm"
                          style={{ flexShrink: 0, color: copiedField === titleKey ? "var(--green)" : undefined }}
                          onClick={() => handleCopy(plTitle, titleKey)}
                        >
                          {copiedField === titleKey ? "✓ Copié !" : "Copier"}
                        </button>
                      </div>
                    </div>

                    {/* Description */}
                    <div>
                      <div style={{ fontSize: 11, fontWeight: 700, color: "var(--muted)", letterSpacing: ".06em", marginBottom: 6 }}>DESCRIPTION</div>
                      <div style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
                        <textarea
                          readOnly
                          value={plDesc}
                          rows={3}
                          className="curator-textarea"
                        />
                        <button
                          className="btn btn-ghost btn-sm"
                          style={{ flexShrink: 0, color: copiedField === descKey ? "var(--green)" : undefined }}
                          onClick={() => handleCopy(plDesc, descKey)}
                        >
                          {copiedField === descKey ? "✓ Copié !" : "Copier"}
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </Fragment>
          );
        })}
      </div>

      {/* Picker modal */}
      {pickerFor && (
        <div style={{ position: "fixed", inset: 0, zIndex: 200, background: "rgba(8,8,16,.7)", display: "flex", alignItems: "center", justifyContent: "center" }} onClick={() => setPickerFor(null)}>
          <div className="card fade-in" style={{ width: 340, maxHeight: "60vh", overflowY: "auto", padding: 16 }} onClick={e => e.stopPropagation()}>
            <div style={{ fontFamily: "var(--head)", fontWeight: 700, fontSize: 15, marginBottom: 4 }}>Ajouter à une playlist</div>
            <div style={{ fontSize: 12, color: "var(--muted)", marginBottom: 14 }}>{pickerFor.name} — {pickerFor.artistName}</div>
            {playlists.map(pl => (
              <div key={pl.id} className="pl-row" style={{ cursor: "pointer", opacity: addingTo === pl.id ? 0.5 : 1 }} onClick={() => !addingTo && addToPlaylist(pl.id, pickerFor)}>
                {pl.images?.[0]?.url
                  ? <img src={pl.images[0].url} style={{ width: 34, height: 34, borderRadius: 6, objectFit: "cover", flexShrink: 0 }} />
                  : <div style={{ width: 34, height: 34, borderRadius: 6, background: "var(--surface2)", flexShrink: 0 }} />
                }
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{pl.name}</div>
                  <div style={{ fontSize: 11, color: "var(--faint)" }}>{pl.tracks?.total ?? "?"} tracks</div>
                </div>
                {addingTo === pl.id && <span style={{ fontSize: 11, color: "var(--muted)", marginLeft: "auto" }}>…</span>}
              </div>
            ))}
          </div>
        </div>
      )}

      <Toast toast={toast} />
    </div>
  );
}
