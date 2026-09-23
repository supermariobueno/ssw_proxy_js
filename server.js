require('dotenv').config();
const express = require('express');
const axios = require('axios');
const app = express();

// Configura o Express para aceitar XML e textos puros de forma amigável
app.use(express.text({ type: ['*/xml', 'text/xml', 'application/xml'], limit: '10mb' }));
app.use(express.json({ limit: '10mb' }));

// ---- CONFIGURAÇÃO DE URLs ----
const URL_WEBSERVICE_ATUAL = process.env.URL_WEBSERVICE_ATUAL; 
const URL_WEBSERVICE_SUL   = process.env.URL_WEBSERVICE_SUL; 
const PROXY_TOKEN          = process.env.PROXY_TOKEN;
const ESTADOS_SUL = ['PR', 'SC', 'RS'];

// ---- MIDDLEWARE DE SEGURANÇA ----
app.use('/webhook-ssw', (req, res, next) => {
    // Pega o token enviado na URL (ex: ?token=...)
    const tokenRecebido = req.query.token;

    if (!tokenRecebido || tokenRecebido !== PROXY_TOKEN) {
        console.log('⚠️ Tentativa de acesso bloqueada: Token inválido ou ausente.');
        return res.status(401).send({ erro: 'Não autorizado. Token inválido.' });
    }

    // Se o token estiver correto, permite que o Express continue para a rota
    next();
});

app.post('/webhook-ssw', async (req, res) => {
    console.log('\n--- NOVA REQUISIÇÃO RECEBIDA DO SSW (XML/TEXTO) ---');
    
    // Responde 200 OK imediatamente para o SSW
    res.status(200).send({ status: 'Proxy recebeu o documento' });

    const payload = req.body;
    const contentType = req.headers['content-type'] || 'text/xml';
    
    // Se o payload vier vazio por algum motivo, interrompe
    if (!payload || Object.keys(payload).length === 0) {
        console.log('⚠️ Requisição recebida sem conteúdo no corpo (Body vazio).');
        return;
    }

    // 1. Envio para o WebService Atual (Portal) - Envia exatamente o que recebeu
    enviarDados(URL_WEBSERVICE_ATUAL, payload, contentType)
        .then(() => console.log('✅ Cópia enviada com sucesso para o WebService Atual.'))
        .catch(err => console.error('❌ Erro ao enviar para o WebService Atual:', err.message));

    // 2. Lógica de Filtragem da Região Sul baseada em tags XML
    let ehDaRegiaoSul = false;
    const stringXml = typeof payload === 'string' ? payload : JSON.stringify(payload);

    // Busca tags comuns de UF em XMLs de CT-e (ex: <UF>RS</UF>, <uf>sc</uf>, <UF>PR</UF>)
    ehDaRegiaoSul = ESTADOS_SUL.some(uf => {
        const tagMaiuscula = `<UF>${uf}</UF>`;
        const tagMinuscula = `<uf>${uf}</uf>`;
        return stringXml.includes(tagMaiuscula) || stringXml.includes(tagMinuscula);
    });

    // 3. Envio Condicional para o Sul
    if (ehDaRegiaoSul) {
        console.log('✈️ XML da Região Sul detectado! Repassando para o WebService do Sul...');
        
        // Garante que o Content-Type indo para o dev do Sul seja text/xml
        enviarDados(URL_WEBSERVICE_SUL, payload, 'text/xml')
            .then(() => console.log('✅ XML enviado com sucesso para o WebService do Sul!'))
            .catch(err => {
                console.error('❌ Erro no WebService do Sul:', err.message);
                if (err.response) {
                    console.error(`Status de resposta do erro: ${err.response.status}`);
                    console.error('Detalhes do erro do servidor do Sul:', err.response.data);
                }
            });
    } else {
        console.log('ℹ️ Documento fora da Região Sul. Envio para o Sul abortado.');
    }
});

async function enviarDados(url, data, contentType) {
    if (url.includes('SEU-CODIGO-AQUI')) return;
    
    // Configura os headers corretamente para o envio do XML
    await axios.post(url, data, {
        headers: { 
            'Content-Type': contentType,
            'Accept': 'application/xml, text/xml'
        }
    });
}

const PORT = 3000;
app.listen(PORT, () => {
    console.log(`🚀 Proxy de Testes XML rodando em http://localhost:${PORT}`);
});