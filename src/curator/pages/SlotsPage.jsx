import { useState, useEffect, useRef, useMemo } from "react";
import {
  getAllPlaylists, searchTracks, getTrackById, getPlaylistTracks,
  removeTrackFromPlaylist, addTrackToPlaylist,
} from "../utils/spotify";
import {
  getActiveSlots, getExpiredSlots, addSlot, removeSlot,
  updateSlot, cleanExpiredSlots, subscribeToSlots, unsubscribeSlots,
} from "../utils/slots";
import { isSupabaseConfigured, SUPABASE_ERROR } from "../utils/supabase";
import { Toast, useToast } from "../components/Toast";

const GOLD = "#c9a94e";

function extractSpotifyTrackId(input) {
  const m = input.match(/open\.spotify\.com\/(?:intl-[a-z]{2}\/)?track\/([A-Za-z0-9]+)/);
  return m ? m[1] : null;
}

function fmtDate(iso) {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("fr-FR", { day: "2-digit", month: "short", year: "numeric" });
}

function daysBetween(a, b) {
  return Math.max(0, Math.ceil((new Date(b) - new Date(a)) / 86_400_000));
}

function hoursBetween(a, b) {
  return Math.max(0, Math.ceil((new Date(b) - new Date(a)) / 3_600_000));
}

// ── Time remaining label + color ─────────────────────────────────────────────
function timeLeft(endDate) {
  const now = new Date();
  const end = new Date(endDate);
  const ms  = end - now;
  if (ms <= 0) return { label: "Expiré", color: "var(--red)" };
  const hours = ms / 3_600_000;
  if (hours < 24) return { label: `Expire dans ${Math.ceil(hours)}h`, color: "var(--red)" };
  const days = Math.ceil(hours / 24);
  if (days <= 7)  return { label: `${days}j restant${days > 1 ? "s" : ""}`, color: GOLD };
  return { label: `${days}j restants`, color: "var(--green)" };
}

// ── Default dates ────────────────────────────────────────────────────────────
function todayISO()           { return new Date().toISOString().slice(0, 10); }
function futureISO(daysAhead) { return new Date(Date.now() + daysAhead * 86_400_000).toISOString().slice(0, 10); }

