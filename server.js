require("dotenv").config();
const express = require("express");
const cors = require("cors");
const axios = require("axios");
const app = express();
const PORT = 5000;

app.use(cors());
app.use(express.json());

const AZURE_OPENAI_ENDPOINT = process.env.AZURE_OPENAI_ENDPOINT;
const AZURE_OPENAI_API_KEY = process.env.AZURE_OPENAI_API_KEY;
const OPENAI_API_VERSION = "2025-01-01-preview";
const OPENAI_DEPLOYMENT_TYPE = "gpt-4o";

const SPEECH_KEY = process.env.SPEECH_KEY;
const SPEECH_REGION = process.env.SPEECH_REGION;
const SPEECH_ENDPOINT = process.env.SPEECH_ENDPOINT;
const SPEECH_API_VERSION = "2024-04-15-preview";

async function createBatchAvatarJob (text) {
    const jobId = `batchavatar-${crypto.randomUUID()}`;
    const jobUri = `${SPEECH_ENDPOINT}/avatar/batchsyntheses/${jobId}?api-version=${SPEECH_API_VERSION}`;

    const requestBody = {
        inputKind: "PlainText",
        inputs: [
            { content: text }
        ],
        synthesisConfig: { voice: "en-US-AvaMultilingualNeural" },
        avatarConfig: {
            talkingAvatarCharacter: "lisa",
            talkingAvatarStyle: "graceful-sitting",
            videoFormat: "mp4",
            videoCodec: "h264",
            subtitleType: "soft_embedded",
            backgroundColor: "#FFFFFFFF",
            customized: false
        }
    };

    try {
        const response = await axios.put(jobUri, requestBody, {
            headers: {
                "Ocp-Apim-Subscription-Key": SPEECH_KEY,
                "Content-Type": "application/json"
            }
        });
        console.log('response batch', response);
        console.log(`Batch avatar synthesis job ${jobId} created.`);
        return jobId;
    } catch (error) {
        console.error("Error creating job:", error.response?.data || error.message);
    }
}

async function getJobStatus (jobId) {
    const jobUri = `${SPEECH_ENDPOINT}/avatar/batchsyntheses/${jobId}?api-version=${SPEECH_API_VERSION}`;

    try {
        const response = await axios.get(jobUri, {
            headers: { "Ocp-Apim-Subscription-Key": SPEECH_KEY }
        });

        return response.data;
    } catch (error) {
        console.error("Error getting job status:", error.response?.data || error.message);
    }
}

async function pollJobUntilComplete (jobId) {
    console.log(`Polling job status for ${jobId}...`);

    while (true) {
        const job = await getJobStatus(jobId);
        if (!job) return;

        console.log(`Job ${jobId} status: ${job.status}`);

        if (job.status === "Succeeded" || job.status === "Failed") {
            break;
        }

        await new Promise(resolve => setTimeout(resolve, 5000)); // Wait 5 seconds
    }
}

// async function deleteJob (jobId) {
//     const jobUri = `${SPEECH_ENDPOINT}/avatar/batchsyntheses/${jobId}?api-version=${SPEECH_API_VERSION}`;

//     try {
//         await axios.delete(jobUri, {
//             headers: { "Ocp-Apim-Subscription-Key": SPEECH_KEY }
//         });

//         console.log(`Batch avatar synthesis job ${jobId} deleted.`);
//     } catch (error) {
//         console.error("Error deleting job:", error.response?.data || error.message);
//     }
// }

// async function listJobs () {
//     const listUri = `${SPEECH_ENDPOINT}/avatar/batchsyntheses?maxpagesize=10&api-version=${SPEECH_API_VERSION}`;

//     try {
//         const response = await axios.get(listUri, {
//             headers: { "Ocp-Apim-Subscription-Key": SPEECH_KEY }
//         });

//         console.log(`Listed ${response.data.value.length} jobs.`);
//         return response.data.value;
//     } catch (error) {
//         console.error("Error listing jobs:", error.response?.data || error.message);
//     }
// }

// Route to process speech and generate avatar
app.post("/process-speech", async (req, res) => {
    try {
        const { userText } = req.body; // Captured speech text from frontend

        // Call OpenAI to get answer
        const aiResponse = await axios.post(
            `${AZURE_OPENAI_ENDPOINT}/openai/deployments/${OPENAI_DEPLOYMENT_TYPE}/chat/completions?api-version=${OPENAI_API_VERSION}`,
            {
                model: "gpt-4o",
                messages: [ { role: "user", content: userText } ],
            },
            {
                headers: {
                    "api-key": AZURE_OPENAI_API_KEY,
                    "Content-Type": "application/json",
                },
            }
        );

        const aiText = aiResponse.data.choices[ 0 ].message.content;
        console.log('answer', aiText);
        // Call Azure Text-to-Speech for avatar video
        // const jobId = await generateAvatarVideo(aiText);

        const jobId = await createBatchAvatarJob(aiText);
        console.log('jobid', jobId);
        if (!jobId) return;

        await pollJobUntilComplete(jobId);

        const job = await getJobStatus(jobId);
        if (job.status === "Succeeded") {
            console.log("Video file:", job.outputs?.result);
            console.log("Summary file:", job.outputs?.summary);
        } else {
            console.log("Job failed.");
        }

        // await deleteJob(jobId);
        // await listJobs();
        console.log('json', job);
        res.json({ question: userText, answer: aiText, jobId, videoFile: job.outputs?.result, summaryFile: job.outputs?.summary, status: "Succeeded" });
    } catch (error) {
        console.error("Error:", error);
        res.status(500).json({ error: "Failed to process speech" });
    }
});

// Function to generate avatar video using Azure Speech
async function generateAvatarVideo (text) {
    try {
        const azureUrl = `${SPEECH_ENDPOINT}/avatar/batchsyntheses?api-version=${SPEECH_API_VERSION}`;

        const body = {
            description: "AI Avatar Video",
            locale: "en-US",
            synthesisConfig: {
                properties: {
                    outputFormat: "video/mp4",
                    voice: { name: "en-US-JennyMultilingualNeural" }, // Select voice
                    avatar: { name: "Jenny" }, // Select avatar
                    text: text,
                },
            },
        };
        console.log('body ', body);
        const response = await axios.post(azureUrl, body, {
            headers: {
                "Ocp-Apim-Subscription-Key": SPEECH_KEY,
                "Content-Type": "application/json",
            },
        });

        console.log('response ', response);

        return response.data.id; // Returns the Job ID for video processing
    } catch (error) {
        console.log(error);
        return error;
    }
}

// Route to check avatar synthesis status
app.get("/check-avatar-status/:jobId", async (req, res) => {
    try {
        const { jobId } = req.params;
        const statusUrl = `${SPEECH_ENDPOINT}/avatar/batchsyntheses/${jobId}?api-version=${SPEECH_API_VERSION}`;

        const response = await axios.get(statusUrl, {
            headers: {
                "Ocp-Apim-Subscription-Key": SPEECH_KEY,
            },
        });

        res.json(response.data);
    } catch (error) {
        console.error("Error checking avatar status:", error);
        res.status(500).json({ error: "Failed to check avatar status" });
    }
});

app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
