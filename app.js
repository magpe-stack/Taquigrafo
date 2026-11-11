/* Taquígrafo — lógica do aplicativo (offline-first, IndexedDB nativo) */
(() => {
  'use strict';

  const DB_NAME = 'taquigrafo-db';
  const STORE = 'notebooks';
  const MAX_CHARS = 50;
  const APP_NAME = 'Taquígrafo';
  const STATUS = {
    waiting: { label: 'Aguardando Início', icon: '○' },
    active:  { label: 'Em Andamento',      icon: '◐' },
    done:    { label: 'Concluído',         icon: '✓' }
  };

  let db = null;
  let currentId = null;
  let deferredPrompt = null;
  let toastTimer = null;

  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

  /* ---------------- IndexedDB ---------------- */
  function openDB() {
    return new Promise((resolve, reject) => {
      if (!('indexedDB' in window)) return reject(new Error('IndexedDB indisponível'));
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => {
        if (!req.result.objectStoreNames.contains(STORE)) {
          req.result.createObjectStore(STORE, { keyPath: 'id' });
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  function run(mode, fn) {
    return new Promise((resolve, reject) => {
      const t = db.transaction(STORE, mode);
      const store = t.objectStore(STORE);
      const out = fn(store);
      t.oncomplete = () => resolve(out && 'result' in out ? out.result : undefined);
      t.onerror = () => reject(t.error);
      t.onabort = () => reject(t.error);
    });
  }

  const dbAll = () => run('readonly', (s) => s.getAll());
  const dbGet = (id) => run('readonly', (s) => s.get(id));
  const dbPut = (nb) => run('readwrite', (s) => s.put(nb));
  const dbDelete = (id) => run('readwrite', (s) => s.delete(id));
  const dbPutMany = (list) => run('readwrite', (s) => { list.forEach((nb) => s.put(nb)); });

  /* ---------------- Utilidades ---------------- */
  const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  const pad = (n) => String(n).padStart(2, '0');

  function fmtTime(d) {
    return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
  }
  function fmtDate(iso) {
    if (!iso) return '—';
    const d = new Date(iso);
    return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()}`;
  }
  function fmtDateTime(iso) {
    if (!iso) return '—';
    const d = new Date(iso);
    return `${fmtDate(iso)} ${fmtTime(d)}`;
  }
  function fmtDuration(startIso, endIso) {
    if (!startIso || !endIso) return '—';
    let s = Math.max(0, Math.round((new Date(endIso) - new Date(startIso)) / 1000));
    const h = Math.floor(s / 3600); s -= h * 3600;
    const m = Math.floor(s / 60); s -= m * 60;
    return `${pad(h)}:${pad(m)}:${pad(s)}`;
  }
  function slug(str) {
    return (str || 'caderno')
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'caderno';
  }
  function plural(n, one, many) { return `${n} ${n === 1 ? one : many}`; }

  function toast(msg) {
    const el = $('#toast');
    el.textContent = msg;
    el.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { el.hidden = true; }, 3200);
  }

  function download(filename, content, mime) {
    const blob = new Blob([content], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1500);
  }

  function confirmDialog(message, yesLabel = 'Confirmar') {
    return new Promise((resolve) => {
      const dlg = $('#dlg-confirm');
      $('#confirm-msg').textContent = message;
      $('#confirm-yes').textContent = yesLabel;
      const finish = (val) => {
        $('#confirm-yes').onclick = null;
        $('#confirm-no').onclick = null;
        dlg.onclose = null;
        if (dlg.open) dlg.close();
        resolve(val);
      };
      $('#confirm-yes').onclick = () => finish(true);
      $('#confirm-no').onclick = () => finish(false);
      dlg.onclose = () => finish(false);
      dlg.showModal();
    });
  }

  /* ---------------- Tema ---------------- */
  function applyTheme(theme) {
    if (theme === 'dark') document.documentElement.setAttribute('data-theme', 'dark');
    else document.documentElement.removeAttribute('data-theme');
    const meta = $('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', theme === 'dark' ? '#10141D' : '#001F8F');
    try { localStorage.setItem('taq-theme', theme); } catch (e) { /* ignora */ }
  }
  function toggleTheme() {
    const dark = document.documentElement.getAttribute('data-theme') === 'dark';
    applyTheme(dark ? 'light' : 'dark');
    toast(dark ? 'Tema claro ativado' : 'Tema escuro ativado');
  }

  /* ---------------- Tela cheia ---------------- */
  function toggleFullscreen() {
    const el = document.documentElement;
    if (!el.requestFullscreen) { toast('Tela cheia não é suportada neste navegador.'); return; }
    if (document.fullscreenElement) document.exitFullscreen();
    else el.requestFullscreen().catch(() => toast('Não foi possível entrar em tela cheia.'));
  }
  document.addEventListener('fullscreenchange', () => {
    $('#btn-fullscreen').textContent = document.fullscreenElement ? 'Sair da Tela Cheia' : 'Tela Cheia';
  });

  /* ---------------- Drawer ---------------- */
  const drawer = $('#drawer');
  const overlay = $('#overlay');
  const btnMenu = $('#btn-menu');

  function openDrawer() {
    drawer.removeAttribute('inert');
    drawer.classList.add('open');
    overlay.hidden = false;
    btnMenu.setAttribute('aria-expanded', 'true');
    setTimeout(() => $('#btn-menu-close').focus(), 50);
  }
  function closeDrawer(returnFocus = true) {
    drawer.classList.remove('open');
    drawer.setAttribute('inert', '');
    overlay.hidden = true;
    btnMenu.setAttribute('aria-expanded', 'false');
    if (returnFocus) btnMenu.focus();
  }

  /* ---------------- Views ---------------- */
  function showView(name) {
    $('#view-home').hidden = name !== 'home';
    $('#view-notebook').hidden = name !== 'notebook';
    window.scrollTo({ top: 0 });
  }

  async function showHome() {
    currentId = null;
    showView('home');
    await renderHome();
  }

  async function renderHome() {
    const list = (await dbAll()).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    const wrap = $('#notebook-list');
    wrap.textContent = '';
    $('#empty-state').hidden = list.length > 0;

    list.forEach((nb) => {
      const st = STATUS[nb.status] || STATUS.waiting;
      const card = document.createElement('article');
      card.className = 'card';

      const h = document.createElement('h3');
      h.textContent = nb.name;

      const meta = document.createElement('div');
      meta.className = 'card-meta';
      const badge = document.createElement('span');
      badge.className = `badge ${nb.status}`;
      badge.textContent = `${st.icon} ${st.label}`;
      const count = document.createElement('span');
      count.className = 'muted';
      count.textContent = plural(nb.notes.length, 'nota', 'notas');
      meta.append(badge, count);

      const date = document.createElement('p');
      date.className = 'muted';
      date.style.margin = '0';
      date.textContent = `Criado em ${fmtDate(nb.createdAt)}`;

      const actions = document.createElement('div');
      actions.className = 'card-actions';
      const open = document.createElement('button');
      open.type = 'button';
      open.className = 'btn btn-primary';
      open.textContent = 'Abrir';
      open.setAttribute('aria-label', `Abrir caderno ${nb.name}`);
      open.addEventListener('click', () => openNotebook(nb.id));
      const del = document.createElement('button');
      del.type = 'button';
      del.className = 'btn btn-danger';
      del.textContent = 'Excluir';
      del.setAttribute('aria-label', `Excluir caderno ${nb.name}`);
      del.addEventListener('click', () => deleteNotebook(nb.id));
      actions.append(open, del);

      card.append(h, meta, date, actions);
      wrap.appendChild(card);
    });
  }

  async function openNotebook(id) {
    const nb = await dbGet(id);
    if (!nb) { toast('Caderno não encontrado.'); return showHome(); }
    currentId = id;
    showView('notebook');
    renderNotebook(nb);
    $('#main').focus({ preventScroll: true });
  }

  function renderNotebook(nb) {
    const st = STATUS[nb.status];
    $('#nb-title').textContent = nb.name;
    const badge = $('#nb-status');
    badge.className = `badge ${nb.status}`;
    badge.textContent = `${st.icon} ${st.label}`;

    let meta = `Criado em ${fmtDateTime(nb.createdAt)}`;
    if (nb.startedAt) meta += ` · Sessão iniciada às ${fmtTime(new Date(nb.startedAt))}`;
    if (nb.finishedAt) meta += ` · Concluído em ${fmtDateTime(nb.finishedAt)} (duração ${fmtDuration(nb.startedAt, nb.finishedAt)})`;
    $('#nb-meta').textContent = meta;

    $('#btn-start').hidden = nb.status !== 'waiting';
    $('#btn-finish').hidden = nb.status !== 'active';

    const input = $('#note-input');
    const add = $('#btn-add');
    const active = nb.status === 'active';
    input.disabled = !active;
    add.disabled = !active;
    $('#note-hint').textContent =
      nb.status === 'waiting' ? 'Toque em “Iniciar Sessão” para liberar o registro de notas.' :
      nb.status === 'done' ? 'Caderno concluído: o registro está encerrado.' :
      'Pressione Enter ou clique em Adicionar. Cada nota recebe um carimbo de hora.';
    updateCounter();

    $('#notes-count').textContent = `(${nb.notes.length})`;
    $('#notes-empty').hidden = nb.notes.length > 0;
    const ol = $('#notes-list');
    ol.textContent = '';
    nb.notes.forEach((n) => {
      const li = document.createElement('li');
      li.className = 'note';
      const t = document.createElement('time');
      t.dateTime = n.iso;
      t.textContent = n.time;
      const s = document.createElement('span');
      s.textContent = n.text;
      li.append(t, s);
      ol.appendChild(li);
    });
    ol.lastElementChild?.scrollIntoView({ block: 'nearest' });
  }

  function updateCounter() {
    const input = $('#note-input');
    const left = MAX_CHARS - input.value.length;
    const c = $('#note-counter');
    c.textContent = `${left} ${left === 1 ? 'restante' : 'restantes'}`;
    c.classList.toggle('warn', left <= 10);
  }

  /* ---------------- Ações de caderno ---------------- */
  async function createNotebook(name) {
    const nb = {
      id: uid(),
      name: name.trim().slice(0, 60),
      status: 'waiting',
      createdAt: new Date().toISOString(),
      startedAt: null,
      finishedAt: null,
      notes: []
    };
    await dbPut(nb);
    toast('Caderno criado.');
    await openNotebook(nb.id);
  }

  async function startSession() {
    const nb = await dbGet(currentId);
    if (!nb || nb.status !== 'waiting') return;
    nb.status = 'active';
    nb.startedAt = new Date().toISOString();
    await dbPut(nb);
    renderNotebook(nb);
    $('#note-input').focus();
    toast('Sessão iniciada.');
  }

  async function addNote(text) {
    const nb = await dbGet(currentId);
    if (!nb || nb.status !== 'active') return;
    const clean = text.trim().slice(0, MAX_CHARS);
    if (!clean) return;
    const now = new Date();
    nb.notes.push({ id: uid(), text: clean, time: fmtTime(now), iso: now.toISOString() });
    await dbPut(nb);
    const input = $('#note-input');
    input.value = '';
    renderNotebook(nb);
    input.focus();
  }

  async function finishNotebook() {
    const ok = await confirmDialog('Concluir este caderno? Depois disso não será possível adicionar novas notas.', 'Concluir Caderno');
    if (!ok) return;
    const nb = await dbGet(currentId);
    if (!nb) return;
    nb.status = 'done';
    nb.finishedAt = new Date().toISOString();
    await dbPut(nb);
    renderNotebook(nb);
    toast('Caderno concluído.');
  }

  async function deleteNotebook(id) {
    const nb = await dbGet(id);
    if (!nb) return;
    const ok = await confirmDialog(`Excluir definitivamente o caderno “${nb.name}” e suas ${plural(nb.notes.length, 'nota', 'notas')}?`, 'Excluir');
    if (!ok) return;
    await dbDelete(id);
    toast('Caderno excluído.');
    await showHome();
  }

  /* ---------------- Exportações ---------------- */
  function buildText(nb) {
    const st = STATUS[nb.status];
    const lines = [];
    lines.push(`${APP_NAME.toUpperCase()} — CADERNO`);
    lines.push('='.repeat(40));
    lines.push(`Atividade: ${nb.name}`);
    lines.push(`Status: ${st.label}`);
    lines.push(`Criado em: ${fmtDateTime(nb.createdAt)}`);
    lines.push(`Sessão iniciada: ${fmtDateTime(nb.startedAt)}`);
    lines.push(`Concluído em: ${fmtDateTime(nb.finishedAt)}`);
    lines.push(`Duração: ${fmtDuration(nb.startedAt, nb.finishedAt)}`);
    lines.push(`Total de notas: ${nb.notes.length}`);
    lines.push('-'.repeat(40));
    if (!nb.notes.length) lines.push('(sem micro-notas)');
    nb.notes.forEach((n, i) => {
      lines.push(`${String(i + 1).padStart(2, '0')}. [${fmtDate(n.iso)} ${n.time}] ${n.text}`);
    });
    lines.push('-'.repeat(40));
    lines.push(`Gerado pelo ${APP_NAME} em ${fmtDateTime(new Date().toISOString())}`);
    return lines.join('\n') + '\n';
  }

  function buildAIPrompt(nb) {
    const notes = nb.notes.length
      ? nb.notes.map((n) => `[${n.time}] ${n.text}`).join('\n')
      : '(sem micro-notas)';
    return [
      'Você é um editor atento e sensível. Abaixo estão micro-notas registradas em tempo real com o app Taquígrafo (taquigrafia temporal urbana). Cada linha tem um carimbo de hora e no máximo 50 caracteres.',
      '',
      'Tarefas:',
      '1. Reconstrua a sequência como uma narrativa curta e fluida, em português, preservando a ordem cronológica.',
      '2. Aponte padrões, ritmos, intervalos longos ou aglomerações de eventos ao longo do tempo.',
      '3. Sugira um título e um resumo de até 3 linhas.',
      '4. Liste lacunas ou pontos que merecem ser investigados ou complementados.',
      '',
      'Não invente fatos além do que está nas notas; quando algo for inferência, sinalize.',
      '',
      `Atividade: ${nb.name}`,
      `Data: ${fmtDate(nb.createdAt)}`,
      `Duração: ${fmtDuration(nb.startedAt, nb.finishedAt)}`,
      `Total de notas: ${nb.notes.length}`,
      '',
      '--- MICRO-NOTAS ---',
      notes,
      '--- FIM ---'
    ].join('\n');
  }

  async function copyToClipboard(text) {
    try {
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(text);
        return true;
      }
    } catch (e) { /* tenta fallback */ }
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.cssText = 'position:fixed;top:-1000px;opacity:0';
    document.body.appendChild(ta);
    ta.select();
    let ok = false;
    try { ok = document.execCommand('copy'); } catch (e) { ok = false; }
    ta.remove();
    return ok;
  }

  function buildPrintReport(nb) {
    const root = $('#print-report');
    root.textContent = '';
    const h = document.createElement('h1');
    h.textContent = `${APP_NAME} — ${nb.name}`;
    const meta = document.createElement('p');
    meta.className = 'meta';
    meta.textContent =
      `Status: ${STATUS[nb.status].label} · Criado em ${fmtDateTime(nb.createdAt)} · ` +
      `Duração: ${fmtDuration(nb.startedAt, nb.finishedAt)} · ${plural(nb.notes.length, 'nota', 'notas')}`;
    const table = document.createElement('table');
    const thead = document.createElement('thead');
    const hr = document.createElement('tr');
    ['#', 'Hora', 'Micro-nota'].forEach((t) => {
      const th = document.createElement('th');
      th.textContent = t;
      hr.appendChild(th);
    });
    thead.appendChild(hr);
    const tbody = document.createElement('tbody');
    nb.notes.forEach((n, i) => {
      const tr = document.createElement('tr');
      const c1 = document.createElement('td'); c1.textContent = String(i + 1);
      const c2 = document.createElement('td'); c2.className = 't'; c2.textContent = n.time;
      const c3 = document.createElement('td'); c3.textContent = n.text;
      tr.append(c1, c2, c3);
      tbody.appendChild(tr);
    });
    table.append(thead, tbody);
    root.append(h, meta, table);
  }

  /* ---------------- Backup / Restauração ---------------- */
  async function backupAll() {
    const all = await dbAll();
    if (!all.length) { toast('Não há cadernos para fazer backup.'); return; }
    const d = new Date();
    const payload = {
      app: 'Taquigrafo',
      version: 1,
      exportedAt: d.toISOString(),
      notebooks: all
    };
    download(`taquigrafo-backup-${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}.json`,
      JSON.stringify(payload, null, 2), 'application/json');
    toast(`Backup gerado com ${plural(all.length, 'caderno', 'cadernos')}.`);
  }

  function sanitizeNotebook(raw) {
    if (!raw || typeof raw !== 'object' || typeof raw.id !== 'string' || typeof raw.name !== 'string') return null;
    const status = ['waiting', 'active', 'done'].includes(raw.status) ? raw.status : 'waiting';
    const notes = Array.isArray(raw.notes) ? raw.notes
      .filter((n) => n && typeof n.text === 'string')
      .map((n) => {
        const iso = typeof n.iso === 'string' && !isNaN(new Date(n.iso)) ? n.iso : new Date().toISOString();
        return {
          id: typeof n.id === 'string' ? n.id : uid(),
          text: n.text.slice(0, MAX_CHARS),
          time: typeof n.time === 'string' ? n.time : fmtTime(new Date(iso)),
          iso
        };
      }) : [];
    return {
      id: raw.id,
      name: raw.name.slice(0, 60) || 'Sem nome',
      status,
      createdAt: typeof raw.createdAt === 'string' ? raw.createdAt : new Date().toISOString(),
      startedAt: typeof raw.startedAt === 'string' ? raw.startedAt : null,
      finishedAt: typeof raw.finishedAt === 'string' ? raw.finishedAt : null,
      notes
    };
  }

  async function restoreFromFile(file) {
    try {
      const data = JSON.parse(await file.text());
      const source = Array.isArray(data) ? data : data.notebooks;
      if (!Array.isArray(source)) throw new Error('formato');
      const list = source.map(sanitizeNotebook).filter(Boolean);
      if (!list.length) { toast('O arquivo não contém cadernos válidos.'); return; }
      const ok = await confirmDialog(
        `Restaurar ${plural(list.length, 'caderno', 'cadernos')} do backup? Cadernos com o mesmo identificador serão substituídos; os demais serão mantidos.`,
        'Restaurar');
      if (!ok) return;
      await dbPutMany(list);
      toast(`${plural(list.length, 'caderno restaurado', 'cadernos restaurados')}.`);
      await showHome();
    } catch (e) {
      toast('Arquivo inválido. Selecione um backup JSON do Taquígrafo.');
    }
  }

  /* ---------------- Modais ---------------- */
  function openNewDialog() {
    const dlg = $('#dlg-new');
    $('#new-name').value = '';
    dlg.showModal();
    $('#new-name').focus();
  }

  $$('dialog').forEach((dlg) => {
    dlg.addEventListener('click', (e) => { if (e.target === dlg) dlg.close(); });
    $$('[data-close]', dlg).forEach((b) => b.addEventListener('click', () => dlg.close()));
  });

  /* ---------------- Instalação PWA ---------------- */
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredPrompt = e;
    $('#install-item').hidden = false;
  });
  window.addEventListener('appinstalled', () => {
    deferredPrompt = null;
    $('#install-item').hidden = true;
    toast('Taquígrafo instalado!');
  });
  async function installApp() {
    if (!deferredPrompt) { toast('A instalação não está disponível neste momento.'); return; }
    deferredPrompt.prompt();
    await deferredPrompt.userChoice;
    deferredPrompt = null;
    $('#install-item').hidden = true;
  }

  /* ---------------- Eventos ---------------- */
  function handleAction(action) {
    switch (action) {
      case 'home': showHome(); break;
      case 'new': openNewDialog(); break;
      case 'backup': backupAll(); break;
      case 'restore': $('#file-restore').click(); break;
      case 'theme': toggleTheme(); break;
      case 'fullscreen': toggleFullscreen(); break;
      case 'about': $('#dlg-about').showModal(); break;
      case 'install': installApp(); break;
    }
  }

  function bindEvents() {
    $('#btn-home').addEventListener('click', () => { closeDrawer(false); showHome(); });
    btnMenu.addEventListener('click', openDrawer);
    $('#btn-menu-close').addEventListener('click', () => closeDrawer());
    overlay.addEventListener('click', () => closeDrawer());
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && drawer.classList.contains('open')) closeDrawer();
    });

    $$('[data-action]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const inDrawer = drawer.contains(btn);
        const action = btn.dataset.action;
        if (inDrawer) closeDrawer(false);
        handleAction(action);
      });
    });

    $('#file-restore').addEventListener('change', (e) => {
      const file = e.target.files && e.target.files[0];
      e.target.value = '';
      if (file) restoreFromFile(file);
    });

    $('#form-new').addEventListener('submit', async (e) => {
      e.preventDefault();
      const name = $('#new-name').value.trim();
      if (!name) { $('#new-name').focus(); return; }
      $('#dlg-new').close();
      await createNotebook(name);
    });

    $('#btn-back').addEventListener('click', showHome);
    $('#btn-start').addEventListener('click', startSession);
    $('#btn-finish').addEventListener('click', finishNotebook);
    $('#btn-delete').addEventListener('click', () => deleteNotebook(currentId));

    $('#btn-txt').addEventListener('click', async () => {
      const nb = await dbGet(currentId);
      if (!nb) return;
      download(`taquigrafo-${slug(nb.name)}.txt`, buildText(nb), 'text/plain;charset=utf-8');
      toast('TXT exportado.');
    });
    $('#btn-ai').addEventListener('click', async () => {
      const nb = await dbGet(currentId);
      if (!nb) return;
      const ok = await copyToClipboard(buildAIPrompt(nb));
      toast(ok ? 'Copiado! Cole na sua IA favorita.' : 'Não foi possível copiar automaticamente.');
    });
    $('#btn-print').addEventListener('click', async () => {
      const nb = await dbGet(currentId);
      if (!nb) return;
      buildPrintReport(nb);
      window.print();
    });

    const input = $('#note-input');
    input.addEventListener('input', () => {
      if (input.value.length > MAX_CHARS) input.value = input.value.slice(0, MAX_CHARS);
      updateCounter();
    });
    $('#note-form').addEventListener('submit', (e) => {
      e.preventDefault();
      addNote(input.value);
    });
  }

  /* ---------------- Inicialização ---------------- */
  function hideSplash() {
    const s = $('#splash');
    s.classList.add('done');
    s.setAttribute('aria-hidden', 'true');
  }

  async function init() {
    bindEvents();
    setTimeout(hideSplash, 3000);
    try {
      db = await openDB();
      await showHome();
    } catch (err) {
      toast('Erro ao abrir o armazenamento local (IndexedDB).');
    }
  }

  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('sw.js').catch(() => { /* indisponível em file:// */ });
    });
  }

  init();
})();
