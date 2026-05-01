import { useState, useEffect } from "react";
import { getAllPlaylists, getPlaylistFollowers } from "../utils/spotify";
import { getCached, setCached, fmtAge, TTL } from "../utils/cache";
import { Toast, useToast } from "../components/Toast";

// ── Storage keys ──────────────────────────────────────────────────────────────
const LS_SNAPS    = "curator_stats_v1";       // { [plId]: [{ date, followers }] }
const LS_SNAPHIST = "curator_snap_history_v1"; // { [plId]: { snapshotId, changedAt } }
const LS_FOLLOW   = "curator_follow_cache_v1"; // { [plId]: { followers, fetchedAt } }  (6h)
const MAX_SNAPS   = 60;

const delay = (ms) => new Promise(r => setTimeout(r, ms));

function todayStr() { return new Date().toISOString().slice(0, 10); }
function daysDiff(a, b) { return Math.round((new Date(a) - new Date(b)) / 86_400_000); }

function snapClosestTo30(hist) {
  if (!hist || hist.length < 2) return null;
  const target = new Date(Date.now() - 30 * 86_400_000).toISOString().slice(0, 10);
  let best = null, bestDiff = Infinity;
  for (const s of hist) {
    const d = Math.abs(daysDiff(s.date, target));
    if (d < bestDiff) { bestDiff = d; best = s; }
  }
  if (!best || best.date === todayStr() || bestDiff > 7) return null;
  return best;
}

// ── Health score (0–100) ──────────────────────────────────────────────────────
function computeHealth(followers, tracks, pct30, daysSinceChange) {
  const ratio      = tracks > 0 ? followers / tracks : 0;
  const scoreRatio = Math.min(40, (ratio / 50) * 40);
  const scorePct   = pct30 === null ? 20 : Math.max(0, Math.min(40, pct30 + 20));
  const scoreFresh = daysSinceChange === null ? 10
    : daysSinceChange <= 7  ? 20
    : daysSinceChange >= 14 ? 0
    : Math.round(((14 - daysSinceChange) / 7) * 20);
  return Math.round(scoreRatio + scorePct + scoreFresh);
}

function healthBadge(score) {
  if (score > 70) return { label: "🟢 En forme",     color: "var(--green)", bg: "rgba(29,185,84,.12)" };
  if (score > 40) return { label: "🟡 À surveiller", color: "#f5a623",      bg: "rgba(245,166,35,.12)" };
  return               { label: "🔴 À réanimer",   color: "var(--red)",   bg: "rgba(255,85,85,.12)" };
}

// ── Snapshot helpers ──────────────────────────────────────────────────────────
function loadSnaps()    { try { return JSON.parse(localStorage.getItem(LS_SNAPS))    || {}; } catch { return {}; } }
function saveSnaps(d)   { localStorage.setItem(LS_SNAPS,    JSON.stringify(d)); }
function loadSnapHist() { try { return JSON.parse(localStorage.getItem(LS_SNAPHIST)) || {}; } catch { return {}; } }
function saveSnapHist(d){ localStorage.setItem(LS_SNAPHIST, JSON.stringify(d)); }
function loadFollowCache() { try { return JSON.parse(localStorage.getItem(LS_FOLLOW)) || {}; } catch { return {}; } }
function saveFollowCache(d){ localStorage.setItem(LS_FOLLOW, JSON.stringify(d)); }

