/** Tab-local display URLs. Callers must authenticate/decode a new candidate before retaining it. */
export class ChatMediaPreviews {
  private entries = new Map<string, { envelope: string; url: string }>();
  retain(owner: string, messageId: string, envelope: string, candidate: string): string {
    const key = JSON.stringify([owner, messageId]);
    const previous = this.entries.get(key);
    if (previous?.envelope === envelope) {
      if (candidate !== previous.url) URL.revokeObjectURL(candidate);
      return previous.url;
    }
    if (previous) URL.revokeObjectURL(previous.url);
    this.entries.set(key, { envelope, url: candidate });
    return candidate;
  }
}
