import { computed } from 'vue';
import {
  feedPreferencesVersion,
  FeedPreferencesService,
  type FeedMode,
  type FeedRankingWeights,
} from '../services/feedPreferencesService';

export function useFeedPreferences() {
  const preferences = computed(() => {
    feedPreferencesVersion.value;
    return FeedPreferencesService.getPreferences();
  });

  const setMode = (mode: FeedMode) => FeedPreferencesService.setMode(mode);

  const setContentTypeVisibility = (showPosts: boolean, showPolls: boolean) =>
    FeedPreferencesService.setContentTypeVisibility(showPosts, showPolls);

  const setRankingWeights = (weights: Partial<FeedRankingWeights>) =>
    FeedPreferencesService.setRankingWeights(weights);

  const addIncludeKeyword = (term: string) => FeedPreferencesService.addIncludeKeyword(term);
  const removeIncludeKeyword = (term: string) => FeedPreferencesService.removeIncludeKeyword(term);
  const addExcludeKeyword = (term: string) => FeedPreferencesService.addExcludeKeyword(term);
  const removeExcludeKeyword = (term: string) => FeedPreferencesService.removeExcludeKeyword(term);

  const toggleMutedCommunity = (communityId: string) =>
    FeedPreferencesService.toggleMutedCommunity(communityId);

  const toggleFavoriteCommunity = (communityId: string) =>
    FeedPreferencesService.toggleFavoriteCommunity(communityId);

  const resetPreferences = () => FeedPreferencesService.resetPreferences();

  return {
    preferences,
    setMode,
    setContentTypeVisibility,
    setRankingWeights,
    addIncludeKeyword,
    removeIncludeKeyword,
    addExcludeKeyword,
    removeExcludeKeyword,
    toggleMutedCommunity,
    toggleFavoriteCommunity,
    resetPreferences,
  };
}
