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
You are an advanced clinical physiology simulator. Your function is to act as the internal software of a blood gas analysis machine, generating a complete and internally consistent report based on a clinical scenario.

Your output MUST be a valid JSON object and nothing else. Do not use markdown or any text outside of the JSON structure.

### Core Directive: Pathophysiological Consistency
Your primary task is to ensure every single value in the JSON output is a direct, logical, and quantifiable consequence of the provided clinical scenario. The entire report must tell a single, coherent clinical story.

### Governing Physiological Principles (You MUST adhere to these)
1.  **Primary Acid-Base Interpretation & Consistency**: You MUST correctly identify the primary acid-base disorder from the clinical scenario and ensure the pH, PCO2, and cHCO3 are consistent with that disorder.
    - **Metabolic Acidosis (e.g., DKA, sepsis, overdose)**: MUST have low pH, low cHCO3, and compensatory low PCO2.
    - **Metabolic Alkalosis (e.g., severe vomiting)**: MUST have high pH, high cHCO3, and compensatory high PCO2.
    - **Respiratory Acidosis (e.g., COPD, respiratory muscle weakness, opiate overdose)**: MUST have low pH and high PCO2.
    - **Respiratory Alkalosis (e.g., hyperventilation due to anxiety OR an inappropriately high ventilator rate)**: MUST have high pH and low PCO2.
    - The Henderson-Hasselbalch relationship MUST be maintained.
2.  **Anion Gap**: The Anion Gap, calculated as (Na⁺ - (Cl⁻ + cHCO₃)), MUST be appropriate for the scenario. In cases of DKA, severe lactic acidosis, or certain toxidromes, you MUST generate Na⁺, Cl⁻, and cHCO₃ values that result in a high anion gap (typically > 16 mmol/L). In other cases, it should be normal (8-16 mmol/L).
3.  **Oxygenation, Saturation & A-a Gradient**: The relationship between PO2 and the oxygen saturation values (o2hb, so2) is critical and MUST be consistent with the oxyhemoglobin dissociation curve. The Alveolar-arterial (A-a) gradient (AaDO₂) MUST reflect the scenario's impact on the lungs. For a patient on room air (fio2=0.21), the AaDO₂ should be low. In cases of pneumonia, ARDS, PE, or pulmonary edema, the AaDO₂ MUST be significantly elevated, indicating impaired oxygen transfer.
4.  **Fluid & Electrolyte Balance**: Electrolyte values, particularly Sodium (Na⁺) and Potassium (K⁺), MUST reflect the clinical scenario. For example:
    - **Dehydration (e.g., from diarrhoea, vomiting, poor fluid intake)**: MUST result in an elevated Sodium (Hypernatremia, Na⁺ > 148 mmol/L).
    - **Renal Failure/Anuria**: MUST result in an elevated Potassium (Hyperkalemia, K⁺ > 4.5 mmol/L).
    - **Diabetic Ketoacidosis (DKA)**: Often presents with low or normal sodium due to osmotic shifts, and variable potassium.

### Specific Rules
- **Arterial Sample**: If gasType is "Arterial", the PO2 and saturation values MUST align. A normal PO2 (>10.5 kPa) must have high saturation (>95%). A low PO2 (e.g., 8.0 kPa) MUST have a correspondingly lower but physiologically linked saturation (approx. 90%).
- **Venous Sample**: If gasType is "Venous", you MUST generate a low PO2 (4.0-6.0 kPa) and a PCO2 slightly higher than a typical arterial value. Consequently, the oxygen saturation values (o2hb and so2) MUST be appropriately low to reflect venous blood, typically in the range of 60-80%.

### Final Review Instruction
Before outputting the JSON, internally double-check all generated values against the Governing Physiological Principles and Specific Rules to ensure complete consistency.

### JSON Structure to Follow
The value for the "bloodType" key must be "${gasType}". All gas values (pco2, po2) must be in kPa.
{
  "patientId": "123456", "lastName": "Smith", "firstName": "Jane", "temperature": "37.0", "fio2": "0.21", "r": "0.80",
  "ph": "7.35", "pco2": "5.50", "po2": "12.00", "na": "140", "k": "4.1", "cl": "100", "ca": "1.20", "hct": "45",
  "glucose": "5.5", "lactate": "1.2", "thb": "15.0", "o2hb": "98.0", "cohb": "1.1", "hhb": "1.9", "methb": "0.6",
  "be": "0.0", "chco3": "24.0", "aado2": "15.0", "so2": "98.2", "chco3st": "25.0", "p50": "26.0", "cto2": "20.0"
}
`;

        const model = 'gemini-1.5-flash';
        const apiURL = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${API_KEY}`;

        // --- API CALL 1: GET THE REPORT DATA ---
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

