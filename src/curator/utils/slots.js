import { supabase, isSupabaseConfigured, SUPABASE_ERROR } from './supabase';

function ensure() {
  if (!isSupabaseConfigured || !supabase) throw new Error(SUPABASE_ERROR);
}

// ── Mappers (snake_case DB ↔ camelCase JS) ───────────────────────────────────
export function mapSlot(row) {
  if (!row) return null;
  return {
    id:          row.id,
    trackId:     row.track_id,
    trackName:   row.track_name,
    trackArtist: row.track_artist,
    trackCover:  row.track_cover,
    trackUri:    row.track_uri,
    playlistIds: row.playlist_ids || [],
    position:    row.position,
    buyer:       row.buyer,
    price:       row.price ?? null,
    startDate:   row.start_date,
    endDate:     row.end_date,
    createdAt:   row.created_at,
    status:      row.status,
    notifiedAt:  row.notified_at ?? null,
  };
}

export function mapSlotToDb(slot) {
  const row = {};
  if ('trackId'     in slot) row.track_id     = slot.trackId;
  if ('trackName'   in slot) row.track_name   = slot.trackName;
  if ('trackArtist' in slot) row.track_artist = slot.trackArtist;
  if ('trackCover'  in slot) row.track_cover  = slot.trackCover;
  if ('trackUri'    in slot) row.track_uri    = slot.trackUri;
  if ('playlistIds' in slot) row.playlist_ids = slot.playlistIds;
  if ('position'    in slot) row.position     = slot.position;
  if ('buyer'       in slot) row.buyer        = slot.buyer;
  if ('price'       in slot) row.price        = slot.price;
  if ('startDate'   in slot) row.start_date   = slot.startDate;
  if ('endDate'     in slot) row.end_date     = slot.endDate;
  if ('status'      in slot) row.status       = slot.status;
  if ('notifiedAt'  in slot) row.notified_at  = slot.notifiedAt;
  return row;
}

// ── Reads ────────────────────────────────────────────────────────────────────
export async function getSlots() {
  ensure();
  const { data, error } = await supabase
    .from('slots')
    .select('*')
    .order('created_at', { ascending: false });
  if (error) throw error;
  return (data || []).map(mapSlot);
}

export async function getActiveSlots() {
  ensure();
  const { data, error } = await supabase
    .from('slots')
    .select('*')
    .eq('status', 'active')
    .gt('end_date', new Date().toISOString())
    .order('created_at', { ascending: false });
  if (error) throw error;
  return (data || []).map(mapSlot);
}

export async function getExpiredSlots() {
  ensure();
  const { data, error } = await supabase
    .from('slots')
    .select('*')
    .eq('status', 'active')
    .lt('end_date', new Date().toISOString())
    .order('end_date', { ascending: false });
  if (error) throw error;
  return (data || []).map(mapSlot);
}

export async function getSlotEvents(slotId = null) {
  ensure();
  let q = supabase.from('slot_events').select('*').order('created_at', { ascending: false });
  if (slotId) q = q.eq('slot_id', slotId);
  const { data, error } = await q;
  if (error) throw error;
  return data || [];
}

// ── Writes ───────────────────────────────────────────────────────────────────
export async function addSlot(slotData) {
  ensure();
  const payload = mapSlotToDb({ ...slotData, status: slotData.status ?? 'active' });
  const { data, error } = await supabase.from('slots').insert([payload]).select();
  if (error) throw error;
  return mapSlot(data?.[0]);
}

export async function removeSlot(id) {
  ensure();
  const { error } = await supabase.from('slots').update({ status: 'removed' }).eq('id', id);
  if (error) throw error;
}

export async function updateSlot(id, changes) {
  ensure();
  const { error } = await supabase.from('slots').update(mapSlotToDb(changes)).eq('id', id);
  if (error) throw error;
}

export async function markSlotNotified(id) {
  ensure();
  const { error } = await supabase
    .from('slots')
    .update({ notified_at: new Date().toISOString() })
    .eq('id', id);
  if (error) throw error;
}

export async function cleanExpiredSlots() {
  ensure();
  const { error } = await supabase
    .from('slots')
    .update({ status: 'expired' })
    .eq('status', 'active')
    .lt('end_date', new Date().toISOString());
  if (error) throw error;
}

// ── Realtime subscription ────────────────────────────────────────────────────
let _channelSeq = 0;
export function subscribeToSlots(callback) {
  if (!isSupabaseConfigured || !supabase) return null;
  const channel = supabase
    .channel(`slots-changes-${++_channelSeq}`)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'slots' }, callback)
    .subscribe();
  return channel;
}

export function unsubscribeSlots(channel) {
  if (supabase && channel) supabase.removeChannel(channel);
}
