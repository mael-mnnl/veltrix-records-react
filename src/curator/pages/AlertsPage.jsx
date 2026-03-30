import { useState, useEffect } from "react";
import {
  searchArtist, getArtistAlbums, getAlbumTracks, getTrackById,
  getMe, createPlaylist, addTracksToPlaylist, getRecommendations, uploadPlaylistCover,
  isRLError, rlSecsFromError, isRateLimited,
} from "../utils/spotify";
import { fmtAge, TTL } from "../utils/cache";
import { Toast, useToast } from "../components/Toast";
import { SEED_ARTISTS, PLAYLIST_DESC } from "../utils/constants";

// ── Shared cache keys with RadarPage ─────────────────────────────────────────
const LS_IDS   = "radar_ids_v1";          // shared: name → id
const LS_ART   = "radar_artist_cache_v2"; // shared: artistId → { releases[], cachedAt }

// ── Alerts-specific storage ───────────────────────────────────────────────────
const LS_RULES = "curator_alerts_rules_v1"; // { popularity, window }
const LS_SEEN  = "curator_alerts_seen_v1";  // [id, ...]

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

// ── Shared artist-cache helpers ───────────────────────────────────────────────
function loadArtistCache() { try { return JSON.parse(localStorage.getItem(LS_ART)) || {}; } catch { return {}; } }
function saveArtistCache(c){ localStorage.setItem(LS_ART, JSON.stringify(c)); }

function loadRules() {
  try { return JSON.parse(localStorage.getItem(LS_RULES)) || { popularity: 50, window: 7 }; }
  catch { return { popularity: 50, window: 7 }; }
}
function loadSeen() {
  try { return new Set(JSON.parse(localStorage.getItem(LS_SEEN)) || []); }
  catch { return new Set(); }
}

function windowMs(win) { return win === 2 ? 2 * 86_400_000 : win === 7 ? 7 * 86_400_000 : 30 * 86_400_000; }

// ── Build releases from shared artist cache ───────────────────────────────────
function buildAllReleases(artistCache) {
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
  return { releases: all, oldestCachedAt };
}

function filterAlerts(releases, rules) {
  const ms = windowMs(rules.window);
  return releases.filter(r => {
    const age = Date.now() - new Date(r.releaseDate).getTime();
    return age <= ms && r.popularity > rules.popularity;
  });
}

