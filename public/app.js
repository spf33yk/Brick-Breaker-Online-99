const $ = id => document.getElementById(id);
const canvas = $('arena'), ctx = canvas.getContext('2d');
let role = 'bar', color = '#b8f36b', token = null, myId = null, room = null, events = null, connected = false, busy = false;
let pointerX, keys = new Set(), touchKeys = new Set(), sending = false, lastInput = '', lastSent = 0;
const skillData = { bar: [['⧉','影分身','ボールが2倍',20],['✹','ボム','接触した敵を撃破',25]], block: [['♧','ゴースト','10秒間スピードUP',20],['◷','砂時計','5秒間ダメージ無効',30]] };
const previewBlocks = Array.from({length:99},(_,i)=>({x:54+i%11*89,y:65+Math.floor(i/11)*38,w:46,h:20,alive:true,cpu:true,color:'#fff'}));
function status(message = '') { $('status').textContent = message; }
async function api(action, data = {}) {
  const res = await fetch(`/api/${action}`, { method:'POST', headers:{'Content-Type':'application/json', ...(token?{Authorization:`Bearer ${token}`}:{})}, body:JSON.stringify(data), signal:AbortSignal.timeout(8000) });
  const result = await res.json();
  if (!res.ok) throw new Error(result.error || '通信に失敗しました。');
  return result;
}
async function action(fn) {
  if (busy) return;
  busy = true; $('createRoom').disabled = $('joinRoom').disabled = true; status();
  try { await fn(); } catch(e) { status(e.name === 'TimeoutError' ? 'サーバーに接続できません。時間をおいて再試行してください。' : e.message); }
  finally { busy = false; $('createRoom').disabled = $('joinRoom').disabled = false; }
}
function profile() { return { name:$('name').value, role, color }; }
function updateTeam() {
  document.body.classList.toggle('block-role',role==='block');
  for (const r of ['bar','block']) { $(`${r}Team`).classList.toggle('selected',role===r); $(`${r}Team`).setAttribute('aria-pressed',String(role===r)); }
  document.querySelectorAll('.swatch').forEach(b=> { const active=b.dataset.color===color;b.classList.toggle('active',active);b.setAttribute('aria-pressed',String(active)); });
  skillData[role].forEach(([icon,name,desc,ct],i)=>{ $(`skillIcon${i}`).textContent=icon;$(`skillName${i}`).textContent=name;$(`skillDesc${i}`).textContent=desc;$(`cooldown${i}`).textContent=`${ct}s CT`; });
}
async function changeProfile(changes) {
  if (room && room.phase!=='lobby') return;
  const before={role,color}; role=changes.role??role; color=changes.color??color; updateTeam();
  if (room) try { await api('profile',profile()); status(); } catch(e) { role=before.role;color=before.color;updateTeam();status(e.message); }
}
$('barTeam').onclick=()=>action(()=>changeProfile({role:'bar'}));
$('blockTeam').onclick=()=>action(()=>changeProfile({role:'block'}));
$('colors').onclick=e=>{ const b=e.target.closest('[data-color]');if(b) action(()=>changeProfile({color:b.dataset.color})); };
$('name').onchange=()=>action(()=>changeProfile({}));
function setConnection(ok, message) { connected=ok; $('connection').textContent=`● ${message}`; $('connection').classList.toggle('online',ok); }
function attachEvents() {
  events?.close(); events=new EventSource(`/events?token=${encodeURIComponent(token)}`);
  events.onopen=()=>{setConnection(true,'オンライン');status();renderUI();};
  events.onmessage=e=>{setConnection(true,'オンライン');room=JSON.parse(e.data); renderUI();};
  events.onerror=()=>{setConnection(false,'再接続中');renderUI();status('接続が途切れました。自動再接続中です。15秒を超えた場合は退出して再参加してください。');};
}
async function enter(type) {
  const result=await api(type,{...profile(),code:$('joinCode').value.trim(),duration:Number($('duration').value)});
  token=result.token;myId=result.id;room=result.room;attachEvents();renderUI();
}
$('createRoom').onclick=()=>action(()=>enter('create'));
$('joinForm').onsubmit=e=>{e.preventDefault();action(()=>enter('join'));};
$('startGame').onclick=()=>action(()=>api('start'));
$('rematch').onclick=()=>action(()=>api('lobby'));
$('leaveRoom').onclick=()=>action(async()=>{ try{await api('leave');}finally{events?.close();events=null;token=null;myId=null;room=null;keys.clear();touchKeys.clear();pointerX=undefined;renderUI();status();checkHealth();} });
$('copyCode').onclick=()=>action(async()=>{const url=new URL(location.href);url.searchParams.set('room',room.code);try{await navigator.clipboard.writeText(url.href);status('招待リンクをコピーしました。');}catch{status(`ルームコード ${room.code} を友達に伝えてください。`);}});
$('duration').onchange=()=>{if(!room)$('timer').textContent=formatTime(Number($('duration').value));};
$('helpButton').onclick=()=>$('help').showModal();$('closeHelp').onclick=()=>$('help').close();
function formatTime(seconds){const n=Math.ceil(Math.max(0,seconds));return `${String(Math.floor(n/60)).padStart(2,'0')}:${String(n%60).padStart(2,'0')}`;}
let lastRoster='';
function renderUI() {
  const playing=room?.phase==='playing', inRoom=!!room, finished=room?.phase==='finished';
  document.body.classList.toggle('playing',playing);
  $('entryActions').classList.toggle('hidden',inRoom);$('roomActions').classList.toggle('hidden',!inRoom);
  $('profileFields').disabled=playing||finished;
  $('phaseBadge').textContent=playing?'LIVE':finished?'FINISHED':inRoom?'LOBBY':'PREVIEW';
  $('roomLabel').textContent=inRoom?`ROOM — ${room.code}`:'01 — READY TO PLAY';
  $('setupEyebrow').textContent=inRoom?'YOUR ROOM':'GET READY';$('setupTitle').textContent=inRoom?'チームロビー':'バトルに参加';
  $('setupDescription').textContent=inRoom?'コードを共有して、友達を招待しよう。':'あなたは、崩す側？ 逃げる側？';
  $('arenaCaption').classList.toggle('hidden',playing||finished);
  $('result').classList.toggle('hidden',!finished);
  if(inRoom){
    const host=room.host===myId;
    $('roomCode').textContent=room.code;
    const humans=room.players.filter(p=>p.role==='block').length;
    $('roomPlayers').textContent=`バー ${room.players.some(p=>p.role==='bar')?'1人':'CPU'} · ブロック ${humans}人 + CPU ${99-humans}体`;
    const rosterKey=JSON.stringify(room.players)+room.host;
    if(rosterKey!==lastRoster){lastRoster=rosterKey;$('roster').replaceChildren(...room.players.map(p=>{const s=document.createElement('span');s.textContent=`${p.role==='bar'?'━':'▪'} ${p.name}${p.id===room.host?' ♛':''}${p.id===myId?' (YOU)':''}`;s.style.color=p.color;return s;}));}
    $('startGame').disabled=!host||playing||finished||!connected;
    $('startGame').textContent=playing?'対戦中':finished?'対戦終了':host?'バトル開始 ↗':'ホストの開始を待っています';
    if(finished){const win=room.game.winner;$('resultTitle').textContent=win==='bar'?'バーチームの勝利！':'ブロックチームの勝利！';$('resultDetail').textContent=win==='bar'?'99体のブロックをすべて撃破。':`${99-room.game.destroyed}体のブロックが逃げ切りました。`;$('rematch').disabled=!host;$('rematch').textContent=host?'ロビーに戻る ↗':'ホストの操作を待っています';}
  }
  const g=room?.game;
  $('alive').innerHTML=`${g?99-g.destroyed:99}<small> / 99</small>`;$('destroyed').textContent=String(g?.destroyed??0).padStart(2,'0');$('timer').textContent=formatTime(g?.remaining??Number($('duration').value));
  const entity=role==='bar'?g?.bar:g?.blocks.find(b=>b.id===myId);
  const alive=role==='bar'||entity?.alive;
  $('arenaHint').textContent=playing?(alive?(role==='bar'?'マウス / ← → で移動 · Q / E スキル':'WASD / 矢印キーで移動 · Q / E スキル'):'撃破されました · 仲間の戦いを観戦中'):'ブロックエリアから逃げ切ろう';
  for(let i=0;i<2;i++){const cd=entity?.cooldown[i]??0;$(`skill${i}`).disabled=!playing||!alive||cd>0||!connected;$(`cooldown${i}`).textContent=playing?(cd>0?`${cd.toFixed(1)}s`:'READY'): `${skillData[role][i][3]}s CT`;}
}
async function cast(slot){if($(`skill${slot}`).disabled)return;try{await api('skill',{slot});}catch(e){status(e.message);}}
$('skill0').onclick=()=>cast(0);$('skill1').onclick=()=>cast(1);
const keyDirection={ArrowLeft:'left',a:'left',ArrowRight:'right',d:'right',ArrowUp:'up',w:'up',ArrowDown:'down',s:'down'};
window.addEventListener('keydown',e=>{if(['INPUT','SELECT','TEXTAREA'].includes(e.target.tagName)||$('help').open)return;const key=e.key.length===1?e.key.toLowerCase():e.key;if(keyDirection[key]){if(room?.phase==='playing')e.preventDefault();keys.add(keyDirection[key]);pointerX=undefined;}if(!e.repeat&&key==='q')cast(0);if(!e.repeat&&key==='e')cast(1);});
window.addEventListener('keyup',e=>{const key=e.key.length===1?e.key.toLowerCase():e.key;keys.delete(keyDirection[key]);});
function resetInput(){keys.clear();touchKeys.clear();pointerX=undefined;}
window.addEventListener('blur',resetInput);document.addEventListener('visibilitychange',()=>{if(document.hidden)resetInput();});
canvas.addEventListener('pointermove',e=>{if(role==='bar'){const r=canvas.getBoundingClientRect();pointerX=(e.clientX-r.left)/r.width*1000;}});
canvas.addEventListener('pointerdown',e=>{canvas.focus();canvas.setPointerCapture(e.pointerId);if(role==='bar'){const r=canvas.getBoundingClientRect();pointerX=(e.clientX-r.left)/r.width*1000;}});
document.querySelectorAll('[data-dir]').forEach(b=>{b.onpointerdown=e=>{e.preventDefault();b.setPointerCapture(e.pointerId);touchKeys.add(b.dataset.dir);pointerX=undefined;};b.onpointerup=b.onpointercancel=b.onlostpointercapture=()=>touchKeys.delete(b.dataset.dir);});
setInterval(async()=>{if(room?.phase!=='playing'||!connected||sending||document.hidden)return;const down=d=>keys.has(d)||touchKeys.has(d);const input={x:Number(down('right'))-Number(down('left')),y:Number(down('down'))-Number(down('up')),...(role==='bar'&&pointerX!==undefined?{targetX:pointerX}:{})};const serialized=JSON.stringify(input);if(serialized===lastInput&&Date.now()-lastSent<300)return;lastInput=serialized;lastSent=Date.now();sending=true;try{await api('input',input);}catch{setConnection(false,'再接続中');}finally{sending=false;}},70);
function rounded(x,y,w,h,r){ctx.beginPath();ctx.roundRect(x,y,w,h,r);}
function draw(time){
  ctx.clearRect(0,0,1000,680);
  const g=room?.game;
  const blocks=g?.blocks??previewBlocks;
  ctx.strokeStyle='#64755230';ctx.setLineDash([5,9]);ctx.beginPath();ctx.moveTo(0,488);ctx.lineTo(1000,488);ctx.stroke();ctx.setLineDash([]);
  ctx.fillStyle='#64755270';ctx.font='9px monospace';ctx.textAlign='left';ctx.fillText('BLOCK ZONE',12,479);ctx.textAlign='right';ctx.fillText('SURVIVE THE COUNTDOWN',988,479);
  for(const b of blocks){if(!b.alive)continue;const self=b.id===myId;let c=b.cpu?'#dce3d5':b.color;
    if(!g&&[15,37,61,83].includes(blocks.indexOf(b)))c=['#a78bfa','#b8f36b','#66d9ef','#fb967b'][[15,37,61,83].indexOf(blocks.indexOf(b))];
    ctx.globalAlpha=b.ghost>0?.5:1;ctx.fillStyle=c;ctx.shadowColor=c;ctx.shadowBlur=self?15:0;rounded(b.x-b.w/2,b.y-b.h/2,b.w,b.h,3);ctx.fill();ctx.shadowBlur=0;ctx.globalAlpha=1;
    ctx.fillStyle='#ffffff35';ctx.fillRect(b.x-b.w/2+3,b.y-b.h/2+2,b.w-6,2);
    if(b.shield>0||self){ctx.strokeStyle=b.shield>0?'#f3cf6b':b.color;ctx.lineWidth=b.shield>0?3:1;rounded(b.x-b.w/2-5,b.y-b.h/2-5,b.w+10,b.h+10,5);ctx.stroke();}
    if(self){ctx.fillStyle=c;ctx.font='bold 10px monospace';ctx.textAlign='center';ctx.fillText('YOU',b.x,b.y-21);}
  }
  const balls=g?.balls??[{x:520+Math.sin(time/1600)*110,y:510+Math.cos(time/1800)*26,r:7,vx:180,vy:-310}];
  for(const bomb of g?.bombs??[]){ctx.fillStyle='#fb967b25';ctx.strokeStyle='#fb967b';ctx.lineWidth=2;ctx.beginPath();ctx.arc(bomb.x,bomb.y,bomb.r*(.94+Math.sin(time/90)*.06),0,Math.PI*2);ctx.fill();ctx.stroke();ctx.fillStyle='#fb967b';ctx.font='26px sans-serif';ctx.textAlign='center';ctx.fillText('✹',bomb.x,bomb.y+9);}
  for(const b of balls){ctx.beginPath();ctx.strokeStyle='#b8f36b30';ctx.lineWidth=5;ctx.moveTo(b.x,b.y);ctx.lineTo(b.x-b.vx*.065,b.y-b.vy*.065);ctx.stroke();ctx.beginPath();ctx.fillStyle='#eaffd2';ctx.shadowColor='#b8f36b';ctx.shadowBlur=18;ctx.arc(b.x,b.y,b.r,0,Math.PI*2);ctx.fill();ctx.shadowBlur=0;}
  const bar=g?.bar??{x:500,y:625,w:130,h:14};
  const barColor=room?.players.find(p=>p.role==='bar')?.color??'#b8f36b';ctx.fillStyle=barColor;ctx.shadowColor=barColor;ctx.shadowBlur=20;rounded(bar.x-bar.w/2,bar.y-bar.h/2,bar.w,bar.h,5);ctx.fill();ctx.shadowBlur=0;
  ctx.fillStyle='#4b593f';ctx.font='9px monospace';ctx.textAlign='center';ctx.fillText(bar.id===myId&&myId?'YOU':g&&!bar.id?'CPU BAR':'BAR TEAM',bar.x,bar.y+29);
  requestAnimationFrame(draw);
}
async function checkHealth(){try{const r=await fetch('/health');setConnection(r.ok,r.ok?'サーバー接続済み':'サーバー未接続');}catch{setConnection(false,'サーバー未接続');}}
const invite=new URL(location.href).searchParams.get('room');if(invite){$('joinCode').value=invite.toUpperCase().slice(0,6);role='block';color='#a78bfa';status('招待ルームのコードを入力しました。名前とチームを選んで参加してください。');}
updateTeam();renderUI();checkHealth();requestAnimationFrame(draw);
