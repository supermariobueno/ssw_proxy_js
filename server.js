require('dotenv').config();

const express = require('express');
const axios = require('axios');
const crypto = require('crypto');

const app = express();

const PORT = Number(process.env.PORT || 3000);
const BODY_LIMIT = process.env.BODY_LIMIT || '10mb';

const URL_WEBSERVICE_ATUAL = process.env.URL_WEBSERVICE_ATUAL;
const URL_WEBSERVICE_SUL = process.env.URL_WEBSERVICE_SUL;
const PROXY_TOKEN = process.env.PROXY_TOKEN;

const ESTADOS_SUL = new Set(['PR', 'SC', 'RS']);

function validarConfiguracao() {
    const configuracoesObrigatorias = {
        URL_WEBSERVICE_ATUAL,
        URL_WEBSERVICE_SUL,
        PROXY_TOKEN
    };

    for (const [nome, valor] of Object.entries(configuracoesObrigatorias)) {
        if (!valor) {
            throw new Error(`Variável de ambiente obrigatória ausente: ${nome}`);
        }
    }

    for (const [nome, valor] of Object.entries({
        URL_WEBSERVICE_ATUAL,
        URL_WEBSERVICE_SUL
    })) {
        let url;

        try {
            url = new URL(valor);
        } catch {
            throw new Error(`${nome} não contém uma URL válida`);
        }

        if (!['http:', 'https:'].includes(url.protocol)) {
            throw new Error(`${nome} deve usar HTTP ou HTTPS`);
        }
    }

    if (PROXY_TOKEN.length < 16) {
        throw new Error('PROXY_TOKEN deve possuir pelo menos 16 caracteres');
    }
}

validarConfiguracao();

app.use(express.text({
    type: ['application/xml', 'text/xml', '*/xml'],
    limit: BODY_LIMIT
}));

app.use(express.json({
    limit: BODY_LIMIT
}));

function tokensIguais(tokenRecebido, tokenEsperado) {
    if (
        typeof tokenRecebido !== 'string' ||
        typeof tokenEsperado !== 'string'
    ) {
        return false;
    }

    const recebido = Buffer.from(tokenRecebido);
    const esperado = Buffer.from(tokenEsperado);

    if (recebido.length !== esperado.length) {
        return false;
    }

    return crypto.timingSafeEqual(recebido, esperado);
}

function obterToken(req) {
    // O ideal é usar Authorization: Bearer <token>
    const authorization = req.headers.authorization;

    if (authorization && authorization.startsWith('Bearer ')) {
        return authorization.slice('Bearer '.length);
    }

    // Mantido apenas para compatibilidade com clientes antigos.
    return req.query.token;
}

app.use('/webhook-ssw', (req, res, next) => {
    const tokenRecebido = obterToken(req);

    if (!tokensIguais(tokenRecebido, PROXY_TOKEN)) {
        console.warn('Tentativa de acesso bloqueada: token inválido ou ausente');
        return res.status(401).json({
            erro: 'Não autorizado'
        });
    }

    next();
});

function ehBodyValido(payload) {
    if (payload === null || payload === undefined) {
        return false;
    }

    if (typeof payload === 'string') {
        return payload.trim().length > 0;
    }

    if (typeof payload === 'object') {
        return Object.keys(payload).length > 0;
    }

    return false;
}

function detectarUfSul(payload) {
    const texto = typeof payload === 'string'
        ? payload
        : JSON.stringify(payload);

    /*
     * Compatível com:
     * <UF>RS</UF>
     * <uf> sc </uf>
     * <nfe:UF>PR</nfe:UF>
     *
     * Para XML complexo, o ideal é usar um parser XML.
     */
    const regexUf = /<(?:[\w-]+:)?uf>\s*(PR|SC|RS)\s*<\/(?:[\w-]+:)?uf>/i;

    return regexUf.test(texto);
}

function esperar(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

async function enviarDados(url, data, contentType, nomeDestino) {
    if (!url) {
        throw new Error(`URL não configurada para ${nomeDestino}`);
    }

    let ultimoErro;

    for (let tentativa = 1; tentativa <= 3; tentativa++) {
        try {
            const resposta = await axios.post(url, data, {
                timeout: 15_000,
                maxContentLength: 10 * 1024 * 1024,
                maxBodyLength: 10 * 1024 * 1024,
                headers: {
                    'Content-Type': contentType,
                    'Accept': 'application/xml, text/xml'
                },
                validateStatus: status => status >= 200 && status < 300
            });

            console.info(
                `[${nomeDestino}] Documento encaminhado com sucesso`,
                {
                    status: resposta.status,
                    tentativa
                }
            );

            return resposta;
        } catch (erro) {
            ultimoErro = erro;

            const status = erro.response?.status;
            const erroTemporario =
                !status ||
                status === 408 ||
                status === 429 ||
                status >= 500;

            console.error(
                `[${nomeDestino}] Falha na tentativa ${tentativa}`,
                {
                    status,
                    mensagem: erro.message
                }
            );

            if (!erroTemporario || tentativa === 3) {
                break;
            }

            await esperar(500 * tentativa);
        }
    }

    throw new Error(
        `Não foi possível enviar para ${nomeDestino}: ${ultimoErro.message}`
    );
}

app.post('/webhook-ssw', async (req, res) => {
    const payload = req.body;
    const contentType = req.headers['content-type'] || 'text/xml';

    if (!ehBodyValido(payload)) {
        return res.status(400).json({
            erro: 'O corpo da requisição está vazio'
        });
    }

    const ehSul = detectarUfSul(payload);
    const envios = [
        enviarDados(
            URL_WEBSERVICE_ATUAL,
            payload,
            contentType,
            'WebService Atual'
        )
    ];

    if (ehSul) {
        envios.push(
            enviarDados(
                URL_WEBSERVICE_SUL,
                payload,
                'text/xml',
                'WebService Sul'
            )
        );
    }

    const resultados = await Promise.allSettled(envios);

    const falhas = resultados.filter(
        resultado => resultado.status === 'rejected'
    );

    if (falhas.length > 0) {
        /*
         * Retornar erro permite que o sistema de origem tente reenviar.
         * Isso é mais seguro do que responder 200 e perder o documento.
         */
        return res.status(502).json({
            erro: 'Falha ao encaminhar o documento',
            destinosComFalha: falhas.length
        });
    }

    return res.status(200).json({
        status: 'Documento recebido e encaminhado',
        enviadoParaSul: ehSul
    });
});

app.use((erro, req, res, next) => {
    if (erro.type === 'entity.too.large') {
        return res.status(413).json({
            erro: 'Payload excede o tamanho máximo permitido'
        });
    }

    console.error('Erro não tratado:', erro);

    return res.status(500).json({
        erro: 'Erro interno do proxy'
    });
});

const servidor = app.listen(PORT, () => {
    console.info(`Proxy XML iniciado na porta ${PORT}`);
});

function encerrar(signal) {
    console.info(`${signal} recebido. Encerrando servidor...`);

    servidor.close(() => {
        console.info('Servidor encerrado');
        process.exit(0);
    });

    setTimeout(() => {
        console.error('Encerramento forçado por timeout');
        process.exit(1);
    }, 10_000);
}

process.on('SIGTERM', () => encerrar('SIGTERM'));
process.on('SIGINT', () => encerrar('SIGINT'));
