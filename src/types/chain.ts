// src/types/chain.ts

export interface Poll {
  id: string;
  title: string;
  description: string;
  options: string[];
  createdAt: number;
}

export interface Vote {
  pollId: string;
  choice: string;
  timestamp: number;
  deviceId: string; // Device fingerprint to prevent double voting
}

export interface ChainBlock {
  index: number;
  timestamp: number;
  previousHash: string;
  voteHash: string;
  signature: string;
  currentHash: string;
  nonce: number;
}

export interface Receipt {
  blockIndex: number;
  voteHash: string;
  chainHeadHash: string;
  mnemonic: string;
  timestamp: number;
  pollId: string;
}