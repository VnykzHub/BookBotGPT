require('dotenv').config();
const express = require('express');
const path = require('path');
const axios = require('axios');
const { OpenAI } = require('openai');

// Create server
const app = express();
const PORT = process.env.PORT || 3978;

// Configure OpenAI
const openai = new OpenAI({
  apiKey: process.env.AZURE_OPENAI_API_KEY,
  baseURL: `${process.env.AZURE_OPENAI_ENDPOINT}/openai/deployments/${process.env.AZURE_OPENAI_DEPLOYMENT_NAME}`,
  defaultQuery: { 'api-version': process.env.AZURE_OPENAI_API_VERSION || '2024-12-01-preview' },
  defaultHeaders: { 'api-key': process.env.AZURE_OPENAI_API_KEY }
});

// Middleware
app.use(express.static(path.join(__dirname)));
app.use(express.json());

// Store conversation history
const conversations = {};

// Endpoint for web interface
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

// API endpoint for messages
app.post('/api/messages', async (req, res) => {
  try {
    const userInput = req.body.text;
    const userId = req.body.userId || 'default-user';
    
    // Initialize conversation history for new users
    if (!conversations[userId]) {
      conversations[userId] = [
        {
          role: "system",
          content: `You are an intelligent book recommendation assistant. You help users find books they might enjoy 
          by asking about their preferences and using available tools. Be conversational, friendly, and helpful.
          When users want recommendations, use the searchBooks tool to find relevant titles.
          
          When presenting book recommendations:
          1. Format each book title as a link using markdown: [Title](link)
          2. Include author, description, and rating when available
          3. Group books by themes or relevance to the query
          4. Explain why each book might be relevant to the user's interests`
        }
      ];
    }
    
    // Add user message to conversation
    conversations[userId].push({ role: "user", content: userInput });
    
    // Get AI response with function calling
    const completion = await openai.chat.completions.create({
      messages: conversations[userId],
      tools: [
        {
          type: "function",
          function: {
            name: "searchBooks",
            description: "Search for books in the Google Books database",
            parameters: {
              type: "object",
              properties: {
                query: {
                  type: "string",
                  description: "The search query for finding books. Can include title, author, genre, or keywords."
                },
                maxResults: {
                  type: "integer",
                  description: "The maximum number of results to return (default 5)"
                }
              },
              required: ["query"]
            }
          }
        }
      ],
      tool_choice: "auto",
      max_tokens: 500
    });
    
    const responseMessage = completion.choices[0].message;
    
    // Check if the model wants to call a function
    if (responseMessage.tool_calls) {
      console.log('🔧 AI is using the searchBooks tool');
      
      // Extract the function call details
      const toolCall = responseMessage.tool_calls[0];
      const functionName = toolCall.function.name;
      const functionArgs = JSON.parse(toolCall.function.arguments);
      
      let functionResponse = "";
      
      // Execute the appropriate function
      if (functionName === "searchBooks") {
        const bookResults = await getBookRecommendations(functionArgs.query, functionArgs.maxResults || 5);
        functionResponse = formatBookData(bookResults);
      }
      
      // Add both the assistant message and function response to the history
      conversations[userId].push(responseMessage);
      conversations[userId].push({
        role: "tool",
        tool_call_id: toolCall.id,
        content: functionResponse,
      });
      
      // Get the final response from the assistant
      const finalCompletion = await openai.chat.completions.create({
        messages: conversations[userId],
        max_tokens: 500
      });
      
      const finalResponse = finalCompletion.choices[0].message.content;
      
      // Add the final response to history
      conversations[userId].push({
        role: "assistant",
        content: finalResponse
      });
      
      res.json({
        text: finalResponse,
        html: true, // Signal that the content contains HTML/markdown
        source: 'google_books_api'
      });
      
    } else {
      // Regular conversation response (no function call)
      console.log('💬 Regular conversation response (no tool used)');
      conversations[userId].push({
        role: "assistant",
        content: responseMessage.content
      });
      
      res.json({
        text: responseMessage.content,
        html: false,
        source: 'conversation_only'
      });
    }
    
  } catch (error) {
    console.error('Error processing message:', error);
    res.status(500).json({ text: 'Sorry, something went wrong!' });
  }
});

// Function to get book recommendations from Google Books API
async function getBookRecommendations(query, maxResults = 5) {
  try {
    console.log(`🔍 Calling Google Books API with query: "${query}", maxResults: ${maxResults}`);
    
    const response = await axios.get('https://www.googleapis.com/books/v1/volumes', {
      params: {
        q: query,
        key: process.env.GOOGLE_BOOKS_API_KEY,
        maxResults: maxResults
      }
    });
    
    console.log(`✅ Google Books API returned ${response.data.items ? response.data.items.length : 0} results`);
    return response.data.items || [];
  } catch (error) {
    console.error('❌ Error fetching book recommendations:', error);
    return [];
  }
}

// Function to format book data for the AI
function formatBookData(books) {
  if (books.length === 0) {
    return "No books found matching your criteria.";
  }
  
  let formattedData = "Here are the books I found:\n\n";
  
  books.forEach((book, index) => {
    const volumeInfo = book.volumeInfo;
    
    // Create title with link
    formattedData += `${index + 1}. **Title**: "${volumeInfo.title}"`;
    
    if (volumeInfo.infoLink) {
      formattedData += ` - Link: ${volumeInfo.infoLink}\n`;
    } else {
      formattedData += '\n';
    }
    
    // Add thumbnail URL if available
    if (volumeInfo.imageLinks && volumeInfo.imageLinks.thumbnail) {
      formattedData += `   **Cover image**: ${volumeInfo.imageLinks.thumbnail}\n`;
    }
    
    if (volumeInfo.authors && volumeInfo.authors.length > 0) {
      formattedData += `   **Authors**: ${volumeInfo.authors.join(', ')}\n`;
    }
    
    if (volumeInfo.categories && volumeInfo.categories.length > 0) {
      formattedData += `   **Categories**: ${volumeInfo.categories.join(', ')}\n`;
    }
    
    if (volumeInfo.publishedDate) {
      formattedData += `   **Published**: ${volumeInfo.publishedDate}\n`;
    }
    
    if (volumeInfo.averageRating) {
      formattedData += `   **Rating**: ${volumeInfo.averageRating}/5 (${volumeInfo.ratingsCount || 'unknown'} ratings)\n`;
    }
    
    if (volumeInfo.description) {
      formattedData += `   **Description**: ${volumeInfo.description.substring(0, 200)}...\n`;
    }
    
    formattedData += '\n';
  });
  
  return formattedData;
}

// Start server
app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});