// ── Build rows from cached data (no API) ──────────────────────────────────────
function buildRows(playlists, snaps, snapHist) {
  const now = Date.now();
  return playlists.map(pl => {
    const hist    = snaps[pl.id] ?? [];
    const latest  = hist.at(-1)?.followers ?? 0;
    const prev    = hist.length >= 2 ? hist[hist.length - 2] : null;
    const delta   = prev !== null ? latest - prev.followers : null;
    const snap30  = snapClosestTo30(hist);
    const delta30 = snap30 !== null ? latest - snap30.followers : null;
    const pct30   = snap30 !== null && snap30.followers > 0
      ? ((latest - snap30.followers) / snap30.followers) * 100 : null;

    const sh             = snapHist[pl.id];
    const daysSince      = sh?.changedAt ? (now - sh.changedAt) / 86_400_000 : null;
    const tracks         = pl.tracks?.total ?? 0;
    const health         = computeHealth(latest, tracks, pct30, daysSince);

    return { id: pl.id, name: pl.name, cover: pl.images?.[0]?.url ?? null, tracks, followers: latest, delta, delta30, pct30, health };
  });
}

function computeGlobals(rows, snaps) {
  const totalFollowers = rows.reduce((s, r) => s + r.followers, 0);
  const w30  = rows.filter(r => r.delta30 !== null);
  const sumN = w30.reduce((s, r) => s + r.followers, 0);
  const sumB = w30.reduce((s, r) => {
    const h = snaps[r.id] ?? [];
    const snap = snapClosestTo30(h);
    return s + (snap?.followers ?? r.followers);
  }, 0);
  const globalPct30 = sumB > 0 ? ((sumN - sumB) / sumB) * 100 : null;
  const topRow = [...rows].sort((a, b) => (b.delta30 ?? -Infinity) - (a.delta30 ?? -Infinity))[0];
  return { totalFollowers, globalPct30, topName: topRow?.delta30 > 0 ? topRow.name : null, topDelta30: topRow?.delta30 ?? null };
}

function makeSorter(key) {
  return (a, b) => {
    if (key === "health")    return b.health - a.health;
    if (key === "pct30")     return (b.pct30    ?? -Infinity) - (a.pct30    ?? -Infinity);
    if (key === "delta")     return (b.delta    ?? -Infinity) - (a.delta    ?? -Infinity);
    if (key === "followers") return b.followers - a.followers;
    return 0;
  };
}

