import { describe, expect, it } from 'vitest';
import { buildChallenge, GAME_IDS, isDistinctSecretMission, isLowCorrelationSecretMission, MBTI_TYPES, validateChallenge, type IpRole } from './index.js';

const role: IpRole = { id:'r1', ipTheme:'罗小黑战记', name:'罗小黑', personaTags:['灵活','好奇'], quote:'我想回家', signatureAction:'轻轻点头', ability:'空间系能力', isDefault:true };

describe('safe challenge matrix', () => {
  it('builds a valid challenge for every game and MBTI', () => {
    for (const gameId of GAME_IDS) for (const mbti of MBTI_TYPES) {
      const challenge = buildChallenge({ gameId, mbti, role, cameraAvailable:true });
      expect(validateChallenge(challenge)).toBe(true);
      expect(challenge.requirements.physicalContact).toBe(false);
      expect(challenge.requirements.props).toBe('none');
    }
  });
  it('builds a private trigger mission in the required format and avoids duplicates',()=>{
    const challenge=buildChallenge({gameId:'must',mbti:'ENFP',role,playerCount:2,cameraAvailable:true});
    const next=buildChallenge({gameId:'must',mbti:'ENFP',role,playerCount:2,cameraAvailable:true,excludedContents:[challenge.content]});
    expect(challenge.title).toBe('MBTI 触发款');
    expect(challenge.content).toMatch(/^当看到有人.+，你必须立刻.+$/);
    expect(isLowCorrelationSecretMission(challenge.content)).toBe(true);
    expect(next.content).not.toBe(challenge.content);
  });
  it('rejects secret missions whose trigger reveals the response',()=>{
    const challenge=buildChallenge({gameId:'must',mbti:'ENFP',role,playerCount:2,cameraAvailable:true});
    const correlated={...challenge,content:'当看到有人点头，你必须立刻跟着点头'};
    expect(isLowCorrelationSecretMission(correlated.content)).toBe(false);
    expect(validateChallenge(correlated)).toBe(false);
  });
  it('rejects compound triggers and compound responses',()=>{
    const challenge=buildChallenge({gameId:'must',mbti:'ENFP',role,playerCount:2,cameraAvailable:true});
    expect(validateChallenge({...challenge,content:'当看到有人喝水或拿起杯子，你必须立刻轻轻咳嗽两声'})).toBe(false);
    expect(validateChallenge({...challenge,content:'当看到有人喝水，你必须立刻轻轻咳嗽两声然后拍手'})).toBe(false);
    expect(validateChallenge({...challenge,content:'当看到有人喝水，你必须立刻举起双臂，用播音腔说三次测试'})).toBe(false);
    expect(validateChallenge({...challenge,content:'当看到有人打哈欠，你必须立刻原地轻跳一下，竖起右手大拇指并大声说今日份的可爱已送达喵，保持两秒后自然放下'})).toBe(false);
  });
  it('accepts the reviewed examples for all three mission tiers',()=>{
    const examples=['当看到有人喝水，你必须立刻轻轻咳嗽两声','当看到有人笑出声，你必须立刻揉一下自己的眼睛','当看到有人坐下，你必须立刻慢慢伸一个懒腰','当看到有人拿起手机，你必须立刻深呼吸一大口气','当看到有人主动搭话，你必须立刻原地轻轻跳一下','当看到有人整理桌面物品，你必须立刻原地转半圈','当看到有人到处找东西，你必须立刻拍手两下','当看到有人突然走神发呆，你必须立刻打一个响指','当看到有人吃零食，你必须立刻模仿一次正太扭腰动作','当看到有人站起来走路，你必须立刻模仿哈兰德走姿走两步','当看到有人笑出声，你必须立刻做一个 Scuba 潜水舞动作','当看到有人挥手，你必须立刻说一句“真爱降临”'];
    const base=buildChallenge({gameId:'must',mbti:'ENFP',role,playerCount:3});for(const content of examples)expect(validateChallenge({...base,content})).toBe(true);
  });
  it('prevents repeated triggers and repeated action templates in one room',()=>{
    const existing=['当看到有人喝水，你必须立刻用罗小黑的语气说“爱你老己”'];
    expect(isDistinctSecretMission('当看到有人点头，你必须立刻用无限的语气说“爱你老己”',existing)).toBe(false);
    expect(isDistinctSecretMission('当看到有人喝水，你必须立刻做两个武BOT式机械动作',existing)).toBe(false);
    expect(isDistinctSecretMission('当看到有人点头，你必须立刻做两个武BOT式机械动作',existing)).toBe(true);
  });
  it('builds a concrete display-only ban and excludes already assigned content',()=>{
    const challenge=buildChallenge({gameId:'dont',mbti:'INFP',role:{...role,quote:'1'},playerCount:3});
    const next=buildChallenge({gameId:'dont',mbti:'INFP',role:{...role,quote:'1'},playerCount:3,excludedContents:[challenge.content]});
    expect(challenge.content).toMatch(/^[\u4e00-\u9fa5\d]{2,12}$/);
    expect(challenge.content).not.toBe('1');
    expect(next.content).not.toBe(challenge.content);
  });
});
