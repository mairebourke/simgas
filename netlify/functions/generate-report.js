// netlify/functions/gas-report.js

// The Gemini API key is stored securely in Netlify's environment variables
const API_KEY = process.env.GEMINI_API_KEY;

// --- HELPERS ---

// Monospace-friendly word wrap (breaks on spaces, pads to fixed width)
function wordWrap(text, maxWidth) {
  const lines = [];
  let currentLine = '';
  const words = String(text ?? '').split(' ');

  for (const word of words) {
    if ((currentLine + ' ' + word).length > maxWidth) {
      lines.push(currentLine.padEnd(maxWidth, ' '));
      currentLine = word;
    } else {
      currentLine += (currentLine ? ' ' : '') + word;
    }
  }
  if (currentLine) lines.push(currentLine.padEnd(maxWidth, ' '));
  return lines;
}

// Formats a single aligned line in the report
function formatLine(label, value, unit = '', reference = '') {
  const labelCol = String(label ?? '').padEnd(18, ' ');
  const valueCol = String(value ?? '').padEnd(12, ' ');
  const unitCol = String(unit ?? '').padEnd(11, ' ');
  return `${labelCol}${valueCol}${unitCol}${reference}\n`;
}

// Number formatter (keeps up to 2 decimals, blank if null/NaN)
const fmt = (n) =>
  n === null || n === undefined || Number.isNaN(Number(n))
    ? ''
    : new Intl.NumberFormat('en-GB', { maximumFractionDigits: 2 }).format(Number(n));

// Unit conversion
const mmHgToKPa = (x) =>
  x == null || Number.isNaN(Number(x)) ? null : Number(x) * 0.133322;

// Normalize JSON numeric-looking values into numbers
function normalizeNumbers(obj, keys) {
  for (const key of keys) {
    if (key in obj) {
      const val = obj[key];
      obj[key] = val === '' || val === null || val === undefined ? null : Number(val);
    }
  }
}

// Enforce the “Unbreakable Law of Sample Type” + loose curve checks
function enforceGasLaws(reportData, gasType) {
  const sampleType = String(gasType || '').toLowerCase();

  if (sampleType === 'venous') {
    // PO2 strictly between 4.0 and 6.0 kPa
    if (!(reportData.po2 > 4.0 && reportData.po2 < 6.0)) {
      reportData.po2 = Math.min(5.9, Math.max(4.1, Number(reportData.po2) || 5.0));
    }
    // SO2 60–80%
    if (!(reportData.so2 > 60 && reportData.so2 < 80)) {
      reportData.so2 = Math.min(79, Math.max(61, Number(reportData.so2) || 70));
    }
    // Keep o2hb aligned with so2 if present
    if (reportData.o2hb != null) reportData.o2hb = reportData.so2;
  } else if (sampleType === 'arterial') {
    // Loose consistency with ODC
    const p = Number(reportData.po2) || 12;
    let minSat = 70;
    if (p >= 10.5) minSat = 96;
    else if (p >= 9.5) minSat = 94;
    else if (p >= 8.0) minSat = 89;
    else if (p >= 7.0) minSat = 85;

    if (!(reportData.so2 >= minSat)) reportData.so2 = minSat;
    if (reportData.o2hb != null) reportData.o2hb = reportData.so2;
  } else {
    throw new Error("Invalid gasType. Use 'Arterial' or 'Venous'.");
  }

  // Mirror gasType into JSON body for clarity
  reportData.bloodType = gasType;
}

// Soft sanity guards for impossible values (kept gentle, not failing hard)
function softGuards(reportData) {
  // Example clamps (only if wildly out-of-bounds)
  if (reportData.ph != null) {
    if (reportData.ph < 6.8) reportData.ph = 6.80;
    if (reportData.ph > 7.8) reportData.ph = 7.80;
  }
  if (reportData.k != null) {
    if (reportData.k < 1.5) reportData.k = 1.5;
    if (reportData.k > 9.0) reportData.k = 9.0;
  }
}

