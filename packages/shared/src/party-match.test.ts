import { describe, expect, it } from 'vitest';
import { partyMatches, normalizePartyText, type PartyMatchCard } from './party-match.js';

const card: PartyMatchCard = { label: '奶茶', answer: '珍珠奶茶', aliases: ['波霸奶茶'] };

describe('partyMatches golden cases', () => {
  it('exact match on answer', () => {
    expect(partyMatches(card, '珍珠奶茶')).toBe(true);
  });
  it('exact match on label when no answer', () => {
    expect(partyMatches({ label: '火锅' }, '火锅')).toBe(true);
  });
  it('alias match', () => {
    expect(partyMatches(card, '波霸奶茶')).toBe(true);
  });
  it('punctuation and case normalization', () => {
    expect(partyMatches(card, ' 珍珠奶茶！')).toBe(true);
    expect(partyMatches({ label: 'H2O', aliases: [] }, 'h₂o')).toBe(false);
    expect(partyMatches({ label: 'H2O' }, 'H2O')).toBe(true);
  });
  it('substring tolerance: near-complete guess hits', () => {
    expect(partyMatches(card, '珍奶')).toBe(false);
    expect(partyMatches(card, '珍珠奶')).toBe(true);
  });
  it('too-short guesses never hit', () => {
    expect(partyMatches({ label: 'abc' }, 'a')).toBe(false);
  });
  it('undefined card and empty guess are false', () => {
    expect(partyMatches(undefined, '珍珠奶茶')).toBe(false);
    expect(partyMatches(card, '')).toBe(false);
    expect(partyMatches(card, '，。！')).toBe(false);
  });
  it('wrong answers are false', () => {
    expect(partyMatches(card, '咖啡')).toBe(false);
  });
  it('normalizePartyText strips CJK punctuation', () => {
    expect(normalizePartyText('珍珠，奶茶！')).toBe('珍珠奶茶');
  });
});
