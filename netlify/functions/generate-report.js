// The Gemini API key is stored securely in Netlify's environment variables
const API_KEY = process.env.GEMINI_API_KEY;

// --- HELPER FUNCTION FOR FORMATTING ---
// This function takes the data and creates a perfectly aligned string.
function formatLine(label, value, unit = '', reference = '') {
    const labelCol = label.padEnd(18, ' ');
    const valueCol = (value || '').padEnd(12, ' ');
    const unitCol = unit.padEnd(11, ' ');
    return `${labelCol}${valueCol}${unitCol}${reference}\n`;
}

exports.handler = async (event) => {
    if (event.httpMethod !== 'POST') {
        return { statusCode: 405, body: 'Method Not Allowed' };
    }

    try {
        const { scenario, gasType } = JSON.parse(event.body);

        // This is Prompt 1 from your paper, asking for structured JSON data.
        const systemPrompt = `You are a clinical data API. Based on the user's scenario, generate a realistic blood gas report.
        Your output MUST be a valid JSON object. Do not include any text before or after the JSON object. Do not use markdown.
        The value for the "bloodType" key must be "${gasType}".
        You MUST include every single key from the example JSON structure. Do not omit any keys.

        You MUST use the following complete JSON structure:
        {
          "patientId": "123456",
          "lastName": "Smith",
          "firstName": "Jane",
          "temperature": "37.0",
          "fio2": "0.21",
          "r": "0.80",
          "ph": "7.35",
          "pco2": "5.50",
          "po2": "12.00",
          "na": "140",
          "k": "4.1",
          "cl": "100",
          "ca": "1.20",
          "hct": "45",
          "glucose": "5.5",
          "lactate": "1.2",
          "thb": "15.0",
          "o2hb": "98.0",
          "cohb": "1.1",
          "hhb": "1.9",
          "methb": "0.6",
          "be": "0.0",
          "chco3": "24.0",
          "aado2": "15.0",
          "so2": "98.2",
          "chco3st": "25.0",
          "p50": "26.0",
          "cto2": "20.0"
        }
        
        Final instruction: Ensure the output JSON is complete and contains all 27 keys from the example structure.`;

        const model = 'gemini-1.5-flash';
        const apiURL = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${API_KEY}`;
        
        const response = await fetch(apiURL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                contents: [{ parts: [{ text: `${systemPrompt}\n\nClinical Scenario: ${scenario}` }] }],
                generationConfig: {
                    temperature: 0.2,
                    responseMimeType: "application/json", // This forces the AI to return valid JSON
                }
            })
        });

        if (!response.ok) {
            const errorData = await response.json();
            throw new Error(`Google API responded with status: ${response.status}. Details: ${JSON.stringify(errorData)}`);
        }

        const data = await response.json();
        const reportData = JSON.parse(data.candidates[0].content.parts[0].text);

        // This is where our code builds the perfect three-column format from the AI's data.
        let formattedReport = '';
        formattedReport += '                           Blood Gas\n';
        formattedReport += '                       Emergency Department\n';
        formattedReport += '────────────────────────────────────────────────────────\n';
        formattedReport += `Patient ID:       ${reportData.patientId || ''}\n`;
        formattedReport += `Last Name         ${reportData.lastName || ''}\n`;
        formattedReport += `First Name        ${reportData.firstName || ''}\n`;
        formattedReport += `Temperature       ${reportData.temperature || ''} ° C\n`;
        formattedReport += `FIO₂              ${reportData.fio2 || ''}\n`;
        formattedReport += `R                 ${reportData.r || ''}\n`;
        formattedReport += `Sample type       Blood\n`;
        formattedReport += `Blood Type        ${gasType}\n`;
        formattedReport += '────────────────────────────────────────────────────────\n';
        formattedReport += formatLine('pH', reportData.ph, '', '(7.350 - 7.450)');
        formattedReport += formatLine('PCO₂', reportData.pco2, 'kPa', '(4.67 - 6.00)');
        formattedReport += formatLine('PO₂', reportData.po2, 'kPa', '(10.67 - 13.33)');
        formattedReport += '────────────────────────────────────────────────────────\n';
        formattedReport += formatLine('Na⁺', reportData.na, 'mmol/L', '(135.0 - 148.0)');
        formattedReport += formatLine('K⁺', reportData.k, 'mmol/L', '(3.50 - 4.50)');
        formattedReport += formatLine('Cl⁻', reportData.cl, 'mmol/L', '(98.0 - 107.0)');
        formattedReport += formatLine('Ca²⁺', reportData.ca, 'mmol/L', '(1.120 - 1.320)');
        formattedReport += '────────────────────────────────────────────────────────\n';
        formattedReport += formatLine('HCT', reportData.hct, '%', '(35.0 – 50.0)');
        formattedReport += '────────────────────────────────────────────────────────\n';
        formattedReport += formatLine('Glucose', reportData.glucose, 'mmol/L', '(3.3 – 6.1)');
        formattedReport += formatLine('Lactate', reportData.lactate, 'mmol/L', '(0.4 – 2.2)');
        formattedReport += '────────────────────────────────────────────────────────\n';
        formattedReport += formatLine('tHb', reportData.thb, 'g/dL', '(11.5 – 17.4)');
        formattedReport += formatLine('O₂ Hb', reportData.o2hb, '%', '(95.0 – 99.0)');
        formattedReport += formatLine('COHb', reportData.cohb, '%', '(0.5 – 2.5)');
        formattedReport += formatLine('HHb', reportData.hhb, '%', '(1.0 – 5.0)');
        formattedReport += formatLine('MetHb', reportData.methb, '%', '(0.4 – 1.5)');
        formattedReport += '────────────────────────────────────────────────────────\n';
        formattedReport += formatLine('BE', reportData.be, 'mmol/L', '(-2.3 – 2.3)');
        formattedReport += formatLine('cHCO₃', reportData.chco3, 'mmol/L');
        formattedReport += formatLine('AaDO₂', reportData.aado2, 'mmHg');
        formattedReport += formatLine('SO₂', reportData.so2, '%', '(75.0 – 99.0)');
        formattedReport += formatLine('cHCO₃ st', reportData.chco3st, 'mmol/L', '(22.4 – 25.8)');
        formattedReport += formatLine('P50', reportData.p50, 'mmol/L');
        formattedReport += formatLine('ctO₂', reportData.cto2, 'Vol %');

        return {
            statusCode: 200,
            body: JSON.stringify({ report: formattedReport }),
        };

    } catch (error) {
        console.error('Error in Netlify function:', error);
        return {
            statusCode: 500,
            body: JSON.stringify({ error: 'Failed to generate report. Check function logs.' }),
        };
    }
};
