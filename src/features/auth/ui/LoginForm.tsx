'use client';

import { useState } from 'react';
import { createClient } from '../api/supabase-client';

interface LoginFormProps {
  onSuccess?: () => void;
  onSwitchToApp?: () => void;
}

export function LoginForm({ onSuccess, onSwitchToApp }: LoginFormProps) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [isSignUp, setIsSignUp] = useState(false);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setMessage(null);

    const supabase = createClient();

    try {
      if (isSignUp) {
        const { error } = await supabase.auth.signUp({
          email,
          password,
        });
        if (error) throw error;
        setMessage('Conta criada com sucesso! Verifique seu e-mail ou faça login.');
      } else {
        const { error } = await supabase.auth.signInWithPassword({
          email,
          password,
        });
        if (error) throw error;
        if (onSuccess) onSuccess();
      }
    } catch (err: any) {
      // In preview mode or before Supabase keys are configured in production:
      if (
        !process.env.NEXT_PUBLIC_SUPABASE_URL ||
        process.env.NEXT_PUBLIC_SUPABASE_URL.includes('placeholder') ||
        process.env.NEXT_PUBLIC_SUPABASE_URL.includes('your-project')
      ) {
        setMessage('Modo Demonstração: Autenticação simulada.');
        setTimeout(() => {
          if (onSuccess) onSuccess();
          if (onSwitchToApp) onSwitchToApp();
        }, 600);
      } else {
        setMessage(err.message || 'Erro ao processar autenticação.');
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div
      id="login-container"
      className="min-h-screen w-full desk-background flex items-center justify-center p-4 sm:p-6"
    >
      <div
        id="login-paper-card"
        className="paper-card rounded-2xl w-full max-w-md p-8 sm:p-12 flex flex-col gap-8 relative z-10 shadow-2xl"
      >
        {/* Header */}
        <div className="text-center space-y-2">
          <h1 className="font-serif-note text-3xl sm:text-4xl font-semibold text-[#68594d] tracking-tight">
            Digital Tactility
          </h1>
          <p className="font-sans-ui text-sm sm:text-base text-[#4e453f]">
            A quiet space for writing.
          </p>
        </div>

        {/* Feedback message if any */}
        {message && (
          <div className="p-3 bg-[#f4dfcb]/60 border border-[#d1c4bc] rounded-lg text-xs sm:text-sm text-[#4e453f] text-center">
            {message}
          </div>
        )}

        {/* Form */}
        <form onSubmit={handleSubmit} className="space-y-6">
          <div className="space-y-1">
            <label
              htmlFor="email"
              className="font-sans-ui text-xs font-semibold text-[#4e453f] uppercase tracking-wider block"
            >
              Email
            </label>
            <input
              id="email"
              name="email"
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="seu@email.com"
              className="w-full py-2.5 font-serif-note text-base text-[#1b1c19] bg-transparent border-0 border-b border-[#d1c4bc] focus:border-[#68594d] focus:ring-0 focus:outline-none placeholder-[#d1c4bc] transition-colors"
            />
          </div>

          <div className="space-y-1">
            <label
              htmlFor="senha"
              className="font-sans-ui text-xs font-semibold text-[#4e453f] uppercase tracking-wider block"
            >
              Senha
            </label>
            <input
              id="senha"
              name="senha"
              type="password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              className="w-full py-2.5 font-serif-note text-base text-[#1b1c19] bg-transparent border-0 border-b border-[#d1c4bc] focus:border-[#68594d] focus:ring-0 focus:outline-none placeholder-[#d1c4bc] transition-colors"
            />
          </div>

          <div className="pt-4 flex flex-col gap-4 items-center">
            <button
              id="login-submit-btn"
              type="submit"
              disabled={loading}
              className="w-full bg-[#68594d] text-white font-sans-ui text-sm font-medium rounded-lg py-3 px-6 hover:bg-[#6b5c4c] transition-all focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-[#68594d] shadow-sm active:scale-[0.98] disabled:opacity-70 cursor-pointer"
            >
              {loading ? 'Aguarde...' : isSignUp ? 'Criar Conta' : 'Entrar'}
            </button>

            <button
              id="login-toggle-signup-btn"
              type="button"
              onClick={() => setIsSignUp(!isSignUp)}
              className="font-sans-ui text-sm text-[#68594d] hover:text-[#6b5c4c] underline underline-offset-4 decoration-[#d1c4bc] hover:decoration-[#68594d] transition-colors cursor-pointer"
            >
              {isSignUp ? 'Já possui conta? Entrar' : 'Registrar-se'}
            </button>

            {onSwitchToApp && (
              <button
                id="login-view-notes-btn"
                type="button"
                onClick={onSwitchToApp}
                className="text-xs text-[#7f756e] hover:text-[#1b1c19] pt-2 transition-colors cursor-pointer"
              >
                Abrir Caderno de Notas (Anotado!) &rarr;
              </button>
            )}
          </div>
        </form>
      </div>
    </div>
  );
}
