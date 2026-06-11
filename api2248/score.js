// POST /api/score — registra/melhora a pontuação do jogador
// Body: { id, nick, score } · País detectado pelo header do Vercel.
import { Redis } from '@upstash/redis';
const redis = Redis.fromEnv();

export default async function handler(req, res){
  if(req.method !== 'POST') return res.status(405).json({ error: 'method' });

  const { id, nick, score } = req.body || {};

  // ── validação ──
  if(typeof id !== 'string' || !/^[A-Za-z0-9-]{8,40}$/.test(id))
    return res.status(400).json({ error: 'id' });
  const s = Number(score);
  if(!Number.isFinite(s) || s < 0 || s > 1e12 || Math.floor(s) !== s)
    return res.status(400).json({ error: 'score' });
  const cleanNick =
    String(nick || '').replace(/[<>&"'`]/g, '').trim().slice(0, 14) || 'Player';

  // país do jogador, resolvido pelo Vercel a partir do IP (grátis)
  const country = String(req.headers['x-vercel-ip-country'] || 'XX')
    .toUpperCase().slice(0, 2);

  // ── rate limit leve: 12 submits/min por jogador ──
  const rlKey = `rl:${id}`;
  const hits = await redis.incr(rlKey);
  if(hits === 1) await redis.expire(rlKey, 60);
  if(hits > 12) return res.status(429).json({ error: 'rate' });

  // ── grava: perfil + rankings (GT = só melhora, nunca piora) ──
  await Promise.all([
    redis.set(`p:${id}`, JSON.stringify({ n: cleanNick, c: country }),
              { ex: 60 * 60 * 24 * 180 }),           // perfil expira em 180d sem jogar
    redis.zadd('lb:global',       { gt: true }, { score: s, member: id }),
    redis.zadd(`lb:c:${country}`, { gt: true }, { score: s, member: id }),
  ]);

  return res.status(200).json({ ok: true, country });
}
