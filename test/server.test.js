import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { setTimeout as delay } from 'node:timers/promises';

test('online rooms: join, synchronized events, capacity, authorization, start, skills and host transfer',async(t)=>{
  const port=34000+Math.floor(Math.random()*10000);
  const child=spawn(process.execPath,['server.js'],{env:{...process.env,PORT:String(port)},stdio:['ignore','pipe','pipe']});
  t.after(()=>child.kill());
  await Promise.race([once(child.stdout,'data'),delay(8000).then(()=>{throw new Error('Server did not start');})]);
  const base=`http://127.0.0.1:${port}`;
  async function api(action,data={},token){const res=await fetch(`${base}/api/${action}`,{method:'POST',headers:{'Content-Type':'application/json',...(token?{Authorization:`Bearer ${token}`}:{})},body:JSON.stringify(data)});return {status:res.status,body:await res.json()};}
  async function stream(token){const controller=new AbortController();const res=await fetch(`${base}/events?token=${token}`,{signal:controller.signal});assert.equal(res.status,200);const reader=res.body.getReader();let pending='';return {close(){controller.abort();},async next(predicate=()=>true){for(;;){const split=pending.indexOf('\n\n');if(split>=0){const event=pending.slice(0,split);pending=pending.slice(split+2);if(event.startsWith('data: ')){const state=JSON.parse(event.slice(6));if(predicate(state))return state;}continue;}const {value,done}=await reader.read();if(done)throw new Error('Stream ended');pending+=new TextDecoder().decode(value);}}};}
  const created=await api('create',{name:'Host',role:'bar',duration:120});assert.equal(created.status,200);const host=created.body;
  const hs=await stream(host.token);t.after(()=>hs.close());assert.equal((await hs.next()).code,host.room.code);
  const joined=await api('join',{name:'Guest',role:'block',code:host.room.code,color:'#66d9ef'});assert.equal(joined.status,200);const guest=joined.body;
  const gs=await stream(guest.token);t.after(()=>gs.close());assert.equal((await gs.next()).players.length,2);
  assert.equal((await api('join',{role:'bar',code:host.room.code})).status,400);
  assert.equal((await api('start',{},guest.token)).status,400);
  assert.equal((await api('start')).status,401);
  assert.equal((await api('profile',{name:'Guest',role:'block',color:'#fb967b'},guest.token)).status,200);
  assert.equal((await api('start',{},host.token)).status,200);
  const [a,b]=await Promise.all([hs.next(s=>s.phase==='playing'),gs.next(s=>s.phase==='playing')]);assert.equal(a.game.startedAt,b.game.startedAt);assert.equal(b.game.blocks[0].color,'#fb967b');assert.equal(b.game.blocks.length,99);
  assert.equal((await api('join',{role:'block',code:host.room.code})).status,400);
  assert.equal((await api('profile',{role:'block'},host.token)).status,400);
  assert.equal((await api('skill',{slot:0},host.token)).status,200);assert.equal((await api('skill',{slot:0},host.token)).status,400);
  const state=await gs.next(s=>s.game.balls.length===2);assert.equal(state.game.balls.length,2);
  assert.equal((await api('skill',{slot:1,x:123,y:234},host.token)).status,200);const bombState=await hs.next(s=>s.game.bombs.length===1);assert.equal(bombState.game.bombs[0].x,123);assert.equal(bombState.game.bombs[0].y,234);assert.equal(bombState.game.bombs[0].r,90);
  assert.equal((await api('leave',{},host.token)).status,200);
  const transfer=await gs.next(s=>s.host===guest.id);assert.equal(transfer.game.bar.id,null);assert.equal(transfer.players.length,1);
  assert.equal((await api('leave',{},guest.token)).status,200);assert.equal((await fetch(`${base}/health`).then(r=>r.json())).rooms,0);
  const origin=await fetch(`${base}/api/create`,{method:'POST',headers:{'Content-Type':'application/json',Origin:'https://other.example'},body:'{}'});assert.equal(origin.status,403);
  const capacityHost=(await api('create',{name:'Capacity',role:'bar'})).body;
  for(let i=0;i<99;i++) assert.equal((await api('join',{name:`Player ${i}`,role:'block',code:capacityHost.room.code})).status,200);
  assert.equal((await api('join',{role:'block',code:capacityHost.room.code})).status,400);
  await api('start',{},capacityHost.token);
  const cs=await stream(capacityHost.token);t.after(()=>cs.close());
  const full=await cs.next();assert.equal(full.players.length,100);assert.equal(full.game.blocks.filter(b=>!b.cpu).length,99);
});