// ── Component ─────────────────────────────────────────────────────────────────
export default function AlertsPage({ onUnseenChange }) {
  const [rules,    setRules]    = useState(loadRules);
  const [releases, setReleases] = useState([]); // all recent releases (full pool)
  const [seen,     setSeen]     = useState(loadSeen);
  const [cacheAge, setCacheAge] = useState(null);
  const [scanning, setScanning] = useState(false);
  const [progress, setProgress] = useState(null);
  const [error,    setError]    = useState(null);
  const [userId,   setUserId]   = useState(null);
  const [creating, setCreating] = useState(new Set());
  const { toast, show } = useToast();

  // ── Mount: load from shared radar cache, zero API calls ──────────────────
  useEffect(() => {
    getMe().then(me => setUserId(me?.id ?? null)).catch(() => {});

    const ac = loadArtistCache();
    if (Object.keys(ac).length > 0) {
      const { releases: rel, oldestCachedAt } = buildAllReleases(ac);
      setReleases(rel);
      setCacheAge(oldestCachedAt);
    }
  }, []);

  // ── Notify parent of unseen count ────────────────────────────────────────
  useEffect(() => {
    const alerts = filterAlerts(releases, rules);
    const count  = alerts.filter(a => !seen.has(a.id)).length;
    onUnseenChange?.(count);
  }, [releases, rules, seen]);

  function saveRules(next) {
    setRules(next);
    localStorage.setItem(LS_RULES, JSON.stringify(next));
  }
  function markSeen(id) {
    const next = new Set(seen);
    next.add(id);
    setSeen(next);
    localStorage.setItem(LS_SEEN, JSON.stringify([...next]));
  }

  // ── Scan (incremental, uses shared artist cache 12h) ─────────────────────
  async function scan(forceRefresh = false) {
    if (isRateLimited()) { setError("Rate limit actif — attends le cooldown"); return; }
    setScanning(true);
    setError(null);

    const ac  = loadArtistCache();
    const now = Date.now();

    try {
      // Phase 1 — resolve IDs (30-day, shared)
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

      // Phase 2 — per-artist scan (12h TTL, shared cache with Radar)
      const entries = Object.entries(ids);
      let   skipped = 0, fetched = 0;

      for (let i = 0; i < entries.length; i++) {
        const [name, artistId] = entries[i];
        const cached = ac[artistId];

        if (!forceRefresh && cached && (now - cached.cachedAt) < TTL.H12) {
          skipped++;
          continue;
        }

        setProgress({ label: `Scan ${i + 1}/${entries.length} · ${skipped} cache`, done: i + 1, total: entries.length });

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
              popularity:  a.popularity ?? 0,
            }));

          ac[artistId] = { releases, cachedAt: now };
          fetched++;

          const { releases: partial } = buildAllReleases(ac);
          setReleases(partial);

        } catch (e) {
          if (isRLError(e)) {
            saveArtistCache(ac);
            setError(`Rate limit — réessaie dans ${Math.ceil(rlSecsFromError(e) / 60)} min · ${skipped + fetched}/${entries.length} artistes`);
            return;
          }
        }
        await d500();
      }

      saveArtistCache(ac);
      const { releases: final, oldestCachedAt } = buildAllReleases(ac);
      setReleases(final);
      setCacheAge(oldestCachedAt);
      setError(null);

    } finally {
      setScanning(false);
      setProgress(null);
    }
  }

  // ── Create playlist (same as RadarPage) ──────────────────────────────────
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
      show(coverFailed ? `"${release.name}" créée ✓ (cover manquante)` : `"${release.name}" créée ✓`, "success");
      markSeen(release.id);
    } catch (e) {
      show(`Erreur : ${e.message}`, "error");
    } finally {
      setCreating(prev => { const n = new Set(prev); n.delete(release.id); return n; });
    }
  }

  // ── Derived state ─────────────────────────────────────────────────────────
  const alerts      = filterAlerts(releases, rules);
  const unseenList  = alerts.filter(a => !seen.has(a.id));
  const seenList    = alerts.filter(a =>  seen.has(a.id));
  const pct         = progress ? Math.round((progress.done / progress.total) * 100) : 0;

  return (
    <div className="fade-in">

      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 20 }}>
        <div>
          <h1 style={{ fontFamily: "var(--head)", fontSize: 26, fontWeight: 800, letterSpacing: "-.8px" }}>Alertes</h1>
          <p style={{ color: "var(--muted)", fontSize: 13, marginTop: 5 }}>
            {scanning
              ? (progress?.label ?? "Scan…")
              : cacheAge
                ? `Cache ${fmtAge(cacheAge)} · ${alerts.length} alertes`
                : "Aucune donnée — lance un scan"}
          </p>
        </div>
        <div style={{ display: "flex", gap: 8, marginTop: 4 }}>
          <button className="btn btn-ghost btn-sm" onClick={() => scan(false)} disabled={scanning}>↻ Scan incrémental</button>
          <button className="btn btn-ghost btn-sm" onClick={() => scan(true)}  disabled={scanning} style={{ color: "var(--red)", fontSize: 12 }}>🔄 Forcer</button>
        </div>
      </div>

      {/* Scan progress */}
      {scanning && progress && (
        <div style={{ marginBottom: 16 }}>
          <div style={{ height: 4, background: "var(--border)", borderRadius: 4, overflow: "hidden" }}>
            <div style={{ height: "100%", width: `${pct}%`, background: "var(--green)", borderRadius: 4, transition: "width .2s ease" }} />
          </div>
        </div>
      )}

      {error && (
        <div style={{ color: "var(--red)", fontSize: 13, marginBottom: 14, padding: "10px 14px", borderRadius: 10, background: "rgba(255,85,85,.08)" }}>
          ⚠ {error}
        </div>
      )}

      {/* Rules config */}
      <div className="card" style={{ padding: "14px 16px", marginBottom: 20, display: "flex", flexWrap: "wrap", gap: 20, alignItems: "center" }}>
        <div style={{ fontSize: 10, fontWeight: 700, color: "var(--muted)", letterSpacing: ".07em" }}>RÈGLES</div>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ fontSize: 12, whiteSpace: "nowrap" }}>Popularity &gt;</span>
          <input
            type="number" min="0" max="100"
            value={rules.popularity}
            onChange={e => saveRules({ ...rules, popularity: Math.max(0, Math.min(100, parseInt(e.target.value) || 0)) })}
            style={{ width: 60, textAlign: "center" }}
          />
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <span style={{ fontSize: 12, color: "var(--text)", whiteSpace: "nowrap" }}>Fenêtre</span>
          {[{ v: 2, l: "48h" }, { v: 7, l: "7j" }, { v: 30, l: "30j" }].map(({ v, l }) => (
            <button key={v} onClick={() => saveRules({ ...rules, window: v })} style={{ padding: "4px 10px", borderRadius: 20, fontSize: 12, border: "1px solid", cursor: "pointer", fontFamily: "var(--sans)", background: rules.window === v ? "rgba(29,185,84,.15)" : "var(--surface2)", color: rules.window === v ? "var(--green)" : "var(--muted)", borderColor: rules.window === v ? "rgba(29,185,84,.3)" : "var(--border)", fontWeight: rules.window === v ? 700 : 400 }}>{l}</button>
          ))}
        </div>
        {unseenList.length > 0 && (
          <div style={{ marginLeft: "auto", fontSize: 12, fontWeight: 700, color: "var(--red)" }}>{unseenList.length} non vue{unseenList.length > 1 ? "s" : ""}</div>
        )}
      </div>

      {/* Unseen */}
      {unseenList.length > 0 && (
        <div style={{ marginBottom: 20 }}>
          <div style={{ fontSize: 10, fontWeight: 700, color: "var(--muted)", letterSpacing: ".07em", marginBottom: 10 }}>
            NOUVELLES ({unseenList.length})
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            {unseenList.map(r => <AlertRow key={r.id} r={r} seen={false} onSeen={markSeen} onCreate={createAutoPlaylist} creating={creating} />)}
          </div>
        </div>
      )}

      {/* Seen */}
      {seenList.length > 0 && (
        <div>
          <div style={{ fontSize: 10, fontWeight: 700, color: "var(--muted)", letterSpacing: ".07em", marginBottom: 10 }}>
            DÉJÀ VUES ({seenList.length})
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            {seenList.map(r => <AlertRow key={r.id} r={r} seen={true} onSeen={markSeen} onCreate={createAutoPlaylist} creating={creating} />)}
          </div>
        </div>
      )}

      {!scanning && alerts.length === 0 && (
        <div style={{ color: "var(--muted)", fontSize: 13 }}>
          {releases.length > 0
            ? `Aucune alerte avec ces règles. (${releases.length} sorties trouvées — baisse le seuil de popularity)`
            : "Lance un scan ou ajuste les règles."}
        </div>
      )}

      <Toast toast={toast} />
    </div>
  );
}

