const Gun = require('gun');
const gun = Gun({ peers: ['https://interpoll2.endless.sbs/gun'], radisk:false, localStorage:false, file:false, axe:false, multicast:false });

const base = (id) => ({ id, name:id.slice(2), displayName:'Probe '+id, description:'probe', creatorId:'current-user-id', createdAt:Date.now(), memberCount:1, postCount:0, category:null, nsfw:false, isPrivate:false });

const idSigned  = 'c-probesigned-'  + Date.now();
const idChained = 'c-probechained-' + Date.now();

const signed = { ...base(idSigned),
  creatorPubkey: '90f40151178730c28386008e80b04280c6c367c5697b03bf69e41782a98773b6',
  creatorSignature: '0c77c6523c38b4bbeb386f6bdc8990e9bdee8e358e35592411d6f1c2cab46fdf6f980764e39f28c1111111111111111111111111111111111111111111111111111' };

const t0 = Date.now();
gun.get('v3/communities/' + idSigned).put(signed, (ack) =>
  console.log('A soul-direct+signature ACK', Date.now()-t0, 'ms', JSON.stringify(ack).slice(0,150)));

gun.get('v3').get('communities').get(idChained).put(base(idChained), (ack) =>
  console.log('B chained ACK', Date.now()-t0, 'ms', JSON.stringify(ack).slice(0,150)));

setTimeout(() => { console.log('ids:', idSigned, idChained); process.exit(0); }, 12000);
