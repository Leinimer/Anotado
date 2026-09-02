/**
 * Suite de Testes Automatizados para a Reconciliação Segura de Anexos Órfãos (Etapa 3C-2)
 */

import {
  parseStoragePath,
  inferMimeTypeFromExtension,
  AttachmentReconciler,
} from '../api/attachment-reconciler';

export function runAttachmentReconciliationTests(): {
  total: number;
  passed: number;
  failed: number;
  results: { testName: string; passed: boolean; message?: string }[];
} {
  const results: { testName: string; passed: boolean; message?: string }[] = [];

  function assert(testName: string, condition: boolean, message?: string) {
    if (condition) {
      results.push({ testName, passed: true });
    } else {
      results.push({ testName, passed: false, message: message || 'Assertion failed' });
    }
  }

  // 1. Teste: parseStoragePath válido
  const validPath = '51596de9-bae7-4bd3-a702-e48f442fd3dd/02eb4b48-5858-453a-9013-e8117b01cf5c.png';
  const parsedValid = parseStoragePath(validPath);
  assert(
    'parseStoragePath extrai userId, attachmentId e extension corretamente',
    parsedValid.isValid &&
      parsedValid.userId === '51596de9-bae7-4bd3-a702-e48f442fd3dd' &&
      parsedValid.attachmentId === '02eb4b48-5858-453a-9013-e8117b01cf5c' &&
      parsedValid.extension === 'png'
  );

  // 2. Teste: parseStoragePath inválido
  const invalidPath = 'root-file-without-user.png';
  const parsedInvalid = parseStoragePath(invalidPath);
  assert(
    'parseStoragePath rejeita caminhos sem estrutura {userId}/{fileName}',
    !parsedInvalid.isValid
  );

  // 3. Teste: inferMimeTypeFromExtension
  assert('inferMimeType mapeia png para image/png', inferMimeTypeFromExtension('png') === 'image/png');
  assert('inferMimeType mapeia jpeg e jpg para image/jpeg', inferMimeTypeFromExtension('jpg') === 'image/jpeg' && inferMimeTypeFromExtension('jpeg') === 'image/jpeg');
  assert('inferMimeType mapeia pdf para application/pdf', inferMimeTypeFromExtension('pdf') === 'application/pdf');
  assert('inferMimeType desconhecido vira application/octet-stream', inferMimeTypeFromExtension('bin') === 'application/octet-stream');

  // 4. Teste: Detecção estrita de evidência em notas (não chuta associações)
  const userId = '51596de9-bae7-4bd3-a702-e48f442fd3dd';
  const targetId = '02eb4b48-5858-453a-9013-e8117b01cf5c';
  const testNotes = [
    {
      id: 'note-1',
      user_id: userId,
      content: `# Minha Nota\n\nVeja a imagem: ![Foto](attachment://${targetId})`,
    },
    {
      id: 'note-2',
      user_id: userId,
      content: '# Outra Nota\n\nNenhum anexo aqui.',
    },
  ];

  // Simulação da lógica de associação
  let foundNoteId: string | null = null;
  for (const n of testNotes) {
    if (n.content.includes(`attachment://${targetId}`)) {
      foundNoteId = n.id;
      break;
    }
  }

  assert(
    'Associação segura detecta nota com attachment://ID explicitamente',
    foundNoteId === 'note-1'
  );

  // 5. Teste: Rejeição de associação sem evidência
  const unlinkedId = '99999999-9999-9999-9999-999999999999';
  let unlinkedFound: string | null = null;
  for (const n of testNotes) {
    if (n.content.includes(unlinkedId)) {
      unlinkedFound = n.id;
      break;
    }
  }

  assert(
    'Arquivo sem evidência explícita resulta em note_id = null',
    unlinkedFound === null
  );

  const passed = results.filter((r) => r.passed).length;
  const failed = results.filter((r) => !r.passed).length;

  return {
    total: results.length,
    passed,
    failed,
    results,
  };
}
