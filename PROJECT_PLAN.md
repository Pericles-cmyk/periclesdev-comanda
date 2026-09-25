# COMANDA WEB — PROJECT PLAN OFICIAL PARA AGENT

> **INSTRUÇÃO AO AGENT:** este arquivo é a fonte oficial do plano de migração do projeto. Antes de alterar código, leia o arquivo inteiro. Execute as fases em ordem. Não avance para a fase seguinte antes de cumprir os critérios de aceite da fase atual. Ao concluir cada fase, registre o ponto de parada neste arquivo conforme a seção "PONTO DE PARADA AO FINAL DE CADA FASE".

## Objetivo geral

Transformar o projeto atual `periclesdev-comanda` em um sistema reutilizável para múltiplos estabelecimentos, 100% online, com foco principal em uso no MOBILE, sem depender de notebook/PC atuando como servidor local.

A aplicação deve continuar usando a base React + Vite + Supabase já existente, mas deverá:

- funcionar como sistema multiestabelecimento (multi-tenant);
- hospedar frontend e backend na nuvem;
- eliminar dependências obrigatórias de servidor local;
- rodar prioritariamente como aplicativo mobile;
- permitir impressão direta em impressoras térmicas conectadas à rede local por Wi-Fi ou RJ45;
- permitir múltiplas impressoras por estabelecimento;
- permitir roteamento por setor: cozinha, bar, caixa etc.;
- manter possibilidade de acesso web/desktop para administração;
- manter funcionamento com planos gratuitos enquanto o volume permitir.

---

# REGRAS GERAIS DE DESENVOLVIMENTO

1. Não reescrever a aplicação do zero.
2. Reutilizar a lógica já existente sempre que possível.
3. Preservar funcionalidades atuais:
   - login;
   - mesas;
   - comandas;
   - categorias;
   - produtos;
   - estoque;
   - pagamentos;
   - descontos;
   - histórico;
   - usuários;
   - cardápio digital;
   - realtime;
   - relatórios.
4. Toda alteração de banco deve possuir migration/SQL versionado.
5. Nenhuma chave sensível deve ser adicionada ao repositório.
6. `.env` deve permanecer ignorado.
7. Toda funcionalidade nova deve ser testada antes de ser integrada à branch `develop`.
8. Priorizar compatibilidade Android na primeira versão mobile.
9. A arquitetura deve permitir suporte futuro a iOS.
10. A camada de impressão deve ser isolada do restante da aplicação através de um serviço próprio.
11. O sistema deve continuar funcionando sem impressora configurada.
12. Impressora nunca deve ser requisito para abrir mesa ou lançar pedido.
13. Nenhum estabelecimento poderá acessar dados de outro estabelecimento.
14. Toda consulta sensível no Supabase deve respeitar RLS.
15. O projeto deve permanecer preparado para múltiplos clientes sem duplicação de código.

---

# FASE 1 — TRANSFORMAR O BANCO EM MULTI-TENANT

## Objetivo

Permitir que uma única instalação do Comanda Web atenda vários estabelecimentos sem mistura ou vazamento de dados.

Hoje a aplicação foi construída considerando um único estabelecimento. Essa fase deve introduzir o conceito de `establishment`.

## 1.1 Criar tabela de estabelecimentos

Criar tabela:

```sql
establishments
```

Campos mínimos:

```text
id
name
slug
active
logo_url
primary_color
secondary_color
created_at
updated_at
```

Sugestão:

```text
id               uuid PK
name             text NOT NULL
slug             text UNIQUE NOT NULL
active           boolean DEFAULT true
logo_url         text NULL
primary_color    text NULL
secondary_color  text NULL
created_at       timestamptz DEFAULT now()
updated_at       timestamptz DEFAULT now()
```

## 1.2 Associar usuários ao estabelecimento

A tabela `profiles` deve possuir:

```text
establishment_id
```

Cada usuário deve obrigatoriamente pertencer a um estabelecimento.

