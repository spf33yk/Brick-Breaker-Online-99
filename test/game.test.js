import test from 'node:test';
import assert from 'node:assert/strict';
import { createGame, tick, useSkill, MAX_BALLS } from '../src/game.js';
const players = [{ id:'bar',role:'bar',name:'バー',color:'#b8f36b' },{ id:'block',role:'block',name:'ブロック',color:'#a78bfa' }];
test('99 blocks, distinct human color, white CPU and designated bar',()=>{
  const g=createGame(players);assert.equal(g.blocks.length,99);assert.equal(g.blocks.filter(b=>b.cpu).length,98);assert.equal(g.blocks[0].color,'#a78bfa');assert.ok(g.blocks.slice(1).every(b=>b.color==='#ffffff'));assert.equal(g.bar.id,'bar');
});
test('shadow doubles balls and respects cooldown and safe maximum',()=>{
  const g=createGame(players);assert.equal(useSkill(g,'bar',0),true);assert.equal(g.balls.length,2);assert.equal(useSkill(g,'bar',0),false);
  for(let i=0;i<10;i++){g.bar.cooldown[0]=0;useSkill(g,'bar',0);}assert.equal(g.balls.length,MAX_BALLS);assert.equal(useSkill(g,'stranger',0),false);
});
test('ghost lasts ten seconds; hourglass lasts five and both have independent cooldowns',()=>{
  const g=createGame(players),b=g.blocks[0];assert.equal(useSkill(g,'block',0),true);assert.equal(b.ghost,10);assert.equal(useSkill(g,'block',1),true);assert.equal(b.shield,5);assert.deepEqual(b.cooldown,[20,30]);tick(g,new Map(),1/60);assert.ok(b.ghost<10&&b.shield<5);
});
test('bomb kills on contact except while invulnerable',()=>{
  const g=createGame(players), b=g.blocks[0];g.balls=[{x:b.x,y:b.y,r:7,vx:0,vy:0}];useSkill(g,'block',1);useSkill(g,'bar',1);tick(g,new Map(),1/120);assert.equal(b.alive,true);b.shield=0;tick(g,new Map(),1/120);assert.equal(b.alive,false);assert.ok(g.destroyed>=1);
});
test('bar wins when all 99 blocks die; block wins timeout; finished state stays stable',()=>{
  const g=createGame(players,1);g.destroyed=99;g.blocks.forEach(b=>b.alive=false);tick(g);assert.equal(g.winner,'bar');const elapsed=g.elapsed;tick(g);assert.equal(g.elapsed,elapsed);
  const other=createGame(players,1);other.elapsed=.999;tick(other);assert.equal(other.winner,'block');assert.equal(other.remaining,0);
});
test('fallen balls respawn and movement is bounded',()=>{
  const g=createGame(players);g.balls.forEach(b=>b.y=900);tick(g,new Map([['bar',{targetX:-900,x:0,y:0}],['block',{x:1,y:-1}]]));assert.equal(g.balls.length,1);assert.equal(g.bar.x,g.bar.w/2);assert.ok(g.blocks[0].x>54);assert.ok(g.blocks[0].y<65);
});
test('dead blocks cannot move or activate skills',()=>{
  const g=createGame(players),b=g.blocks[0];b.alive=false;const x=b.x;tick(g,new Map([['block',{x:1,y:0}]]));assert.equal(b.x,x);assert.equal(useSkill(g,'block',1),false);
});
test('paddle reflects descending balls upwards',()=>{
  const g=createGame(players);g.balls=[{x:500,y:610,vx:0,vy:310,r:7}];tick(g);assert.ok(g.balls[0].vy<0);
});
