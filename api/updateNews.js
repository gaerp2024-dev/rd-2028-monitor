import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { GoogleGenerativeAI } from '@google/generative-ai';

// Inicializar Firebase Admin SDK si no está inicializado
if (!getApps().length) {
  initializeApp({
    credential: cert({
      projectId: process.env.FIREBASE_PROJECT_ID,
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      privateKey: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n')
    })
  });
}

const db = getFirestore();
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

export default async function handler(req, res) {
  // Permitir peticiones GET de prueba y POST para procesar datos
  if (req.method === 'GET') {
    return res.status(200).json({
      success: true,
      message: "API lista para recibir noticias vía POST."
    });
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, error: "Método no permitido. Usa POST." });
  }

  try {
    const { candidateId, newsText } = req.body || {};

    if (!candidateId || !newsText) {
      return res.status(400).json({
        success: false,
        error: "Faltan parámetros. Se requiere 'candidateId' y 'newsText'."
      });
    }

    // 1. Analizar la noticia usando Gemini
    const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });
    const prompt = `Analiza la siguiente noticia electoral sobre el candidato '${candidateId}'. 
Devuelve ÚNICAMENTE un objeto JSON estricto sin formato markdown adicional con este esquema:
{
"sentimentScore": <número decimal entre -1.0 y 1.0>,
"summary": "<resumen claro de 1 o 2 oraciones>",
"impact": "<Alto | Medio | Bajo>"
}

Noticia:
"${newsText}"`;

    const result = await model.generateContent(prompt);
    const responseText = result.response.text();
    const cleanJson = responseText.replace(/```json|```/g, '').trim();
    const analysis = JSON.parse(cleanJson);

    // 2. Actualizar o crear el documento del candidato en Firestore
    const candidateRef = db.collection('candidates').doc(candidateId);
    await candidateRef.set({
      lastNewsSummary: analysis.summary,
      lastSentimentScore: analysis.sentimentScore,
      lastImpact: analysis.impact,
      updatedAt: new Date().toISOString()
    }, { merge: true });

    return res.status(200).json({
      success: true,
      candidateId,
      analysis,
      message: `Documento '${candidateId}' actualizado con éxito en Firestore.`
    });

  } catch (error) {
    return res.status(500).json({
      success: false,
      error: error.message
    });
  }
}
