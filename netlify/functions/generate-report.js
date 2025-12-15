// The Gemini API key is stored securely in Netlify's environment variables
const API_KEY = process.env.GEMINI_API_KEY;

// --- HELPER FUNCTIONS ---

/**
 * Creates a consistently padded line for the report format.
 * @param {string} label - The parameter label (e.g., 'pH').
 * @param {string} value - The actual value.
 * @param {string} unit - The unit of measure (e.g., 'kPa').
 * @param {string} [reference=''] - The reference range.
 * @returns {string} The formatted line ending with a newline character.
 */
function formatLine(label, value, unit = '', reference = '') {
    const labelCol = label.padEnd(18, ' ');
    // Ensure value is treated as string for padding
    const valueStr = String(value || '').padEnd(12, ' ');
    const unitCol = unit.padEnd(11, ' ');
    return `${labelCol}${valueStr}${unitCol}${reference}\n`;
}

/**
 * Simple function to calculate DOB based on age in the scenario.
 * (No changes needed here)
 */
function getDobFromScenario(scenario) {
    const ageRegex = /\b(\d{1,3})\s*(year-old|year old|yo|y\/o)\b/i;
    const match = scenario.match(ageRegex);
    let age;
    if (match && match[1]) {
        age = parseInt(match[1], 10);
    } else {
        age = Math.floor(Math.random() * (90 - 18 + 1)) + 18;
    }
    const currentYear = new Date().getFullYear();
    const birthYear = currentYear - age;
    const birthMonth = Math.floor(Math.random() * 12) + 1;
    const birthDay = Math.floor(Math.random() * 28) + 1;
    const format = (num) => num.toString().padStart(2, '0');
    return `${format(birthDay)}/${format(birthMonth)}/${birthYear}`;
}

