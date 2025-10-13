import { getStore } from "@netlify/blobs";
import { randomUUID } from "crypto";

export default async (req) => {
    try {
        const { scenario, gasType } = await req.json();
        const jobId = randomUUID(); // Use built-in crypto module
        const reportStore = getStore("reports");

        // Save the initial job status and input
        await reportStore.setJSON(jobId, {
            status: "processing",
            scenario: scenario,
            gasType: gasType,
            timestamp: new Date().toISOString()
        });
        
        // Netlify's mechanism to invoke a function in the background.
        // We don't wait for this to finish.
        fetch(`${process.env.URL}/.netlify/functions/generate-report-process-background`, {
            method: "POST",
            headers: { "x-netlify-lambda-v1-type": "background" },
            body: JSON.stringify({ jobId }),
        });
        
        // Immediately return the job ID to the user's browser
        return new Response(JSON.stringify({ jobId }), {
            status: 202, // 202 Accepted
            headers: { "Content-Type": "application/json" },
        });

    } catch (error) {
        console.error("Invoke Error:", error);
        return new Response(JSON.stringify({ error: "Failed to start report generation." }), {
            status: 500,
            headers: { "Content-Type": "application/json" },
        });
    }
};

