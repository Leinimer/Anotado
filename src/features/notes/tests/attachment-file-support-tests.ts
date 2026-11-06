import {
  inferAttachmentMimeType,
  isSupportedNoteAttachmentFile,
} from '../api/storage-api';

export function runAttachmentFileSupportTests(): {
  total: number;
  passed: number;
  failed: number;
  results: { name: string; passed: boolean }[];
} {
  const cases: { name: string; passed: boolean }[] = [
    {
      name: 'Aceita TXT identificado como text/plain',
      passed: isSupportedNoteAttachmentFile({ name: 'prompt ipj.txt', type: 'text/plain' }),
    },
    {
      name: 'Aceita TXT quando o navegador não informa MIME',
      passed: isSupportedNoteAttachmentFile({ name: 'system_prompt.txt', type: '' }),
    },
    {
      name: 'Aceita TXT quando o navegador informa application/octet-stream',
      passed: isSupportedNoteAttachmentFile({
        name: 'system_prompt.txt',
        type: 'application/octet-stream',
      }),
    },
    {
      name: 'Infere text/plain para TXT sem MIME',
      passed: inferAttachmentMimeType('prompt ipj.txt', '') === 'text/plain',
    },
    {
      name: 'Substitui MIME genérico pela extensão TXT',
      passed:
        inferAttachmentMimeType('system_prompt.txt', 'application/octet-stream') ===
        'text/plain',
    },
    {
      name: 'Preserva MIME específico de DOCX',
      passed:
        inferAttachmentMimeType(
          'relatorio.docx',
          'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
        ) ===
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    },
    {
      name: 'Não trata executáveis como anexos de documento suportados',
      passed: !isSupportedNoteAttachmentFile({ name: 'programa.exe', type: '' }),
    },
  ];

  const passed = cases.filter((testCase) => testCase.passed).length;
  return {
    total: cases.length,
    passed,
    failed: cases.length - passed,
    results: cases,
  };
}