function AlertRow({ r, seen, onSeen, onCreate, creating }) {
  const isCreating = creating.has(r.id);
  return (
    <div className="track-row" style={{ alignItems: "center", opacity: seen ? 0.5 : 1 }}>
      {r.cover
        ? <img src={r.cover} style={{ width: 44, height: 44, borderRadius: 8, objectFit: "cover", flexShrink: 0 }} />
        : <div style={{ width: 44, height: 44, borderRadius: 8, background: "var(--surface2)", flexShrink: 0 }} />
      }
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.name}</div>
        <div style={{ fontSize: 11, color: "var(--muted)", display: "flex", gap: 8, marginTop: 2 }}>
          <span>{r.artistName}</span>
          <span style={{ color: "var(--faint)" }}>·</span>
          <span>{r.releaseDate}</span>
          <span style={{ color: "var(--faint)" }}>·</span>
          <span style={{ textTransform: "uppercase", fontSize: 10 }}>{r.type}</span>
        </div>
      </div>
      {r.popularity > 0 && (
        <div style={{ padding: "3px 9px", borderRadius: 20, fontSize: 11, fontWeight: 700, flexShrink: 0, background: r.popularity >= 70 ? "rgba(29,185,84,.15)" : r.popularity >= 40 ? "rgba(245,166,35,.12)" : "rgba(255,85,85,.1)", color: r.popularity >= 70 ? "var(--green)" : r.popularity >= 40 ? "#f5a623" : "var(--red)" }}>
          {r.popularity}
        </div>
      )}
      <div className="track-actions" style={{ opacity: 1, display: "flex", gap: 6 }}>
        {!seen && <button className="btn btn-ghost btn-sm" onClick={() => onSeen(r.id)} style={{ fontSize: 11 }}>✓ Vu</button>}
        <button className="btn btn-sm" onClick={() => onCreate(r)} disabled={isCreating} style={{ background: isCreating ? "var(--surface2)" : "rgba(29,185,84,.15)", color: isCreating ? "var(--faint)" : "var(--green)", border: "1px solid rgba(29,185,84,.25)", minWidth: 118 }}>
          {isCreating ? "Création…" : "🎵 Créer playlist"}
        </button>
      </div>
    </div>
  );
}
