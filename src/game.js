export const WIDTH = 1000, HEIGHT = 680, BLOCK_COUNT = 99;
export const COOLDOWNS = { bar: [20, 25], block: [20, 30] };
export const MAX_BALLS = 128;
const clamp = (n, a, b) => Math.max(a, Math.min(b, n));
const ball = (x = WIDTH / 2, y = HEIGHT - 80, vx = 180) => ({ x, y, vx, vy: -310, r: 7 });

export function createGame(players, duration = 60, now = Date.now()) {
  const humans = players.filter(p => p.role === 'block');
  return {
    startedAt: now, remaining: duration, duration, elapsed: 0, winner: null,
    bar: { id: players.find(p => p.role === 'bar')?.id ?? null, x: 500, y: 625, w: 130, h: 14, cooldown: [0, 0] },
    blocks: Array.from({ length: BLOCK_COUNT }, (_, i) => ({
      id: humans[i]?.id ?? `cpu-${i}`, name: humans[i]?.name ?? 'CPU', cpu: !humans[i],
      color: humans[i]?.color ?? '#ffffff', x: 54 + (i % 11) * 89, y: 65 + Math.floor(i / 11) * 38,
      w: 46, h: 20, alive: true, ghost: 0, shield: 0, cooldown: [0, 0], phase: i * 2.4,
    })),
    balls: [{ ...ball(), id: 0 }], nextBallId: 1, bombs: [], destroyed: 0,
  };
}

export function useSkill(game, id, slot) {
  if (game.winner || ![0, 1].includes(slot)) return false;
  const isBar = game.bar.id === id;
  const entity = isBar ? game.bar : game.blocks.find(b => b.id === id && b.alive);
  if (!entity || entity.cooldown[slot] > 0) return false;
  if (isBar && slot === 0) {
    if (game.balls.length >= MAX_BALLS) return false;
    const copies = game.balls.slice(0, MAX_BALLS - game.balls.length).map(b => ({ ...b, id: game.nextBallId++, vx: -b.vx + (b.vx === 0 ? 120 : 0) }));
    game.balls.push(...copies);
  } else if (isBar) {
    const target = game.balls.find(b => b.y < 450) ?? game.balls[0];
    game.bombs.push({ x: clamp(target?.x ?? game.bar.x, 60, 940), y: clamp(target?.y ?? 240, 60, 430), r: 78, life: 4 });
  } else if (slot === 0) entity.ghost = 10;
  else entity.shield = 5;
  entity.cooldown[slot] = COOLDOWNS[isBar ? 'bar' : 'block'][slot];
  return true;
}

function intersectsCircle(b, c) {
  const x = clamp(c.x, b.x - b.w / 2, b.x + b.w / 2);
  const y = clamp(c.y, b.y - b.h / 2, b.y + b.h / 2);
  return (c.x - x) ** 2 + (c.y - y) ** 2 <= c.r ** 2;
}

export function tick(game, inputs = new Map(), dt = 1 / 60) {
  if (game.winner) return;
  game.elapsed += dt;
  game.remaining = Math.max(0, game.duration - game.elapsed);
  const bar = game.bar;
  bar.cooldown = bar.cooldown.map(c => Math.max(0, c - dt));
  const barInput = inputs.get(bar.id);
  if (bar.id && barInput) {
    bar.x = Number.isFinite(barInput.targetX) ? barInput.targetX : bar.x + barInput.x * 850 * dt;
  } else if (!bar.id) {
    const target = game.balls.filter(b => b.vy > 0).sort((a, b) => b.y - a.y)[0] ?? game.balls[0];
    if (target) bar.x += clamp(target.x - bar.x, -410 * dt, 410 * dt);
  }
  bar.x = clamp(bar.x, bar.w / 2, WIDTH - bar.w / 2);
  for (const b of game.blocks) {
    if (!b.alive) continue;
    b.cooldown = b.cooldown.map(c => Math.max(0, c - dt));
    b.ghost = Math.max(0, b.ghost - dt); b.shield = Math.max(0, b.shield - dt);
    const input = inputs.get(b.id);
    let dx = 0, dy = 0;
    if (b.cpu) {
      dx = Math.sin(game.elapsed * .8 + b.phase) * .45;
      dy = Math.cos(game.elapsed * .65 + b.phase) * .3;
      const threat = game.balls.find(v => Math.abs(v.x - b.x) < 75 && Math.abs(v.y - b.y) < 100);
      if (threat) dx = b.x >= threat.x ? 1 : -1;
    } else if (input) { dx = input.x; dy = input.y; }
    const length = Math.max(1, Math.hypot(dx, dy));
    const speed = (b.cpu ? 75 : 290) * (b.ghost > 0 ? 1.8 : 1);
    b.x = clamp(b.x + dx / length * speed * dt, b.w / 2 + 8, WIDTH - b.w / 2 - 8);
    b.y = clamp(b.y + dy / length * speed * dt, 30, 460);
  }
  function destroyBlock(b) {
    b.alive = false; game.destroyed++;
  }
  for (const bomb of game.bombs) {
    bomb.life -= dt;
    for (const b of game.blocks) if (b.alive && b.shield <= 0 && intersectsCircle(b, bomb)) destroyBlock(b);
  }
  game.bombs = game.bombs.filter(b => b.life > 0);
  for (const v of game.balls) {
    const prevX = v.x, prevY = v.y;
    v.x += v.vx * dt; v.y += v.vy * dt;
    if (v.x < v.r) { v.x = v.r; v.vx = Math.abs(v.vx); }
    if (v.x > WIDTH - v.r) { v.x = WIDTH - v.r; v.vx = -Math.abs(v.vx); }
    if (v.y < v.r) { v.y = v.r; v.vy = Math.abs(v.vy); }
    if (v.y > HEIGHT - v.r) { v.y = HEIGHT - v.r; v.vy = -Math.abs(v.vy); }
    if (v.vy > 0 && prevY + v.r <= bar.y - bar.h / 2 && v.y + v.r >= bar.y - bar.h / 2 && Math.abs(v.x - bar.x) <= bar.w / 2 + v.r) {
      const angle = clamp((v.x - bar.x) / (bar.w / 2), -.95, .95) * 1.05;
      v.vx = Math.sin(angle) * 390; v.vy = -Math.cos(angle) * 390; v.y = bar.y - bar.h / 2 - v.r;
    }
    for (const b of game.blocks) {
      if (!b.alive || !intersectsCircle(b, v)) continue;
      if (b.shield <= 0) destroyBlock(b);
      if (Math.abs(prevX - b.x) > b.w / 2 + v.r) v.vx *= -1;
      else v.vy *= -1;
      v.x = clamp(prevX, v.r, WIDTH - v.r); v.y = clamp(prevY, v.r, HEIGHT - v.r);
      break;
    }
  }
  if (game.destroyed === BLOCK_COUNT) game.winner = 'bar';
  else if (game.remaining <= 0) game.winner = 'block';
}
