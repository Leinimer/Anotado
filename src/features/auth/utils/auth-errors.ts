/**
 * Utilitário de tratamento de erros e validações amigáveis do Supabase Auth.
 */

export interface ValidationResult {
  valid: boolean;
  message?: string;
}

/**
 * Validação básica de formato de e-mail
 */
export function validateEmail(email: string): ValidationResult {
  const trimmed = email.trim();
  if (!trimmed) {
    return { valid: false, message: 'Por favor, informe seu e-mail.' };
  }
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(trimmed)) {
    return { valid: false, message: 'Por favor, informe um endereço de e-mail válido.' };
  }
  return { valid: true };
}

/**
 * Validação de requisitos de senha para cadastro
 */
export function validatePassword(password: string, confirmPassword?: string, isSignUp = false): ValidationResult {
  if (!password) {
    return { valid: false, message: 'Por favor, informe sua senha.' };
  }

  if (isSignUp) {
    if (password.length < 6) {
      return { valid: false, message: 'A senha deve conter no mínimo 6 caracteres.' };
    }
    if (confirmPassword !== undefined && password !== confirmPassword) {
      return { valid: false, message: 'As senhas não coincidem. Verifique a digitação.' };
    }
  }

  return { valid: true };
}

/**
 * Traduz mensagens técnicas de erro do Supabase para mensagens amigáveis em português
 */
export function getFriendlyAuthErrorMessage(error: any): string {
  if (!error) return 'Ocorreu um erro inesperado. Tente novamente.';

  const message = (typeof error === 'string' ? error : error.message || '').toLowerCase();

  if (message.includes('invalid login credentials') || message.includes('invalid_grant')) {
    return 'E-mail ou senha incorretos. Por favor, verifique os dados informados.';
  }

  if (message.includes('user already registered') || message.includes('already_registered')) {
    return 'Já existe uma conta cadastrada com este e-mail. Tente fazer login ou recuperar o acesso.';
  }

  if (message.includes('password should be at least 6 characters') || message.includes('weak_password')) {
    return 'A senha é muito curta. Crie uma senha com pelo menos 6 caracteres.';
  }

  if (message.includes('email not confirmed')) {
    return 'Seu e-mail ainda não foi confirmado. Verifique o link de ativação enviado para sua caixa de entrada.';
  }

  if (message.includes('signup requires a valid password')) {
    return 'Por favor, insira uma senha válida.';
  }

  if (
    message.includes('unable to validate email address') ||
    message.includes('invalid email') ||
    message.includes('validation_failed')
  ) {
    return 'O formato do e-mail informado não é válido.';
  }

  if (message.includes('rate limit') || message.includes('too many requests') || message.includes('over_email_send_rate_limit')) {
    return 'Muitas tentativas consecutivas. Por favor, aguarde alguns instantes antes de tentar novamente.';
  }

  if (message.includes('fetch') || message.includes('network') || message.includes('failed to fetch')) {
    return 'Falha de conexão com o serviço de autenticação. Verifique sua internet.';
  }

  return error.message || 'Não foi possível completar a operação. Tente novamente em instantes.';
}
