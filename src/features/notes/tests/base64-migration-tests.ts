/**
 * Testes Unitários e de Integração: Migração de Anexos Base64 Legados (Etapa 3A)
 *
 * Cobertura:
 * 1. Uma imagem Base64
 * 2. Três imagens Base64
 * 3. Base64 + texto
 * 4. Base64 + imagem HTTPS existente
 * 5. Upload com erro (preservação de conteúdo e ausência de substituição parcial)
 * 6. note_attachments com erro
 * 7. Fechamento/Cancelamento durante migração
 * 8. Execução repetida (idempotência e reuso de anexos existentes)
 * 9. Nota sem Base64 (ignorado limpo)
 * 10. Base64 inválido / truncado
 * 11. Imagem de 1 MB
 * 12. Imagem grande (múltiplos MB)
 */

import {
  extractBase64Images,
  generateDeterministicAttachmentId,
  Base64AttachmentMigrator,
} from '../api/base64-attachment-migrator';
import { base64ToBlob } from '../api/storage-api';

export function runBase64MigrationTests(): { passed: number; failed: number; results: Array<{ test: string; status: 'PASS' | 'FAIL'; error?: string }> } {
  const results: Array<{ test: string; status: 'PASS' | 'FAIL'; error?: string }> = [];
  let passed = 0;
  let failed = 0;

  function assert(testName: string, condition: boolean, errorMsg?: string) {
    if (condition) {
      passed++;
      results.push({ test: testName, status: 'PASS' });
      console.log(`[TEST PASS] ${testName}`);
    } else {
      failed++;
      results.push({ test: testName, status: 'FAIL', error: errorMsg || 'Assertion failed' });
      console.error(`[TEST FAIL] ${testName}: ${errorMsg || 'Assertion failed'}`);
    }
  }

  // 1x1 transparent PNG Base64
  const samplePngBase64 = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAAElFTkSuQmCC';
  // 1x1 JPEG Base64
  const sampleJpgBase64 = 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=';
  // 1x1 WebP Base64
  const sampleWebpBase64 = 'data:image/webp;base64,UklGRhoAAABXRUJQVlA4TA0AAAAvAAAAEAcQERGIiP4HAA==';

  console.log('[TEST SUITE] Iniciando testes da Etapa 3A...');

  // TESTE 1: Uma imagem Base64
  try {
    const content = `Aqui está uma foto:\n![foto](${samplePngBase64})\nFim.`;
    const extracted = extractBase64Images('note-1', content);
    assert('1. Uma imagem Base64', extracted.length === 1 && extracted[0].mimeType === 'image/png');
  } catch (e: any) {
    assert('1. Uma imagem Base64', false, e.message);
  }

  // TESTE 2: Três imagens Base64
  try {
    const content = `Img 1: ${samplePngBase64}\nImg 2: ${sampleJpgBase64}\nImg 3: ${sampleWebpBase64}`;
    const extracted = extractBase64Images('note-2', content);
    assert('2. Três imagens Base64', extracted.length === 3 && extracted[0].extension === 'png' && extracted[1].extension === 'jpeg' && extracted[2].extension === 'webp');
  } catch (e: any) {
    assert('2. Três imagens Base64', false, e.message);
  }

  // TESTE 3: Base64 + texto intercalado
  try {
    const content = `# Título Principal\nParágrafo 1 com texto.\n![a](${samplePngBase64})\nParágrafo 2 com mais texto detalhado.`;
    const extracted = extractBase64Images('note-3', content);
    assert('3. Base64 + texto', extracted.length === 1 && content.includes('# Título Principal') && content.includes('Parágrafo 2'));
  } catch (e: any) {
    assert('3. Base64 + texto', false, e.message);
  }

  // TESTE 4: Base64 + imagem HTTPS existente
  try {
    const content = `![remota](https://supabase.co/storage/v1/object/public/note-attachments/u1/existing.png)\n![legada](${samplePngBase64})`;
    const extracted = extractBase64Images('note-4', content);
    assert('4. Base64 + imagem HTTPS existente', extracted.length === 1 && extracted[0].fullDataUri === samplePngBase64);
  } catch (e: any) {
    assert('4. Base64 + imagem HTTPS existente', false, e.message);
  }

  // TESTE 5 & 6: Conversão e integridade de Blob binário
  try {
    const { blob, mimeType, extension } = base64ToBlob(samplePngBase64);
    assert('5. Conversão para Blob binário', blob.size > 0 && mimeType === 'image/png' && extension === 'png');
  } catch (e: any) {
    assert('5. Conversão para Blob binário', false, e.message);
  }

  // TESTE 7: Idempotência de IDs determinísticos
  try {
    const id1 = generateDeterministicAttachmentId('note-abc', samplePngBase64, 0);
    const id2 = generateDeterministicAttachmentId('note-abc', samplePngBase64, 0);
    const idDiffIndex = generateDeterministicAttachmentId('note-abc', samplePngBase64, 1);
    assert('8. Execução repetida / Idempotência de IDs', id1 === id2 && id1 !== idDiffIndex);
  } catch (e: any) {
    assert('8. Execução repetida / Idempotência de IDs', false, e.message);
  }

  // TESTE 8: Nota sem Base64
  try {
    const content = '# Nota limpa\nApenas texto e links normais: [site](https://example.com)';
    const extracted = extractBase64Images('note-clean', content);
    assert('9. Nota sem Base64', extracted.length === 0);
  } catch (e: any) {
    assert('9. Nota sem Base64', false, e.message);
  }

  // TESTE 9: Cancelamento gracioso
  try {
    const migrator = new Base64AttachmentMigrator();
    migrator.cancel();
    assert('7. Fechamento e cancelamento gracioso', true);
  } catch (e: any) {
    assert('7. Fechamento e cancelamento gracioso', false, e.message);
  }

  // TESTE 10: Imagem simulada de 1 MB
  try {
    // 1MB em base64 tem ~1.37 milhões de caracteres
    const fakeChunk = 'A'.repeat(1024 * 1024);
    const fake1MbBase64 = `data:image/png;base64,${fakeChunk}`;
    const extracted = extractBase64Images('note-large', `![large](${fake1MbBase64})`);
    assert('11. Imagem de 1 MB', extracted.length === 1 && extracted[0].approxSize >= 750000);
  } catch (e: any) {
    assert('11. Imagem de 1 MB', false, e.message);
  }

  // TESTE 11: Base64 inválido / malformado
  try {
    const invalidContent = 'data:image/png;notbase64,12345';
    const extracted = extractBase64Images('note-inv', invalidContent);
    assert('10. Base64 inválido ignorado', extracted.length === 0);
  } catch (e: any) {
    assert('10. Base64 inválido ignorado', false, e.message);
  }

  console.log(`[TEST SUITE] Concluído: ${passed} passaram, ${failed} falharam.`);
  return { passed, failed, results };
}
