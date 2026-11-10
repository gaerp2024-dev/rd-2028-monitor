import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { GoogleGenerativeAI } from '@google/generative-ai';

function getFirebaseAdmin() {
  if (!getApps().length) {
    let privateKey = process.env.FIREBASE_PRIVATE_KEY || '';
    
    // Reemplazar saltos de línea formateados o entrecomillados
    if (privateKey.startsWith('"') && privateKey.endsWith('"')) {
      privateKey = privateKey.slice(1, -1);
    }
    privateKey = privateKey.replace(/\\n/g, '\n');

    initializeApp({
      credential: cert({
        projectId: process.env.FIREBASE_PROJECT_ID,
        clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
        privateKey: privateKey
      })
    });
  }
  return getFirestore();
}

export default async function handler(req, res) {
  // Respuesta simple para GET (comprobación visual en navegador)
  if (req.method === 'GET') {
    return res.status(200).json({
      success: true,
      message: "API updateNews en línea y lista para recibir peticiones POST."
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
        error: "Faltan parámetros 'candidateId' o 'newsText'."
      });
    }

    if (!process.env.GEMINI_API_KEY) {
      return res.status(500).json({ success: false, error: "Falta GEMINI_API_KEY" });
    }

    // 1. Analizar noticia con Gemini
    const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
    const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });
    const prompt = `Analiza la siguiente noticia sobre el candidato '${candidateId}'.
Devuelve SOLO un JSON con esta estructura exacta (sin markdown extra):
{
  "sentimentScore": 0.5,
  "summary": "Resumen de la noticia",
  "impact": "Alto"
}

Noticia:
"${newsText}"`;

    const result = await model.generateContent(prompt);
    const responseText = result.response.text();
    const cleanJson = responseText.replace(/```json|```/g, '').trim();
    const analysis = JSON.parse(cleanJson);

    // 2. Conectar y actualizar en Firestore
    const db = getFirebaseAdmin();
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
      message: `Documento '${candidateId}' actualizado en Firestore.`
    });

  } catch (error) {
    return res.status(500).json({
      success: false,
      error: error.message,
      stack: error.stack
    });
  }
}
