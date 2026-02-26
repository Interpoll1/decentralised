// seed.js
// Seeds communities, posts, and polls by writing directly to the relay's
// MySQL DB via the /api/seed endpoint (bypasses Gun WebSocket reliability issues).
// Run: node seed.js

const GUN_RELAY  = process.env.GUN_RELAY  || 'https://interpoll2.onrender.com';
const API_SERVER = process.env.API_SERVER || 'https://interpoll.onrender.com';
const NAMESPACE  = 'v2';

// ── Helpers ───────────────────────────────────────────────────────────────────

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

function randId(prefix) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

function daysAgo(n) {
  return Date.now() - n * 86400000;
}

const USERS = [
  { id: 'usr_a1b2c3d4', name: 'kartik_dev' },
  { id: 'usr_e5f6g7h8', name: 'noorjahan92' },
  { id: 'usr_i9j0k1l2', name: 'silent_debugger' },
  { id: 'usr_m3n4o5p6', name: 'chai_and_code' },
  { id: 'usr_q7r8s9t0', name: 'overthinking_at_3am' },
  { id: 'usr_u1v2w3x4', name: 'notadesigner_but' },
  { id: 'usr_y5z6a7b8', name: 'justhere4memes' },
  { id: 'usr_c9d0e1f2', name: 'literallyTired' },
];

function randUser() {
  return USERS[Math.floor(Math.random() * USERS.length)];
}

// Write a single Gun node directly to MySQL via the relay REST API
async function writeSoul(soul, data) {
  const res = await fetch(`${GUN_RELAY}/db/write`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({ soul, data }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`writeSoul failed for ${soul}: ${res.status} ${text}`);
  }
  return res.json();
}

// Index a post/poll into the search index
async function indexForSearch(type, id, data) {
  try {
    await fetch(`${API_SERVER}/api/index`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ type, id, data }),
    });
  } catch (err) {
    console.warn(`  ⚠️  Search index failed for ${type}:${id}`);
  }
}

// ── Data ──────────────────────────────────────────────────────────────────────

const COMMUNITIES = [
  {
    id: 'c-devlife',
    name: 'devlife',
    displayName: 'Dev Life',
    description: 'The unfiltered reality of being a developer. Bugs, deadlines, imposter syndrome, and the occasional moment where everything just works.',
    memberCount: 1240,
    createdAt: daysAgo(120),
  },
  {
    id: 'c-adulting',
    name: 'adulting',
    displayName: 'Adulting Is Hard',
    description: "Nobody told us taxes were this confusing. Or that cooking every day would be this exhausting. Sharing the chaos of figuring it all out.",
    memberCount: 3892,
    createdAt: daysAgo(200),
  },
  {
    id: 'c-unpopularopinions',
    name: 'unpopularopinions',
    displayName: 'Unpopular Opinions',
    description: "Say the thing you're afraid to say out loud. Respectful disagreement welcome. Rage-quitting not.",
    memberCount: 5671,
    createdAt: daysAgo(300),
  },
  {
    id: 'c-workstories',
    name: 'workstories',
    displayName: 'Work Stories',
    description: "The meeting that could've been an email. The colleague who microwaves fish. The client who wants it by EOD Friday. We see you.",
    memberCount: 2103,
    createdAt: daysAgo(90),
  },
  {
    id: 'c-midnightthoughts',
    name: 'midnightthoughts',
    displayName: 'Midnight Thoughts',
    description: "2am brain has entered the chat. No filter. No judgment. Just thoughts that wouldn't exist in daylight.",
    memberCount: 4455,
    createdAt: daysAgo(150),
  },
];

