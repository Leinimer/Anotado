import { NextResponse } from 'next/server';
import { GoogleGenAI } from '@google/genai';

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const question = String(body?.question || '').trim();
    const context = String(body?.context || '').slice(0, 180000);

    if (!question) {
      return NextResponse.json({ error: 'Pergunta vazia.' }, { status: 400 });
    }

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      return NextResponse.json(
        { error: 'GEMINI_API_KEY não configurada no servidor.' },
        { status: 500 }
      );
    }

    const ai = new GoogleGenAI({ apiKey });
    const result = await ai.models.generateContent({
      model: 'gemini-3.8-flash',
      contents:
        'Você é o assistente de conhecimento do ANOTADO. ' +
        'Responda somente com base nas notas fornecidas. Não invente fatos. ' +
        'Quando possível, cite o título da nota relevante. Se o contexto não for suficiente, diga isso. ' +
        'Responda em português claro e direto.\\n\\nPERGUNTA:\\n' +
        question +
        '\\n\\nCONTEXTO:\\n' +
        context,
      config: { temperature: 0.2 },
    });

    return NextResponse.json({ answer: result.text || 'Sem resposta.' });
  } catch (error: any) {
    return NextResponse.json(
      { error: error?.message || 'Erro interno ao consultar a IA.' },
      { status: 500 }
    );
  }
}
