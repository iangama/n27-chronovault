# N27 — ChronoVault

ChronoVault é um projeto full-stack focado em separar poder estrutural de pressão social.

Estrutural (tem poder):
- Capsules imutáveis com hash-chain
- Estado derivado por eventos (event sourcing simples)

Social (não tem poder):
- Comentários existem, mas não alteram o estrutural
- Sem write-path social para rotas estruturais

Observabilidade:
- Prometheus, Grafana e Loki integrados no gateway


## O que esse projeto prova no portfolio

- Separação real de domínio (social observável vs estrutural decisório)
- Mutação estrutural auditável (cadeia de hash com prev_hash e hash)
- Estado derivado (replay/projection), sem “editar o passado”
- Infra organizada com gateway único (Traefik) e rotas por PathPrefix
- Smoke end-to-end reproduzível (subir e validar sem conserto manual)


## Arquitetura (alto nível)

Gateway:
- Traefik expõe tudo em http://localhost:8880

Rotas:
- UI: /
- API: /api/*
- Grafana: /grafana
- Prometheus: /prometheus
- Loki: /loki

Serviços:
- api: eventos estruturais + auditoria + projeção
- worker: processamento/assinatura/projeção
- ui: interface para operar e observar
- postgres: persistência
- prom/grafana/loki/promtail: observabilidade


## Como rodar (1 comando)

Subir tudo:
docker compose up -d --build

Checar rápido (HTTP 200 esperado):
curl -sS -o /dev/null -w "ui_code=%{http_code}\n" http://localhost:8880/
curl -sS -o /dev/null -w "api_health_code=%{http_code}\n" http://localhost:8880/api/health
curl -sS -o /dev/null -w "grafana_code=%{http_code}\n" http://localhost:8880/grafana/
curl -sS -L -o /dev/null -w "prometheus_code=%{http_code}\n" http://localhost:8880/prometheus
curl -sS -o /dev/null -w "loki_code=%{http_code}\n" http://localhost:8880/loki/

Abrir no browser:
http://localhost:8880/


## Fluxo principal (demonstração)

1) Criar capsule estrutural
- POST /api/capsules
- Gera evento capsule.created e registra hash-chain

2) Projeção de estado
- GET /api/capsules/:id
- Estado retornado é derivado por replay/projection

3) Selar capsule (poder estrutural)
- POST /api/capsules/:id/seal
- Gera evento capsule.sealed e trava estado

4) Social sem poder
- POST /api/social/comments
- Comentários aparecem na leitura, mas não alteram o status estrutural

5) Auditoria
- GET /api/audit/verify
- Verifica integridade da cadeia (prev_hash + hash)


## Observabilidade

Grafana:
- http://localhost:8880/grafana

Prometheus:
- http://localhost:8880/prometheus

Loki:
- http://localhost:8880/loki


## Por que isso é superior a CRUD comum

- Não é CRUD “estado atual sobrescrevendo o anterior”
- Evento estrutural é imutável e auditável
- Projeção é separada (estado derivado), não é “verdade”
- Social é explicitamente sem poder (sem decisões por consenso/likes/ruído)
- Infra completa e reproduzível via Docker Compose


## Notas de operação

- Tudo roda em Docker (sem dependência local além do Docker/WSL)
- Traefik faz o roteamento por PathPrefix no gateway único
- Logs e métricas servem para observar comportamento sem governar decisões


## Licença

Uso livre para portfolio e estudo
