const express = require('express');
const mercadopago = require('mercadopago');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.json());

// ─── CONFIG ───────────────────────────────────────────────────
const MP_TOKEN = process.env.MP_TOKEN || 'APP_USR-5534248245087451-052221-107c6efad9e5f845bd87a2af3f4be26a-269570965';
const BASE_URL  = process.env.BASE_URL  || 'https://SEU-BACKEND'; // ex: https://vendinha.up.railway.app
const PIX_KEY   = process.env.PIX_KEY   || '';

mercadopago.configure({ access_token: MP_TOKEN });

// ─── BANCO EM MEMÓRIA (persiste enquanto servidor rodando) ─────
let db = {
  pessoas: [],
  produtos: [
    {nome:"FINI",           preco:1.5,  estoque:84, minimo:15},
    {nome:"TALENTO MINI",   preco:4.5,  estoque:30, minimo:8},
    {nome:"KITKAT GRANDE",  preco:5.0,  estoque:24, minimo:6},
    {nome:"SONHO DE VALSA", preco:3.5,  estoque:15, minimo:5},
    {nome:"TRENTO",         preco:4.0,  estoque:32, minimo:8},
    {nome:"TWIX MINI",      preco:2.5,  estoque:30, minimo:8},
    {nome:"MENTOS",         preco:3.0,  estoque:36, minimo:10},
    {nome:"CARIBE",         preco:3.0,  estoque:6,  minimo:4},
    {nome:"CROCANTE",       preco:3.0,  estoque:6,  minimo:4},
    {nome:"BARRINHA GOIABADA", preco:2.5, estoque:20, minimo:6},
    {nome:"TRIDENT",        preco:3.5,  estoque:21, minimo:6},
    {nome:"MINI KITKAT",    preco:2.5,  estoque:36, minimo:10},
    {nome:"CHOKITO",        preco:3.8,  estoque:30, minimo:8},
    {nome:"SNICKERS",       preco:3.0,  estoque:15, minimo:5},
    {nome:"HALLS",          preco:3.0,  estoque:21, minimo:6},
    {nome:"TORCIDA QUEIJO", preco:3.0,  estoque:26, minimo:8},
  ],
  compras: [],   // {id, pessoa, produto, qtd, valor, status:'pendente'|'pago'|'fiado', data, mp_id?}
  pix_recebidos: [],
  reposicoes: [],
  config: { pix_key: PIX_KEY }
};

// ─── HELPERS ──────────────────────────────────────────────────
function hoje() { return new Date().toISOString().slice(0,10); }
function uid()  { return Date.now().toString(36) + Math.random().toString(36).slice(2,6); }

// ─── PESSOAS ──────────────────────────────────────────────────
app.get('/pessoas', (req, res) => res.json(db.pessoas));

app.post('/pessoas', (req, res) => {
  const { nome } = req.body;
  if (!nome || !nome.trim()) return res.status(400).json({erro:'Nome obrigatório'});
  const nomeTrim = nome.trim();
  if (db.pessoas.find(p => p.nome.toLowerCase() === nomeTrim.toLowerCase()))
    return res.status(409).json({erro:'Já existe'});
  const p = { id: uid(), nome: nomeTrim };
  db.pessoas.push(p);
  res.json(p);
});

// ─── PRODUTOS ─────────────────────────────────────────────────
app.get('/produtos', (req, res) => res.json(db.produtos));

app.post('/produtos', (req, res) => {
  const { nome, preco, estoque, minimo } = req.body;
  if (!nome || !preco) return res.status(400).json({erro:'Dados incompletos'});
  const p = { nome: nome.trim().toUpperCase(), preco: +preco, estoque: +(estoque||0), minimo: +(minimo||5) };
  db.produtos.push(p);
  res.json(p);
});

app.put('/produtos/:nome/estoque', (req, res) => {
  const p = db.produtos.find(x => x.nome === decodeURIComponent(req.params.nome));
  if (!p) return res.status(404).json({erro:'Produto não encontrado'});
  if (req.body.estoque !== undefined) p.estoque = +req.body.estoque;
  if (req.body.preco   !== undefined) p.preco   = +req.body.preco;
  if (req.body.minimo  !== undefined) p.minimo  = +req.body.minimo;
  res.json(p);
});

// ─── COMPRAS (FIADO) ──────────────────────────────────────────
app.get('/compras', (req, res) => {
  const { pessoa } = req.query;
  res.json(pessoa ? db.compras.filter(c => c.pessoa === pessoa) : db.compras);
});

app.post('/compras/fiado', (req, res) => {
  const { pessoa, produto, qtd } = req.body;
  const prod = db.produtos.find(p => p.nome === produto);
  if (!prod) return res.status(404).json({erro:'Produto não encontrado'});
  const compra = {
    id: uid(), pessoa, produto, qtd: +qtd,
    valor: +(prod.preco * qtd).toFixed(2),
    status: 'fiado', data: hoje()
  };
  db.compras.push(compra);
  // Baixa estoque imediatamente
  prod.estoque = Math.max(0, prod.estoque - +qtd);
  res.json(compra);
});

app.post('/compras/:id/quitar', (req, res) => {
  const c = db.compras.find(x => x.id === req.params.id);
  if (!c) return res.status(404).json({erro:'Não encontrado'});
  c.status = 'pago';
  res.json(c);
});

