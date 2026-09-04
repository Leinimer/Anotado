'use client';

import React, { useState, useEffect } from 'react';
import {
  X,
  Lock,
  Mail,
  Download,
  KeyRound,
  CheckCircle2,
  AlertCircle,
  Loader2,
  FileText,
  ShieldCheck,
  Smartphone,
  Share,
  PlusSquare,
  Sparkles,
  Monitor,
  Users,
} from 'lucide-react';
import { createClient, isSupabaseConfigured } from '@/src/features/auth/api/supabase-client';
import { Note } from '../types';
import { exportNonArchivedNotesToZip, ExportProgress } from '../utils/export-notes';
import { usePwa } from '@/src/features/pwa/PwaProvider';
import { SettingsSharingTab } from '@/src/features/diary/ui/SettingsSharingTab';

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  userId: string;
  notes: Note[];
  userEmail?: string;
  initialTab?: TabType;
  onOpenShareModal?: () => void;
}

type TabType = 'password' | 'email' | 'export' | 'pwa' | 'sharing';

export function SettingsModal({
  isOpen,
  onClose,
  userId,
  notes,
  userEmail: initialUserEmail = '',
  initialTab = 'password',
  onOpenShareModal,
}: SettingsModalProps) {
  const [activeTab, setActiveTab] = useState<TabType>(initialTab);
  const [prevInitialTab, setPrevInitialTab] = useState<TabType>(initialTab);
  if (initialTab !== prevInitialTab) {
    setPrevInitialTab(initialTab);
    setActiveTab(initialTab);
  }
  const [userEmail, setUserEmail] = useState<string>(initialUserEmail);
  const { isStandalone, canInstall, isIos, promptInstall } = usePwa();

  // Estados da Aba: Alterar Senha
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [passwordLoading, setPasswordLoading] = useState(false);
  const [passwordSuccess, setPasswordSuccess] = useState<string | null>(null);
  const [passwordError, setPasswordError] = useState<string | null>(null);

  // Estados da Aba: Alterar E-mail
  const [newEmail, setNewEmail] = useState('');
  const [emailLoading, setEmailLoading] = useState(false);
  const [emailSuccess, setEmailSuccess] = useState<string | null>(null);
  const [emailError, setEmailError] = useState<string | null>(null);

  // Estados da Aba: Exportar Notas
  const [exportProgress, setExportProgress] = useState<ExportProgress | null>(null);
  const [isExporting, setIsExporting] = useState(false);

  // Carrega e-mail atual do Supabase caso não fornecido
  useEffect(() => {
    if (isOpen) {
      let isCancelled = false;
      const supabase = createClient();
      const loadUser = async () => {
        try {
          const { data } = await supabase.auth.getUser();
          if (isCancelled) return;
          if (data?.user?.email) {
            setUserEmail(data.user.email);
          }
        } catch {
          // Ignora falha silenciosamente caso offline
        }
      };
      loadUser();
      return () => {
        isCancelled = true;
      };
    }
  }, [isOpen]);

  // Tecla ESC para fechar modal
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  // Handler: Alterar Senha
  const handleChangePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setPasswordError(null);
    setPasswordSuccess(null);

    if (!newPassword) {
      setPasswordError('Por favor, digite a nova senha.');
      return;
    }

    if (newPassword.length < 6) {
      setPasswordError('A nova senha deve ter pelo menos 6 caracteres.');
      return;
    }

    if (newPassword !== confirmPassword) {
      setPasswordError('A confirmação de senha não confere com a nova senha.');
      return;
    }

    setPasswordLoading(true);
    const supabase = createClient();

    try {
      if (isSupabaseConfigured()) {
        // Se a senha atual foi informada e o email está disponível, valida credenciais atuais
        if (currentPassword && userEmail) {
          const { error: signInError } = await supabase.auth.signInWithPassword({
            email: userEmail,
            password: currentPassword,
          });
          if (signInError) {
            setPasswordError('A senha atual informada está incorreta.');
            setPasswordLoading(false);
            return;
          }
        }

        const { error } = await supabase.auth.updateUser({
          password: newPassword,
        });

        if (error) {
          setPasswordError(error.message || 'Falha ao atualizar a senha.');
        } else {
          setPasswordSuccess('Senha alterada com sucesso.');
          setCurrentPassword('');
          setNewPassword('');
          setConfirmPassword('');
        }
      } else {
        // Modo local/demo
        setPasswordSuccess('Senha alterada com sucesso no ambiente de demonstração.');
        setCurrentPassword('');
        setNewPassword('');
        setConfirmPassword('');
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Erro inesperado ao alterar senha.';
      setPasswordError(message);
    } finally {
      setPasswordLoading(false);
    }
  };

  // Handler: Alterar E-mail
  const handleChangeEmail = async (e: React.FormEvent) => {
    e.preventDefault();
    setEmailError(null);
    setEmailSuccess(null);

    const cleanEmail = newEmail.trim().toLowerCase();
    if (!cleanEmail) {
      setEmailError('Por favor, informe o novo endereço de e-mail.');
      return;
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(cleanEmail)) {
      setEmailError('Por favor, insira um e-mail com formato válido.');
      return;
    }

    if (cleanEmail === userEmail.toLowerCase()) {
      setEmailError('O novo e-mail deve ser diferente do e-mail atual.');
      return;
    }

    setEmailLoading(true);
    const supabase = createClient();

    try {
      if (isSupabaseConfigured()) {
        const { error } = await supabase.auth.updateUser({
          email: cleanEmail,
        });

        if (error) {
          setEmailError(error.message || 'Falha ao solicitar alteração de e-mail.');
        } else {
          setEmailSuccess(
            'Enviamos um e-mail de confirmação para o novo endereço. Por favor, verifique sua caixa de entrada.'
          );
          setNewEmail('');
        }
      } else {
        // Modo local/demo
        setUserEmail(cleanEmail);
        setEmailSuccess('E-mail atualizado com sucesso no ambiente de demonstração.');
        setNewEmail('');
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Erro inesperado ao alterar e-mail.';
      setEmailError(message);
    } finally {
      setEmailLoading(false);
    }
  };

  // Handler: Exportar Notas
  const handleExportNotes = async () => {
    if (isExporting) return;
    setIsExporting(true);
    setExportProgress({
      current: 0,
      total: 0,
      status: 'fetching',
    });

    try {
      const result = await exportNonArchivedNotesToZip(userId, notes, (progress) => {
        setExportProgress(progress);
      });

      if (!result.success) {
        setExportProgress({
          current: 0,
          total: 0,
          status: 'error',
          errorMessage: result.error || 'Erro ao exportar notas.',
        });
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Erro ao exportar notas.';
      setExportProgress({
        current: 0,
        total: 0,
        status: 'error',
        errorMessage: message,
      });
    } finally {
      setIsExporting(false);
    }
  };

  const nonArchivedCount = notes.filter((n) => !n.is_archived && n.folder_id !== 'system-archive-folder').length;

  return (
    <div
      id="settings-modal-overlay"
      className="fixed inset-0 z-[9999] bg-black/45 backdrop-blur-xs flex items-center justify-center p-4 animate-in fade-in duration-150"
      onClick={onClose}
    >
      <div
        id="settings-modal-card"
        className="w-full max-w-lg bg-[#ffffff] border border-[#e4e2dd] shadow-2xl rounded-3xl overflow-hidden text-[#1b1c19] flex flex-col max-h-[90vh] animate-in zoom-in-95 duration-150"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Cabeçalho do Modal */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-[#f0eee9] bg-[#fbfaf8]">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-xl bg-[#f0eee9] text-[#68594d] flex items-center justify-center">
              <ShieldCheck className="w-4 h-4" />
            </div>
            <div>
              <h2 className="font-serif-note font-bold text-base text-[#1b1c19]">
                CONFIGURAÇÕES
              </h2>
              <p className="font-sans-ui text-xs text-[#7f756e]">
                Gerenciamento de conta e dados
              </p>
            </div>
          </div>

          <button
            type="button"
            id="settings-modal-close-btn"
            onClick={onClose}
            className="p-1.5 rounded-xl text-[#7f756e] hover:text-[#1b1c19] hover:bg-[#f0eee9] transition-colors cursor-pointer"
            title="Fechar (ESC)"
            aria-label="Fechar"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Abas de Navegação */}
        <div className="flex border-b border-[#f0eee9] bg-[#fbfaf8] px-6 gap-2">
          <button
            type="button"
            id="settings-tab-password"
            onClick={() => setActiveTab('password')}
            className={`flex items-center gap-1.5 py-3 px-3 text-xs font-medium border-b-2 transition-colors cursor-pointer ${
              activeTab === 'password'
                ? 'border-[#68594d] text-[#68594d]'
                : 'border-transparent text-[#7f756e] hover:text-[#1b1c19]'
            }`}
          >
            <Lock className="w-3.5 h-3.5" />
            Alterar senha
          </button>

          <button
            type="button"
            id="settings-tab-email"
            onClick={() => setActiveTab('email')}
            className={`flex items-center gap-1.5 py-3 px-3 text-xs font-medium border-b-2 transition-colors cursor-pointer ${
              activeTab === 'email'
                ? 'border-[#68594d] text-[#68594d]'
                : 'border-transparent text-[#7f756e] hover:text-[#1b1c19]'
            }`}
          >
            <Mail className="w-3.5 h-3.5" />
            Alterar e-mail
          </button>

          <button
            type="button"
            id="settings-tab-export"
            onClick={() => setActiveTab('export')}
            className={`flex items-center gap-1.5 py-3 px-3 text-xs font-medium border-b-2 transition-colors cursor-pointer ${
              activeTab === 'export'
                ? 'border-[#68594d] text-[#68594d]'
                : 'border-transparent text-[#7f756e] hover:text-[#1b1c19]'
            }`}
          >
            <Download className="w-3.5 h-3.5" />
            Exportar notas
          </button>

          <button
            type="button"
            id="settings-tab-pwa"
            onClick={() => setActiveTab('pwa')}
            className={`flex items-center gap-1.5 py-3 px-3 text-xs font-medium border-b-2 transition-colors cursor-pointer ${
              activeTab === 'pwa'
                ? 'border-[#68594d] text-[#68594d]'
                : 'border-transparent text-[#7f756e] hover:text-[#1b1c19]'
            }`}
          >
            <Smartphone className="w-3.5 h-3.5" />
            Aplicativo (PWA)
          </button>

          <button
            type="button"
            id="settings-tab-sharing"
            onClick={() => setActiveTab('sharing')}
            className={`flex items-center gap-1.5 py-3 px-3 text-xs font-medium border-b-2 transition-colors cursor-pointer ${
              activeTab === 'sharing'
                ? 'border-[#68594d] text-[#68594d]'
                : 'border-transparent text-[#7f756e] hover:text-[#1b1c19]'
            }`}
          >
            <Users className="w-3.5 h-3.5" />
            Compartilhamento
          </button>
        </div>

        {/* Conteúdo da Aba Ativa */}
        <div className="p-6 overflow-y-auto flex-1 font-sans-ui text-sm">
          {/* ============================================================ */}
          {/* ABA 1: ALTERAR SENHA                                         */}
          {/* ============================================================ */}
          {activeTab === 'password' && (
            <form onSubmit={handleChangePassword} className="space-y-4">
              {passwordSuccess && (
                <div className="p-3 bg-[#eef8f2] border border-[#a3e635]/40 text-[#166534] rounded-2xl flex items-start gap-2 text-xs">
                  <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5" />
                  <span>{passwordSuccess}</span>
                </div>
              )}

              {passwordError && (
                <div className="p-3 bg-[#fceded] border border-[#ba1a1a]/30 text-[#ba1a1a] rounded-2xl flex items-start gap-2 text-xs">
                  <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                  <span>{passwordError}</span>
                </div>
              )}

              <div>
                <label className="block text-xs font-medium text-[#4e453f] mb-1">
                  Senha atual (opcional)
                </label>
                <input
                  type="password"
                  id="settings-current-password"
                  value={currentPassword}
                  onChange={(e) => setCurrentPassword(e.target.value)}
                  placeholder="Sua senha atual"
                  className="w-full px-3.5 py-2 text-xs rounded-xl border border-[#e4e2dd] bg-[#fbfaf8] text-[#1b1c19] focus:outline-none focus:border-[#68594d]"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-[#4e453f] mb-1">
                  Nova senha
                </label>
                <input
                  type="password"
                  id="settings-new-password"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  placeholder="Mínimo 6 caracteres"
                  required
                  className="w-full px-3.5 py-2 text-xs rounded-xl border border-[#e4e2dd] bg-[#fbfaf8] text-[#1b1c19] focus:outline-none focus:border-[#68594d]"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-[#4e453f] mb-1">
                  Confirmar nova senha
                </label>
                <input
                  type="password"
                  id="settings-confirm-password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  placeholder="Repita a nova senha"
                  required
                  className="w-full px-3.5 py-2 text-xs rounded-xl border border-[#e4e2dd] bg-[#fbfaf8] text-[#1b1c19] focus:outline-none focus:border-[#68594d]"
                />
              </div>

              <div className="pt-2">
                <button
                  type="submit"
                  id="settings-submit-password-btn"
                  disabled={passwordLoading}
                  className="w-full py-2.5 px-4 bg-[#68594d] hover:bg-[#4a3728] text-white text-xs font-medium rounded-xl transition-colors cursor-pointer flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed shadow-2xs"
                >
                  {passwordLoading ? (
                    <>
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      Alterando senha...
                    </>
                  ) : (
                    <>
                      <KeyRound className="w-3.5 h-3.5" />
                      Alterar senha
                    </>
                  )}
                </button>
              </div>
            </form>
          )}

          {/* ============================================================ */}
          {/* ABA 2: ALTERAR E-MAIL                                        */}
          {/* ============================================================ */}
          {activeTab === 'email' && (
            <form onSubmit={handleChangeEmail} className="space-y-4">
              {emailSuccess && (
                <div className="p-3 bg-[#eef8f2] border border-[#a3e635]/40 text-[#166534] rounded-2xl flex items-start gap-2 text-xs">
                  <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5" />
                  <span>{emailSuccess}</span>
                </div>
              )}

              {emailError && (
                <div className="p-3 bg-[#fceded] border border-[#ba1a1a]/30 text-[#ba1a1a] rounded-2xl flex items-start gap-2 text-xs">
                  <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                  <span>{emailError}</span>
                </div>
              )}

              <div>
                <label className="block text-xs font-medium text-[#7f756e] mb-1">
                  E-mail atual
                </label>
                <div className="px-3.5 py-2 text-xs rounded-xl border border-[#e4e2dd] bg-[#f0eee9]/60 text-[#4e453f] font-mono">
                  {userEmail || 'Não identificado'}
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-[#4e453f] mb-1">
                  Novo e-mail
                </label>
                <input
                  type="email"
                  id="settings-new-email"
                  value={newEmail}
                  onChange={(e) => setNewEmail(e.target.value)}
                  placeholder="novo.email@exemplo.com"
                  required
                  className="w-full px-3.5 py-2 text-xs rounded-xl border border-[#e4e2dd] bg-[#fbfaf8] text-[#1b1c19] focus:outline-none focus:border-[#68594d]"
                />
                <p className="mt-1 text-[11px] text-[#7f756e]">
                  O Supabase enviará um link de confirmação para validar a alteração.
                </p>
              </div>

              <div className="pt-2">
                <button
                  type="submit"
                  id="settings-submit-email-btn"
                  disabled={emailLoading}
                  className="w-full py-2.5 px-4 bg-[#68594d] hover:bg-[#4a3728] text-white text-xs font-medium rounded-xl transition-colors cursor-pointer flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed shadow-2xs"
                >
                  {emailLoading ? (
                    <>
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      Atualizando e-mail...
                    </>
                  ) : (
                    <>
                      <Mail className="w-3.5 h-3.5" />
                      Alterar e-mail
                    </>
                  )}
                </button>
              </div>
            </form>
          )}

          {/* ============================================================ */}
          {/* ABA 3: EXPORTAR NOTAS                                        */}
          {/* ============================================================ */}
          {activeTab === 'export' && (
            <div className="space-y-4">
              <div className="p-4 bg-[#fbfaf8] border border-[#e4e2dd] rounded-2xl space-y-2">
                <div className="flex items-center gap-2">
                  <FileText className="w-4 h-4 text-[#68594d]" />
                  <h3 className="font-serif-note font-bold text-sm text-[#1b1c19]">
                    Exportar todas as notas
                  </h3>
                </div>
                <p className="text-xs text-[#7f756e] leading-relaxed">
                  Baixe todas as suas notas não arquivadas em arquivos Markdown padrão (.md)
                  empacotados em um único arquivo compactado (.zip).
                </p>
                <div className="text-[11px] text-[#4e453f] pt-1 font-medium">
                  {nonArchivedCount === 1
                    ? '1 nota disponível para exportação.'
                    : `${nonArchivedCount} notas disponíveis para exportação.`}
                </div>
              </div>

              {/* Status e Progresso da Exportação */}
              {exportProgress && (
                <div className="space-y-2">
                  {exportProgress.status === 'processing' && (
                    <div className="p-3 bg-[#f0eee9] rounded-2xl space-y-2 text-xs">
                      <div className="flex items-center justify-between text-[#4e453f]">
                        <span className="flex items-center gap-1.5">
                          <Loader2 className="w-3.5 h-3.5 animate-spin text-[#68594d]" />
                          Exportando notas...
                        </span>
                        <span className="font-mono text-[11px]">
                          {exportProgress.current} de {exportProgress.total}
                        </span>
                      </div>
                      {exportProgress.currentNoteTitle && (
                        <div className="text-[11px] text-[#7f756e] truncate">
                          Processando: {exportProgress.currentNoteTitle}
                        </div>
                      )}
                      {/* Barra de Progresso Visual */}
                      <div className="w-full h-1.5 bg-[#e4e2dd] rounded-full overflow-hidden">
                        <div
                          className="h-full bg-[#68594d] transition-all duration-150"
                          style={{
                            width: `${(exportProgress.current / Math.max(exportProgress.total, 1)) * 100}%`,
                          }}
                        />
                      </div>
                    </div>
                  )}

                  {exportProgress.status === 'zipping' && (
                    <div className="p-3 bg-[#f0eee9] rounded-2xl flex items-center gap-2 text-xs text-[#4e453f]">
                      <Loader2 className="w-3.5 h-3.5 animate-spin text-[#68594d]" />
                      <span>Gerando arquivo compactado (.zip)...</span>
                    </div>
                  )}

                  {exportProgress.status === 'completed' && (
                    <div className="p-3 bg-[#eef8f2] border border-[#a3e635]/40 text-[#166534] rounded-2xl flex items-center gap-2 text-xs">
                      <CheckCircle2 className="w-4 h-4 shrink-0" />
                      <span>
                        Exportação concluída! {exportProgress.total} notas exportadas com sucesso.
                      </span>
                    </div>
                  )}

                  {exportProgress.status === 'error' && (
                    <div className="p-3 bg-[#fceded] border border-[#ba1a1a]/30 text-[#ba1a1a] rounded-2xl flex items-start gap-2 text-xs">
                      <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                      <div>
                        <div className="font-semibold">Erro ao exportar:</div>
                        <div>{exportProgress.errorMessage}</div>
                      </div>
                    </div>
                  )}
                </div>
              )}

              <div className="pt-2">
                <button
                  type="button"
                  id="settings-export-notes-btn"
                  onClick={handleExportNotes}
                  disabled={isExporting || nonArchivedCount === 0}
                  className="w-full py-2.5 px-4 bg-[#68594d] hover:bg-[#4a3728] text-white text-xs font-medium rounded-xl transition-colors cursor-pointer flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed shadow-2xs"
                >
                  {isExporting ? (
                    <>
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      Exportando notas...
                    </>
                  ) : (
                    <>
                      <Download className="w-3.5 h-3.5" />
                      Exportar notas (.zip)
                    </>
                  )}
                </button>
              </div>
            </div>
          )}

          {/* ============================================================ */}
          {/* ABA 4: PROGRESSIVE WEB APP (PWA)                             */}
          {/* ============================================================ */}
          {activeTab === 'pwa' && (
            <div className="space-y-4">
              <div className="p-4 bg-[#fbfaf8] border border-[#f0eee9] rounded-2xl space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2.5">
                    <div className="w-8 h-8 rounded-xl bg-[#68594d] text-white flex items-center justify-center font-serif-note font-bold text-sm shadow-xs">
                      A!
                    </div>
                    <div>
                      <h3 className="font-serif-note font-bold text-sm text-[#1b1c19]">
                        ANOTADO!
                      </h3>
                      <p className="font-sans-ui text-xs text-[#7f756e]">
                        Um espaço para escrever.
                      </p>
                    </div>
                  </div>

                  <span
                    className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium ${
                      isStandalone
                        ? 'bg-[#eef8f2] text-[#166534] border border-[#a3e635]/40'
                        : 'bg-[#f4dfcb]/80 text-[#68594d] border border-[#68594d]/20'
                    }`}
                  >
                    {isStandalone ? (
                      <>
                        <CheckCircle2 className="w-3 h-3" />
                        Instalado (Standalone)
                      </>
                    ) : (
                      <>
                        <Monitor className="w-3 h-3" />
                        Navegador Web
                      </>
                    )}
                  </span>
                </div>

                <p className="text-xs text-[#4e453f] leading-relaxed">
                  O ANOTADO! funciona como um aplicativo completo e instalável com suporte total a funcionamento offline, persistência via IndexedDB e sincronização automática em nuvem.
                </p>
              </div>

              {/* Ações de Instalação */}
              {isStandalone ? (
                <div className="p-4 bg-[#eef8f2] border border-[#a3e635]/40 rounded-2xl flex items-start gap-3">
                  <CheckCircle2 className="w-4 h-4 text-[#166534] shrink-0 mt-0.5" />
                  <div className="space-y-1 text-xs text-[#166534]">
                    <p className="font-semibold">
                      O aplicativo já está instalado no seu sistema!
                    </p>
                    <p className="text-[#14532d] leading-relaxed">
                      Você pode abri-lo direto da sua área de trabalho, menu Iniciar ou tela inicial do celular sem barras de navegação.
                    </p>
                  </div>
                </div>
              ) : isIos ? (
                <div className="p-4 bg-white border border-[#eae8e3] rounded-2xl space-y-3">
                  <div className="flex items-center gap-2 text-xs font-semibold text-[#1b1c19]">
                    <Smartphone className="w-4 h-4 text-[#68594d]" />
                    <span>Como instalar no iPhone ou iPad:</span>
                  </div>

                  <div className="space-y-2 text-xs text-[#4e453f]">
                    <div className="flex items-start gap-2.5 p-2 bg-[#fbfaf8] rounded-xl border border-[#f0eee9]">
                      <Share className="w-3.5 h-3.5 text-[#68594d] shrink-0 mt-0.5" />
                      <span>1. No Safari, toque no botão <strong>Compartilhar</strong> (ícone com seta para cima).</span>
                    </div>
                    <div className="flex items-start gap-2.5 p-2 bg-[#fbfaf8] rounded-xl border border-[#f0eee9]">
                      <PlusSquare className="w-3.5 h-3.5 text-[#68594d] shrink-0 mt-0.5" />
                      <span>2. Selecione a opção <strong>&quot;Adicionar à Tela de Início&quot;</strong>.</span>
                    </div>
                    <div className="flex items-start gap-2.5 p-2 bg-[#fbfaf8] rounded-xl border border-[#f0eee9]">
                      <CheckCircle2 className="w-3.5 h-3.5 text-[#68594d] shrink-0 mt-0.5" />
                      <span>3. Toque em <strong>&quot;Adicionar&quot;</strong> no canto superior direito.</span>
                    </div>
                  </div>
                </div>
              ) : canInstall ? (
                <div className="space-y-3">
                  <div className="p-4 bg-white border border-[#eae8e3] rounded-2xl space-y-2">
                    <h4 className="text-xs font-semibold text-[#1b1c19]">
                      Instalar no seu dispositivo
                    </h4>
                    <p className="text-xs text-[#4e453f] leading-relaxed">
                      Clique no botão abaixo para instalar o ANOTADO! diretamente no Android, Chrome, Edge ou Windows.
                    </p>
                  </div>

                  <button
                    type="button"
                    id="settings-pwa-install-btn"
                    onClick={promptInstall}
                    className="w-full py-2.5 px-4 bg-[#68594d] hover:bg-[#53463c] text-white text-xs font-medium rounded-xl transition-colors cursor-pointer flex items-center justify-center gap-2 shadow-2xs"
                  >
                    <Download className="w-3.5 h-3.5" />
                    <span>Instalar ANOTADO!</span>
                  </button>
                </div>
              ) : (
                <div className="p-4 bg-white border border-[#eae8e3] rounded-2xl space-y-2 text-xs text-[#4e453f]">
                  <h4 className="font-semibold text-[#1b1c19]">
                    Instalação manual no navegador
                  </h4>
                  <p className="leading-relaxed">
                    No Chrome, Edge ou Brave, você pode instalar a qualquer momento clicando no ícone de instalação <Download className="w-3 h-3 inline text-[#68594d]" /> na barra de endereço ou acessando o menu de opções do navegador.
                  </p>
                </div>
              )}

              {/* Informações Técnicas de Offline e Storage */}
              <div className="p-3.5 bg-[#fbfaf8] border border-[#f0eee9] rounded-2xl space-y-1.5 text-[11px] text-[#7f756e]">
                <div className="font-medium text-[#4e453f]">Arquitetura Offline-First & PWA:</div>
                <div className="flex items-center gap-1.5 text-[#68594d]">
                  <Sparkles className="w-3 h-3" />
                  <span>IndexedDB ativo + Service Worker para App Shell</span>
                </div>
                <p>
                  Todas as suas notas, pastas e anexos continuam 100% disponíveis e editáveis mesmo sem acesso à internet.
                </p>
              </div>
            </div>
          )}

          {/* ============================================================ */}
          {/* ABA 5: COMPARTILHAMENTO DO DIÁRIO                            */}
          {/* ============================================================ */}
          {activeTab === 'sharing' && (
            <SettingsSharingTab
              userId={userId}
              userEmail={userEmail}
              onOpenInviteModal={() => {
                if (onOpenShareModal) {
                  onClose();
                  onOpenShareModal();
                }
              }}
              onCloseSettings={onClose}
            />
          )}
        </div>
      </div>
    </div>
  );
}
