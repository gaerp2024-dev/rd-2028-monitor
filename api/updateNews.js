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
Devuelve ÚNICAMENTE un objeto JSON estricto con esta estructura exacta (sin Markdown):
{
  "sentimentScore": 0.8,
  "summary": "Resumen claro en 1 o 2 oraciones.",
  "impact": "Alto"
}

Noticia:
"${newsText}"`;

    let analysis = null;

    try {
      const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });
      const result = await model.generateContent(prompt);
      const responseText = result.response.text();
      const cleanJson = responseText.replace(/```json|```/g, '').trim();
      analysis = JSON.parse(cleanJson);
    } catch (modelErr) {
      console.warn("Gemini API no disponible o en alta demanda, utilizando análisis de respaldo:", modelErr.message);
      // Fallback local en caso de congestión de API
      analysis = {
        sentimentScore: 0.5,
        summary: newsText.length > 120 ? newsText.substring(0, 117) + "..." : newsText,
        impact: "Medio"
      };
    }

    // Guardar en Firestore fusionando con datos preexistentes
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
      message: `Documento '${candidateId}' actualizado correctamente en Firestore.`
    });

  } catch (error) {
    return res.status(500).json({
      success: false,
      errorDetail: error.toString(),
      message: error.message
    });
  }
}