Exemplo:

```text
Isabela Silva
role: admin
establishment_id: UUID_DO_ESTABELECIMENTO
```

## 1.3 Adicionar `establishment_id` às tabelas operacionais

Revisar todas as tabelas e incluir `establishment_id` onde houver dados específicos de cliente.

Aplicar pelo menos em:

```text
profiles
restaurant_tables
categories
products
product_variants
orders
order_items
payments
business_settings
menu_updates
role_permissions
user_permissions
audit_logs
```

Revisar outras tabelas existentes e incluir quando necessário.

## 1.4 Ajustar relacionamentos

Todos os registros novos devem herdar automaticamente o estabelecimento do usuário autenticado ou da entidade pai.

Exemplo:

```text
Usuário → Estabelecimento A
Mesa → Estabelecimento A
Pedido → Mesa do Estabelecimento A
Item → Pedido do Estabelecimento A
Pagamento → Pedido do Estabelecimento A
```

Nunca confiar em `establishment_id` vindo livremente do frontend quando for possível inferir pelo usuário ou registro pai.

## 1.5 Criar políticas RLS

Criar Row Level Security para impedir acesso cruzado entre estabelecimentos.

Regra esperada:

```text
Usuário do Estabelecimento A
↓
somente SELECT/INSERT/UPDATE/DELETE de registros do Estabelecimento A
```

Nenhum usuário do Estabelecimento A pode:

```text
ler
editar
criar
excluir
```

dados pertencentes ao Estabelecimento B.

## 1.6 Ajustar RPCs existentes

Revisar todas as funções RPC usadas pela aplicação, incluindo funções relacionadas a:

```text
open_table_order
add_order_item
cancel_order_item
set_order_discount
add_order_payment
remove_order_payment
close_order
get_finalized_tables
get_finalized_order_receipt
get_movement_days
get_daily_movement_report
get_public_menu
create_product_admin
set_product_stock
```

Cada RPC deve validar o estabelecimento.

## 1.7 Cardápio público

O cardápio digital deve identificar o estabelecimento.

Não usar apenas:

```text
/cardapio
```

Migrar para algo como:

```text
/cardapio/:slug
```

Exemplo:

```text
/cardapio/espetos-prime
```

ou futuramente:

```text
espetos-prime.comandaweb.app
```

## Critérios de aceite da Fase 1

A fase só está concluída quando:

- [ ] existe tabela `establishments`;
- [ ] todo usuário pertence a um estabelecimento;
- [ ] tabelas operacionais possuem vínculo com estabelecimento;
- [ ] RLS está ativa;
- [ ] um usuário do cliente A não consegue acessar cliente B;
- [ ] RPCs validam tenant;
- [ ] cardápio público identifica estabelecimento;
- [ ] aplicação atual continua funcionando para o primeiro estabelecimento migrado;
- [ ] migrations estão versionadas;
- [ ] testes de isolamento de dados foram realizados.

---

# FASE 2 — REMOVER DEPENDÊNCIA DO SERVIDOR LOCAL E MOVER A OPERAÇÃO PARA A NUVEM

## Objetivo

Eliminar a necessidade de um notebook/PC rodando como servidor obrigatório dentro do estabelecimento.

Hoje existem funções locais para impressão e backup. Elas devem deixar de ser requisito para operação.

## 2.1 Revisar dependências locais

Mapear tudo que atualmente depende de:

```text
server/index.js
server/db.js
localApi
servidor de impressão local
backup local
scripts .bat
```

Separar em:

```text
necessário para produção online
opcional
legado
```

## 2.2 Remover dependência obrigatória de `localApi.print`

Chamadas como:

```js
localApi.print.status()
localApi.print.queue()
localApi.print.registerAgent()
```

não devem mais fazer parte do fluxo obrigatório da comanda.

A impressão será substituída na Fase 4 pelo `PrinterService`.

## 2.3 Manter Supabase como backend principal

Continuar usando:

