# Proxy Roteador de Webhooks - Integração SSW (Região Sul)

Este é um micro-serviço desenvolvido em **Node.js (Express)** que atua como um Proxy/Roteador de Webhooks para o sistema **SSW**. 

O objetivo do projeto é contornar a limitação de arquitetura do SSW (que permite o cadastro de apenas uma única URL global de webhook por empresa), possibilitando o reencaminhamento automático e inteligente de documentos fiscais eletrônicos (CT-e) para as filiais da **Região Sul** do Brasil, garantindo **risco zero** e **impacto zero** na aplicação/portal principal que já está em produção.

---

## 🗺️ Como Funciona o Fluxo de Dados

```text
               [ Sistema SSW ]
                      │
                      ▼ (Envio Global via POST)
             [ Proxy Roteador AWS ]
                      │
       ┌──────────────┴──────────────┐
       ▼ (100% dos dados)            ▼ (Apenas se UF = PR, SC, RS)
[ WebService Atual / Portal ]   [ WebService das Filiais do Sul ]
```

1. O **SSW** dispara o XML do documento para o nosso Proxy.
2. O Proxy responde imediatamente com status `200 OK` ao SSW para evitar *timeouts* operacionais.
3. Em segundo plano (assíncrono), o Proxy espelha **100% dos dados recebidos** para o **WebService Atual (Portal)**.
4. O Proxy analisa o payload textual do XML: se encontrar tags de UF pertencentes ao Sul (`<UF>PR</UF>`, `<UF>SC</UF>` ou `<UF>RS</UF>`), ele encaminha uma cópia idêntica do XML também para o **WebService do Sul**.

---

## 🛠️ Tecnologias Utilizadas

* **Node.js** (Ambiente de execução)
* **Express** (Framework HTTP leve para criação da rota)
* **Axios** (Cliente HTTP para o encaminhamento assíncrono dos payloads)
* **Dotenv** (Gerenciamento seguro de variáveis de ambiente)

---

## 🔒 Segurança

O endpoint possui uma camada de segurança via middleware que exige a passagem de um token estático diretamente como parâmetro de consulta (*Query Parameter*) na URL. Requisições sem o token ou com a chave incorreta são rejeitadas imediatamente na borda da aplicação com o status **`401 Unauthorized`**.

* **URL de Produção Cadastrada no SSW:** `https://seu-dominio-aws.com`

---

## 🚀 Como Executar o Projeto Localmente

### 1. Pré-requisitos
* Node.js instalado (versão 18 LTS ou superior recomendada)

### 2. Configuração do Ambiente
Clone o repositório privado para a sua máquina, entre na pasta do projeto e instale as dependências:
```bash
npm install
```

### 3. Variáveis de Ambiente
Crie um arquivo chamado `.env` na raiz do projeto seguindo a estrutura de exemplo abaixo:
```env
PORT=3000
PROXY_TOKEN=SuaChaveSecretaDeDesenvolvimento123
URL_WEBSERVICE_ATUAL=https://suaempresa.com.br
URL_WEBSERVICE_SUL=https://filiaissul.com.br
```

### 4. Executando o servidor
Para iniciar o servidor local em ambiente de desenvolvimento (com auto-reload via `nodemon`):
```bash
npm run dev
```
O console indicará que o serviço está rodando em `http://localhost:3000`.

---

## ☁️ Deploy em Produção (AWS)

Para garantir alta disponibilidade e execução contínua em segundo plano no servidor AWS, recomenda-se a utilização do **PM2**:

```bash
# Instalação global do gerenciador de processos
sudo npm install -g pm2

# Inicialização da aplicação proxy
pm2 start server.js --name "proxy-ssw"

# Configuração para inicialização automática com o S.O.
pm2 startup
pm2 save
```
