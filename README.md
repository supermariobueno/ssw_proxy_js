# Proxy Roteador de Webhooks — Integração SSW

Microserviço desenvolvido em **Node.js** e **Express** que atua como proxy e roteador de webhooks para o sistema **SSW**.

O projeto contorna a limitação do SSW de permitir apenas uma URL global de webhook por empresa. O proxy recebe os documentos fiscais eletrônicos, encaminha todos para o WebService principal e, quando identifica documentos destinados aos estados do Sul, também os encaminha para o WebService regional.

## Objetivos

- Receber webhooks XML enviados pelo SSW.
- Encaminhar 100% dos documentos para o WebService principal.
- Detectar documentos dos estados `PR`, `SC` e `RS`.
- Encaminhar documentos da Região Sul para um segundo WebService.
- Proteger o endpoint com token de autenticação.
- Aplicar timeout e novas tentativas em caso de falha temporária.
- Retornar erro ao SSW quando o encaminhamento não for concluído.

---

## Fluxo de dados

```text
                         [ Sistema SSW ]
                                │
                                │ POST XML
                                ▼
                       [ Proxy Roteador ]
                                │
               ┌────────────────┴────────────────┐
               │                                 │
               ▼                                 ▼
      [ WebService Principal ]       [ WebService Região Sul ]
          100% dos documentos          Somente PR, SC e RS
```

### Funcionamento

1. O SSW envia o documento XML para o endpoint do proxy.
2. O proxy valida o token de autenticação.
3. O corpo da requisição é validado.
4. O documento é encaminhado para o WebService principal.
5. O proxy verifica se o XML contém uma UF da Região Sul:
   - `PR`
   - `SC`
   - `RS`
6. Quando aplicável, uma cópia do documento é encaminhada também para o WebService da Região Sul.
7. O proxy retorna:
   - `200 OK` quando todos os encaminhamentos são concluídos.
   - `400 Bad Request` quando o corpo está vazio ou inválido.
   - `401 Unauthorized` quando o token está ausente ou incorreto.
   - `502 Bad Gateway` quando um dos WebServices de destino não pode ser alcançado.

> O proxy não confirma o recebimento com `200 OK` antes de concluir os encaminhamentos. Isso evita informar ao SSW que o documento foi processado quando ele ainda não chegou ao destino.

---

## Tecnologias utilizadas

- **Node.js** — ambiente de execução.
- **Express** — servidor HTTP e gerenciamento de rotas.
- **Axios** — comunicação com os WebServices de destino.
- **Dotenv** — carregamento de variáveis de ambiente.
- **PM2** — gerenciamento do processo em produção.

---

## Estrutura principal

```text
.
├── server.js
├── package.json
├── package-lock.json
├── .env
└── README.md
```

---

## Pré-requisitos

- Node.js versão 18 LTS ou superior.
- npm.
- Acesso às URLs dos WebServices de destino.
- Token seguro para autenticação do webhook.

Verifique as versões instaladas:

```bash
node --version
npm --version
```

---

## Instalação

Clone o repositório e instale as dependências:

```bash
git clone https://github.com/supermariobueno/ssw_proxy_js.git
cd ssw_proxy_js
npm install
```

---

## Configuração do ambiente

Crie um arquivo `.env` na raiz do projeto:

```env
PORT=3000
BODY_LIMIT=10mb

PROXY_TOKEN=gere-um-token-seguro-com-pelo-menos-16-caracteres

URL_WEBSERVICE_ATUAL=https://suaempresa.com.br/webservice-atual
URL_WEBSERVICE_SUL=https://outraempresa.com.br/webservice-sul
```

### Variáveis de ambiente

| Variável | Obrigatória | Descrição |
|---|---:|---|
| `PORT` | Não | Porta HTTP da aplicação. O padrão é `3000`. |
| `BODY_LIMIT` | Não | Tamanho máximo do corpo recebido. O padrão é `10mb`. |
| `PROXY_TOKEN` | Sim | Token usado para autenticar as requisições recebidas. |
| `URL_WEBSERVICE_ATUAL` | Sim | URL do WebService principal. |
| `URL_WEBSERVICE_SUL` | Sim | URL do WebService utilizado para documentos da Região Sul. |

O arquivo `.env` não deve ser versionado. Adicione-o ao `.gitignore`:

```gitignore
.env
.env.*
!.env.example
```

Para gerar um token aleatório:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

---

## Execução local

Para iniciar a aplicação normalmente:

```bash
npm start
```

Para executar em modo de desenvolvimento com reinicialização automática:

```bash
npm run dev
```

A aplicação será iniciada em:

```text
http://localhost:3000
```

O endpoint do webhook é:

```text
POST http://localhost:3000/webhook-ssw
```

---

## Autenticação

A autenticação deve ser enviada preferencialmente no header HTTP:

```http
Authorization: Bearer SEU_TOKEN
```

Exemplo usando `curl`:

```bash
curl -X POST "http://localhost:3000/webhook-ssw" \
  -H "Authorization: Bearer SEU_TOKEN" \
  -H "Content-Type: application/xml" \
  --data-binary @documento.xml
```

O proxy também pode aceitar o formato antigo por query string para compatibilidade:

```text
POST /webhook-ssw?token=SEU_TOKEN
```

Entretanto, esse formato não é recomendado porque tokens em URLs podem aparecer em logs, históricos do navegador, proxies e ferramentas de monitoramento.

---

## Exemplo de payload XML

