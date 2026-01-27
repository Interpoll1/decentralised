import { validateMnemonic } from 'bip39';

export class MnemonicHelper {
  static validate(mnemonic: string): boolean {
    return validateMnemonic(mnemonic);
  }

  static format(mnemonic: string): string {
    return mnemonic.trim().toLowerCase();
  }

  static toWords(mnemonic: string): string[] {
    return this.format(mnemonic).split(/\s+/);
  }

  static fromWords(words: string[]): string {
    return words.join(' ');
  }

  static isValidWordCount(mnemonic: string): boolean {
    const words = this.toWords(mnemonic);
    return words.length === 12 || words.length === 24;
  }

  static getWordCount(mnemonic: string): number {
    return this.toWords(mnemonic).length;
  }
}