const POSTS = [
  {
    communityId: 'c-devlife',
    title: 'Just spent 4 hours debugging. The bug was a missing semicolon.',
    content: `Not a typo. Four hours.\n\nI've been coding for 6 years. I have a CS degree. I've shipped production systems used by actual humans.\n\nAnd I spent four hours — FOUR — hunting down a bug that turned out to be a missing semicolon in a config file that nobody told me existed.\n\nThe worst part? When I found it, I didn't feel relief. I felt nothing. Just a hollow emptiness where my afternoon used to be.\n\nAnyone else ever have a bug that made you question your entire career choice?`,
    createdAt: daysAgo(3),
  },
  {
    communityId: 'c-devlife',
    title: 'My manager just asked if we can "add AI" to our Excel export feature',
    content: `Context: I work at a mid-sized logistics company. Our flagship product is a dashboard that lets warehouse managers export reports to Excel.\n\nToday in our sprint planning, my manager looked at the quarterly roadmap and said:\n\n"I've been reading a lot about AI. Can we add AI to the Excel export?"\n\nI asked what he meant. He said he wanted it to be "smarter."\n\nI asked smarter how.\n\nHe said "like ChatGPT but for Excel."\n\nI closed my laptop. I looked out the window. I thought about becoming a farmer.\n\nWe ship in 3 weeks.`,
    createdAt: daysAgo(1),
  },
  {
    communityId: 'c-devlife',
    title: '"Clean code" culture has made junior devs terrified to just make things work',
    content: `Every time a junior on my team shows me code, they apologize before I even look at it. "Sorry it's a bit messy." "I know this isn't ideal."\n\nWe've created a culture where getting something working isn't enough — it also has to be beautiful, SOLID-compliant, fully typed, zero side effects.\n\nI've seen juniors spend three days refactoring code that worked fine because they were scared someone would judge it in a PR review.\n\nPerfect is the enemy of shipped. Seniors: stop roasting working code in reviews.`,
    createdAt: daysAgo(7),
  },
  {
    communityId: 'c-adulting',
    title: 'I finally understand why my parents were always tired',
    content: `I'm 26. I have a full-time job, a small apartment, and I cook maybe 4 times a week.\n\nAnd I am EXHAUSTED.\n\nMy parents raised three kids, worked two jobs between them, maintained a house, kept the car running, remembered everyone's birthdays, and somehow still made it to my school plays.\n\nI can barely remember to buy toothpaste before I run out.\n\nI owe them an apology and probably a very long hug.`,
    createdAt: daysAgo(5),
  },
  {
    communityId: 'c-adulting',
    title: "Nobody warned me that most of adult life is just sending emails you don't want to send",
    content: `School prepared me for quadratic equations. The themes of Of Mice and Men. How to dissect a frog.\n\nIt did not prepare me for:\n- Following up on the follow-up email\n- Calling the insurance company and being on hold for 45 minutes\n- Writing "per my last email" and meaning it aggressively\n- Replying "sounds great!" when it absolutely does not sound great\n- The specific dread of seeing "can we hop on a quick call?" from someone who has never once had a quick call\n\nI have sent more emails in the last 3 years than I have had meaningful conversations.`,
    createdAt: daysAgo(2),
  },
  {
    communityId: 'c-adulting',
    title: 'Groceries cost HOW MUCH now?',
    content: `I went to the supermarket today for "just a few things." Milk, eggs, bread, some vegetables, a pack of chicken.\n\nRs. 1,840.\n\nFor six items.\n\nI stood at the checkout doing the math in my head three times because I was convinced I'd miscounted. I had not.\n\nI texted my mom. She said "yes beta that's normal now" with the energy of someone who has fully accepted the collapse of everything.\n\nWhen did tomatoes become a luxury item? WHO APPROVED THIS?`,
    createdAt: daysAgo(4),
  },
  {
    communityId: 'c-unpopularopinions',
    title: 'Replying to every message instantly has ruined how people communicate',
    content: `I used to respond to messages within minutes. Always available, always online.\n\nThen I realized: I was training people to expect instant access to me at all times. And I was getting anxious whenever I saw an unread message.\n\nNow I check messages when I choose to. I reply in a few hours, sometimes the next day.\n\nPeople called it rude at first. Then they adjusted. Now my conversations are actually more thoughtful.\n\nInstant communication is a feature, not an obligation. You're allowed to be unavailable.`,
    createdAt: daysAgo(6),
  },
  {
    communityId: 'c-unpopularopinions',
    title: 'Most "productivity" content is just anxiety repackaged as self-improvement',
    content: `5am wake-ups. Cold showers. No days off. 12 habits of highly effective people.\n\nI consumed this stuff for two years. I optimized my mornings. I tracked my habits. I read 30 books a year and color-coded my calendar.\n\nI was miserable.\n\nA lot of productivity content is just capitalism with a motivational poster slapped on it. "Work yourself to the bone — but make it a morning routine."\n\nSometimes the most productive thing you can do is sit outside and do absolutely nothing.`,
    createdAt: daysAgo(9),
  },
  {
    communityId: 'c-workstories',
    title: 'My entire team got "voluntold" to do team building. It was making friendship bracelets.',
    content: `We are a B2B SaaS company. Our average employee age is 31.\n\nOur team building activity was making friendship bracelets.\n\nThe facilitator told us to "pick beads that represent your personality."\n\nI picked a grey bead and a black bead because those are my personality.\n\nMy manager made one for "team synergy." I don't know what that means.\n\nWe had a retro scheduled for the same afternoon that got pushed because "there wasn't enough time after the activity."\n\nThe retro has been rescheduled four times. The friendship bracelet is on my desk. I feel nothing.`,
    createdAt: daysAgo(2),
  },
  {
    communityId: 'c-workstories',
    title: "The guy who always says \"let's circle back\" has never once circled back",
    content: `Three years at this company. Hundreds of meetings. I have been told we will "circle back" on approximately 40-50 topics.\n\nWe have circled back on zero of them.\n\nThe topics include:\n- Whether we're switching project management tools\n- The Q3 hiring plan from 2023\n- What actually happened with the Singapore client\n- Whether remote work is permanent\n- My raise\n\nI have started keeping a log. Not because I expect resolution. But because someday I want to stand up in a meeting and read the full list out loud.`,
    createdAt: daysAgo(1),
  },
  {
    communityId: 'c-midnightthoughts',
    title: 'We spend so much energy trying to seem fine that we forget to actually be fine',
    content: `It's 1:47am and I can't sleep.\n\nI've been thinking about how much effort I put into performing okayness.\n\nSomeone asks how I am. "Good, busy but good." Not because I'm good. Because it's easier than explaining.\n\nAnd the wild thing is everyone around me is probably doing the same thing. We're all performing fine at each other while quietly not being fine.\n\nI don't have a solution. I just think we should maybe ask each other how we actually are sometimes. And actually answer.`,
    createdAt: daysAgo(0),
  },
  {
    communityId: 'c-midnightthoughts',
    title: "The version of yourself you're embarrassed about from 5 years ago was doing their best",
    content: `I was going through old messages tonight. From 2019. The things I said, the opinions I had — some of it made me cringe so hard I put my phone face down.\n\nBut that person was 22, figuring it out, working with the information and emotional capacity they had at the time.\n\nWe're so quick to be retrospectively ashamed of old selves. But shame doesn't retroactively give that version of you the knowledge you have now.\n\nYou grew. That's the whole point. Be a little gentler to your past self. They got you here.`,
    createdAt: daysAgo(2),
  },
];