```text
PostgreSQL
Auth
Realtime
RPC
Edge Functions
Storage
```

O Supabase será a fonte oficial dos dados.

## 2.4 Frontend online

Preparar aplicação para deploy em:

```text
Cloudflare Pages
```

ou outra hospedagem gratuita equivalente caso necessário.

Requisitos:

```text
HTTPS
SPA routing
variáveis de ambiente seguras
build Vite
domínio próprio futuro
```

## 2.5 Remover dependência do notebook para operação

O sistema deve funcionar assim:

```text
Celular
   ↓
Internet
   ↓
Frontend
   ↓
Supabase
```

O notebook não pode ser necessário para:

```text
login
abrir mesa
lançar produtos
pagamentos
estoque
encerrar pedido
consultar histórico
administrar usuários
```

## 2.6 Backup

Nesta fase, remover o backup local como requisito.

A opção "Backup" poderá:

1. ser temporariamente ocultada;
2. ser substituída posteriormente por uma estratégia cloud;
3. ou permanecer apenas como feature administrativa futura.

Não manter dependência de HD externo ou pendrive para o funcionamento principal.

## Critérios de aceite da Fase 2

- [ ] sistema funciona sem executar `server/index.js`;
- [ ] sistema funciona sem scripts `.bat`;
- [ ] notebook não é necessário;
- [ ] todos os dados operacionais continuam no Supabase;
- [ ] frontend possui build de produção;
- [ ] aplicação abre por HTTPS;
- [ ] realtime funciona online;
- [ ] encerramento de pedido funciona mesmo sem impressora;
- [ ] impressão local antiga está isolada ou removida;
- [ ] não existem credenciais sensíveis versionadas.

---

# FASE 3 — TRANSFORMAR O FRONTEND EM APP MOBILE COM CAPACITOR

## Objetivo

Transformar a aplicação React/Vite em aplicativo mobile, inicialmente Android, sem reescrever a interface em Flutter ou React Native.

## 3.1 Instalar Capacitor

Adicionar ao projeto:

```text
@capacitor/core
@capacitor/cli
@capacitor/android
```

Inicializar projeto Capacitor.

Definir package id, por exemplo:

```text
com.periclesdev.comandaweb
```

ou:

```text
br.com.periclesdev.comandaweb
```

## 3.2 Criar projeto Android

Gerar pasta:

```text
android/
```

Configurar:

```text
nome do aplicativo
ícone
splash screen
permissões
network security
versão
build
```

## 3.3 Preservar versão web

O mesmo código deve gerar:

```text
Web/PWA
Android
```

Evitar duplicação.

Estrutura desejada:

```text
React/Vite
    │
    ├── Web
    └── Capacitor Android
```

## 3.4 Detectar ambiente

Criar helper para identificar:

```text
web
android
ios
```

Exemplo conceitual:

```js
PlatformService
```

Funções esperadas:

```text
isWeb()
isAndroid()
isIOS()
isNative()
```

## 3.5 UX mobile-first

A interface mobile deve priorizar:

```text
Mesas
Cardápio
Comanda
Pagamento
Impressão
```

Recomendações:

```text
bottom navigation
botões grandes
cards em 2 colunas
bottom sheets
categorias horizontais
ações fixas no rodapé
```

O desktop pode manter versão administrativa mais ampla.

## 3.6 Permissões de rede local

Preparar Android para acesso à LAN.

O app deverá conseguir se comunicar com dispositivos em:

```text
192.168.x.x
10.x.x.x
172.16.x.x
```

Preparar também arquitetura compatível com futura implementação iOS.

## Critérios de aceite da Fase 3

- [ ] projeto Capacitor configurado;
- [ ] app Android abre corretamente;
- [ ] login funciona;
- [ ] mesas carregam;
- [ ] realtime funciona;
- [ ] pedidos podem ser criados;
- [ ] pagamentos funcionam;
- [ ] APK de teste pode ser instalado manualmente;
- [ ] versão web continua funcionando;
- [ ] código não foi duplicado para Android;
- [ ] camada de plataforma está preparada para iOS futuro.

