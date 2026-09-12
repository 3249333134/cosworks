import type { Server as HttpServer, IncomingMessage } from 'node:http';
import { WebSocketServer, WebSocket } from 'ws';
import { readSession } from './auth.js';
import { markOnline } from './cache.js';

interface Client { socket:WebSocket; accountId:string; roomCode:string }
const clients = new Set<Client>();

export function attachWebSocket(server:HttpServer){
  const wss=new WebSocketServer({noServer:true});
  server.on('upgrade',(request,socket,head)=>{const url=new URL(request.url??'/',`http://${request.headers.host}`);if(url.pathname!=='/ws'){socket.destroy();return;}try{const token=url.searchParams.get('token')??readCookie(request,'rxj_session');if(!token)throw new Error('missing token');const auth=readSession(token);wss.handleUpgrade(request,socket,head,ws=>{const client:Client={socket:ws,accountId:auth.accountId,roomCode:url.searchParams.get('room')??''};clients.add(client);void markOnline(client.roomCode,client.accountId,true);ws.send(JSON.stringify({type:'connected',accountId:auth.accountId}));ws.on('close',()=>{clients.delete(client);void markOnline(client.roomCode,client.accountId,false);});});}catch{socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');socket.destroy();}});
  return wss;
}

function readCookie(request:IncomingMessage,name:string){const raw=request.headers.cookie??'';return raw.split(';').map(value=>value.trim().split('=')).find(([key])=>key===name)?.[1];}

export function broadcast(roomCode:string,event:unknown,targetAccountId?:string){const body=JSON.stringify(event);for(const client of clients){if(client.roomCode===roomCode&&(!targetAccountId||client.accountId===targetAccountId)&&client.socket.readyState===WebSocket.OPEN)client.socket.send(body);}}
