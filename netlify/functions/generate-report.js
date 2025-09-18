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
You are an advanced clinical physiology simulator. Your function is to generate a complete and internally consistent blood gas report. Your output MUST be a valid JSON object and nothing else.

### MANDATORY Generation Protocol (Follow these steps in order)

**Step 1: DETERMINE SAMPLE TYPE (NON-NEGOTIABLE).**
First, look at the provided 'gasType' variable. This is the most important instruction and governs the next step.

**Step 2: LOCK IN OXYGENATION PARAMETERS.**
Based ONLY on the 'gasType' from Step 1, you MUST generate physiologically appropriate values for PO2, o2hb, and so2.
- **If 'gasType' is "Venous"**: The PO2 MUST be low (strictly between 4.0-6.0 kPa). The O2 saturations (o2hb, so2) MUST also be low (strictly between 60-80%). This is a fundamental, non-negotiable property of venous blood.
- **If 'gasType' is "Arterial"**: The PO2 and O2 saturation values MUST be consistent with the oxyhemoglobin dissociation curve. A PO2 of 8.0 kPa corresponds to an O2 saturation of ~90%. A normal PO2 (>10.5 kPa) requires a high saturation (>95%).

**Step 3: ANALYZE THE CLINICAL SCENARIO & ITS SEVERITY.**
Read the 'scenario' text to determine the primary pathology. Crucially, you must correlate the *severity* of the scenario with the *magnitude* of the physiological derangement.
- **Example - Severe AKI/Anuria**: This scenario MUST result in a severe high-anion-gap metabolic acidosis. This means you must generate a very low pH (<7.20), a very low cHCO₃ (<15 mmol/L), and a critically high Potassium (K⁺ > 5.5 mmol/L).
- **Example - Severe Sepsis**: This MUST result in a high lactate (>4.0 mmol/L) and a significant metabolic acidosis.
- A mild condition should have mild changes, while a severe condition like 'anuria' or 'cardiac arrest' demands profoundly abnormal values.

**Step 4: GENERATE ALL OTHER VALUES.**
Generate the remaining JSON values (pH, PCO2, electrolytes, etc.) to be consistent with the scenario's severity (Step 3). These values MUST co-exist logically with the locked-in oxygenation parameters from Step 2.

**Step 5: FINAL REVIEW.**
Before outputting the JSON, perform one final check: does the generated PO2 and O2 saturation strictly match the required 'gasType' as defined in Step 2? And do the acid-base parameters reflect the scenario's severity? If not, you must correct it.

### Other Physiological Principles to Maintain
- **Primary Acid-Base Consistency**: The pH, PCO2, and cHCO3 must match the disorder identified in the scenario (e.g., Respiratory Alkalosis = high pH, low PCO2).
- **Anion Gap**: Must be appropriate. High anion gaps (> 16 mmol/L) are expected in DKA, lactic acidosis, and toxidromes.
- **Fluid & Electrolyte Balance**: Electrolytes must reflect the scenario (e.g., Dehydration -> Hypernatremia).

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

