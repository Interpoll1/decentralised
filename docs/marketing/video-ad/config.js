const LANG_ = new URLSearchParams(location.search).get('lang') || 'en';
export const CUE = await (await fetch(`cue_${LANG_}.json`)).json();
export const TXT = {
  en: {
    a1: 'Communities get <em>deleted.</em>', chips: ['a policy changes', 'a company gets sold', 'a moderator leaves'],
    a3: 'Years of conversation.<br><em>One click.</em>', swLab: 'platform admin · community', swName: 'r/yourcommunity', swOff: 'deleted',
    b1: 'What if there was <em>nothing</em><br>to switch off?', b2: 'no single owner · no off switch',
    cK: 'Votes you can check', c1: 'Signed on your device.<br><em>Chained</em> to the vote before it.', c2: 'Tamper with one, and the chain<br><em>breaks in plain sight.</em>',
    pollSpace: 'City Hall', pollTag: 'poll', pollQ: 'Should the city fund night buses?', yes: 'Yes', no: 'No', votes: 'signed votes', signed: 'Signed', mismatch: 'HASH MISMATCH',
    dK: 'No single owner', d1: 'Your device first. Then peers,<br>and relays <em>anyone can run.</em>', d2: 'Take one down.<br><em>The rest carry on.</em>',
    relayTag: 'relay · run by anyone', relayDown: 'RELAY OFFLINE', youTag: 'your device',
    eK: 'Private by default', e1: 'Encrypted <em>before</em> it leaves your browser.', e2: 'Relays only carry <em>scrambled bytes.</em>',
    you: 'you', friend: 'your friend', device: 'key on device', msg: 'Same place, 8 pm? Bring the petition.', sees: 'the relay sees:', keys: 'keys never leave your device',
    beats: [['No', 'ads'], ['No', 'tracking'], ['No', 'hidden algorithm'], 'Open source.'],
    g1: 'Polls and discussions <em>nobody can switch off.</em>', g2: 'nothing to install · open it in your browser',
  },
  fr: {
    a1: 'Des communautés <em>disparaissent.</em>', chips: ['une règle change', 'une entreprise est rachetée', 'un modérateur s’en va'],
    a3: 'Des années de discussions.<br><em>Un seul clic.</em>', swLab: 'admin plateforme · communauté', swName: 'r/votrecommunauté', swOff: 'supprimée',
    b1: 'Et s’il n’y avait plus <em>rien</em><br>à éteindre ?', b2: 'aucun propriétaire · aucun interrupteur',
    cK: 'Des votes vérifiables', c1: 'Signé sur votre appareil.<br><em>Enchaîné</em> au vote précédent.', c2: 'Modifiez-en un seul : la chaîne<br><em>se brise aux yeux de tous.</em>',
    pollSpace: 'Mairie', pollTag: 'sondage', pollQ: 'La ville doit-elle financer des bus de nuit ?', yes: 'Oui', no: 'Non', votes: 'votes signés', signed: 'Signé', mismatch: 'HASH INVALIDE',
    dK: 'Aucun propriétaire unique', d1: 'D’abord votre appareil. Puis des pairs,<br>et des relais que <em>chacun peut héberger.</em>', d2: 'Coupez-en un.<br><em>Les autres continuent.</em>',
    relayTag: 'relais · hébergé par n’importe qui', relayDown: 'RELAIS HORS LIGNE', youTag: 'votre appareil',
    eK: 'Privé par défaut', e1: 'Chiffré <em>avant</em> de quitter votre navigateur.', e2: 'Les relais ne voient que <em>des octets illisibles.</em>',
    you: 'vous', friend: 'votre ami', device: 'clé sur l’appareil', msg: 'Même endroit, 20 h ? Apporte la pétition.', sees: 'le relais voit :', keys: 'les clés restent sur votre appareil',
    beats: [['Sans', 'pub'], ['Sans', 'pistage'], ['Sans', 'algorithme caché'], 'Open source.'],
    g1: 'Des sondages et des discussions <em>que personne ne peut éteindre.</em>', g2: 'rien à installer · ouvrez-le dans votre navigateur',
  },
};
