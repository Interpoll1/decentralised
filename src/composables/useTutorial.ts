/**
 * useTutorial.ts
 *
 * Tutorial overlay state extracted from HomePage.vue.
 * Only needed on first visit — deferred after first paint.
 */

import { ref, computed } from 'vue';

const TUTORIAL_STORAGE_KEY = 'interpoll_home_tutorial_seen';

const TUTORIAL_STEPS = [
  {
    title: 'See what\'s new in your interests',
    body: 'Your home feed shows you all the latest polls and discussions. You can sort by "For You" (topics you follow) or "Latest" (brand new posts).',
    bullets: [
      '"For You" — see posts from communities you joined',
      '"Latest" — see the newest posts from everyone',
      'Tap the notification banner to refresh and see new posts',
    ],
  },
  {
    title: 'Join communities or create your own',
    body: 'Communities are groups organized around topics. Join a few to see their posts in your feed, or start a new one.',
    bullets: [
      'Browse all communities and join ones you like',
      'Search to find a community by name',
      'Create a new community if you don\'t find what you\'re looking for',
    ],
  },
  {
    title: 'Message people directly',
    body: 'Use Chat to send direct messages to other users. You can have quick one-on-one conversations here.',
    bullets: [
      'Search for people by their name or username',
      'See your recent conversations in one place',
      'Unread messages show up as badges',
    ],
  },
  {
    title: 'Create polls, posts, and communities',
    body: 'The Create button (plus icon) is how you add things. Start a poll to ask for opinions, share a post, or launch a new community.',
    bullets: [
      'Start a poll to get feedback from others',
      'Share a post to discuss news or ideas',
      'Create a community for a topic that matters to you',
    ],
  },
];

export function useTutorial() {
  const tutorialVisible = ref(localStorage.getItem(TUTORIAL_STORAGE_KEY) !== 'true');
  const tutorialStep    = ref(0);
  const currentTutorialStep = computed(() => TUTORIAL_STEPS[tutorialStep.value]);

  function skipTutorial() {
    tutorialVisible.value = false;
    localStorage.setItem(TUTORIAL_STORAGE_KEY, 'true');
  }

  function previousTutorialStep() {
    if (tutorialStep.value > 0) tutorialStep.value--;
  }

  function nextTutorialStep() {
    if (tutorialStep.value < TUTORIAL_STEPS.length - 1) {
      tutorialStep.value++;
    } else {
      skipTutorial();
    }
  }

  return {
    tutorialVisible, tutorialStep, currentTutorialStep,
    skipTutorial, previousTutorialStep, nextTutorialStep,
    TUTORIAL_STEPS,
  };
}