---

# FASE 4 — CRIAR PRINTERSERVICE PARA IMPRESSÃO DIRETA POR REDE

## Objetivo

Permitir que o celular envie impressão diretamente para uma impressora térmica conectada ao mesmo roteador via Wi-Fi ou RJ45.

Eliminar:

```text
Celular → Notebook → Bluetooth → Impressora
```

Substituir por:

```text
Celular → Wi-Fi → TCP/IP → Impressora
```

## 4.1 Criar camada de abstração

Criar serviço:

```text
PrinterService
```

O restante da aplicação não deve abrir socket diretamente.

Interface sugerida:

```js
PrinterService.discover()
PrinterService.testConnection(printer)
PrinterService.printReceipt(printer, order)
PrinterService.printKitchenTicket(printer, order)
PrinterService.printReport(printer, report)
PrinterService.getStatus(printer)
```

## 4.2 Suporte ESC/POS

Criar geração de comandos ESC/POS.

Suportar inicialmente:

```text
texto
negrito
centralização
alinhamento
largura
quebra de linha
corte de papel
QR Code se compatível
```

Preparar:

```text
58 mm
80 mm
```

Priorizar 80 mm.

## 4.3 Comunicação TCP/IP

Implementar conexão:

```text
IP da impressora
porta TCP
```

Default sugerido:

```text
9100
```

Mas deve ser configurável.

Exemplo:

```text
192.168.1.50:9100
```

## 4.4 Plugin nativo

Se não houver plugin Capacitor confiável que atenda aos requisitos, criar plugin próprio.

Exemplo:

```text
capacitor-network-printer
```

Funções:

```text
connect(ip, port)
send(bytes)
disconnect()
test(ip, port)
```

## 4.5 Tela de configuração de impressora

Criar no Admin:

```text
Impressoras
```

Campos:

```text
Nome
IP
Porta
Largura
Setor
Ativa
```

Botões:

```text
Testar conexão
Imprimir teste
Salvar
Excluir
```

## 4.6 Persistência

Criar tabela:

```text
printers
```

Campos sugeridos:

```text
id
establishment_id
name
ip_address
port
paper_width
sector
active
created_at
updated_at
```

## Critérios de aceite da Fase 4

- [ ] `PrinterService` existe;
- [ ] aplicação não depende de notebook;
- [ ] Android consegue abrir conexão TCP na LAN;
- [ ] impressão ESC/POS funciona;
- [ ] IP e porta podem ser configurados;
- [ ] teste de impressão funciona;
- [ ] impressão 80 mm está formatada corretamente;
- [ ] falha de impressora não encerra/trava a aplicação;
- [ ] mensagem de erro de impressão é clara;
- [ ] pedido continua salvo mesmo se impressão falhar.

---

# FASE 5 — DESCOBERTA DE IMPRESSORAS NA REDE

## Objetivo

Permitir que o administrador encontre impressoras disponíveis na LAN sem precisar saber o IP manualmente.

Sempre manter cadastro manual como fallback.

## 5.1 Criar tela "Procurar impressoras"

Fluxo:

```text
Admin
↓
Impressoras
↓
Procurar impressoras na rede
```

Mostrar:

```text
Nome
IP
Porta
Status
Fabricante/modelo quando disponível
```

## 5.2 Priorizar mDNS/Bonjour

Implementar descoberta usando:

```text
mDNS
Bonjour
DNS-SD
```

quando suportado.

Pesquisar serviços de impressão compatíveis.

## 5.3 Fallback por rede local

Se mDNS não encontrar equipamentos, permitir:

```text
varredura controlada da sub-rede
```

Exemplo:

```text
192.168.1.0/24
```

Testar portas típicas somente quando apropriado.

Evitar varreduras agressivas.

## 5.4 Cadastro manual obrigatório

