# delta — CLI do Delta

O Delta no terminal: projetos, métricas, saúde da conta, metas, linha do tempo e relatórios. A CLI fala com o servidor MCP do Delta (ADR 0026).

## Requisitos

- Node 20 ou mais novo. Não há dependências.
- Um token da API com o escopo `mcp:tools` e os escopos de leitura que quiser usar (`projects:read`, `metrics:read`, `reports:read`). Crie em **Configurações › API e webhooks**.

## Uso

```sh
node cli/bin/delta.mjs login --url https://api.seu-dominio.com --token -   # cole o token e tecle Enter (fica fora do histórico)
node cli/bin/delta.mjs projects
node cli/bin/delta.mjs metrics get padaria meta_ads:spend meta_ads:cpa --period last_month
node cli/bin/delta.mjs summary padaria
node cli/bin/delta.mjs goals --csv > metas.csv
```

`delta help` lista todos os comandos, e `delta shell` abre o modo interativo.

- **Projeto:** aceita o id ou parte do nome, sem diferenciar acentos nem maiúsculas.
- **Perfil:** fica em `~/.config/delta/config.json`, com permissão 600.
- **Variáveis de ambiente:** `DELTA_URL`, `DELTA_TOKEN` e `DELTA_PROFILE` substituem o perfil salvo. Servem para CI e scripts.

## Testes

`make cli-test`: um servidor MCP falso local confere a autenticação, os formatos e as mensagens de erro.
