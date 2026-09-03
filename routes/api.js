const express = require('express');
const pool = require('../db/pool');
const router = express.Router();

router.get('/modelos', async (req, res) => {
  const { rows } = await pool.query(
    `SELECT id, qtd_interruptores, nome, pagina_origem,
            (SELECT COUNT(*) FROM faixas f WHERE f.modelo_id = m.id) AS total_faixas,
            (SELECT MIN(k_inicio) FROM faixas f WHERE f.modelo_id = m.id) AS k_min,
            (SELECT MAX(k_fim) FROM faixas f WHERE f.modelo_id = m.id) AS k_max
     FROM modelos m ORDER BY qtd_interruptores, nome`
  );
  res.json(rows);
});

router.get('/buscar/k', async (req, res) => {
  const modeloId = parseInt(req.query.modelo, 10);
  const k = parseInt(req.query.k, 10);
  if (!modeloId || Number.isNaN(k)) {
    return res.status(400).json({ erro: 'parâmetros "modelo" e "k" são obrigatórios' });
  }
  const { rows } = await pool.query(
    `SELECT k_inicio, k_fim, interruptores_on
     FROM faixas
     WHERE modelo_id = $1 AND k_inicio <= $2 AND k_fim >= $2
     LIMIT 1`,
    [modeloId, k]
  );
  if (rows.length === 0) return res.status(404).json({ erro: 'K fora da faixa cadastrada para esse modelo' });
  res.json(rows[0]);
});

router.get('/buscar/interruptores', async (req, res) => {
  const modeloId = parseInt(req.query.modelo, 10);
  const on = String(req.query.on || '')
    .split(',')
    .map((n) => parseInt(n, 10))
    .filter((n) => !Number.isNaN(n))
    .sort((a, b) => a - b);
  if (!modeloId || on.length === 0) {
    return res.status(400).json({ erro: 'parâmetros "modelo" e "on" são obrigatórios' });
  }
  const { rows } = await pool.query(
    `SELECT k_inicio, k_fim, interruptores_on
     FROM faixas
     WHERE modelo_id = $1
       AND interruptores_on @> $2::smallint[]
       AND interruptores_on <@ $2::smallint[]
     LIMIT 1`,
    [modeloId, on]
  );
  if (rows.length === 0) return res.status(404).json({ erro: 'combinação de interruptores não encontrada para esse modelo' });
  res.json(rows[0]);
});

router.post('/modelos', async (req, res) => {
  const { qtd_interruptores, nome, pagina_origem } = req.body;
  if (!qtd_interruptores || !nome) {
    return res.status(400).json({ erro: '"qtd_interruptores" e "nome" são obrigatórios' });
  }
  const { rows } = await pool.query(
    `INSERT INTO modelos (qtd_interruptores, nome, pagina_origem)
     VALUES ($1, $2, $3)
     ON CONFLICT (qtd_interruptores, nome) DO UPDATE SET pagina_origem = EXCLUDED.pagina_origem
     RETURNING id`,
    [qtd_interruptores, nome, pagina_origem || null]
  );
  res.status(201).json({ id: rows[0].id });
});

router.post('/faixas/importar', async (req, res) => {
  const { modelo_id, faixas } = req.body;
  if (!modelo_id || !Array.isArray(faixas) || faixas.length === 0) {
    return res.status(400).json({ erro: '"modelo_id" e "faixas" (array) são obrigatórios' });
  }
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    let inseridas = 0;
    for (const [kIni, kFim, on] of faixas) {
      await client.query(
        `INSERT INTO faixas (modelo_id, k_inicio, k_fim, interruptores_on)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (modelo_id, k_inicio, k_fim) DO UPDATE SET interruptores_on = EXCLUDED.interruptores_on`,
        [modelo_id, kIni, kFim, on]
      );
      inseridas++;
    }
    await client.query('COMMIT');
    res.status(201).json({ importadas: inseridas });
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(500).json({ erro: err.message });
  } finally {
    client.release();
  }
});

module.exports = router;