// --- MAIN FUNCTION HANDLER ---
exports.handler = async (event) => {
  // Only allow POST requests for security
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  try {
    const { scenario, gasType } = JSON.parse(event.body || '{}');
    if (!scenario || !gasType) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: "Missing required fields 'scenario' and/or 'gasType'." }),
      };
    }

    // --- PROMPT: DATA GENERATION (SI units, kPa emphasis) ---
    const dataGenerationPrompt = `
### SYSTEM MANDATE: YOUR SOLE FUNCTION IS TO RETURN A VALID JSON OBJECT. NO OTHER TEXT, EXPLANATIONS, OR MARKDOWN ARE PERMITTED. ANY DEVIATION IS A CRITICAL FAILURE.

You are an advanced clinical physiology simulator. Your function is to generate a complete and internally consistent blood gas report based on the provided inputs.

### The Unbreakable Law of Sample Type
Your most important, non-negotiable task is to obey the 'gasType' variable. This rule supersedes all other clinical considerations.

**1. VENOUS GAS LAW:**
- If 'gasType' is "Venous", you MUST generate a PO2 strictly between 4.0 and 6.0 kPa.
- The corresponding O2 saturations (o2hb, so2) MUST be low, strictly between 60% and 80%.
- This law applies regardless of the clinical scenario.

**2. ARTERIAL GAS LAW:**
- If 'gasType' is "Arterial", the PO2 and O2 saturation values MUST align with the oxyhemoglobin dissociation curve (e.g., a PO2 of 8.0 kPa corresponds to an O2 saturation of ~90%; a PO2 >10.5 kPa requires a saturation >95%).

### Generation Protocol
Once you have set the oxygenation parameters according to the Unbreakable Law above, you may then proceed:

**A. Analyze Scenario Severity:** Read the 'scenario' text to determine the primary pathology and its severity. The magnitude of the generated values must match the severity.
- Example - Severe AKI/Anuria: severe metabolic acidosis (pH < 7.20, cHCO3 < 15 mmol/L) and hyperkalemia (K+ > 5.5 mmol/L).
- Example - Severe Sepsis: high lactate (>4.0 mmol/L).

**B. Generate Remaining Data:** Generate all other values (pH, PCO2, electrolytes) to be consistent with the scenario's severity, ensuring they co-exist logically with the pre-determined oxygenation values.

**C. Final Adherence Check:** Before outputting, you MUST confirm that you have obeyed the Unbreakable Law of Sample Type and that your entire output is ONLY a valid JSON object.

### JSON Structure to Follow
All gas values MUST be in kPa. The value for the "bloodType" key must be "${gasType}".
{
  "patientId": "123456", "lastName": "Smith", "firstName": "Jane", "temperature": "37.0", "fio2": "0.21", "r": "0.80",
  "ph": "7.35", "pco2": "5.50", "po2": "12.00", "na": "140", "k": "4.1", "cl": "100", "ca": "1.20", "hct": "45",
  "glucose": "5.5", "lactate": "1.2", "thb": "15.0", "o2hb": "98.0", "cohb": "1.1", "hhb": "1.9", "methb": "0.6",
  "be": "0.0", "chco3": "24.0", "aado2": "2.0", "so2": "98.2", "chco3st": "25.0", "p50": "3.47", "cto2": "20.0",
  "bloodType": "${gasType}"
}
`;

    const model = 'gemini-1.5-flash';
    const apiURL = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${API_KEY}`;

    // API call with exponential backoff on 429
    const makeApiCall = async (retryCount = 0) => {
      const dataResponse = await fetch(apiURL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: `${dataGenerationPrompt}\n\nClinical Scenario: ${scenario}` }] }],
          generationConfig: {
            temperature: 0.4,
            responseMimeType: 'application/json',
          },
          // Safer to omit safetySettings in production unless needed
        }),
      });

      if (dataResponse.status === 429 && retryCount < 5) {
        const delay = Math.pow(2, retryCount) * 1000 + Math.random() * 1000;
        await new Promise((res) => setTimeout(res, delay));
        return makeApiCall(retryCount + 1);
      }

      if (!dataResponse.ok) {
        const detail = await dataResponse.text().catch(() => '');
        throw new Error(`Google API Error: ${dataResponse.status} ${detail}`);
      }

      return dataResponse.json();
    };

    const dataResult = await makeApiCall();

    // --- Robust JSON extraction ---
    const content = dataResult?.candidates?.[0]?.content?.parts?.[0]?.text ?? '';
    let rawJson = String(content).trim();

    if (!rawJson) {
      throw new Error('Empty response from model.');
    }
    if (rawJson.startsWith('```')) {
      rawJson = rawJson.replace(/^```(?:json)?\s*/i, '').replace(/```$/, '').trim();
    }
    if (!rawJson.startsWith('{')) {
      const match = rawJson.match(/\{[\s\S]*\}/);
      if (!match) throw new Error('No valid JSON object found in the API response.');
      rawJson = match[0];
    }

    let reportData = JSON.parse(rawJson);

    // --- Normalize numeric fields ---
    const numericKeys = [
      'temperature', 'fio2', 'r', 'ph', 'pco2', 'po2', 'na', 'k', 'cl', 'ca', 'hct',
      'glucose', 'lactate', 'thb', 'o2hb', 'cohb', 'hhb', 'methb', 'be', 'chco3',
      'aado2', 'so2', 'chco3st', 'p50', 'cto2',
    ];
    normalizeNumbers(reportData, numericKeys);

    // --- Convert units to SI when suspiciously in mmHg (AaDO2, P50) ---
    // Heuristics: typical A–a in room air rarely > 4 kPa; if > 40 it's likely mmHg.
    if (reportData.aado2 != null && reportData.aado2 > 40) {
      reportData.aado2 = mmHgToKPa(reportData.aado2);
    }
    // P50 physiological ~26–27 mmHg ≈ 3.47–3.60 kPa; if value looks >10, likely mmHg
    if (reportData.p50 != null && reportData.p50 > 10) {
      reportData.p50 = mmHgToKPa(reportData.p50);
    }

    // --- Enforce sample-type oxygen laws + light sanity guards ---
    enforceGasLaws(reportData, gasType);
    softGuards(reportData);

    // --- FORMAT THE MAIN REPORT ---
    let formattedReport = '';
    formattedReport += '                            Blood Gas\n';
    formattedReport += '                          Emergency Department\n';
    formattedReport += '────────────────────────────────────────────────────────\n';
    formattedReport += `Patient ID:       ${reportData.patientId ?? ''}\n`;
    formattedReport += `Last Name         ${reportData.lastName ?? ''}\n`;
    formattedReport += `First Name        ${reportData.firstName ?? ''}\n`;
    formattedReport += `Temperature       ${fmt(reportData.temperature)} °C\n`;
    formattedReport += `FIO₂              ${fmt(reportData.fio2)}\n`;
    formattedReport += `R                 ${fmt(reportData.r)}\n`;
    formattedReport += `Sample Type       ${gasType}\n`;
    formattedReport += '────────────────────────────────────────────────────────\n';

    // Use correct reference ranges based on gas type
    if (gasType === 'Venous') {
      formattedReport += formatLine('pH', fmt(reportData.ph), '', '(7.310 - 7.410)');
      formattedReport += formatLine('PCO₂', fmt(reportData.pco2), 'kPa', '(5.30 - 6.70)');
      // Align exactly with the strict law:
      formattedReport += formatLine('PO₂', fmt(reportData.po2), 'kPa', '(4.00 - 6.00)');
    } else {
      formattedReport += formatLine('pH', fmt(reportData.ph), '', '(7.350 - 7.450)');
      formattedReport += formatLine('PCO₂', fmt(reportData.pco2), 'kPa', '(4.67 - 6.00)');
      formattedReport += formatLine('PO₂', fmt(reportData.po2), 'kPa', '(10.67 - 13.33)');
    }

    formattedReport += '────────────────────────────────────────────────────────\n';
    formattedReport += formatLine('Na⁺', fmt(reportData.na), 'mmol/L', '(135.0 - 148.0)');
    formattedReport += formatLine('K⁺', fmt(reportData.k), 'mmol/L', '(3.50 - 4.50)');
    formattedReport += formatLine('Cl⁻', fmt(reportData.cl), 'mmol/L', '(98.0 - 107.0)');
    formattedReport += formatLine('Ca²⁺', fmt(reportData.ca), 'mmol/L', '(1.120 - 1.320)');
    formattedReport += '────────────────────────────────────────────────────────\n';
    formattedReport += formatLine('HCT', fmt(reportData.hct), '%', '(35.0 – 50.0)');
    formattedReport += '────────────────────────────────────────────────────────\n';
    formattedReport += formatLine('Glucose', fmt(reportData.glucose), 'mmol/L', '(3.3 – 6.1)');
    formattedReport += formatLine('Lactate', fmt(reportData.lactate), 'mmol/L', '(0.4 – 2.2)');
    formattedReport += '────────────────────────────────────────────────────────\n';
    formattedReport += formatLine('tHb', fmt(reportData.thb), 'g/dL', '(11.5 – 17.4)');
    // For venous, O2 Hb reference will be low; keep a broad reference across contexts
    formattedReport += formatLine('O₂ Hb', fmt(reportData.o2hb), '%', gasType === 'Venous' ? '(60.0 – 80.0)' : '(95.0 – 99.0)');
    formattedReport += formatLine('COHb', fmt(reportData.cohb), '%', '(0.5 – 2.5)');
    formattedReport += formatLine('HHb', fmt(reportData.hhb), '%', '(1.0 – 5.0)');
    formattedReport += formatLine('MetHb', fmt(reportData.methb), '%', '(0.4 – 1.5)');
    formattedReport += '────────────────────────────────────────────────────────\n';
    formattedReport += formatLine('BE', fmt(reportData.be), 'mmol/L', '(-2.3 – 2.3)');
    formattedReport += formatLine('cHCO₃', fmt(reportData.chco3), 'mmol/L');
    // SI units for gradients and P50:
    formattedReport += formatLine('AaDO₂', fmt(reportData.aado2), 'kPa');
    formattedReport += formatLine('SO₂', fmt(reportData.so2), '%', gasType === 'Venous' ? '(60.0 – 80.0)' : '(95.0 – 99.0)');
    formattedReport += formatLine('cHCO₃ st', fmt(reportData.chco3st), 'mmol/L', '(22.4 – 25.8)');
    formattedReport += formatLine('P50', fmt(reportData.p50), 'kPa'); // ~3.47 kPa normal
    formattedReport += formatLine('ctO₂', fmt(reportData.cto2), 'mL/dL');
    
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
      body: JSON.stringify({ report: formattedReport, raw: reportData }),
    };
  } catch (error) {
    console.error('Error in Netlify function:', error);
    return {
      statusCode: 500,
      body: JSON.stringify({
        error: error.message || 'Failed to generate report. Check function logs.',
      }),
    };
  }
};