```xml
<?xml version="1.0" encoding="UTF-8"?>
<CTe>
    <destinatario>
        <UF>RS</UF>
    </destinatario>
</CTe>
```

Nesse exemplo, o documento será encaminhado para:

1. `URL_WEBSERVICE_ATUAL`
2. `URL_WEBSERVICE_SUL`

Documentos com outras UFs serão enviados somente para o WebService principal.

---

## Tentativas e timeout

Cada encaminhamento possui:

- Timeout de 15 segundos.
- Até 3 tentativas de envio.
- Espera progressiva entre as tentativas.
- Nova tentativa para erros de rede, timeout, status `408`, `429` ou erros `5xx`.

Erros definitivos, como respostas `4xx` que não sejam temporárias, não são repetidos indefinidamente.

Se um destino continuar indisponível após as tentativas, o proxy retorna `502 Bad Gateway`.

---

## Códigos de resposta

| Código | Situação |
|---:|---|
| `200` | Documento encaminhado com sucesso. |
| `400` | Corpo da requisição ausente ou vazio. |
| `401` | Token ausente ou inválido. |
| `413` | Payload maior que o limite configurado. |
| `502` | Falha no encaminhamento para um WebService de destino. |
| `500` | Erro interno não tratado. |

Quando o proxy retorna `502`, o sistema de origem pode tentar reenviar o documento. Por isso, os sistemas de destino devem estar preparados para receber uma eventual duplicidade.

---

## Deploy em produção com PM2

Instale o PM2 globalmente:

```bash
sudo npm install -g pm2
```

Inicie a aplicação:

```bash
pm2 start server.js --name "proxy-ssw"
```

Verifique o processo:

```bash
pm2 status
pm2 logs proxy-ssw
```

Configure a inicialização automática após reinicialização do servidor:

```bash
pm2 startup
pm2 save
```

Para reiniciar após uma atualização:

```bash
pm2 restart proxy-ssw
```

---

## Recomendações de produção

### HTTPS

O proxy deve ser publicado atrás de HTTPS. É recomendado utilizar:

- Nginx ou Apache como reverse proxy.
- Certificado TLS válido.
- AWS Application Load Balancer, API Gateway ou CloudFront, quando aplicável.

### Firewall

Restrinja o acesso à porta da aplicação. Se possível:

- Exponha publicamente apenas as portas `80` e `443`.
- Mantenha a porta interna da aplicação, como `3000`, inacessível diretamente.
- Restrinja as conexões de saída aos domínios dos WebServices necessários.

### Logs

Os logs devem registrar:

- Data e hora.
- Destino do encaminhamento.
- Status HTTP.
- Número da tentativa.
- Mensagem resumida do erro.

Evite registrar:

- Token de autenticação.
- XML completo.
- Dados pessoais ou fiscais desnecessários.

### Segredos

Nunca coloque tokens, senhas ou URLs privadas diretamente no código-fonte. Utilize:

- Variáveis de ambiente.
- AWS Secrets Manager.
- AWS Systems Manager Parameter Store.
- Outro gerenciador seguro de segredos.

---

## Limitações atuais

A identificação da Região Sul é feita com base nas tags de UF presentes no conteúdo textual do XML. O comportamento esperado é encontrar estruturas como:

```xml
<UF>PR</UF>
<UF>SC</UF>
<UF>RS</UF>
```

Para XMLs com estruturas mais complexas, namespaces variados ou múltiplas tags de UF, recomenda-se utilizar um parser XML dedicado, como `fast-xml-parser`, em vez de depender exclusivamente de uma expressão regular.

Além disso, o encaminhamento síncrono dentro da requisição HTTP ainda depende da disponibilidade dos WebServices de destino. Para cenários de alta criticidade, recomenda-se evoluir a arquitetura para uma fila persistente:

```text
SSW → Proxy → Fila persistente → Worker → WebServices
```

Esse modelo permite:

- Confirmar o recebimento somente após salvar a mensagem.
- Reprocessar documentos automaticamente.
- Evitar perda de mensagens durante reinicializações.
- Controlar duplicidades.
- Utilizar uma dead-letter queue para falhas permanentes.

---

## Idempotência e duplicidade

O SSW ou outro sistema de origem pode reenviar um documento quando não recebe uma resposta esperada ou quando ocorre uma falha de comunicação.

Em produção, recomenda-se implementar:

1. Identificação única do CT-e ou documento.
2. Registro dos documentos já processados.
3. Bloqueio ou tratamento de reenvios duplicados.
4. Armazenamento do status de cada destino.

Sem esse controle, o mesmo documento pode ser encaminhado mais de uma vez após um retry.

---

## Teste rápido

Com a aplicação em execução, envie um XML local:

```bash
curl -i -X POST "http://localhost:3000/webhook-ssw" \
  -H "Authorization: Bearer SEU_TOKEN" \
  -H "Content-Type: application/xml" \
  --data '<CTe><UF>RS</UF></CTe>'
```

Verifique:

- O status HTTP retornado.
- Os logs da aplicação.
- O recebimento no WebService principal.
- O recebimento no WebService da Região Sul quando a UF for `PR`, `SC` ou `RS`.

---

## Licença

Este projeto utiliza a licença definida no arquivo `package.json` ou nos demais arquivos de licença do repositório.

---

Feito por Mário Bueno 👋  
[LinkedIn](https://www.linkedin.com/in/mario-lucas-bueno/)
```