Sempre oferecer:

```text
Adicionar impressora manualmente
```

Campos:

```text
IP
Porta
Nome
Setor
Largura
```

## 5.5 Status

Após cadastrada:

```text
Cozinha    ● Online
Caixa      ● Online
Bar        ● Offline
```

Criar teste de status sob demanda.

Não realizar polling excessivo.

## 5.6 Reconexão

Ao imprimir:

1. testar conexão rapidamente;
2. se online, imprimir;
3. se offline, retornar erro;
4. permitir tentar novamente;
5. não perder o pedido.

## Critérios de aceite da Fase 5

- [ ] existe botão de descoberta;
- [ ] mDNS/Bonjour implementado quando disponível;
- [ ] cadastro manual funciona;
- [ ] impressoras encontradas podem ser salvas;
- [ ] IP/porta ficam persistidos;
- [ ] status online/offline funciona;
- [ ] app informa quando impressora não responde;
- [ ] usuário pode editar configuração;
- [ ] fluxo funciona sem necessidade de notebook.

---

# FASE 6 — ROTEAMENTO POR SETOR E MÚLTIPLAS IMPRESSORAS

## Objetivo

Permitir vários equipamentos por estabelecimento e direcionar automaticamente cada item para o setor correto.

Exemplo:

```text
Cozinha
Bar
Caixa
```

## 6.1 Criar setores de impressão

Criar tabela:

```text
printer_sectors
```

ou usar enum/configuração equivalente.

Inicialmente:

```text
kitchen
bar
cashier
general
```

Labels:

```text
Cozinha
Bar
Caixa
Geral
```

## 6.2 Associar impressora ao setor

Exemplo:

```text
Impressora Cozinha
192.168.1.50
Setor: Cozinha
```

```text
Impressora Bar
192.168.1.51
Setor: Bar
```

```text
Impressora Caixa
192.168.1.52
Setor: Caixa
```

## 6.3 Associar categorias/produtos ao setor

Preferência inicial:

```text
categoria → setor
```

Exemplo:

```text
Espetos → Cozinha
Petiscos → Cozinha
Cervejas → Bar
Destilados → Bar
```

Permitir override no produto no futuro.

## 6.4 Impressão de produção

Quando um pedido for confirmado:

```text
Pedido
↓
separar itens por setor
↓
Cozinha
Bar
Outros
↓
enviar ticket para impressora correspondente
```

Exemplo:

Pedido:

```text
2x Espeto Carne
1x Batata
2x Heineken
```

Cozinha recebe:

```text
Mesa 08
Comanda #128

2x Espeto Carne
1x Batata
```

Bar recebe:

```text
Mesa 08
Comanda #128

2x Heineken
```

## 6.5 Impressão no fechamento

Ao encerrar:

```text
Caixa
```

recebe:

```text
comanda completa
subtotal
desconto
pagamento
total
operador
data/hora
```

## 6.6 Reimpressão

Permitir:

```text
Reimprimir cozinha
Reimprimir bar
Reimprimir comanda final
```

Registrar auditoria.

## 6.7 Evitar impressão duplicada

Criar mecanismo de idempotência.

Sugestão de tabela:

```text
print_jobs
```

Campos:

```text
id
establishment_id
order_id
printer_id
job_type
status
payload_hash
created_at
printed_at
error_message
```

Estados:

```text
pending
printing
printed
failed
```

Não imprimir novamente automaticamente um job já marcado como `printed`.

## 6.8 Auditoria

Registrar:

```text
quem solicitou
qual pedido
qual impressora
qual setor
data/hora
sucesso/falha
```

## Critérios de aceite da Fase 6

- [ ] múltiplas impressoras por estabelecimento funcionam;
- [ ] impressora possui setor;
- [ ] categorias podem apontar para setor;
- [ ] itens são separados por setor;
- [ ] cozinha recebe somente itens da cozinha;
- [ ] bar recebe somente itens do bar;
- [ ] caixa recebe comanda final;
- [ ] reimpressão funciona;
- [ ] falha em uma impressora não impede as demais;
- [ ] jobs não são duplicados;
- [ ] auditoria registra impressão.

