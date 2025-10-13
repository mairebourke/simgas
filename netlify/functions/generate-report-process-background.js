import { getStore } from "@netlify/blobs";

// --- HELPER FUNCTIONS (Copied from your original file) ---
function wordWrap(text, maxWidth) {
    const lines = [];
    let currentLine = '';
    const words = text.split(' ');
    for (const word of words) {
        if ((currentLine + ' ' + word).length > maxWidth) {
            lines.push(currentLine);
            currentLine = word;
        } else {
            currentLine += (currentLine ? ' ' : '') + word;
        }
    }
    if (currentLine) lines.push(currentLine);
    return lines;
}

function formatLine(label, value, unit = '', reference = '') {
    const labelCol = label.padEnd(18, ' ');
    const valueCol = (value || '').padEnd(12, ' ');
    const unitCol = unit.padEnd(11, ' ');
    return `${labelCol}${valueCol}${unitCol}${reference}\n`;
}

// --- NEW HELPER FOR DATE OF BIRTH ---
function getDobFromScenario(scenario) {
    // Regex to find age like "68 year old", "68 yo", "68 y/o"
    const ageRegex = /\b(\d{1,3})\s*(year-old|year old|yo|y\/o)\b/i;
    const match = scenario.match(ageRegex);
    let age;

    if (match && match[1]) {
        age = parseInt(match[1], 10);
    } else {
        // If no age is found, generate a random one between 18 and 90
        age = Math.floor(Math.random() * (90 - 18 + 1)) + 18;
    }

    const currentYear = new Date().getFullYear();
    const birthYear = currentYear - age;

    // Generate a random month and day
    const birthMonth = Math.floor(Math.random() * 12) + 1;
    // Keep day simple to avoid issues with month lengths
    const birthDay = Math.floor(Math.random() * 28) + 1; 

    const format = (num) => num.toString().padStart(2, '0');
    return `${format(birthDay)}/${format(birthMonth)}/${birthYear}`;
}


