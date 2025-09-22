// The Gemini API key is stored securely in Netlify's environment variables
const API_KEY = process.env.GEMINI_API_KEY;

// --- HELPER FUNCTION FOR TEXT FORMATTING ---

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

function formatLine(label, value, unit = '', reference = '') {
    const labelCol = label.padEnd(18, ' ');
    const valueCol = (value || '').padEnd(12, ' ');
    const unitCol = unit.padEnd(11, ' ');
    return `${labelCol}${valueCol}${unitCol}${reference}\n`;
}

// --- MAIN FUNCTION HANDLER ---
exports.handler = async (event) => {
    if (event.httpMethod !== 'POST') {
        return { statusCode: 405, body: 'Method Not Allowed' };
    }

    try {
        const { scenario, gasType } = JSON.parse(event.body);

        // --- FINALIZED PROMPT ---
        const dataGenerationPrompt = `
You are an advanced clinical physiology simulator. Your sole task is to generate a complete and internally consistent blood gas report.

### OUTPUT REQUIREMENT
Your output MUST be a valid JSON object that strictly follows the schema below.

### SYSTEM MANDATE
1.  The laws of physiology and physics ALWAYS override the clinical scenario. These laws are inviolable.
2.  The "gasType" variable determines core oxygenation values. This is non-negotiable.
3.  The "Clinical Scenario" determines the metabolic and electrolyte state.

### CLINICAL SCENARIO INTERPRETATION
You MUST adjust metabolic and electrolyte values to be physiologically consistent with the provided scenario.
-   **Example - If scenario is "Diabetic Ketoacidosis (DKA)":**
    -   You MUST generate a **high \`glucose\`** value (e.g., > 15 mmol/L).
    -   You MUST generate a **low \`ph\`** and **low \`chco3\`** consistent with severe metabolic acidosis.
    -   **Potassium (\`k\`)** should be in the **high-normal or high range** on the initial report, reflecting the extracellular shift caused by acidosis, even if total body potassium is low.
    -   **Sodium (\`na\`)** should be in the **low or low-normal range** to reflect pseudohyponatremia from the high glucose.
    -   **\`lactate\`** may be mildly elevated.

### SAMPLE TYPE LAWS (NON-NEGOTIABLE)

**1. Venous Gas (Mandatory Rules):**
-   PO₂ MUST be between 4.0 and 6.0 kPa.
-   O₂ saturation (o2hb, so2) MUST be between 60% and 80%.

**2. Arterial Gas (Mandatory Rules):**
-   Arterial PO₂ MUST be between 9.0 kPa and 14.0 kPa. There are no exceptions.
-   Arterial SO₂ MUST be above 92% as a direct consequence.

### FINAL VALIDATION
Before outputting JSON, review your generated values against ALL mandates and laws above. If any rule is broken, you MUST correct the value before finalizing the output.

### JSON SCHEMA
All values must be strings, all gas values in kPa.
The value for "bloodType" must equal "\${gasType}".

{
  "patientId": "string", "lastName": "string", "firstName": "string", "temperature": "string", "fio2": "string", "r": "string", "ph": "string", "pco2": "string", "po2": "string", "na": "string", "k": "string", "cl": "string", "ca": "string", "hct": "string", "glucose": "string", "lactate": "string", "thb": "string", "o2hb": "string", "cohb": "string", "hhb": "string", "methb": "string", "be": "string", "chco3": "string", "aado2": "string", "so2": "string", "chco3st": "string", "p50": "string", "cto2": "string", "bloodType": "\${gasType}"
}
`;

        const model = 'gemini-1.5-flash';
        const apiURL = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${API_KEY}`;

        const dataResponse = await fetch(apiURL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                contents: [{ parts: [{ text: `${dataGenerationPrompt}\n\nClinical Scenario: ${scenario}` }] }],
                generationConfig: {
                    temperature: 0.4,
                    responseMimeType: "application/json",
                }
            })
        });

        if (!dataResponse.ok) {
            console.error("Google API Error (Data Gen):", await dataResponse.text());
            if (dataResponse.status === 503) {
                 throw new Error("The AI service is temporarily unavailable. Please try again in a moment.");
            }
            throw new Error(`Google API (Data Gen) Error: ${dataResponse.status}`);
        }

        const dataResult = await dataResponse.json();
        const reportData = JSON.parse(dataResult.candidates[0].content.parts[0].text);

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

        if (gasType === 'Venous') {
            formattedReport += formatLine('pH', reportData.ph, '', '(7.310 - 7.410)');
            formattedReport += formatLine('PCO₂', reportData.pco2, 'kPa', '(5.30 - 6.70)');
            formattedReport += formatLine('PO₂', reportData.po2, 'kPa', '(4.00 - 6.70)');
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
            formattedReport += formatLine('O₂ Hb', reportData.o2hb, '%', '(60.0 – 80.0)');
            formattedReport += formatLine('COHb', reportData.cohb, '%', '(0.5 – 2.5)');
            formattedReport += formatLine('HHb', reportData.hhb, '%', '(20.0 – 40.0)');
            formattedReport += formatLine('MetHb', reportData.methb, '%', '(0.4 – 1.5)');
            formattedReport += '────────────────────────────────────────────────────────\n';
            formattedReport += formatLine('BE', reportData.be, 'mmol/L', '(-2.3 – 2.3)');
            formattedReport += formatLine('cHCO₃', reportData.chco3, 'mmol/L');
            formattedReport += formatLine('AaDO₂', reportData.aado2, 'kPa');
            formattedReport += formatLine('SO₂', reportData.so2, '%', '(60.0 – 80.0)');
            formattedReport += formatLine('cHCO₃ st', reportData.chco3st, 'mmol/L', '(22.4 – 25.8)');
            formattedReport += formatLine('P50', reportData.p50, 'kPa');
            formattedReport += formatLine('ctO₂', reportData.cto2, 'Vol %');
        } else { // Arterial
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
            formattedReport += formatLine('AaDO₂', reportData.aado2, 'kPa');
            formattedReport += formatLine('SO₂', reportData.so2, '%', '(95.0 – 99.0)');
            formattedReport += formatLine('cHCO₃ st', reportData.chco3st, 'mmol/L', '(22.4 – 25.8)');
            formattedReport += formatLine('P50', reportData.p50, 'kPa');
            formattedReport += formatLine('ctO₂', reportData.cto2, 'Vol %');
        }

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
