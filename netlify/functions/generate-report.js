// The Gemini API key is stored securely in Netlify's environment variables
const API_KEY = process.env.GEMINI_API_KEY;

// --- HELPER FUNCTIONS ---
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

        // --- FINAL SIMPLIFIED PROMPT ---
        const dataGenerationPrompt = `
You are a clinical data simulator. Your task is to generate a realistic blood gas report based on a clinical scenario.
Your output MUST be a valid JSON object and nothing else. Do not use markdown.

### Core Principles
- The entire report must be physiologically plausible and consistent with the scenario.
- **Acid-Base**: pH, pco2, and bicarbonate must be linked. High pco2 means lower pH (acidosis).
- **Anion Gap**: The Anion Gap must be high in scenarios like DKA or severe lactic acidosis.
- **Oxygenation**: The A-a gradient must be high in scenarios involving lung pathology (pneumonia, PE, ARDS).
- **Compensation**: Chronic conditions (like COPD) must show metabolic compensation. Acute events (like a seizure) must not.

### Specific Scenarios
- **Cardiac Arrest**: Generate a severe mixed respiratory and metabolic acidosis with a very high lactate.
- **Venous Sample**: Generate a low PO2 (4-6 kPa) and a slightly elevated PCO2.

### JSON Structure to Follow
The value for the "bloodType" key must be "${gasType}". All gas values must be in kPa.
{ "patientId": "123456", "lastName": "Smith", "firstName": "Jane", "temperature": "37.0", "fio2": "0.21", "ph": "7.35", "pco2": "5.50", "po2": "12.00", "na": "140", "k": "4.1", "cl": "100", "ca": "1.20", "hct": "45", "glucose": "5.5", "lactate": "1.2", "thb": "15.0", "o2hb": "98.0", "cohb": "1.1", "hhb": "1.9", "methb": "0.6", "be": "0.0", "chco3": "24.0", "aado2": "15.0", "so2": "98.2", "interpretation": "Plausible interpretation based on the data." }`;
        
        
        const model = 'gemini-2.5-flash'; 
        const apiURL = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${API_KEY}`;

        const dataResponse = await fetch(apiURL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                contents: [{ parts: [{ text: `${dataGenerationPrompt}\n\nClinical Scenario: ${scenario}` }] }],
                generationConfig: {
                    temperature: 0.2,
                    responseMimeType: "application/json",
                }
            })
        });

        if (!dataResponse.ok) {
            
            throw new Error(`Google API Error: ${dataResponse.status}`);
        }

        const dataResult = await dataResponse.json();
        const reportData = JSON.parse(dataResult.candidates[0].content.parts[0].text);
        
        const dob = getDobFromScenario(scenario);

        let formattedReport = '                   Blood Gas\n' +
                              '                 Emergency Department\n' +
                              '────────────────────────────────────────────────────────\n' +
                              `Patient ID:        ${reportData.patientId || ''}\n` +
                              `Last Name          ${reportData.lastName || ''}\n` +
                              `First Name         ${reportData.firstName || ''}\n` +
                              `Date of Birth      ${dob}\n` +
                              `Temperature        ${reportData.temperature || ''} ° C\n` +
                              `FIO₂               ${reportData.fio2 || ''}\n` +
                              `Sample type        Blood\n` +
                              `Blood Type         ${gasType}\n` +
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
