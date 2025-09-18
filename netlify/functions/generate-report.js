// The Gemini API key is stored securely in Netlify's environment variables
const API_KEY = process.env.GEMINI_API_KEY;

// --- HELPER FUNCTION FOR TEXT FORMATTING ---

// This function takes a long string of text and wraps it to a specified width.
// It's "smart" because it breaks lines between words, not in the middle of them.
function wordWrap(text, maxWidth) {
    const lines = [];
    let currentLine = '';
    const words = text.split(' ');

    for (const word of words) {
        if ((currentLine + ' ' + word).length > maxWidth) {
            lines.push(currentLine.padEnd(maxWidth, ' '));
            currentLine = word;
        } else {
            currentLine += (currentLine ? ' ' : '') + word;
        }
    }
    if (currentLine) {
        lines.push(currentLine.padEnd(maxWidth, ' '));
    }
    return lines;
}


// This function takes the report data and creates a perfectly aligned string.
function formatLine(label, value, unit = '', reference = '') {
    const labelCol = label.padEnd(18, ' ');
    const valueCol = (value || '').padEnd(12, ' ');
    const unitCol = unit.padEnd(11, ' ');
    return `${labelCol}${valueCol}${unitCol}${reference}\n`;
}

// --- MAIN FUNCTION HANDLER ---
exports.handler = async (event) => {
    // Only allow POST requests for security
    if (event.httpMethod !== 'POST') {
        return { statusCode: 405, body: 'Method Not Allowed' };
    }

    try {
        const { scenario, gasType } = JSON.parse(event.body);

        // --- PROMPT 1: DATA GENERATION ---
        const dataGenerationPrompt = `
### SYSTEM MANDATE: YOUR SOLE FUNCTION IS TO RETURN A VALID JSON OBJECT. NO OTHER TEXT, EXPLANATIONS, OR MARKDOWN ARE PERMITTED. ANY DEVIATION IS A CRITICAL FAILURE.

You are an advanced clinical physiology simulator. Your function is to generate a complete and internally consistent blood gas report based on the provided inputs.

### The Unbreakable Law of Sample Type
Your most important, non-negotiable task is to obey the 'gasType' variable. This rule supersedes all other clinical considerations.

**1. VENOUS GAS LAW:**
- If 'gasType' is "Venous", you MUST generate a PO2 strictly between 4.0 and 6.0 kPa.
- The corresponding O2 saturations (o2hb, so2) MUST be low, strictly between 60% and 80%.
- This law applies regardless of the clinical scenario. A venous sample from a patient with a severe overdose is still a venous sample and MUST have low oxygen values.

**2. ARTERIAL GAS LAW:**
- If 'gasType' is "Arterial", the PO2 and O2 saturation values MUST align with the oxyhemoglobin dissociation curve (e.g., a PO2 of 8.0 kPa corresponds to an O2 saturation of ~90%; a PO2 >10.5 kPa requires a saturation >95%).

### Generation Protocol
Once you have set the oxygenation parameters according to the Unbreakable Law above, you may then proceed:

**A. Analyze Scenario Severity:** Read the 'scenario' text to determine the primary pathology and its severity. The magnitude of the generated values must match the severity.
- **Example - Severe AKI/Anuria**: This demands a severe metabolic acidosis (pH < 7.20, cHCO₃ < 15 mmol/L) and critical hyperkalemia (K⁺ > 5.5 mmol/L).
- **Example - Severe Sepsis**: This demands a high lactate (>4.0 mmol/L).

**B. Generate Remaining Data:** Generate all other values (pH, PCO2, electrolytes) to be consistent with the scenario's severity, ensuring they co-exist logically with the pre-determined oxygenation values.

**C. Final Adherence Check:** Before outputting, you MUST confirm that you have obeyed the Unbreakable Law of Sample Type and that your entire output is ONLY a valid JSON object.

### JSON Structure to Follow
The value for the "bloodType" key must be "${gasType}". All gas values must be in kPa.
{
  "patientId": "123456", "lastName": "Smith", "firstName": "Jane", "temperature": "37.0", "fio2": "0.21", "r": "0.80",
  "ph": "7.35", "pco2": "5.50", "po2": "12.00", "na": "140", "k": "4.1", "cl": "100", "ca": "1.20", "hct": "45",
  "glucose": "5.5", "lactate": "1.2", "thb": "15.0", "o2hb": "98.0", "cohb": "1.1", "hhb": "1.9", "methb": "0.6",
  "be": "0.0", "chco3": "24.0", "aado2": "15.0", "so2": "98.2", "chco3st": "25.0", "p50": "26.0", "cto2": "20.0"
}
`;

        const model = 'gemini-1.5-flash';
        const apiURL = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${API_KEY}`;
        
        const makeApiCall = async (retryCount = 0) => {
            const dataResponse = await fetch(apiURL, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    contents: [{ parts: [{ text: `${dataGenerationPrompt}\n\nClinical Scenario: ${scenario}` }] }],
                    generationConfig: {
                        temperature: 0.4,
                        responseMimeType: "application/json",
                    },
                    safetySettings: [
                        { category: "HARM_CATEGORY_HARASSMENT", threshold: "BLOCK_NONE" },
                        { category: "HARM_CATEGORY_HATE_SPEECH", threshold: "BLOCK_NONE" },
                        { category: "HARM_CATEGORY_SEXUALLY_EXPLICIT", threshold: "BLOCK_NONE" },
                        { category: "HARM_CATEGORY_DANGEROUS_CONTENT", threshold: "BLOCK_NONE" },
                    ]
                })
            });

            if (dataResponse.status === 429 && retryCount < 5) {
                const delay = Math.pow(2, retryCount) * 1000 + Math.random() * 1000;
                await new Promise(res => setTimeout(res, delay));
                return makeApiCall(retryCount + 1);
            }
            
            if (!dataResponse.ok) {
                 throw new Error(`Google API (Data Gen) Error: ${dataResponse.status}`);
            }

            return dataResponse.json();
        };


        const dataResult = await makeApiCall();
        
        if (!dataResult.candidates || dataResult.candidates.length === 0 || !dataResult.candidates[0].content || !dataResult.candidates[0].content.parts || dataResult.candidates[0].content.parts.length === 0) {
            throw new Error("The API returned an empty or invalid response. This may be due to safety filters blocking the content. Please try a different scenario.");
        }
        
        let reportData;
        try {
            const rawText = dataResult.candidates[0].content.parts[0].text;
            
            // Robust JSON cleaning logic
            const match = rawText.match(/\{[\s\S]*\}/);
            if (!match) {
                throw new Error("No valid JSON object found in the API response.");
            }
            const cleanedJson = match[0];
            reportData = JSON.parse(cleanedJson);

        } catch (e) {
            console.error("Failed to parse JSON response from API. Raw text was:", dataResult.candidates[0].content.parts[0].text);
            throw new Error(`Failed to parse the API's JSON response. Error: ${e.message}`);
        }


        // --- FORMAT THE MAIN REPORT ---
        let formattedReport = '';
        formattedReport += '                            Blood Gas\n';
        formattedReport += '                          Emergency Department\n';
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
        
        // Use correct reference ranges based on gas type
        if (gasType === 'Venous') {
            formattedReport += formatLine('pH', reportData.ph, '', '(7.310 - 7.410)');
            formattedReport += formatLine('PCO₂', reportData.pco2, 'kPa', '(5.30 - 6.70)');
            formattedReport += formatLine('PO₂', reportData.po2, 'kPa', '(4.00 - 6.70)');
        } else { // Arterial
            formattedReport += formatLine('pH', reportData.ph, '', '(7.350 - 7.450)');
            formattedReport += formatLine('PCO₂', reportData.pco2, 'kPa', '(4.67 - 6.00)');
            formattedReport += formatLine('PO₂', reportData.po2, 'kPa', '(10.67 - 13.33)');
        }

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
       
        // --- ADD THE SUMMARY BOX TO THE FINAL REPORT ---
        formattedReport += '\n\n';
        formattedReport += '┌────────────────────────────────────────────────────────┐\n';
        formattedReport += '│ Clinical Summary                                       │\n';
        formattedReport += '├────────────────────────────────────────────────────────┤\n';
        
        const scenarioLine = `Scenario: ${scenario}`;
        const wrappedScenario = wordWrap(scenarioLine, 54);
        for (const line of wrappedScenario) {
            formattedReport += `│ ${line.padEnd(54, ' ')} │\n`;
        }
        
        formattedReport += '└────────────────────────────────────────────────────────┘\n';
        
        // --- SEND THE FINAL, COMPLETE REPORT BACK TO THE FRONTEND ---
        return {
            statusCode: 200,
            body: JSON.stringify({ report: formattedReport }),
        };

    } catch (error) {
        console.error('Error in Netlify function:', error);
        return {
            statusCode: 500,
            body: JSON.stringify({ error: error.message || 'Failed to generate report. Check function logs.' }),
        };
    }
};

