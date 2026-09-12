import type { NextFunction, Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import { config } from './config.js';

export interface AuthUser { accountId:string }
declare global { namespace Express { interface Request { auth?:AuthUser } } }

export function signSession(accountId:string){return jwt.sign({accountId},config.jwtSecret,{expiresIn:config.jwtExpiresIn as jwt.SignOptions['expiresIn']});}
export function readSession(token:string){return jwt.verify(token,config.jwtSecret) as AuthUser;}
export function requireAuth(req:Request,res:Response,next:NextFunction){try{const bearer=req.headers.authorization?.replace(/^Bearer\s+/,'');const token=bearer||req.cookies?.rxj_session;if(!token)return res.status(401).json({ok:false,error:'请先登录'});req.auth=readSession(token);next();}catch{return res.status(401).json({ok:false,error:'登录已失效，请重新登录'});}}
