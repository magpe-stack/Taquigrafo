# Taquígrafo

PWA 100% offline-first para **taquigrafia temporal urbana**: micro-notas de até 50 caracteres, cada uma com carimbo de hora (HH:MM:SS), organizadas em cadernos.

- App: https://magpe-stack.github.io/Taquigrafo/
- Repositório: https://github.com/magpe-stack/Taquigrafo

## Como usar

1. **Novo Caderno** → informe o nome da atividade.
2. Abra o caderno e clique em **Iniciar Sessão**.
3. Digite a micro-nota (máx. 50 caracteres) e pressione **Enter** ou **Adicionar**.
4. Ao terminar, clique em **Concluir Caderno**.
5. Exporte em **TXT**, **Copiar para IA**, **Imprimir** ou faça o **Backup Geral (JSON)** pelo menu.

Os dados ficam no IndexedDB do seu dispositivo. Nada é enviado a servidores.

## Arquivos

| Arquivo | Função |
| --- | --- |
| `index.html` | Estrutura DOM acessível |
| `styles.css` | Design system, responsividade e impressão (paleta Itten / WCAG 2.1) |
| `app.js` | Lógica, IndexedDB, instalação PWA, modais e exportações |
| `sw.js` | Service Worker (cache e uso offline) |
| `manifest.json` | Manifesto PWA |
| `icon-192.png`, `icon-512.png` | Ícones gráficos puros (sem texto) |

## Implantação no GitHub Pages

1. Extraia o ZIP na raiz do repositório `Taquigrafo`.
2. Faça commit e push na branch `main`.
3. Em **Settings → Pages**, selecione *Deploy from a branch* → `main` / `(root)`.
4. Acesse https://magpe-stack.github.io/Taquigrafo/ e use o menu do navegador ou **Instalar o Taquígrafo** no menu lateral.

Se alterar algum arquivo em cache, incremente `CACHE_NAME` em `sw.js`.
