/* Operator – Gebaeude mit Tabs. Die Tab-Inhalte registrieren sich als '<gebaeude>/<tab>'. */
(function () {
  'use strict';
  var S = OP.screens;

  S.registerShell('taverne', {
    title: 'Taverne', icon: 'taverne', tone: 'gold',
    // Zirkus-Sperre: dann oeffnet die Taverne direkt bei den Zirkus-Taenzen
    defaultTab: function () { return OP.game && OP.game.lockInfo().locked ? 'zirkus' : 'abenteuer'; },
    // Tag vor der Sperre: kleiner Warn-Punkt am Zirkus-Tab
    tabBadge: function (tabId) { return tabId === 'zirkus' && OP.game && OP.game.lockInfo().warn ? 'warn' : null; },
    tabs: [
      { id: 'abenteuer', label: 'Abenteuer', icon: 'abenteuer' },
      { id: 'schmuggler', label: 'Schmuggler', icon: 'schmuggler' },
      { id: 'zirkus', label: 'Zirkus-Tänze', icon: 'zirkus' }
    ]
  });

  S.registerShell('haus', {
    title: 'Haus', icon: 'haus', defaultTab: 'kalorien',
    tabs: [
      { id: 'profil', label: 'Profil', icon: 'profil' },
      { id: 'gym', label: 'Gym', icon: 'gym' },
      { id: 'kalorien', label: 'Kalorien', icon: 'kcal' },
      { id: 'quests', label: 'Quests', icon: 'quest' }
    ]
  });
})();