// ── Component ─────────────────────────────────────────────────────────────────
export default function StatsPage() {
  const [rows,      setRows]      = useState([]);
  const [globals,   setGlobals]   = useState(null);
  const [loading,   setLoading]   = useState(false);
  const [progress,  setProgress]  = useState(null);
  const [sortBy,    setSortBy]    = useState("health");
  const [cacheAge,  setCacheAge]  = useState(null); // timestamp of last follower fetch
  const { toast, show } = useToast();

  // ── Mount: build from localStorage only, zero API calls ─────────────────
  useEffect(() => {
    initFromCache();
  }, []);

  async function initFromCache() {
    try {
      const playlists = await getAllPlaylists(); // uses LS cache (30 min TTL)
      const snaps     = loadSnaps();
      const snapHist  = loadSnapHist();

      const built = buildRows(playlists, snaps, snapHist).sort(makeSorter("health"));
      setRows(built);
      if (built.length > 0) setGlobals(computeGlobals(built, snaps));

      // Show age of last follower fetch
      const followCache = loadFollowCache();
      const ages = Object.values(followCache).map(v => v.fetchedAt).filter(Boolean);
      if (ages.length > 0) setCacheAge(Math.max(...ages));
    } catch {}
  }

  // ── Refresh followers (top 10 by tracks.total, 6h cache) ─────────────────
  async function refreshFollowers(forceAll = false) {
    setLoading(true);
    setProgress(null);

    try {
      const playlists  = await getAllPlaylists();
      const snaps      = loadSnaps();
      const snapHist   = loadSnapHist();
      const followCache = loadFollowCache();
      const today      = todayStr();
      const now        = Date.now();

      // Sort by tracks.total desc, pick top 10 (or all if forced)
      const sorted = [...playlists].sort((a, b) => (b.tracks?.total ?? 0) - (a.tracks?.total ?? 0));
      const toFetch = forceAll ? sorted : sorted.slice(0, 10);

      for (let i = 0; i < toFetch.length; i++) {
        const pl = toFetch[i];
        setProgress({ done: i + 1, total: toFetch.length });

        // 6h cache per playlist
        const fc = followCache[pl.id];
        let followers;
        if (!forceAll && fc && (now - fc.fetchedAt) < TTL.H6) {
          followers = fc.followers;
        } else {
          try {
            const data = await getPlaylistFollowers(pl.id);
            followers  = data?.followers?.total ?? null;
            if (followers !== null) {
              followCache[pl.id] = { followers, fetchedAt: now };
            }
          } catch {}
          await delay(500);
        }

        // Update snapshot
        let hist = [...(snaps[pl.id] ?? [])];
        if (followers !== null) {
          if (hist.length === 0 || hist.at(-1).date !== today) hist.push({ date: today, followers });
          else hist[hist.length - 1].followers = followers;
          if (hist.length > MAX_SNAPS) hist = hist.slice(-MAX_SNAPS);
          snaps[pl.id] = hist;
        }

        // Track snapshot_id changes for health score freshness
        const snapshotId = pl.snapshot_id;
        const she = snapHist[pl.id];
        if (!she || (snapshotId && she.snapshotId !== snapshotId)) {
          snapHist[pl.id] = { snapshotId, changedAt: now };
        }
      }

      saveSnaps(snaps);
      saveSnapHist(snapHist);
      saveFollowCache(followCache);
      setCacheAge(now);

      const built = buildRows(playlists, snaps, snapHist).sort(makeSorter(sortBy));
      setRows(built);
      setGlobals(computeGlobals(built, snaps));

    } catch (e) {
      show("Erreur : " + e.message, "error");
    } finally {
      setLoading(false);
      setProgress(null);
    }
  }

  function resort(key) {
    setSortBy(key);
    setRows(prev => [...prev].sort(makeSorter(key)));
  }

  const top15    = [...rows].sort((a, b) => b.followers - a.followers).slice(0, 15);
  const maxFol   = top15[0]?.followers || 1;
  const pct      = progress ? Math.round((progress.done / progress.total) * 100) : 0;

  function fmtPct(v)  { return v === null ? null : `${v >= 0 ? "+" : ""}${v.toFixed(1)}%`; }
  function pctColor(v){ return v === null ? "var(--faint)" : v > 0 ? "var(--green)" : v < 0 ? "var(--red)" : "var(--faint)"; }

  const GRID = "44px 1fr 85px 70px 85px 55px 126px";

  return (
    <div className="fade-in">

      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 24 }}>
        <div>
          <h1 style={{ fontFamily: "var(--head)", fontSize: 26, fontWeight: 800, letterSpacing: "-.8px" }}>Stats</h1>
          <p style={{ color: "var(--muted)", fontSize: 13, marginTop: 5 }}>
            {loading
              ? `Mise à jour followers… ${progress ? `${progress.done}/${progress.total}` : ""}`
              : cacheAge
                ? `Followers mis à jour ${fmtAge(cacheAge)} · ${rows.length} playlists`
                : rows.length > 0
                  ? `${rows.length} playlists — followers en attente de mise à jour`
                  : "Aucune donnée — ouvre cette page pour commencer"}
          </p>
        </div>
        <div style={{ display: "flex", gap: 8, marginTop: 4 }}>
          <button className="btn btn-ghost btn-sm" onClick={() => refreshFollowers(false)} disabled={loading}>
            ↻ Top 10 followers
          </button>
          <button className="btn btn-ghost btn-sm" onClick={() => refreshFollowers(true)} disabled={loading} style={{ color: "var(--red)", fontSize: 12 }}>
            🔄 Tout actualiser
          </button>
        </div>
      </div>

      {/* Progress bar */}
      {loading && progress && (
        <div style={{ marginBottom: 20 }}>
          <div style={{ height: 4, background: "var(--border)", borderRadius: 4, overflow: "hidden" }}>
            <div style={{ height: "100%", width: `${pct}%`, background: "var(--green)", borderRadius: 4, transition: "width .15s ease" }} />
          </div>
        </div>
      )}

      {/* Global stat cards */}
      {globals && (
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 16, marginBottom: 28 }}>
          <div className="card" style={{ padding: "18px 20px" }}>
            <div style={{ fontSize: 10, fontWeight: 700, color: "var(--muted)", letterSpacing: ".07em", marginBottom: 10 }}>FOLLOWERS TOTAUX</div>
            <div style={{ fontFamily: "var(--head)", fontSize: 28, fontWeight: 800, letterSpacing: "-1px" }}>
              {globals.totalFollowers.toLocaleString()}
            </div>
            <div style={{ fontSize: 11, color: "var(--faint)", marginTop: 4 }}>sur {rows.length} playlists</div>
          </div>
          <div className="card" style={{ padding: "18px 20px" }}>
            <div style={{ fontSize: 10, fontWeight: 700, color: "var(--muted)", letterSpacing: ".07em", marginBottom: 10 }}>PROGRESSION 30 JOURS</div>
            {globals.globalPct30 !== null ? (
              <>
                <div style={{ fontFamily: "var(--head)", fontSize: 28, fontWeight: 800, letterSpacing: "-1px", color: pctColor(globals.globalPct30) }}>
                  {fmtPct(globals.globalPct30)}
                </div>
                <div style={{ fontSize: 11, color: "var(--faint)", marginTop: 4 }}>cumulé global</div>
              </>
            ) : (
              <>
                <div style={{ fontFamily: "var(--head)", fontSize: 22, fontWeight: 800, color: "var(--faint)" }}>En cours…</div>
                <div style={{ fontSize: 11, color: "var(--faint)", marginTop: 4 }}>données &lt; 30j</div>
              </>
            )}
          </div>
          <div className="card" style={{ padding: "18px 20px" }}>
            <div style={{ fontSize: 10, fontWeight: 700, color: "var(--muted)", letterSpacing: ".07em", marginBottom: 10 }}>PLUS FORTE PROGRESSION</div>
            {globals.topName ? (
              <>
                <div style={{ fontFamily: "var(--head)", fontSize: 16, fontWeight: 800, color: "var(--green)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{globals.topName}</div>
                <div style={{ fontSize: 11, color: "var(--faint)", marginTop: 6 }}>+{globals.topDelta30?.toLocaleString() ?? "?"} / 30j</div>
              </>
            ) : (
              <>
                <div style={{ fontFamily: "var(--head)", fontSize: 22, fontWeight: 800, color: "var(--faint)" }}>En cours…</div>
                <div style={{ fontSize: 11, color: "var(--faint)", marginTop: 4 }}>données insuffisantes</div>
              </>
            )}
          </div>
        </div>
      )}

      {rows.length === 0 && !loading && (
        <div style={{ color: "var(--muted)", fontSize: 13 }}>Clique sur "Top 10 followers" pour récupérer les données.</div>
      )}

      {/* Bar chart top 15 */}
      {top15.length > 0 && (
        <div className="card" style={{ padding: 20, marginBottom: 24 }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: "var(--muted)", letterSpacing: ".07em", marginBottom: 16 }}>TOP 15 — FOLLOWERS</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {top15.map(r => {
              const barPct = Math.max(1, Math.round((r.followers / maxFol) * 100));
              const badge  = healthBadge(r.health);
              return (
                <div key={r.id} style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <div style={{ width: 120, minWidth: 120, fontSize: 12, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.name}</div>
                  <div style={{ flex: 1, height: 12, background: "var(--surface2)", borderRadius: 4, overflow: "hidden" }}>
                    <div style={{ height: "100%", width: `${barPct}%`, background: r.delta30 > 0 ? "var(--green)" : r.delta30 < 0 ? "var(--red)" : "var(--border2)", borderRadius: 4, transition: "width .4s ease" }} />
                  </div>
                  <div style={{ width: 55, textAlign: "right", fontSize: 11, fontWeight: 700, color: "var(--muted)" }}>{r.followers.toLocaleString()}</div>
                  <div style={{ width: 58, textAlign: "right", fontSize: 11, fontWeight: 600, color: pctColor(r.pct30) }}>{fmtPct(r.pct30) ?? "—"}</div>
                  <span style={{ fontSize: 14 }}>{badge.label.slice(0, 2)}</span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Table */}
      {rows.length > 0 && (
        <div className="card" style={{ overflow: "hidden" }}>
          {/* Header */}
          <div style={{ display: "grid", gridTemplateColumns: GRID, gap: 10, padding: "10px 16px", borderBottom: "1px solid var(--border)", fontSize: 10, fontWeight: 700, color: "var(--muted)", letterSpacing: ".07em" }}>
            <div />
            <div>NOM</div>
            {[{ k: "followers", l: "FOLLOWERS" }, { k: "delta", l: "J-1" }, { k: "pct30", l: "30J %" }].map(({ k, l }) => (
              <button key={k}
                style={{ background: "none", border: "none", fontWeight: 700, fontSize: 10, letterSpacing: ".07em", color: sortBy === k ? "var(--green)" : "var(--muted)", textAlign: "left", cursor: "pointer", fontFamily: "var(--sans)", padding: 0 }}
                onClick={() => resort(k)}
              >{l}{sortBy === k ? " ↓" : ""}</button>
            ))}
            <div>TRACKS</div>
            <button style={{ background: "none", border: "none", fontWeight: 700, fontSize: 10, letterSpacing: ".07em", color: sortBy === "health" ? "var(--green)" : "var(--muted)", textAlign: "left", cursor: "pointer", fontFamily: "var(--sans)", padding: 0 }} onClick={() => resort("health")}>
              HEALTH{sortBy === "health" ? " ↓" : ""}
            </button>
          </div>
          {/* Rows */}
          {rows.map(r => {
            const badge = healthBadge(r.health);
            return (
              <div key={r.id} style={{ display: "grid", gridTemplateColumns: GRID, gap: 10, padding: "8px 16px", borderBottom: "1px solid var(--border)", alignItems: "center" }}>
                {r.cover
                  ? <img src={r.cover} style={{ width: 34, height: 34, borderRadius: 6, objectFit: "cover" }} />
                  : <div style={{ width: 34, height: 34, borderRadius: 6, background: "var(--surface2)" }} />
                }
                <div style={{ fontSize: 13, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.name}</div>
                <div style={{ fontSize: 13 }}>{r.followers.toLocaleString()}</div>
                <div style={{ fontSize: 12, fontWeight: 600, color: r.delta === null ? "var(--faint)" : r.delta > 0 ? "var(--green)" : r.delta < 0 ? "var(--red)" : "var(--faint)" }}>
                  {r.delta === null ? "—" : r.delta >= 0 ? `+${r.delta}` : r.delta}
                </div>
                <div style={{ fontSize: 12, fontWeight: 600, color: pctColor(r.pct30) }}>
                  {r.pct30 !== null ? fmtPct(r.pct30) : <span style={{ color: "var(--faint)", fontStyle: "italic", fontWeight: 400 }}>En cours…</span>}
                </div>
                <div style={{ fontSize: 12, color: "var(--muted)" }}>{r.tracks}</div>
                <div style={{ display: "inline-flex", alignItems: "center", gap: 4, padding: "3px 8px", borderRadius: 20, fontSize: 11, fontWeight: 700, background: badge.bg, color: badge.color, whiteSpace: "nowrap" }}>
                  <span style={{ fontSize: 9, fontWeight: 800 }}>{r.health}</span>
                  <span>{badge.label}</span>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <Toast toast={toast} />
    </div>
  );
}
