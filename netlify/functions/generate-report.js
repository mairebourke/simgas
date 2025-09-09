// The Gemini API key is stored securely in Netlify's environment variables
const API_KEY = process.env.GEMINI_API_KEY;

// --- HELPER FUNCTION FOR API CALLS WITH RETRY LOGIC ---
async function fetchWithRetry(url, payload, maxRetries = 3) {
    let attempt = 0;
    let delay = 1000; // Initial delay of 1 second

    while (attempt < maxRetries) {
        try {
            const response = await fetch(url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });

            if (response.ok) {
                return response; // Success
            }

            if (response.status === 429) {
                console.warn(`Rate limit hit (attempt ${attempt + 1}/${maxRetries}). Retrying in ${delay}ms...`);
                await new Promise(res => setTimeout(res, delay));
                delay *= 2; // Exponentially increase delay
                attempt++;
            } else {
                // For other errors (like 400 or 500), don't retry.
                console.error(`Non-retriable API error: ${response.status}`);
                return response; // Return the failed response to be handled by the main function
            }
        } catch (error) {
            console.error(`Fetch error on attempt ${attempt + 1}:`, error);
            // This catches network errors etc. We'll retry these too.
            if (attempt >= maxRetries - 1) throw error; // If it's the last attempt, re-throw
            await new Promise(res => setTimeout(res, delay));
            delay *= 2;
            attempt++;
        }
    }
    // If all retries fail, return null or a specific error indicator
    return null;
}


// --- HELPER FUNCTION FOR TEXT FORMATTING ---
function formatLine(label, value, unit = '', reference = '') {
    const labelCol = label.padEnd(18, ' ');
    const valueCol = (String(value) || '').padEnd(12, ' ');
    const unitCol = unit.padEnd(11, ' ');
    return `${labelCol}${valueCol}${unitCol}${reference}\n`;
}

// --- HELPER FUNCTION FOR WORD WRAPPING ---
function wordWrap(text, maxWidth) {
    const lines = [];
    const sanitizedText = text.replace(/\s+/g, ' ').trim();
    const words = sanitizedText.split(' ');
    if (words.length === 0) return [];
    let currentLine = words[0];
    for (let i = 1; i < words.length; i++) {
        if ((currentLine + " " + words[i]).length > maxWidth) {
            lines.push(currentLine);
            currentLine = words[i];
        } else {
            currentLine += " " + words[i];
        }
    }
    lines.push(currentLine);
    return lines;
}


