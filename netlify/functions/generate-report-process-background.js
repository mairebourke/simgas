import { getStore } from "@netlify/blobs";

// ---------- UTILITIES ----------
function wordWrap(text, maxWidth) {
  const lines = [];
  let currentLine = '';
  const words = (text || '').split(' ');
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
  const labelCol = (label || '').padEnd(18, ' ');
  const valueCol = (value ?? '').toString().padEnd(12, ' ');
  const unitCol = (unit || '').padEnd(11, ' ');
  return `${labelCol}${valueCol}${unitCol}${reference}\n`;
}

function getDobFromScenario(scenario) {
  const ageRegex = /\b(\d{1,3})\s*(year-old|year old|yo|y\/o)\b/i;
  const match = (scenario || '').match(ageRegex);
  const age = match?.[1] ? parseInt(match[1], 10) : Math.floor(Math.random() * (90 - 18 + 1)) + 18;
  const currentYear = new Date().getFullYear();
  const birthYear = currentYear - age;
  const birthMonth = Math.floor(Math.random() * 12) + 1;
  const birthDay = Math.floor(Math.random() * 28) + 1;
  const fmt = (n) => n.toString().padStart(2, '0');
  return `${fmt(birthDay)}/${fmt(birthMonth)}/${birthYear}`;
}

// --- Robust JSON extraction from model output ---
function stripCodeFences(s) {
  if (!s) return '';
  const trimmed = s.trim();
  if (trimmed.startsWith('```')) {
    return trimmed.replace(/^```[a-zA-Z]*\n?/, '').replace(/```\s*$/, '').trim();
  }
  return trimmed;
}
function extractFirstJsonObject(s) {
  let depth = 0; let start = -1;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (ch === '{') { if (depth === 0) start = i; depth++; }
    else if (ch === '}') { depth--; if (depth === 0 && start !== -1) return s.slice(start, i + 1); }
  }
  return null;
}
function safeParseModelJson(text) {
  const raw = stripCodeFences(text);
  try { return JSON.parse(raw); } catch {
    const candidate = extractFirstJsonObject(raw);
    if (candidate) return JSON.parse(candidate);
    throw new Error(`Model output not valid JSON. Starts: ${String(text).slice(0, 120)}`);
  }
}

function withTimeout(ms) {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), ms);
  return { signal: ac.signal, cancel: () => clearTimeout(t) };
}