const POLLS = [
  {
    communityId: 'c-devlife',
    question: "What's the first thing you do when a bug you've been stuck on for hours suddenly disappears?",
    description: "You didn't change anything. You don't know why. It's just gone.",
    options: [
      'Commit and push immediately before it changes its mind',
      'Stare at it for 10 minutes waiting for it to come back',
      'Close the laptop and go for a walk before I break something else',
      "Tell someone immediately even though they don't care",
    ],
    createdAt: daysAgo(2),
    durationDays: 14,
  },
  {
    communityId: 'c-devlife',
    question: "How do you actually name your variables when nobody's watching?",
    description: 'Clean code is for PR reviews. Real code is something else.',
    options: [
      'Descriptive and proper, always (I am lying)',
      'x, y, temp, temp2, tempFinal, tempFinalActual',
      'Whatever makes sense to me right now and future me can suffer',
      'I copy from Stack Overflow so the names are whatever they were there',
    ],
    createdAt: daysAgo(4),
    durationDays: 10,
  },
  {
    communityId: 'c-adulting',
    question: "What's the adulting task you keep putting off the longest?",
    description: 'We all have that one thing. The Thing.',
    options: [
      "Going to the dentist (it's been a while, let's leave it at that)",
      'Sorting out my taxes / financial paperwork',
      'Replying to that one message from months ago',
      "Fixing something broken in my home that I've just 'learned to live with'",
    ],
    createdAt: daysAgo(3),
    durationDays: 21,
  },
  {
    communityId: 'c-adulting',
    question: 'How do you actually feel when plans get cancelled?',
    description: 'Be honest. Nobody can see you.',
    options: [
      "Secretly relieved but I say 'oh no that's such a shame'",
      'Genuinely disappointed, I actually wanted to go',
      "Mixed — relief that I don't have to commute but sad about the plans",
      'Devastated. Every cancelled plan is a small personal betrayal.',
    ],
    createdAt: daysAgo(1),
    durationDays: 14,
  },
  {
    communityId: 'c-unpopularopinions',
    question: 'Should people be allowed to eat smelly food on public transport?',
    description: "You know what food. We've all sat next to it.",
    options: [
      'No. Absolutely not. This should be a law.',
      'Yes, people have the right to eat what they want',
      'Depends on how smelly — mild okay, egg sandwich NOT okay',
      'I am the person eating the smelly food and I feel no remorse',
    ],
    createdAt: daysAgo(5),
    durationDays: 30,
  },
  {
    communityId: 'c-workstories',
    question: "What's the real reason most meetings exist?",
    description: 'Be brutally honest.',
    options: [
      "So managers can feel like they're doing something",
      "Because someone doesn't trust email to make decisions",
      'Genuine alignment and collaboration (I had to include this option)',
      'Nobody knows. Meetings just reproduce. Like bacteria.',
    ],
    createdAt: daysAgo(2),
    durationDays: 14,
  },
  {
    communityId: 'c-workstories',
    question: 'Pick your work personality',
    description: 'Which one are you. Actually.',
    options: [
      'Camera off, mic muted, doing other work during meetings',
      'Overly enthusiastic in a way that exhausts everyone including yourself',
      'Quietly competent, gets everything done, never gets credit',
      "Sends emails at 11pm 'just in case' people think you're slacking",
    ],
    createdAt: daysAgo(6),
    durationDays: 21,
  },
  {
    communityId: 'c-midnightthoughts',
    question: 'What time do you do your best thinking?',
    description: '',
    options: [
      '2-4am when I should absolutely be asleep',
      'In the shower, powerless to write anything down',
      'While commuting, staring out the window',
      'Right before I fall asleep, losing it all by morning',
    ],
    createdAt: daysAgo(1),
    durationDays: 30,
  },
];