---

# ARQUITETURA FINAL ESPERADA

```text
                       INTERNET
                          │
               ┌──────────▼──────────┐
               │ Cloudflare Pages    │
               │ React / Vite / PWA  │
               └──────────┬──────────┘
                          │
                    HTTPS / Realtime
                          │
               ┌──────────▼──────────┐
               │      Supabase       │
               │ PostgreSQL          │
               │ Auth                │
               │ Realtime            │
               │ Edge Functions      │
               └─────────────────────┘


       ESTABELECIMENTO — REDE LOCAL

           ┌──────────────────┐
           │ Roteador Wi-Fi   │
           └────────┬─────────┘
                    │
        ┌───────────┼────────────┐
        │           │            │
   ┌────▼────┐ ┌────▼────┐ ┌────▼────┐
   │Celular 1│ │Celular 2│ │Tablet   │
   │Garçom   │ │Admin    │ │Garçom   │
   └────┬────┘ └────┬────┘ └────┬────┘
        │           │            │
        └───────────┴────────────┘
                    │
             PrinterService
                    │
           TCP/IP + ESC/POS
                    │
       ┌────────────┼────────────┐
       │            │            │
 ┌─────▼────┐ ┌─────▼────┐ ┌─────▼────┐
 │ Cozinha  │ │   Bar    │ │  Caixa   │
 │ Wi-Fi/LAN│ │ Wi-Fi/LAN│ │ Wi-Fi/LAN│
 └──────────┘ └──────────┘ └──────────┘
```

---

# STACK FINAL DESEJADA

```text
Frontend:
React
Vite
CSS atual / componentes responsivos

Backend:
Supabase PostgreSQL
Supabase Auth
Supabase Realtime
Supabase Edge Functions

Mobile:
Capacitor
Android inicialmente
iOS futuramente

Hospedagem:
Cloudflare Pages

Impressão:
PrinterService
TCP/IP
ESC/POS
mDNS / Bonjour / DNS-SD

Banco:
Multi-tenant
RLS
establishment_id
```

---

# ORDEM DE EXECUÇÃO OBRIGATÓRIA

Executar exatamente nesta ordem:

```text
FASE 1
Multi-tenant
        ↓
FASE 2
Cloud / remover servidor local
        ↓
FASE 3
Capacitor / Android
        ↓
FASE 4
PrinterService TCP/IP
        ↓
FASE 5
Descoberta de impressoras
        ↓
FASE 6
Múltiplas impressoras / setores
```

Não iniciar roteamento por setores antes de a impressão TCP/IP básica estar estável.

---

# PONTO DE PARADA AO FINAL DE CADA FASE

Ao concluir cada fase:

1. executar testes;
2. corrigir erros;
3. atualizar documentação;
4. registrar migrations;
5. fazer commit;
6. garantir branch limpa;
7. registrar ponto de parada no arquivo do projeto.

Formato:

```text
STATUS: FASE X CONCLUÍDA

Última alteração:
...

Testes executados:
...

Pendências:
...

Próxima fase:
FASE X+1 — ...
```

---

# RESULTADO FINAL ESPERADO

Ao final das 6 fases, o Comanda Web deverá:

- funcionar online;
- ser reutilizável por vários estabelecimentos;
- não depender de notebook;
- possuir frontend web e app Android;
- permitir vários celulares simultaneamente;
- sincronizar pedidos em tempo real;
- imprimir diretamente em impressoras da rede local;
- detectar impressoras quando possível;
- permitir cadastro manual por IP;
- suportar Wi-Fi e RJ45;
- possuir múltiplas impressoras;
- separar impressão por cozinha/bar/caixa;
- preservar histórico;
- evitar impressão duplicada;
- funcionar com arquitetura preparada para crescimento futuro.
