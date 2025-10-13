import { getStore } from "@netlify/blobs";

export default async (req, context) => {
    try {
        const url = new URL(req.url);
        const jobId = url.searchParams.get("jobId");

        if (!jobId) {
            return new Response(JSON.stringify({ error: "Job ID is required." }), {
                status: 400,
                headers: { "Content-Type": "application/json" },
            });
        }

        const jobStore = getStore("reports");
        const jobData = await jobStore.get(jobId, { type: "json" });

        if (!jobData) {
            return new Response(JSON.stringify({ error: "Job not found." }), {
                status: 404,
                headers: { "Content-Type": "application/json" },
            });
        }

        return new Response(JSON.stringify(jobData), {
            status: 200,
            headers: { "Content-Type": "application/json" },
        });

    } catch (error) {
        console.error("Status Check Error:", error);
        return new Response(JSON.stringify({ error: "Failed to get report status." }), {
            status: 500,
            headers: { "Content-Type": "application/json" },
        });
    }
};

export const config = {
    path: "/.netlify/functions/get-report-status",
    name: "Report Status Checker",
};

