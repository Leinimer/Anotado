# ANOTADO — Instruções para agentes de programação

Antes de planejar ou alterar o código, leia integralmente o contexto canônico em [`.agents/AGENTS.md`](.agents/AGENTS.md). Ele contém a arquitetura, os módulos, os modelos, os fluxos de dados, as regras de negócio e o checklist de validação do ANOTADO.

Faça a menor mudança segura possível, siga a separação local-first entre IndexedDB, SyncQueue e SyncEngine, preserve o isolamento entre Notas/Diário/Diário compartilhado, confira migrations e RLS antes de qualquer mudança de banco e não declare testes/deploy concluídos sem evidência real.

A documentação completa deve ser mantida em `.agents/AGENTS.md`; `GEMINI.md` e este arquivo são apenas pontos de entrada para ferramentas que carregam nomes diferentes. Se a implementação e a documentação divergirem, confirme o código atual e corrija a documentação canônica quando apropriado.
