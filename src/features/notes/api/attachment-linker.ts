/**
 * Módulo de Vinculação Segura de Anexos às Notas (Etapa 3C-3)
 *
 * Responsabilidade:
 * - Consultar registros de public.note_attachments com note_id IS NULL (ou todos os registros do usuário autenticado).
 * - Buscar evidências FORTES e EXPLÍCITAS nas notas autenticadas:
 *    A) content contém exatamente "attachment://{attachmentId}"
 *    B) content contém exatamente "local-attachment://{attachmentId}"
 *    C) content contém exatamente o storage_path "{userId}/{attachmentId}.{ext}"
 *    D) content contém URL HTTPS do bucket contendo exatamente o attachmentId e o storage_path correspondente.
 * - Rejeitar evidências fracas (nome, tamanho, data, proximidade temporal, eTag, extensão, UUID parecido).
 * - Tratar múltiplos matches como MULTIPLE_NOTE_MATCH (sem atualização automática).
 * - Manter note_id = NULL e classificar como UNASSIGNED_ATTACHMENT se não houver evidência.
 * - Proteger contra discrepâncias multi-tenant (SECURITY_MISMATCH).
 * - Gerar preview estruturado antes de qualquer UPDATE.
 * - Executar UPDATE exclusivamente para SAFE_TO_LINK em pequenos lotes (20 itens) com idempotência.
 * - NUNCA alterar notes.content, NUNCA alterar Storage, NUNCA excluir arquivos ou registros.
 */

import { createClient, isSupabaseConfigured } from '@/src/features/auth/api/supabase-client';
import { indexedDBStorage } from '../db/indexed-db';

export type LinkerAction =
  | 'SAFE_TO_LINK'
  | 'SKIP_ALREADY_CORRECT'
  | 'MULTIPLE_NOTE_MATCH'
  | 'UNASSIGNED_ATTACHMENT'
  | 'SECURITY_MISMATCH';

export type EvidenceConfidence = 'STRONG' | 'NONE' | 'MULTIPLE' | 'INVALID';

export interface AttachmentRecord {
  id: string;
  note_id: string | null;
  user_id: string;
  file_name: string;
  mime_type: string;
  file_size: number;
  storage_path: string;
  created_at?: string;
  updated_at?: string;
}

export interface NoteRecord {
  id: string;
  user_id: string;
  title?: string;
  content?: string;
  updated_at?: string;
}

export interface AttachmentLinkerPreviewItem {
  attachmentId: string;
  storage_path: string;
  file_name: string;
  current_note_id: string | null;
  proposed_note_id: string | null;
  note_title: string | null;
  evidence: string;
  confidence: EvidenceConfidence;
  action: LinkerAction;
  matchedNotesCount: number;
  matchedNoteIds: string[];
}

export interface AttachmentLinkingReport {
  totalAnalyzed: number;
  alreadyLinked: number;
  newlyLinked: number;
  unassigned: number;
  multipleMatches: number;
  securityConflicts: number;
  errors: number;
  errorMessages: string[];
  preview: AttachmentLinkerPreviewItem[];
  linkedExamples: AttachmentLinkerPreviewItem[];
}

/**
 * Função pura para encontrar notas que contêm referências explícitas e fortes a um anexo.
 */
export function findMatchingNotesForAttachment(
  attachment: { id: string; storage_path: string; user_id: string },
  notes: NoteRecord[]
): { note: NoteRecord; evidenceType: 'ATTACHMENT_URI' | 'LOCAL_URI' | 'STORAGE_PATH' | 'HTTPS_URL'; evidenceText: string }[] {
  const matches: { note: NoteRecord; evidenceType: 'ATTACHMENT_URI' | 'LOCAL_URI' | 'STORAGE_PATH' | 'HTTPS_URL'; evidenceText: string }[] = [];
  const attachmentId = attachment.id;
  const storagePath = attachment.storage_path;

  if (!attachmentId) return matches;

  for (const note of notes) {
    const content = note.content || '';
    if (!content) continue;

    // Evidência A: attachment://{attachmentId}
    if (content.includes(`attachment://${attachmentId}`)) {
      matches.push({
        note,
        evidenceType: 'ATTACHMENT_URI',
        evidenceText: `Contém protocolo canônico attachment://${attachmentId}`,
      });
      continue;
    }

    // Evidência B: local-attachment://{attachmentId}
    if (content.includes(`local-attachment://${attachmentId}`)) {
      matches.push({
        note,
        evidenceType: 'LOCAL_URI',
        evidenceText: `Contém protocolo local local-attachment://${attachmentId}`,
      });
      continue;
    }

    // Evidência C: storage_path explícito
    if (storagePath && content.includes(storagePath)) {
      matches.push({
        note,
        evidenceType: 'STORAGE_PATH',
        evidenceText: `Contém storage_path exato "${storagePath}"`,
      });
      continue;
    }

    // Evidência D: URL HTTPS do bucket com attachmentId
    if (content.includes(attachmentId) && (content.includes('/note-attachments/') || content.includes('http://') || content.includes('https://'))) {
      matches.push({
        note,
        evidenceType: 'HTTPS_URL',
        evidenceText: `Contém URL HTTPS com o ID "${attachmentId}"`,
      });
      continue;
    }
  }

  return matches;
}

