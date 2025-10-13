import { getStore } from "@netlify/blobs";
import { v4 as uuidv4 } from "uuid";

export default async (req, context) => {
    try {
        const { scenario, gasType } = await req.json();
        const jobId = uuidv4(); // Create a unique ID for this job
        const jobStore = getStore("reports");

        // Save the initial job status and input
        await jobStore.setJSON(jobId, {
            status: "processing",
            scenario: scenario,
            gasType: gasType,
            timestamp: new Date().toISOString()
        });

        // Invoke the background function asynchronously
        context.callbackWaitsForEmptyEventLoop = false;
        context.clientContext.custom = {
            invoke: "background",
            jobId: jobId
        };
        const backgroundFunctionUrl = new URL(
           "/.netlify/functions/generate-report-process-background",
            context.site.url
        );
        
        // We don't wait for this fetch to complete
        fetch(backgroundFunctionUrl, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
            },
            body: JSON.stringify({ jobId }),
        });
        
        // Immediately return the job ID to the user
        return new Response(JSON.stringify({ jobId }), {
            status: 202,
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

export const config = {
    path: "/.netlify/functions/generate-report-invoke",
    // This is NOT a background function
    name: "Report Generation Invoker",
};

