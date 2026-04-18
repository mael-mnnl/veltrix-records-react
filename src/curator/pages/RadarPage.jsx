import { useState, useEffect, Fragment, useMemo } from "react";
import {
  searchArtist, getArtistAlbums, getAlbumsBatch, getTracksBatch, getAlbumTracks, getTrackById,
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
const LS_POPS   = "radar_artist_pops_v1";  // artistId → popularity (filled during resolution)
const LS_ART    = "radar_artist_cache_v2"; // artistId → { releases[], cachedAt }  (12h)
const LS_RESUME = "radar_scan_resume_v1";  // { index, total, cachedAt }  (30 min)
const RESUME_TTL = 30 * 60_000;

const delay = (ms) => new Promise(r => setTimeout(r, ms));
const d500  = () => delay(500);

function isWithin30Days(dateStr) {
  const ts = new Date(dateStr).getTime();
  return !isNaN(ts) && Date.now() - ts <= 30 * 86_400_000;
}

function fmtRelativeDate(dateStr) {
  const ms   = Date.now() - new Date(dateStr).getTime();
  const days = Math.floor(ms / 86_400_000);
  if (days === 0) return "aujourd'hui";
  if (days === 1) return "hier";
  if (days < 30)  return `il y a ${days}j`;
  return new Date(dateStr).toLocaleDateString("fr-FR", { day: "numeric", month: "short", year: "numeric" });
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
  const [sortBy,       setSortBy]       = useState("popular"); // popular | recent | trending | less2w
  const [dateFilter,   setDateFilter]   = useState("all");     // all | 14d | 30d
  const { toast, show } = useToast();

  // ── Score = popularité directe (0-100) ───────────────────────────────────────
  const scoreMap = useMemo(() => {
    if (!releases.length) return {};
    return Object.fromEntries(releases.map(r => [r.id, r.popularity ?? 0]));
  }, [releases]);

  // ── Sorted + filtered view ────────────────────────────────────────────────────
  const displayed = useMemo(() => {
    const MS14 = 14 * 86_400_000;
    const MS30 = 30 * 86_400_000;
    const now  = Date.now();
    const age  = r => now - new Date(r.releaseDate).getTime();

    // 1. Apply date pill filter
    let list = releases.filter(r => {
      if (dateFilter === "14d") return age(r) <= MS14;
      if (dateFilter === "30d") return age(r) <= MS30;
      return true;
    });

    // 2. Sort mode (trending / less2w also add a 14d gate on top)
    if (sortBy === "popular") {
      list = list.slice().sort((a, b) => (b.popularity ?? 0) - (a.popularity ?? 0));
    } else if (sortBy === "recent") {
      list = list.slice().sort((a, b) => new Date(b.releaseDate) - new Date(a.releaseDate));
    } else if (sortBy === "trending") {
      list = list
        .filter(r => age(r) <= MS14)
        .slice()
        .sort((a, b) => (b.popularity ?? 0) - (a.popularity ?? 0));
    } else if (sortBy === "less2w") {
      list = list
        .filter(r => age(r) <= MS14)
        .slice()
        .sort((a, b) => new Date(b.releaseDate) - new Date(a.releaseDate));
    }

    return list;
  }, [releases, sortBy, dateFilter]);

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
      // ── Phase 1: resolve artist IDs + capture artist popularity ──────────────
      let ids;
      try { ids = JSON.parse(localStorage.getItem(LS_IDS)) || {}; } catch { ids = {}; }
      let artistPops;
      try { artistPops = JSON.parse(localStorage.getItem(LS_POPS)) || {}; } catch { artistPops = {}; }

      const toResolve = SEED_ARTISTS.filter(n => !ids[n]);
      for (let i = 0; i < toResolve.length; i++) {
        setProgress({ label: `Résolution ${i + 1}/${toResolve.length}`, done: i + 1, total: toResolve.length });
        try {
          const d = await searchArtist(toResolve[i]);
          const a = d?.artists?.items?.[0];
          if (a?.id) {
            ids[toResolve[i]] = a.id;
            // Store artist popularity — the only reliable non-zero metric for small artists
            artistPops[a.id] = a.popularity ?? 0;
          }
        } catch (e) {
          if (isRLError(e)) {
            localStorage.setItem(LS_IDS, JSON.stringify(ids));
            localStorage.setItem(LS_POPS, JSON.stringify(artistPops));
            setError(`Rate limit — réessaie dans ${Math.ceil(rlSecsFromError(e) / 60)} min`);
            return;
          }
        }
        await d500();
      }
      localStorage.setItem(LS_IDS, JSON.stringify(ids));
      localStorage.setItem(LS_POPS, JSON.stringify(artistPops));

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
          const data   = await getArtistAlbums(artistId);
          const within = (data?.items || []).filter(a => isWithin30Days(a.release_date));

          // getArtistAlbums returns simplified objects — no popularity field.
          // Strategy: batch-fetch full album objects for album popularity, then
          // also fetch the first track of each album to get track-level popularity
          // (more reliable for small artists whose album popularity is often 0).
          const albumPopMap = {};
          const firstTrackIdMap = {}; // albumId → trackId
          if (within.length > 0) {
            // Step 1: batch-fetch full album objects (includes album popularity + tracklist)
            try {
              const full = await getAlbumsBatch(within.map(a => a.id));
              for (const fa of full?.albums ?? []) {
                if (!fa?.id) continue;
                albumPopMap[fa.id] = fa.popularity ?? 0;
                // Grab first track id from the embedded tracklist (no extra call needed)
                const firstTrack = fa.tracks?.items?.[0];
                if (firstTrack?.id) firstTrackIdMap[fa.id] = firstTrack.id;
              }
            } catch {}
            await d500();

            // Step 2: batch-fetch full track objects to get track-level popularity
            const trackIds = Object.values(firstTrackIdMap).filter(Boolean);
            const trackPopMap = {}; // trackId → popularity
            if (trackIds.length > 0) {
              try {
                const { tracks } = await getTracksBatch(trackIds) ?? {};
                for (const tr of tracks ?? []) {
                  if (tr?.id) trackPopMap[tr.id] = tr.popularity ?? 0;
                }
              } catch {}
              await d500();
            }

            // Merge: use the higher of album popularity vs track popularity
            for (const albumId of Object.keys(albumPopMap)) {
              const tId = firstTrackIdMap[albumId];
              const trackPop = tId ? (trackPopMap[tId] ?? 0) : 0;
              albumPopMap[albumId] = Math.max(albumPopMap[albumId], trackPop);
            }
          }

          const releases = within.map(a => ({
              id:          a.id,
              uri:         a.uri,
              trackId:     firstTrackIdMap[a.id] ?? null,
              name:        a.name,
              artistName:  a.artists?.[0]?.name ?? name,
              releaseDate: a.release_date,
              cover:       a.images?.[0]?.url ?? null,
              coverMedium: a.images?.[1]?.url ?? a.images?.[0]?.url ?? null,
              type:        a.album_type,
              // Best of: album pop, track pop, or artist pop (always non-zero for registered artists)
              popularity:  Math.max(albumPopMap[a.id] ?? 0, artistPops[artistId] ?? 0),
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
    localStorage.removeItem(LS_IDS);   // Force re-resolution so Phase 1 captures artist popularity
    localStorage.removeItem(LS_POPS);
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

      const pl = await createPlaylist(userId, `${release.name} - 1 HOUR`, `${release.name} - ${INLINE_DESC_SUFFIX}`);
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
    if (!displayed.length) return;
    setBulkProgress({ done: 0, total: displayed.length });
    for (let i = 0; i < displayed.length; i++) {
      await createAutoPlaylist(displayed[i]);
      setBulkProgress({ done: i + 1, total: displayed.length });
      if (i < displayed.length - 1) await delay(1500);
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
                ? `Cache ${fmtAge(cacheAge)} · ${SEED_ARTISTS.length} artistes · ${displayed.length}/${releases.length} sorties`
                : `${SEED_ARTISTS.length} artistes — aucune donnée`}
          </p>
        </div>
        <div style={{ display: "flex", gap: 8, marginTop: 4, flexWrap: "wrap", justifyContent: "flex-end" }}>
          {!scanning && displayed.length > 0 && (
            <button className="btn btn-green btn-sm" onClick={createAll} disabled={isBulking || !userId} style={{ fontSize: 12 }}>
              🚀 Tout créer ({displayed.length})
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

      {/* Filter + Sort toolbar */}
      {releases.length > 0 && !scanning && (
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 14, flexWrap: "wrap" }}>
          {/* Date pills */}
          {[
            { id: "all", label: "Tout" },
            { id: "14d", label: "< 2 semaines" },
            { id: "30d", label: "< 1 mois" },
          ].map(f => (
            <button
              key={f.id}
              className="btn btn-sm"
              onClick={() => setDateFilter(f.id)}
              style={{
                background: dateFilter === f.id ? "rgba(29,185,84,.12)" : "var(--surface2)",
                border:     `1px solid ${dateFilter === f.id ? "rgba(29,185,84,.3)" : "var(--border2)"}`,
                color:      dateFilter === f.id ? "var(--green)" : "var(--muted)",
              }}
            >
              {f.label}
            </button>
          ))}
          {/* Sort dropdown */}
          <select
            value={sortBy}
            onChange={e => setSortBy(e.target.value)}
            style={{
              marginLeft: "auto",
              fontFamily: "var(--sans)",
              background: "var(--surface2)",
              border: "1px solid var(--border2)",
              color: "var(--text)",
              borderRadius: 9,
              padding: "6px 12px",
              fontSize: 12,
              outline: "none",
              cursor: "pointer",
            }}
          >
            <option value="popular">🔥 Plus streamés</option>
            <option value="recent">🆕 Plus récents</option>
            <option value="trending">📈 Tendance (14j)</option>
            <option value="less2w">🕐 Moins de 2 semaines</option>
          </select>
        </div>
      )}

      {/* Release list */}
      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        {displayed.map(r => {
          const isCreating = creating.has(r.id);
          const isExpanded = expandedId === r.id;
          const nameUp     = r.name.toUpperCase();
          const plTitle    = `${nameUp} - 1 HOUR`;
          const plDesc     = `${nameUp} - ${INLINE_DESC_SUFFIX}`;
          const titleKey   = `title-${r.id}`;
          const descKey    = `desc-${r.id}`;
          const isNew      = Date.now() - new Date(r.releaseDate).getTime() <= 14 * 86_400_000;
          const score      = scoreMap[r.id] ?? 0;
          const scoreBg    = score >= 70 ? "rgba(29,185,84,0.15)"  : score >= 40 ? "rgba(255,200,0,0.12)"  : "rgba(255,85,85,0.12)";
          const scoreBd    = score >= 70 ? "var(--green)"           : score >= 40 ? "#c9a94e"               : "var(--red)";
          const scoreClr   = score >= 70 ? "var(--green)"           : score >= 40 ? "#c9a94e"               : "var(--red)";

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

                {/* Score badge */}
                <div style={{
                  flexShrink: 0,
                  width: 40, height: 40,
                  borderRadius: 8,
                  background: scoreBg,
                  border: `1px solid ${scoreBd}`,
                  color: scoreClr,
                  display: "flex", flexDirection: "column",
                  alignItems: "center", justifyContent: "center",
                  lineHeight: 1,
                }}>
                  <span style={{ fontWeight: 800, fontSize: 15 }}>{score}</span>
                  <span style={{ fontSize: 9, opacity: 0.6, marginTop: 1 }}>/100</span>
                </div>

                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
                    <span style={{ fontSize: 13, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.name}</span>
                    {isNew && (
                      <span style={{ flexShrink: 0, fontSize: 9, fontWeight: 700, background: "rgba(29,185,84,.15)", color: "var(--green)", border: "1px solid rgba(29,185,84,.3)", borderRadius: 5, padding: "1px 5px", letterSpacing: ".06em" }}>NEW</span>
                    )}
                  </div>
                  <div style={{ fontSize: 11, color: "var(--muted)", display: "flex", gap: 8, marginTop: 2, flexWrap: "wrap", alignItems: "center" }}>
                    <span>{r.artistName}</span>
                    <span style={{ color: "var(--faint)" }}>·</span>
                    <span>{fmtRelativeDate(r.releaseDate)}</span>
                    <span style={{ color: "var(--faint)" }}>·</span>
                    <span style={{ textTransform: "uppercase", fontSize: 10, letterSpacing: ".05em" }}>{r.type}</span>
                  </div>
                  {r.popularity > 0 && (
                    <div style={{ display: "flex", alignItems: "center", gap: 7, marginTop: 5 }}>
                      <div style={{ width: 100, height: 4, background: "var(--border)", borderRadius: 4, overflow: "hidden", flexShrink: 0 }}>
                        <div style={{
                          height: "100%",
                          width: `${r.popularity}%`,
                          background: r.popularity >= 70 ? "var(--green)" : r.popularity >= 40 ? "#f5a623" : "var(--faint)",
                          borderRadius: 4,
                        }} />
                      </div>
                      <span style={{ fontSize: 10, color: "var(--faint)", fontFamily: "var(--mono)" }}>{r.popularity}</span>
                    </div>
                  )}
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
