const express = require('express');
const mercadopago = require('mercadopago');
const cors = require('cors');
const app = express();
app.use(cors());
app.use(express.json());

mercadopago.configure({
  access_token: 'APP_USR-3004423024092699-052221-2029d208aa933a676b8f30e45bc865ed-3421215970'
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