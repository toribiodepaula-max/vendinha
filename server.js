const express = require('express');
const mercadopago = require('mercadopago');
const cors = require('cors');
const app = express();
app.use(cors());
app.use(express.json());

mercadopago.configure({
  access_token: 'APP_USR-5534248245087451-052221-107c6efad9e5f845bd87a2af3f4be26a-269570965'
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

app.listen(process.env.PORT || 3000, () => console.log("rodando"));