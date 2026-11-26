// src/services/forecastWatchService.ts
//
// Background check (every 10 min while the app runs) that turns forecast
// activity into notifications:
//   - the community probability on a question you forecast moved ≥10 points
//   - a question you forecast was resolved or voided
//   - a forecaster you follow made a new forecast
// State lives in localStorage so alerts don't repeat across reloads.
import { ForecastService } from './forecastService';
import { notifyGeneric } from './notificationService';
import { communityProbability, significantMove } from '../utils/forecastScoring';

const STATE_KEY = 'interpoll-forecast-watch-v1';
const INTERVAL_MS = 10 * 60_000;
const MAX_POLLS = 25;

interface WatchState {
  probs: Record<string, Record<string, number>>;
  resolved: Record<string, boolean>;
  followSeen: Record<string, number>;
  reputationPublishedAt?: number;
}

function readState(): WatchState {
  try {
    const s = JSON.parse(localStorage.getItem(STATE_KEY) || '{}');
    return { probs: s.probs || {}, resolved: s.resolved || {}, followSeen: s.followSeen || {}, reputationPublishedAt: s.reputationPublishedAt };
  } catch { return { probs: {}, resolved: {}, followSeen: {} }; }
}
function writeState(s: WatchState) {
  try { localStorage.setItem(STATE_KEY, JSON.stringify(s)); } catch { /* ignore */ }
}

let timer: ReturnType<typeof setInterval> | null = null;
let running = false;

export async function checkForecastsOnce(userId: string, displayName = ''): Promise<void> {
  if (running || !userId) return;
  running = true;
  const state = readState();
  let newlyResolved = false;
  try {
    const mine = (await ForecastService.forecastPollIds(userId)).slice(0, MAX_POLLS);
    for (const { pollId } of mine) {
      if (state.resolved[pollId]) continue;
      const spec = await ForecastService.loadSpec(pollId);
      if (!spec) continue;
      const resolution = await ForecastService.loadResolution(spec);
      const path = `/poll/${pollId}`;
      if (resolution) {
        state.resolved[pollId] = true;
        newlyResolved = true;
        await notifyGeneric({
          tag: `forecast-resolved-${pollId}`, path,
          title: resolution.status === 'void' ? 'Forecast voided' : 'Forecast resolved',
          body: resolution.status === 'void' ? 'A question you forecast was voided — it won’t affect your score.' : 'A question you forecast has resolved. See how you did.',
        });
        continue;
      }
      const entries = await ForecastService.loadEntries(pollId);
      const optionIds = [...new Set(entries.map((e) => e.optionId))];
      if (optionIds.length < 2) continue;
      const now = communityProbability(entries, optionIds);
      const before = state.probs[pollId];
      state.probs[pollId] = now;
      const move = before && significantMove(before, now, 0.1);
      if (move) {
        await notifyGeneric({
          tag: `forecast-move-${pollId}`, path,
          title: 'Forecast moved',
          body: `Community probability shifted ${move.delta > 0 ? '+' : ''}${Math.round(move.delta * 100)} points on a question you forecast.`,
        });
      }
    }

    for (const target of ForecastService.followed()) {
      const latest = (await ForecastService.forecastPollIds(target))[0];
      if (!latest) continue;
      const seen = state.followSeen[target];
      state.followSeen[target] = latest.at;
      if (seen !== undefined && latest.at > seen) {
        await notifyGeneric({
          tag: `follow-${target}`, path: `/poll/${latest.pollId}`,
          title: 'New forecast from someone you follow',
          body: 'A forecaster you follow just made a prediction.',
        });
      }
    }
    // Keep my leaderboard summary fresh: after any resolution, otherwise daily.
    if (newlyResolved || !state.reputationPublishedAt || Date.now() - state.reputationPublishedAt > 86_400_000) {
      const rep = await ForecastService.computeReputation(userId);
      await ForecastService.publishReputation(userId, displayName, rep);
      state.reputationPublishedAt = Date.now();
    }
  } catch (err) {
    console.warn('[forecastWatch] check failed', err);
  } finally {
    writeState(state);
    running = false;
  }
}

export function startForecastWatch(userId: string, displayName = ''): void {
  if (timer || typeof window === 'undefined') return;
  setTimeout(() => void checkForecastsOnce(userId, displayName), 30_000);
  timer = setInterval(() => void checkForecastsOnce(userId, displayName), INTERVAL_MS);
}

export function stopForecastWatch(): void {
  if (timer) clearInterval(timer);
  timer = null;
}
