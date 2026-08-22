'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import {
  Eye,
  EyeOff,
  Mail,
  Loader2,
  AlertCircle,
  CheckCircle2,
} from 'lucide-react';
import { createClient, isSupabaseConfigured } from '../api/supabase-client';
import {
  validateEmail,
  validatePassword,
  getFriendlyAuthErrorMessage,
} from '../utils/auth-errors';

interface LoginFormProps {
  onSuccess?: () => void;
  onSwitchToApp?: () => void;
}

export function LoginForm({ onSuccess, onSwitchToApp }: LoginFormProps) {
  const router = useRouter();
  const [isSignUp, setIsSignUp] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);

  const [loading, setLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [awaitingEmailVerification, setAwaitingEmailVerification] = useState(false);

  // Redireciona automaticamente se o usuário já estiver com sessão ativa ou ao detectar login
  useEffect(() => {
    const supabase = createClient();
    let isMounted = true;

    // 1. Escuta alterações em tempo real no estado da autenticação
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, session) => {
      if (!isMounted) return;
      if ((event === 'SIGNED_IN' || event === 'INITIAL_SESSION') && session?.user) {
        if (typeof window !== 'undefined') {
          window.location.replace('/');
        }
      }
    });

    // 2. Valida sessão existente no carregamento da página
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (!isMounted) return;
      if (session?.user) {
        if (typeof window !== 'undefined') {
          window.location.replace('/');
        }
      }
    });

    return () => {
      isMounted = false;
      subscription.unsubscribe();
    };
  }, []);

  const resetFormState = () => {
    setErrorMessage(null);
    setSuccessMessage(null);
    setPassword('');
    setConfirmPassword('');
  };

  const handleToggleMode = () => {
    setIsSignUp((prev) => !prev);
    setAwaitingEmailVerification(false);
    resetFormState();
  };

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setErrorMessage(null);
    setSuccessMessage(null);

    // 1. Validação de Email
    const emailValidation = validateEmail(email);
    if (!emailValidation.valid) {
      setErrorMessage(emailValidation.message || 'E-mail inválido.');
      return;
    }

    // 2. Validação de Senha
    const passwordValidation = validatePassword(password, confirmPassword, isSignUp);
    if (!passwordValidation.valid) {
      setErrorMessage(passwordValidation.message || 'Senha inválida.');
      return;
    }

    setLoading(true);

    try {
      const supabase = createClient();
      const configured = isSupabaseConfigured();

      if (isSignUp) {
        // --- Fluxo de Cadastro com Supabase Auth ---
        if (configured) {
          const { data, error } = await supabase.auth.signUp({
            email: email.trim(),
            password: password,
            options: {
              emailRedirectTo:
                typeof window !== 'undefined' ? `${window.location.origin}/` : undefined,
            },
          });

          if (error) throw error;

          if (data?.session) {
            setSuccessMessage('Conta criada com sucesso! Redirecionando...');
            if (onSuccess) onSuccess();
            if (typeof window !== 'undefined') {
              window.location.href = '/';
            } else {
              router.push('/');
            }
          } else {
            setAwaitingEmailVerification(true);
            setSuccessMessage(
              `Conta cadastrada! Enviamos um e-mail para ${email.trim()}. Verifique sua caixa de entrada para ativar sua conta.`
            );
          }
        } else {
          // Fallback para ambiente sem chaves de Supabase ativas
          setSuccessMessage('Conta cadastrada com sucesso! Redirecionando...');
          setTimeout(() => {
            if (onSuccess) onSuccess();
            if (onSwitchToApp) onSwitchToApp();
            if (typeof window !== 'undefined') {
              window.location.href = '/';
            }
          }, 600);
        }
      } else {
        // --- Fluxo de Login com Supabase Auth ---
        if (configured) {
          const { data, error } = await supabase.auth.signInWithPassword({
            email: email.trim(),
            password: password,
          });

          if (error) throw error;

          if (data?.user || data?.session) {
            setSuccessMessage('Autenticado com sucesso! Redirecionando...');
            if (onSuccess) onSuccess();
            // Redireciona com full page navigation para garantir envio limpo de cookies de sessão SSR
            if (typeof window !== 'undefined') {
              window.location.href = '/';
            } else {
              router.push('/');
            }
          }
        } else {
          // Fallback para ambiente sem chaves de Supabase ativas
          setSuccessMessage('Autenticado com sucesso!');
          setTimeout(() => {
            if (onSuccess) onSuccess();
            if (onSwitchToApp) onSwitchToApp();
            if (typeof window !== 'undefined') {
              window.location.href = '/';
            }
          }, 600);
        }
      }
    } catch (err: any) {
      const friendly = getFriendlyAuthErrorMessage(err);
      setErrorMessage(friendly);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div
      id="login-page-container"
      className="min-h-screen w-full auth-canvas-bg flex items-center justify-center p-4 sm:p-6 lg:p-8"
    >
      <div
        id="login-auth-card"
        className="paper-card rounded-2xl w-full max-w-[420px] p-8 sm:p-12 flex flex-col gap-8 relative z-10 animate-fadeIn"
      >
        {/* Identidade Visual / Header Papyrus & Ink */}
        <header className="text-center space-y-2">
          <h1
            id="auth-brand-title"
            className="font-serif-note text-3xl sm:text-4xl font-semibold text-[#68594d] tracking-tight"
          >
            Digital Tactility
          </h1>
          <p
            id="auth-brand-subtitle"
            className="font-sans-ui text-sm sm:text-base text-[#7f756e] font-normal"
          >
            {isSignUp
              ? 'Criar sua conta'
              : 'A quiet space for writing.'}
          </p>
        </header>

        {/* Mensagem de Erro Amigável */}
        {errorMessage && (
          <div
            id="auth-error-alert"
            role="alert"
            className="p-3.5 bg-[#ffdad6]/60 border border-[#ba1a1a]/30 rounded-xl flex items-start gap-2.5 text-xs sm:text-sm text-[#93000a] animate-fadeIn"
          >
            <AlertCircle className="w-4 h-4 shrink-0 text-[#ba1a1a] mt-0.5" />
            <span className="font-sans-ui leading-relaxed flex-1">{errorMessage}</span>
          </div>
        )}

        {/* Mensagem de Sucesso */}
        {successMessage && (
          <div
            id="auth-success-alert"
            role="status"
            className="p-3.5 bg-[#f4dfcb]/80 border border-[#68594d]/30 rounded-xl flex items-start gap-2.5 text-xs sm:text-sm text-[#241910] animate-fadeIn"
          >
            <CheckCircle2 className="w-4 h-4 shrink-0 text-[#68594d] mt-0.5" />
            <span className="font-sans-ui leading-relaxed flex-1">{successMessage}</span>
          </div>
        )}

        {/* Tela de Instrução de Confirmação de E-mail */}
        {awaitingEmailVerification ? (
          <div
            id="awaiting-verification-view"
            className="space-y-6 text-center py-2 animate-fadeIn"
          >
            <div className="w-12 h-12 rounded-full bg-[#f4dfcb] text-[#68594d] flex items-center justify-center mx-auto">
              <Mail className="w-6 h-6 stroke-[1.75]" />
            </div>
            <div className="space-y-2">
              <h3 className="font-serif-note font-semibold text-xl text-[#1b1c19]">
                Verifique seu e-mail
              </h3>
              <p className="font-sans-ui text-xs sm:text-sm text-[#4e453f] leading-relaxed">
                Enviamos um link de confirmação para{' '}
                <strong className="text-[#1b1c19] font-medium">{email}</strong>.
                Clique no link para ativar sua conta e depois faça login.
              </p>
            </div>

            <button
              id="back-to-login-btn"
              type="button"
              onClick={handleToggleMode}
              className="w-full bg-[#68594d] text-white font-sans-ui text-sm font-medium rounded-lg py-3 px-6 hover:bg-[#574a40] transition-all cursor-pointer shadow-xs active:scale-[0.98]"
            >
              Voltar para Entrar
            </button>
          </div>
        ) : (
          /* Formulário de Login / Cadastro */
          <form onSubmit={handleSubmit} className="space-y-6" noValidate>
            {/* Campo E-mail */}
            <div className="space-y-1">
              <label
                htmlFor="auth-email-input"
                className="font-sans-ui text-xs font-semibold text-[#4e453f] uppercase tracking-wider block"
              >
                Email
              </label>
              <input
                id="auth-email-input"
                name="email"
                type="email"
                autoComplete="email"
                required
                disabled={loading}
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="seu@email.com"
                className="w-full py-2.5 font-serif-note text-base text-[#1b1c19] bg-transparent border-0 border-b border-[#d1c4bc] focus:border-[#68594d] focus:ring-0 focus:outline-none placeholder-[#d1c4bc] transition-colors disabled:opacity-60"
              />
            </div>

            {/* Campo Senha */}
            <div className="space-y-1">
              <div className="flex items-center justify-between">
                <label
                  htmlFor="auth-password-input"
                  className="font-sans-ui text-xs font-semibold text-[#4e453f] uppercase tracking-wider block"
                >
                  Senha
                </label>
                {isSignUp && (
                  <span className="font-sans-ui text-[11px] text-[#7f756e]">
                    mín. 6 caracteres
                  </span>
                )}
              </div>
              <div className="relative flex items-center">
                <input
                  id="auth-password-input"
                  name="password"
                  type={showPassword ? 'text' : 'password'}
                  autoComplete={isSignUp ? 'new-password' : 'current-password'}
                  required
                  disabled={loading}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  className="w-full py-2.5 pr-8 font-serif-note text-base text-[#1b1c19] bg-transparent border-0 border-b border-[#d1c4bc] focus:border-[#68594d] focus:ring-0 focus:outline-none placeholder-[#d1c4bc] transition-colors disabled:opacity-60"
                />
                <button
                  id="auth-toggle-password-btn"
                  type="button"
                  tabIndex={-1}
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-0 text-[#7f756e] hover:text-[#1b1c19] p-1.5 transition-colors cursor-pointer"
                  aria-label={showPassword ? 'Ocultar senha' : 'Exibir senha'}
                >
                  {showPassword ? (
                    <EyeOff className="w-4 h-4" />
                  ) : (
                    <Eye className="w-4 h-4" />
                  )}
                </button>
              </div>
            </div>

            {/* Campo Confirmar Senha (Somente no Cadastro) */}
            {isSignUp && (
              <div className="space-y-1 animate-fadeIn">
                <label
                  htmlFor="auth-confirm-password-input"
                  className="font-sans-ui text-xs font-semibold text-[#4e453f] uppercase tracking-wider block"
                >
                  Confirmar Senha
                </label>
                <div className="relative flex items-center">
                  <input
                    id="auth-confirm-password-input"
                    name="confirmPassword"
                    type={showConfirmPassword ? 'text' : 'password'}
                    autoComplete="new-password"
                    required
                    disabled={loading}
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    placeholder="••••••••"
                    className="w-full py-2.5 pr-8 font-serif-note text-base text-[#1b1c19] bg-transparent border-0 border-b border-[#d1c4bc] focus:border-[#68594d] focus:ring-0 focus:outline-none placeholder-[#d1c4bc] transition-colors disabled:opacity-60"
                  />
                  <button
                    id="auth-toggle-confirm-password-btn"
                    type="button"
                    tabIndex={-1}
                    onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                    className="absolute right-0 text-[#7f756e] hover:text-[#1b1c19] p-1.5 transition-colors cursor-pointer"
                    aria-label={
                      showConfirmPassword ? 'Ocultar confirmação' : 'Exibir confirmação'
                    }
                  >
                    {showConfirmPassword ? (
                      <EyeOff className="w-4 h-4" />
                    ) : (
                      <Eye className="w-4 h-4" />
                    )}
                  </button>
                </div>
              </div>
            )}

            {/* Ações / Botões */}
            <div className="pt-3 flex flex-col gap-4 items-center">
              <button
                id="auth-submit-btn"
                type="submit"
                disabled={loading}
                className="w-full min-h-[44px] bg-[#68594d] text-white font-sans-ui text-sm font-medium rounded-lg py-3 px-6 hover:bg-[#574a40] transition-all focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-[#68594d] shadow-sm active:scale-[0.98] disabled:opacity-70 disabled:cursor-not-allowed flex items-center justify-center gap-2 cursor-pointer"
              >
                {loading ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    <span>{isSignUp ? 'Criando conta...' : 'Entrando...'}</span>
                  </>
                ) : (
                  <span>{isSignUp ? 'Criar conta' : 'Entrar'}</span>
                )}
              </button>

              <button
                id="auth-toggle-mode-btn"
                type="button"
                onClick={handleToggleMode}
                disabled={loading}
                className="font-sans-ui text-sm text-[#68594d] hover:text-[#574a40] underline underline-offset-4 decoration-[#d1c4bc] hover:decoration-[#68594d] transition-colors cursor-pointer disabled:opacity-50 py-1"
              >
                {isSignUp
                  ? 'Já possui uma conta? Entrar'
                  : 'Registrar-se'}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