// ── Seed functions ────────────────────────────────────────────────────────────

async function seedCommunities() {
  console.log('\n📦 Seeding communities...');

  // First write the root index node so Gun's .map() can find all communities
  const rootIndex = {};
  for (const c of COMMUNITIES) {
    rootIndex[c.id] = { '#': `${NAMESPACE}/communities/${c.id}` };
  }
  await writeSoul(`${NAMESPACE}/communities`, rootIndex);
  await sleep(200);

  for (const community of COMMUNITIES) {
    const soul = `${NAMESPACE}/communities/${community.id}`;
    const data = {
      id:          community.id,
      name:        community.name,
      displayName: community.displayName,
      description: community.description,
      memberCount: community.memberCount,
      postCount:   0,
      createdAt:   community.createdAt,
      creatorId:   'seed-script',
      authorName:  'seed',
      rules:       { 0: 'Be respectful', 1: 'No spam' },
    };
    await writeSoul(soul, data);
    console.log(`  ✅ Community: ${community.displayName}`);
    await sleep(150);
  }
}

async function seedPosts() {
  console.log('\n📝 Seeding posts...');

  // Root posts index
  const rootIndex = {};

  const postsToWrite = POSTS.map(post => {
    const user   = randUser();
    const postId = `post-${post.createdAt}-${Math.random().toString(36).slice(2, 9)}`;
    const upvotes   = Math.floor(Math.random() * 80) + 5;
    const downvotes = Math.floor(Math.random() * 8);
    return {
      postId,
      communityId: post.communityId,
      data: {
        id:           postId,
        communityId:  post.communityId,
        authorId:     user.id,
        authorName:   user.name,
        title:        post.title,
        content:      post.content,
        createdAt:    post.createdAt,
        upvotes,
        downvotes,
        score:        upvotes - downvotes,
        commentCount: Math.floor(Math.random() * 20),
      },
    };
  });

  // Build root index
  for (const { postId } of postsToWrite) {
    rootIndex[postId] = { '#': `${NAMESPACE}/posts/${postId}` };
  }
  await writeSoul(`${NAMESPACE}/posts`, rootIndex);
  await sleep(200);

  // Build per-community post index nodes
  const communityPostIndexes = {};
  for (const { postId, communityId, data } of postsToWrite) {
    if (!communityPostIndexes[communityId]) communityPostIndexes[communityId] = {};
    communityPostIndexes[communityId][postId] = { '#': `${NAMESPACE}/communities/${communityId}/posts/${postId}` };
  }
  for (const [communityId, index] of Object.entries(communityPostIndexes)) {
    await writeSoul(`${NAMESPACE}/communities/${communityId}/posts`, index);
    await sleep(100);
  }

  // Write each post
  for (const { postId, communityId, data } of postsToWrite) {
    // Global post node
    await writeSoul(`${NAMESPACE}/posts/${postId}`, data);
    // Community post node
    await writeSoul(`${NAMESPACE}/communities/${communityId}/posts/${postId}`, data);

    // Index for search
    await indexForSearch('post', postId, {
      title:         data.title,
      content:       data.content,
      authorName:    data.authorName,
      communitySlug: communityId,
      createdAt:     data.createdAt,
    });

    console.log(`  ✅ Post: "${data.title.slice(0, 55)}..."`);
    await sleep(200);
  }
}

