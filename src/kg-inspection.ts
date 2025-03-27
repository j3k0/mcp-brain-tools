import logger from './logger.js';
import { KnowledgeGraphClient } from './kg-client.js';
import GroqAI from './ai-service.js';

/**
 * Inspect knowledge graph entities based on a query and information needed
 * @param {KnowledgeGraphClient} kgClient - The knowledge graph client
 * @param {string} informationNeeded - Description of what information is needed
 * @param {string|undefined} reason - Reason for the inspection (provides context to AI)
 * @param {string[]} keywords - Keywords related to the information needed
 * @param {string|undefined} zone - Memory zone to search in
 * @param {string[]|undefined} entityTypes - Optional filter to specific entity types
 * @returns {Promise<{
 *  entities: Array<{name: string, entityType: string, observations?: string[]}>,
 *  relations: Array<{from: string, to: string, type: string, fromZone: string, toZone: string}>,
 *  tentativeAnswer?: string
 * }>}
 */
export async function inspectKnowledgeGraph(
  kgClient: KnowledgeGraphClient,
  informationNeeded: string,
  reason: string | undefined,
  keywords: string[] = [],
  zone: string | undefined,
  entityTypes: string[] | undefined
): Promise<{
  entities: Array<{name: string, entityType: string, observations?: string[]}>,
  relations: Array<{from: string, to: string, type: string, fromZone: string, toZone: string}>,
  tentativeAnswer?: string
}> {
  try {
    // Prepare the search query using keywords
    const query = keywords.length > 0 
      ? keywords.join(' OR ') 
      : '*';
    
    logger.info(`Inspecting knowledge graph with query: ${query} for information: ${informationNeeded}`);
    
    // First search for entities matching the keywords (or all entities if no keywords provided)
    // Use this search to get up to 50 entities based on name matches
    const initialSearchParams = {
      query,
      includeObservations: false, // First search only for names, not full content
      entityTypes,
      limit: 50, // Get up to 50 matching entities
      sortBy: 'relevance' as const, // Sort by relevance by default
      zone,
    };
    
    // First search - just get entity names that match keywords
    const initialSearchResults = await kgClient.userSearch(initialSearchParams);
    const initialEntities = initialSearchResults.entities;
    
    if (initialEntities.length === 0) {
      return {
        entities: [],
        relations: [],
        tentativeAnswer: "No matching entities found in the knowledge graph"
      };
    }
    
    // If AI service is not enabled, just return the initial entities with a basic response
    if (!GroqAI.isEnabled) {
      logger.warn('AI service not enabled, returning initial entities without filtering');
      
      // Get relations for these entities
      const entityNames = initialEntities.map(e => e.name);
      const relationsResult = await kgClient.getRelationsForEntities(entityNames, zone);
      const relations = relationsResult.relations;
      
      // Format relations for response
      const formattedRelations = relations.map(r => ({
        from: r.from,
        to: r.to,
        type: r.relationType,
        fromZone: r.fromZone,
        toZone: r.toZone
      }));
      
      return {
        entities: initialEntities,
        relations: formattedRelations,
        tentativeAnswer: "AI service not enabled. Returning matching entities without analysis."
      };
    }
    
    // Now do a detailed search with the AI to determine which entities are most relevant
    // We pass the initial entities to the AI filter to determine relevance
    // We also include observations this time to give AI more context
    const detailedSearchParams = {
      query,
      includeObservations: true, // Include full observations for AI analysis
      entityTypes,
      limit: 50,
      sortBy: 'relevance' as const,
      zone,
      informationNeeded, // This triggers AI filtering
      reason
    };
    
    // Second search - get full entity details and use AI to filter by relevance
    const detailedSearchResults = await kgClient.userSearch(detailedSearchParams);
    const detailedEntities = detailedSearchResults.entities;
    const relations = detailedSearchResults.relations;
    
    // If no entities were found relevant, return the initial search results
    if (detailedEntities.length === 0) {
      // Rerun search without AI filtering but with a smaller limit
      const fallbackSearchParams = Object.assign({}, initialSearchParams, {
        limit: 10,
        includeObservations: true
      });
      
      const fallbackSearchResults = await kgClient.userSearch(fallbackSearchParams);
      const fallbackEntities = fallbackSearchResults.entities;
      
      // Get relations for these entities
      const entityNames = fallbackEntities.map(e => e.name);
      const relationsResult = await kgClient.getRelationsForEntities(entityNames, zone);
      const relations = relationsResult.relations;
      
      // Format relations for response
      const formattedRelations = relations.map(r => ({
        from: r.from,
        to: r.to,
        type: r.relationType,
        fromZone: r.fromZone,
        toZone: r.toZone
      }));
      
      return {
        entities: fallbackEntities,
        relations: formattedRelations,
        tentativeAnswer: "AI filtering did not find relevant entities. Returning top matching entities without filtering."
      };
    }
    
    // Now use AI to generate a tentative answer based on the detailed entities and their relations
    const systemPrompt = `You are an intelligent knowledge graph analyzer.
Your task is to analyze entities and their relations to provide a concise answer to the user's information needs.
Base your answer ONLY on the information in the entities and relations provided.`;

    let userPrompt = `Information needed: ${informationNeeded}`;
    
    if (reason) {
      userPrompt += `\nContext/Reason: ${reason}`;
    }

    userPrompt += `\n\nHere are the relevant entities and their relations:
Entities:
${JSON.stringify(detailedEntities, null, 2)}

Relations:
${JSON.stringify(relations, null, 2)}

Provide a concise, direct answer to the information needed based on these entities and relations.
Be specific and detailed, but avoid unnecessary verbosity. Focus only on the information that directly answers the query.`;

    let tentativeAnswer = "Could not generate an AI answer based on the entities.";
    try {
      // Use AI to generate an answer
      tentativeAnswer = await GroqAI.chatCompletion({
        system: systemPrompt,
        user: userPrompt
      });
    } catch (error) {
      logger.error('Error getting AI-generated answer:', { error });
    }
    
    // Return the final results
    return {
      entities: detailedEntities,
      relations,
      tentativeAnswer
    };
  } catch (error) {
    logger.error('Error inspecting knowledge graph:', { error });
    return {
      entities: [],
      relations: [],
      tentativeAnswer: `Error inspecting knowledge graph: ${error.message}`
    };
  }
}
