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
      return res.status(500).json({ success: false, error: "Falta GEMINI_API_KEY en variables de entorno." });
    }

    const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
    const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash" });

    const prompt = `Analiza la siguiente noticia electoral sobre el candidato '${candidateId}'.
Devuelve ÚNICAMENTE un objeto JSON válido con esta estructura:
{
  "sentimentScore": 0.5,
  "summary": "Resumen breve",
  "impact": "Alto"
}

Noticia:
"${newsText}"`;

    const result = await model.generateContent(prompt);
    const responseText = result.response.text();
    const cleanJson = responseText.replace(/```json|```/g, '').trim();
    const analysis = JSON.parse(cleanJson);

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
