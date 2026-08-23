/**
 * Utilitários para sincronização bidirecional de Tags dentro do arquivo Markdown (.md).
 * 
 * Estrutura no arquivo Markdown:
 * O arquivo .md armazena as tags na primeira linha de metadados como `#tag1 #tag2 #tag3`.
 * 
 * Regras:
 * 1. Ao carregar o .md, se houver linha de tags no início (ou metadados), as tags são extraídas para o estado visual.
 * 2. O conteúdo exibido na área de edição do Tiptap pode ser limpo dessa linha para não duplicar visualmente
 *    (já que as tags são gerenciadas e exibidas na região visual dedicada de TAGS).
 * 3. Ao salvar no Supabase Storage / gerar o .md final, as tags da barra visual são concatenadas no topo do arquivo .md.
 */

/**
 * Normaliza um nome de tag removendo espaços e '#'
 */
export function cleanTagName(raw: string): string {
  if (!raw || typeof raw !== 'string') return '';
  return raw.trim().replace(/\s+/g, '').replace(/^#+/, '');
}

/**
 * Formata uma lista de tags para uma linha de tags Markdown.
 * Exemplo: ['estudo', 'tributário'] -> '#estudo #tributário'
 */
export function formatTagsToMarkdownLine(tags: string[]): string {
  if (!Array.isArray(tags) || tags.length === 0) return '';
  const cleanList = tags
    .map(cleanTagName)
    .filter(Boolean)
    .map((t) => `#${t}`);
  
  return cleanList.length > 0 ? cleanList.join(' ') : '';
}

/**
 * Analisa um arquivo Markdown e separa a linha de tags do corpo da nota.
 * Retorna as tags encontradas e o corpo limpo do Markdown.
 */
export function parseMarkdownWithTags(rawMarkdown: string): {
  tags: string[];
  body: string;
} {
  if (!rawMarkdown || typeof rawMarkdown !== 'string') {
    return { tags: [], body: '' };
  }

  const lines = rawMarkdown.split('\n');
  const extractedTags: string[] = [];
  let bodyStartIndex = 0;

  // Verifica se a primeira linha (ou primeiras linhas ignorando espaços em branco iniciais) é exclusivamente composta de tags #tag
  for (let i = 0; i < lines.length; i++) {
    const trimmedLine = lines[i].trim();
    if (!trimmedLine) {
      // Linha vazia inicial, pula
      continue;
    }

    // Verifica se a linha consiste apenas de hashtags separadas por espaço (ex: #tag1 #tag2)
    // Permite caracteres Unicode (letras acentuadas, números, sublinhados)
    const isTagLine = /^(\s*#[a-zA-Z0-9_\u00C0-\u017F-]+\s*)+$/.test(trimmedLine);
    if (isTagLine) {
      const tagMatches = trimmedLine.match(/#[a-zA-Z0-9_\u00C0-\u017F-]+/g);
      if (tagMatches) {
        tagMatches.forEach((m) => {
          const clean = cleanTagName(m);
          if (clean && !extractedTags.includes(clean)) {
            extractedTags.push(clean);
          }
        });
      }
      bodyStartIndex = i + 1;
      // Se a próxima linha for vazia como espaçador, pula ela também
      if (lines[bodyStartIndex] !== undefined && lines[bodyStartIndex].trim() === '') {
        bodyStartIndex += 1;
      }
      break;
    } else {
      // Não é uma linha de tags dedicada no topo
      break;
    }
  }

  // O corpo é o restante do Markdown
  const body = lines.slice(bodyStartIndex).join('\n');
  return { tags: extractedTags, body };
}

/**
 * Combina uma lista de tags com o corpo da nota para gerar o arquivo Markdown completo final.
 * Se houver tags, adiciona a linha `#tag1 #tag2\n\n` no topo.
 */
export function serializeMarkdownWithTags(body: string, tags: string[]): string {
  const tagLine = formatTagsToMarkdownLine(tags);
  const cleanBody = (body || '').trimStart();

  if (!tagLine) {
    return cleanBody;
  }

  if (!cleanBody) {
    return tagLine;
  }

  return `${tagLine}\n\n${cleanBody}`;
}
