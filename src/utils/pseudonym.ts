// Utility to generate deterministic 3-word pseudonyms per post/user
// Ensures the same user gets a stable name within a post, but different across posts

const WORDS_ONE = [
  'bright','silent','wild','brave','calm','swift','clever','lucky','bold','gentle',
  'daring','eager','frosty','golden','happy','jolly','kind','lively','merry','noble',
  'proud','quick','rusty','sunny','vivid','witty','young','zesty','elegant','fierce',
  'glowing','humble','icy','jagged','keen','light','mighty','neat','oak','peach',
  'quiet','royal','shiny','tidy','urban','vital','warm','yearly','zany','azure'
];

const WORDS_TWO = [
  'amber','berry','cedar','dawn','ember','feather','grove','harbor','isle','jungle',
  'lagoon','meadow','nest','oasis','prairie','quarry','ridge','stream','trail','valley',
  'willow','yonder','zephyr','canyon','delta','fjord','garden','harvest','island','jade',
  'knoll','lagoon','marsh','nectar','orchard','petal','quartz','river','summit','tundra',
  'upland','vista','water','xylem','yarrow','zenith','bridge','camp','dune','field'
];

const WORDS_THREE = [
  'sparrow','otter','lynx','falcon','badger','fox','panda','whale','tiger','dolphin',
  'eagle','heron','ibis','jaguar','koala','lemur','moose','narwhal','owl','penguin',
  'quail','rabbit','salmon','turtle','urchin','viper','wolf','yak','zebra','antelope',
  'beaver','cougar','dragon','egret','finch','gecko','hyena','insect','kingfisher','lark',
  'manta','newt','orca','panther','quokka','seal','turkey','urchin','vulture','wren'
];

function hashString(input: string): number {
  let hash = 2166136261 >>> 0; // FNV-1a 32-bit
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
    hash >>>= 0;
  }
  return hash;
}

function pickWord(words: string[], seed: number): string {
  return words[seed % words.length];
}

export function generatePseudonym(postId: string, authorId: string): string {
  const seed = hashString(`${postId}::${authorId}`);

  const word1 = pickWord(WORDS_ONE, seed);
  const word2 = pickWord(WORDS_TWO, seed >>> 8);
  const word3 = pickWord(WORDS_THREE, seed >>> 16);

  return `${word1}-${word2}-${word3}`;
}
