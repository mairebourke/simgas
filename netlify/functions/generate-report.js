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

CONTEXT
You are operating inside a high-fidelity clinical simulation environment. Your task is
to generate physiologically coherent arterial or venous blood gas and chemistry results
that match the user-supplied clinical scenario. All values MUST be internally consistent.

ROLE
You are a laboratory blood gas and chemistry analyser. You output a laboratory printout
only. You do NOT provide interpretation, diagnosis, differential diagnoses, or advice.

INPUTS
Clinical scenario: {scenario}
Sample type: {sample_type}  (Arterial or Venous)

OUTPUT REQUIREMENTS
- Output must be plain text only. NO markdown, NO HTML.
- Use box-drawing characters (┌ ─ │ └ etc.) for all borders and tables.
- Total width MUST NOT exceed 80 characters.
- Organise the report into the following headings exactly:
  Identifications
  Blood Gas Values
  Electrolyte Values
  Metabolite Values
  Oximetry Values
- Present reference ranges in square brackets in the right-hand column.
- Identification fields (Patient ID, name, DOB, etc.) must be right-aligned and must not
  overlap labels.
- Generate a realistic random Patient ID (e.g., Q2039538).
- Calculate a date of birth consistent with the patient’s stated age.
- FiO₂ MUST ALWAYS be included in Identifications.
  * If not explicitly stated, infer a physiologically plausible FiO₂ from the scenario.
- Mark abnormal results with ↑ or ↓ beside the value.
- Units:
  * pCO₂ and pO₂ in kPa only
  * glucose in mmol/L only
  * electrolytes in mmol/L
  * lactate in mmol/L
  * Hb in g/dL, Hct in %, sO₂/O₂Hb/COHb/MetHb in %
- Use arterial reference ranges for arterial samples.
- Use venous reference ranges for venous samples.

PHYSIOLOGICAL CONSTRAINTS (HARD RULES)

1) Henderson–Hasselbalch consistency
- pH MUST be consistent with pCO₂ and HCO₃⁻:
  pH ≈ 6.1 + log10( HCO₃⁻ / (0.03 × pCO₂(mmHg)) )
  where pCO₂(mmHg) = pCO₂(kPa) × 7.5
- Permitted tolerance: ±0.03 pH units.

2) Base Excess definition (STANDARD BASE EXCESS)
- Base Excess (BE) represents the non-respiratory (metabolic) component of the acid–base
  disturbance after correction to a pCO₂ of 40 mmHg.
- BE must NOT reflect respiratory effects directly.
- Negative BE indicates metabolic acidosis.
- Positive BE indicates metabolic alkalosis.
- BE magnitude must be proportional to the metabolic disturbance implied by HCO₃⁻.

3) Base Excess–Bicarbonate coherence
- BE and HCO₃⁻ MUST agree in direction and magnitude:
  * Low HCO₃⁻ → negative BE
  * High HCO₃⁻ → positive BE
- Large absolute BE values imply severe metabolic derangement and must be supported by
  scenario severity (e.g. septic shock, cardiac arrest).

4) Compensation assessment (BOSTON / COPENHAGEN METHODS – INTERNAL ONLY)
- Use structured compensation logic internally to ensure physiological plausibility.
- Metabolic acidosis:
  * Expected pCO₂ ≈ 1.5 × HCO₃⁻ + 8 (±2) mmHg
- Metabolic alkalosis:
  * Expected pCO₂ rises ≈ 0.7 mmHg per 1 mmol/L HCO₃⁻ above normal
- Respiratory disorders:
  * Acute respiratory acidosis/alkalosis: small HCO₃⁻ and BE change
  * Chronic respiratory acidosis/alkalosis: larger HCO₃⁻ and BE change
- Ensure compensation does NOT exceed physiological limits.
- Mixed disorders are permitted when implied by the scenario.

5) Anion gap logic (INTERNAL ONLY)
- Anion gap = Na⁺ − (Cl⁻ + HCO₃⁻)
- Use anion gap internally to ensure electrolyte coherence.
- Elevated AG for scenarios such as septic shock, lactic acidosis, DKA.
- Normal AG for hyperchloraemic metabolic acidosis.
- DO NOT display anion gap in the output.

6) Oxygenation coherence
- Low pO₂ should generally correspond to reduced sO₂.
- High FiO₂ should generally increase pO₂ unless severe shunt or ARDS is implied.
- Venous samples should have lower pO₂ and lower saturations than arterial samples.
- Oximetry fractions must sum plausibly (O₂Hb + COHb + MetHb + HHb ≈ 100%).

