import { getStore } from "@netlify/blobs";
import { createBackgroundFunctionURL } from "@netlify/functions";
import { randomUUID } from "crypto";

export const handler = async (req) => {
    try {
        const { scenario, gasType } = JSON.parse(req.body);

        if (!scenario) {
            return {
                statusCode: 400,
                body: JSON.stringify({ error: "Scenario is required." }),
            };
        }

        const jobId = randomUUID();
        const reportStore = getStore("reports");

        // Set the initial status of the job
        await reportStore.setJSON(jobId, {
            status: "processing",
            scenario: scenario,
            gasType: gasType,
        });

        // Get the URL for the background function
        const backgroundFunctionUrl = createBackgroundFunctionURL("generate-report-process-background");
        
        // Asynchronously invoke the background function. 
        // We do NOT wait for this fetch to complete.
        fetch(backgroundFunctionUrl, {
            method: "POST",
            body: JSON.stringify({ jobId: jobId }),
        });

        // Immediately return a 202 "Accepted" response to the browser
        return {
            statusCode: 202, 
            body: JSON.stringify({ jobId: jobId }),
        };

    } catch (error) {
        console.error("Invoke Function Error:", error);
        return {
            statusCode: 500,
            body: JSON.stringify({ error: "Failed to start report generation." }),
        };
    }
};