// --- MAIN NETLIFY FUNCTION HANDLER ---
exports.handler = async (event) => {
    if (event.httpMethod !== 'POST') {
        return { statusCode: 405, body: 'Method Not Allowed' };
    }

    try {
        const { scenario, gasType } = JSON.parse(event.body);
        const model = 'gemini-1.5-flash';
        const apiURL = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${API_KEY}`;

        // --- PROMPT 1: GET STRUCTURED CLINICAL DATA ---
        const dataGenerationPrompt = `You are a clinical data API. Based on the user's scenario, generate a realistic blood gas report.
        Your output MUST be a valid JSON object. Do not include any text before or after the JSON object. Do not use markdown.
        The value for the "bloodType" key must be "${gasType}".
        You MUST include every single key from the example JSON structure. Do not omit any keys.
        CRITICAL: All gas pressure values ('pco2', 'po2', 'aado2') MUST be in kPa units.
        You MUST use the following complete JSON structure:
        { "patientId": "123456", "lastName": "Smith", "firstName": "Jane", "temperature": "37.0", "fio2": "0.21", "r": "0.80", "ph": "7.35", "pco2": "5.50", "po2": "12.00", "na": "140", "k": "4.1", "cl": "100", "ca": "1.20", "hct": "45", "glucose": "5.5", "lactate": "1.2", "thb": "15.0", "o2hb": "98.0", "cohb": "1.1", "hhb": "1.9", "methb": "0.6", "be": "0.0", "chco3": "24.0", "aado2": "2.0", "so2": "98.2", "chco3st": "25.0", "p50": "3.5", "cto2": "20.0" }`;
        
        const dataPayload = {
            contents: [{ parts: [{ text: `${dataGenerationPrompt}\n\nClinical Scenario: ${scenario}` }] }],
            generationConfig: { temperature: 0.2, responseMimeType: "application/json" }
        };

        // --- API CALL 1: GENERATE THE DATA (with retry) ---
        const dataResponse = await fetchWithRetry(apiURL, dataPayload);
        if (!dataResponse || !dataResponse.ok) {
             throw new Error(`Google API (Data Gen) failed after retries with status: ${dataResponse?.status}`);
        }
        const dataResult = await dataResponse.json();
        const reportData = JSON.parse(dataResult.candidates[0].content.parts[0].text);

        // --- PROMPT 2: GET CLINICAL EXPLANATION ---
        const explanationPrompt = `You are a clinical educator. Given a clinical scenario and blood gas results, write a brief, clear explanation for instructors on how the results are consistent with the scenario. Focus on the key abnormal values and their physiological significance. Keep the explanation concise and to the point.

        SCENARIO:
        ${scenario}

        RESULTS (JSON):
        ${JSON.stringify(reportData, null, 2)}
        `;

        const explanationPayload = {
            contents: [{ parts: [{ text: explanationPrompt }] }],
            generationConfig: { temperature: 0.3 }
        };

        // --- API CALL 2: GENERATE THE EXPLANATION (with retry) ---
        const explanationResponse = await fetchWithRetry(apiURL, explanationPayload);
        if (!explanationResponse || !explanationResponse.ok) {
            throw new Error(`Google API (Explanation Gen) failed after retries with status: ${explanationResponse?.status}`);
        }
        const explanationResult = await explanationResponse.json();
        const explanationText = explanationResult.candidates[0].content.parts[0].text;

        // --- BUILD THE FINAL COMBINED REPORT ---
        let formattedReport = '';
        formattedReport += '                            Blood Gas\n';
        formattedReport += '                          Emergency Department\n';
        formattedReport += '────────────────────────────────────────────────────────\n';
        formattedReport += `Patient ID:         ${reportData.patientId || ''}\n`;
        formattedReport += `Last Name           ${reportData.lastName || ''}\n`;
        formattedReport += `First Name          ${reportData.firstName || ''}\n`;
        formattedReport += `Temperature         ${reportData.temperature || ''} ° C\n`;
        formattedReport += `FIO₂                ${reportData.fio2 || ''}\n`;
        formattedReport += `R                   ${reportData.r || ''}\n`;
        formattedReport += `Sample type         Blood\n`;
        formattedReport += `Blood Type          ${gasType}\n`;
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
        formattedReport += formatLine('AaDO₂', reportData.aado2, 'kPa'); // Enforced kPa unit
        formattedReport += formatLine('SO₂', reportData.so2, '%', '(75.0 – 99.0)');
        formattedReport += formatLine('cHCO₃ st', reportData.chco3st, 'mmol/L', '(22.4 – 25.8)');
        formattedReport += formatLine('P50', reportData.p50, 'kPa'); // P50 is also a pressure
        formattedReport += formatLine('ctO₂', reportData.cto2, 'Vol %');
        
        // --- ADD THE INSTRUCTOR BOX ---
        const boxWidth = 60;
        const contentWidth = boxWidth - 4;
        formattedReport += '\n\n';
        formattedReport += '┌' + '─'.repeat(boxWidth - 2) + '┐\n';
        formattedReport += '│ ' + 'Explanation for Instructors'.padEnd(boxWidth - 3) + '│\n';
        formattedReport += '├' + '─'.repeat(boxWidth - 2) + '┤\n';
        const scenarioLines = wordWrap(`Scenario: ${scenario}`, contentWidth);
        scenarioLines.forEach(line => {
            formattedReport += '│ ' + line.padEnd(contentWidth) + ' │\n';
        });
        formattedReport += '│ ' + ' '.repeat(contentWidth) + ' │\n';
        const explanationLines = wordWrap(explanationText, contentWidth);
        explanationLines.forEach(line => {
            formattedReport += `│ ${line.padEnd(contentWidth, ' ')} │\n`;
        });
        formattedReport += '└' + '─'.repeat(boxWidth - 2) + '┘\n';

        return {
            statusCode: 200,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ report: formattedReport }),
        };

    } catch (error) {
        console.error('Error in Netlify function:', error);
        return {
            statusCode: 500,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ error: 'Failed to generate report. Check function logs.' }),
        };
    }
};

