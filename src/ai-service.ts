'use strict';

import logger from './logger.js';

// Add Node.js process type definition
declare const process: {
  env: {
    [key: string]: string | undefined;
    GROQ_API_KEY?: string;
    GROQ_MODELS?: string;
    DEBUG_AI?: string;
  };
};

/**
 * Configuration for Groq API
 * @constant {Object}
 */
const GROQ_CONFIG = {
  baseUrl: 'https://api.groq.com/openai/v1',
  models: getModels(),
  apiKey: process.env.GROQ_API_KEY
};

function getModels() {
  if (process.env.GROQ_MODELS) {
    return process.env.GROQ_MODELS.split(',').map(x => x.trim()).filter(x => x);
  }
  return [
    'deepseek-r1-distill-llama-70b',
    'llama-3.3-70b-versatile',
    'llama-3.3-70b-specdec'
  ]
}

/**
 * Rate limiting configuration
 * @constant {Object}
 */
const RATE_LIMIT_CONFIG = {
  disableDuration: 5 * 60 * 1000, // 5 minutes in milliseconds
};

/**
 * Implementation of the AI filter service using Groq
 */
export const GroqAI = {
  name: 'Groq',
  isEnabled: !!GROQ_CONFIG.apiKey,

  /**
   * Tracks if the AI service is temporarily disabled due to rate limiting
   * @private
   */
  isDisabled: false,

  /**
   * Timestamp when the service can be re-enabled
   * @private
   */
  disabledUntil: null,

  /**
   * Current index in the models array being used
   * @private
   */
  currentModelIndex: 0,

  /**
   * Timestamp when to attempt using a higher priority model
   * @private
   */
  upgradeAttemptTime: null,

  /**
   * Moves to the next fallback model in the priority list
   * @private
   * @returns {boolean} False if we've reached the end of the model list
   */
  _moveToNextModel() {
    if (this.currentModelIndex < GROQ_CONFIG.models.length - 1) {
      this.currentModelIndex++;
      this.upgradeAttemptTime = Date.now() + RATE_LIMIT_CONFIG.disableDuration;
      logger.warn(`Switching to model ${GROQ_CONFIG.models[this.currentModelIndex]} until ${new Date(this.upgradeAttemptTime).toISOString()}`);
      return true;
    }
    
    // No more models available, disable the service
    this.isDisabled = true;
    this.disabledUntil = Date.now() + RATE_LIMIT_CONFIG.disableDuration;
    logger.warn(`All models exhausted. Service disabled until ${new Date(this.disabledUntil).toISOString()}`);
    return false;
  },

  /**
   * Checks if we should attempt to upgrade to a higher priority model
   * @private
   */
  _checkUpgrade() {
    const now = Date.now();
    if (this.currentModelIndex > 0 && this.upgradeAttemptTime && now >= this.upgradeAttemptTime) {
      this.currentModelIndex--;
      this.upgradeAttemptTime = null;
      logger.info(`Attempting to upgrade to model ${GROQ_CONFIG.models[this.currentModelIndex]}`);
    }
  },

  /**
   * Checks if the service is currently disabled and can be re-enabled
   * @private
   */
  _checkStatus() {
    const now = Date.now();
    
    if (this.isDisabled && now >= this.disabledUntil) {
      this.isDisabled = false;
      this.disabledUntil = null;
      this.currentModelIndex = 0; // Reset to highest priority model
      this.upgradeAttemptTime = null;
      logger.info('AI service re-enabled with primary model');
    }

    this._checkUpgrade();

    return {
      isDisabled: this.isDisabled,
      currentModel: GROQ_CONFIG.models[this.currentModelIndex]
    };
  },

  /**
   * Filters search results using AI to determine which entities are relevant to the user's information needs
   * @param {Object[]} searchResults - Array of entity objects from search
   * @param {string} userinformationNeeded - Description of what the user is looking for
   * @param {string} [reason] - Reason for the search, providing additional context
   * @returns {Promise<Record<string, number>>} Object mapping entity names to usefulness scores (0-100)
   * @throws {Error} If the API request fails
   */
  async filterSearchResults(searchResults, userinformationNeeded, reason) {

    const ret = searchResults.reduce((acc, result) => {
      acc[result.name] = 40;
      return acc;
    }, {});

    if (!userinformationNeeded || !searchResults || searchResults.length === 0) {
      return null; // Return null to tell the caller to use the original results
    }

    const status = this._checkStatus();
    
    if (status.isDisabled) {
      // If AI service is disabled, return null
      logger.warn('AI service temporarily disabled, returning null to use original results');
      return null;
    }

    const systemPrompt = `You are an intelligent filter for a knowledge graph search. 
Your task is to analyze search results and determine which entities are useful to the user's information needs.
Usefulness will be a score between 0 and 100:
- < 10: definitely not useful
- < 50: quite not useful
- >= 50: useful
- >= 90: extremely useful
Do not include entities with a score between 10 and 50 in your response.
Return a JSON object with the entity names as keys and their usefulness scores as values. Nothing else.`;

    let userPrompt = `Why am I searching: ${userinformationNeeded}`;
    
    if (reason) {
      userPrompt += `\nReason for search: ${reason}`;
    }

    userPrompt += `\n\nHere are the search results to filter:
${JSON.stringify(searchResults, null, 2)}

Return a JSON object mapping entity names to their usefulness scores (0-100). Do not omit any entities.
IMPORTANT: Your response will be directly passed to JSON.parse(). Do NOT use markdown formatting, code blocks, or any other formatting. Return ONLY a raw, valid JSON object.`;

    try {
      const response = await this.chatCompletion({
        system: systemPrompt,
        user: userPrompt
      });

      // Handle the response based on its type
      if (typeof response === 'object' && !Array.isArray(response)) {
        // If response is already an object, add entities with scores between 10 and 50,
        // and include entities with scores >= 50
        Object.entries(response).forEach(([name, score]) => {
          if (typeof score === 'number') {
            ret[name] = score;
          }
        });
        
        return ret;
      } else if (typeof response === 'string') {
        // If response is a string, try to parse it as JSON
        try {
          const parsedResponse = JSON.parse(response);
          
          if (typeof parsedResponse === 'object' && !Array.isArray(parsedResponse)) {
            // If parsed response is an object, add entities with scores between 10 and 50,
            // and include entities with scores >= 50
            Object.entries(parsedResponse).forEach(([name, score]) => {
              if (typeof score === 'number') {
                ret[name] = score;
              }
            });
            
            return ret;
          } else if (Array.isArray(parsedResponse)) {
            // For backward compatibility: if response is an array of entity names,
            // convert to object with maximum usefulness for each entity
            logger.warn('Received array format instead of object with scores, returning null to use original results');
            return null;
          } else {
            logger.warn('Unexpected response format from AI, returning null to use original results', { response });
            return null;
          }
        } catch (error) {
          logger.error('Error parsing AI response, returning null to use original results', { error, response });
          return null;
        }
      } else if (Array.isArray(response)) {
        // For backward compatibility: if response is an array of entity names,
        // convert to object with maximum usefulness for each entity
        logger.warn('Received array format instead of object with scores, returning null to use original results');
        return null;
      } else {
        // For any other type of response, return null
        logger.warn('Unhandled response type from AI, returning null to use original results', { responseType: typeof response });
        return null;
      }
    } catch (error) {
      logger.error('Error calling AI service, returning null to use original results', { error });
      return null;
    }
  },

  /**
   * Helper function to safely parse JSON with multiple attempts
   * @private
   * @param {string} jsonString - The JSON string to parse
   * @returns {Object|null} Parsed object or null if parsing fails
   */
  _safeJsonParse(jsonString) {
    // First attempt: direct parsing
    try {
      return JSON.parse(jsonString);
    } catch (error) {
      if (process.env.DEBUG_AI === 'true') {
        logger.debug('First JSON parse attempt failed, trying to clean the string', { error: error.message });
      }
      
      // Second attempt: try to extract JSON from markdown code blocks
      try {
        const matches = jsonString.match(/```(?:json)?\s*([\s\S]*?)```/);
        if (matches && matches[1]) {
          const extracted = matches[1].trim();
          return JSON.parse(extracted);
        }
      } catch (error) {
        if (process.env.DEBUG_AI === 'true') {
          logger.debug('Second JSON parse attempt failed', { error: error.message });
        }
      }
      
      // Third attempt: try to find anything that looks like a JSON object
      try {
        const jsonRegex = /{[^]*}/;
        const matches = jsonString.match(jsonRegex);
        if (matches && matches[0]) {
          return JSON.parse(matches[0]);
        }
      } catch (error) {
        if (process.env.DEBUG_AI === 'true') {
          logger.debug('Third JSON parse attempt failed', { error: error.message });
        }
      }
      
      // All attempts failed
      return null;
    }
  },

  /**
   * Sends a prompt to the Groq AI and returns the response
   * @param {Object} data - The chat completion request data
   * @param {string} data.system - The system message
   * @param {string} data.user - The user message
   * @param {Object} [data.model] - Optional model override
   * @returns {Promise<string>} The response from the AI
   * @throws {Error} If the API request fails
   */
  async chatCompletion(data) {
    const status = this._checkStatus();
    
    if (status.isDisabled) {
      throw new Error('AI service temporarily disabled due to rate limiting');
    }

    const messages = [
      { role: 'system', content: data.system },
      { role: 'user', content: data.user }
    ];

    const modelToUse = data.model?.model || status.currentModel;

    try {
      const response = await fetch(`${GROQ_CONFIG.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json',
          'Authorization': `Bearer ${GROQ_CONFIG.apiKey}`
        },
        body: JSON.stringify({
          model: modelToUse,
          messages,
          max_tokens: 1000,
          temperature: 0.25,
        }),
      });

      logger.info('Groq API response:', { status: response.status, statusText: response.statusText });

      if (!response.ok) {
        if (response.status === 429) { // Too Many Requests
          if (this._moveToNextModel()) {
            return this.chatCompletion(data);
          }
        }
        throw new Error(`Groq API error: ${response.statusText}`);
      }

      const result = await response.json();
      const content = result.choices[0].message.content;
      
      // Clean up the response by removing <think>...</think> tags if present
      let cleanedContent = content;
      
      // Only process if content is a string
      if (typeof content === 'string') {
        logger.info('Groq API response content:', { content });
        if (content.includes('<think>')) {
          const thinkingTagRegex = /<think>[\s\S]*?<\/think>/g;
          cleanedContent = content.replace(thinkingTagRegex, '').trim();
          
          // Log the cleaning if in debug mode
          if (process.env.DEBUG_AI === 'true') {
            logger.debug('Cleaned AI response by removing thinking tags');
          }
        }
        
        try {
          // Try to parse as JSON if it looks like JSON
          if ((cleanedContent.startsWith('{') && cleanedContent.endsWith('}')) || 
              (cleanedContent.startsWith('[') && cleanedContent.endsWith(']'))) {
            const parsed = JSON.parse(cleanedContent);
            return parsed;
          }
        } catch (error) {
          // Try additional parsing strategies
          const parsed = this._safeJsonParse(cleanedContent);
          if (parsed) {
            if (process.env.DEBUG_AI === 'true') {
              logger.debug('Recovered JSON using safe parsing method');
            }
            return parsed;
          }
          
          // If parsing fails, return cleaned string content
          if (process.env.DEBUG_AI === 'true') {
            logger.debug('Failed to parse response as JSON:', error.message);
          }
        }
      } else if (typeof content === 'object') {
        // If the content is already an object, return it directly
        return content;
      }
      
      return cleanedContent;
    } catch (error) {
      if (error.message.includes('Too Many Requests')) {
        if (this._moveToNextModel()) {
          return this.chatCompletion(data);
        }
      }
      throw error;
    }
  },

  /**
   * Classifies zones by usefulness based on the reason for listing
   * @param {ZoneMetadata[]} zones - Array of zone metadata objects
   * @param {string} reason - The reason for listing zones
   * @returns {Promise<Record<string, number>>} Object mapping zone names to usefulness scores (0-2)
   */
  async classifyZoneUsefulness(zones, reason) {
    if (!reason || !zones || zones.length === 0) {
      return {};
    }

    const status = this._checkStatus();
    
    if (status.isDisabled) {
      // If AI service is disabled, return all zones as very useful
      logger.warn('AI service temporarily disabled, returning all zones as very useful');
      return zones.reduce((acc, zone) => {
        acc[zone.name] = 2; // all zones marked as very useful
        return acc;
      }, {});
    }

    const systemPrompt = `You are an intelligent zone classifier for a knowledge graph system.
Your task is to analyze memory zones and determine how useful each zone is to the user's current needs.
Rate each zone on a scale from 0-2:
0: not useful
1: a little useful
2: very useful

Return ONLY a JSON object mapping zone names to usefulness scores. Format: {"zoneName": usefulness}`;

    const zoneData = zones.map(zone => ({
      name: zone.name,
      description: zone.description || ''
    }));

    const userPrompt = `Reason for listing zones: ${reason}

Here are the zones to classify:
${JSON.stringify(zoneData, null, 2)}

Return a JSON object mapping each zone name to its usefulness score (0-2):
0: not useful for my reason
1: a little useful for my reason
2: very useful for my reason`;

    try {
      const response = await this.chatCompletion({
        system: systemPrompt,
        user: userPrompt
      });

      // Parse the response - expecting a JSON object mapping zone names to scores
      try {
        const parsedResponse = JSON.parse(response);
        if (typeof parsedResponse === 'object' && !Array.isArray(parsedResponse)) {
          // Validate scores are in range 0-2
          Object.keys(parsedResponse).forEach(zoneName => {
            const score = parsedResponse[zoneName];
            if (typeof score !== 'number' || score < 0 || score > 2) {
              parsedResponse[zoneName] = 2; // Default to very useful for invalid scores
            }
          });
          return parsedResponse;
        } else {
          logger.warn('Unexpected response format from AI, returning all zones as very useful', { response });
          return zones.reduce((acc, zone) => {
            acc[zone.name] = 2; // all zones marked as very useful
            return acc;
          }, {});
        }
      } catch (error) {
        logger.error('Error parsing AI response, returning all zones as very useful', { error, response });
        return zones.reduce((acc, zone) => {
          acc[zone.name] = 2; // all zones marked as very useful
          return acc;
        }, {});
      }
    } catch (error) {
      logger.error('Error calling AI service, returning all zones as very useful', { error });
      return zones.reduce((acc, zone) => {
        acc[zone.name] = 2; // all zones marked as very useful
        return acc;
      }, {});
    }
  },

  /**
   * Generates descriptions for a zone based on its content
   * @param {string} zoneName - The name of the zone
   * @param {string} currentDescription - The current description of the zone (if any)
   * @param {Array} relevantEntities - Array of the most relevant entities in the zone
   * @param {string} [userPrompt] - Optional user-provided description of the zone's purpose
   * @returns {Promise<{description: string, shortDescription: string}>} Generated descriptions
   */
  async generateZoneDescriptions(zoneName, currentDescription, relevantEntities, userPrompt): Promise<{description: string, shortDescription: string}> {
    if (!relevantEntities || relevantEntities.length === 0) {
      return {
        description: currentDescription || `Zone: ${zoneName}`,
        shortDescription: currentDescription || zoneName
      };
    }

    const status = this._checkStatus();
    
    if (status.isDisabled) {
      // If AI service is disabled, return current description
      logger.warn('AI service temporarily disabled, returning existing description');
      return {
        description: currentDescription || `Zone: ${zoneName}`,
        shortDescription: currentDescription || zoneName
      };
    }

    const systemPrompt = `You are an AI assistant that generates concise and informative descriptions for memory zones in a knowledge graph system.
Your primary task is to answer the question: "What is ${zoneName}?" based on the content within this zone.

Based on the zone name and the entities it contains, create two descriptions:
1. A full description (up to 200 words) that explains what this zone is, its purpose, and content in detail. This should clearly answer "What is ${zoneName}? No general bulshit, focus on the specifics, what makes unique."
2. A short description (15-25 words) that succinctly explains what ${zoneName} is.

Your descriptions should be clear, informative, and accurately reflect the zone's content.
Avoid using generic phrases like "This zone contains..." or "A collection of...".
Instead, focus on the specific subject matter and purpose of the zone.

IMPORTANT: Your response will be directly passed to JSON.parse(). Do NOT use markdown formatting, code blocks, or any other formatting. Return ONLY a raw, valid JSON object with "description" and "shortDescription" fields. For example:
{"description": "This is a description", "shortDescription": "Short description"}`;

    let userPromptText = `Zone name: ${zoneName}
Current description: ${currentDescription || 'None'}

Here are the most relevant entities in this zone:
${JSON.stringify(relevantEntities, null, 2)}`;

    // If user provided additional context, include it
    if (userPrompt) {
      userPromptText += `\n\nUser-provided zone purpose: ${userPrompt}`;
    }

    userPromptText += `\n\nGenerate two descriptions that answer "What is ${zoneName}?":
1. A full description (up to 200 words)
2. A short description (15-25 words)

Return your response as a raw, valid JSON object with "description" and "shortDescription" fields. Do NOT use markdown formatting, code blocks or any other formatting. Just the raw JSON object.`;

    try {
      const response = await this.chatCompletion({
        system: systemPrompt,
        user: userPromptText
      });

      // Log the raw response for debugging purposes
      if (process.env.DEBUG_AI === 'true') {
        logger.debug('Raw AI response:', response);
      }

      // Handle the response
      try {
        // If the response is already an object with the expected format, use it directly
        if (typeof response === 'object' && 
            typeof response.description === 'string' && 
            typeof response.shortDescription === 'string') {
          return {
            description: response.description,
            shortDescription: response.shortDescription
          };
        }
        
        // If the response is a string, try to parse it
        if (typeof response === 'string') {
          // Try to parse with enhanced parsing function
          const parsedResponse = this._safeJsonParse(response);
          
          if (parsedResponse && 
              typeof parsedResponse.description === 'string' && 
              typeof parsedResponse.shortDescription === 'string') {
            return {
              description: parsedResponse.description,
              shortDescription: parsedResponse.shortDescription
            };
          }
        }
        
        // If we get here, the response format is unexpected
        logger.warn('Unexpected response format from AI, returning existing description', { response });
        return {
          description: currentDescription || `Zone: ${zoneName}`,
          shortDescription: currentDescription || zoneName
        };
      } catch (error) {
        logger.error('Error parsing AI response, returning existing description', { error, response });
        return {
          description: currentDescription || `Zone: ${zoneName}`,
          shortDescription: currentDescription || zoneName
        };
      }
    } catch (error) {
      logger.error('Error calling AI service, returning existing description', { error });
      return {
        description: currentDescription || `Zone: ${zoneName}`,
        shortDescription: currentDescription || zoneName
      };
    }
  },

  /**
   * Analyzes file content and returns lines relevant to the user's information needs
   * @param {Array<{lineNumber: number, content: string}>} fileLines - Array of line objects with line numbers and content
   * @param {string} informationNeeded - Description of what information is needed from the file
   * @param {string} [reason] - Additional context about why this information is needed
   * @returns {Promise<Array<{lineNumber: number, content: string, relevance: number}>>} Array of relevant lines with their relevance scores
   * @throws {Error} If the API request fails
   */
  async filterFileContent(fileLines, informationNeeded, reason): Promise<{lineRanges: string[], tentativeAnswer?: string}> {
    if (!informationNeeded || !fileLines || fileLines.length === 0) {
      return {
        lineRanges: [`1-${fileLines.length}`],
        tentativeAnswer: "No information needed, returning all lines"
      };
    }

    const status = this._checkStatus();
    
    if (status.isDisabled) {
      logger.warn('AI service temporarily disabled, returning all lines');
      return {
        lineRanges: [`1-${fileLines.length}`],
        tentativeAnswer: "Groq AI service is temporarily disabled. Please try again later."
      };
    }

    const systemPrompt = `You are an intelligent file content analyzer.
Your task is to analyze file contents and determine which lines are relevant to the user's information needs.
The response should be a raw JSON object like: {"lineRanges": ["1-10", "20-40", ...], "tentativeAnswer": "Answer to the information needed, if possible."}
Be selective, the goal is to find the most relevant lines, not to include all of them. If some lines might be relevant but not worth returning completely, the tentative answer can mention additional line range with a short description.
`;

    let userPrompt = `Information needed: ${informationNeeded}`;
    
    if (reason) {
      userPrompt += `\nContext/Reason: ${reason}`;
    }

    userPrompt += `\n\nHere are the file contents to analyze (<line number>:<content>):
${fileLines.map(line => `${line.lineNumber}:${line.content}`).slice(0, 2000).join('\n')}

Return a JSON object with: {
    "temptativeAnswer": "Answer to the information needed, if possible. Do not be too general, be specific. Make it detailed, but without useless details. It must be straight to the point, using as little words as posssible without losing information. The text can be long (even 100 words or more if necessary), it's a good thing as long as it's relevant and based on facts based on the file content. But information must be condensed, don't be too verbose.",
    "lineRanges": ["1-10", "20-40", ...]
}
IMPORTANT: Your response must be a raw JSON object that can be parsed with JSON.parse().`;

    try {
      const response = await this.chatCompletion({
        system: systemPrompt,
        user: userPrompt
      });

      let result: {lineRanges: string[], tentativeAnswer?: string};
      if (typeof response === 'object' && !Array.isArray(response)) {
        result = response;
        if (!result.lineRanges || !Array.isArray(result.lineRanges)) {
          result.lineRanges = [];
        }
      } else if (typeof response === 'string') {
        // Try to parse with enhanced parsing function
        const parsedResponse = this._safeJsonParse(response);
        
        if (parsedResponse) {
          result = parsedResponse;
          if (!result.lineRanges || !Array.isArray(result.lineRanges)) {
            result.lineRanges = [];
          }
        } else {
          logger.error('Error parsing AI response, returning all lines', { response });
          return {
            lineRanges: [`1-${fileLines.length}`],
            tentativeAnswer: "Error parsing AI response, returning all lines"
          };
        }
      }

      // Filter and format the results
      return {
        lineRanges: result.lineRanges,
        tentativeAnswer: result.tentativeAnswer || "No answers given by AI"
      }
    } catch (error) {
      logger.error('Error calling AI service, returning all lines', { error });
      return {
        lineRanges: [`1-${fileLines.length}`],
        tentativeAnswer: "Error calling AI service, returning all lines"
      };
    }
  },
};

export default GroqAI; 