// ─── CRIAR PIX (MERCADO PAGO) ─────────────────────────────────
app.post('/criar-pix', async (req, res) => {
  const { pessoa, produto, qtd } = req.body;
  const prod = db.produtos.find(p => p.nome === produto);
  if (!prod) return res.status(404).json({erro:'Produto não encontrado'});
  const valor = +(prod.preco * qtd).toFixed(2);

  try {
    const pagamento = await mercadopago.payment.create({
      transaction_amount: valor,
      description: `Vendinha - ${produto} x${qtd}`,
      payment_method_id: 'pix',
      payer: { email: 'vendinha@vendinha.com', first_name: pessoa },
      external_reference: JSON.stringify({ pessoa, produto, qtd, valor }),
      notification_url: `${BASE_URL}/webhook`
    });

    const td = pagamento.body.point_of_interaction.transaction_data;

    // Registra como pendente (aguardando pagamento)
    const compra = {
      id: uid(),
      mp_id: String(pagamento.body.id),
      pessoa, produto, qtd: +qtd, valor,
      status: 'pendente', data: hoje()
    };
    db.compras.push(compra);

    res.json({
      compra_id: compra.id,
      qr_base64: td.qr_code_base64,
      copia_cola: td.qr_code,
      valor
    });

  } catch (e) {
    console.error('ERRO PIX:', e.response?.data || e.message);
    res.status(500).json({ erro: 'Erro ao gerar Pix', detalhe: e.message });
  }
});

// ─── CRIAR PAGAMENTO CARTÃO ───────────────────────────────────
app.post('/criar-cartao', async (req, res) => {
  const { pessoa, produto, qtd, token, installments, payment_method_id, issuer_id } = req.body;
  const prod = db.produtos.find(p => p.nome === produto);
  if (!prod) return res.status(404).json({erro:'Produto não encontrado'});
  const valor = +(prod.preco * qtd).toFixed(2);

  try {
    const pagamento = await mercadopago.payment.create({
      transaction_amount: valor,
      description: `Vendinha - ${produto} x${qtd}`,
      token,
      installments: +installments || 1,
      payment_method_id,
      issuer_id,
      payer: { email: 'vendinha@vendinha.com' },
      external_reference: JSON.stringify({ pessoa, produto, qtd, valor }),
      notification_url: `${BASE_URL}/webhook`
    });

    const status = pagamento.body.status; // approved / in_process / rejected

    const compra = {
      id: uid(),
      mp_id: String(pagamento.body.id),
      pessoa, produto, qtd: +qtd, valor,
      status: status === 'approved' ? 'pago' : 'pendente',
      data: hoje()
    };
    db.compras.push(compra);

    if (status === 'approved') {
      prod.estoque = Math.max(0, prod.estoque - +qtd);
    }

    res.json({ status, compra_id: compra.id, valor });

  } catch (e) {
    console.error('ERRO CARTÃO:', e.response?.data || e.message);
    res.status(500).json({ erro: 'Erro no pagamento', detalhe: e.message });
  }
});

// ─── WEBHOOK ─────────────────────────────────────────────────
app.post('/webhook', async (req, res) => {
  res.sendStatus(200); // responde rápido pro MP
  try {
    if (req.body.type !== 'payment') return;
    const paymentId = req.body.data?.id;
    if (!paymentId) return;

    const payment = await mercadopago.payment.findById(paymentId);
    const body    = payment.body;

    if (body.status !== 'approved') return;

    const mp_id_str = String(paymentId);

    // Acha compra pelo mp_id
    const compra = db.compras.find(c => c.mp_id === mp_id_str);
    if (!compra || compra.status === 'pago') return;

    compra.status = 'pago';

    // Baixa estoque
    const prod = db.produtos.find(p => p.nome === compra.produto);
    if (prod) prod.estoque = Math.max(0, prod.estoque - compra.qtd);

    console.log(`✅ Pago: ${compra.pessoa} - ${compra.produto} x${compra.qtd} - R$${compra.valor}`);

  } catch (e) {
    console.error('Webhook erro:', e.message);
  }
});

// ─── PIX MANUAL (ADMIN) ───────────────────────────────────────
app.post('/pix-manual', (req, res) => {
  const { valor, pessoa, obs } = req.body;
  const entrada = { id: uid(), valor: +valor, pessoa: pessoa || null, obs: obs || '', data: hoje() };
  db.pix_recebidos.push(entrada);
  // Baixa dívidas fiado da pessoa se identificada
  if (pessoa) {
    let restante = +valor;
    db.compras.filter(c => c.pessoa === pessoa && c.status === 'fiado').forEach(c => {
      if (restante <= 0) return;
      if (restante >= c.valor) { c.status = 'pago'; restante -= c.valor; }
      else { c.valor = +(c.valor - restante).toFixed(2); restante = 0; }
    });
  }
  res.json(entrada);
});

// ─── REPOSIÇÃO ────────────────────────────────────────────────
app.post('/reposicao', (req, res) => {
  const { produto, qtd, valor } = req.body;
  const prod = db.produtos.find(p => p.nome === produto);
  if (prod) prod.estoque += +qtd;
  const rep = { id: uid(), produto, qtd: +qtd, valor: +valor, data: hoje() };
  db.reposicoes.push(rep);
  res.json(rep);
});

// ─── ADMIN GERAL ─────────────────────────────────────────────
app.get('/admin', (req, res) => res.json(db));

// ─── CONFIG ───────────────────────────────────────────────────
app.get('/config', (req, res) => res.json(db.config));
app.put('/config', (req, res) => {
  Object.assign(db.config, req.body);
  res.json(db.config);
});

// ─── STATIC ───────────────────────────────────────────────────
app.use(express.static('.'));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🍬 Vendinha rodando na porta ${PORT}`));
