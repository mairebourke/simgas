// The Gemini API key should be stored securely in Netlify's environment variables.
// This function assumes an environment variable named GEMINI_API_KEY exists.
const API_KEY = process.env.GEMINI_API_KEY;

/**
 * This is a Netlify serverless function handler.
 * It generates a fixed-width blood gas report based on a clinical scenario.
 * @param {object} event - The event object from Netlify, containing request details.
 * @returns {Promise<object>} A promise that resolves to a Netlify function response.
 */
exports.handler = async (event) => {
  // Only allow POST requests for this endpoint.
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  try {
    // Get the scenario and gasType from the frontend's request body.
    const { scenario, gasType } = JSON.parse(event.body);

    // ===================================================================
    // SYSTEM PROMPT
    // This defines the model's persona, task, and strict formatting rules.
    // ===================================================================
    const systemPrompt = `You are a precision clinical data formatting engine. Your sole task is to populate a fixed-width, multi-column, plain text blood gas report. You must replicate the provided structure, spacing, and alignment EXACTLY.

CRITICAL FORMATTING RULES:
1.  The output MUST be plain text suitable for a monospaced display.
2.  Use spaces for padding to ensure all columns ('Value', 'Unit', 'Reference Range') are perfectly aligned vertically throughout the entire report.
3.  Do NOT use commas as separators. The columns are separated by spaces only.
4.  Replace the example patient details and all clinical values with new, medically plausible data that is consistent with the user's provided clinical scenario.
5.  Keep all parameter names (pH, PCO₂), units (kPa, mmol/L), horizontal lines, and reference ranges exactly as they appear in the template.
6.  Use Unicode characters for subscripts and superscripts where shown (e.g., FIO₂, Ca²⁺).
7.  The value for 'Blood Type' must be '${gasType}'.
8.  The output must ONLY be the report text itself. Do not include any explanations, titles, or markdown formatting.
9.  All gas pressure values (PCO₂, PO₂, AaDO₂) MUST be reported in kilopascals (kPa).

TEMPLATE TO FOLLOW EXACTLY:
---------------------------------
                            Blood Gas
                          Emergency Department
────────────────────────────────────────────────────────
Patient ID:
Last Name        [Last Name]
First Name       [First Name]
Temperature      [Value] ° C
FIO₂             [Value]
R                [Value]
Sample type      Blood
Blood Type       ${gasType}
────────────────────────────────────────────────────────
pH               [Value]                 (7.350 - 7.450)
PCO₂             [Value]       kPa       (4.67 - 6.00)
PO₂              [Value]       kPa       (10.67 - 13.33)
────────────────────────────────────────────────────────
Na⁺              [Value]       mmol/L    (135.0 - 148.0)
K⁺               [Value]       mmol/L    (3.50 - 4.50)
Cl⁻              [Value]       mmol/L    (98.0 - 107.0)
Ca²⁺             [Value]       mmol/L    (1.120 - 1.320)
────────────────────────────────────────────────────────
HCT              [Value]       %         (35.0 – 50.0)
────────────────────────────────────────────────────────
Glucose          [Value]       mmol/L    (3.3 – 6.1)
Lactate          [Value]       mmol/L    (0.4 – 2.2)
────────────────────────────────────────────────────────
tHb              [Value]       g/dL      (11.5 – 17.4)
O₂ Hb            [Value]       %         (95.0 – 99.0)
COHb             [Value]       %         (0.5 – 2.5)
HHb              [Value]       %         (1.0 – 5.0)
MetHb            [Value]       %         (0.4 – 1.5)
────────────────────────────────────────────────────────
BE               [Value]       mmol/L    (-2.3 – 2.3)
cHCO₃            [Value]       mmol/L
AaDO₂            [Value]       kPa
SO₂              [Value]       %         (75.0 – 99.0)
cHCO₃ st         [Value]       mmol/L    (22.4 – 25.8)
P50              [Value]       mmol/L
ctO₂             [Value]       Vol %
---------------------------------
`;

    // The user's specific request is separated from the system instructions.
    const userPrompt = `Clinical Scenario: ${scenario}`;

    // Use the recommended model for this task.
    const model = 'gemini-2.5-flash-preview-05-20';
    const apiURL = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${API_KEY}`;
    
    // Construct the payload for the Gemini API.
    const payload = {
      // The user's prompt goes into the 'contents'.
      contents: [{ parts: [{ text: userPrompt }] }],
      // The detailed instructions go into 'systemInstruction' for better model guidance.
      systemInstruction: {
        parts: [{ text: systemPrompt }]
      },
      generationConfig: {
        // Use a low temperature for more deterministic and consistent formatting.
        temperature: 0.1, 
      }
    };
    
    const response = await fetch(apiURL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    if (!response.ok) {
        const errorData = await response.json();
        console.error('Google API Error:', errorData);
        throw new Error(`Google API responded with status: ${response.status}`);
    }

    const data = await response.json();
    
    // Safely access the generated text from the API response.
    const generatedText = data?.candidates?.[0]?.content?.parts?.[0]?.text || '';

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ report: generatedText.trim() }),
    };

  } catch (error) {
    console.error('Error in Netlify function:', error);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'Failed to generate report.' }),
    };
  }
};