async function callGemini({ scenario, gasType, apiKey, timeoutMs = 9000 }) {
  const apiURL = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`;

  // ---- Enhanced physiological prompt ----
  const dataGenerationPrompt = `You are an advanced clinical physiology simulator. Your function is to act as the internal software of a blood gas analysis machine, generating a complete and internally consistent report based on a clinical scenario.\n\nYour output MUST be a valid JSON object and nothing else. Do not use markdown, notes, or any text outside of the JSON structure.\n\n# Core Directive: Pathophysiological Consistency\nEvery value MUST be a direct, logical, and quantifiable consequence of the clinical scenario. Before outputting JSON, internally cross-check all fields against physiological rules and ensure they tell one coherent story (no mixed pathologies unless clearly justified).\n\n# Units & Conventions\n- Gas values in kPa, electrolytes in mmol/L, tHb in g/dL, saturations in %, temperature in °C, R=0.80 unless specified.\n\n# Physiological Principles\n1. **Henderson–Hasselbalch:** pH = 6.1 + log10(cHCO3⁻ / (0.225 × pCO₂₍kPa₎)).\n2. **Anion Gap:** (Na⁺ + K⁺) − (Cl⁻ + cHCO₃⁻); 8–16 mmol/L normal.\n   - High (>16) for DKA/lactic acidosis; Normal (8–16) for diarrhoea/RTA.\n3. **Delta Ratio:** (AG − 12) / (24 − cHCO₃⁻). Interpret for mixed disorders.\n4. **Respiratory Compensation:**\n   - Metabolic Acidosis: expected pCO₂ (kPa) = (0.2 × cHCO₃⁻) + 1.1.\n   - Metabolic Alkalosis: +0.09 kPa pCO₂ per +1 mmol/L cHCO₃⁻.\n5. **Metabolic Compensation:**\n   - Acute resp acidosis: +0.2 mmol/L HCO₃⁻ per +0.13 kPa pCO₂ above 5.3.\n   - Chronic resp acidosis: +0.5 mmol/L per +0.13 kPa.\n   - Acute resp alkalosis: −0.25 mmol/L per −0.13 kPa.\n   - Chronic resp alkalosis: −0.7 mmol/L per −0.13 kPa.\n6. **A–a Gradient:** (FiO₂ × 95) − (pCO₂ / R) − pO₂.\n   - Normal <2–3 kPa on room air; elevated in pneumonia/ARDS/PE/edema.\n7. **Hemoglobin Content:** ctO₂ (Vol%) = 1.34 × tHb × (sO₂/100) + 0.003 × pO₂(mmHg). Ensure O₂Hb+COHb+MetHb+HHb ≈100%.\n\n# Electrolyte Logic\n- Vomiting → metabolic alkalosis, low Cl⁻, variable K⁺, high HCO₃⁻.\n- Diarrhoea → NAGMA, low HCO₃⁻, high Cl⁻, K⁺ loss unless renal failure.\n- DKA → HAGMA, high glucose, high K⁺ (redistribution), low Na⁺ (dilutional).\n\n# Sample Type Mandates\n- bloodType = "${gasType}".\n- Venous: pO₂ 4.0–6.0 kPa; pCO₂ > arterial baseline; sO₂ 60–85%.\n- Arterial: pO₂, A–a consistent with FiO₂; normal lungs A–a <3 kPa.\n\n# Required JSON Fields\npatientId, lastName, firstName, temperature, fio2, r, bloodType, ph, pco2, po2, na, k, cl, ca, hct, glucose, lactate, thb, o2hb, cohb, hhb, methb, be, chco3, chco3st, aado2, so2, p50, cto2, interpretation.\n\n# Output Formatting\n- Round appropriately; gas 2dp, electrolytes 1dp, saturations 1dp.\n\n# Final Validation\nBefore output: confirm Henderson–Hasselbalch, compensation, AG, delta ratio, A–a, ctO₂, and saturation-sum consistency. Adjust and reverify before emitting.\n\n# Example JSON structure:\n{ "patientId": "123456", "lastName": "Smith", "firstName": "Jane", "temperature": "37.0", "fio2": "0.21", "r": "0.80", "bloodType": "${gasType}", "ph": "7.40", "pco2": "5.30", "po2": "12.00", "na": "140.0", "k": "4.0", "cl": "103.0", "ca": "1.20", "hct": "42", "glucose": "5.0", "lactate": "1.0", "thb": "14.0", "o2hb": "97.0", "cohb": "1.0", "hhb": "1.5", "methb": "0.5", "be": "0.0", "chco3": "24.0", "chco3st": "24.0", "aado2": "1.50", "so2": "97.5", "p50": "26.0", "cto2": "19.0", "interpretation": "Normal acid-base balance" }`;

  const body = {
    contents: [{ parts: [{ text: `${dataGenerationPrompt}\n\nClinical Scenario: ${scenario}` }] }],
    generationConfig: { temperature: 0.4, responseMimeType: 'application/json' }
  };

  const { signal, cancel } = withTimeout(timeoutMs);
  const res = await fetch(apiURL, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal
  });
  cancel();
  if (!res.ok) throw new Error(`Gemini API ${res.status}: ${await res.text()}`);
  const json = await res.json();
  if (json.error) throw new Error(json.error.message);
  const rawText = json?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!rawText) throw new Error('Empty model output');
  return safeParseModelJson(rawText);
}

// ---------- MAIN BACKGROUND HANDLER ----------
export default async (req) => {
  const { jobId } = await req.json();
  const reportStore = getStore('reports');
  try {
    const jobData = await reportStore.get(jobId, { type: 'json' });
    if (!jobData) throw new Error(`Job ${jobId} not found.`);
    const { scenario, gasType } = jobData;
    const API_KEY = process.env.GEMINI_API_KEY;
    const reportData = await callGemini({ scenario, gasType, apiKey: API_KEY });

    const dob = getDobFromScenario(scenario);
    let formattedReport = '                   Blood Gas\n' +
      '                 Emergency Department\n' +
      '────────────────────────────────────────────────────────\n' +
      `Patient ID:       ${reportData.patientId || ''}\n` +
      `Last Name         ${reportData.lastName || ''}\n` +
      `First Name        ${reportData.firstName || ''}\n` +
      `Date of Birth     ${dob}\n` +
      `Temperature       ${reportData.temperature || ''} °C\n` +
      `FIO₂              ${reportData.fio2 || ''}\n` +
      `R                 ${reportData.r || ''}\n` +
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

    await reportStore.setJSON(jobId, { status: 'completed', report: formattedReport });
  } catch (error) {
    await getStore('reports').setJSON(jobId, { status: 'failed', error: error.message });
  }
};

export const config = {
  path: '/.netlify/functions/generate-report-process-background',
  name: 'Report Generation Background Task',
  generator: '@netlify/generator-background@2.0.0',
};
