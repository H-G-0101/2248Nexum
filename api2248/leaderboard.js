// GET /api/leaderboard?scope=global|country&id=<playerId>
// Retorna top 50 + posição do jogador. País do solicitante vem do header.
import { Redis } from '@upstash/redis';
const redis = Redis.fromEnv();

export default async function handler(req, res){
  const scope = req.query.scope === 'country' ? 'country' : 'global';
  const myCountry = String(req.headers['x-vercel-ip-country'] || 'XX')
    .toUpperCase().slice(0, 2);
  const key = scope === 'country' ? `lb:c:${myCountry}` : 'lb:global';
  const id  = typeof req.query.id === 'string' &&
              /^[A-Za-z0-9-]{8,40}$/.test(req.query.id) ? req.query.id : null;

  // top 50 (zrange rev + withScores → [{member, score}, ...] normalizado)
  const raw = await redis.zrange(key, 0, 49, { rev: true, withScores: true });
  const entries = [];
  if(Array.isArray(raw) && raw.length){
    if(typeof raw[0] === 'object' && raw[0] !== null && 'member' in raw[0]){
      for(const e of raw) entries.push({ member: String(e.member), score: Number(e.score) });
    } else {
      for(let i = 0; i < raw.length; i += 2)
        entries.push({ member: String(raw[i]), score: Number(raw[i + 1]) });
    }
  }

  // perfis (nick + país) em lote
  let profs = [];
  if(entries.length){
    profs = await redis.mget(...entries.map(e => `p:${e.member}`));
  }
  const rows = entries.map((e, i) => {
    let p = {};
    try{ p = typeof profs[i] === 'string' ? JSON.parse(profs[i]) : (profs[i] || {}); }catch(_){}
    return {
      rank: i + 1,
      id: e.member,
      nick: p.n || 'Player',
      country: p.c || 'XX',
      score: e.score
    };
  });

  // posição do solicitante (mesmo fora do top 50)
  let me = null;
  if(id){
    const [r, sc] = await Promise.all([
      redis.zrank(key, id, { rev: true }),
      redis.zscore(key, id)
    ]);
    if(r !== null && r !== undefined && sc !== null)
      me = { rank: Number(r) + 1, score: Number(sc) };
  }

  // cache de borda: 30s — corta drasticamente os comandos do Upstash
  res.setHeader('Cache-Control', 's-maxage=30, stale-while-revalidate=60');
  return res.status(200).json({ scope, country: myCountry, rows, me });
}
