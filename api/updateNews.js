export default async function handler(req, res) {

  const apiKey = process.env.GEMINI_API_KEY;

  if (!apiKey) {

    return res.status(500).json({
      success: false,
      error: "GEMINI_API_KEY no configurada"
    });

  }

  return res.status(200).json({
    success: true,
    apiConfigured: true,
    message: "Gemini conectado correctamente"
  });

}