// --- MAIN BACKGROUND HANDLER ---
export default async (req) => {
    const { jobId } = await req.json();
    const reportStore = getStore("reports");

    try {
        // 1. Get the job details from the blob store
        const jobData = await reportStore.get(jobId, { type: "json" });
        if (!jobData) throw new Error(`Job ${jobId} not found.`);

        const { scenario, gasType } = jobData;
        const API_KEY = process.env.GEMINI_API_KEY;

        // 2. Construct the prompt (ENHANCED with more technical detail)
        const dataGenerationPrompt = `
You are an advanced clinical physiology simulator. Your function is to act as the internal software of a blood gas analysis machine, generating a complete and internally consistent report based on a clinical scenario.
Your output MUST be a valid JSON object and nothing else. Do not use markdown, notes, or any text outside of the JSON structure.

### Core Directive: Pathophysiological Consistency
Your primary task is to ensure every single value in the JSON output is a direct, logical, and quantifiable consequence of the provided clinical scenario. Before outputting the JSON, internally double-check all values against the Governing Physiological Principles.

### Governing Physiological Principles (You MUST adhere to these)

1.  **Acid-Base Balance**: pH, pco2, and chco3 MUST be mathematically consistent (Henderson-Hasselbalch). An acute acidosis will have a lower pH for a given pco2 than a chronic, compensated state.

2.  **Anion Gap (AG)**:
    * Calculate as: AG = (Na⁺ + K⁺) - (Cl⁻ + cHCO₃⁻). Normal is 8-16 mmol/L.
    * Generate a high anion gap (HAGMA) for scenarios like DKA, lactic acidosis, or toxidromes.
    * Generate a normal anion gap (NAGMA) for scenarios like diarrhoea or RTA.

3.  **Delta Ratio (for HAGMA)**:
    * If a HAGMA exists, calculate the Delta Ratio to check for mixed disorders: (Actual AG - 12) / (24 - Actual cHCO₃⁻).
    * The generated values should result in a ratio that reflects the scenario: ~1-2 for pure HAGMA, >2 for HAGMA + metabolic alkalosis, <1 for HAGMA + NAGMA.

4.  **Respiratory Compensation Formulas**:
    * **Metabolic Acidosis**: The generated PaCO2 MUST be consistent with the expected value, following the standard formula where PaCO2 in kPa is approximately zero point two times the bicarbonate plus one point one.
    * **Metabolic Alkalosis**: For every 1 mmol/L rise in cHCO₃⁻, PaCO2 should rise by ~0.09 kPa.

5.  **Metabolic Compensation Formulas**:
    * **Acute Respiratory Acidosis**: cHCO₃⁻ should rise by ~0.2 mmol/L for every 0.13 kPa (1 mmHg) rise in PaCO2 above 5.3 kPa.
    * **Chronic Respiratory Acidosis**: cHCO₃⁻ should rise by ~0.5 mmol/L for every 0.13 kPa (1 mmHg) rise in PaCO2 above 5.3 kPa.
    * **Acute Respiratory Alkalosis**: cHCO₃⁻ should fall by ~0.25 mmol/L for every 0.13 kPa (1 mmHg) fall in PaCO2 below 5.3 kPa.
    * **Chronic Respiratory Alkalosis**: cHCO₃⁻ should fall by ~0.7 mmol/L for every 0.13 kPa (1 mmHg) fall in PaCO2 below 5.3 kPa.

6.  **Oxygenation & A-a Gradient**:
    * The Alveolar-arterial (A-a) gradient (in kPa) MUST reflect the scenario.
    * Formula: A-a = (FiO₂ * 95) - (PaCO₂ / 0.8) - PaO₂.
    * The A-a gradient MUST be elevated in cases of pneumonia, ARDS, PE, or pulmonary edema.

### Scenario-Specific Mandates
- **Venous Sample**: If gasType is "Venous", you MUST generate a low PO2 (4.0-6.0 kPa) and a PCO2 slightly higher than a typical arterial value.

### JSON Structure to Follow
The value for the "bloodType" key must be "${gasType}". All gas values (pco2, po2) must be in kPa.
{ "patientId": "123456", "lastName": "Smith", "firstName": "Jane", "temperature": "37.0", "fio2": "0.21", "ph": "7.35", "pco2": "5.50", "po2": "12.00", "na": "140", "k": "4.1", "cl": "100", "ca": "1.20", "hct": "45", "glucose": "5.5", "lactate": "1.2", "thb": "15.0", "o2hb": "98.0", "cohb": "1.1", "hhb": "1.9", "methb": "0.6", "be": "0.0", "chco3": "24.0", "aado2": "15.0", "so2": "98.2", "interpretation": "Normal Acid-Base Balance" }`;
        
        const model = 'gemini-2.5-flash-preview-05-20';
        const apiURL = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${API_KEY}`;

        // 3. Call the Gemini API
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
            throw new Error(`Google API Error: ${dataResponse.status}`);
        }

        const dataResult = await dataResponse.json();
        const reportData = JSON.parse(dataResult.candidates[0].content.parts[0].text);

        // 4. Format the final report text
        const dob = getDobFromScenario(scenario); // Get the DOB

        let formattedReport = '                   Blood Gas\n' +
                              '                 Emergency Department\n' +
                              '────────────────────────────────────────────────────────\n' +
                              `Patient ID:       ${reportData.patientId || ''}\n` +
                              `Last Name         ${reportData.lastName || ''}\n` +
                              `First Name        ${reportData.firstName || ''}\n` +
                              `Date of Birth     ${dob}\n` + // Replaced 'R' with 'Date of Birth'
                              `Temperature       ${reportData.temperature || ''} ° C\n` +
                              `FIO₂              ${reportData.fio2 || ''}\n` +
                              `Sample type       Blood\n` +
                              `Blood Type        ${gasType}\n` +
                              '────────────────────────────────────────────────────────\n';
        if (gasType === 'Venous') {
            formattedReport += formatLine('pH', reportData.ph, '', '(7.310 - 7.410)');
            formattedReport += formatLine('PCO₂', reportData.pco2, 'kPa', '(5.30 - 6.70)');
            formattedReport += formatLine('PO₂', reportData.po2, 'kPa', '(4.00 - 6.70)');
        } else {
            formattedReport += formatLine('pH', reportData.ph, '', '(7.350 - 7.450)');
            formattedReport += formatLine('PCO₂', reportData.pco2, 'kPa', '(4.67 - 6.00)');
            formattedReport += formatLine('PO₂', reportData.po2, 'kPa', '(10.67 - 13.33)');
        }
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
                           '────────────────────────────────────────────────────────\n' +
                           formatLine('tHb', reportData.thb, 'g/dL', '(11.5 – 17.4)') +
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
                           formatLine('ctO₂', reportData.cto2, 'Vol %') + '\n\n' +
                           '┌────────────────────────────────────────────────────────┐\n' +
                           '│ Interpretation                                         │\n' +
                           '├────────────────────────────────────────────────────────┤\n';
        const wrappedScenario = wordWrap(`Scenario: ${scenario}`, 54);
        wrappedScenario.forEach(line => { formattedReport += `│ ${line.padEnd(54, ' ')} │\n`; });
        formattedReport += `│ ${''.padEnd(54, ' ')} │\n`;
        const wrappedInterpretation = wordWrap(`Interpretation: ${reportData.interpretation || 'Not provided'}`, 54);
        wrappedInterpretation.forEach(line => { formattedReport += `│ ${line.padEnd(54, ' ')} │\n`; });
        formattedReport += '└────────────────────────────────────────────────────────┘\n';


        // 5. Save the successful result to the blob store
        await reportStore.setJSON(jobId, {
            status: "completed",
            report: formattedReport,
        });

    } catch (error) {
        console.error("Background Processing Error:", error);
        // 6. Save the failure details to the blob store
        await reportStore.setJSON(jobId, {
            status: "failed",
            error: error.message || "An unknown error occurred in the background task.",
        });
    }
};

// This config tells Netlify this is a background function
export const config = {
  path: "/.netlify/functions/generate-report-process-background",
  name: "Report Generation Background Task",
  generator: "@netlify/generator-background@2.0.0",
};

