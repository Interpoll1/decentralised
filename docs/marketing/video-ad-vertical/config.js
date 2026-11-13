const Q = new URLSearchParams(location.search), LANG_ = Q.get('lang') || 'en', MODE_ = Q.get('v') || 'short';
export const CUE = await (await fetch(MODE_ === 'phonk' ? 'cue_phonk.json' : `cue_short_${LANG_}.json`)).json();
const G1 = 'linear-gradient(135deg,#ffb36b,#ff7a59)', G2 = 'linear-gradient(135deg,#f7d58a,#d99a4e)', G3 = 'linear-gradient(135deg,#27306b,#6a3fa0)';
export const TXT = {
  en: {
    posts: [
      { n: 'Maya', g: 'Maple Street Neighbours', t: 'Found this little one on Elm Road. Is she yours?', e: '🐈', bg: G1, c: '#ffd27a', l: 48, r: 12 },
      { n: 'Leo', g: 'Sunday Bakers', t: 'First sourdough that didn’t collapse!', e: '🍞', bg: G2, c: '#7ab8ff', l: 131, r: 27 },
      { n: 'Aisha', g: 'Night Sky Club', t: 'Meteor shower tonight. Meet on the hill at 10?', e: '🌠', bg: G3, c: '#ff9ac0', l: 76, r: 19 },
    ],
    sponsored: 'SPONSORED', ads: ['Miracle pillow −70%', 'Buy now. Think later.'], adBtn: 'Shop now', owner: 'PROPERTY OF BIGAPP INC.',
    s1: 'Your favourite group belongs to <em>a company.</em>', s1b: 'They can <em>delete it</em> tomorrow.', swLab: 'BigApp Inc. · admin panel', swName: 'your group', swOff: 'deleted',
    s2: 'is different',
    s3: '<em>Post. Chat.</em><br>Build communities.', s3chips: ['ads', 'tracking'],
    s4: 'Nobody can<br><em>switch it off.</em>', swLab2: 'someone, somewhere', swName2: 'your community', nope: 'NICE TRY',
    feed: { space: 'Maple Street Neighbours', members: '248 members', joined: 'Joined', you: 'You', now: 'just now', publish: 'Publish', placeholder: 'Share something…', text: 'Street party this Saturday! Who’s bringing what?',
      replies: [{ n: 'Maya', c: '#ffd27a', t: 'I’ll bring lemonade 🍋' }, { n: 'Leo', c: '#7ab8ff', t: 'Fresh bread, obviously 🍞' }] },
    g1: 'Your community, <em>in your hands.</em>', g2: 'free · no ads · nothing to install',
    phonk: { names: ['FACEBOOK', 'INSTAGRAM', 'X', 'TIKTOK', 'REDDIT', 'DISCORD'], swLab: 'platform admin panel', them: 'OTHER PLATFORMS', ours: 'OURS.', tag: 'Your community, <em>in your hands.</em>', out: 'OPEN SOURCE.', outSub: 'and free.',
      pairs: [
        { names: 'FACEBOOK · INSTAGRAM · X · REDDIT · TIKTOK', e: '📢', them: 'ADS.<br>EVERYWHERE.', themSub: 'it’s the business model', us: 'ZERO<br>ADS.', usSub: 'ever.' },
        { names: 'FACEBOOK · INSTAGRAM · TIKTOK · X', e: '👁️', them: 'TRACK YOU<br>TO TARGET ADS', themSub: 'it’s in their privacy policies', us: 'NO<br>TRACKING.', usSub: 'nothing to sell.' },
        { names: 'TIKTOK · INSTAGRAM · X · FACEBOOK', e: '🎰', them: 'AN ALGORITHM<br>PICKS YOUR FEED', themSub: 'you just scroll', us: 'YOUR FEED.<br>YOUR RULES.', usSub: 'you tune it yourself.' },
        { names: 'REDDIT · FACEBOOK · DISCORD', e: '', them: 'ONE COMPANY<br>CAN DELETE<br>YOUR COMMUNITY', themSub: '', us: 'NOBODY CAN<br>SWITCH IT OFF.', usSub: '', sw: 1 },
      ] },
  },
  fr: {
    posts: [
      { n: 'Maya', g: 'Voisins de la rue des Érables', t: 'Trouvée rue des Ormes. Elle est à vous ?', e: '🐈', bg: G1, c: '#ffd27a', l: 48, r: 12 },
      { n: 'Léo', g: 'Boulangers du dimanche', t: 'Mon premier pain au levain qui tient debout !', e: '🍞', bg: G2, c: '#7ab8ff', l: 131, r: 27 },
      { n: 'Aïcha', g: 'Club du ciel étoilé', t: 'Étoiles filantes ce soir. Rendez-vous sur la colline ?', e: '🌠', bg: G3, c: '#ff9ac0', l: 76, r: 19 },
    ],
    sponsored: 'SPONSORISÉ', ads: ['Oreiller miracle −70 %', 'Achetez. Réfléchissez après.'], adBtn: 'Acheter', owner: 'PROPRIÉTÉ DE BIGAPP INC.',
    s1: 'Votre groupe préféré appartient à <em>une entreprise.</em>', s1b: 'Elle peut <em>le supprimer</em> demain.', swLab: 'BigApp Inc. · panneau admin', swName: 'votre groupe', swOff: 'supprimé',
    s2: 'c’est différent',
    s3: '<em>Publiez. Discutez.</em><br>Créez des communautés.', s3chips: ['pub', 'pistage'],
    s4: 'Personne ne peut<br><em>vous les retirer.</em>', swLab2: 'quelqu’un, quelque part', swName2: 'votre communauté', nope: 'BIEN ESSAYÉ',
    feed: { space: 'Voisins de la rue des Érables', members: '248 membres', joined: 'Membre', you: 'Vous', now: 'à l’instant', publish: 'Publier', placeholder: 'Partagez quelque chose…', text: 'Fête de rue ce samedi ! Qui apporte quoi ?',
      replies: [{ n: 'Maya', c: '#ffd27a', t: 'J’apporte la citronnade 🍋' }, { n: 'Léo', c: '#7ab8ff', t: 'Du pain frais, évidemment 🍞' }] },
    g1: 'Votre communauté, <em>entre vos mains.</em>', g2: 'gratuit · sans pub · rien à installer',
    phonk: { names: ['FACEBOOK', 'INSTAGRAM', 'X', 'TIKTOK', 'REDDIT', 'DISCORD'], swLab: 'panneau admin de la plateforme', them: 'LES AUTRES PLATEFORMES', ours: 'LA NÔTRE.', tag: 'Votre communauté, <em>entre vos mains.</em>', out: 'OPEN SOURCE.', outSub: 'et gratuit.',
      pairs: [
        { names: 'FACEBOOK · INSTAGRAM · X · REDDIT · TIKTOK', e: '📢', them: 'DE LA PUB.<br>PARTOUT.', themSub: 'c’est leur modèle économique', us: 'ZÉRO<br>PUB.', usSub: 'jamais.' },
        { names: 'FACEBOOK · INSTAGRAM · TIKTOK · X', e: '👁️', them: 'VOUS PISTENT<br>POUR CIBLER<br>LA PUB', themSub: 'c’est dans leurs règles', us: 'ZÉRO<br>PISTAGE.', usSub: 'rien à vendre.' },
        { names: 'TIKTOK · INSTAGRAM · X · FACEBOOK', e: '🎰', them: 'UN ALGORITHME<br>CHOISIT POUR VOUS', themSub: 'vous, vous scrollez', us: 'VOTRE FIL.<br>VOS RÈGLES.', usSub: 'c’est vous qui réglez.' },
        { names: 'REDDIT · FACEBOOK · DISCORD', e: '', them: 'UNE ENTREPRISE<br>PEUT SUPPRIMER<br>VOTRE COMMUNAUTÉ', themSub: '', us: 'PERSONNE NE PEUT<br>L’ÉTEINDRE.', usSub: '', sw: 1 },
      ] },
  },
};
