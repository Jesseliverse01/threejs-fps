// Emberline: the single state store. Every mutable fact of a match lives here;
// modules read and write this object and nothing else is global state.
export const STEP = 1 / 60;
export const ROUND_TIME = 100;
export const FREEZE_TIME = 6;
export const PLANT_TIME = 3.0;
export const DEFUSE_TIME = 5.0;
export const FUSE_TIME = 35;
export const ROUNDS_TO_WIN = 5;
export const MAX_ROUNDS = 13;

export function createState() {
  return {
    time: 0,
    phase: 'menu', // menu | freeze | live | roundEnd | matchEnd
    phaseT: 0,
    round: 1,
    score: { ember: 0, cinder: 0 },
    timer: ROUND_TIME,
    money: 800,
    actors: [],
    player: null,
    bomb: {
      state: 'carried', // carried | dropped | planted | defused | detonated
      carrier: null,
      site: null,
      x: 0, z: 0,
      fuse: FUSE_TIME,
      plantProgress: 0,
      defuseProgress: 0,
      defuser: null,
      beepT: 0,
    },
    feed: [], // { text, t, good }
    noises: [], // { x, z, r, t }
    grenades: [],
    roundWinner: null,
    roundReason: '',
    matchWinner: null,
    stats: { shots: 0, hits: 0, kills: 0, deaths: 0, plants: 0, defuses: 0 },
    shake: 0,
    buyOpen: false,
  };
}

export function aliveOf(state, team) {
  let n = 0;
  for (const a of state.actors) if (a.alive && a.team === team) n++;
  return n;
}

export function feed(state, text, good) {
  state.feed.push({ text, t: state.time, good: !!good });
  if (state.feed.length > 6) state.feed.shift();
}

// A plain {x,z} distance helper shared by sim code (no allocation).
export function dist2(ax, az, bx, bz) {
  const dx = ax - bx, dz = az - bz;
  return dx * dx + dz * dz;
}