// --- MAIN FUNCTION HANDLER ---
exports.handler = async (event) => {
    if (event.httpMethod !== 'POST') {
        return { statusCode: 405, body: 'Method Not Allowed' };
    }

    try {
        const { scenario, gasType } = JSON.parse(event.body);

        // --- CRISPE-FORMATTED PROMPT ---
        const dataGenerationPrompt = `
### CRISPE Framework

1.  **Context**: This environment is a high-fidelity medical simulation setting. You must generate results that are absolutely physiologically coherent and internally consistent with the clinical context provided.
2.  **Role**: You are an Arterial and Venous Gas and Chemistry Analyser. Your sole function is to process the virtual 'sample' and return numerical results.
3.  **Instruction**: Given the clinical scenario, your task is to generate the complete data set for a physiologically plausible blood gas report. Your entire output MUST be a valid JSON object and contain nothing else.

4.  **Subject**: [User Scenario: ${scenario}]

5.  **Preset (Hard Constraints)**:
    * **Physiological Consistency**:
        * The entire report must be physiologically plausible and consistent with the scenario.
        * Acid-Base: pH, pco2, and bicarbonate must be linked.
        * Anion Gap: The Anion Gap must be high in scenarios like DKA or severe lactic acidosis.
        * Oxygenation: The A-a gradient must be high in scenarios involving lung pathology.
        * Compensation: Chronic conditions (like COPD) must show metabolic compensation.
    * **Scenario Overrides**:
        * Cardiac Arrest: Generate a severe mixed respiratory and metabolic acidosis with a very high lactate.
        * Venous Sample: Generate a low PO2 (4-6 kPa) and a slightly elevated PCO2.
    * **Units and Structure**:
        * All gas values (pCO2, pO2, AaDO2) must be in **kPa**.
        * The value for the "bloodType" key must be "${gasType}".
        * The final JSON output **must strictly adhere** to the following structure and include all keys.

\`\`\`json
{ 
    "patientId": "Q2039538", 
    "lastName": "BOURKE", 
    "firstName": "M", 
    "temperature": "37.0", 
    "fio2": "0.21", 
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
    "chco3st": "24.0",
    "p50": "3.5",
    "cto2": "18.0"
}
\`\`\`

6.  **Exception**: Do not include any introductory phrases, explanatory text, markdown outside of the JSON block, or any diagnostic interpretation before or after the JSON.
`; // The user scenario is embedded into the prompt template

        const model = 'gemini-2.5-flash'; 
        const apiURL = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${API_KEY}`;

        const dataResponse = await fetch(apiURL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                contents: [{ parts: [{ text: dataGenerationPrompt }] }], // Send the complete prompt string
                generationConfig: {
                    // Set to a low temperature for high consistency and accuracy
                    temperature: 0.2, 
                    responseMimeType: "application/json",
                }
            })
        });

        if (!dataResponse.ok) {
            throw new Error(`Google API Error: ${dataResponse.status}: ${await dataResponse.text()}`);
        }

        const dataResult = await dataResponse.json();
        const reportDataText = dataResult.candidates[0]?.content?.parts[0]?.text;

        if (!reportDataText) {
             throw new Error("API returned no text content for the report.");
        }
        
        // Safely parse the JSON, removing common LLM markdown wrappers if present
        const reportData = JSON.parse(reportDataText.replace(/^```json\s*|s*```$/g, '').trim());
        
        const dob = getDobFromScenario(scenario);

        // --- FINAL REPORT FORMATTING ---
        let formattedReport = '             Blood Gas\n' +
                             '           Emergency Department\n' +
                             '────────────────────────────────────────────────────────\n' +
                             // Demographics using formatLine
                             formatLine('Patient ID', reportData.patientId || '') +
                             formatLine('Last Name', reportData.lastName || '') +
                             formatLine('First Name', reportData.firstName || '') +
                             formatLine('Date of Birth', dob) +
                             formatLine('Temperature', reportData.temperature || '', '° C') +
                             formatLine('FIO₂', reportData.fio2 || '') +
                             formatLine('Sample type', 'Blood') +
                             formatLine('Blood Type', gasType) +
                             '────────────────────────────────────────────────────────\n';
                             
        // Blood Gas Values (Conditional on sample type)
        if (gasType === 'Venous') {
            formattedReport += formatLine('pH', reportData.ph, '', '(7.310 - 7.410)');
            formattedReport += formatLine('PCO₂', reportData.pco2, 'kPa', '(5.30 - 6.70)');
            formattedReport += formatLine('PO₂', reportData.po2, 'kPa', '(4.00 - 6.70)');
        } else {
            formattedReport += formatLine('pH', reportData.ph, '', '(7.350 - 7.450)');
            formattedReport += formatLine('PCO₂', reportData.pco2, 'kPa', '(4.67 - 6.00)');
            formattedReport += formatLine('PO₂', reportData.po2, 'kPa', '(10.67 - 13.33)');
        }
        
        // Electrolyte and Metabolite Values
        formattedReport += '────────────────────────────────────────────────────────\n' +
                           formatLine('Na⁺', reportData.na, 'mmol/L', '(135.0 - 148.0)') +
                           formatLine('K⁺', reportData.k, 'mmol/L', '(3.50 - 4.50)') +
                           formatLine('Cl⁻', reportData.cl, 'mmol/L', '(98.0 - 107.0)') +
                           formatLine('Ca²⁺', reportData.ca, 'mmol/L', '(1.120 - 1.320)') +
                           '────────────────────────────────────────────────────────\n' +
                           formatLine('HCT', reportData.hct, '%', '(35.0 – 50.0)') +
                           '────────────────────────────────────────────────────────\n' +
                           formatLine('Glucose', reportData.glucose, 'mmol/L', '(3.3 – 6.1)') +
                           formatLine('Lactate', reportData.lactate, 'mmol/L', '(0.4 – 2.2)') +
                           '────────────────────────────────────────────────────────\n';

        // Oximetry and Calculations
        formattedReport += formatLine('tHb', reportData.thb, 'g/dL', '(11.5 – 17.4)') +
                           formatLine('O₂ Hb', reportData.o2hb, '%', '(95.0 – 99.0)') +
                           formatLine('COHb', reportData.cohb, '%', '(0.5 – 2.5)') +
                           formatLine('HHb', reportData.hhb, '%', '(1.0 – 5.0)') +
                           formatLine('MetHb', reportData.methb, '%', '(0.4 – 1.5)') +
                           '────────────────────────────────────────────────────────\n' +
                           formatLine('BE', reportData.be, 'mmol/L', '(-2.3 – 2.3)') +
                           formatLine('cHCO₃', reportData.chco3, 'mmol/L') +
                           formatLine('AaDO₂', reportData.aado2, 'kPa') +
                           formatLine('SO₂', reportData.so2, '%', '(75.0 – 99.0)') +
                           formatLine('cHCO₃ st', reportData.chco3st, 'mmol/L', '(22.4 – 25.8)') +
                           formatLine('P50', reportData.p50, 'kPa') +
                           formatLine('ctO₂', reportData.cto2, 'Vol %') + '\n';
                           
        // The block for 'interpretation' is confirmed to be removed.

        return {
            statusCode: 200,
            body: JSON.stringify({ report: formattedReport }),
        };

    } catch (error) {
        console.error('Error in Netlify function:', error);
        return {
            statusCode: 500,
            body: JSON.stringify({ error: error.message || 'Failed to generate report.' }),
        };
    }
};