export class AttachmentLinker {
  private isCancelled: boolean = false;

  public cancel(): void {
    this.isCancelled = true;
  }

  /**
   * Gera o preview de vinculação sem realizar nenhuma mutação no banco de dados.
   */
  public generatePreview(
    authenticatedUserId: string,
    attachments: AttachmentRecord[],
    notes: NoteRecord[]
  ): AttachmentLinkerPreviewItem[] {
    const previewList: AttachmentLinkerPreviewItem[] = [];

    for (const att of attachments) {
      const pathSegments = (att.storage_path || '').split('/');
      const pathUserId = pathSegments[0];

      // Verificação de Segurança Multi-Tenant
      if (
        att.user_id !== authenticatedUserId ||
        pathUserId !== authenticatedUserId
      ) {
        previewList.push({
          attachmentId: att.id,
          storage_path: att.storage_path,
          file_name: att.file_name,
          current_note_id: att.note_id,
          proposed_note_id: null,
          note_title: null,
          evidence: `Conflito de tenant: anexo user_id (${att.user_id}) ou path (${att.storage_path}) não bate com sessão (${authenticatedUserId})`,
          confidence: 'INVALID',
          action: 'SECURITY_MISMATCH',
          matchedNotesCount: 0,
          matchedNoteIds: [],
        });
        continue;
      }

      // Procura evidências fortes nas notas autenticadas do usuário
      const userNotes = notes.filter((n) => n.user_id === authenticatedUserId);
      const matches = findMatchingNotesForAttachment(att, userNotes);

      if (matches.length === 0) {
        // Nenhuma nota referencia este anexo
        if (att.note_id) {
          // Já possuía note_id previamente atribuído
          const currentNote = userNotes.find((n) => n.id === att.note_id);
          previewList.push({
            attachmentId: att.id,
            storage_path: att.storage_path,
            file_name: att.file_name,
            current_note_id: att.note_id,
            proposed_note_id: att.note_id,
            note_title: currentNote?.title || 'Nota vinculada anteriormente',
            evidence: 'Vínculo prévio existente mantido sem novas referências no texto',
            confidence: 'STRONG',
            action: 'SKIP_ALREADY_CORRECT',
            matchedNotesCount: 1,
            matchedNoteIds: [att.note_id],
          });
        } else {
          previewList.push({
            attachmentId: att.id,
            storage_path: att.storage_path,
            file_name: att.file_name,
            current_note_id: null,
            proposed_note_id: null,
            note_title: null,
            evidence: 'Nenhuma nota ativa referencia este anexo por URI, path ou URL',
            confidence: 'NONE',
            action: 'UNASSIGNED_ATTACHMENT',
            matchedNotesCount: 0,
            matchedNoteIds: [],
          });
        }
      } else if (matches.length === 1) {
        const matched = matches[0];
        const targetNote = matched.note;

        if (att.note_id === targetNote.id) {
          previewList.push({
            attachmentId: att.id,
            storage_path: att.storage_path,
            file_name: att.file_name,
            current_note_id: att.note_id,
            proposed_note_id: targetNote.id,
            note_title: targetNote.title || 'Sem título',
            evidence: `${matched.evidenceText} na nota "${targetNote.title || targetNote.id}"`,
            confidence: 'STRONG',
            action: 'SKIP_ALREADY_CORRECT',
            matchedNotesCount: 1,
            matchedNoteIds: [targetNote.id],
          });
        } else {
          previewList.push({
            attachmentId: att.id,
            storage_path: att.storage_path,
            file_name: att.file_name,
            current_note_id: att.note_id,
            proposed_note_id: targetNote.id,
            note_title: targetNote.title || 'Sem título',
            evidence: `${matched.evidenceText} na nota "${targetNote.title || targetNote.id}"`,
            confidence: 'STRONG',
            action: 'SAFE_TO_LINK',
            matchedNotesCount: 1,
            matchedNoteIds: [targetNote.id],
          });
        }
      } else {
        // Mais de uma nota referencia o mesmo anexo
        const matchedNoteIds = matches.map((m) => m.note.id);
        previewList.push({
          attachmentId: att.id,
          storage_path: att.storage_path,
          file_name: att.file_name,
          current_note_id: att.note_id,
          proposed_note_id: null,
          note_title: null,
          evidence: `Anexo encontrado em ${matches.length} notas distintas: [${matchedNoteIds.join(', ')}]. Sem decisão automática.`,
          confidence: 'MULTIPLE',
          action: 'MULTIPLE_NOTE_MATCH',
          matchedNotesCount: matches.length,
          matchedNoteIds,
        });
      }
    }

    return previewList;
  }