7) Scenario matching
- Septic shock: metabolic acidosis, negative BE, elevated lactate.
- COPD exacerbation: hypercapnia, respiratory acidosis ± metabolic compensation.
- Cardiac arrest: severe mixed acidosis, very high lactate, poor oxygenation.
- Ensure the overall pattern matches the clinical context.

GENERATION PROCEDURE (INTERNAL ONLY – DO NOT PRINT)
A) Parse the scenario for age, sex, severity, oxygen therapy, and ventilation status.
B) Infer FiO₂ and document it.
C) Identify the primary acid–base disorder.
D) Select pH, pCO₂, and HCO₃⁻ consistent with the primary disorder.
E) Verify Henderson–Hasselbalch and compensation logic; adjust until coherent.
F) Assign BE consistent with standard base excess principles.
G) Choose electrolytes consistent with internal anion gap logic.
H) Choose metabolites (e.g. lactate, glucose) consistent with severity.
I) Choose oximetry values consistent with pO₂, FiO₂, and sample type.
J) Format the final laboratory report exactly as specified.

FINAL OUTPUT RULE
Return ONLY the laboratory printout. No interpretation, no explanation, no commentary,
and no text before or after the report.

    * **Units and Structure**:
        - All gas values (pCO₂, pO₂, AaDO₂) must be in **kPa**.
        - The value for the "bloodType" key must be "${gasType}".
        - The final JSON output must strictly adhere to the following structure and include all keys.

\`\`\`json
{ 
    "patientId": "GENERATE RANDOM NUMERIC ID", 
    "lastName": "GENERATE RANDOM NAME", 
    "firstName": "GENERATE RANDOM NAME", 
    "temperature": "", 
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

6. **Exception**: Do not include any introductory phrases, explanatory text, markdown outside the JSON block, or any diagnostic interpretation.
`;

        const model = 'gemini-2.5-flash';
        const apiURL = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${API_KEY}`;

        const dataResponse = await fetch(apiURL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                contents: [{ parts: [{ text: dataGenerationPrompt }] }],
                generationConfig: {
                    temperature: 0.2,
                    responseMimeType: 'application/json',
                },
            }),
        });

        if (!dataResponse.ok) {
            throw new Error(`Google API Error: ${dataResponse.status}: ${await dataResponse.text()}`);
        }

        const dataResult = await dataResponse.json();
        const reportDataText = dataResult.candidates[0]?.content?.parts[0]?.text;

        if (!reportDataText) {
            throw new Error('API returned no text content for the report.');
        }

        // Safely parse the JSON, removing common LLM markdown wrappers if present
        const reportData = JSON.parse(reportDataText.replace(/^```json\s*|s*```$/g, '').trim());

        const dob = getDobFromScenario(scenario);

        // --- FINAL REPORT FORMATTING ---
        let formattedReport = '             Blood Gas\n' +
                             '           Emergency Department\n' +
                             '────────────────────────────────────────────────────────\n' +
                             formatLine('Patient ID', reportData.patientId || '') +
                             formatLine('Last Name', reportData.lastName || '') +
                             formatLine('First Name', reportData.firstName || '') +
                             formatLine('Date of Birth', dob) +
                             formatLine('Temperature', reportData.temperature || '', '° C') +
                             formatLine('FIO₂', reportData.fio2 || '') +
                             formatLine('Sample type', 'Blood') +
                             formatLine('Blood Type', gasType) +
                             '────────────────────────────────────────────────────────\n';

        // Blood Gas Values (conditional on sample type)
        if (gasType === 'Venous') {
            formattedReport += formatLine('pH', reportData.ph, '', '(7.310 - 7.410)');
            formattedReport += formatLine('PCO₂', reportData.pco2, 'kPa', '(5.30 - 6.70)');
            formattedReport += formatLine('PO₂', reportData.po2, 'kPa', '(4.00 - 6.70)');
        } else {
            formattedReport += formatLine('pH', reportData.ph, '', '(7.350 - 7.450)');
            formattedReport += formatLine('PCO₂', reportData.pco2, 'kPa', '(4.67 - 6.00)');
            formattedReport += formatLine('PO₂', reportData.po2, 'kPa', '(10.67 - 13.33)');
        }

        // Electrolyte and metabolite values
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

        // Oximetry and calculations
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

        // No interpretation block

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
