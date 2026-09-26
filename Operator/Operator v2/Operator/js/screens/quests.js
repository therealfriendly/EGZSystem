/* Operator – Tages-Quests (Haus → Quests)
   Eigene Quests anlegen, abhaken, bearbeiten, sortieren und loeschen.
   Das ist der EINZIGE Ort, an dem heute Abgehaktes zurueckgenommen werden kann. */
(function () {
  'use strict';
  var OP = (window.OP = window.OP || {});
  var U = OP.util, h = OP.h;

  /* Vorschlaege fuer schnelles Hinzufuegen (werden versteckt, wenn es sie schon gibt) */
  var SUGGESTIONS = [
    { title: '5 Std. Lernen', cat: 'lernen' },
    { title: 'Bewerbung schreiben', cat: 'arbeit' },
    { title: 'Lesen', cat: 'lernen' },
    { title: 'Wasser trinken', cat: 'gesundheit' },
    { title: 'Aufräumen', cat: 'haushalt' },
    { title: 'Freunde anrufen', cat: 'soziales' },
    { title: 'An Projekt arbeiten', cat: 'projekte' }
  ];

  var WEEKDAYS = ['Sonntag', 'Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag'];
  var WD_SHORT = ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'];

  // Entwurf des Formulars – bleibt beim Tab-Wechsel und beim Neuzeichnen erhalten
  var draft = { title: '', cat: 'lernen' };
  // Quest, deren Aktions-Leiste gerade offen ist
  var openId = null;
  // gerade abgehakte Quest (bekommt beim naechsten Zeichnen einmal die "Pop"-Animation)
  var lastChecked = null;

  /* ---------- Helfer ---------- */

  function icon(name) { return OP.ui.icon(name); }
  function norm(t) { return String(t || '').trim().toLowerCase(); }
  function cats() { return OP.data.QUEST_CATEGORIES || []; }
  function doneMap() { return (OP.state && OP.state.quests && OP.state.quests.done) || {}; }
  function today() {
    try { return OP.game.questsToday() || []; } catch (e) { console.error('[quests]', e); return []; }
  }

  /* ---------- Kategorie-Auswahl (8 Kacheln mit Icon + Hinweis) ---------- */

  function catPicker(selected, onPick) {
    var btns = [];
    var hint = h('p', { class: 'qst-cats__hint' });
    var grid = h('div', { class: 'qst-cats', role: 'radiogroup', 'aria-label': 'Kategorie' });

    function select(id) {
      var c = OP.data.questCategory(id);
      selected = c.id;
      btns.forEach(function (b) {
        var on = b.dataset.cat === selected;
        b.classList.toggle('is-on', on);
        b.setAttribute('aria-checked', on ? 'true' : 'false');
      });
      hint.innerHTML = '';
      hint.style.setProperty('--cat-color', c.color);
      hint.appendChild(h('b', { text: c.name + ': ' }));
      hint.appendChild(document.createTextNode(c.hint || ''));
    }

    cats().forEach(function (c) {
      var b = h('button', {
        class: 'qst-cat', type: 'button', role: 'radio', dataset: { cat: c.id }, style: { '--cat-color': c.color },
        onclick: function () { select(c.id); if (onPick) onPick(selected); }
      }, h('span', { class: 'qst-cat__ico', html: icon(c.icon) }), h('span', { class: 'qst-cat__name', text: c.name }));
      btns.push(b);
      grid.appendChild(b);
    });
    select(selected);
    return { el: h('div', { class: 'qst-picker' }, grid, hint), get: function () { return selected; }, set: select };
  }

  /* ---------- Aktionen ---------- */

  // Schutz gegen Doppel-Tippen (sonst: abhaken und sofort wieder zuruecknehmen)
  var lastTap = { id: null, t: 0 };

  function toggle(item) {
    var q = item.quest, now = Date.now();
    if (lastTap.id === q.id && now - lastTap.t < 450) return;
    lastTap = { id: q.id, t: now };
    if (item.done) {
      if (OP.game.questUncheck(q.id)) OP.ui.toast('Haken zurückgenommen.', { type: 'info', icon: 'refresh' });
      return;
    }
    var before = today();
    // vorher setzen: questCheck speichert und das Neuzeichnen passiert sofort im 'change'-Event
    lastChecked = q.id;
    var res = OP.game.questCheck(q.id);
    if (!res || !res.ok) { lastChecked = null; OP.ui.toast('Das hat nicht geklappt.', { type: 'warn' }); return; }
    OP.ui.haptic(15);
    var open = before.filter(function (i) { return !i.done && i.quest.id !== q.id; }).length;
    if (!open && before.length > 1) OP.ui.toast('Alle Quests für heute erledigt!', { type: 'gold', icon: 'trophy' });
  }

  function openEdit(q) {
    var input = h('input', { class: 'input', type: 'text', maxlength: '60', autocomplete: 'off', enterkeyhint: 'done', 'aria-label': 'Name der Quest' });
    input.value = q.title;
    var picker = catPicker(q.cat);
    var dlg = null;
    function save() {
      var res = OP.game.questEdit(q.id, { title: input.value, cat: picker.get() });
      if (!res || !res.ok) { OP.ui.toast((res && res.error) || 'Bitte prüfen.', { type: 'warn' }); return false; }
      OP.ui.toast('Gespeichert.', { type: 'ok' });
      if (dlg) dlg.close();
      return true;
    }
    var form = h('form', { class: 'stack', onsubmit: function (e) { e.preventDefault(); save(); } },
      h('label', { class: 'field' }, h('span', { class: 'field__label', text: 'Name' }), input),
      h('div', { class: 'field' }, h('span', { class: 'field__label', text: 'Kategorie' }), picker.el));
    dlg = OP.ui.modal({
      title: 'Quest ändern',
      body: form,
      actions: [
        { label: 'Abbrechen', kind: 'ghost' },
        { label: 'Speichern', kind: 'primary', icon: 'check', onClick: function () { return save(); } }
      ]
    });
  }

  function askDelete(q) {
    OP.ui.confirm('„' + q.title + '“ verschwindet aus deiner Liste. Schon erledigte Tage bleiben in der Statistik.',
      { title: 'Quest löschen?', okLabel: 'Löschen', danger: true })
      .then(function (ok) {
        if (!ok) return;
        if (openId === q.id) openId = null;
        if (OP.game.questRemove(q.id)) OP.ui.toast('Quest gelöscht.', { type: 'info', icon: 'trash' });
      });
  }

  /* ---------- Bausteine ---------- */

  function buildHead(items) {
    var total = items.length;
    var done = items.filter(function (i) { return i.done; }).length;
    var key = U.today(), d = U.parseDay(key);
    var streak = { current: 0, todayActive: false };
    try { streak = OP.game.streakInfo(); } catch (e) { /* egal */ }
    var all = total > 0 && done === total;

    var status = !total ? 'Noch keine Quests für heute' : (all ? 'Alle erledigt!' : 'erledigt');

    var streakText = streak.current > 0
      ? 'Streak: ' + (streak.current === 1 ? '1 Tag' : U.fmt(streak.current) + ' Tage') + (streak.todayActive ? ' · heute schon gesichert' : '')
      : 'Noch kein Streak';

    return h('section', { class: 'card qst-head' + (all ? ' is-all' : ''), 'aria-label': 'Heute' },
      h('div', { class: 'qst-head__date' },
        h('span', { class: 'qst-head__cal', html: icon('calendar') }),
        h('div', null,
          h('div', { class: 'qst-head__kicker', text: 'Heute' }),
          h('div', { class: 'qst-head__day', text: WEEKDAYS[d.getDay()] + ', ' + U.dayLabel(key) }))),
      h('div', { class: 'qst-head__count' },
        total ? h('span', { class: 'qst-head__num num', text: done + ' / ' + total }) : null,
        h('span', { class: 'qst-head__status', text: status })),
      OP.ui.progress(total ? done / total * 100 : 0, { tone: all ? 'ok' : 'cyan' }),
      h('div', { class: 'qst-head__streak' + (streak.todayActive ? ' is-safe' : '') },
        h('span', { class: 'qst-head__flame', html: icon('streak') }),
        h('div', null,
          h('div', { class: 'qst-head__streak-val', text: streakText }),
          h('div', { class: 'qst-head__streak-hint', text: 'Eine abgehakte Quest hält deinen Streak am Leben.' }))));
  }

  function buildItem(item, idx, count) {
    var q = item.quest, c = item.cat || OP.data.questCategory(q.cat);
    var isOpen = openId === q.id;

    var row = h('li', {
      class: 'qst-item' + (item.done ? ' is-done' : '') + (isOpen ? ' is-open' : '') + (lastChecked === q.id && item.done ? ' just-done' : ''),
      style: { '--cat-color': c.color }
    });

    var main = h('div', { class: 'qst-item__main' },
      h('button', {
        class: 'qst-item__toggle', type: 'button', 'aria-pressed': item.done ? 'true' : 'false',
        'aria-label': (item.done ? 'Zurücknehmen: ' : 'Abhaken: ') + q.title,
        onclick: function () { toggle(item); }
      },
        h('span', { class: 'check' + (item.done ? ' is-on' : ''), html: icon('check') }),
        h('span', { class: 'qst-item__text' },
          h('span', { class: 'qst-item__title', text: q.title }),
          h('span', { class: 'qst-item__meta' },
            h('span', { class: 'qst-chip' }, h('span', { html: icon(c.icon) }), c.name),
            item.done ? h('span', { class: 'qst-item__undo', text: 'Tippen = zurücknehmen' }) : null))),
      h('button', {
        class: 'icon-btn icon-btn--ghost qst-item__more', type: 'button', 'aria-expanded': isOpen ? 'true' : 'false',
        'aria-label': 'Aktionen für ' + q.title, html: icon(isOpen ? 'close' : 'dots'),
        onclick: function () { openId = isOpen ? null : q.id; renderList(); }
      }));
    row.appendChild(main);

    if (isOpen) {
      row.appendChild(h('div', { class: 'qst-item__tray' },
        h('button', { class: 'btn btn--sm', type: 'button', disabled: idx === 0, onclick: function () { OP.game.questMove(q.id, -1); } },
          h('span', { html: icon('up') }), 'Hoch'),
        h('button', { class: 'btn btn--sm', type: 'button', disabled: idx === count - 1, onclick: function () { OP.game.questMove(q.id, 1); } },
          h('span', { html: icon('down') }), 'Runter'),
        h('button', { class: 'btn btn--sm', type: 'button', onclick: function () { openEdit(q); } },
          h('span', { html: icon('edit') }), 'Ändern'),
        h('button', { class: 'btn btn--sm qst-item__del', type: 'button', onclick: function () { askDelete(q); } },
          h('span', { html: icon('trash') }), 'Löschen')));
    }
    return row;
  }

  function buildList(items) {
    if (!items.length) {
      return h('div', { class: 'card card--plain empty qst-empty' },
        h('div', { class: 'empty__icon', html: icon('quest') }),
        h('p', { text: 'Noch keine Quests. Leg unten deine erste an.' }));
    }
    var ids = items.map(function (i) { return i.quest.id; });
    if (openId && ids.indexOf(openId) < 0) openId = null;
    var ul = h('ul', { class: 'qst-list' });
    items.forEach(function (it, i) { ul.appendChild(buildItem(it, i, items.length)); });
    return ul;
  }

  function buildSuggestions(items) {
    var present = {};
    items.forEach(function (i) { present[norm(i.quest.title)] = 1; });
    var list = SUGGESTIONS.filter(function (s) { return !present[norm(s.title)]; });
    if (!list.length) return null;
    var row = h('div', { class: 'qst-suggs' });
    list.forEach(function (s) {
      var c = OP.data.questCategory(s.cat);
      row.appendChild(h('button', {
        class: 'qst-sugg', type: 'button', style: { '--cat-color': c.color },
        'aria-label': s.title + ' hinzufügen (' + c.name + ')',
        onclick: function () {
          var res = OP.game.questAdd(s.title, c.id);
          if (res && res.ok) OP.ui.toast('„' + s.title + '“ hinzugefügt.', { type: 'ok' });
          else OP.ui.toast((res && res.error) || 'Das hat nicht geklappt.', { type: 'warn' });
        }
      }, h('span', { class: 'qst-sugg__plus', html: icon('plus') }), h('span', { text: s.title }),
        h('span', { class: 'qst-sugg__cat', html: icon(c.icon) })));
    });
    return h('div', { class: 'stack stack--sm' },
      h('div', { class: 'qst-sub', text: 'Schnell hinzufügen' }), row);
  }

  function buildHistory(activeCount) {
    var map = doneMap(), key = U.today(), list = [], max = Math.max(1, activeCount), sum = 0;
    for (var i = 6; i >= 0; i--) {
      var k = U.addDays(key, -i);
      var n = Array.isArray(map[k]) ? map[k].length : 0;
      list.push({ key: k, n: n });
      if (n > max) max = n;
      sum += n;
    }
    var bars = h('div', { class: 'qst-hist', role: 'list' });
    list.forEach(function (d) {
      var dt = U.parseDay(d.key), isToday = d.key === key;
      var pct = d.n ? Math.max(8, Math.round(d.n / max * 100)) : 0;
      bars.appendChild(h('div', {
        class: 'qst-day' + (isToday ? ' is-today' : '') + (d.n ? '' : ' is-zero'), role: 'listitem',
        'aria-label': WEEKDAYS[dt.getDay()] + ' ' + U.dayLabel(d.key) + ': ' + d.n + ' erledigt'
      },
        h('span', { class: 'qst-day__n num', text: String(d.n) }),
        h('span', { class: 'qst-day__track' }, h('span', { class: 'qst-day__fill', style: { height: pct + '%' } })),
        h('span', { class: 'qst-day__lbl' }, isToday ? 'Heute' : WD_SHORT[dt.getDay()]),
        h('span', { class: 'qst-day__date', text: dt.getDate() + '.' + (dt.getMonth() + 1) + '.' })));
    });
    return h('section', { class: 'card qst-hist-card', 'aria-label': 'Letzte 7 Tage' },
      h('div', { class: 'row row--between qst-hist-card__head' },
        h('div', { class: 'qst-sub', text: 'Letzte 7 Tage' }),
        h('span', { class: 'small muted num', text: sum + ' erledigt' })),
      bars);
  }

  /* ---------- Bildschirm ---------- */

  var renderList = function () {};   // wird in mount gesetzt

  OP.screens.register('haus/quests', {
    title: 'Quests', icon: 'quest',
    mount: function (el) {
      var bag = OP.ui.cleanup();

      // dynamische Bereiche
      var headBox = h('div', { class: 'qst-slot' });
      var listBox = h('div', { class: 'qst-slot' });
      var suggBox = h('div', { class: 'qst-slot' });
      var histBox = h('div', { class: 'qst-slot' });

      // Formular (bleibt stehen, damit Eingaben nicht verloren gehen)
      var input = h('input', {
        class: 'input', type: 'text', maxlength: '60', autocomplete: 'off', enterkeyhint: 'done',
        placeholder: 'z. B. 5 Std. Lernen', 'aria-label': 'Name der neuen Quest'
      });
      input.value = draft.title;
      input.addEventListener('input', function () { draft.title = input.value; });
      var picker = catPicker(draft.cat, function (id) { draft.cat = id; });

      var form = h('form', {
        class: 'card qst-add', 'aria-label': 'Neue Quest',
        onsubmit: function (e) {
          e.preventDefault();
          var res = OP.game.questAdd(input.value, picker.get());
          if (!res || !res.ok) { OP.ui.toast((res && res.error) || 'Bitte einen Namen eingeben.', { type: 'warn' }); input.focus(); return; }
          input.value = ''; draft.title = '';
          OP.ui.toast('Quest hinzugefügt.', { type: 'ok' });
        }
      },
        h('div', { class: 'card__title' }, h('span', { class: 'tone-cyan', html: icon('plus') }), 'Neue Quest'),
        h('label', { class: 'field' }, h('span', { class: 'field__label', text: 'Name' }), input),
        h('div', { class: 'field' }, h('span', { class: 'field__label', text: 'Kategorie' }), picker.el),
        h('button', { class: 'btn btn--primary btn--lg btn--block', type: 'submit' }, h('span', { html: icon('plus') }), 'Hinzufügen'),
        suggBox);

      var root = h('div', { class: 'screen__inner qst' },
        h('div', { class: 'qst-cols' },
          h('div', { class: 'qst-col' },
            headBox,
            h('section', { 'aria-label': 'Heutige Quests' },
              OP.ui.sectionTitle('Heutige Quests', 'quest', h('span', { class: 'tiny faint qst-taphint', text: 'Tippen = abhaken' })),
              listBox)),
          h('div', { class: 'qst-col' },
            form,
            h('p', { class: 'qst-note' }, h('span', { html: icon('gold') }), 'Belohnungen (Gold, Items) kommen später.'),
            histBox)));
      el.innerHTML = '';
      el.appendChild(root);

      renderList = function () {
        var items = today();
        listBox.innerHTML = '';
        listBox.appendChild(buildList(items));
        lastChecked = null;   // Animation nur einmal zeigen
      };

      function render() {
        var items = today();
        headBox.innerHTML = '';
        headBox.appendChild(buildHead(items));
        listBox.innerHTML = '';
        listBox.appendChild(buildList(items));
        lastChecked = null;
        suggBox.innerHTML = '';
        var sg = buildSuggestions(items);
        if (sg) suggBox.appendChild(sg);
        histBox.innerHTML = '';
        histBox.appendChild(buildHistory(items.length));

        // kleiner Zaehler oben im Kopf
        var done = items.filter(function (i) { return i.done; }).length;
        OP.ui.setHeadExtra(items.length ? h('span', { class: 'chip' + (done === items.length ? ' chip--ok' : '') },
          h('span', { html: icon('quest') }), done + '/' + items.length) : null);
      }

      render();
      bag.on('change', function () { render(); });
      bag.add(function () { renderList = function () {}; });
      return bag.run;
    }
  });
})();
