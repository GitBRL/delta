# Site de marketing do Delta

Site estático em HTML, sem build obrigatório e sem dependências. Tem:
- produto;
- preços;
- segurança;
- desenvolvedores;
- ferramentas gratuitas (calculadoras);
- Academy;
- glossário;
- afiliados.

- **Fonte:** `gerar.py` gera todas as páginas. Edite o gerador e rode `make site-build`. Os endereços do app e do site vêm de `DELTA_APP_URL` e `DELTA_SITE_URL`.
- **Calculadoras:** ficam em `assets/calc.mjs`, com funções puras usadas pelas páginas e pelos testes.
- **Servir localmente:** `make site` sobe o site em http://localhost:4400.
- **Testes:** `make site-test` confere as calculadoras, os metadados de cada página, os links internos e o sitemap. Faz parte do `make ci`.

Preços e regras de afiliados estão em validação, e a marca "Delta" é provisória.