async function seedPolls() {
  console.log('\n📊 Seeding polls...');

  const rootIndex = {};

  const pollsToWrite = POLLS.map(poll => {
    const user   = randUser();
    const pollId = `poll-${poll.createdAt}-${Math.random().toString(36).slice(2, 9)}`;
    const now    = poll.createdAt;

    const options = poll.options.map((text, idx) => ({
      id:     `${pollId}-opt-${idx}`,
      text,
      votes:  Math.floor(Math.random() * 120) + 10,
      voters: [],
    }));
    const totalVotes = options.reduce((s, o) => s + o.votes, 0);

    return {
      pollId,
      communityId: poll.communityId,
      options,
      data: {
        id:                     pollId,
        communityId:            poll.communityId,
        authorId:               user.id,
        authorName:             user.name,
        question:               poll.question,
        description:            poll.description || '',
        createdAt:              now,
        expiresAt:              now + poll.durationDays * 86400000,
        allowMultipleChoices:   false,
        showResultsBeforeVoting: true,
        requireLogin:           false,
        isPrivate:              false,
        totalVotes,
        isExpired:              false,
      },
    };
  });

  // Root polls index
  for (const { pollId } of pollsToWrite) {
    rootIndex[pollId] = { '#': `${NAMESPACE}/polls/${pollId}` };
  }
  await writeSoul(`${NAMESPACE}/polls`, rootIndex);
  await sleep(200);

  // Community poll indexes
  const communityPollIndexes = {};
  for (const { pollId, communityId } of pollsToWrite) {
    if (!communityPollIndexes[communityId]) communityPollIndexes[communityId] = {};
    communityPollIndexes[communityId][pollId] = { '#': `${NAMESPACE}/communities/${communityId}/polls/${pollId}` };
  }
  for (const [communityId, index] of Object.entries(communityPollIndexes)) {
    await writeSoul(`${NAMESPACE}/communities/${communityId}/polls`, index);
    await sleep(100);
  }

  // Write each poll + options
  for (const { pollId, communityId, options, data } of pollsToWrite) {
    await writeSoul(`${NAMESPACE}/polls/${pollId}`, data);
    await writeSoul(`${NAMESPACE}/communities/${communityId}/polls/${pollId}`, data);

    // Write options
    const optionsIndex = {};
    for (let i = 0; i < options.length; i++) {
      optionsIndex[i] = { '#': `${NAMESPACE}/polls/${pollId}/options/${i}` };
      await writeSoul(`${NAMESPACE}/polls/${pollId}/options/${i}`, options[i]);
      await writeSoul(`${NAMESPACE}/communities/${communityId}/polls/${pollId}/options/${i}`, options[i]);
    }
    await writeSoul(`${NAMESPACE}/polls/${pollId}/options`, optionsIndex);
    await writeSoul(`${NAMESPACE}/communities/${communityId}/polls/${pollId}/options`, optionsIndex);

    // Index for search
    await indexForSearch('poll', pollId, {
      question:      data.question,
      description:   data.description,
      authorName:    data.authorName,
      communitySlug: communityId,
      createdAt:     data.createdAt,
    });

    console.log(`  ✅ Poll: "${data.question.slice(0, 55)}..."`);
    await sleep(200);
  }
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  console.log('🌱 Starting seed...');
  console.log(`   Gun relay : ${GUN_RELAY}`);
  console.log(`   API server: ${API_SERVER}`);
  console.log(`   Namespace : ${NAMESPACE}`);

  // Check if /db/write endpoint exists
  const check = await fetch(`${GUN_RELAY}/health`);
  if (!check.ok) {
    console.error('❌ Cannot reach Gun relay. Is it running?');
    process.exit(1);
  }
  console.log('✅ Gun relay reachable\n');

  await seedCommunities();
  await seedPosts();
  await seedPolls();

  console.log('\n✅ Seed complete!');
  process.exit(0);
}

main().catch(err => {
  console.error('❌ Seed failed:', err.message);
  process.exit(1);
});