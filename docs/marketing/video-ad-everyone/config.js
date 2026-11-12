const LANG_ = new URLSearchParams(location.search).get('lang') || 'en';
export const CUE = await (await fetch(`cue_${LANG_}.json`)).json();
const G1 = 'linear-gradient(135deg,#ffb36b,#ff7a59)', G2 = 'linear-gradient(135deg,#f7d58a,#d99a4e)', G3 = 'linear-gradient(135deg,#27306b,#6a3fa0)', G4 = 'linear-gradient(135deg,#3a3f52,#8a5cff)', G5 = 'linear-gradient(135deg,#7ad37a,#2f9e5a)';
export const TXT = {
  en: {
    posts: [
      { n: 'Maya', g: 'Maple Street Neighbours', t: 'Found this little one on Elm Road. Is she yours?', e: '🐈', bg: G1, c: '#ffd27a', l: 48, r: 12 },
      { n: 'Leo', g: 'Sunday Bakers', t: 'First sourdough that didn’t collapse!', e: '🍞', bg: G2, c: '#7ab8ff', l: 131, r: 27 },
      { n: 'Aisha', g: 'Night Sky Club', t: 'Meteor shower tonight. Meet on the hill at 10?', e: '🌠', bg: G3, c: '#ff9ac0', l: 76, r: 19 },
      { n: 'Tom', g: 'Vinyl Diggers', t: 'Look what I found for 2 euros.', e: '🎶', bg: G4, c: '#b4a0ff', l: 59, r: 8 },
      { n: 'Chloé', g: 'Community Garden', t: 'Tomatoes are ready. Come take some!', e: '🍅', bg: G5, c: '#8affd0', l: 92, r: 15 },
    ],
    sponsored: 'SPONSORED', ads: ['Miracle pillow −70%', 'You won’t BELIEVE this trick', 'Buy now. Think later.'], adBtn: 'Shop now', owner: 'PROPERTY OF BIGAPP INC.', hidden: 'HIDDEN BY THE ALGORITHM',
    a1: 'You know that group <em>you love?</em>', a2: 'On most apps, it belongs<br>to <em>a company.</em>', a3: 'And one day, they can<br>simply <em>switch it off.</em>',
    swLab: 'BigApp Inc. · admin panel', swName: 'your group', swOff: 'deleted',
    b1: 'So we built<br>something <em>different.</em>', b2: 'a home for your communities',
    cK: 'What is it?', c1: 'A place to <em>post, chat</em> and build communities that belong to the people in them.', c2: 'Share a photo. Ask a question.<br><em>Start a conversation.</em>',
    feed: { space: 'Maple Street Neighbours', members: '248 members', joined: 'Joined', you: 'You', now: 'just now', publish: 'Publish', placeholder: 'Share something with your community…', text: 'Street party this Saturday! Who’s bringing what?', pollQ: 'Best day for the garden clean-up?', pollA: 'Saturday', pollB: 'Sunday',
      replies: [{ n: 'Maya', c: '#ffd27a', t: 'I’ll bring lemonade 🍋' }, { n: 'Leo', c: '#7ab8ff', t: 'Fresh bread, obviously 🍞' }, { n: 'Chloé', c: '#8affd0', t: 'Count us in! We have a grill 🔥' }] },
    beats: [['No', 'ads'], ['No', 'tracking'], 'Your feed, your rules.'],
    eK: 'Private means private', e1: 'Only <em>you and your friends</em> can read it.', you: 'you', friend: 'your friend', msg: 'Surprise party for Sam. Don’t tell him!', sees: 'everyone else sees:',
    dK: 'Built to last', d1: 'Your community lives on <em>its members’ devices,</em><br>not in one company’s building.', d2: 'So nobody can<br><em>switch it off.</em>',
    swLab2: 'someone, somewhere', swName2: 'your community', nope: 'NICE TRY', people: ['Maya', 'Leo', 'Aisha', 'Tom', 'Chloé', 'Sam'],
    g1: 'Your community, <em>in your hands.</em>', g2: 'free · no ads · nothing to install',
  },
  fr: {
    posts: [
      { n: 'Maya', g: 'Voisins de la rue des Érables', t: 'Trouvée rue des Ormes. Elle est à vous ?', e: '🐈', bg: G1, c: '#ffd27a', l: 48, r: 12 },
      { n: 'Léo', g: 'Boulangers du dimanche', t: 'Mon premier pain au levain qui tient debout !', e: '🍞', bg: G2, c: '#7ab8ff', l: 131, r: 27 },
      { n: 'Aïcha', g: 'Club du ciel étoilé', t: 'Étoiles filantes ce soir. Rendez-vous sur la colline à 22 h ?', e: '🌠', bg: G3, c: '#ff9ac0', l: 76, r: 19 },
      { n: 'Tom', g: 'Chineurs de vinyles', t: 'Regardez ce que j’ai trouvé pour 2 euros.', e: '🎶', bg: G4, c: '#b4a0ff', l: 59, r: 8 },
      { n: 'Chloé', g: 'Jardin partagé', t: 'Les tomates sont mûres. Venez vous servir !', e: '🍅', bg: G5, c: '#8affd0', l: 92, r: 15 },
    ],
    sponsored: 'SPONSORISÉ', ads: ['Oreiller miracle −70 %', 'Cette astuce va vous CHOQUER', 'Achetez. Réfléchissez après.'], adBtn: 'Acheter', owner: 'PROPRIÉTÉ DE BIGAPP INC.', hidden: 'MASQUÉ PAR L’ALGORITHME',
    a1: 'Vous savez, ce groupe <em>que vous adorez ?</em>', a2: 'Sur la plupart des applis,<br>il appartient à <em>une entreprise.</em>', a3: 'Et un jour, elle peut<br>tout simplement <em>le supprimer.</em>',
    swLab: 'BigApp Inc. · panneau admin', swName: 'votre groupe', swOff: 'supprimé',
    b1: 'Alors, nous avons créé<br><em>autre chose.</em>', b2: 'la maison de vos communautés',
    cK: 'C’est quoi ?', c1: 'Un endroit pour <em>publier, discuter</em> et créer des communautés qui appartiennent à leurs membres.', c2: 'Partagez une photo. Posez une question.<br><em>Lancez une conversation.</em>',
    feed: { space: 'Voisins de la rue des Érables', members: '248 membres', joined: 'Membre', you: 'Vous', now: 'à l’instant', publish: 'Publier', placeholder: 'Partagez quelque chose avec votre communauté…', text: 'Fête de rue ce samedi ! Qui apporte quoi ?', pollQ: 'Quel jour pour nettoyer le jardin ?', pollA: 'Samedi', pollB: 'Dimanche',
      replies: [{ n: 'Maya', c: '#ffd27a', t: 'J’apporte la citronnade 🍋' }, { n: 'Léo', c: '#7ab8ff', t: 'Du pain frais, évidemment 🍞' }, { n: 'Chloé', c: '#8affd0', t: 'On vient ! On a un barbecue 🔥' }] },
    beats: [['Sans', 'pub'], ['Sans', 'pistage'], 'Votre fil, vos règles.'],
    eK: 'Privé, vraiment privé', e1: 'Seuls <em>vous et vos amis</em> pouvez le lire.', you: 'vous', friend: 'votre ami', msg: 'Fête surprise pour Sam. Pas un mot !', sees: 'les autres voient :',
    dK: 'Fait pour durer', d1: 'Votre communauté vit sur <em>les appareils de ses membres,</em><br>pas chez une seule entreprise.', d2: 'Donc personne ne peut<br><em>vous la retirer.</em>',
    swLab2: 'quelqu’un, quelque part', swName2: 'votre communauté', nope: 'BIEN ESSAYÉ', people: ['Maya', 'Léo', 'Aïcha', 'Tom', 'Chloé', 'Sam'],
    g1: 'Votre communauté, <em>entre vos mains.</em>', g2: 'gratuit · sans pub · rien à installer',
  },
};
