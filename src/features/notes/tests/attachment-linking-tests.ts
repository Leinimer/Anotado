/**
 * Suite de Testes Automatizados para Vinculação Segura de Anexos às Notas (Etapa 3C-3)
 */

import {
  AttachmentLinker,
  findMatchingNotesForAttachment,
  AttachmentRecord,
  NoteRecord,
} from '../api/attachment-linker';

export function runAttachmentLinkingTests(): {
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

  const userId = '51596de9-bae7-4bd3-a702-e48f442fd3dd';
  const linker = new AttachmentLinker();

  // Teste 1: Evidência A (attachment://ID)
  const att1: AttachmentRecord = {
    id: 'att-uuid-1',
    note_id: null,
    user_id: userId,
    file_name: 'diagram.png',
    mime_type: 'image/png',
    file_size: 1024,
    storage_path: `${userId}/att-uuid-1.png`,
  };
  const notes1: NoteRecord[] = [
    {
      id: 'note-alpha',
      user_id: userId,
      title: 'Projeto Alfa',
      content: '# Projeto Alfa\n\nVeja o diagrama:\n![Diagrama](attachment://att-uuid-1)',
    },
    {
      id: 'note-beta',
      user_id: userId,
      title: 'Projeto Beta',
      content: '# Projeto Beta\n\nNenhum anexo aqui.',
    },
  ];

  const matches1 = findMatchingNotesForAttachment(att1, notes1);
  assert(
    'Evidência A: encontra nota com protocolo attachment://ID',
    matches1.length === 1 && matches1[0].note.id === 'note-alpha'
  );

  const preview1 = linker.generatePreview(userId, [att1], notes1);
  assert(
    'Preview classifica Evidência A como SAFE_TO_LINK para note-alpha',
    preview1.length === 1 &&
      preview1[0].action === 'SAFE_TO_LINK' &&
      preview1[0].proposed_note_id === 'note-alpha'
  );

  // Teste 2: Evidência B (local-attachment://ID)
  const att2: AttachmentRecord = {
    id: 'att-uuid-2',
    note_id: null,
    user_id: userId,
    file_name: 'doc.pdf',
    mime_type: 'application/pdf',
    file_size: 2048,
    storage_path: `${userId}/att-uuid-2.pdf`,
  };
  const notes2: NoteRecord[] = [
    {
      id: 'note-gamma',
      user_id: userId,
      title: 'Contrato',
      content: 'Arquivo: [Contrato](local-attachment://att-uuid-2)',
    },
  ];
  const preview2 = linker.generatePreview(userId, [att2], notes2);
  assert(
    'Evidência B: classifica local-attachment://ID como SAFE_TO_LINK',
    preview2.length === 1 &&
      preview2[0].action === 'SAFE_TO_LINK' &&
      preview2[0].proposed_note_id === 'note-gamma'
  );

  // Teste 3: Evidência C (storage_path explícito)
  const att3: AttachmentRecord = {
    id: 'att-uuid-3',
    note_id: null,
    user_id: userId,
    file_name: 'foto.jpeg',
    mime_type: 'image/jpeg',
    file_size: 4096,
    storage_path: `${userId}/att-uuid-3.jpeg`,
  };
  const notes3: NoteRecord[] = [
    {
      id: 'note-delta',
      user_id: userId,
      title: 'Fotos',
      content: `Imagem direta: <img src="${userId}/att-uuid-3.jpeg" />`,
    },
  ];
  const preview3 = linker.generatePreview(userId, [att3], notes3);
  assert(
    'Evidência C: classifica storage_path explícito como SAFE_TO_LINK',
    preview3.length === 1 &&
      preview3[0].action === 'SAFE_TO_LINK' &&
      preview3[0].proposed_note_id === 'note-delta'
  );

  // Teste 4: Evidência D (URL HTTPS com o attachmentId)
  const att4: AttachmentRecord = {
    id: 'att-uuid-4',
    note_id: null,
    user_id: userId,
    file_name: 'banner.png',
    mime_type: 'image/png',
    file_size: 8192,
    storage_path: `${userId}/att-uuid-4.png`,
  };
  const notes4: NoteRecord[] = [
    {
      id: 'note-epsilon',
      user_id: userId,
      title: 'Site',
      content: `Banner: https://supabase.co/storage/v1/object/public/note-attachments/${userId}/att-uuid-4.png`,
    },
  ];
  const preview4 = linker.generatePreview(userId, [att4], notes4);
  assert(
    'Evidência D: classifica URL HTTPS com attachmentId como SAFE_TO_LINK',
    preview4.length === 1 &&
      preview4[0].action === 'SAFE_TO_LINK' &&
      preview4[0].proposed_note_id === 'note-epsilon'
  );

  // Teste 5: Múltiplos matches (MULTIPLE_NOTE_MATCH)
  const att5: AttachmentRecord = {
    id: 'att-uuid-5',
    note_id: null,
    user_id: userId,
    file_name: 'logo.png',
    mime_type: 'image/png',
    file_size: 512,
    storage_path: `${userId}/att-uuid-5.png`,
  };
  const notes5: NoteRecord[] = [
    {
      id: 'note-1',
      user_id: userId,
      title: 'Nota 1',
      content: 'Logo: attachment://att-uuid-5',
    },
    {
      id: 'note-2',
      user_id: userId,
      title: 'Nota 2',
      content: 'Também uso: attachment://att-uuid-5',
    },
  ];
  const preview5 = linker.generatePreview(userId, [att5], notes5);
  assert(
    'Múltiplas notas contendo a mesma URI geram MULTIPLE_NOTE_MATCH sem vínculo automático',
    preview5.length === 1 &&
      preview5[0].action === 'MULTIPLE_NOTE_MATCH' &&
      preview5[0].proposed_note_id === null
  );

  // Teste 6: Sem nenhuma evidência (UNASSIGNED_ATTACHMENT)
  const att6: AttachmentRecord = {
    id: 'att-uuid-6',
    note_id: null,
    user_id: userId,
    file_name: 'orphan.png',
    mime_type: 'image/png',
    file_size: 128,
    storage_path: `${userId}/att-uuid-6.png`,
  };
  const notes6: NoteRecord[] = [
    {
      id: 'note-3',
      user_id: userId,
      title: 'Nota sem anexo',
      content: 'Apenas texto sem referência a este anexo.',
    },
  ];
  const preview6 = linker.generatePreview(userId, [att6], notes6);
  assert(
    'Anexo sem citação explícita permanece UNASSIGNED_ATTACHMENT com note_id = null',
    preview6.length === 1 &&
      preview6[0].action === 'UNASSIGNED_ATTACHMENT' &&
      preview6[0].proposed_note_id === null
  );

  // Teste 7: Rejeição de evidências fracas (mesmo nome de arquivo em texto comum não gera vínculo)
  const att7: AttachmentRecord = {
    id: 'att-uuid-7',
    note_id: null,
    user_id: userId,
    file_name: 'relatorio.pdf',
    mime_type: 'application/pdf',
    file_size: 5000,
    storage_path: `${userId}/att-uuid-7.pdf`,
  };
  const notes7: NoteRecord[] = [
    {
      id: 'note-4',
      user_id: userId,
      title: 'Reunião',
      content: 'Precisamos discutir o relatorio.pdf na reunião.',
    },
  ];
  const preview7 = linker.generatePreview(userId, [att7], notes7);
  assert(
    'Menção pura do nome do arquivo sem URI ou path canônico não gera vínculo (UNASSIGNED_ATTACHMENT)',
    preview7.length === 1 && preview7[0].action === 'UNASSIGNED_ATTACHMENT'
  );

  // Teste 8: Segurança Multi-Tenant (SECURITY_MISMATCH)
  const att8: AttachmentRecord = {
    id: 'att-uuid-8',
    note_id: null,
    user_id: 'other-user-uuid',
    file_name: 'secret.png',
    mime_type: 'image/png',
    file_size: 100,
    storage_path: 'other-user-uuid/att-uuid-8.png',
  };
  const preview8 = linker.generatePreview(userId, [att8], notes1);
  assert(
    'Anexo com user_id diferente do usuário autenticado é bloqueado com SECURITY_MISMATCH',
    preview8.length === 1 && preview8[0].action === 'SECURITY_MISMATCH'
  );

  // Teste 9: Idempotência (SKIP_ALREADY_CORRECT)
  const att9: AttachmentRecord = {
    id: 'att-uuid-1',
    note_id: 'note-alpha',
    user_id: userId,
    file_name: 'diagram.png',
    mime_type: 'image/png',
    file_size: 1024,
    storage_path: `${userId}/att-uuid-1.png`,
  };
  const preview9 = linker.generatePreview(userId, [att9], notes1);
  assert(
    'Anexo já vinculado à nota correta resulta em SKIP_ALREADY_CORRECT sem gerar novo UPDATE',
    preview9.length === 1 && preview9[0].action === 'SKIP_ALREADY_CORRECT'
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
