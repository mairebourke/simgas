const { getStore } = require("@netlify/blobs");
const { createBackgroundFunctionURL } = require("@netlify/functions");
const { randomUUID } = require("crypto");

exports.handler = async (event) => {
    try {
        const { scenario, gasType } = JSON.parse(event.body);

        if (!scenario) {
            return {
                statusCode: 400,
                body: JSON.stringify({ error: "Scenario is required." }),
            };
        }

        const jobId = randomUUID();
        const reportStore = getStore("reports");

        await reportStore.setJSON(jobId, {
            status: "processing",
            scenario: scenario,
            gasType: gasType,
        });

        const backgroundFunctionUrl = createBackgroundFunctionURL("generate-report-process-background");
        
        // This is a "fire-and-forget" call. We don't wait for it.
        fetch(backgroundFunctionUrl, {
            method: "POST",
            body: JSON.stringify({ jobId: jobId }),
        });

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

