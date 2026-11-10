import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { GoogleGenerativeAI } from '@google/generative-ai';

function getFirebaseAdmin() {
  if (!getApps().length) {
    let privateKey = process.env.FIREBASE_PRIVATE_KEY || '';
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
  if (req.method === 'GET') {
    return res.status(200).json({
      success: true,
      message: "API updateNews activa."
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
      return res.status(500).json({ success: false, error: "Falta GEMINI_API_KEY." });
    }

    const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
    const prompt = `Analiza la siguiente noticia electoral sobre el candidato '${candidateId}'.
Devuelve ÚNICAMENTE un objeto JSON estricto con esta estructura exacta:
{
  "sentimentScore": 0.8,
  "summary": "Resumen claro en 1 o 2 oraciones.",
  "impact": "Alto"
}

Noticia:
"${newsText}"`;

    let responseText = null;
    const modelsToTry = ["gemini-2.5-flash", "gemini-1.5-flash-latest"];

    for (const modelName of modelsToTry) {
      try {
        const model = genAI.getGenerativeModel({ model: modelName });
        const result = await model.generateContent(prompt);
        responseText = result.response.text();
        if (responseText) break;
      } catch (err) {
        console.warn(`Falló modelo ${modelName}, intentando siguiente...`);
      }
    }

    if (!responseText) {
      throw new Error("No se pudo obtener respuesta de ningún modelo de Gemini.");
    }

    const cleanJson = responseText.replace(/```json|```/g, '').trim();
    const analysis = JSON.parse(cleanJson);

    // Fusionar (merge) el análisis en el documento existente del candidato
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
      message: `Documento '${candidateId}' actualizado en Firestore sin alterar las métricas preexistentes.`
    });

  } catch (error) {
    return res.status(500).json({
      success: false,
      errorDetail: error.toString(),
      message: error.message
    });
  }
}
