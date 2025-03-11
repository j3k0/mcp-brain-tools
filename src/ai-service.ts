'use strict';

import logger from './logger.js';

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
    'llama-3.3-70b-versatile',
    'llama-3.3-70b-specdec',
    'llama-3.1-70b-versatile',
    'llama-3.1-8b-instant',
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
   * @param {string} userInformationNeeds - Description of what the user is looking for
   * @param {string} [reason] - Reason for the search, providing additional context
   * @returns {Promise<string[]>} Array of entity names that are relevant to the user's needs
   * @throws {Error} If the API request fails
   */
  async filterSearchResults(searchResults, userInformationNeeds, reason) {
    if (!userInformationNeeds || !searchResults || searchResults.length === 0) {
      return searchResults.map(result => result.name);
    }

    const status = this._checkStatus();
    
    if (status.isDisabled) {
      // If AI service is disabled, return all results without filtering
      logger.warn('AI service temporarily disabled, returning unfiltered results');
      return searchResults.map(result => result.name);
    }

    const systemPrompt = `You are an intelligent filter for a knowledge graph search. 
Your task is to analyze search results and determine which entities are useful to the user's information needs.
Return ONLY the names of useful entities as a JSON array of strings. Nothing else.`;

    let userPrompt = `Why am I searching: ${userInformationNeeds}`;
    
    if (reason) {
      userPrompt += `\nReason for search: ${reason}`;
    }

    userPrompt += `\n\nHere are the search results to filter:
${JSON.stringify(searchResults, null, 2)}

Return only the names of the entities that are relevant to my information needs as a JSON array of strings.`;

    try {
      const response = await this.chatCompletion({
        system: systemPrompt,
        user: userPrompt
      });

      // Parse the response - expecting a JSON array of entity names
      try {
        const parsedResponse = JSON.parse(response);
        if (Array.isArray(parsedResponse)) {
          return parsedResponse;
        } else {
          logger.warn('Unexpected response format from AI, returning all results', { response });
          return searchResults.map(result => result.name);
        }
      } catch (error) {
        logger.error('Error parsing AI response, returning all results', { error, response });
        return searchResults.map(result => result.name);
      }
    } catch (error) {
      logger.error('Error calling AI service, returning all results', { error });
      return searchResults.map(result => result.name);
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
        })
      });

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
      try {
        const parsed = JSON.parse(content);
        if (typeof parsed === 'string') {
          return parsed;
        }
      }
      catch (error) {}
      return content;
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
};

export default GroqAI; 