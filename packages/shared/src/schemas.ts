import { z } from 'zod';
import { MBTI_TYPES } from './types.js';

export const mbtiSchema = z.enum(MBTI_TYPES);
export const credentialsSchema = z.object({ account:z.string().min(3).max(32), password:z.string().min(8).max(128), displayName:z.string().min(1).max(24).optional() });
export const roleSchema = z.object({
  ipTheme:z.string().min(1).max(80), name:z.string().min(1).max(50), personaTags:z.array(z.string().max(30)).max(8).default([]),
  quote:z.string().max(100).default(''), signatureAction:z.string().max(100).default(''), ability:z.string().max(100).default(''), isDefault:z.boolean().default(false)
});
export const roomCodeSchema = z.string().regex(/^[A-HJ-NP-Z2-9]{6}$/);
export const actionSchema = z.object({ actionId:z.string().min(8).max(80), gameId:z.enum(['dont','must','witch','camera','draw','imitate','undercover','truth','story','auction']), action:z.string().min(1).max(50), payload:z.record(z.unknown()).optional() });
