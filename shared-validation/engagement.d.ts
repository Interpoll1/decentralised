export interface PublicAction {
  version: 1; namespace: string; kind: 'reaction' | 'view'; actor: string; targetType: 'post' | 'comment' | 'poll';
  targetId: string; value: 'up' | 'down' | 'none' | 'view'; createdAt: number; nonce: string; id: string; signature: string;
}
export interface VerifyOptions { now?: number; fresh?: boolean; namespace?: string; actor?: string; targetType?: string; targetId?: string; }
export const ACTION_MAX_AGE_MS: number;
export const ACTION_FUTURE_SKEW_MS: number;
export function actionBytes(a: PublicAction): string;
export function signAction(a: Omit<PublicAction, 'version' | 'id' | 'signature'>, key: string): PublicAction;
export function verifyAction(a: unknown, options?: VerifyOptions): a is PublicAction;
export function readAction(envelope: unknown, options?: VerifyOptions): PublicAction | null;
export function reactionSoul(a: PublicAction, namespace: string): string;
export function protectedReactionSoul(soul: string): boolean;
export function actionForSoul(soul: string, envelope: string, namespace: string, options?: VerifyOptions): PublicAction | null;
export function compareActions(a: PublicAction, b: PublicAction): number;