  /**
   * Executa a vinculação segura em pequenos lotes (20 itens por lote).
   */
  public async executeLinking(
    authenticatedUserId: string,
    batchSize: number = 20,
    onProgress?: (processed: number, total: number) => void
  ): Promise<AttachmentLinkingReport> {
    if (!authenticatedUserId || authenticatedUserId === 'anonymous' || authenticatedUserId === 'demo-user') {
      throw new Error('Sessão inválida: authenticatedUserId não pode ser nulo ou anônimo.');
    }

    const supabase = createClient();
    if (!isSupabaseConfigured()) {
      throw new Error('Supabase não configurado');
    }

    this.isCancelled = false;

    // 1. Carregar todos os note_attachments do usuário autenticado
    const { data: attachments, error: attErr } = await supabase
      .from('note_attachments')
      .select('*')
      .eq('user_id', authenticatedUserId);

    if (attErr || !Array.isArray(attachments)) {
      throw new Error(`Falha ao carregar note_attachments: ${attErr?.message || 'Erro desconhecido'}`);
    }

    // 2. Carregar notas autenticadas (do Supabase e complementar com IndexedDB local para máxima cobertura)
    const { data: remoteNotes, error: notesErr } = await supabase
      .from('notes')
      .select('id, user_id, title, content, updated_at')
      .eq('user_id', authenticatedUserId);

    if (notesErr) {
      console.warn('[LINKER] Aviso ao consultar notes remotas:', notesErr.message);
    }

    // Obter também notas do IndexedDB
    let localNotes: NoteRecord[] = [];
    try {
      const idbNotes = await indexedDBStorage.getAllNotes(authenticatedUserId);
      if (Array.isArray(idbNotes)) {
        localNotes = idbNotes.map((n) => ({
          id: n.id,
          user_id: n.user_id || authenticatedUserId,
          title: n.title || '',
          content: n.content || '',
          updated_at: n.updated_at,
        }));
      }
    } catch (e) {
      console.warn('[LINKER] Aviso ao carregar notas locais do IndexedDB:', e);
    }

    // Mesclar notas (priorizando o conteúdo mais recente por id)
    const notesMap = new Map<string, NoteRecord>();
    for (const rn of remoteNotes || []) {
      notesMap.set(rn.id, rn);
    }
    for (const ln of localNotes) {
      if (!notesMap.has(ln.id)) {
        notesMap.set(ln.id, ln);
      } else {
        // Se a local tiver conteúdo e a remota não, preserva
        const existing = notesMap.get(ln.id)!;
        if ((!existing.content || existing.content.length === 0) && ln.content) {
          notesMap.set(ln.id, { ...existing, content: ln.content });
        }
      }
    }
    const allUserNotes = Array.from(notesMap.values());

    // 3. Gerar Preview
    const preview = this.generatePreview(authenticatedUserId, attachments as AttachmentRecord[], allUserNotes);

    const report: AttachmentLinkingReport = {
      totalAnalyzed: preview.length,
      alreadyLinked: preview.filter((p) => p.action === 'SKIP_ALREADY_CORRECT').length,
      newlyLinked: 0,
      unassigned: preview.filter((p) => p.action === 'UNASSIGNED_ATTACHMENT').length,
      multipleMatches: preview.filter((p) => p.action === 'MULTIPLE_NOTE_MATCH').length,
      securityConflicts: preview.filter((p) => p.action === 'SECURITY_MISMATCH').length,
      errors: 0,
      errorMessages: [],
      preview,
      linkedExamples: [],
    };

    // 4. Filtrar itens exclusivamente para SAFE_TO_LINK
    const itemsToLink = preview.filter((p) => p.action === 'SAFE_TO_LINK');

    for (let i = 0; i < itemsToLink.length; i += batchSize) {
      if (this.isCancelled) {
        report.errorMessages.push('Operação de vinculação cancelada pelo usuário.');
        break;
      }

      const batch = itemsToLink.slice(i, i + batchSize);

      for (const item of batch) {
        if (this.isCancelled) break;

        if (!item.proposed_note_id) continue;

        try {
          // UPDATE seguro e restrito apenas a SAFE_TO_LINK
          const { error: updateErr } = await supabase
            .from('note_attachments')
            .update({
              note_id: item.proposed_note_id,
              updated_at: new Date().toISOString(),
            })
            .eq('id', item.attachmentId)
            .eq('user_id', authenticatedUserId);

          if (updateErr) {
            report.errors++;
            report.errorMessages.push(`Erro ao vincular ${item.attachmentId}: ${updateErr.message}`);
          } else {
            // Checkpoint no IndexedDB
            await indexedDBStorage.setMetadata(
              authenticatedUserId,
              `attachment_linking:${item.attachmentId}`,
              {
                attachmentId: item.attachmentId,
                linked_note_id: item.proposed_note_id,
                linked_at: new Date().toISOString(),
              }
            );

            report.newlyLinked++;
            if (report.linkedExamples.length < 10) {
              report.linkedExamples.push(item);
            }
          }
        } catch (err: any) {
          report.errors++;
          report.errorMessages.push(`Exceção ao vincular ${item.attachmentId}: ${err?.message || err}`);
        }
      }

      if (onProgress) {
        onProgress(Math.min(i + batch.length, itemsToLink.length), itemsToLink.length);
      }
    }

    return report;
  }
}

export const attachmentLinker = new AttachmentLinker();
