// Add delay function to handle API rate limits
function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

let isStarted = false;

// Listen for messages from popup
chrome.runtime.onMessage.addListener(function(request, sender, sendResponse) {
    if (request.command === "start_answering") {
        isStarted = true;
        startAnswering();
    }
});

// Function to increment question count
async function incrementQuestionCount() {
    const result = await chrome.storage.sync.get(['questionCount']);
    const newCount = (result.questionCount || 0) + 1;
    await chrome.storage.sync.set({ questionCount: newCount });
}

// Automate Tangosta quiz answering with improved performance
async function startAnswering() {
    if (!isStarted) return;

    const questionAreas = document.querySelectorAll('.exam_inner_area.exam_choice_area');
    const CONSTANT_DELAY = 1500; // Consistent delay between questions
    const BATCH_SIZE = 2; // Number of concurrent requests

    // Process questions in batches
    for (let i = 0; i < questionAreas.length; i += BATCH_SIZE) {
        const batch = Array.from(questionAreas).slice(i, i + BATCH_SIZE);
        
        // Process each batch concurrently
        const promises = batch.map(async (questionArea) => {
            try {
                // Extract the question text
                const questionElement = questionArea.previousElementSibling.querySelector('.exam_sentence_filling_question');
                if (!questionElement) {
                    console.error("Question text not found for this question block.");
                    return;
                }

                const questionText = questionElement.textContent.trim();
                const options = Array.from(questionArea.querySelectorAll('.exam_btn.default'))
                    .map(option => option.textContent.trim());

                console.log(`Processing question: ${questionText}`);
                console.log(`Options: ${options.join(', ')}`);

                // Query ChatGPT for the correct answer
                const correctAnswer = await getCorrectAnswerFromAPI(questionText, options);

                if (correctAnswer) {
                    const correctOption = Array.from(questionArea.querySelectorAll('.exam_btn.default'))
                        .find(option => option.textContent.trim() === correctAnswer);
                    
                    if (correctOption) {
                        correctOption.click();
                        console.log(`Answered: ${questionText} -> ${correctAnswer}`);
                        await incrementQuestionCount(); // Increment counter for each successful answer
                    } else {
                        console.error(`Correct answer not found in options for question: ${questionText}`);
                    }
                }
            } catch (error) {
                console.error(`Error processing question: ${error.message}`);
            }
        });

        // Wait for batch to complete
        await Promise.all(promises);
        
        // Add constant delay between batches
        if (i + BATCH_SIZE < questionAreas.length) {
            await delay(CONSTANT_DELAY);
        }
    }
}

// Function to call OpenAI API with exponential backoff
async function getCorrectAnswerFromAPI(questionText, options, retryCount = 0) {
    const MAX_RETRIES = 3;
    const BASE_DELAY = 1000;

    // Get the API key from storage
    const storage = await chrome.storage.sync.get(['openaiApiKey']);
    const apiKey = storage.openaiApiKey;

    if (!apiKey) {
        console.error('No API key found. Please set your OpenAI API key in the extension popup.');
        return null;
    }

    // Modified prompt to be more explicit about selecting from options
    const prompt = `
    Question: ${questionText}
    Available options: ${options.join(', ')}

    Instructions:
    1. Select the most appropriate answer from the given options.
    2. Respond ONLY with one of the exact options listed above.
    3. Do not add any explanations or additional text.
    4. The response must match one of the options exactly.

    Select one option:`;

    try {
        const response = await fetch('https://api.openai.com/v1/chat/completions', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${apiKey}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                model: "gpt-3.5-turbo",
                messages: [
                    { 
                        role: "system", 
                        content: "You are an expert in answering multiple-choice questions. Always respond with exactly one of the provided options." 
                    },
                    { role: "user", content: prompt }
                ],
                max_tokens: 50,
                temperature: 0
            })
        });

        if (!response.ok) {
            if (response.status === 429 && retryCount < MAX_RETRIES) {
                const backoffDelay = BASE_DELAY * Math.pow(2, retryCount);
                await delay(backoffDelay);
                return getCorrectAnswerFromAPI(questionText, options, retryCount + 1);
            }
            
            console.error(`OpenAI API Error: ${response.status} - ${response.statusText}`);
            return null;
        }

        const data = await response.json();
        const answer = data?.choices?.[0]?.message?.content?.trim();

        // Validate that the answer is exactly one of the options
        if (answer && options.includes(answer)) {
            return answer;
        } else {
            console.error("API returned invalid answer:", answer);
            console.error("Expected one of:", options);
            
            // Retry with backoff if the answer is invalid
            if (retryCount < MAX_RETRIES) {
                const backoffDelay = BASE_DELAY * Math.pow(2, retryCount);
                await delay(backoffDelay);
                return getCorrectAnswerFromAPI(questionText, options, retryCount + 1);
            }
            return null;
        }
    } catch (error) {
        if (retryCount < MAX_RETRIES) {
            const backoffDelay = BASE_DELAY * Math.pow(2, retryCount);
            await delay(backoffDelay);
            return getCorrectAnswerFromAPI(questionText, options, retryCount + 1);
        }
        console.error("Error querying OpenAI API:", error.message || error);
        return null;
    }
}