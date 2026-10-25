/* ---------- Supabase data layer (same shape as the old claude.ai version) ---------- */
const CONFIG = {
  url: 'https://viljawpwcyauyydxczbh.supabase.co',
  key: 'sb_publishable_KImNK_E1GTqmOh_-i_YVLA_2wvgvO_s',
  claude: false // true once the Claude API function is set up (krok 4)
};
const sb = supabase.createClient(CONFIG.url, CONFIG.key, { auth: { persistSession: true, autoRefreshToken: true } });
const TABLE = { items: 'items', recipes: 'recipes', meta: 'docs' };
const MEM = { items: new Map(), recipes: new Map(), docs: new Map() };
const CACHE_KEY = 'nk-cache-v1', OUTBOX_KEY = 'nk-outbox-v1';
let db = null, sample = null, assets = null;

function lsGet(k, d) { try { return JSON.parse(localStorage.getItem(k)) ?? d } catch (e) { return d } }
function lsSet(k, v) { try { localStorage.setItem(k, JSON.stringify(v)) } catch (e) {} }
function saveCache() {
  lsSet(CACHE_KEY, { items: [...MEM.items], recipes: [...MEM.recipes], docs: [...MEM.docs], at: Date.now() });
}
function loadCache() {
  const c = lsGet(CACHE_KEY, null); if (!c) return false;
  MEM.items = new Map(c.items); MEM.recipes = new Map(c.recipes); MEM.docs = new Map(c.docs); return true;
}
function applyMem() {
  S.items = [...MEM.items].map(([id, d]) => ({ id, ...d }));
  S.recipes = new Map(MEM.recipes);
  S.plan = MEM.docs.get('plan') || null; S.profile = MEM.docs.get('profile') || null; S.deals = MEM.docs.get('deals') || null;
  S.loaded = { items: true, plan: true, recipes: true };
  render();
}
function splitPath(path) { const [c, id] = path.split('/'); return { t: TABLE[c], id } }

/* writes: optimistic, with an outbox for when the shop has no signal */
const outbox = lsGet(OUTBOX_KEY, []);
async function send(op) {
  if (op.kind === 'upsert') {
    const { error } = await sb.from(op.t).upsert({ id: op.id, data: op.data }); if (error) throw error;
  } else {
    const { error } = await sb.from(op.t).delete().eq('id', op.id); if (error) throw error;
  }
}
function isNetErr(e) { return !navigator.onLine || /fetch|network|Failed/i.test(String(e?.message || e)) }
async function run(op) {
  if (op.kind === 'upsert') MEM[op.t].set(op.id, op.data); else MEM[op.t].delete(op.id);
  saveCache(); applyMem();
  try { await send(op) } catch (e) {
    if (isNetErr(e)) { outbox.push(op); lsSet(OUTBOX_KEY, outbox); toast('Bez signálu – uloží se, až budete online.'); return }
    throw e;
  }
}
async function flushOutbox() {
  while (outbox.length) {
    try { await send(outbox[0]); outbox.shift(); lsSet(OUTBOX_KEY, outbox) } catch (e) { return }
  }
}
window.addEventListener('online', () => { flushOutbox().then(loadAll) });

db = {
  doc(path) {
    const { t, id } = splitPath(path);
    return {
      set: data => run({ kind: 'upsert', t, id, data }),
      update: patch => run({ kind: 'upsert', t, id, data: { ...(MEM[t].get(id) || {}), ...patch } }),
      delete: () => run({ kind: 'delete', t, id })
    };
  },
  collection(c) {
    const t = TABLE[c];
    return { add: data => run({ kind: 'upsert', t, id: 'm-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6), data }) };
  }
};

async function loadAll() {
  const [a, b, c] = await Promise.all(['items', 'recipes', 'docs'].map(t => sb.from(t).select('id,data')));
  if (a.error || b.error || c.error) throw (a.error || b.error || c.error);
  MEM.items = new Map(a.data.map(r => [r.id, r.data]));
  MEM.recipes = new Map(b.data.map(r => [r.id, r.data]));
  MEM.docs = new Map(c.data.map(r => [r.id, r.data]));
  // keep optimistic changes that are still waiting in the outbox
  for (const op of outbox) { if (op.kind === 'upsert') MEM[op.t].set(op.id, op.data); else MEM[op.t].delete(op.id) }
  saveCache(); applyMem();
}
function subscribeLive() {
  sb.channel('kuchyne').on('postgres_changes', { event: '*', schema: 'public' }, p => {
    const t = p.table; if (!MEM[t]) return;
    if (p.eventType === 'DELETE') MEM[t].delete(p.old.id); else MEM[t].set(p.new.id, p.new.data);
    saveCache(); applyMem();
  }).subscribe();
}

/* photos in Supabase Storage (private bucket, signed links cached for a week) */
const PHOTO_URLS = new Map();
function photoUrl(path) {
  if (PHOTO_URLS.has(path)) return PHOTO_URLS.get(path);
  PHOTO_URLS.set(path, '');
  sb.storage.from('photos').createSignedUrl(path, 60 * 60 * 24 * 7).then(({ data }) => {
    if (data?.signedUrl) { PHOTO_URLS.set(path, data.signedUrl); render() }
  });
  return '';
}
assets = {
  async upload(file) {
    if (file.size > 20 * 1024 * 1024) throw { code: 'too_large' };
    const ext = (file.type.split('/')[1] || 'jpg').replace('jpeg', 'jpg');
    const path = 'r/' + Date.now().toString(36) + '.' + ext;
    const { error } = await sb.storage.from('photos').upload(path, file, { contentType: file.type, upsert: false });
    if (error) throw error;
    return { id: path };
  }
};

/* Claude (krok 4): calls a Supabase Edge Function that holds the API key */
if (CONFIG.claude) {
  sample = {
    async json(prompt, opts) {
      const { data, error } = await sb.functions.invoke('claude', { body: { prompt, quick: opts?.modelTier === 'quick' } });
      if (error) throw { code: 'upstream_error' };
      if (data?.error) throw { code: data.error };
      return data.json;
    }
  };
}

/* sign-in */
async function boot() {
  const v = (location.hash || '').slice(1); show(VIEWS.includes(v) ? v : 'tyden');
  if (loadCache()) applyMem();
  const { data: { session } } = await sb.auth.getSession();
  if (!session) { $('login').hidden = false; return }
  $('login').hidden = true; $('who').textContent = session.user.email;
  try { await flushOutbox(); await loadAll(); subscribeLive() }
  catch (e) {
    if (!navigator.onLine) toast('Jste offline – zobrazuji poslední uložený stav.');
    else toast('Data se nepodařilo načíst. Zkuste to znovu.');
  }
}
$('login-form').onsubmit = async e => {
  e.preventDefault(); $('login-msg').textContent = 'Přihlašuji…';
  const { error } = await sb.auth.signInWithPassword({ email: $('login-email').value.trim(), password: $('login-pass').value });
  if (error) { $('login-msg').textContent = 'E-mail nebo heslo nesedí.'; return }
  $('login-msg').textContent = ''; boot();
};
$('logout').onclick = async () => {
  await sb.auth.signOut(); try { localStorage.removeItem(CACHE_KEY) } catch (e) {}
  location.reload();
};
if ('serviceWorker' in navigator) navigator.serviceWorker.register('./sw.js').catch(() => {});
boot();
