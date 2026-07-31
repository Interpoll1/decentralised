import { GunService } from './gunService';
import { UserService } from './userService';

export interface ChatInvite {
  id: string;
  fromUserId: string;
  fromDisplayName: string;
  toUserId: string;
  inviteLink: string;
  createdAt: number;
  readAt?: number | null;
}

const INVITE_ID_PREFIX = 'chat-invite-';

function getGun() {
  return GunService.getGun();
}

function buildInviteLink(fromUserId: string, fromDisplayName: string): string {
  const encodedName = encodeURIComponent(fromDisplayName || 'User');
  return `/chat/${encodeURIComponent(fromUserId)}?name=${encodedName}`;
}

export class ChatInviteService {
  static async sendInvite(toUserId: string): Promise<ChatInvite> {
    const currentUser = await UserService.getCurrentUser();
    if (!toUserId || toUserId === currentUser.id) {
      throw new Error('Invalid invite target');
    }

    const fromDisplayName = currentUser.customUsername
      || currentUser.displayName
      || currentUser.username
      || 'User';

    const invite: ChatInvite = {
      id: `${INVITE_ID_PREFIX}${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
      fromUserId: currentUser.id,
      fromDisplayName,
      toUserId,
      inviteLink: buildInviteLink(currentUser.id, fromDisplayName),
      createdAt: Date.now(),
      readAt: null,
    };

    getGun().get('users').get(toUserId).get('chatInvites').get(invite.id).put(invite);
    return invite;
  }

  static async getPendingInvites(userId: string): Promise<ChatInvite[]> {
    const invitesRoot = await new Promise<any>((resolve) => {
      let settled = false;
      const timer = setTimeout(() => {
        if (!settled) {
          settled = true;
          resolve(null);
        }
      }, 2500);

      getGun().get('users').get(userId).get('chatInvites').once((data: any) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(data);
      });
    });

    if (!invitesRoot || typeof invitesRoot !== 'object') return [];

    const invites = Object.keys(invitesRoot)
      .filter((key) => key !== '_' && key.startsWith(INVITE_ID_PREFIX))
      .map((key) => invitesRoot[key] as ChatInvite)
      .filter((invite) => invite && !invite.readAt && typeof invite.createdAt === 'number')
      .sort((a, b) => b.createdAt - a.createdAt);

    return invites;
  }

  static markInviteRead(userId: string, inviteId: string): void {
    getGun().get('users').get(userId).get('chatInvites').get(inviteId).get('readAt').put(Date.now());
  }
}
