import { supabase, isSupabaseConfigured, SUPABASE_ERROR } from './supabase';

function ensure() {
  if (!isSupabaseConfigured || !supabase) throw new Error(SUPABASE_ERROR);
}

function mapBuyer(row) {
  if (!row) return null;
  return {
    id:        row.id,
    name:      row.name,
    email:     row.email ?? null,
    notes:     row.notes ?? null,
    createdAt: row.created_at,
  };
}

export async function getBuyers() {
  ensure();
  const { data, error } = await supabase
    .from('buyers')
    .select('*')
    .order('name');
  if (error) throw error;
  return (data || []).map(mapBuyer);
}

// Crée le buyer s'il n'existe pas, sinon ne fait rien (upsert sur le nom)
export async function upsertBuyer(name, extra = {}) {
  ensure();
  const { data, error } = await supabase
    .from('buyers')
    .upsert({ name, ...extra }, { onConflict: 'name', ignoreDuplicates: true })
    .select();
  if (error) throw error;
  return mapBuyer(data?.[0]);
}

export async function updateBuyer(id, changes) {
  ensure();
  const { error } = await supabase.from('buyers').update(changes).eq('id', id);
  if (error) throw error;
}

// Calcule les stats revenus par buyer depuis la table slots (client-side)
export function computeBuyerStats(slots) {
  const map = {};
  for (const s of slots) {
    if (!s.buyer) continue;
    if (!map[s.buyer]) map[s.buyer] = { name: s.buyer, slotCount: 0, totalSpent: 0 };
    map[s.buyer].slotCount++;
    if (s.price != null) map[s.buyer].totalSpent += s.price;
  }
  return Object.values(map).sort((a, b) => b.totalSpent - a.totalSpent);
}
