const express = require('express');
const mercadopago = require('mercadopago');

const app = express();
app.use(express.json());

mercadopago.configure({
  access_token: 'SEU_TOKEN_AQUI'
});

app.post('/criar-pix', async (req, res) => {
  const { valor, nome } = req.body;

  try {
    const pagamento = await mercadopago.payment.create({
      transaction_amount: Number(valor),
      description: "Vendinha",
      payment_method_id: "pix",
      payer: { email: "teste@test.com" },
      external_reference: nome
    });

    res.json({
      qr: pagamento.body.point_of_interaction.transaction_data.qr_code_base64
    });

  } catch (e) {
    console.log(e);
    res.status(500).send("Erro");
  }
});

app.listen(3000, () => console.log("rodando"));