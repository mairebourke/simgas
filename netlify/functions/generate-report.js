// The Gemini API key is stored securely in Netlify's environment variables
const API_KEY = process.env.GEMINI_API_KEY;

// This is the standard structure for a Netlify Function handler
exports.handler = async (event) => {
  // Only allow POST requests
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  try {
    // Get the scenario and gasType from the frontend's request
    const { scenario, gasType } = JSON.parse(event.body);

    // This is the prompt we will send to Gemini
    const systemPrompt = `You are a clinical simulation assistant. Your task is to generate a realistic, physiologically plausible blood gas report based on a given clinical scenario. The report must be formatted as plain text, mimicking a lab printout. It must include standard parameters like pH, PCO2, PO2, electrolytes, lactate, and hemoglobin components. Values must have appropriate units and reference ranges. Indicate high or low values with arrows (↑ or ↓). The output should ONLY be the report text itself, with no additional explanations or markdown formatting. The sample type must be correctly labelled as '${gasType}'.`;

    const model = 'gemini-1.5-flash'; // A fast and capable model
    const apiURL = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${API_KEY}`;

    // Make the actual call to the Google Gemini API
    const response = await fetch(apiURL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        contents: [{
          parts: [{
            text: `${systemPrompt}\n\nClinical Scenario: ${scenario}`
          }]
        }]
      })
    });

    if (!response.ok) {
        const errorData = await response.json();
        console.error('Google API Error:', errorData);
        throw new Error(`Google API responded with status: ${response.status}`);
    }

    const data = await response.json();

    // Extract the generated text from the API response
    const generatedText = data.candidates[0].content.parts[0].text;

    // Send the successful result back to the frontend
    return {
      statusCode: 200,
      body: JSON.stringify({ report: generatedText }),
    };

  } catch (error) {
    console.error('Error in Netlify function:', error);
    // Send an error message back to the frontend
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'Failed to generate report.' }),
    };
  }
};