// ─────────────────────────────────────────────────────────────────────────────
export default function SlotsPage() {
  const { toast, show } = useToast();

  // ── Playlists (for selection) ──────────────────────────────────────────────
  const [playlists, setPlaylists] = useState([]);

  // ── Slot data ──────────────────────────────────────────────────────────────
  const [activeSlots,  setActiveSlots]  = useState([]);
  const [expiredSlots, setExpiredSlots] = useState([]);
  const [loading,      setLoading]      = useState(true);
  const [warnings,     setWarnings]     = useState([]);   // [{ slot, playlist, actualPosition }]
  const [scanningPos,  setScanningPos]  = useState(false);

  // ── Add form state ─────────────────────────────────────────────────────────
  const [searchQ,    setSearchQ]    = useState("");
  const [searchRes,  setSearchRes]  = useState([]);
  const [searching,  setSearching]  = useState(false);
  const [track,      setTrack]      = useState(null);
  const [selPlIds,   setSelPlIds]   = useState(new Set());
  const [position,   setPosition]   = useState(1);
  const [buyer,      setBuyer]      = useState("");
  const [startDate,  setStartDate]  = useState(todayISO());
  const [endDate,    setEndDate]    = useState(futureISO(30));
  const [creating,   setCreating]   = useState(false);
  const searchTimer = useRef(null);

  // ── Realtime subscription ──────────────────────────────────────────────────
  useEffect(() => {
    if (!isSupabaseConfigured) { setLoading(false); return; }

    loadAll();
    getAllPlaylists().then(setPlaylists).catch(() => {});

    const channel = subscribeToSlots(() => { loadAll(); });
    return () => unsubscribeSlots(channel);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function loadAll() {
    setLoading(true);
    try {
      const [active, expired] = await Promise.all([getActiveSlots(), getExpiredSlots()]);
      setActiveSlots(active);
      setExpiredSlots(expired);
    } catch (e) {
      show("Erreur Supabase : " + e.message, "error");
    } finally {
      setLoading(false);
    }
  }

  // ── Scan positions (verify slots still at the right place) ────────────────
  useEffect(() => {
    if (!activeSlots.length) { setWarnings([]); return; }
    let cancelled = false;
    (async () => {
      setScanningPos(true);
      const found = [];
      for (const slot of activeSlots) {
        for (const plId of slot.playlistIds ?? []) {
          try {
            const items = await getPlaylistTracks(plId);
            const idx   = items.findIndex(it => it.track?.id === slot.trackId);
            if (idx === -1) continue;
            const actual = idx + 1;
            if (actual !== slot.position) {
              const pl = playlists.find(p => p.id === plId);
              found.push({ slot, playlist: pl ?? { id: plId, name: "(playlist inconnue)" }, actualPosition: actual });
            }
          } catch {}
          await new Promise(r => setTimeout(r, 300));
        }
        if (cancelled) return;
      }
      if (!cancelled) { setWarnings(found); setScanningPos(false); }
    })();
    return () => { cancelled = true; };
  }, [activeSlots, playlists]);

  // ── Track search ───────────────────────────────────────────────────────────
  const handleSearch = (raw) => {
    setSearchQ(raw);
    clearTimeout(searchTimer.current);
    const q = raw.trim();
    if (!q) { setSearchRes([]); setSearching(false); return; }
    const id = extractSpotifyTrackId(q);
    if (id) {
      setSearching(true);
      getTrackById(id)
        .then(t => setSearchRes(t ? [t] : []))
        .catch(() => setSearchRes([]))
        .finally(() => setSearching(false));
      return;
    }
    if (q.length < 3) return;
    setSearching(true);
    searchTimer.current = setTimeout(async () => {
      try { const d = await searchTracks(q); setSearchRes(d?.tracks?.items || []); }
      catch {} finally { setSearching(false); }
    }, 500);
  };

  // ── Add slot ───────────────────────────────────────────────────────────────
  const togglePl = (id) => setSelPlIds(prev => {
    const next = new Set(prev); next.has(id) ? next.delete(id) : next.add(id); return next;
  });

  const canCreate = track && selPlIds.size > 0 && buyer.trim().length > 0 && startDate && endDate && !creating;

  const createSlot = async () => {
    if (!canCreate) return;
    setCreating(true);
    try {
      await addSlot({
        trackId:     track.id,
        trackName:   track.name,
        trackArtist: track.artists?.map(a => a.name).join(", ") ?? "",
        trackCover:  track.album?.images?.[0]?.url ?? null,
        trackUri:    track.uri,
        playlistIds: [...selPlIds],
        position,
        buyer:       buyer.trim(),
        startDate:   new Date(startDate).toISOString(),
        endDate:     new Date(endDate + "T23:59:59").toISOString(),
      });
      show(`Slot créé — "${track.name}" pour ${buyer}`, "success");
      setTrack(null); setSearchQ(""); setSearchRes([]);
      setSelPlIds(new Set()); setPosition(1); setBuyer("");
      setStartDate(todayISO()); setEndDate(futureISO(30));
    } catch (e) {
      show("Erreur : " + e.message, "error");
    } finally {
      setCreating(false);
    }
  };

  // ── Remove slot (optionally with tracks) ──────────────────────────────────
  const handleRemoveSlotOnly = async (slot) => {
    try { await removeSlot(slot.id); show("Slot supprimé", "success"); }
    catch (e) { show("Erreur : " + e.message, "error"); }
  };

  const handleRemoveSlotAndTracks = async (slot) => {
    try {
      for (const plId of slot.playlistIds ?? []) {
        try { await removeTrackFromPlaylist(plId, slot.trackUri); }
        catch {}
        await new Promise(r => setTimeout(r, 300));
      }
      await removeSlot(slot.id);
      show(`Slot + track retirés de ${slot.playlistIds?.length ?? 0} playlists`, "success");
    } catch (e) {
      show("Erreur : " + e.message, "error");
    }
  };

  // ── Warning actions ───────────────────────────────────────────────────────
  const handleFixWarningUpdate = async (w) => {
    try { await updateSlot(w.slot.id, { position: w.actualPosition });
      show("Position mise à jour", "success");
    } catch (e) { show("Erreur : " + e.message, "error"); }
  };

  const handleFixWarningReposition = async (w) => {
    try {
      await removeTrackFromPlaylist(w.playlist.id, w.slot.trackUri);
      await new Promise(r => setTimeout(r, 300));
      await addTrackToPlaylist(w.playlist.id, w.slot.trackUri, Math.max(0, w.slot.position - 1));
      show("Track repositionné", "success");
      // Force a fresh scan by reloading
      loadAll();
    } catch (e) { show("Erreur : " + e.message, "error"); }
  };

  // ── Not configured ─────────────────────────────────────────────────────────
  if (!isSupabaseConfigured) {
    return (
      <div className="fade-in" style={{ maxWidth: 640 }}>
        <h1 style={{ fontFamily: "var(--head)", fontSize: 26, fontWeight: 800, letterSpacing: "-.8px" }}>
          Slots Vendus
        </h1>
        <div style={{
          marginTop: 20, padding: "14px 18px",
          background: "rgba(255,85,85,.08)", border: "1px solid rgba(255,85,85,.25)",
          color: "var(--red)", fontSize: 13,
        }}>
          ⚠ {SUPABASE_ERROR}
        </div>
      </div>
    );
  }

  return (
    <div className="fade-in" style={{ maxWidth: 860 }}>
      {/* Header */}
      <div style={{ marginBottom: 24 }}>
        <h1 style={{ fontFamily: "var(--head)", fontSize: 26, fontWeight: 800, letterSpacing: "-.8px" }}>
          Slots Vendus
        </h1>
        <p style={{ color: "var(--muted)", fontSize: 13, marginTop: 5 }}>
          Gestion des placements payants — synchronisés en temps réel.
        </p>
      </div>

      {/* Warnings */}
      {warnings.length > 0 && (
        <div style={{
          background: "rgba(255,85,85,0.06)", border: "1px solid rgba(255,85,85,0.25)",
          padding: "14px 18px", marginBottom: 24,
        }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: "var(--red)", letterSpacing: ".06em", marginBottom: 12, textTransform: "uppercase" }}>
            ⚠ {warnings.length} position{warnings.length > 1 ? "s" : ""} modifiée{warnings.length > 1 ? "s" : ""}
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {warnings.map((w, i) => (
              <div key={i} style={{ fontSize: 12, color: "var(--text)" }}>
                <div style={{ marginBottom: 4 }}>
                  <strong>"{w.slot.trackName}"</strong> dans <em>{w.playlist.name}</em>
                </div>
                <div style={{ fontSize: 11, color: "var(--muted)", marginBottom: 6 }}>
                  Position attendue&nbsp;: <span style={{ color: GOLD }}>#{w.slot.position}</span> →
                  Position actuelle&nbsp;: <span style={{ color: "var(--red)" }}>#{w.actualPosition}</span>
                </div>
                <div style={{ display: "flex", gap: 6 }}>
                  <button className="btn btn-ghost btn-sm" onClick={() => handleFixWarningUpdate(w)}>
                    Mettre à jour
                  </button>
                  <button className="btn btn-ghost btn-sm" onClick={() => handleFixWarningReposition(w)}>
                    Repositionner
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ─────────── SECTION 1: ADD ─────────── */}
      <div style={{ marginBottom: 32 }}>
        <div style={{ fontSize: 11, fontWeight: 700, color: "var(--muted)", letterSpacing: ".06em", marginBottom: 14, textTransform: "uppercase" }}>
          Ajouter un slot vendu
        </div>

        <div className="card" style={{ padding: 18, display: "flex", flexDirection: "column", gap: 14 }}>

          {/* Track picker */}
          {track ? (
            <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 12px", background: "var(--surface2)" }}>
              {track.album?.images?.[0]?.url && (
                <img src={track.album.images[0].url} style={{ width: 42, height: 42, objectFit: "cover", flexShrink: 0 }} />
              )}
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 700, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{track.name}</div>
                <div style={{ fontSize: 11, color: "var(--muted)" }}>{track.artists?.map(a => a.name).join(", ")}</div>
              </div>
              <button className="btn btn-ghost btn-sm" onClick={() => { setTrack(null); setSearchQ(""); setSearchRes([]); }}>
                Changer
              </button>
            </div>
          ) : (
            <div>
              <input
                type="text"
                placeholder="Colle un lien Spotify ou tape un titre…"
                value={searchQ}
                onChange={e => handleSearch(e.target.value)}
              />
              {searching && <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 8 }}>Recherche…</div>}
              {searchRes.length > 0 && (
                <div style={{ marginTop: 8, maxHeight: 220, overflowY: "auto", display: "flex", flexDirection: "column", gap: 1, borderTop: "1px solid var(--border)", paddingTop: 8 }}>
                  {searchRes.map(t => (
                    <div key={t.id} className="track-row" style={{ cursor: "pointer" }}
                      onClick={() => { setTrack(t); setSearchRes([]); setSearchQ(""); }}>
                      {t.album?.images?.[0]?.url && (
                        <img src={t.album.images[0].url} style={{ width: 32, height: 32, objectFit: "cover", flexShrink: 0 }} />
                      )}
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 13, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{t.name}</div>
                        <div style={{ fontSize: 11, color: "var(--muted)" }}>{t.artists?.map(a => a.name).join(", ")}</div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Playlist picker */}
          {track && (
            <>
              <div>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6 }}>
                  <div style={{ fontSize: 11, fontWeight: 700, color: "var(--muted)", letterSpacing: ".05em", textTransform: "uppercase" }}>
                    Playlists concernées ({selPlIds.size})
                  </div>
                  <div style={{ display: "flex", gap: 6 }}>
                    <button className="btn btn-ghost btn-sm" onClick={() => setSelPlIds(new Set(playlists.map(p => p.id)))}>
                      Tous
                    </button>
                    <button className="btn btn-ghost btn-sm" onClick={() => setSelPlIds(new Set())}>
                      Aucun
                    </button>
                  </div>
                </div>
                <div style={{ maxHeight: 220, overflowY: "auto", border: "1px solid var(--border)", background: "var(--surface2)" }}>
                  {playlists.map(pl => (
                    <label key={pl.id} className="check-pl">
                      <input type="checkbox" checked={selPlIds.has(pl.id)} onChange={() => togglePl(pl.id)} />
                      {pl.images?.[0]?.url
                        ? <img src={pl.images[0].url} style={{ width: 28, height: 28, objectFit: "cover", flexShrink: 0 }} />
                        : <div style={{ width: 28, height: 28, background: "var(--surface)", flexShrink: 0 }} />
                      }
                      <div style={{ fontSize: 12, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1 }}>
                        {pl.name}
                      </div>
                    </label>
                  ))}
                </div>
              </div>

              {/* Position + buyer + dates */}
              <div style={{ display: "grid", gridTemplateColumns: "1fr 2fr", gap: 12 }}>
                <div>
                  <div style={{ fontSize: 10, color: "var(--muted)", letterSpacing: "1px", marginBottom: 4, textTransform: "uppercase" }}>Position</div>
                  <input
                    type="number" min="1" value={position}
                    onChange={e => setPosition(Math.max(1, parseInt(e.target.value) || 1))}
                    style={{ width: "100%" }}
                  />
                </div>
                <div>
                  <div style={{ fontSize: 10, color: "var(--muted)", letterSpacing: "1px", marginBottom: 4, textTransform: "uppercase" }}>Acheteur</div>
                  <input type="text" value={buyer} onChange={e => setBuyer(e.target.value)} placeholder="Nom" />
                </div>
                <div>
                  <div style={{ fontSize: 10, color: "var(--muted)", letterSpacing: "1px", marginBottom: 4, textTransform: "uppercase" }}>Début</div>
                  <input type="date" value={startDate} onChange={e => setStartDate(e.target.value)} style={{ width: "100%", background: "var(--surface2)", border: "1px solid var(--border2)", color: "var(--text)", padding: "7px 10px", fontFamily: "var(--sans)", fontSize: 13, borderRadius: "var(--radius)" }} />
                </div>
                <div>
                  <div style={{ fontSize: 10, color: "var(--muted)", letterSpacing: "1px", marginBottom: 4, textTransform: "uppercase" }}>Fin</div>
                  <input type="date" value={endDate} onChange={e => setEndDate(e.target.value)} style={{ width: "100%", background: "var(--surface2)", border: "1px solid var(--border2)", color: "var(--text)", padding: "7px 10px", fontFamily: "var(--sans)", fontSize: 13, borderRadius: "var(--radius)" }} />
                </div>
              </div>

              <button
                className="btn btn-primary"
                disabled={!canCreate}
                onClick={createSlot}
                style={{ opacity: canCreate ? 1 : 0.45 }}
              >
                {creating ? "Création…" : "Créer le slot vendu"}
              </button>
            </>
          )}
        </div>
      </div>

      {/* ─────────── SECTION 2: ACTIVE ─────────── */}
      <div style={{ marginBottom: 32 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: "var(--muted)", letterSpacing: ".06em", textTransform: "uppercase" }}>
            Slots actifs ({activeSlots.length}){scanningPos && <span style={{ color: "var(--faint)", marginLeft: 8, textTransform: "none", letterSpacing: 0 }}>· scan des positions…</span>}
          </div>
        </div>

        {loading && <div style={{ color: "var(--muted)", fontSize: 13 }}>Chargement…</div>}
        {!loading && activeSlots.length === 0 && (
          <div style={{ color: "var(--faint)", fontSize: 13 }}>Aucun slot actif.</div>
        )}

        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {activeSlots.map(slot => <SlotCard key={slot.id} slot={slot} playlists={playlists}
            onRemoveOnly={() => handleRemoveSlotOnly(slot)}
            onRemoveAll={() => handleRemoveSlotAndTracks(slot)}
            expired={false}
          />)}
        </div>
      </div>

      {/* ─────────── SECTION 3: EXPIRED ─────────── */}
      {expiredSlots.length > 0 && (
        <div>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: "var(--muted)", letterSpacing: ".06em", textTransform: "uppercase" }}>
              Slots expirés ({expiredSlots.length})
            </div>
            <button
              className="btn btn-ghost btn-sm"
              onClick={async () => {
                try { await cleanExpiredSlots(); show("Slots expirés nettoyés", "success"); loadAll(); }
                catch (e) { show("Erreur : " + e.message, "error"); }
              }}
            >
              Nettoyer tout
            </button>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {expiredSlots.map(slot => <SlotCard key={slot.id} slot={slot} playlists={playlists}
              onRemoveOnly={() => handleRemoveSlotOnly(slot)}
              onRemoveAll={() => handleRemoveSlotAndTracks(slot)}
              expired
            />)}
          </div>
        </div>
      )}

      <Toast toast={toast} />
    </div>
  );
}

// ── Slot card component ─────────────────────────────────────────────────────
function SlotCard({ slot, playlists, onRemoveOnly, onRemoveAll, expired }) {
  const time = timeLeft(slot.endDate);
  const now  = Date.now();
  const start = new Date(slot.startDate).getTime();
  const end   = new Date(slot.endDate).getTime();
  const totalMs = Math.max(1, end - start);
  const pct = Math.min(100, Math.max(0, ((now - start) / totalMs) * 100));

  const slotPls = (slot.playlistIds ?? [])
    .map(id => playlists.find(p => p.id === id))
    .filter(Boolean);
  const visible = slotPls.slice(0, 5);
  const overflow = slotPls.length - visible.length;

  return (
    <div className="card" style={{
      padding: 14,
      display: "flex",
      gap: 14,
      borderLeft: `3px solid ${expired ? "#333" : GOLD}`,
      opacity: expired ? 0.5 : 1,
    }}>
      {/* Cover */}
      {slot.trackCover
        ? <img src={slot.trackCover} style={{ width: 56, height: 56, objectFit: "cover", flexShrink: 0 }} />
        : <div style={{ width: 56, height: 56, background: "var(--surface2)", flexShrink: 0 }} />
      }

      {/* Body */}
      <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 6 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          <div style={{ fontSize: 13, fontWeight: 700, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {slot.trackName}
          </div>
          {expired && (
            <span style={{ fontSize: 9, fontWeight: 700, color: "var(--muted)", letterSpacing: "1.5px", border: "1px solid var(--border2)", padding: "1px 5px" }}>
              EXPIRÉ
            </span>
          )}
        </div>
        <div style={{ fontSize: 11, color: "var(--muted)", display: "flex", gap: 8, flexWrap: "wrap" }}>
          <span>{slot.trackArtist}</span>
          <span style={{ color: "var(--faint)" }}>·</span>
          <span>Acheteur&nbsp;: <span style={{ color: "var(--text)" }}>{slot.buyer}</span></span>
          <span style={{ color: "var(--faint)" }}>·</span>
          <span>Position <span style={{ color: GOLD }}>#{slot.position}</span></span>
        </div>

        {/* Playlists mini covers */}
        {visible.length > 0 && (
          <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
            {visible.map(pl => pl.images?.[0]?.url
              ? <img key={pl.id} src={pl.images[0].url} title={pl.name}
                    style={{ width: 22, height: 22, objectFit: "cover", flexShrink: 0 }} />
              : <div key={pl.id} title={pl.name} style={{ width: 22, height: 22, background: "var(--surface2)", flexShrink: 0 }} />
            )}
            {overflow > 0 && (
              <span style={{ fontSize: 10, color: "var(--muted)", marginLeft: 4 }}>+{overflow}</span>
            )}
          </div>
        )}

        {/* Progress bar + time */}
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 2 }}>
          <div style={{ flex: 1, height: 2, background: "#1a1a1a", overflow: "hidden" }}>
            <div style={{ height: "100%", width: `${pct}%`, background: expired ? "#333" : GOLD }} />
          </div>
          <span style={{ fontSize: 10, color: time.color, fontWeight: 700, whiteSpace: "nowrap", letterSpacing: ".5px", textTransform: "uppercase" }}>
            {time.label}
          </span>
        </div>
        <div style={{ fontSize: 10, color: "var(--faint)", letterSpacing: ".5px" }}>
          {fmtDate(slot.startDate)} → {fmtDate(slot.endDate)}
        </div>
      </div>

      {/* Actions */}
      <div style={{ display: "flex", flexDirection: "column", gap: 5, flexShrink: 0 }}>
        <button className="btn btn-danger btn-sm" onClick={onRemoveAll}>
          Suppr. son + slot
        </button>
        <button className="btn btn-ghost btn-sm" onClick={onRemoveOnly}>
          Suppr. slot seul
        </button>
      </div>
    </div>
  );
}
