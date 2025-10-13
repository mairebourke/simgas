import { getStore } from "@netlify/blobs";

export const handler = async (req) => {
    // Get the jobId from the query string, e.g., /?jobId=...
    const jobId = req.queryStringParameters.jobId;

    if (!jobId) {
        return {
            statusCode: 400,
            body: JSON.stringify({ error: "jobId is required." }),
        };
    }

    try {
        const reportStore = getStore("reports");
        const jobData = await reportStore.get(jobId, { type: "json" });

        if (!jobData) {
            return {
                statusCode: 404,
                body: JSON.stringify({ error: "Job not found." }),
            };
        }
        
        // Return the current status of the job (e.g., "processing", "completed", "failed")
        return {
            statusCode: 200,
            body: JSON.stringify(jobData),
        };

    } catch (error) {
        console.error("Get Status Error:", error);
        return {
            statusCode: 500,
            body: JSON.stringify({ error: "Failed to retrieve report status." }),
        };
    }
};

